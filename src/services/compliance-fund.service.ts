import { prisma } from '../db/index.js';
import { DEFAULT_REGULATORY_LIMITS } from '../lib/errors.js';
import { sumFundNetWorthFromLinks } from './fund-pl.service.js';

export async function computeFundComplianceStatus(fundId: string) {
  const fund = await prisma.fund.findUnique({ where: { id: fundId } });
  if (!fund) return null;

  const [plFromLinks, dcAggregate, rule] = await Promise.all([
    sumFundNetWorthFromLinks(fundId),
    prisma.fundInvestment.aggregate({
      where: { fundId, assetClass: 'direito_creditorio', status: 'aprovado' },
      _sum: { amount: true },
    }),
    prisma.complianceRule.findUnique({
      where: {
        modality_assetClass: {
          modality: fund.modality,
          assetClass: 'direito_creditorio',
        },
      },
    }),
  ]);

  const dcTotal = Number(dcAggregate._sum.amount ?? 0);
  const limits = (fund.regulatoryLimitsJson as Record<string, number>) ?? {};
  const minFromJson = limits.min_direitos_creditorios_pct;
  const minFromRule = rule ? Number(rule.minPercentage) : undefined;
  const limiteMinimo =
    minFromJson ??
    minFromRule ??
    DEFAULT_REGULATORY_LIMITS[fund.modality]?.min_direitos_creditorios_pct ??
    null;

  const pl = plFromLinks > 0 ? plFromLinks : dcTotal;
  const dcPct = pl > 0 ? (dcTotal / pl) * 100 : dcTotal > 0 ? 100 : 0;

  const alocacoes: Record<string, number> = {
    direito_creditorio: Math.round(dcPct * 100) / 100,
  };

  const violacoes: string[] = [];
  let statusCompliance: 'conforme' | 'alerta' | 'violacao' = 'conforme';

  if (limiteMinimo != null && fund.modality === 'fidc') {
    const warningThreshold = rule ? Number(rule.warningThresholdPct) : 90;
    const thresholdPct = (limiteMinimo * warningThreshold) / 100;
    if (dcPct < limiteMinimo) {
      if (dcPct < thresholdPct) {
        statusCompliance = 'violacao';
        violacoes.push(
          `Direitos creditórios ${dcPct.toFixed(2)}% abaixo do mínimo ${limiteMinimo}%`,
        );
      } else {
        statusCompliance = 'alerta';
        violacoes.push(
          `Direitos creditórios ${dcPct.toFixed(2)}% próximo ao mínimo ${limiteMinimo}%`,
        );
      }
    }
  }

  return {
    fundId,
    statusCompliance,
    alocacoes,
    limiteMinimo,
    violacoes,
    pl,
    dcTotal,
    checkedAt: new Date().toISOString(),
  };
}
