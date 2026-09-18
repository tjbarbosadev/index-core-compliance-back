import type { Prisma } from '@prisma/client';
import { prisma } from '../db/index.js';

type LinkWithYield = {
  currentPrincipal: Prisma.Decimal;
  initialInvestment: Prisma.Decimal;
  dailyYields?: { balanceTotal: Prisma.Decimal }[];
};

export function balanceForPartyFundLink(link: LinkWithYield): number {
  const latest = link.dailyYields?.[0];
  if (latest) return Number(latest.balanceTotal);
  const principal = Number(link.currentPrincipal);
  if (principal > 0) return principal;
  return Number(link.initialInvestment);
}

const linkInclude = {
  dailyYields: { orderBy: { referenceDate: 'desc' as const }, take: 1 },
} as const;

export async function sumGlobalNetWorthFromLinks(): Promise<number> {
  const links = await prisma.partyFundLink.findMany({ include: linkInclude });
  return links.reduce((sum, link) => sum + balanceForPartyFundLink(link), 0);
}

export async function sumFundNetWorthFromLinks(fundId: string): Promise<number> {
  const links = await prisma.partyFundLink.findMany({
    where: { fundId },
    include: linkInclude,
  });
  return links.reduce((sum, link) => sum + balanceForPartyFundLink(link), 0);
}

export async function netWorthByFundIds(fundIds: string[]): Promise<Map<string, number>> {
  if (fundIds.length === 0) return new Map();
  const links = await prisma.partyFundLink.findMany({
    where: { fundId: { in: fundIds } },
    include: linkInclude,
  });
  const map = new Map<string, number>();
  for (const link of links) {
    const bal = balanceForPartyFundLink(link);
    map.set(link.fundId, (map.get(link.fundId) ?? 0) + bal);
  }
  return map;
}
