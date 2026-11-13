import { prisma } from '../db/index.js';
import {
  addDays,
  fimChunkEnd,
  generateDailyYields,
  generateFimYieldChunk,
  getVisualizationDate,
  type FimContribution,
  type FimFreezeWindow,
  type FimSettlement,
  mapDataJsonQuota,
  toYYYYMMDD,
  parseYYYYMMDD,
  type FimYieldState,
  type YieldQuotaType,
} from './quota-calculator.js';
import { getSelicMapForRange, resolveSelicForDate, type SelicEntry } from './selic.service.js';

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

async function syncFimLinkPrincipal(partyFundLinkId: string): Promise<number> {
  const [subscriptions, settled] = await Promise.all([
    prisma.fimSubscription.findMany({ where: { partyFundLinkId } }),
    prisma.fimRedemption.findMany({ where: { partyFundLinkId, status: 'settled' } }),
  ]);
  const gross = subscriptions.reduce((sum, row) => sum + Number(row.amount), 0);
  const redeemed = settled.reduce((sum, row) => sum + Number(row.amount), 0);
  const total = money(gross - redeemed);
  await prisma.partyFundLink.update({
    where: { id: partyFundLinkId },
    data: {
      initialInvestment: total,
      currentPrincipal: total,
      quotaAmount: total,
      quotaCount: Math.round(total),
    },
  });
  return total;
}

async function settleDueFimRedemptions(partyFundLinkId: string, asOfDate: string): Promise<void> {
  const result = await prisma.fimRedemption.updateMany({
    where: {
      partyFundLinkId,
      status: 'pending',
      settlesOn: { lte: parseYYYYMMDD(asOfDate) },
    },
    data: { status: 'settled' },
  });
  if (result.count > 0) {
    await syncFimLinkPrincipal(partyFundLinkId);
  }
}

function asYieldQuota(quotaType: string): YieldQuotaType {
  if (quotaType === 'senior_i' || quotaType === 'senior_ii') return quotaType;
  if (quotaType === 'senior') return 'senior_i';
  const mapped = mapDataJsonQuota(quotaType);
  if (mapped === 'unica') {
    throw new Error('Cota única do FIM não usa o motor sênior');
  }
  return mapped;
}

function investmentOf(link: {
  initialInvestment: { toString(): string } | number | null;
  currentPrincipal: { toString(): string } | number | null;
  quotaAmount: { toString(): string } | number | null;
}): number {
  return Number(link.initialInvestment || link.currentPrincipal || link.quotaAmount);
}

async function fimTaxBasis(partyFundLinkId: string, investment: number): Promise<number> {
  const last = await prisma.cotistaAmortization.findFirst({
    where: { partyFundLinkId, kind: 'come_cotas' },
    orderBy: { occurredOn: 'desc' },
  });
  if (!last) return investment;
  const row = await prisma.cotistaDailyYield.findUnique({
    where: {
      partyFundLinkId_referenceDate: {
        partyFundLinkId,
        referenceDate: last.occurredOn,
      },
    },
  });
  return row ? Number(row.balanceTotal) : investment;
}

