import { describe, expect, it } from 'vitest';
import {
  applyIncomeTax,
  calculateCompoundAmount,
  fimChunkEnd,
  fimDailyFactor,
  generateDailyYields,
  generateFimYieldChunk,
  getVisualizationDate,
  isFimComeCotasDay,
  isSeniorIAmortizationDay,
  mapDataJsonQuota,
  parseYYYYMMDD,
  toSelicFactor,
  toYYYYMMDD,
  tomorrowYYYYMMDD,
  addDays,
  addBusinessDays,
  SELIC_SPREAD_PP,
  FIM_YIELD_CHUNK_DAYS,
} from './quota-calculator.js';
import { resolveSelicForDate, type SelicEntry } from './selic.service.js';

describe('quota-calculator (IndexCore parity)', () => {
  it('converts SELIC meta 15.00 to factor 1.149', () => {
    expect(SELIC_SPREAD_PP).toBe(0.1);
    expect(toSelicFactor(15)).toBeCloseTo(1.149, 6);
  });

  it('maps data.json quotas', () => {
    expect(mapDataJsonQuota('sri')).toBe('senior_i');
    expect(mapDataJsonQuota('srii')).toBe('senior_ii');
  });

  it('compounds one day with selicFactor * 1.04', () => {
    const start = parseYYYYMMDD('2026-01-01');
    const factor = 1.149;
    const next = calculateCompoundAmount(10000, 1.04, start, 1, () => factor);
    expect(next).toBeCloseTo(10000 * Math.pow(factor * 1.04, 1 / 365), 6);
  });

  it('applies IR regressive table on day 30', () => {
    const gross = 100;
    const net = applyIncomeTax(gross, 30);
    expect(net).toBeCloseTo(100 * (1 - 0.225), 6);
  });

  it('Senior I withdraws on day 30 and resets balance to principal', () => {
    const selic = { selicAnual: 15, selicFactor: 1.149 };
    const days = generateDailyYields({
      quotaType: 'senior_i',
      investment: 10000,
      initialDate: '2026-01-01',
      endDate: '2026-01-31',
      getSelicForDate: () => selic,
    });
    const day30 = days.find((d) => d.referenceDate === '2026-01-31');
    expect(day30).toBeDefined();
    expect(day30!.hadWithdraw).toBe(true);
    expect(day30!.balanceTotal).toBeCloseTo(10000, 2);
    expect(day30!.withdrawAmount).toBeGreaterThan(0);
  });

  it('Senior II accumulates without intermediate withdraw', () => {
    const selic = { selicAnual: 15, selicFactor: 1.149 };
    const days = generateDailyYields({
      quotaType: 'senior_ii',
      investment: 1_000_000,
      initialDate: '2026-01-01',
      endDate: '2026-01-31',
      getSelicForDate: () => selic,
    });
    expect(days.every((d) => !d.hadWithdraw)).toBe(true);
    const last = days[days.length - 1]!;
    expect(last.yieldAccumulated).toBeCloseTo(last.balanceTotal - 1_000_000, 2);
  });

  it('visualization date: Monday -> previous Friday', () => {
    // 2026-07-20 is Monday UTC
    const viz = getVisualizationDate(new Date('2026-07-20T15:00:00Z'));
    expect(toYYYYMMDD(viz)).toBe('2026-07-17');
  });

  it('visualization date uses America/Sao_Paulo calendar (not UTC midnight)', () => {
    // 2026-07-22 02:00 UTC = 2026-07-21 23:00 BRT (Tuesday) → D−1 = Monday 20
    const lateUtcTue = getVisualizationDate(new Date('2026-07-22T02:00:00Z'));
    expect(toYYYYMMDD(lateUtcTue)).toBe('2026-07-20');
    // 2026-07-22 15:00 UTC = 12:00 BRT Wednesday → D−1 Tuesday
    const wedBr = getVisualizationDate(new Date('2026-07-22T15:00:00Z'));
    expect(toYYYYMMDD(wedBr)).toBe('2026-07-21');
  });

  it('R11: tomorrowYYYYMMDD uses America/Sao_Paulo calendar not UTC midnight', () => {
    // 2026-07-22 02:00 UTC = 2026-07-21 23:00 BRT → amanhã BRT = 2026-07-22
    expect(tomorrowYYYYMMDD(new Date('2026-07-22T02:00:00Z'))).toBe('2026-07-22');
    // 2026-07-22 15:00 UTC = 12:00 BRT Wednesday → amanhã = 2026-07-23
    expect(tomorrowYYYYMMDD(new Date('2026-07-22T15:00:00Z'))).toBe('2026-07-23');
  });
});

