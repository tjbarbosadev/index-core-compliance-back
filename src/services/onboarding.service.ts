import type { OnboardingKind, PartyType, Prisma, QuotaType } from '@prisma/client';
import { prisma } from '../db/index.js';
import { APP_ERROR } from '../lib/errors.js';
import { logAudit } from './audit.service.js';
import { mapCotistaFull } from './cotista.service.js';

type StepData = Record<string, unknown>;

export function buildSteps(currentStep: number) {
  return Array.from({ length: 6 }, (_, i) => {
    const stepNumber = i + 1;
    let status: 'pendente' | 'em_andamento' | 'concluido' = 'pendente';
    if (stepNumber < currentStep) status = 'concluido';
    else if (stepNumber === currentStep) status = 'em_andamento';
    return {
      stepNumber,
      status,
      completedAt: null as string | null,
      notes: undefined as string | undefined,
    };
  });
}

async function loadProcess(id: string, kind: OnboardingKind) {
  const process = await prisma.onboardingProcess.findFirst({
    where: { id, kind },
    include: {
      party: { include: { contacts: true } },
      fund: true,
      steps: { orderBy: { stepNumber: 'asc' } },
      suitabilityResponse: true,
    },
  });
  if (!process) return null;

  const docs = await prisma.document.findMany({
    where: { partyId: process.partyId },
    orderBy: { createdAt: 'desc' },
  });

  const stepData = (process.stepDataJson as StepData) ?? {};

  return {
    id: process.id,
    partyId: process.partyId,
    type: process.kind,
    partyType: process.party.type,
    cpfCnpj: process.party.cpfCnpj,
    legalName: process.party.legalName,
    fundId: process.fundId,
    fundName: process.fund.name,
    quotaType: process.quotaType ?? undefined,
    currentStep: process.currentStep,
    status: process.status,
    startedAt: process.startedAt.toISOString(),
    expiresAt: process.expiresAt?.toISOString(),
    steps:
      process.steps.length > 0
        ? process.steps.map((s) => ({
            stepNumber: s.stepNumber,
            status: s.status,
            completedAt: s.completedAt?.toISOString() ?? null,
            notes: s.notes ?? undefined,
          }))
        : buildSteps(process.currentStep),
    suitabilityAnswers: stepData.suitabilityAnswers as Record<string, number> | undefined,
    suitabilityProfile: process.suitabilityResponse?.resultProfile ?? stepData.suitabilityProfile,
    kyc: stepData.kyc as { pepFlag: boolean; restrictiveListHit: boolean } | undefined,
    aml: stepData.aml as { lawfulOriginDeclared: boolean } | undefined,
    documents: docs.map((d) => ({
      id: d.id,
      type: d.type,
      fileName: d.fileName,
      size: d.sizeBytes ?? 0,
      status: d.status,
    })),
  };
}

export async function listOnboardingProcesses(kind: OnboardingKind) {
  const items = await prisma.onboardingProcess.findMany({
    where: { kind },
    include: { party: true, fund: true },
    orderBy: { startedAt: 'desc' },
  });
  return Promise.all(items.map((p) => loadProcess(p.id, kind))).then((r) =>
    r.filter((x): x is NonNullable<typeof x> => x !== null),
  );
}

export async function getOnboardingById(id: string, kind: OnboardingKind) {
  return loadProcess(id, kind);
}

export async function createOnboarding(input: {
  partyType: PartyType;
  cpfCnpj: string;
  legalName: string;
  fundId: string;
  quotaType?: QuotaType;
  kind?: OnboardingKind;
}) {
  const kind = input.kind ?? 'cotista';
  const existing = await prisma.party.findUnique({ where: { cpfCnpj: input.cpfCnpj } });
  if (existing?.status === 'aprovado') {
    throw APP_ERROR.CONFLICT('CPF/CNPJ já cadastrado como aprovado');
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 90);

  const party =
    existing ??
    (await prisma.party.create({
      data: {
        type: input.partyType,
        cpfCnpj: input.cpfCnpj,
        legalName: input.legalName,
        status: 'pendente',
      },
    }));

  const process = await prisma.onboardingProcess.create({
    data: {
      kind,
      partyId: party.id,
      fundId: input.fundId,
      quotaType: input.quotaType,
      currentStep: 1,
      expiresAt,
      steps: {
        create: buildSteps(1).map((s) => ({
          stepNumber: s.stepNumber,
          status: s.status,
        })),
      },
    },
  });

  return loadProcess(process.id, kind);
}

