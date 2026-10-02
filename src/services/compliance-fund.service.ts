import type { AssetClass } from '@prisma/client';
import { prisma } from '../db/index.js';
import { DEFAULT_REGULATORY_LIMITS } from '../lib/errors.js';
import {
  buildLimitKey,
  evaluateLimit,
  parseLimitKey,
  worstStatus,
  type LimitEvaluation,
  type LimitKind,
} from '../lib/regulatory-limits.js';
import { sumFundNetWorthFromLinks } from './fund-pl.service.js';

const DEFAULT_WARNING_PCT = 90;

const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  direito_creditorio: 'Direitos creditórios',
  acoes: 'Ações',
  derivativos: 'Derivativos',
  renda_fixa: 'Renda fixa',
  cotas_fundo_investimento: 'Cotas de fundos',
  imoveis: 'Imóveis',
  outro: 'Outros ativos',
};

type LimitInput = { key: string; kind: LimitKind; assetClass: AssetClass; limitPct: number };

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function violationMessage(e: LimitEvaluation): string {
  const label = ASSET_CLASS_LABELS[e.assetClass];
  const pct = e.currentPct.toFixed(2);
  if (e.kind === 'min') {
    return e.status === 'violacao'
      ? `${label} ${pct}% abaixo do mínimo ${e.limitPct}%`
      : `${label} ${pct}% próximo ao mínimo ${e.limitPct}%`;
  }
  return e.status === 'violacao'
    ? `${label} ${pct}% acima do máximo ${e.limitPct}%`
    : `${label} ${pct}% próximo ao máximo ${e.limitPct}%`;
}

export async function computeFundComplianceStatus(fundId: string) {
  const fund = await prisma.fund.findUnique({ where: { id: fundId } });
  if (!fund) return null;

  const [plFromLinks, byClass, rules] = await Promise.all([
    sumFundNetWorthFromLinks(fundId),
    prisma.fundInvestment.groupBy({
      by: ['assetClass'],
      where: { fundId, status: 'aprovado' },
      _sum: { amount: true },
    }),
    prisma.complianceRule.findMany({ where: { modality: fund.modality } }),
  ]);

  const totals = new Map<AssetClass, number>(
    byClass.map((row) => [row.assetClass, Number(row._sum.amount ?? 0)]),
  );
  const investedTotal = [...totals.values()].reduce((a, b) => a + b, 0);
  const pl = plFromLinks > 0 ? plFromLinks : investedTotal;
  const pctOf = (assetClass: AssetClass) => {
    const amount = totals.get(assetClass) ?? 0;
    return pl > 0 ? (amount / pl) * 100 : amount > 0 ? 100 : 0;
  };

  const rulesByClass = new Map(rules.map((r) => [r.assetClass, r]));
  const limitsJson = (fund.regulatoryLimitsJson as Record<string, number>) ?? {};

  const limits = new Map<string, LimitInput>();
  for (const [key, value] of Object.entries(limitsJson)) {
    const parsed = parseLimitKey(key);
    if (!parsed || typeof value !== 'number' || Number.isNaN(value)) continue;
    const canonical = buildLimitKey(parsed.kind, parsed.assetClass);
    limits.set(canonical, { key, ...parsed, limitPct: value });
  }

  const dcMinKey = buildLimitKey('min', 'direito_creditorio');
  if (fund.modality === 'fidc' && !limits.has(dcMinKey)) {
    const rule = rulesByClass.get('direito_creditorio');
    const fallback =
      (rule ? Number(rule.minPercentage) : undefined) ??
      DEFAULT_REGULATORY_LIMITS.fidc?.min_direitos_creditorios_pct;
    if (fallback != null) {
      limits.set(dcMinKey, {
        key: 'min_direitos_creditorios_pct',
        kind: 'min',
        assetClass: 'direito_creditorio',
        limitPct: fallback,
      });
    }
  }

  const limites: LimitEvaluation[] = [];
  for (const [canonical, limit] of limits) {
    const isFidcDcMin = fund.modality === 'fidc' && canonical === dcMinKey;
    if (pl <= 0 && !isFidcDcMin) continue;
    const rule = rulesByClass.get(limit.assetClass);
    const warningPct = rule ? Number(rule.warningThresholdPct) : DEFAULT_WARNING_PCT;
    const currentPct = round2(pctOf(limit.assetClass));
    limites.push({
      ...limit,
      currentPct,
      status: evaluateLimit(limit.kind, limit.limitPct, currentPct, warningPct),
    });
  }

  const alocacoes: Record<string, number> = {};
  for (const assetClass of totals.keys()) alocacoes[assetClass] = round2(pctOf(assetClass));
  if (fund.modality === 'fidc' && alocacoes.direito_creditorio == null) {
    alocacoes.direito_creditorio = 0;
  }

  const dcLimit = limits.get(dcMinKey);

  return {
    fundId,
    statusCompliance: worstStatus(limites.map((l) => l.status)),
    alocacoes,
    limiteMinimo: dcLimit?.limitPct ?? null,
    limites,
    violacoes: limites.filter((l) => l.status !== 'conforme').map(violationMessage),
    pl,
    dcTotal: totals.get('direito_creditorio') ?? 0,
    checkedAt: new Date().toISOString(),
  };
}