describe('isSeniorIAmortizationDay', () => {
  const start = '2026-01-01';

  function datePlus(days: number): string {
    return toYYYYMMDD(addDays(parseYYYYMMDD(start), days));
  }

  it('R01: day 0 (contract start) is not amortization day', () => {
    expect(isSeniorIAmortizationDay(start, start)).toBe(false);
  });

  it('R02: day 29 is not amortization day', () => {
    expect(isSeniorIAmortizationDay(start, datePlus(29))).toBe(false);
    expect(datePlus(29)).toBe('2026-01-30');
  });

  it('R03: day 30 is amortization day', () => {
    expect(isSeniorIAmortizationDay(start, datePlus(30))).toBe(true);
    expect(datePlus(30)).toBe('2026-01-31');
  });

  it('R04: day 31 is not amortization day', () => {
    expect(isSeniorIAmortizationDay(start, datePlus(31))).toBe(false);
    expect(datePlus(31)).toBe('2026-02-01');
  });

  it('R05: day 60 is amortization day', () => {
    expect(isSeniorIAmortizationDay(start, datePlus(60))).toBe(true);
  });

  it('R06: day 90 is amortization day', () => {
    expect(isSeniorIAmortizationDay(start, datePlus(90))).toBe(true);
  });

  it('R07: day math is quota-agnostic (alert filters senior_ii separately)', () => {
    // Função só calcula ciclos de 30 dias; o job de alerta não a aplica a senior_ii.
    expect(isSeniorIAmortizationDay(start, datePlus(30))).toBe(true);
  });

  it('R08: null, undefined or empty contract start is not eligible', () => {
    expect(isSeniorIAmortizationDay(null, datePlus(30))).toBe(false);
    expect(isSeniorIAmortizationDay(undefined, datePlus(30))).toBe(false);
    expect(isSeniorIAmortizationDay('', datePlus(30))).toBe(false);
  });

  it('R09: date before contract start is not amortization day', () => {
    expect(isSeniorIAmortizationDay(start, '2025-12-31')).toBe(false);
  });

  it('R10: generateDailyYields hadWithdraw matches isSeniorIAmortizationDay', () => {
    const selic = { selicAnual: 15, selicFactor: 1.149 };
    const days = generateDailyYields({
      quotaType: 'senior_i',
      investment: 10000,
      initialDate: start,
      endDate: datePlus(60),
      getSelicForDate: () => selic,
    });
    for (const day of days) {
      expect(day.hadWithdraw).toBe(isSeniorIAmortizationDay(start, day.referenceDate));
    }
  });

  it('R12: cycle across year boundary', () => {
    expect(isSeniorIAmortizationDay('2025-12-02', '2026-01-01')).toBe(true);
  });

  it('R13: cycles 30/60/120 true; 45 false', () => {
    expect(isSeniorIAmortizationDay(start, datePlus(30))).toBe(true);
    expect(isSeniorIAmortizationDay(start, datePlus(60))).toBe(true);
    expect(isSeniorIAmortizationDay(start, datePlus(120))).toBe(true);
    expect(isSeniorIAmortizationDay(start, datePlus(45))).toBe(false);
  });
});

