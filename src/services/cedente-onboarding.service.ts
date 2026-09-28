import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import type { CedenteStage, Document, Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { prisma } from '../db/index.js';
import { env } from '../lib/env.js';
import { APP_ERROR } from '../lib/errors.js';
import { digitsOnly } from '../lib/party.js';
import {
  buildObjectKey,
  fileUriForKey,
  getAbsolutePath,
  keyFromFileUri,
  saveFile,
} from '../lib/storage.js';
import { isValidCnpj } from '../lib/cedente/validators.js';
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_BYTES,
  buildCedenteDocumentCatalog,
  extractSigners,
  findSlot,
  missingRequiredUploads,
  type CedenteDocumentSlot,
} from '../lib/cedente/document-catalog.js';
import { buildCedenteDocuments } from '../lib/cedente/pdf/cedente-documents.js';
import { docxToPdf } from '../lib/cedente/pdf/docx-to-pdf.js';
import { buildLegalOpinionPdf } from '../lib/cedente/pdf/legal-opinion.js';
import {
  createZapSignDocument,
  downloadZapSignFile,
  getZapSignDocument,
  type ZapSignDocument,
  type ZapSignSigner,
} from '../lib/zapsign/client.js';
import {
  cedenteEmpresaSchema,
  cedenteEstruturaSchema,
  formatZodIssues,
  type CedenteEmpresaData,
  type CedenteEstruturaData,
} from '../schemas/cedente-pj.schema.js';
import { logAudit } from './audit.service.js';
import { sendCedenteStageEmail } from './email.service.js';
import { applyKycScreening, createOnboarding, type KycFlags } from './onboarding.service.js';

export const CEDENTE_TOTAL_STEPS = 7;

export const CEDENTE_STEP = {
  empresa: 1,
  estrutura: 2,
  documentos: 3,
  assinatura: 4,
  juridico: 5,
  kycAml: 6,
  aprovacao: 7,
} as const;

export const CEDENTE_STAGE_LABEL: Record<CedenteStage, string> = {
  rascunho: 'Rascunho',
  aguardando_assinatura: 'Aguardando assinatura',
  em_analise_juridica: 'Em análise jurídica',
  pendencia_juridica: 'Pendência jurídica',
  em_analise_compliance: 'Em análise de Compliance',
  aprovado: 'Aprovado',
  rejeitado: 'Rejeitado',
};

const EDITABLE_STAGES: CedenteStage[] = ['rascunho', 'pendencia_juridica'];
const FINAL_STAGES: CedenteStage[] = ['aprovado', 'rejeitado'];

export type CedenteSection = 'empresa' | 'estrutura';

type PjData = { empresa?: Record<string, unknown>; estrutura?: Record<string, unknown> };

export type CedenteStepData = {
  pj?: PjData;
  pjValidated?: { empresa?: boolean; estrutura?: boolean };
  generation?: { formHash: string; generatedAt: string; documentIds: string[] };
  kyc?: KycFlags;
  aml?: { lawfulOriginDeclared: boolean };
  [key: string]: unknown;
};

type Actor = { userId: string; ip?: string };

function readStepData(raw: unknown): CedenteStepData {
  return raw && typeof raw === 'object' ? (raw as CedenteStepData) : {};
}

export function formFromStepData(data: CedenteStepData): Record<string, unknown> {
  return { ...(data.pj?.empresa ?? {}), ...(data.pj?.estrutura ?? {}) };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

export function hashForm(form: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(form)))
    .digest('hex');
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function onboardingUrl(id: string) {
  return `${env.webUrl}/cedentes/${id}`;
}

/** Latest confirmed document per slot (uploads with an empty hash are still in flight). */
export function currentDocumentsBySlot<
  T extends Pick<Document, 'slot' | 'hashSha256' | 'createdAt'>,
