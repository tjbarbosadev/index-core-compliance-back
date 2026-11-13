import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fundFindMany: vi.fn(),
  fundFindFirst: vi.fn(),
  partyFindFirst: vi.fn(),
  subscriptionFindUnique: vi.fn(),
  subscriptionFindMany: vi.fn(),
  subscriptionCount: vi.fn(),
  redemptionFindMany: vi.fn(),
  linkFindUnique: vi.fn(),
  partyCreate: vi.fn(),
  cotistaCreate: vi.fn(),
  linkCreate: vi.fn(),
  linkUpdate: vi.fn(),
  subscriptionCreate: vi.fn(),
  backfill: vi.fn(),
  latestYield: vi.fn(),
  email: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('../db/index.js', () => ({
  prisma: {
    fund: { findMany: mocks.fundFindMany, findFirst: mocks.fundFindFirst },
    party: { findFirst: mocks.partyFindFirst },
    fimSubscription: {
      findUnique: mocks.subscriptionFindUnique,
      findMany: mocks.subscriptionFindMany,
      count: mocks.subscriptionCount,
    },
    fimRedemption: { findMany: mocks.redemptionFindMany },
    partyFundLink: { findUnique: mocks.linkFindUnique },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        party: { create: mocks.partyCreate },
        cotista: { create: mocks.cotistaCreate },
        partyContact: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
        partyFundLink: { create: mocks.linkCreate, update: mocks.linkUpdate },
        fimSubscription: {
          create: mocks.subscriptionCreate,
          findMany: mocks.subscriptionFindMany,
        },
        fimRedemption: { findMany: mocks.redemptionFindMany },
      }),
  },
}));

vi.mock('./cotista-yield.service.js', () => ({
  backfillPartyFundLinkYields: mocks.backfill,
  getLatestYieldOnOrBefore: mocks.latestYield,
}));

vi.mock('./email.service.js', () => ({
  sendFimSubscriptionNotice: mocks.email,
}));

vi.mock('./audit.service.js', () => ({
  logAudit: mocks.audit,
}));

import {
  parseFimSubscription,
  resolveYieldWindow,
  subscribeFim,
} from './fim-subscription.service.js';

const fundId = '22222222-2222-4222-8222-222222222222';
const partyId = '11111111-1111-4111-8111-111111111111';
const cotistaId = '33333333-3333-4333-8333-333333333333';
const linkId = '44444444-4444-4444-8444-444444444444';

const partner = { id: '55555555-5555-4555-8555-555555555555', name: 'Ipe Core' };