export async function advanceOnboardingStep(
  id: string,
  kind: OnboardingKind,
  stepData: StepData,
  userId?: string,
) {
  const process = await prisma.onboardingProcess.findFirst({ where: { id, kind } });
  if (!process) throw APP_ERROR.NOT_FOUND('Onboarding');
  if (process.status !== 'em_andamento')
    throw APP_ERROR.BAD_REQUEST('Processo não está em andamento');
  if (process.expiresAt && process.expiresAt < new Date()) {
    throw APP_ERROR.ONBOARDING_EXPIRADO();
  }

  const prevStep = process.currentStep;
  if (prevStep > 1) {
    const prev = await prisma.onboardingStep.findUnique({
      where: { processId_stepNumber: { processId: id, stepNumber: prevStep - 1 } },
    });
    if (prev && prev.status !== 'concluido' && prevStep !== 1) {
      throw APP_ERROR.BAD_REQUEST('Conclua a etapa anterior antes de avançar');
    }
  }

  const mergedData = { ...(process.stepDataJson as StepData), ...stepData };
  let nextStep = process.currentStep;

  if (stepData.advance === true || stepData._advance === true) {
    await prisma.onboardingStep.updateMany({
      where: { processId: id, stepNumber: prevStep },
      data: { status: 'concluido', completedAt: new Date(), completedBy: userId },
    });
    nextStep = Math.min(prevStep + 1, 6);
    if (nextStep <= 6) {
      await prisma.onboardingStep.upsert({
        where: { processId_stepNumber: { processId: id, stepNumber: nextStep } },
        update: { status: 'em_andamento' },
        create: { processId: id, stepNumber: nextStep, status: 'em_andamento' },
      });
    }
  }

  if (stepData.suitabilityAnswers && stepData.suitabilityProfile) {
    await prisma.suitabilityResponse.upsert({
      where: { processId: id },
      update: {
        questionnaireJson: stepData.suitabilityAnswers as Prisma.InputJsonValue,
        resultProfile: stepData.suitabilityProfile as
          | 'conservador'
          | 'moderado'
          | 'arrojado'
          | 'agressivo',
      },
      create: {
        processId: id,
        questionnaireJson: stepData.suitabilityAnswers as Prisma.InputJsonValue,
        resultProfile: stepData.suitabilityProfile as
          | 'conservador'
          | 'moderado'
          | 'arrojado'
          | 'agressivo',
      },
    });
  }

  if (stepData.kyc && typeof stepData.kyc === 'object') {
    const kyc = stepData.kyc as { pepFlag?: boolean; restrictiveListHit?: boolean };
    if (kyc.restrictiveListHit) {
      await prisma.onboardingProcess.update({
        where: { id },
        data: { status: 'rejeitado', stepDataJson: mergedData as Prisma.InputJsonValue },
      });
      await prisma.complianceAlert.create({
        data: {
          type: 'lista_restritiva',
          severity: 'critica',
          entityType: 'onboarding_process',
          entityId: id,
          description: 'Lista restritiva identificada no KYC',
          createdById: userId,
        },
      });
      throw APP_ERROR.BAD_REQUEST('Rejeição automática — lista restritiva');
    }
    if (kyc.pepFlag) {
      await prisma.party.update({
        where: { id: process.partyId },
        data: { pepFlag: true, riskLevel: 'alto' },
      });
      await prisma.complianceAlert.create({
        data: {
          type: 'pep',
          severity: 'alta',
          entityType: 'onboarding_process',
          entityId: id,
          description: 'PEP identificado no onboarding',
          createdById: userId,
        },
      });
    }
  }

  const owners = stepData.beneficialOwners;
  if (Array.isArray(owners) && kind === 'cedente') {
    await prisma.partyBeneficialOwner.deleteMany({ where: { partyId: process.partyId } });
    for (const raw of owners) {
      const o = raw as {
        ownerName?: string;
        name?: string;
        ownerCpfCnpj?: string;
        cpfCnpj?: string;
        ownershipPct?: number;
        pepFlag?: boolean;
      };
      const ownerName = (o.ownerName ?? o.name ?? '').trim();
      const ownerCpfCnpj = (o.ownerCpfCnpj ?? o.cpfCnpj ?? '').trim();
      if (!ownerName || !ownerCpfCnpj) continue;
      await prisma.partyBeneficialOwner.create({
        data: {
          partyId: process.partyId,
          ownerName,
          ownerCpfCnpj,
          ownershipPct: Number(o.ownershipPct ?? 0),
          pepFlag: Boolean(o.pepFlag),
        },
      });
    }
  }

  await prisma.onboardingProcess.update({
    where: { id },
    data: {
      stepDataJson: mergedData as Prisma.InputJsonValue,
      currentStep: nextStep,
    },
  });

  return loadProcess(id, kind);
}

