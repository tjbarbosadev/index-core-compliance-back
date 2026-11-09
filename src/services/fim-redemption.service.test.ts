import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  partyFindFirst: vi.fn(),
  redemptionFindUnique: vi.fn(),
  redemptionCreate: vi.fn(),
  subscriptionFindMany: vi.fn(),
  redemptionFindMany: vi.fn(),
  linkFindUnique: vi.fn(),
  backfill: vi.fn(),
  latestYield: vi.fn(),
  email: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('../db/index.js', () => ({
  prisma: {
    party: { findFirst: mocks.partyFindFirst },
    fimRedemption: {
      findUnique: mocks.redemptionFindUnique,
      create: mocks.redemptionCreate,
      findMany: mocks.redemptionFindMany,
    },
    fimSubscription: { findMany: mocks.subscriptionFindMany },
    partyFundLink: { findUnique: mocks.linkFindUnique },
  },
}));

vi.mock('./cotista-yield.service.js', () => ({
  backfillPartyFundLinkYields: mocks.backfill,
  getLatestYieldOnOrBefore: mocks.latestYield,
}));

vi.mock('./email.service.js', () => ({
  sendFimRedemptionNotice: mocks.email,
}));

vi.mock('./audit.service.js', () => ({
  logAudit: mocks.audit,
}));

vi.mock('./quota-calculator.js', async () => {
  const actual =
    await vi.importActual<typeof import('./quota-calculator.js')>('./quota-calculator.js');
  return {
    ...actual,
    todayYYYYMMDD: () => '2026-06-01',
    getVisualizationDate: () => actual.parseYYYYMMDD('2026-05-29'),
  };
});

import { parseFimRedemption, redeemFim } from './fim-redemption.service.js';
import { FimPartnerError } from './fim-subscription.service.js';

const fundId = '22222222-2222-4222-8222-222222222222';
const partyId = '11111111-1111-4111-8111-111111111111';
const cotistaId = '33333333-3333-4333-8333-333333333333';
const linkId = '44444444-4444-4444-8444-444444444444';
const partner = { id: '55555555-5555-4555-8555-555555555555', name: 'Ipe Core' };

describe('parseFimRedemption', () => {
  it('accepts a partial redeem amount', () => {
    const parsed = parseFimRedemption({
      document: '123.456.789-01',
      amountBrl: 149.9,
      externalId: 'bank-redeem-1',
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.input.document).toBe('12345678901');
      expect(parsed.input.amountBrl).toBe(149.9);
    }
  });

  it('rejects non-positive amounts', () => {
    expect(parseFimRedemption({ document: '12345678901', amountBrl: 0, externalId: 'x' }).ok).toBe(
      false,
    );
  });
});

describe('redeemFim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redemptionFindUnique.mockResolvedValue(null);
    mocks.partyFindFirst.mockResolvedValue({
      id: partyId,
      legalName: 'Maria',
      cotista: { id: cotistaId },
      partyFundLinks: [
        {
          id: linkId,
          fundId,
          quotaType: 'unica',
          linkedAt: new Date('2026-06-01'),
          contractStartDate: new Date('2026-06-01'),
          fund: { modality: 'fim' },
        },
      ],
    });
    mocks.subscriptionFindMany.mockResolvedValue([
      { amount: 1000, occurredOn: new Date('2026-06-01') },
    ]);
    mocks.redemptionFindMany.mockResolvedValue([]);
    mocks.linkFindUnique.mockResolvedValue({
      id: linkId,
      initialInvestment: 1000,
      contractStartDate: new Date('2026-06-01'),
    });
    mocks.latestYield.mockResolvedValue(null);
    mocks.backfill.mockResolvedValue(0);
    mocks.email.mockResolvedValue(true);
    mocks.audit.mockResolvedValue(undefined);
    mocks.redemptionCreate.mockResolvedValue({ id: 'red-1' });
  });

  const body = {
    document: '12345678901',
    amountBrl: 149.9,
    externalId: 'bank-redeem-1',
  };

  it('reserves the redeem, freezes until D+5 business days and emails admins', async () => {
    const result = await redeemFim({ partner, body });
    expect(mocks.redemptionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 149.9,
          status: 'pending',
        }),
      }),
    );
    expect(result.settlesOn).toBe('2026-06-08');
    expect(result.result).toBe('pending');
    expect(mocks.backfill).toHaveBeenCalledWith(linkId);
    expect(mocks.email).toHaveBeenCalled();
  });

  it('rejects when residual would fall below R$ 100', async () => {
    await expect(redeemFim({ partner, body: { ...body, amountBrl: 950 } })).rejects.toBeInstanceOf(
      FimPartnerError,
    );
    expect(mocks.redemptionCreate).not.toHaveBeenCalled();
  });

  it('is idempotent for the same externalId', async () => {
    mocks.redemptionFindUnique.mockResolvedValue({
      amount: 149.9,
      settlesOn: new Date('2026-06-08'),
      partyFundLink: { party: { cpfCnpj: '12345678901', legalName: 'Maria' } },
    });
    mocks.redemptionFindMany.mockResolvedValue([
      {
        amount: 149.9,
        status: 'pending',
        requestedOn: new Date('2026-06-01'),
        settlesOn: new Date('2026-06-08'),
      },
    ]);
    const result = await redeemFim({ partner, body });
    expect(mocks.redemptionCreate).not.toHaveBeenCalled();
    expect(mocks.email).not.toHaveBeenCalled();
    expect(result.amountBrl).toBe(149.9);
    expect(result.settlesOn).toBe('2026-06-08');
  });

  it('allows stacked pendings until the residual floor', async () => {
    mocks.redemptionFindMany.mockResolvedValue([
      {
        amount: 400,
        status: 'pending',
        requestedOn: new Date('2026-06-01'),
        settlesOn: new Date('2026-06-08'),
      },
    ]);
    const result = await redeemFim({
      partner,
      body: { ...body, amountBrl: 500, externalId: 'bank-redeem-2' },
    });
    expect(result.amountBrl).toBe(500);
    expect(mocks.redemptionCreate).toHaveBeenCalled();
  });
});