describe('FIM yield projection', () => {
  const selic = { selicAnual: 14, selicFactor: 1.139 };
  const opening = { balance: 10_000, taxBasis: 10_000, yieldAccumulated: 0 };

  it('maps unica and fim to the single quota', () => {
    expect(mapDataJsonQuota('unica')).toBe('unica');
    expect(mapDataJsonQuota('fim')).toBe('unica');
  });

  it('applies 120% of the daily SELIC variation on a 252-day base', () => {
    const dailySelic = Math.pow(1.139, 1 / 252) - 1;
    expect(fimDailyFactor(1.139)).toBeCloseTo(1 + 1.2 * dailySelic, 12);
  });

  it('does not accrue on the quotation date', () => {
    const { days } = generateFimYieldChunk({
      investment: 10_000,
      fromDate: '2026-06-01',
      endDate: '2026-06-01',
      opening,
      accrueFromFirstDay: false,
      getSelicForDate: () => selic,
    });
    expect(days).toHaveLength(1);
    expect(days[0]!.yieldDay).toBe(0);
    expect(days[0]!.balanceTotal).toBe(10_000);
    expect(days[0]!.hadWithdraw).toBe(false);
  });

  it('compounds the next business day and skips the weekend', () => {
    const { days } = generateFimYieldChunk({
      investment: 10_000,
      fromDate: '2026-06-01',
      endDate: '2026-06-07',
      opening,
      accrueFromFirstDay: false,
      getSelicForDate: () => selic,
    });
    const tuesday = days.find((day) => day.referenceDate === '2026-06-02')!;
    const saturday = days.find((day) => day.referenceDate === '2026-06-06')!;
    const friday = days.find((day) => day.referenceDate === '2026-06-05')!;
    expect(tuesday.balanceTotal).toBeCloseTo(10_000 * fimDailyFactor(1.139), 6);
    expect(saturday.balanceTotal).toBeCloseTo(friday.balanceTotal, 6);
    expect(saturday.yieldDay).toBeCloseTo(0, 6);
    expect(days.every((day) => !day.hadWithdraw)).toBe(true);
  });

  it('withholds 15% come-cotas on the last weekday of May and keeps compounding the net balance', () => {
    expect(isFimComeCotasDay('2026-05-29')).toBe(true);
    expect(isFimComeCotasDay('2026-05-30')).toBe(false);

    const { days } = generateFimYieldChunk({
      investment: 10_000,
      fromDate: '2026-05-27',
      endDate: '2026-05-30',
      opening,
      accrueFromFirstDay: false,
      getSelicForDate: () => selic,
    });
    const factor = fimDailyFactor(1.139);
    const beforeTax = 10_000 * factor * factor;
    const tax = (beforeTax - 10_000) * 0.15;
    const friday = days.find((day) => day.referenceDate === '2026-05-29')!;
    const saturday = days.find((day) => day.referenceDate === '2026-05-30')!;
    expect(friday.hadWithdraw).toBe(true);
    expect(friday.withdrawAmount).toBeCloseTo(tax, 6);
    expect(friday.balanceTotal).toBeCloseTo(beforeTax - tax, 6);
    expect(saturday.balanceTotal).toBeCloseTo(friday.balanceTotal, 6);
    expect(saturday.hadWithdraw).toBe(false);
  });

  it('continues a later chunk from the previous closing balance', () => {
    const first = generateFimYieldChunk({
      investment: 10_000,
      fromDate: '2026-05-27',
      endDate: '2026-05-28',
      opening,
      accrueFromFirstDay: false,
      getSelicForDate: () => selic,
    });
    const second = generateFimYieldChunk({
      investment: 10_000,
      fromDate: '2026-05-29',
      endDate: '2026-05-31',
      opening: first.closing,
      accrueFromFirstDay: true,
      getSelicForDate: () => selic,
    });
    const whole = generateFimYieldChunk({
      investment: 10_000,
      fromDate: '2026-05-27',
      endDate: '2026-05-31',
      opening,
      accrueFromFirstDay: false,
      getSelicForDate: () => selic,
    });
    const joined = [...first.days, ...second.days];
    expect(joined.map((day) => day.balanceTotal)).toEqual(
      whole.days.map((day) => day.balanceTotal),
    );
    expect(second.days.some((day) => day.hadWithdraw)).toBe(true);
    expect(fimChunkEnd('2026-05-27', '2026-12-31', FIM_YIELD_CHUNK_DAYS)).toBe('2026-06-25');
  });

  it('adds a later contribution only from that day and leaves earlier balances unchanged', () => {
    const withTopUp = generateFimYieldChunk({
      investment: 10_000,
      fromDate: '2026-06-01',
      endDate: '2026-06-03',
      opening,
      accrueFromFirstDay: false,
      getSelicForDate: () => selic,
      contributions: [
        { date: '2026-06-01', amount: 10_000 },
        { date: '2026-06-03', amount: 5_000 },
      ],
    });
    const before = generateFimYieldChunk({
      investment: 10_000,
      fromDate: '2026-06-01',
      endDate: '2026-06-02',
      opening,
      accrueFromFirstDay: false,
      getSelicForDate: () => selic,
    });
    const tuesday = withTopUp.days[1]!;
    const wednesday = withTopUp.days[2]!;
    expect(withTopUp.days[0]!.balanceTotal).toBe(before.days[0]!.balanceTotal);
    expect(tuesday.balanceTotal).toBeCloseTo(before.days[1]!.balanceTotal, 6);
    expect(tuesday.principal).toBe(10_000);
    expect(wednesday.principal).toBe(15_000);
    const accrued = tuesday.balanceTotal * fimDailyFactor(1.139);
    expect(wednesday.yieldDay).toBeCloseTo(accrued - tuesday.balanceTotal, 6);
    expect(wednesday.balanceTotal).toBeCloseTo(accrued + 5_000, 6);
    expect(wednesday.yieldAccumulated).toBeCloseTo(wednesday.balanceTotal - 15_000, 6);
  });

  it('freezes the whole box until settlement and then reduces principal', () => {
    // Mon 2026-06-01 request → D+5 business = Mon 2026-06-08
    const { days } = generateFimYieldChunk({
      investment: 1_000,
      fromDate: '2026-06-01',
      endDate: '2026-06-09',
      opening: { balance: 1_000, taxBasis: 1_000, yieldAccumulated: 0 },
      accrueFromFirstDay: false,
      getSelicForDate: () => selic,
      contributions: [{ date: '2026-06-01', amount: 1_000 }],
      freezeWindows: [{ from: '2026-06-01', toExclusive: '2026-06-08' }],
      settlements: [{ date: '2026-06-08', amount: 149.9 }],
    });
    const tuesday = days.find((day) => day.referenceDate === '2026-06-02')!;
    const friday = days.find((day) => day.referenceDate === '2026-06-05')!;
    const settles = days.find((day) => day.referenceDate === '2026-06-08')!;
    const after = days.find((day) => day.referenceDate === '2026-06-09')!;
    expect(tuesday.yieldDay).toBe(0);
    expect(tuesday.balanceTotal).toBe(1_000);
    expect(friday.balanceTotal).toBe(1_000);
    const accrued = 1_000 * fimDailyFactor(1.139);
    expect(settles.principal).toBeCloseTo(850.1, 6);
    expect(settles.balanceTotal).toBeCloseTo(accrued - 149.9, 6);
    expect(after.principal).toBeCloseTo(850.1, 6);
    expect(after.balanceTotal).toBeCloseTo(settles.balanceTotal * fimDailyFactor(1.139), 6);
  });

  it('does not accrue a contribution made during a freeze until the freeze ends', () => {
    const { days } = generateFimYieldChunk({
      investment: 1_000,
      fromDate: '2026-06-01',
      endDate: '2026-06-09',
      opening: { balance: 1_000, taxBasis: 1_000, yieldAccumulated: 0 },
      accrueFromFirstDay: false,
      getSelicForDate: () => selic,
      contributions: [
        { date: '2026-06-01', amount: 1_000 },
        { date: '2026-06-03', amount: 200 },
      ],
      freezeWindows: [{ from: '2026-06-01', toExclusive: '2026-06-08' }],
      settlements: [{ date: '2026-06-08', amount: 100 }],
    });
    const wednesday = days.find((day) => day.referenceDate === '2026-06-03')!;
    const friday = days.find((day) => day.referenceDate === '2026-06-05')!;
    expect(wednesday.balanceTotal).toBe(1_200);
    expect(wednesday.yieldDay).toBe(0);
    expect(friday.balanceTotal).toBe(1_200);
    expect(friday.yieldDay).toBe(0);
  });
});

describe('addBusinessDays', () => {
  it('skips the weekend when counting five business days', () => {
    // Monday → next Monday
    expect(toYYYYMMDD(addBusinessDays(parseYYYYMMDD('2026-06-01'), 5))).toBe('2026-06-08');
    // Friday → next Friday
    expect(toYYYYMMDD(addBusinessDays(parseYYYYMMDD('2026-06-05'), 5))).toBe('2026-06-12');
  });
});

describe('selic resolve fallback', () => {
  it('falls back to previous valid day in map', () => {
    const map = new Map<string, SelicEntry>([
      ['2026-01-02', { date: '2026-01-02', selicAnual: 15, selicFactor: 1.149, source: 'bacen' }],
    ]);
    const resolved = resolveSelicForDate(map, '2026-01-05');
    expect(resolved.selicAnual).toBe(15);
    expect(resolved.source).toBe('fallback_db');
  });
});