/** Grava a projeção do FIM em blocos curtos. `fromStart` reescreve desde a cotização. */
async function writeFimLinkYields(
  link: {
    id: string;
    contractStartDate: Date | null;
    contractEndDate: Date | null;
    initialInvestment: { toString(): string } | number | null;
    currentPrincipal: { toString(): string } | number | null;
    quotaAmount: { toString(): string } | number | null;
  },
  opts: { fromStart: boolean; endDate?: string },
): Promise<number> {
  if (!link.contractStartDate) return 0;
  const initial = toYYYYMMDD(link.contractStartDate);
  const finalContract = link.contractEndDate ? toYYYYMMDD(link.contractEndDate) : null;
  const viz = opts.endDate ?? toYYYYMMDD(getVisualizationDate());
  let end = viz;
  if (finalContract && finalContract < end) end = finalContract;
  if (initial > end) return 0;

  const investment = investmentOf(link);
  let cursor = initial;
  let opening: FimYieldState = {
    balance: investment,
    taxBasis: investment,
    yieldAccumulated: 0,
  };
  let accrueFromFirstDay = false;

  if (!opts.fromStart) {
    const last = await prisma.cotistaDailyYield.findFirst({
      where: { partyFundLinkId: link.id },
      orderBy: { referenceDate: 'desc' },
    });
    if (last) {
      const lastStr = toYYYYMMDD(last.referenceDate);
      if (lastStr >= end) return 0;
      cursor = toYYYYMMDD(addDays(parseYYYYMMDD(lastStr), 1));
      opening = {
        balance: Number(last.balanceTotal),
        taxBasis: await fimTaxBasis(link.id, investment),
        yieldAccumulated: Number(last.yieldAccumulated),
      };
      accrueFromFirstDay = true;
    }
  }

  if (cursor > end) return 0;

  await prisma.fimSubscription.updateMany({
    where: {
      partyFundLinkId: link.id,
      status: 'pending',
      accruesOn: { lte: parseYYYYMMDD(end) },
    },
    data: { status: 'active' },
  });

  const storedContributions = await prisma.fimSubscription.findMany({
    where: {
      partyFundLinkId: link.id,
      status: { in: ['pending', 'active'] },
      accruesOn: { lte: parseYYYYMMDD(end) },
    },
    orderBy: { accruesOn: 'asc' },
  });
  const storedRedemptions = await prisma.fimRedemption.findMany({
    where: {
      partyFundLinkId: link.id,
      status: { in: ['pending', 'settled'] },
    },
    orderBy: { requestedOn: 'asc' },
  });
  const contributions: FimContribution[] =
    storedContributions.length > 0
      ? storedContributions.map((row) => ({
          date: toYYYYMMDD(row.accruesOn),
          amount: Number(row.amount),
        }))
      : [];
  const freezeWindows: FimFreezeWindow[] = storedRedemptions.map((row) => ({
    from: toYYYYMMDD(row.requestedOn),
    toExclusive: toYYYYMMDD(row.settlesOn),
    amount: Number(row.amount),
  }));
  const settlements: FimSettlement[] = storedRedemptions.map((row) => ({
    date: toYYYYMMDD(row.settlesOn),
    amount: Number(row.amount),
  }));
  const hasCashflows =
    contributions.length > 0 || freezeWindows.length > 0 || settlements.length > 0;

  const selicMap = await getSelicMapForRange(cursor, end);
  const getSelicForDate = (dateStr: string): SelicEntry => resolveSelicForDate(selicMap, dateStr);
  let written = 0;

  while (cursor <= end) {
    const chunkEnd = fimChunkEnd(cursor, end);
    const { days, closing } = generateFimYieldChunk({
      investment,
      fromDate: cursor,
      endDate: chunkEnd,
      opening,
      accrueFromFirstDay,
      getSelicForDate,
      contributions: hasCashflows ? contributions : undefined,
      freezeWindows: hasCashflows ? freezeWindows : undefined,
      settlements: hasCashflows ? settlements : undefined,
    });

    for (const day of days) {
      const referenceDate = parseYYYYMMDD(day.referenceDate);
      const selicSource = getSelicForDate(day.referenceDate).source;
      await prisma.cotistaDailyYield.upsert({
        where: {
          partyFundLinkId_referenceDate: {
            partyFundLinkId: link.id,
            referenceDate,
          },
        },
        update: {
          selicPercent: day.selicAnual,
          selicFactor: day.selicFactor,
          selicSource,
          principal: day.principal,
          yieldDay: day.yieldDay,
          yieldAccumulated: day.yieldAccumulated,
          balanceTotal: day.balanceTotal,
          hadWithdraw: day.hadWithdraw,
          withdrawAmount: day.withdrawAmount,
        },
        create: {
          partyFundLinkId: link.id,
          referenceDate,
          selicPercent: day.selicAnual,
          selicFactor: day.selicFactor,
          selicSource,
          principal: day.principal,
          yieldDay: day.yieldDay,
          yieldAccumulated: day.yieldAccumulated,
          balanceTotal: day.balanceTotal,
          hadWithdraw: day.hadWithdraw,
          withdrawAmount: day.withdrawAmount,
        },
      });

      if (day.hadWithdraw && day.withdrawAmount != null) {
        const existing = await prisma.cotistaAmortization.findFirst({
          where: {
            partyFundLinkId: link.id,
            occurredOn: referenceDate,
            kind: 'come_cotas',
          },
        });
        if (existing) {
          await prisma.cotistaAmortization.update({
            where: { id: existing.id },
            data: { amount: day.withdrawAmount, periodEnd: referenceDate },
          });
        } else {
          await prisma.cotistaAmortization.create({
            data: {
              partyFundLinkId: link.id,
              occurredOn: referenceDate,
              amount: day.withdrawAmount,
              kind: 'come_cotas',
              periodEnd: referenceDate,
            },
          });
        }
      }
      written += 1;
    }

    opening = closing;
    accrueFromFirstDay = true;
    cursor = toYYYYMMDD(addDays(parseYYYYMMDD(chunkEnd), 1));
  }

  await settleDueFimRedemptions(link.id, end);
  return written;
}

