import type { AssetClass } from '@prisma/client';

export const LIMIT_ASSET_CLASSES = [
  'direito_creditorio',
  'acoes',
  'derivativos',
  'renda_fixa',
  'cotas_fundo_investimento',
  'imoveis',
  'outro',
] as const satisfies readonly AssetClass[];

export type LimitKind = 'min' | 'max';

export type ParsedLimitKey = { kind: LimitKind; assetClass: AssetClass };

export type LimitStatus = 'conforme' | 'alerta' | 'violacao';

export type LimitEvaluation = {
  key: string;
  assetClass: AssetClass;
  kind: LimitKind;
  limitPct: number;
  currentPct: number;
  status: LimitStatus;
};

const KEY_ALIASES: Record<string, string> = {
  min_direitos_creditorios_pct: 'min_direito_creditorio_pct',
};

const KEY_PATTERN = /^(min|max)_([a-z_]+)_pct$/;

export function parseLimitKey(key: string): ParsedLimitKey | null {
  const match = KEY_PATTERN.exec(KEY_ALIASES[key] ?? key);
  if (!match) return null;
  const assetClass = match[2] as AssetClass;
  if (!(LIMIT_ASSET_CLASSES as readonly string[]).includes(assetClass)) return null;
  return { kind: match[1] as LimitKind, assetClass };
}

export function buildLimitKey(kind: LimitKind, assetClass: AssetClass): string {
  return `${kind}_${assetClass}_pct`;
}

/** warningPct: percentage of the limit at which an alert is raised (e.g. 90). */
export function evaluateLimit(
  kind: LimitKind,
  limitPct: number,
  currentPct: number,
  warningPct: number,
): LimitStatus {
  const threshold = (limitPct * warningPct) / 100;
  if (kind === 'min') {
    if (currentPct >= limitPct) return 'conforme';
    return currentPct < threshold ? 'violacao' : 'alerta';
  }
  if (currentPct > limitPct) return 'violacao';
  return currentPct >= threshold ? 'alerta' : 'conforme';
}

const STATUS_RANK: Record<LimitStatus, number> = { conforme: 0, alerta: 1, violacao: 2 };

export function worstStatus(statuses: LimitStatus[]): LimitStatus {
  return statuses.reduce<LimitStatus>(
    (worst, s) => (STATUS_RANK[s] > STATUS_RANK[worst] ? s : worst),
    'conforme',
  );
}
