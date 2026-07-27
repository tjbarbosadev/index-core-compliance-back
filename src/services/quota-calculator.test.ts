import { describe, expect, it } from 'vitest';
import {
  applyIncomeTax,
  calculateCompoundAmount,
  generateDailyYields,
  getVisualizationDate,
  mapDataJsonQuota,
  parseYYYYMMDD,
  toSelicFactor,
  toYYYYMMDD,
  SELIC_SPREAD_PP,
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