>(docs: T[]): Map<string, T> {
  const bySlot = new Map<string, T>();
  const sorted = [...docs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  for (const doc of sorted) {
    if (!doc.slot || !doc.hashSha256) continue;
    if (!bySlot.has(doc.slot)) bySlot.set(doc.slot, doc);
  }
  return bySlot;
}

/**
 * Documents the legal team must clear before a favorable opinion:
 * every required slot present and every present catalog document approved.
 */
export function documentsBlockingApproval(
  catalog: CedenteDocumentSlot[],
  current: Map<string, Pick<Document, 'status'>>,
): string[] {
  const blocking: string[] = [];
  for (const slot of catalog) {
    const doc = current.get(slot.key);
    if (!doc) {
      if (slot.required) blocking.push(`${slot.label} (ausente)`);
      continue;
    }
    if (doc.status !== 'aprovado') {
      blocking.push(`${slot.label} (${DOCUMENT_STATUS_LABEL[doc.status] ?? doc.status})`);
    }
  }
  return blocking;
}

const DOCUMENT_STATUS_LABEL: Record<string, string> = {
  pendente: 'pendente',
  em_analise: 'em análise',
  rejeitado: 'recusado',
  vencido: 'vencido',
  assinado: 'assinado',
  recusado: 'recusado',
  cancelado: 'cancelado',
};

async function findCedenteProcess(id: string) {
  const process = await prisma.onboardingProcess.findFirst({
    where: { id, kind: 'cedente', party: { deletedAt: null } },
    include: { party: true },
  });
  if (!process) throw APP_ERROR.NOT_FOUND('Onboarding de cedente');
  return process;
}

function assertStage(stage: CedenteStage | null, allowed: CedenteStage[], action: string) {
  if (!stage || !allowed.includes(stage)) {
    throw APP_ERROR.BAD_REQUEST(
      `${action} não permitido na etapa "${stage ? CEDENTE_STAGE_LABEL[stage] : 'desconhecida'}"`,
    );
  }
}

async function setStep(
  tx: Prisma.TransactionClient,
  processId: string,
  step: number,
  userId?: string,
) {
  await tx.onboardingStep.updateMany({
    where: { processId, stepNumber: { lt: step }, status: { not: 'concluido' } },
    data: { status: 'concluido', completedAt: new Date(), completedBy: userId },
  });
  await tx.onboardingStep.updateMany({
    where: { processId, stepNumber: step },
    data: { status: 'em_andamento', completedAt: null },
  });
  await tx.onboardingStep.updateMany({
    where: { processId, stepNumber: { gt: step } },
    data: { status: 'pendente', completedAt: null },
  });
}

async function transition(
  processId: string,
  input: {
    stage: CedenteStage;
    step: number;
    stepData?: CedenteStepData;
    extra?: Prisma.OnboardingProcessUpdateInput;
  },
  actor?: Actor,
) {
  await prisma.$transaction(async (tx) => {
    await tx.onboardingProcess.update({
      where: { id: processId },
      data: {
        cedenteStage: input.stage,
        currentStep: input.step,
        ...(input.stepData ? { stepDataJson: input.stepData as Prisma.InputJsonValue } : {}),
        ...input.extra,
      },
    });
    await setStep(tx, processId, input.step, actor?.userId);
  });
}

async function audit(
  actor: Actor | undefined,
  action: string,
  processId: string,
  details: Record<string, unknown>,
) {
  await logAudit({
    userId: actor?.userId,
    action,
    entityType: 'onboarding_process',
    entityId: processId,
    details,
    ipAddress: actor?.ip,
  });
}

async function notifyStage(
  processId: string,
  legalName: string,
  stage: CedenteStage,
  detail: string,
) {
  try {
    await sendCedenteStageEmail({
      legalName,
      stageLabel: CEDENTE_STAGE_LABEL[stage],
      detail,
      onboardingUrl: onboardingUrl(processId),
    });
  } catch (err) {
    console.error('[cedente] falha ao notificar etapa', err);
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getCedenteOnboarding(id: string) {
  const process = await prisma.onboardingProcess.findFirst({
    where: { id, kind: 'cedente', party: { deletedAt: null } },
    include: {
      party: {
        include: {
          contacts: true,
          beneficialOwners: true,
          cedente: true,
          bankAccounts: true,
        },
      },
      fund: true,
      steps: { orderBy: { stepNumber: 'asc' } },
      signatureEnvelopes: { orderBy: { createdAt: 'asc' } },
      legalReviews: {
        orderBy: { createdAt: 'desc' },
        include: { reviewer: { select: { id: true, name: true, email: true } } },
      },
    },
  });
  if (!process) return null;

  const docs = await prisma.document.findMany({
    where: { partyId: process.partyId },
    orderBy: { createdAt: 'desc' },
  });

  const stepData = readStepData(process.stepDataJson);
  const form = formFromStepData(stepData);
  const catalog = buildCedenteDocumentCatalog(form);
  const current = currentDocumentsBySlot(docs);
  const primary =
    process.party.contacts.find((c) => c.isPrimary) ?? process.party.contacts[0] ?? null;
  const generation = stepData.generation;
  const formChangedSinceGeneration = generation ? generation.formHash !== hashForm(form) : false;

  const mapDoc = (d: Document) => ({
    id: d.id,
    type: d.type,
    slot: d.slot ?? undefined,
    fileName: d.fileName,
    mimeType: d.mimeType ?? 'application/octet-stream',
    size: d.sizeBytes ?? 0,
    status: d.status,
    rejectionReason: d.rejectionReason ?? undefined,
    uploadedAt: d.createdAt.toISOString(),
  });

  return {
    id: process.id,
    partyId: process.partyId,
    type: process.kind,
    partyType: process.party.type,
    cpfCnpj: process.party.cpfCnpj,
    legalName: process.party.legalName,
    email: primary?.email ?? undefined,
    phone: primary?.phone ?? undefined,
    fundId: process.fundId,
    fundName: process.fund.name,
    fundModality: process.fund.modality,
    currentStep: process.currentStep,
    totalSteps: CEDENTE_TOTAL_STEPS,
    status: process.status,
    cedenteStage: process.cedenteStage ?? 'rascunho',
    partyStatus: process.party.status,
    startedAt: process.startedAt.toISOString(),
    expiresAt: process.expiresAt?.toISOString(),
    completedAt: process.completedAt?.toISOString(),
    approvedById: process.approvedById ?? undefined,
    approvalJustification: process.approvalJustification ?? undefined,
    steps: process.steps.map((s) => ({
      stepNumber: s.stepNumber,
      status: s.status,
      completedAt: s.completedAt?.toISOString() ?? null,
      notes: s.notes ?? undefined,
    })),
    form: {
      empresa: stepData.pj?.empresa ?? {},
      estrutura: stepData.pj?.estrutura ?? {},
      validated: {
        empresa: Boolean(stepData.pjValidated?.empresa),
        estrutura: Boolean(stepData.pjValidated?.estrutura),
      },
    },
    signers: extractSigners(form),
    documentSlots: catalog.map((slot) => {
      const doc = current.get(slot.key);
      return { ...slot, document: doc ? mapDoc(doc) : undefined };
    }),
    documents: docs.filter((d) => d.hashSha256).map(mapDoc),
    generation: generation ? { ...generation, formChangedSinceGeneration } : undefined,
    signatureEnvelopes: process.signatureEnvelopes.map((e) => ({
      id: e.id,
      provider: e.provider,
      externalToken: e.externalToken,
      documentId: e.documentId ?? undefined,
      status: e.status,
      sandbox: e.sandbox,
      signers: (Array.isArray(e.signersJson) ? e.signersJson : []) as Array<{
        name: string;
        email: string;
        status: string;
        signUrl?: string;
        signedAt?: string | null;
      }>,
      signedAt: e.signedAt?.toISOString(),
      createdAt: e.createdAt.toISOString(),
    })),
    legalReviews: process.legalReviews.map((r) => ({
      id: r.id,
      decision: r.decision,
      opinion: r.opinion,
      pendingItems: (Array.isArray(r.pendingItemsJson) ? r.pendingItemsJson : []) as string[],
      documentId: r.documentId ?? undefined,
      reviewer: r.reviewer,
      createdAt: r.createdAt.toISOString(),
    })),
    kyc: stepData.kyc,
    aml: stepData.aml,
    beneficialOwners: process.party.beneficialOwners.map((o) => ({
      id: o.id,
      ownerName: o.ownerName,
      ownerCpfCnpj: o.ownerCpfCnpj,
      ownershipPct: Number(o.ownershipPct),
      pepFlag: o.pepFlag,
    })),
    juntaValidationStatus: process.party.cedente?.juntaValidationStatus,
  };
}

export type CedenteOnboardingDetail = NonNullable<Awaited<ReturnType<typeof getCedenteOnboarding>>>;

async function reloadCedenteOnboarding(id: string): Promise<CedenteOnboardingDetail> {
  const detail = await getCedenteOnboarding(id);
  if (!detail) throw APP_ERROR.NOT_FOUND('Onboarding de cedente');
  return detail;
}

export async function listCedenteOnboardings(filter: { stage?: CedenteStage } = {}) {
  const items = await prisma.onboardingProcess.findMany({
    where: {
      kind: 'cedente',
      party: { deletedAt: null },
      ...(filter.stage ? { cedenteStage: filter.stage } : {}),
    },
    select: { id: true },
    orderBy: { startedAt: 'desc' },
  });
  const loaded = await Promise.all(items.map((p) => getCedenteOnboarding(p.id)));
  return loaded.filter((x): x is CedenteOnboardingDetail => x !== null);
}

// ---------------------------------------------------------------------------
// Steps 1–2: form
// ---------------------------------------------------------------------------

export async function createCedenteOnboarding(
  input: { cnpj: string; legalName: string; fundId: string },
  actor: Actor,
) {
  const cnpj = digitsOnly(input.cnpj);
  if (!isValidCnpj(cnpj)) throw APP_ERROR.BAD_REQUEST('CNPJ inválido');

  const created = await createOnboarding({
    partyType: 'pj',
    cpfCnpj: cnpj,
    legalName: input.legalName.trim(),
    fundId: input.fundId,
    kind: 'cedente',
  });
  if (!created) throw APP_ERROR.NOT_FOUND('Onboarding de cedente');

  const stepData: CedenteStepData = {
    pj: { empresa: { company: input.legalName.trim(), cnpj }, estrutura: {} },
    pjValidated: {},
  };
  await prisma.$transaction(async (tx) => {
    await tx.onboardingStep.upsert({
      where: {
        processId_stepNumber: { processId: created.id, stepNumber: CEDENTE_TOTAL_STEPS },
      },
      update: {},
      create: { processId: created.id, stepNumber: CEDENTE_TOTAL_STEPS, status: 'pendente' },
    });
    await tx.onboardingProcess.update({
      where: { id: created.id },
      data: { cedenteStage: 'rascunho', stepDataJson: stepData as Prisma.InputJsonValue },
    });
  });

  await audit(actor, 'cedentes.onboarding.create', created.id, { cnpj, fundId: input.fundId });
  return reloadCedenteOnboarding(created.id);
}

export async function saveCedenteSection(
  id: string,
  section: CedenteSection,
  data: Record<string, unknown>,
  options: { advance: boolean },
  actor: Actor,
) {
  const process = await findCedenteProcess(id);
  assertStage(process.cedenteStage, EDITABLE_STAGES, 'Edição do formulário');

  const stepData = readStepData(process.stepDataJson);
  let stored: CedenteEmpresaData | CedenteEstruturaData | Record<string, unknown> = data;
  let validated = false;

  if (options.advance && section === 'empresa') {
    const parsed = cedenteEmpresaSchema.safeParse(data);
    if (!parsed.success) throw APP_ERROR.BAD_REQUEST(formatZodIssues(parsed.error));
    if (digitsOnly(parsed.data.cnpj) !== process.party.cpfCnpj) {
      throw APP_ERROR.BAD_REQUEST('CNPJ do formulário difere do CNPJ do cadastro');
    }
    stored = parsed.data;
    validated = true;
  } else if (options.advance) {
    const parsed = cedenteEstruturaSchema.safeParse(data);
    if (!parsed.success) throw APP_ERROR.BAD_REQUEST(formatZodIssues(parsed.error));
    stored = parsed.data;
    validated = true;
  }

  const next: CedenteStepData = {
    ...stepData,
    pj: { ...stepData.pj, [section]: stored },
    pjValidated: { ...stepData.pjValidated, [section]: validated },
  };

  const sectionStep = section === 'empresa' ? CEDENTE_STEP.empresa : CEDENTE_STEP.estrutura;
  const inPendencia = process.cedenteStage === 'pendencia_juridica';
  const nextStep =
    options.advance && !inPendencia
      ? Math.max(process.currentStep, sectionStep + 1)
      : process.currentStep;

  await prisma.$transaction(async (tx) => {
    await tx.onboardingProcess.update({
      where: { id },
      data: { stepDataJson: next as Prisma.InputJsonValue, currentStep: nextStep },
    });
    if (nextStep !== process.currentStep) await setStep(tx, id, nextStep, actor.userId);
    if (section === 'empresa' && validated) {
      const company = String((stored as CedenteEmpresaData).company ?? '').trim();
      if (company) {
        await tx.party.update({ where: { id: process.partyId }, data: { legalName: company } });
      }
    }
  });

  await audit(actor, 'cedentes.onboarding.save_section', id, { section, validated });
  return reloadCedenteOnboarding(id);
}

function validatedForm(stepData: CedenteStepData) {
  const empresa = cedenteEmpresaSchema.safeParse(stepData.pj?.empresa ?? {});
  if (!empresa.success) {
    throw APP_ERROR.BAD_REQUEST(`Dados da empresa: ${formatZodIssues(empresa.error)}`);
  }
  const estrutura = cedenteEstruturaSchema.safeParse(stepData.pj?.estrutura ?? {});
  if (!estrutura.success) {
    throw APP_ERROR.BAD_REQUEST(`Estrutura societária: ${formatZodIssues(estrutura.error)}`);
  }
  return { ...empresa.data, ...estrutura.data } as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Step 3: documents
// ---------------------------------------------------------------------------

export async function requestCedenteDocumentUpload(
  id: string,
  input: { slot: string; fileName: string; mimeType: string; size: number },
  actor: Actor,
) {
  const process = await findCedenteProcess(id);
  assertStage(process.cedenteStage, EDITABLE_STAGES, 'Envio de documento');

  const form = formFromStepData(readStepData(process.stepDataJson));
  const slot = findSlot(form, input.slot);
  if (!slot) throw APP_ERROR.BAD_REQUEST('Documento não previsto para este cedente');
  if (slot.source !== 'upload') {
    throw APP_ERROR.BAD_REQUEST('Documento gerado pelo sistema não aceita upload manual');
  }
  if (!(ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    throw APP_ERROR.BAD_REQUEST('Formato não permitido (PDF, JPG, PNG ou WEBP)');
  }
  if (!(input.size > 0) || input.size > MAX_DOCUMENT_BYTES) {
    throw APP_ERROR.BAD_REQUEST('Arquivo deve ter até 10 MB');
  }

  const doc = await prisma.document.create({
    data: {
      partyId: process.partyId,
      type: slot.type,
      slot: slot.key,
      fileName: input.fileName.slice(0, 255),
      fileUri: '',
      hashSha256: '',
      mimeType: input.mimeType,
      sizeBytes: input.size,
      status: 'pendente',
      uploadedById: actor.userId,
    },
  });
  const key = buildObjectKey(process.partyId, slot.type, doc.id);
  await prisma.document.update({ where: { id: doc.id }, data: { fileUri: fileUriForKey(key) } });

  return { documentId: doc.id, uploadUrl: `${env.publicApiUrl}/files/upload/${doc.id}` };
}

export async function confirmCedenteDocumentUpload(id: string, documentId: string, actor: Actor) {
  const process = await findCedenteProcess(id);
  assertStage(process.cedenteStage, EDITABLE_STAGES, 'Envio de documento');

  const doc = await prisma.document.findFirst({
    where: { id: documentId, partyId: process.partyId },
  });
  if (!doc || !doc.slot) throw APP_ERROR.NOT_FOUND('Documento');

  let data: Buffer;
  try {
    data = await fs.readFile(getAbsolutePath(keyFromFileUri(doc.fileUri)));
  } catch {
    throw APP_ERROR.BAD_REQUEST('Arquivo não encontrado — refaça o upload');
  }

  await prisma.document.update({
    where: { id: doc.id },
    data: { hashSha256: sha256(data), sizeBytes: data.length, status: 'em_analise' },
  });
  await audit(actor, 'cedentes.onboarding.document_upload', id, {
    documentId,
    slot: doc.slot,
    type: doc.type,
  });
  return reloadCedenteOnboarding(id);
}

export async function submitCedenteDocuments(id: string, actor: Actor) {
  const process = await findCedenteProcess(id);
  assertStage(process.cedenteStage, ['rascunho'], 'Conclusão dos documentos');
  const stepData = readStepData(process.stepDataJson);
  const form = validatedForm(stepData);

  const docs = await prisma.document.findMany({ where: { partyId: process.partyId } });
  const missing = missingRequiredUploads(form, currentDocumentsBySlot(docs).keys());
  if (missing.length > 0) {
    throw APP_ERROR.BAD_REQUEST(
      `Documentos obrigatórios pendentes: ${missing.map((m) => m.label).join(', ')}`,
    );
  }

  await transition(
    id,
    { stage: 'rascunho', step: Math.max(process.currentStep, CEDENTE_STEP.assinatura) },
    actor,
  );
  await audit(actor, 'cedentes.onboarding.documents_submitted', id, {});
  return reloadCedenteOnboarding(id);
}

// ---------------------------------------------------------------------------
// Step 4: PDFs + ZapSign
// ---------------------------------------------------------------------------

export async function generateCedenteDocuments(id: string, actor: Actor) {
  const process = await findCedenteProcess(id);
  assertStage(process.cedenteStage, ['rascunho'], 'Geração dos PDFs');
  if (process.currentStep < CEDENTE_STEP.assinatura) {
    throw APP_ERROR.BAD_REQUEST('Conclua o envio dos documentos antes de gerar os PDFs');
  }

  const stepData = readStepData(process.stepDataJson);
  const form = validatedForm(stepData);
  const generated = await buildCedenteDocuments(form);

  const documentIds: string[] = [];
  for (const item of generated) {
    const pdf = await docxToPdf(item.docx, item.fileBaseName);
    const doc = await prisma.document.create({
      data: {
        partyId: process.partyId,
        type: item.type,
        slot: item.slot,
        fileName: `${item.fileBaseName}.pdf`,
        fileUri: '',
        hashSha256: sha256(pdf),
        mimeType: 'application/pdf',
        sizeBytes: pdf.length,
        status: 'em_analise',
        uploadedById: actor.userId,
      },
    });
    const key = buildObjectKey(process.partyId, item.type, doc.id);
    await saveFile(key, pdf);
    await prisma.document.update({ where: { id: doc.id }, data: { fileUri: fileUriForKey(key) } });
    documentIds.push(doc.id);
  }

  await prisma.signatureEnvelope.updateMany({
    where: { onboardingId: id, status: 'pendente' },
    data: { status: 'cancelado' },
  });

  const next: CedenteStepData = {
    ...stepData,
    generation: {
      formHash: hashForm(formFromStepData(stepData)),
      generatedAt: new Date().toISOString(),
      documentIds,
    },
  };
  await prisma.onboardingProcess.update({
    where: { id },
    data: { stepDataJson: next as Prisma.InputJsonValue },
  });

  await audit(actor, 'cedentes.onboarding.generate_pdfs', id, { documentIds });
  return reloadCedenteOnboarding(id);
}

export async function sendCedenteForSignature(id: string, actor: Actor) {
  const process = await findCedenteProcess(id);
  assertStage(process.cedenteStage, ['rascunho'], 'Envio para assinatura');

  const stepData = readStepData(process.stepDataJson);
  const generation = stepData.generation;
  if (!generation || generation.documentIds.length === 0) {
    throw APP_ERROR.BAD_REQUEST('Gere os PDFs antes de enviar para assinatura');
  }
  const form = validatedForm(stepData);
  if (generation.formHash !== hashForm(formFromStepData(stepData))) {
    throw APP_ERROR.BAD_REQUEST('Formulário alterado após a geração — gere os PDFs novamente');
  }

  const signers = extractSigners(form);
  const bySlotSigner = new Map(signers.map((s) => [`${s.key}-cartao-assinatura`, s]));
  const docs = await prisma.document.findMany({
    where: { id: { in: generation.documentIds }, partyId: process.partyId },
  });

  const created: string[] = [];
  for (const doc of docs) {
    const pdf = await fs.readFile(getAbsolutePath(keyFromFileUri(doc.fileUri)));
    const zapSigners =
      doc.slot === 'ficha-cadastral-pj'
        ? [
            {
              name: signers[0]!.name,
              email: signers[0]!.email,
              signaturePlacement: '{{assinaturaCliente}}',
              externalId: signers[0]!.key,
            },
            {
              name: env.zapsignIndexSignerName,
              email: env.zapsignIndexSignerEmail ?? '',
              signaturePlacement: '{{assinaturaIndex}}',
              externalId: 'index',
            },
          ]
        : (() => {
            const signer = doc.slot ? bySlotSigner.get(doc.slot) : undefined;
            if (!signer)
              throw APP_ERROR.BAD_REQUEST(`Signatário não encontrado para ${doc.fileName}`);
            return [
              {
                name: signer.name,
                email: signer.email,
                signaturePlacement: '{{assinaturaCliente}}',
                externalId: signer.key,
              },
            ];
          })();
    if (zapSigners.some((s) => !s.email)) {
      throw APP_ERROR.BAD_REQUEST('Signatário sem e-mail (configure ZAPSIGN_INDEX_SIGNER_EMAIL)');
    }

    let zap: ZapSignDocument;
    try {
      zap = await createZapSignDocument({
        name: `${process.party.legalName} — ${doc.fileName}`,
        pdf,
        signers: zapSigners,
        externalId: `${id}:${doc.id}`,
      });
    } catch (err) {
      throw APP_ERROR.BAD_REQUEST(
        `Falha ao enviar para a ZapSign: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    await prisma.signatureEnvelope.create({
      data: {
        onboardingId: id,
        provider: 'zapsign',
        externalToken: zap.token,
        documentId: doc.id,
        status: 'pendente',
        sandbox: Boolean(zap.sandbox ?? env.zapsignSandbox),
        signersJson: mapZapSigners(zap.signers) as Prisma.InputJsonValue,
      },
    });
    created.push(zap.token);
  }

  await transition(id, { stage: 'aguardando_assinatura', step: CEDENTE_STEP.assinatura }, actor);
  await audit(actor, 'cedentes.onboarding.send_signature', id, {
    envelopes: created.length,
    sandbox: env.zapsignSandbox,
  });
  await notifyStage(
    id,
    process.party.legalName,
    'aguardando_assinatura',
    `${created.length} documento(s) enviados para assinatura na ZapSign.`,
  );
  return reloadCedenteOnboarding(id);
}

function mapZapSigners(signers: ZapSignSigner[] = []) {
  return signers.map((s) => ({
    name: s.name,
    email: s.email,
    status: s.status,
    signUrl: s.sign_url,
    signedAt: s.signed_at ?? null,
    externalId: s.external_id ?? null,
  }));
}

export type ZapSignEvent = {
  event_type?: string;
  token?: string;
  status?: string;
  signed_file?: string | null;
  signers?: ZapSignSigner[];
};

/**
 * Applies a ZapSign document state (webhook or polling). Idempotent: a signed
 * envelope is never processed twice.
 */
export async function applyZapSignDocumentState(event: ZapSignEvent) {
  if (!event.token) return { handled: false as const, reason: 'missing_token' };
  const envelope = await prisma.signatureEnvelope.findUnique({
    where: { externalToken: event.token },
    include: { onboarding: { include: { party: true } } },
  });
  if (!envelope) return { handled: false as const, reason: 'unknown_envelope' };
  if (envelope.status !== 'pendente') return { handled: true as const, envelopeId: envelope.id };

  const signersJson = event.signers
    ? (mapZapSigners(event.signers) as Prisma.InputJsonValue)
    : undefined;

  if (event.status === 'refused') {
    await prisma.signatureEnvelope.update({
      where: { id: envelope.id },
      data: { status: 'recusado', ...(signersJson ? { signersJson } : {}) },
    });
    await audit(undefined, 'cedentes.onboarding.signature_refused', envelope.onboardingId, {
      envelopeId: envelope.id,
    });
    if (envelope.onboarding.cedenteStage === 'aguardando_assinatura') {
      await prisma.signatureEnvelope.updateMany({
        where: { onboardingId: envelope.onboardingId, status: 'pendente' },
        data: { status: 'cancelado' },
      });
      await transition(envelope.onboardingId, {
        stage: 'rascunho',
        step: CEDENTE_STEP.assinatura,
      });
      await notifyStage(
        envelope.onboardingId,
        envelope.onboarding.party.legalName,
        'rascunho',
        'Assinatura recusada na ZapSign. Revise os dados, gere e envie os PDFs novamente.',
      );
    }
    return { handled: true as const, envelopeId: envelope.id };
  }

  if (event.status !== 'signed' || !event.signed_file) {
    if (signersJson) {
      await prisma.signatureEnvelope.update({ where: { id: envelope.id }, data: { signersJson } });
    }
    return { handled: true as const, envelopeId: envelope.id };
  }

  const signedPdf = await downloadZapSignFile(event.signed_file);
  if (envelope.documentId) {
    const doc = await prisma.document.findUnique({ where: { id: envelope.documentId } });
    if (doc) {
      await saveFile(keyFromFileUri(doc.fileUri), signedPdf);
      await prisma.document.update({
        where: { id: doc.id },
        data: {
          hashSha256: sha256(signedPdf),
          sizeBytes: signedPdf.length,
          fileName: doc.fileName.replace(/(\.pdf)?$/i, '-assinado.pdf'),
          status: 'em_analise',
        },
      });
    }
  }

  await prisma.signatureEnvelope.update({
    where: { id: envelope.id },
    data: { status: 'assinado', signedAt: new Date(), ...(signersJson ? { signersJson } : {}) },
  });
  await audit(undefined, 'cedentes.onboarding.document_signed', envelope.onboardingId, {
    envelopeId: envelope.id,
    documentId: envelope.documentId,
  });

  const pending = await prisma.signatureEnvelope.count({
    where: { onboardingId: envelope.onboardingId, status: 'pendente' },
  });
  if (pending === 0 && envelope.onboarding.cedenteStage === 'aguardando_assinatura') {
    await transition(envelope.onboardingId, {
      stage: 'em_analise_juridica',
      step: CEDENTE_STEP.juridico,
    });
    await audit(undefined, 'cedentes.onboarding.all_signed', envelope.onboardingId, {});
    await notifyStage(
      envelope.onboardingId,
      envelope.onboarding.party.legalName,
      'em_analise_juridica',
      'Todos os documentos foram assinados. Aguardando parecer jurídico.',
    );
  }
  return { handled: true as const, envelopeId: envelope.id };
}

/** Manual fallback when the webhook is not reachable (polls ZapSign). */
export async function refreshCedenteSignatures(id: string, actor: Actor) {
  const process = await findCedenteProcess(id);
  assertStage(process.cedenteStage, ['aguardando_assinatura'], 'Atualização das assinaturas');
  const envelopes = await prisma.signatureEnvelope.findMany({
    where: { onboardingId: id, status: 'pendente' },
  });
  for (const envelope of envelopes) {
    const zap = await getZapSignDocument(envelope.externalToken);
    await applyZapSignDocumentState({
      token: zap.token,
      status: zap.status,
      signed_file: zap.signed_file,
      signers: zap.signers,
    });
  }
  await audit(actor, 'cedentes.onboarding.refresh_signatures', id, { checked: envelopes.length });
  return reloadCedenteOnboarding(id);
}

// ---------------------------------------------------------------------------
// Step 5: legal review
// ---------------------------------------------------------------------------

export async function validateCedenteDocument(
  id: string,
  input: { documentId: string; approved: boolean; reason?: string },
  actor: Actor,
) {
  const process = await findCedenteProcess(id);
  assertStage(process.cedenteStage, ['em_analise_juridica'], 'Validação de documento');
  const doc = await prisma.document.findFirst({
    where: { id: input.documentId, partyId: process.partyId },
  });
  if (!doc) throw APP_ERROR.NOT_FOUND('Documento');
  const reason = input.reason?.trim();
  if (!input.approved && !reason) throw APP_ERROR.BAD_REQUEST('Informe o motivo da recusa');

  await prisma.document.update({
    where: { id: doc.id },
    data: {
      status: input.approved ? 'aprovado' : 'rejeitado',
      rejectionReason: input.approved ? null : reason,
      validatedAt: new Date(),
      validatedById: actor.userId,
    },
  });
  await audit(actor, 'cedentes.onboarding.document_validate', id, {
    documentId: doc.id,
    slot: doc.slot,
    approved: input.approved,
    reason,
  });
  return reloadCedenteOnboarding(id);
}

export async function submitLegalReview(
  id: string,
  input: {
    decision: 'favoravel' | 'pendencia' | 'desfavoravel';
    opinion: string;
    pendingItems?: string[];
  },
  actor: Actor,
) {
  const process = await findCedenteProcess(id);
  assertStage(process.cedenteStage, ['em_analise_juridica'], 'Parecer jurídico');

  const opinion = input.opinion.trim();
  if (opinion.length < 10) throw APP_ERROR.BAD_REQUEST('Parecer deve ter ao menos 10 caracteres');
  const pendingItems = (input.pendingItems ?? []).map((p) => p.trim()).filter(Boolean);
  if (input.decision === 'pendencia' && pendingItems.length === 0) {
    throw APP_ERROR.BAD_REQUEST('Liste as pendências para devolver o processo');
  }

  const stepData = readStepData(process.stepDataJson);
  const form = formFromStepData(stepData);
  const catalog = buildCedenteDocumentCatalog(form);
  const docs = await prisma.document.findMany({ where: { partyId: process.partyId } });
  const current = currentDocumentsBySlot(docs);

  if (input.decision === 'favoravel') {
    const blocking = documentsBlockingApproval(catalog, current);
    if (blocking.length > 0) {
      throw APP_ERROR.BAD_REQUEST(
        `Valide todos os documentos antes do parecer favorável: ${blocking.join('; ')}`,
      );
    }
  }

  const reviewer = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: { name: true, email: true },
  });
  const reviewedAt = new Date();
  const pdf = await buildLegalOpinionPdf({
    legalName: process.party.legalName,
    cnpj: process.party.cpfCnpj,
    decision: input.decision,
    opinion,
    pendingItems,
    reviewerName: reviewer?.name ?? 'Jurídico',
    reviewerEmail: reviewer?.email ?? '',
    reviewedAt,
    documents: catalog
      .filter((slot) => current.has(slot.key))
      .map((slot) => ({ label: slot.label, status: current.get(slot.key)!.status })),
  });

  const opinionDoc = await prisma.document.create({
    data: {
      partyId: process.partyId,
      type: 'parecer_juridico',
      slot: 'parecer-juridico',
      fileName: `parecer-juridico-${reviewedAt.toISOString().slice(0, 10)}.pdf`,
      fileUri: '',
      hashSha256: sha256(pdf),
      mimeType: 'application/pdf',
      sizeBytes: pdf.length,
      status: 'aprovado',
      uploadedById: actor.userId,
      validatedById: actor.userId,
      validatedAt: reviewedAt,
    },
  });
  const key = buildObjectKey(process.partyId, 'parecer_juridico', opinionDoc.id);
  await saveFile(key, pdf);
  await prisma.document.update({
    where: { id: opinionDoc.id },
    data: { fileUri: fileUriForKey(key) },
  });

  await prisma.legalReview.create({
    data: {
      onboardingId: id,
      reviewerId: actor.userId,
      decision: input.decision,
      opinion,
      pendingItemsJson: pendingItems as Prisma.InputJsonValue,
      documentId: opinionDoc.id,
    },
  });

  if (input.decision === 'favoravel') {
    await transition(id, { stage: 'em_analise_compliance', step: CEDENTE_STEP.kycAml }, actor);
  } else if (input.decision === 'pendencia') {
    await transition(id, { stage: 'pendencia_juridica', step: CEDENTE_STEP.documentos }, actor);
  } else {
    await transition(
      id,
      {
        stage: 'rejeitado',
        step: CEDENTE_STEP.juridico,
        extra: { status: 'rejeitado', completedAt: new Date() },
      },
      actor,
    );
    await prisma.party.update({ where: { id: process.partyId }, data: { status: 'rejeitado' } });
  }

  await audit(actor, 'cedentes.onboarding.legal_review', id, {
    decision: input.decision,
    pendingItems,
    documentId: opinionDoc.id,
  });
  const nextStage: CedenteStage =
    input.decision === 'favoravel'
      ? 'em_analise_compliance'
      : input.decision === 'pendencia'
        ? 'pendencia_juridica'
        : 'rejeitado';
  await notifyStage(id, process.party.legalName, nextStage, `Parecer jurídico: ${input.decision}.`);
  return reloadCedenteOnboarding(id);
}

/** After fixing legal pending items: back to legal, or to re-signature if the form changed. */
export async function resubmitCedenteToLegal(id: string, actor: Actor) {
  const process = await findCedenteProcess(id);
  assertStage(process.cedenteStage, ['pendencia_juridica'], 'Reenvio ao jurídico');

  const stepData = readStepData(process.stepDataJson);
  const form = validatedForm(stepData);
  const docs = await prisma.document.findMany({ where: { partyId: process.partyId } });
  const current = currentDocumentsBySlot(docs);
  const missing = missingRequiredUploads(form, current.keys());
  if (missing.length > 0) {
    throw APP_ERROR.BAD_REQUEST(
      `Documentos obrigatórios pendentes: ${missing.map((m) => m.label).join(', ')}`,
    );
  }
  const rejected = [...current.values()].filter((d) => d.status === 'rejeitado');
  if (rejected.length > 0) {
    throw APP_ERROR.BAD_REQUEST('Substitua os documentos recusados antes de reenviar');
  }

  const formChanged =
    !stepData.generation || stepData.generation.formHash !== hashForm(formFromStepData(stepData));
  const resign =
    formChanged || extractSigners(form).some((s) => !current.has(`${s.key}-cartao-assinatura`));

  if (resign) {
    await transition(id, { stage: 'rascunho', step: CEDENTE_STEP.assinatura }, actor);
  } else {
    await transition(id, { stage: 'em_analise_juridica', step: CEDENTE_STEP.juridico }, actor);
    await notifyStage(id, process.party.legalName, 'em_analise_juridica', 'Pendências atendidas.');
  }
  await audit(actor, 'cedentes.onboarding.resubmit_legal', id, { resign });
  return reloadCedenteOnboarding(id);
}

// ---------------------------------------------------------------------------
// Steps 6–7: Compliance
// ---------------------------------------------------------------------------

export async function saveCedenteKycAml(
  id: string,
  input: { kyc: Required<KycFlags>; aml: { lawfulOriginDeclared: boolean } },
  actor: Actor,
) {
  const process = await findCedenteProcess(id);
  assertStage(process.cedenteStage, ['em_analise_compliance'], 'KYC/AML');
  if (!input.aml.lawfulOriginDeclared) {
    throw APP_ERROR.BAD_REQUEST('Declaração de origem lícita dos recursos é obrigatória');
  }

  const stepData: CedenteStepData = {
    ...readStepData(process.stepDataJson),
    kyc: input.kyc,
    aml: input.aml,
  };

  try {
    await applyKycScreening({
      processId: id,
      partyId: process.partyId,
      kyc: input.kyc,
      stepData,
      userId: actor.userId,
      rejectExtra: { cedenteStage: 'rejeitado', completedAt: new Date() },
    });
  } catch (err) {
    await prisma.party.update({ where: { id: process.partyId }, data: { status: 'rejeitado' } });
    await audit(actor, 'cedentes.onboarding.kyc_rejected', id, { kyc: input.kyc });
    throw err;
  }

  await transition(
    id,
    { stage: 'em_analise_compliance', step: CEDENTE_STEP.aprovacao, stepData },
    actor,
  );
  await audit(actor, 'cedentes.onboarding.kyc_aml', id, { kyc: input.kyc, aml: input.aml });
  return reloadCedenteOnboarding(id);
}

function bankCodeOf(banco: string): string {
  const code = banco.match(/\d{3}/)?.[0];
  return (code ?? banco).slice(0, 10);
}

export async function approveCedenteOnboarding(id: string, justification: string, actor: Actor) {
  const trimmed = justification.trim();
  if (!trimmed) throw APP_ERROR.BAD_REQUEST('Justificativa de aprovação é obrigatória');

  const process = await findCedenteProcess(id);
  assertStage(process.cedenteStage, ['em_analise_compliance'], 'Aprovação');
  const stepData = readStepData(process.stepDataJson);
  if (process.currentStep < CEDENTE_STEP.aprovacao || !stepData.kyc || !stepData.aml) {
    throw APP_ERROR.BAD_REQUEST('Registre o KYC/AML antes de aprovar');
  }

  const lastReview = await prisma.legalReview.findFirst({
    where: { onboardingId: id },
    orderBy: { createdAt: 'desc' },
  });
  if (!lastReview || lastReview.decision !== 'favoravel') {
    throw APP_ERROR.BAD_REQUEST('Aprovação exige parecer jurídico favorável');
  }
  const legalReviewers = await prisma.legalReview.findMany({
    where: { onboardingId: id },
    select: { reviewerId: true },
  });
  if (legalReviewers.some((r) => r.reviewerId === actor.userId)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Segregação de funções: quem emitiu o parecer jurídico não pode aprovar',
    });
  }

  const form = validatedForm(stepData);
  const catalog = buildCedenteDocumentCatalog(form);
  const docs = await prisma.document.findMany({ where: { partyId: process.partyId } });
  const blocking = documentsBlockingApproval(catalog, currentDocumentsBySlot(docs));
  if (blocking.length > 0) {
    throw APP_ERROR.BAD_REQUEST(`Documentos não aprovados: ${blocking.join('; ')}`);
  }

  const duplicate = await prisma.party.findFirst({
    where: { cpfCnpj: process.party.cpfCnpj, status: 'aprovado', id: { not: process.partyId } },
  });
  if (duplicate) throw APP_ERROR.CONFLICT('CNPJ duplicado');

  const empresa = cedenteEmpresaSchema.parse(stepData.pj?.empresa ?? {});
  const estrutura = cedenteEstruturaSchema.parse(stepData.pj?.estrutura ?? {});
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  const ownersPep = (estrutura.beneficiariosFinais ?? []).some((o) => o.pepFlag);
  const highRisk = process.party.pepFlag || ownersPep || empresa.politicallyExposed === 'sim';

  await prisma.$transaction(async (tx) => {
    await tx.party.update({
      where: { id: process.partyId },
      data: {
        status: 'aprovado',
        approvedAt: now,
        approvedBy: actor.userId,
        expiresAt,
        legalName: empresa.company,
        pepFlag: highRisk,
        riskLevel: highRisk ? 'alto' : process.party.riskLevel,
      },
    });

    await tx.partyContact.deleteMany({ where: { partyId: process.partyId } });
    await tx.partyContact.create({
      data: {
        partyId: process.partyId,
        email: empresa.email,
        phone: `+${empresa.ddi1} (${empresa.ddd1}) ${empresa.telefone1}`.slice(0, 30),
        isPrimary: true,
        addressJson: {
          logradouro: empresa.logradouro,
          numero: empresa.numero,
          complemento: empresa.complemento ?? null,
          bairro: empresa.bairro,
          cidade: empresa.cidade,
          estado: empresa.estado,
          cep: empresa.cep,
          pais: empresa.pais,
        },
      },
    });

    await tx.partyBankAccount.deleteMany({ where: { partyId: process.partyId } });
    for (const [index, conta] of (estrutura.contasBancarias ?? []).entries()) {
      await tx.partyBankAccount.create({
        data: {
          partyId: process.partyId,
          bankCode: bankCodeOf(conta.banco),
          branch: conta.agenciaNumero.slice(0, 10),
          account: `${conta.contaCorrente}-${conta.digito}`.slice(0, 20),
          accountType: 'corrente',
          isPrimary: index === 0,
          approvedBy: actor.userId,
          approvedAt: now,
        },
      });
    }

    await tx.partyBeneficialOwner.deleteMany({ where: { partyId: process.partyId } });
    for (const owner of estrutura.beneficiariosFinais ?? []) {
      await tx.partyBeneficialOwner.create({
        data: {
          partyId: process.partyId,
          ownerName: owner.nome,
          ownerCpfCnpj: digitsOnly(owner.cpfCnpj),
          ownershipPct: owner.participacaoPercentual,
          pepFlag: Boolean(owner.pepFlag),
        },
      });
    }

    await tx.cedente.upsert({
      where: { partyId: process.partyId },
      update: { juntaValidationStatus: 'pendente' },
      create: { partyId: process.partyId, juntaValidationStatus: 'pendente' },
    });

    await tx.onboardingProcess.update({
      where: { id },
      data: {
        status: 'aprovado',
        cedenteStage: 'aprovado',
        completedAt: now,
        currentStep: CEDENTE_STEP.aprovacao,
        approvalJustification: trimmed,
        approvedById: actor.userId,
      },
    });
    await tx.onboardingStep.updateMany({
      where: { processId: id },
      data: { status: 'concluido', completedAt: now },
    });
  });

  await audit(actor, 'cedentes.approve', id, { justification: trimmed, highRisk });
  await notifyStage(id, empresa.company, 'aprovado', 'Cedente aprovado pelo Compliance.');
  return reloadCedenteOnboarding(id);
}

export async function rejectCedenteOnboarding(id: string, reason: string, actor: Actor) {
  const trimmed = reason.trim();
  if (!trimmed) throw APP_ERROR.BAD_REQUEST('Informe o motivo da recusa');
  const process = await findCedenteProcess(id);
  if (process.cedenteStage && FINAL_STAGES.includes(process.cedenteStage)) {
    throw APP_ERROR.BAD_REQUEST('Processo já finalizado');
  }

  await prisma.$transaction(async (tx) => {
    await tx.onboardingProcess.update({
      where: { id },
      data: { status: 'rejeitado', cedenteStage: 'rejeitado', completedAt: new Date() },
    });
    await tx.party.update({ where: { id: process.partyId }, data: { status: 'rejeitado' } });
    await tx.signatureEnvelope.updateMany({
      where: { onboardingId: id, status: 'pendente' },
      data: { status: 'cancelado' },
    });
  });

  await audit(actor, 'cedentes.reject', id, { reason: trimmed });
  await notifyStage(id, process.party.legalName, 'rejeitado', `Motivo: ${trimmed}`);
  return reloadCedenteOnboarding(id);
}