describe('parseFimSubscription', () => {
  it('accepts a CPF amount at the minimum', () => {
    const parsed = parseFimSubscription({
      name: 'Maria',
      document: '123.456.789-01',
      amountBrl: 100,
      externalId: 'bank-1',
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.input.document).toBe('12345678901');
  });

  it('accepts top-up amounts below 100 at parse time', () => {
    const parsed = parseFimSubscription({
      name: 'Maria',
      document: '12345678901',
      amountBrl: 50,
      externalId: 'bank-1',
    });
    expect(parsed.ok).toBe(true);
  });
});

describe('resolveYieldWindow', () => {
  const bounds = { contractStart: '2025-01-01', visualizationDate: '2026-06-30' };

  it('builds inclusive 30, 60 and 90 day windows ending on the visualization date', () => {
    expect(resolveYieldWindow({ ...bounds, days: '30' })).toMatchObject({
      ok: true,
      from: '2026-06-01',
      to: '2026-06-30',
    });
    expect(resolveYieldWindow({ ...bounds, days: '60' })).toMatchObject({
      ok: true,
      from: '2026-05-02',
      to: '2026-06-30',
    });
    expect(resolveYieldWindow({ ...bounds, days: '90' })).toMatchObject({
      ok: true,
      from: '2026-04-02',
      to: '2026-06-30',
    });
  });

  it('clips a chosen period to the contract start and the visualization date', () => {
    expect(
      resolveYieldWindow({
        contractStart: '2026-06-01',
        visualizationDate: '2026-06-30',
        from: '2026-05-01',
        to: '2026-07-15',
      }),
    ).toMatchObject({ ok: true, from: '2026-06-01', to: '2026-06-30' });
  });

  it('rejects mixing days with from/to', () => {
    expect(
      resolveYieldWindow({ ...bounds, days: '30', from: '2026-06-01', to: '2026-06-10' }).ok,
    ).toBe(false);
  });
});

describe('subscribeFim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fundFindMany.mockResolvedValue([{ id: fundId, modality: 'fim', status: 'ativo' }]);
    mocks.subscriptionFindUnique.mockResolvedValue(null);
    mocks.partyFindFirst.mockResolvedValue(null);
    mocks.partyCreate.mockResolvedValue({ id: partyId });
    mocks.cotistaCreate.mockResolvedValue({ id: cotistaId });
    mocks.linkCreate.mockResolvedValue({ id: linkId });
    mocks.subscriptionCreate.mockResolvedValue({ id: 'sub-1' });
    mocks.subscriptionFindMany.mockResolvedValue([
      {
        amount: 100,
        occurredOn: new Date('2026-06-01'),
        accruesOn: new Date('2026-06-01'),
        status: 'active',
      },
    ]);
    mocks.redemptionFindMany.mockResolvedValue([]);
    mocks.linkFindUnique.mockResolvedValue({
      id: linkId,
      initialInvestment: 100,
      contractStartDate: new Date('2026-06-01'),
    });
    mocks.latestYield.mockResolvedValue(null);
    mocks.backfill.mockResolvedValue(0);
    mocks.email.mockResolvedValue(true);
    mocks.audit.mockResolvedValue(undefined);
  });

  const body = {
    name: 'Maria',
    document: '12345678901',
    amountBrl: 100,
    externalId: 'bank-1',
  };

  it('creates an excluded-from-PL cotista and emails admins', async () => {
    const result = await subscribeFim({ partner, body });
    expect(mocks.partyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ excludeFromPl: true, cpfCnpj: '12345678901' }),
      }),
    );
    expect(mocks.email).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'created', amountBrl: 100 }),
    );
    expect(mocks.backfill).toHaveBeenCalledWith(linkId);
    expect(result.result).toBe('created');
    expect(result.totalContributed).toBe(100);
  });

  it('tops up the existing box and does not create another party', async () => {
    mocks.partyFindFirst.mockResolvedValue({
      id: partyId,
      cotista: { id: cotistaId },
      partyFundLinks: [{ id: linkId, fundId, quotaType: 'unica' }],
    });
    mocks.subscriptionFindMany.mockResolvedValue([
      {
        amount: 100,
        occurredOn: new Date('2026-06-01'),
        accruesOn: new Date('2026-06-01'),
        status: 'active',
      },
      {
        amount: 150,
        occurredOn: new Date('2026-06-03'),
        accruesOn: new Date('2026-06-03'),
        status: 'active',
      },
    ]);
    const result = await subscribeFim({
      partner,
      body: { ...body, externalId: 'bank-2', amountBrl: 50 },
    });
    expect(mocks.partyCreate).not.toHaveBeenCalled();
    expect(mocks.linkUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ initialInvestment: 250 }),
      }),
    );
    expect(result.result).toBe('toppedUp');
    expect(mocks.email).toHaveBeenCalled();
  });

  it('does not duplicate or email when externalId was already used', async () => {
    mocks.subscriptionFindUnique.mockResolvedValue({
      amount: 100,
      occurredOn: new Date('2026-06-01'),
      accruesOn: new Date('2026-06-01'),
      status: 'active',
      createdAt: new Date('2026-06-01'),
      partyFundLinkId: linkId,
      partyFundLink: { fundId, party: { cpfCnpj: '12345678901', legalName: 'Maria' } },
    });
    mocks.subscriptionCount.mockResolvedValue(0);
    const result = await subscribeFim({ partner, body });
    expect(mocks.partyCreate).not.toHaveBeenCalled();
    expect(mocks.subscriptionCreate).not.toHaveBeenCalled();
    expect(mocks.email).not.toHaveBeenCalled();
    expect(result.result).toBe('created');
    expect(result.amountBrl).toBe(100);
  });

  it('rejects first application below R$ 100', async () => {
    await expect(subscribeFim({ partner, body: { ...body, amountBrl: 50 } })).rejects.toMatchObject(
      { status: 400 },
    );
  });

  it('dry-run does not persist', async () => {
    const result = await subscribeFim({ partner, body, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.result).toBe('created');
    expect(mocks.partyCreate).not.toHaveBeenCalled();
    expect(mocks.subscriptionCreate).not.toHaveBeenCalled();
    expect(mocks.email).not.toHaveBeenCalled();
  });
});
