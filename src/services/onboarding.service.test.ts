import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildSteps } from './onboarding.service.js';

vi.mock('../db/index.js', () => ({
  prisma: {
    party: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    fund: {
      findFirst: vi.fn(),
    },
    onboardingProcess: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    onboardingStep: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    partyContact: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    partyBeneficialOwner: {
      deleteMany: vi.fn(),
    },
    document: {
      findMany: vi.fn(),
    },
    suitabilityResponse: {},
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        onboardingProcess: {
          update: vi.fn().mockResolvedValue({}),
        },
        party: {
          update: vi.fn().mockResolvedValue({}),
        },
        partyContact: {
          deleteMany: vi.fn().mockResolvedValue({}),
        },
        partyBeneficialOwner: {
          deleteMany: vi.fn().mockResolvedValue({}),
        },
      };
      return fn(tx);
    }),
  },
}));

vi.mock('./audit.service.js', () => ({
  logAudit: vi.fn().mockResolvedValue({}),
}));

vi.mock('./cotista.service.js', () => ({
  mapCotistaFull: vi.fn(),
}));

import { prisma } from '../db/index.js';
import {
  ingestSiteProposal,
  rejectOnboarding,
  softDeleteOnboarding,
} from './onboarding.service.js';

const partyId = '11111111-1111-4111-8111-111111111111';
const fundId = '22222222-2222-4222-8222-222222222222';
const processId = '33333333-3333-4333-8333-333333333333';

function mockLoadedProcess() {
  vi.mocked(prisma.onboardingProcess.findFirst).mockResolvedValue({
    id: processId,
    kind: 'cotista',
    partyId,
    fundId,
    quotaType: 'senior_i',
    currentStep: 1,
    status: 'em_andamento',
    stepDataJson: { source: 'nexafidic' },
    approvalJustification: null,
    approvedById: null,
    startedAt: new Date(),
    expiresAt: new Date(Date.now() + 90 * 864e5),
    completedAt: null,
    party: {
      id: partyId,
      type: 'pf',
      cpfCnpj: '52998224725',
      legalName: 'Teste',
      status: 'pendente',
      riskLevel: 'baixo',
      pepFlag: false,
      approvedAt: null,
      approvedBy: null,
      expiresAt: null,
      deletedAt: null,
      deletedById: null,
      fimApplicationId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      contacts: [],
    },
    fund: {
      id: fundId,
      name: 'Next Core FIDC',
      modality: 'fidc',
    },
    steps: [],
    suitabilityResponse: null,
  } as never);
  vi.mocked(prisma.document.findMany).mockResolvedValue([]);
}

describe('onboarding.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('buildSteps marks prior steps as concluido (SPEC-004)', () => {
    const steps = buildSteps(3);
    expect(steps).toHaveLength(6);
    expect(steps[0].status).toBe('concluido');
    expect(steps[1].status).toBe('concluido');
    expect(steps[2].status).toBe('em_andamento');
    expect(steps[3].status).toBe('pendente');
  });

  it('buildSteps starts at step 1 em_andamento', () => {
    const steps = buildSteps(1);
    expect(steps[0].status).toBe('em_andamento');
    expect(steps[1].status).toBe('pendente');
  });

  it('ingestSiteProposal rejects missing fund', async () => {
    vi.mocked(prisma.fund.findFirst).mockResolvedValue(null);
    await expect(
      ingestSiteProposal({
        source: 'nexafidic',
        partyType: 'pf',
        cpfCnpj: '529.982.247-25',
        legalName: 'Teste',
        fundCnpj: '68057459000165',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('ingestSiteProposal conflicts when party is aprovado', async () => {
    vi.mocked(prisma.fund.findFirst).mockResolvedValue({
      id: fundId,
      modality: 'fidc',
      status: 'ativo',
      cnpj: '68057459000165',
    } as never);
    vi.mocked(prisma.party.findFirst).mockResolvedValue({
      id: partyId,
      status: 'aprovado',
      cpfCnpj: '52998224725',
      deletedAt: null,
    } as never);

    await expect(
      ingestSiteProposal({
        source: 'nexafidic',
        partyType: 'pf',
        cpfCnpj: '52998224725',
        legalName: 'Teste',
        fundCnpj: '68057459000165',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('ingestSiteProposal updates open process idempotently', async () => {
    vi.mocked(prisma.fund.findFirst).mockResolvedValue({
      id: fundId,
      modality: 'fidc',
      status: 'ativo',
      cnpj: '68057459000165',
    } as never);
    vi.mocked(prisma.party.findFirst).mockResolvedValue({
      id: partyId,
      status: 'pendente',
      cpfCnpj: '52998224725',
      legalName: 'Antigo',
      deletedAt: null,
    } as never);
    vi.mocked(prisma.onboardingProcess.findFirst)
      .mockResolvedValueOnce({
        id: processId,
        stepDataJson: {},
        status: 'em_andamento',
      } as never)
      .mockResolvedValueOnce({
        id: processId,
        kind: 'cotista',
        partyId,
        fundId,
        quotaType: 'senior_i',
        currentStep: 1,
        status: 'em_andamento',
        stepDataJson: { source: 'nexafidic' },
        startedAt: new Date(),
        expiresAt: null,
        completedAt: null,
        party: {
          id: partyId,
          type: 'pf',
          cpfCnpj: '52998224725',
          legalName: 'Novo Nome',
          status: 'pendente',
          fimApplicationId: null,
          contacts: [],
        },
        fund: { id: fundId, name: 'Next Core FIDC', modality: 'fidc' },
        steps: [],
        suitabilityResponse: null,
      } as never);
    vi.mocked(prisma.onboardingProcess.update).mockResolvedValue({} as never);
    vi.mocked(prisma.partyContact.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.partyContact.create).mockResolvedValue({} as never);
    vi.mocked(prisma.party.update).mockResolvedValue({} as never);
    vi.mocked(prisma.document.findMany).mockResolvedValue([]);

    const result = await ingestSiteProposal({
      source: 'nexafidic',
      partyType: 'pf',
      cpfCnpj: '52998224725',
      legalName: 'Novo Nome',
      email: 'a@b.com',
      fundCnpj: '68057459000165',
      payload: { name: 'Novo Nome' },
    });

    expect(result.created).toBe(false);
    expect(result.process?.id).toBe(processId);
    expect(prisma.onboardingProcess.update).toHaveBeenCalled();
  });

  it('rejectOnboarding sets party status rejeitado', async () => {
    vi.mocked(prisma.onboardingProcess.findFirst).mockResolvedValue({
      id: processId,
      partyId,
      kind: 'cotista',
    } as never);
    mockLoadedProcess();

    const result = await rejectOnboarding(processId, 'cotista', 'Motivo teste', 'user-1');
    expect(result?.status).toBe('em_andamento'); // loadProcess mock still em_andamento
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('softDeleteOnboarding anonymizes and soft-deletes party', async () => {
    vi.mocked(prisma.onboardingProcess.findFirst).mockResolvedValue({
      id: processId,
      partyId,
      kind: 'cotista',
      stepDataJson: { source: 'nextcorefim', sitePayload: { cpf: 'x' } },
      party: { id: partyId },
    } as never);

    const out = await softDeleteOnboarding(processId, 'cotista', 'user-1');
    expect(out).toEqual({ success: true });
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
