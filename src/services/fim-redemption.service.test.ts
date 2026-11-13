import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  partyFindFirst: vi.fn(),
  redemptionFindUnique: vi.fn(),
  redemptionCreate: vi.fn(),
  getFimShareholder: vi.fn(),
  backfill: vi.fn(),
  email: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('../db/index.js', () => ({
  prisma: {
    party: { findFirst: mocks.partyFindFirst },
    fimRedemption: {
      findUnique: mocks.redemptionFindUnique,
      create: mocks.redemptionCreate,
    },
  },
}));

vi.mock('./fim-subscription.service.js', async () => {
  const actual = await vi.importActual<typeof import('./fim-subscription.service.js')>(
    './fim-subscription.service.js',
  );
  return {
    ...actual,
    getFimShareholder: mocks.getFimShareholder,
  };
});

vi.mock('./cotista-yield.service.js', () => ({
  backfillPartyFundLinkYields: mocks.backfill,
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
  };
});

import { parseFimRedemption, redeemFim } from './fim-redemption.service.js';
import { FimPartnerError } from './fim-subscription.service.js';

const fundId = '22222222-2222-4222-8222-222222222222';
const partyId = '11111111-1111-4111-8111-111111111111';
const cotistaId = '33333333-3333-4333-8333-333333333333';
const linkId = '44444444-4444-4444-8444-444444444444';
const partner = { id: '55555555-5555-4555-8555-555555555555', name: 'Ipe Core' };

const position = {
  name: 'Maria',
  document: '12345678901',
  totalContributed: 1000,
  quotaCount: 1000,
  balance: 1000,
  yieldDay: 0,
  yieldAccumulated: 0,
  startDate: '2026-06-01',
  visualizationDate: '2026-05-29',
  pendingRedemptionTotal: 0,
  availableToRedeem: 1000,
  frozenAmount: 0,
  frozenUntil: null,
  yielding: true,
};

describe('parseFimRedemption', () => {
  it('accepts a partial redeem amount', () => {
    const parsed = parseFimRedemption({
      document: '123.456.789-01',
      amountBrl: 149.9,
      externalId: 'bank-redeem-1',
    });
    expect(parsed.ok).toBe(true);
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
    mocks.getFimShareholder.mockResolvedValue(position);
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

  it('reserves from balance and settles on D+5 B3 (skips Corpus Christi)', async () => {
    const result = await redeemFim({ partner, body });
    // 2026-06-01 + 5 B3 days skips 2026-06-04 (Corpus Christi) → 2026-06-09
    expect(result.settlesOn).toBe('2026-06-09');
    expect(result.result).toBe('pending');
    expect(mocks.redemptionCreate).toHaveBeenCalled();
    expect(mocks.email).toHaveBeenCalled();
  });

  it('allows redeeming the full available balance', async () => {
    const result = await redeemFim({ partner, body: { ...body, amountBrl: 1000 } });
    expect(result.amountBrl).toBe(1000);
    expect(mocks.redemptionCreate).toHaveBeenCalled();
  });

  it('rejects when amount exceeds available balance', async () => {
    await expect(
      redeemFim({ partner, body: { ...body, amountBrl: 1000.01 } }),
    ).rejects.toBeInstanceOf(FimPartnerError);
    expect(mocks.redemptionCreate).not.toHaveBeenCalled();
  });

  it('dry-run does not persist', async () => {
    const result = await redeemFim({ partner, body, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.settlesOn).toBe('2026-06-09');
    expect(mocks.redemptionCreate).not.toHaveBeenCalled();
    expect(mocks.email).not.toHaveBeenCalled();
  });
});