export async function backfillPartyFundLinkYields(
  partyFundLinkId: string,
  endDate?: string,
): Promise<number> {
  const link = await prisma.partyFundLink.findUnique({ where: { id: partyFundLinkId } });
  if (!link?.contractStartDate) return 0;

  if (link.quotaType === 'unica') {
    const fund = await prisma.fund.findUnique({
      where: { id: link.fundId },
      select: { modality: true },
    });
    if (fund?.modality !== 'fim') return 0;
    return writeFimLinkYields(link, { fromStart: true, endDate });
  }

  const initial = toYYYYMMDD(link.contractStartDate);
  const finalContract = link.contractEndDate ? toYYYYMMDD(link.contractEndDate) : null;
  const viz = endDate ?? toYYYYMMDD(getVisualizationDate());
  let end = viz;
  if (finalContract && finalContract < end) end = finalContract;
  if (initial > end) return 0;

  const investment = Number(link.initialInvestment || link.currentPrincipal || link.quotaAmount);
  const quotaType = asYieldQuota(link.quotaType);
  const selicMap = await getSelicMapForRange(initial, end);

  const getSelicForDate = (dateStr: string): SelicEntry => resolveSelicForDate(selicMap, dateStr);

  const days = generateDailyYields({
    quotaType,
    investment,
    initialDate: initial,
    endDate: end,
    getSelicForDate,
  });

  let written = 0;
  for (const day of days) {
    await prisma.cotistaDailyYield.upsert({
      where: {
        partyFundLinkId_referenceDate: {
          partyFundLinkId,
          referenceDate: parseYYYYMMDD(day.referenceDate),
        },
      },
      update: {
        selicPercent: day.selicAnual,
        selicFactor: day.selicFactor,
        selicSource: getSelicForDate(day.referenceDate).source,
        principal: day.principal,
        yieldDay: day.yieldDay,
        yieldAccumulated: day.yieldAccumulated,
        balanceTotal: day.balanceTotal,
        hadWithdraw: day.hadWithdraw,
        withdrawAmount: day.withdrawAmount,
      },
      create: {
        partyFundLinkId,
        referenceDate: parseYYYYMMDD(day.referenceDate),
        selicPercent: day.selicAnual,
        selicFactor: day.selicFactor,
        selicSource: getSelicForDate(day.referenceDate).source,
        principal: day.principal,
        yieldDay: day.yieldDay,
        yieldAccumulated: day.yieldAccumulated,
        balanceTotal: day.balanceTotal,
        hadWithdraw: day.hadWithdraw,
        withdrawAmount: day.withdrawAmount,
      },
    });

    if (day.hadWithdraw && day.withdrawAmount != null) {
      const existing = await prisma.cotistaAmortization.findFirst({
        where: {
          partyFundLinkId,
          occurredOn: parseYYYYMMDD(day.referenceDate),
          kind: 'mensal',
        },
      });
      if (!existing) {
        await prisma.cotistaAmortization.create({
          data: {
            partyFundLinkId,
            occurredOn: parseYYYYMMDD(day.referenceDate),
            amount: day.withdrawAmount,
            kind: 'mensal',
            periodEnd: parseYYYYMMDD(day.referenceDate),
          },
        });
      }
    }
    written += 1;
  }

  return written;
}

/** Backfill de todos os vínculos ativos (seed / job). */
export async function backfillAllActiveYields(endDate?: string): Promise<number> {
  const links = await prisma.partyFundLink.findMany({
    where: {
      contractStartDate: { not: null },
      OR: [{ quotaType: 'senior_i' }, { quotaType: 'senior_ii' }],
    },
  });
  let total = 0;
  for (const link of links) {
    total += await backfillPartyFundLinkYields(link.id, endDate);
  }

  const fimLinks = await prisma.partyFundLink.findMany({
    where: {
      contractStartDate: { not: null },
      quotaType: 'unica',
      fund: { modality: 'fim' },
    },
  });
  for (const link of fimLinks) {
    total += await writeFimLinkYields(link, { fromStart: false, endDate });
  }
  return total;
}

/** Cron incremental: garante yield até a data de visualização. */
export async function runDailyYieldJob(): Promise<void> {
  const end = toYYYYMMDD(getVisualizationDate());
  const n = await backfillAllActiveYields(end);
  console.log(`[job] yields atualizados até ${end} (${n} registros processados)`);
}

export async function getYieldForDate(partyFundLinkId: string, dateStr: string) {
  return prisma.cotistaDailyYield.findUnique({
    where: {
      partyFundLinkId_referenceDate: {
        partyFundLinkId,
        referenceDate: parseYYYYMMDD(dateStr),
      },
    },
  });
}

/** Último yield com referenceDate <= dateStr (dia útil anterior com dado). */
export async function getLatestYieldOnOrBefore(partyFundLinkId: string, dateStr: string) {
  const exact = await getYieldForDate(partyFundLinkId, dateStr);
  if (exact) return exact;
  return prisma.cotistaDailyYield.findFirst({
    where: {
      partyFundLinkId,
      referenceDate: { lte: parseYYYYMMDD(dateStr) },
    },
    orderBy: { referenceDate: 'desc' },
  });
}

export async function listYields(
  partyFundLinkId: string,
  opts?: { from?: string; to?: string; limit?: number },
) {
  return prisma.cotistaDailyYield.findMany({
    where: {
      partyFundLinkId,
      ...(opts?.from || opts?.to
        ? {
            referenceDate: {
              ...(opts.from ? { gte: parseYYYYMMDD(opts.from) } : {}),
              ...(opts.to ? { lte: parseYYYYMMDD(opts.to) } : {}),
            },
          }
        : {}),
    },
    orderBy: { referenceDate: 'desc' },
    take: opts?.limit ?? 90,
  });
}

export async function listAmortizations(partyFundLinkId: string) {
  return prisma.cotistaAmortization.findMany({
    where: { partyFundLinkId },
    orderBy: { occurredOn: 'desc' },
  });
}
