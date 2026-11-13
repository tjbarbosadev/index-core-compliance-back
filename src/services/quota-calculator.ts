/** Motor de cotas — paridade com IndexCore calculator / generateSnapshots. */

export const SELIC_SPREAD_PP = 0.1;

export const QUOTA_CONFIG = {
  senior_i: { rentability: 1.04, liquidityDays: 30, contractMonths: 12 },
  senior_ii: { rentability: 1.05, contractMonths: 36 },
} as const;

export type YieldQuotaType = keyof typeof QUOTA_CONFIG;

/** Projeção da meta do NEXT CORE II FIM: 120% da variação diária, base 252. */
export const FIM_CDI_MULTIPLIER = 1.2;
export const FIM_BUSINESS_DAYS_PER_YEAR = 252;
export const FIM_COME_COTAS_RATE = 0.15;
export const FIM_YIELD_CHUNK_DAYS = 30;

export type StoredQuotaType = YieldQuotaType | 'unica';

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

export function isWeekday(date: Date): boolean {
  const weekday = date.getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

/** Avança `n` dias úteis (segunda–sexta). Sem calendário de feriado. */
export function addBusinessDays(date: Date, n: number): Date {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error('addBusinessDays exige n inteiro >= 0');
  }
  let out = new Date(date);
  let remaining = n;
  while (remaining > 0) {
    out = addDays(out, 1);
    if (isWeekday(out)) remaining -= 1;
  }
  return out;
}

/** Fator de um dia útil: 120% da variação da SELIC já líquida de 0,1 p.p. (base 252). */
export function fimDailyFactor(selicFactorAnual: number): number {
  const dailySelic = Math.pow(selicFactorAnual, 1 / FIM_BUSINESS_DAYS_PER_YEAR) - 1;
  return 1 + FIM_CDI_MULTIPLIER * dailySelic;
}

/** Último dia de semana do mês (mês 1–12). Sem calendário de feriado. */
export function lastWeekdayOfMonth(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month, 0, 12));
  while (!isWeekday(date)) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return toYYYYMMDD(date);
}

/** Come-cotas no último dia útil de maio e de novembro. */
export function isFimComeCotasDay(dateStr: string): boolean {
  const date = parseYYYYMMDD(dateStr);
  const month = date.getUTCMonth() + 1;
  if (month !== 5 && month !== 11) return false;
  return dateStr === lastWeekdayOfMonth(date.getUTCFullYear(), month);
}

export type FimYieldState = {
  balance: number;
  taxBasis: number;
  yieldAccumulated: number;
};

/** Aporte datado. Entra no saldo depois do rendimento e do come-cotas do dia. */
export type FimContribution = { date: string; amount: number };

/** Janela [from, toExclusive): só `amount` deixa de render; o restante continua. */
export type FimFreezeWindow = { from: string; toExclusive: string; amount: number };

/** Resgate liquidado: reduz saldo (e principal até zerar) na data, depois do rendimento do dia. */
export type FimSettlement = { date: string; amount: number };

function contributionTotal(items: FimContribution[], upTo: string): number {
  let total = 0;
  for (const item of items) {
    if (item.date <= upTo) total += item.amount;
  }
  return total;
}

function contributionOn(items: FimContribution[], date: string): number {
  let total = 0;
  for (const item of items) {
    if (item.date === date) total += item.amount;
  }
  return total;
}

function settlementTotal(items: FimSettlement[], upTo: string): number {
  let total = 0;
  for (const item of items) {
    if (item.date <= upTo) total += item.amount;
  }
  return total;
}

function settlementOn(items: FimSettlement[], date: string): number {
  let total = 0;
  for (const item of items) {
    if (item.date === date) total += item.amount;
  }
  return total;
}

function frozenAmountOn(windows: FimFreezeWindow[], dateStr: string): number {
  let total = 0;
  for (const window of windows) {
    if (dateStr >= window.from && dateStr < window.toExclusive) total += window.amount;
  }
  return total;
}

/**
 * Projeta um trecho do FIM a partir do saldo de abertura.
 * O primeiro dia só não rende quando `accrueFromFirstDay` é falso (data de cotização).
 * Come-cotas reduz o saldo e a base que segue rendendo.
 * Com `contributions`, cada aporte soma no principal só a partir do próprio dia.
 * `freezeWindows` congelam só `amount` (resto rende); `settlements` reduzem saldo após o dia.
 */