export async function approveOnboarding(
  id: string,
  kind: OnboardingKind,
  userId: string,
  ip?: string,
  justification?: string,
) {
  const trimmedJustification = justification?.trim() ?? '';
  if (!trimmedJustification) {
    throw APP_ERROR.BAD_REQUEST('Justificativa de aprovação é obrigatória');
  }
  const process = await prisma.onboardingProcess.findFirst({
    where: { id, kind },
    include: { party: true, fund: true, suitabilityResponse: true },
  });
  if (!process) throw APP_ERROR.NOT_FOUND('Onboarding');
  if (process.currentStep < 6)
    throw APP_ERROR.BAD_REQUEST('Conclua todas as etapas antes de aprovar');

  const duplicate = await prisma.party.findFirst({
    where: {
      cpfCnpj: process.party.cpfCnpj,
      status: 'aprovado',
      id: { not: process.partyId },
    },
  });
  if (duplicate) throw APP_ERROR.CONFLICT('CPF/CNPJ duplicado');

  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  await prisma.$transaction(async (tx) => {
    await tx.party.update({
      where: { id: process.partyId },
      data: {
        status: 'aprovado',
        approvedAt: new Date(),
        approvedBy: userId,
        expiresAt,
        riskLevel: process.party.pepFlag ? 'alto' : process.party.riskLevel,
      },
    });

    if (kind === 'cotista') {
      await tx.onboardingProcess.update({
        where: { id },
        data: {
          status: 'aprovado',
          completedAt: new Date(),
          currentStep: 6,
          approvalJustification: trimmedJustification,
          approvedById: userId,
        },
      });

      return { cotistaId: null as string | null };
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
        completedAt: new Date(),
        currentStep: 6,
        approvalJustification: trimmedJustification,
        approvedById: userId,
      },
    });

    return { cedentePartyId: process.partyId };
  });

  await logAudit({
    userId,
    action: kind === 'cotista' ? 'onboarding.approve' : 'cedentes.approve',
    entityType: 'onboarding_process',
    entityId: id,
    details: { justification: trimmedJustification },
    ipAddress: ip,
  });

  if (kind === 'cotista') {
    return loadProcess(id, kind);
  }

  return loadProcess(id, kind);
}

export type ConfirmDepositInput = {
  onboardingId: string;
  amount: number;
  proofUri?: string;
  quotaType?: QuotaType;
  quotaCount?: number;
  bankAccount?: {
    bankCode: string;
    branch: string;
    account: string;
    accountType?: string;
  };
};

