/** Motor de cotas — paridade com IndexCore calculator / generateSnapshots. */

export const SELIC_SPREAD_PP = 0.1;

export const QUOTA_CONFIG = {
  senior_i: { rentability: 1.04, liquidityDays: 30, contractMonths: 12 },
  senior_ii: { rentability: 1.05, contractMonths: 36 },
} as const;

export type YieldQuotaType = keyof typeof QUOTA_CONFIG;

const INCOME_TAX_TABLE = [
  { upTo: 180, rate: 0.225 },
  { upTo: 360, rate: 0.2 },
  { upTo: 720, rate: 0.175 },
  { upTo: Infinity, rate: 0.15 },
];

export function toSelicFactor(selicAnual: number): number {
  return 1 + (selicAnual - SELIC_SPREAD_PP) / 100;
}

export function incomeTaxRate(daysFromInvestment: number): number {
  const bracket = INCOME_TAX_TABLE.find((b) => daysFromInvestment <= b.upTo);
  return bracket?.rate ?? 0.15;
}

export function applyIncomeTax(grossYield: number, daysFromInvestment: number): number {
  const rate = incomeTaxRate(daysFromInvestment);
  return grossYield - grossYield * rate;
}

export function toYYYYMMDD(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseYYYYMMDD(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00.000Z`);
}

export function addDays(date: Date, n: number): Date {
  const out = new Date(date);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

export function diffDays(initial: string, dateStr: string): number {
  const a = parseYYYYMMDD(initial).getTime();
  const b = parseYYYYMMDD(dateStr).getTime();
  return Math.floor((b - a) / (1000 * 60 * 60 * 24));
}

/**
 * Dia de amortização Sênior I: a cada `liquidityDays` (30) corridos desde o início do contrato.
 * `dias === 0` (início) não amortiza. Filtro por `quotaType` fica no job de alerta.
 */
export function isSeniorIAmortizationDay(
  contractStart: string | null | undefined,
  date: string,
): boolean {
  if (!contractStart) return false;
  const dias = diffDays(contractStart, date);
  if (dias <= 0) return false;
  return dias % QUOTA_CONFIG.senior_i.liquidityDays === 0;
}

/** Calendário civil em America/Sao_Paulo (YYYY-MM-DD às 12:00 UTC). */
export function getCalendarDateInSaoPaulo(today = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(today);
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  const d = Number(parts.find((p) => p.type === 'day')?.value);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** Hoje no calendário civil BRT (YYYY-MM-DD). */
export function todayYYYYMMDD(now = new Date()): string {
  return toYYYYMMDD(getCalendarDateInSaoPaulo(now));
}

/** Amanhã no calendário civil BRT (YYYY-MM-DD). */
export function tomorrowYYYYMMDD(now = new Date()): string {
  return toYYYYMMDD(addDays(getCalendarDateInSaoPaulo(now), 1));
}

/** Data de visualização (IndexCore): calendário BR; seg→sex; sáb/dom→sex; ter–sex→D−1. */
export function getVisualizationDate(today = new Date()): Date {
  const d = getCalendarDateInSaoPaulo(today);
  // ISO: Mon=1 … Sun=7
  const weekDay = ((d.getUTCDay() + 6) % 7) + 1;
  if (weekDay === 1) return addDays(d, -3);
  if (weekDay === 6) return addDays(d, -1);
  if (weekDay === 7) return addDays(d, -2);
  return addDays(d, -1);
}

export function calculateCompoundAmount(
  principal: number,
  rentability: number,
  startDate: Date,
  days: number,
  getSelicFactorByDay: (date: Date) => number,
): number {
  let amount = principal;
  for (let day = 1; day <= days; day++) {
    const currentDate = addDays(startDate, day);
    const selicFactor = getSelicFactorByDay(currentDate);
    const dailyFactor = Math.pow(selicFactor * rentability, 1 / 365);
    amount *= dailyFactor;
  }
  return amount;
}

export type DayYieldResult = {
  referenceDate: string;
  selicAnual: number;
  selicFactor: number;
  principal: number;
  yieldDay: number;
  yieldAccumulated: number;
  balanceTotal: number;
  hadWithdraw: boolean;
  withdrawAmount: number | null;
};

export type SelicLookup = {
  selicAnual: number;
  selicFactor: number;
};

/**
 * Gera yields dia a dia (corridos) de initialDate até endDate inclusive.
 * Mesma lógica de IndexCore generateSnapshots.
 */
export function generateDailyYields(params: {
  quotaType: YieldQuotaType;
  investment: number;
  initialDate: string;
  endDate: string;
  getSelicForDate: (dateStr: string) => SelicLookup;
}): DayYieldResult[] {
  const { quotaType, investment, initialDate, endDate, getSelicForDate } = params;
  if (initialDate > endDate) return [];

  const start = parseYYYYMMDD(initialDate);
  const end = parseYYYYMMDD(endDate);
  const getSelicFactorForDate = (date: Date) => getSelicForDate(toYYYYMMDD(date)).selicFactor;

  const results: DayYieldResult[] = [];
  let saldoAnterior = investment;
  let rendimentoAcumulado = 0;

  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const dateStr = toYYYYMMDD(d);
    const dias = diffDays(initialDate, dateStr);
    const { selicAnual, selicFactor } = getSelicForDate(dateStr);

    let saldoTotal: number;
    let rendimentoDia: number;
    let houveSaque = false;
    let valorSaque: number | null = null;

    if (quotaType === 'senior_ii') {
      saldoTotal = calculateCompoundAmount(
        investment,
        QUOTA_CONFIG.senior_ii.rentability,
        start,
        dias,
        getSelicFactorForDate,
      );
      rendimentoAcumulado = saldoTotal - investment;
      rendimentoDia = saldoTotal - saldoAnterior;
    } else {
      const liquidityDays = QUOTA_CONFIG.senior_i.liquidityDays;
      const isDiaDeSaque = isSeniorIAmortizationDay(initialDate, dateStr);

      if (isDiaDeSaque) {
        const inicioCiclo = addDays(start, dias - liquidityDays);
        const rendimentoBruto30 =
          calculateCompoundAmount(
            investment,
            QUOTA_CONFIG.senior_i.rentability,
            inicioCiclo,
            liquidityDays,
            getSelicFactorForDate,
          ) - investment;
        valorSaque = applyIncomeTax(rendimentoBruto30, dias);
        rendimentoAcumulado += valorSaque;
        saldoTotal = investment;
        rendimentoDia = valorSaque;
        houveSaque = true;
      } else {
        const ultimoSaqueAntes = Math.floor(dias / liquidityDays) * liquidityDays;
        const diasDesdeUltimoSaque = dias - ultimoSaqueAntes;
        const inicioCicloAtual = addDays(start, ultimoSaqueAntes);
        const rendimentoAtual =
          calculateCompoundAmount(
            investment,
            QUOTA_CONFIG.senior_i.rentability,
            inicioCicloAtual,
            diasDesdeUltimoSaque,
            getSelicFactorForDate,
          ) - investment;
        saldoTotal = investment + rendimentoAtual;
        rendimentoDia = saldoTotal - saldoAnterior;
      }
    }

    saldoAnterior = saldoTotal;
    results.push({
      referenceDate: dateStr,
      selicAnual,
      selicFactor,
      principal: investment,
      yieldDay: rendimentoDia,
      yieldAccumulated: rendimentoAcumulado,
      balanceTotal: saldoTotal,
      hadWithdraw: houveSaque,
      withdrawAmount: valorSaque,
    });
  }

  return results;
}

export function mapDataJsonQuota(quota: string): YieldQuotaType {
  if (quota === 'sri' || quota === 'senior_i' || quota === 'jr') return 'senior_i';
  if (quota === 'srii' || quota === 'senior_ii' || quota === 'sr') return 'senior_ii';
  throw new Error(`Tipo de cota desconhecido: ${quota}`);
}