export function generateFimYieldChunk(params: {
  investment: number;
  fromDate: string;
  endDate: string;
  opening: FimYieldState;
  accrueFromFirstDay: boolean;
  getSelicForDate: (dateStr: string) => SelicLookup;
  contributions?: FimContribution[];
  freezeWindows?: FimFreezeWindow[];
  settlements?: FimSettlement[];
}): { days: DayYieldResult[]; closing: FimYieldState } {
  const {
    investment,
    fromDate,
    endDate,
    opening,
    accrueFromFirstDay,
    getSelicForDate,
    contributions,
    freezeWindows,
    settlements,
  } = params;
  if (fromDate > endDate) {
    return { days: [], closing: opening };
  }

  const hasCashflows =
    (contributions && contributions.length > 0) ||
    (freezeWindows && freezeWindows.length > 0) ||
    (settlements && settlements.length > 0);

  if (hasCashflows) {
    return generateFimYieldChunkFromContributions({
      contributions: contributions ?? [],
      freezeWindows: freezeWindows ?? [],
      settlements: settlements ?? [],
      fromDate,
      endDate,
      opening,
      accrueFromFirstDay,
      getSelicForDate,
    });
  }

  const days: DayYieldResult[] = [];
  let balance = opening.balance;
  let taxBasis = opening.taxBasis;
  let yieldAccumulated = opening.yieldAccumulated;
  let previous = opening.balance;

  for (let d = parseYYYYMMDD(fromDate); toYYYYMMDD(d) <= endDate; d = addDays(d, 1)) {
    const dateStr = toYYYYMMDD(d);
    const selic = getSelicForDate(dateStr);
    const isContractStart = dateStr === fromDate && !accrueFromFirstDay;

    let yieldDay = 0;
    let hadWithdraw = false;
    let withdrawAmount: number | null = null;

    if (isContractStart) {
      balance = investment;
      taxBasis = investment;
      yieldAccumulated = 0;
      yieldDay = 0;
    } else {
      if (isWeekday(d)) {
        balance *= fimDailyFactor(selic.selicFactor);
      }
      if (isFimComeCotasDay(dateStr)) {
        const gain = balance - taxBasis;
        if (gain > 0) {
          withdrawAmount = gain * FIM_COME_COTAS_RATE;
          balance -= withdrawAmount;
          taxBasis = balance;
          hadWithdraw = true;
        }
      }
      yieldDay = balance - previous;
      yieldAccumulated = balance - investment;
    }

    previous = balance;
    days.push({
      referenceDate: dateStr,
      selicAnual: selic.selicAnual,
      selicFactor: selic.selicFactor,
      principal: investment,
      yieldDay,
      yieldAccumulated,
      balanceTotal: balance,
      hadWithdraw,
      withdrawAmount,
    });
  }

  const closing: FimYieldState = { balance, taxBasis, yieldAccumulated };
  return { days, closing };
}

function generateFimYieldChunkFromContributions(params: {
  contributions: FimContribution[];
  freezeWindows: FimFreezeWindow[];
  settlements: FimSettlement[];
  fromDate: string;
  endDate: string;
  opening: FimYieldState;
  accrueFromFirstDay: boolean;
  getSelicForDate: (dateStr: string) => SelicLookup;
}): { days: DayYieldResult[]; closing: FimYieldState } {
  const {
    contributions,
    freezeWindows,
    settlements,
    fromDate,
    endDate,
    opening,
    accrueFromFirstDay,
    getSelicForDate,
  } = params;
  const days: DayYieldResult[] = [];
  let balance = opening.balance;
  let taxBasis = opening.taxBasis;
  let yieldAccumulated = opening.yieldAccumulated;

  for (let d = parseYYYYMMDD(fromDate); toYYYYMMDD(d) <= endDate; d = addDays(d, 1)) {
    const dateStr = toYYYYMMDD(d);
    const selic = getSelicForDate(dateStr);
    const isContractStart = dateStr === fromDate && !accrueFromFirstDay;
    const frozenAmt = Math.min(balance, Math.max(0, frozenAmountOn(freezeWindows, dateStr)));
    const principal = Math.max(
      0,
      contributionTotal(contributions, dateStr) - settlementTotal(settlements, dateStr),
    );
    let yieldDay = 0;
    let hadWithdraw = false;
    let withdrawAmount: number | null = null;

    if (isContractStart) {
      balance = principal;
      taxBasis = principal;
      yieldAccumulated = 0;
      yieldDay = 0;
    } else {
      // Liquidação no início do settlesOn (antes do rendimento do dia), para o
      // valor reservado sair sem gerar residual quando o freeze era total.
      const redeemed = settlementOn(settlements, dateStr);
      if (redeemed > 0) {
        balance = Math.max(0, balance - redeemed);
        taxBasis = Math.min(taxBasis, balance);
      }
      const balanceBeforeAccrue = balance;
      const frozenAfterSettle = Math.min(balance, Math.max(0, frozenAmt));
      if (isWeekday(d)) {
        const accruable = Math.max(0, balance - frozenAfterSettle);
        const factor = fimDailyFactor(selic.selicFactor);
        balance = accruable * factor + frozenAfterSettle;
      }
      if (isFimComeCotasDay(dateStr)) {
        const gain = balance - taxBasis;
        if (gain > 0) {
          withdrawAmount = gain * FIM_COME_COTAS_RATE;
          balance -= withdrawAmount;
          taxBasis = balance;
          hadWithdraw = true;
        }
      }
      yieldDay = balance - balanceBeforeAccrue;
      const added = contributionOn(contributions, dateStr);
      if (added > 0) {
        balance += added;
        taxBasis += added;
      }
      yieldAccumulated = balance - principal;
    }

    days.push({
      referenceDate: dateStr,
      selicAnual: selic.selicAnual,
      selicFactor: selic.selicFactor,
      principal,
      yieldDay,
      yieldAccumulated,
      balanceTotal: balance,
      hadWithdraw,
      withdrawAmount,
    });
  }

  return { days, closing: { balance, taxBasis, yieldAccumulated } };
}

export function fimChunkEnd(
  fromDate: string,
  endDate: string,
  chunkDays = FIM_YIELD_CHUNK_DAYS,
): string {
  const candidate = toYYYYMMDD(addDays(parseYYYYMMDD(fromDate), chunkDays - 1));
  return candidate < endDate ? candidate : endDate;
}

export function mapDataJsonQuota(quota: string): StoredQuotaType {
  if (quota === 'sri' || quota === 'senior_i' || quota === 'jr') return 'senior_i';
  if (quota === 'srii' || quota === 'senior_ii' || quota === 'sr') return 'senior_ii';
  if (quota === 'unica' || quota === 'fim') return 'unica';
  throw new Error(`Tipo de cota desconhecido: ${quota}`);
}
