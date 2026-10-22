import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendCotistaAccessNotice: vi.fn(),
  logAudit: vi.fn(),
  getLatestYieldOnOrBefore: vi.fn(),
  listAmortizations: vi.fn(),
  backfillPartyFundLinkYields: vi.fn(),
  fundFindUnique: vi.fn(),
  partyFindFirst: vi.fn(),
  cotistaFindUnique: vi.fn(),
  partyCreate: vi.fn(),
  cotistaCreate: vi.fn(),
  partyContactCreate: vi.fn(),
  partyFundLinkCreate: vi.fn(),
}));

vi.mock('./email.service.js', () => ({
  sendCotistaAccessNotice: mocks.sendCotistaAccessNotice,
}));

vi.mock('./audit.service.js', () => ({
  logAudit: mocks.logAudit,
}));

vi.mock('./cotista-yield.service.js', () => ({
  getYieldForDate: vi.fn(),
  getLatestYieldOnOrBefore: mocks.getLatestYieldOnOrBefore,
  listAmortizations: mocks.listAmortizations,
  listYields: vi.fn(),
  backfillPartyFundLinkYields: mocks.backfillPartyFundLinkYields,
}));

vi.mock('../db/index.js', () => ({
  prisma: {
    fund: { findUnique: mocks.fundFindUnique },
    party: { findFirst: mocks.partyFindFirst },
    cotista: { findUnique: mocks.cotistaFindUnique },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        party: { create: mocks.partyCreate },
        cotista: { create: mocks.cotistaCreate },
        partyContact: { create: mocks.partyContactCreate },
        partyFundLink: { create: mocks.partyFundLinkCreate },
      }),
  },
}));

import { createCotista } from './cotista.service.js';

const fundId = '22222222-2222-4222-8222-222222222222';
const partyId = '11111111-1111-4111-8111-111111111111';
const cotistaId = '33333333-3333-4333-8333-333333333333';
const linkId = '44444444-4444-4444-8444-444444444444';

function storedCotista() {
  return {
    id: cotistaId,
    partyId,
    investorProfile: null,
    party: {
      fimApplicationId: null,
      legalName: 'Johnny',
      cpfCnpj: '12345678901',
      status: 'aprovado',
      type: 'pf',
      riskLevel: 'baixo',
      pepFlag: false,
      expiresAt: null,
      contacts: [],
      bankAccounts: [],
      documents: [],
      partyFundLinks: [
        {
          id: linkId,
          fundId,
          fund: { id: fundId, name: 'Fundo' },
          quotaType: 'senior_i',
          quotaCount: 1,
          initialInvestment: 1000,
          contractStartDate: null,
          contractEndDate: null,
          linkedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    },
  };
}

describe('createCotista access email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fundFindUnique.mockResolvedValue({ id: fundId });
    mocks.partyFindFirst.mockResolvedValue(null);
    mocks.partyCreate.mockResolvedValue({ id: partyId });
    mocks.cotistaCreate.mockResolvedValue({ id: cotistaId });
    mocks.partyContactCreate.mockResolvedValue({});
    mocks.partyFundLinkCreate.mockResolvedValue({});
    mocks.cotistaFindUnique.mockResolvedValue(storedCotista());
    mocks.getLatestYieldOnOrBefore.mockResolvedValue(null);
    mocks.listAmortizations.mockResolvedValue([]);
    mocks.backfillPartyFundLinkYields.mockResolvedValue(undefined);
    mocks.logAudit.mockResolvedValue(undefined);
    mocks.sendCotistaAccessNotice.mockResolvedValue(true);
  });

  const input = {
    legalName: 'Johnny',
    cpfCnpj: '123.456.789-01',
    positions: [{ fundId, quotaType: 'senior_i' as const, quotaCount: 1 }],
  };

  it('sends the access notice with the cotista name and email', async () => {
    const created = await createCotista({ ...input, email: 'johnny0024022@gmail.com' }, 'user-1');

    expect(created.id).toBe(cotistaId);
    expect(created.accessEmailSent).toBe(true);
    expect(mocks.sendCotistaAccessNotice).toHaveBeenCalledWith({
      to: 'johnny0024022@gmail.com',
      name: 'Johnny',
    });
  });

  it('does not treat a missing email as a failed cadastro', async () => {
    mocks.sendCotistaAccessNotice.mockResolvedValue(false);

    const created = await createCotista(input, 'user-1');

    expect(created.id).toBe(cotistaId);
    expect(created.accessEmailSent).toBe(false);
    expect(mocks.sendCotistaAccessNotice).toHaveBeenCalledWith({
      to: undefined,
      name: 'Johnny',
    });
  });

  it('still returns the cotista when the access email fails', async () => {
    mocks.sendCotistaAccessNotice.mockRejectedValue(new Error('resend down'));

    const created = await createCotista({ ...input, email: 'johnny0024022@gmail.com' }, 'user-1');

    expect(created.id).toBe(cotistaId);
    expect(created.accessEmailSent).toBe(false);
  });
});
