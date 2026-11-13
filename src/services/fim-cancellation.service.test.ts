import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  subscriptionFindUnique: vi.fn(),
  subscriptionUpdate: vi.fn(),
  redemptionFindUnique: vi.fn(),
  redemptionUpdate: vi.fn(),
  cotistaFindUnique: vi.fn(),
  backfill: vi.fn(),
  getFimShareholder: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('../db/index.js', () => ({
  prisma: {
    fimSubscription: {
      findUnique: mocks.subscriptionFindUnique,
      update: mocks.subscriptionUpdate,
    },
    fimRedemption: {
      findUnique: mocks.redemptionFindUnique,
      update: mocks.redemptionUpdate,
    },
    cotista: { findUnique: mocks.cotistaFindUnique },
  },
}));

vi.mock('./cotista-yield.service.js', () => ({
  backfillPartyFundLinkYields: mocks.backfill,
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

vi.mock('./audit.service.js', () => ({
  logAudit: mocks.audit,
}));

import { cancelFim, parseFimCancellation } from './fim-cancellation.service.js';
import { FimPartnerError } from './fim-subscription.service.js';

const partner = { id: '55555555-5555-4555-8555-555555555555', name: 'Ipe Core' };
const linkId = '44444444-4444-4444-8444-444444444444';
const partyId = '11111111-1111-4111-8111-111111111111';

describe('parseFimCancellation', () => {
  it('requires kind and externalId', () => {
    expect(parseFimCancellation({ externalId: 'x' }).ok).toBe(false);
    expect(parseFimCancellation({ kind: 'subscription' }).ok).toBe(false);
    const ok = parseFimCancellation({ externalId: 'bank-1', kind: 'redemption' });
    expect(ok.ok).toBe(true);
  });
});

describe('cancelFim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.backfill.mockResolvedValue(0);
    mocks.audit.mockResolvedValue(undefined);
    mocks.cotistaFindUnique.mockResolvedValue({ id: 'cotista-1' });
    mocks.getFimShareholder.mockResolvedValue({ document: '12345678901' });
  });

  it('cancels a pending subscription', async () => {
    mocks.subscriptionFindUnique.mockResolvedValue({
      id: 'sub-1',
      externalId: 'bank-1',
      amount: 100,
      status: 'pending',
      partyFundLinkId: linkId,
      partyFundLink: {
        partyId,
        party: { cpfCnpj: '12345678901' },
        fund: { modality: 'fim' },
      },
    });
    const result = await cancelFim({
      partner,
      body: { externalId: 'bank-1', kind: 'subscription' },
    });
    expect(result.result).toBe('cancelled');
    expect(mocks.subscriptionUpdate).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: { status: 'cancelled' },
    });
    expect(mocks.backfill).toHaveBeenCalledWith(linkId);
  });

  it('rejects cancelling an active subscription', async () => {
    mocks.subscriptionFindUnique.mockResolvedValue({
      id: 'sub-1',
      externalId: 'bank-1',
      amount: 100,
      status: 'active',
      partyFundLinkId: linkId,
      partyFundLink: {
        partyId,
        party: { cpfCnpj: '12345678901' },
        fund: { modality: 'fim' },
      },
    });
    await expect(
      cancelFim({ partner, body: { externalId: 'bank-1', kind: 'subscription' } }),
    ).rejects.toBeInstanceOf(FimPartnerError);
    expect(mocks.subscriptionUpdate).not.toHaveBeenCalled();
  });

  it('cancels a pending redemption', async () => {
    mocks.redemptionFindUnique.mockResolvedValue({
      id: 'red-1',
      externalId: 'bank-r1',
      amount: 50,
      status: 'pending',
      partyFundLinkId: linkId,
      partyFundLink: { partyId, party: { cpfCnpj: '12345678901' } },
    });
    const result = await cancelFim({
      partner,
      body: { externalId: 'bank-r1', kind: 'redemption' },
    });
    expect(result.result).toBe('cancelled');
    expect(mocks.redemptionUpdate).toHaveBeenCalled();
  });

  it('dry-run does not update', async () => {
    mocks.subscriptionFindUnique.mockResolvedValue({
      id: 'sub-1',
      externalId: 'bank-1',
      amount: 100,
      status: 'pending',
      partyFundLinkId: linkId,
      partyFundLink: {
        partyId,
        party: { cpfCnpj: '12345678901' },
        fund: { modality: 'fim' },
      },
    });
    const result = await cancelFim({
      partner,
      body: { externalId: 'bank-1', kind: 'subscription' },
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(mocks.subscriptionUpdate).not.toHaveBeenCalled();
  });
});
