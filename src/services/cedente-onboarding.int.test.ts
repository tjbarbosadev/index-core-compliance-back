import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const zapsign = vi.hoisted(() => ({
  createZapSignDocument: vi.fn(),
  getZapSignDocument: vi.fn(),
  downloadZapSignFile: vi.fn(),
}));
vi.mock('../lib/zapsign/client.js', () => zapsign);
vi.mock('../lib/cedente/pdf/docx-to-pdf.js', () => ({
  docxToPdf: vi.fn(async (_docx: Uint8Array, name: string) => Buffer.from(`%PDF-1.4 ${name}`)),
}));

import { prisma } from '../db/index.js';
import { empresaFixture, estruturaFixture } from '../lib/cedente/cedente-form.fixture.js';
import { keyFromFileUri, saveFile } from '../lib/storage.js';
import {
  applyZapSignDocumentState,
  approveCedenteOnboarding,
  confirmCedenteDocumentUpload,
  createCedenteOnboarding,
  generateCedenteDocuments,
  getCedenteOnboarding,
  requestCedenteDocumentUpload,
  resubmitCedenteToLegal,
  saveCedenteKycAml,
  saveCedenteSection,
  sendCedenteForSignature,
  submitCedenteDocuments,
  submitLegalReview,
  validateCedenteDocument,
  type CedenteOnboardingDetail,
} from './cedente-onboarding.service.js';

let operator: { userId: string };
let legal: { userId: string };
let compliance: { userId: string };
let fundId: string;

