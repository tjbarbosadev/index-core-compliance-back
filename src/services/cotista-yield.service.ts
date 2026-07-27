import { prisma } from '../db/index.js';
import {
  generateDailyYields,
  getVisualizationDate,
  mapDataJsonQuota,
  toYYYYMMDD,
  parseYYYYMMDD,
  type YieldQuotaType,
} from './quota-calculator.js';
import { getSelicMapForRange, resolveSelicForDate, type SelicEntry } from './selic.service.js';

function asYieldQuota(quotaType: string): YieldQuotaType {
  if (quotaType === 'senior_i' || quotaType === 'senior_ii') return quotaType;
  if (quotaType === 'senior') return 'senior_i';
  return mapDataJsonQuota(quotaType);
}

export async function backfillPartyFundLinkYields(
  partyFundLinkId: string,
  endDate?: string,
): Promise<number> {
  const link = await prisma.partyFundLink.findUnique({ where: { id: partyFundLinkId } });
  if (!link?.contractStartDate) return 0;

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