export async function confirmDeposit(input: ConfirmDepositInput, userId: string, ip?: string) {
  if (!(input.amount > 0)) throw APP_ERROR.BAD_REQUEST('Valor do aporte deve ser positivo');

  const process = await prisma.onboardingProcess.findFirst({
    where: { id: input.onboardingId, kind: 'cotista' },
    include: { party: true, suitabilityResponse: true },
  });
  if (!process) throw APP_ERROR.NOT_FOUND('Onboarding');
  if (process.status !== 'aprovado') {
    throw APP_ERROR.BAD_REQUEST('Onboarding deve estar aprovado antes de confirmar depósito');
  }

  const existingCotista = await prisma.cotista.findUnique({
    where: { partyId: process.partyId },
  });
  if (existingCotista) {
    throw APP_ERROR.CONFLICT('Cotista já possui aporte confirmado para este cadastro');
  }

  const quotaType = input.quotaType ?? process.quotaType ?? 'senior_i';
  const quotaCount = input.quotaCount ?? 0;
  const now = new Date();

  const cotistaId = await prisma.$transaction(async (tx) => {
    const cotista = await tx.cotista.create({
      data: {
        partyId: process.partyId,
        investorProfile: process.suitabilityResponse?.resultProfile,
        suitabilityResult: process.suitabilityResponse?.resultProfile,
      },
    });

    await tx.partyFundLink.create({
      data: {
        partyId: process.partyId,
        fundId: process.fundId,
        quotaType,
        initialInvestment: input.amount,
        currentPrincipal: input.amount,
        quotaCount: quotaCount > 0 ? quotaCount : 0,
        quotaAmount: input.amount,
        contractStartDate: now,
      },
    });

    await tx.fundTransaction.create({
      data: {
        fundId: process.fundId,
        type: 'aporte',
        counterpartyKind: 'cotista',
        partyId: process.partyId,
        amount: input.amount,
        signedAmount: input.amount,
        description: 'Aporte inicial — confirmação de depósito',
        proofUri: input.proofUri ?? null,
        status: 'aprovado',
        occurredAt: now,
        createdById: userId,
      },
    });

    if (input.bankAccount) {
      await tx.partyBankAccount.deleteMany({ where: { partyId: process.partyId } });
      await tx.partyBankAccount.create({
        data: {
          partyId: process.partyId,
          bankCode: input.bankAccount.bankCode,
          branch: input.bankAccount.branch,
          account: input.bankAccount.account,
          accountType: input.bankAccount.accountType ?? 'corrente',
          isPrimary: true,
          approvedBy: userId,
          approvedAt: now,
        },
      });
    }

    return cotista.id;
  });

  await logAudit({
    userId,
    action: 'onboarding.confirm_deposit',
    entityType: 'onboarding_process',
    entityId: process.id,
    details: { amount: input.amount, cotistaId },
    ipAddress: ip,
  });

  try {
    const { ensureFimApplicationForParty } = await import('../lib/nextcorefim/fim-documents.js');
    await ensureFimApplicationForParty(process.partyId);
  } catch (err) {
    console.warn('[onboarding.confirmDeposit] ensure FIM application failed (non-fatal):', err);
  }

  try {
    const { backfillPartyFundLinkYields } = await import('./cotista-yield.service.js');
    const link = await prisma.partyFundLink.findFirst({
      where: { partyId: process.partyId, fundId: process.fundId, quotaType },
    });
    if (link) await backfillPartyFundLinkYields(link.id);
  } catch (err) {
    console.warn('[onboarding.confirmDeposit] backfill yields failed (non-fatal):', err);
  }

  try {
    const { maybeAlertFragmentedAportes } = await import('./transaction-alerts.service.js');
    await maybeAlertFragmentedAportes(process.partyId, process.fundId, userId);
  } catch (err) {
    console.warn('[onboarding.confirmDeposit] fragmented alert failed (non-fatal):', err);
  }

  const cotista = await mapCotistaFull(cotistaId);
  return { cotista };
}

export async function rejectOnboarding(
  id: string,
  kind: OnboardingKind,
  reason: string,
  userId: string,
  ip?: string,
) {
  await prisma.onboardingProcess.update({
    where: { id },
    data: { status: 'rejeitado', completedAt: new Date() },
  });

  await logAudit({
    userId,
    action: kind === 'cotista' ? 'onboarding.reject' : 'cedentes.reject',
    entityType: 'onboarding_process',
    entityId: id,
    details: { reason },
    ipAddress: ip,
  });

  return loadProcess(id, kind);
}

export async function advanceFromWebPayload(
  id: string,
  kind: OnboardingKind,
  payload: Record<string, unknown>,
  userId?: string,
) {
  const current = await prisma.onboardingProcess.findFirst({ where: { id, kind } });
  if (!current) throw APP_ERROR.NOT_FOUND('Onboarding');

  const payloadStep =
    typeof payload.currentStep === 'number' ? payload.currentStep : current.currentStep;
  const shouldAdvance = payloadStep > current.currentStep;

  const rest = { ...payload };
  delete rest.id;
  delete rest.steps;
  delete rest.startedAt;
  delete rest.status;
  delete rest.fundName;
  delete rest.type;

  return advanceOnboardingStep(id, kind, { ...rest, advance: shouldAdvance }, userId);
}