function validCnpj(): string {
  const base = Array.from({ length: 12 }, () => randomInt(10));
  const digit = (nums: number[]) => {
    const weights =
      nums.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = nums.reduce((acc, n, i) => acc + n * weights[i]!, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const d1 = digit(base);
  const d2 = digit([...base, d1]);
  return [...base, d1, d2].join('');
}

async function createUser(label: string) {
  const user = await prisma.user.create({
    data: { email: `${label}-${randomUUID()}@example.com`, name: label },
  });
  return { userId: user.id };
}

async function upload(p: CedenteOnboardingDetail, slot: string, content = `file ${slot}`) {
  const { documentId } = await requestCedenteDocumentUpload(
    p.id,
    { slot, fileName: `${slot}.pdf`, mimeType: 'application/pdf', size: content.length },
    operator,
  );
  const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
  await saveFile(keyFromFileUri(doc.fileUri), Buffer.from(content));
  return confirmCedenteDocumentUpload(p.id, documentId, operator);
}

/** Walks form → uploads → PDFs until the envelopes are sent to ZapSign. */
async function onboardingSentForSignature() {
  const cnpj = validCnpj();
  let p = await createCedenteOnboarding(
    { cnpj, legalName: 'Cedente Integração LTDA', fundId },
    operator,
  );
  p = await saveCedenteSection(
    p.id,
    'empresa',
    { ...empresaFixture, cnpj, company: 'Cedente Integração LTDA' },
    { advance: true },
    operator,
  );
  p = await saveCedenteSection(p.id, 'estrutura', estruturaFixture, { advance: true }, operator);
  expect(p.currentStep).toBe(3);

  for (const slot of p.documentSlots.filter((s) => s.source === 'upload' && s.required)) {
    p = await upload(p, slot.key);
  }
  p = await submitCedenteDocuments(p.id, operator);
  p = await generateCedenteDocuments(p.id, operator);
  p = await sendCedenteForSignature(p.id, operator);
  expect(p.cedenteStage).toBe('aguardando_assinatura');
  return p;
}

/** Signs every envelope so the process awaits the legal review. */
async function onboardingAwaitingLegal() {
  const p = await onboardingSentForSignature();
  for (const envelope of p.signatureEnvelopes) {
    await applyZapSignDocumentState({
      token: envelope.externalToken,
      status: 'signed',
      signed_file: 'https://zapsign.example/signed.pdf',
    });
  }
  return (await getCedenteOnboarding(p.id))!;
}

async function approveAllDocuments(p: CedenteOnboardingDetail) {
  for (const slot of p.documentSlots.filter((s) => s.document)) {
    p = await validateCedenteDocument(
      p.id,
      { documentId: slot.document!.id, approved: true },
      legal,
    );
  }
  return p;
}

beforeAll(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE parties, funds, users, audit_logs, compliance_alerts CASCADE',
  );
  operator = await createUser('operacional');
  legal = await createUser('juridico');
  compliance = await createUser('compliance');
  const fund = await prisma.fund.create({
    data: { name: 'FIDC Integração', cnpj: validCnpj(), modality: 'fidc' },
  });
  fundId = fund.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(() => {
  let seq = 0;
  zapsign.createZapSignDocument.mockImplementation(async (input: { signers: unknown[] }) => ({
    token: `zap-${randomUUID()}-${seq++}`,
    name: 'doc',
    status: 'pending',
    sandbox: true,
    signers: (input.signers as { name: string; email: string }[]).map((s, i) => ({
      token: `signer-${i}`,
      sign_url: 'https://zapsign.example/sign',
      status: 'new',
      name: s.name,
      email: 'qa@example.com',
    })),
  }));
  zapsign.downloadZapSignFile.mockResolvedValue(Buffer.from('%PDF-1.4 signed'));
});

describe('cedente PJ onboarding (integration)', () => {
  it('runs form → signature → legal → compliance and creates the cedente', async () => {
    let p = await onboardingAwaitingLegal();
    expect(p.cedenteStage).toBe('em_analise_juridica');
    expect(p.currentStep).toBe(5);
    expect(p.signatureEnvelopes.every((e) => e.status === 'assinado')).toBe(true);
    expect(zapsign.createZapSignDocument).toHaveBeenCalledTimes(3);

    const ficha = p.documentSlots.find((s) => s.key === 'ficha-cadastral-pj')!.document!;
    expect(ficha.fileName).toBe('ficha-cadastral-pj-assinado.pdf');

    await expect(
      submitLegalReview(p.id, { decision: 'favoravel', opinion: 'Parecer favorável' }, legal),
    ).rejects.toThrow(/Valide todos os documentos/);

    p = await approveAllDocuments(p);
    p = await submitLegalReview(
      p.id,
      { decision: 'favoravel', opinion: 'Documentação societária conferida.' },
      legal,
    );
    expect(p.cedenteStage).toBe('em_analise_compliance');
    expect(p.legalReviews).toHaveLength(1);
    const opinionDoc = await prisma.document.findFirstOrThrow({
      where: { partyId: p.partyId, type: 'parecer_juridico' },
    });
    expect(opinionDoc.hashSha256).toHaveLength(64);

    p = await saveCedenteKycAml(
      p.id,
      { kyc: { pepFlag: false, restrictiveListHit: false }, aml: { lawfulOriginDeclared: true } },
      compliance,
    );
    expect(p.currentStep).toBe(7);

    await expect(approveCedenteOnboarding(p.id, 'Aprovado', legal)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    p = await approveCedenteOnboarding(p.id, 'Aprovado após parecer favorável', compliance);
    expect(p.cedenteStage).toBe('aprovado');

    const party = await prisma.party.findUniqueOrThrow({
      where: { id: p.partyId },
      include: { cedente: true, bankAccounts: true, beneficialOwners: true },
    });
    expect(party.status).toBe('aprovado');
    expect(party.cedente?.juntaValidationStatus).toBe('pendente');
    expect(party.bankAccounts).toHaveLength(1);
    expect(party.beneficialOwners).toHaveLength(1);

    const actions = await prisma.auditLog.findMany({
      where: { entityId: p.id },
      select: { action: true },
    });
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'cedentes.onboarding.create',
        'cedentes.onboarding.send_signature',
        'cedentes.onboarding.all_signed',
        'cedentes.onboarding.legal_review',
        'cedentes.approve',
      ]),
    );
  });

  it('returns to documents on a pendência and back to legal after the fix', async () => {
    let p = await onboardingAwaitingLegal();
    const address = p.documentSlots.find((s) => s.key === 'comprovante-endereco-empresa')!;
    p = await validateCedenteDocument(
      p.id,
      { documentId: address.document!.id, approved: false, reason: 'Ilegível' },
      legal,
    );
    p = await submitLegalReview(
      p.id,
      {
        decision: 'pendencia',
        opinion: 'Comprovante de endereço ilegível.',
        pendingItems: ['Reenviar comprovante de endereço'],
      },
      legal,
    );
    expect(p.cedenteStage).toBe('pendencia_juridica');
    expect(p.currentStep).toBe(3);

    await expect(resubmitCedenteToLegal(p.id, operator)).rejects.toThrow(
      'Substitua os documentos recusados',
    );

    p = await upload(p, 'comprovante-endereco-empresa', 'new legible proof');
    p = await resubmitCedenteToLegal(p.id, operator);
    expect(p.cedenteStage).toBe('em_analise_juridica');
  });

  it('requires new signatures when the form changes during a pendência', async () => {
    let p = await onboardingAwaitingLegal();
    p = await submitLegalReview(
      p.id,
      {
        decision: 'pendencia',
        opinion: 'Conta bancária divergente do contrato.',
        pendingItems: ['Corrigir conta bancária'],
      },
      legal,
    );
    p = await saveCedenteSection(
      p.id,
      'estrutura',
      {
        ...estruturaFixture,
        contasBancarias: [{ ...estruturaFixture.contasBancarias[0], contaCorrente: '654321' }],
      },
      { advance: true },
      operator,
    );
    expect(p.generation?.formChangedSinceGeneration).toBe(true);

    p = await resubmitCedenteToLegal(p.id, operator);
    expect(p.cedenteStage).toBe('rascunho');
    expect(p.currentStep).toBe(4);
  });

  it('goes back to draft when a signer refuses in ZapSign', async () => {
    const sent = await onboardingSentForSignature();
    await applyZapSignDocumentState({
      token: sent.signatureEnvelopes[0]!.externalToken,
      status: 'refused',
    });
    const refused = (await getCedenteOnboarding(sent.id))!;
    expect(refused.cedenteStage).toBe('rascunho');
    expect(refused.signatureEnvelopes.map((e) => e.status).sort()).toEqual([
      'cancelado',
      'cancelado',
      'recusado',
    ]);

    await generateCedenteDocuments(sent.id, operator);
    const resent = await sendCedenteForSignature(sent.id, operator);
    expect(resent.cedenteStage).toBe('aguardando_assinatura');
  });
});
