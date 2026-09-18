import { prisma } from '../db/index.js';
import { searchAudit } from './audit.service.js';
import { sumGlobalNetWorthFromLinks } from './fund-pl.service.js';

export type DashboardSummary = {
  totalNetWorth: number;
  activeFunds: number;
  approvedShareholders: number;
  onboardingsInProgress: number;
  activeAlerts: number;
  obligationsDueIn7Days: number;
};

export type Activity = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  entityName?: string;
  userName: string;
  createdAt: string;
};

function entityNameFromDetails(details: Record<string, unknown>): string | undefined {
  for (const key of ['entityName', 'name', 'legalName', 'fundName'] as const) {
    const value = details[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

export function mapActivity(log: Awaited<ReturnType<typeof searchAudit>>[number]): Activity {
  const details = (log.details as Record<string, unknown>) ?? {};
  return {
    id: log.id,
    action: log.action,
    entityType: log.entityType ?? '',
    entityId: log.entityId ?? '',
    entityName: entityNameFromDetails(details),
    userName: log.user?.name ?? 'Sistema',
    createdAt: log.createdAt.toISOString(),
  };
}

export async function getSummary(): Promise<DashboardSummary> {
  const [totalNetWorth, activeFunds, approvedShareholders, onboardingsInProgress, activeAlerts] =
    await Promise.all([
      sumGlobalNetWorthFromLinks(),
      prisma.fund.count({ where: { status: 'ativo' } }),
      prisma.cotista.count({ where: { party: { status: 'aprovado' } } }),
      prisma.onboardingProcess.count({ where: { status: 'em_andamento' } }),
      prisma.complianceAlert.count({
        where: { status: { in: ['novo', 'investigando', 'reportado_coaf'] } },
      }),
    ]);

  return {
    totalNetWorth,
    activeFunds,
    approvedShareholders,
    onboardingsInProgress,
    activeAlerts,
    obligationsDueIn7Days: 0,
  };
}

export async function getRecentActivity(limit = 10): Promise<Activity[]> {
  const logs = await searchAudit({ limit });
  return logs.map(mapActivity);
}
