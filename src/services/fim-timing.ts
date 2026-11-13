import { addB3BusinessDays, nextB3BusinessDayOnOrAfter } from '../lib/b3-calendar.js';
import { getCalendarDateInSaoPaulo, toYYYYMMDD } from './quota-calculator.js';

const CUTOFF_MORNING_MIN = 10 * 60;
const CUTOFF_AFTERNOON_MIN = 17 * 60 + 30;

function saoPauloClock(now = new Date()): { ymd: string; minutes: number; date: Date } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  const d = Number(parts.find((p) => p.type === 'day')?.value);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  return {
    ymd: `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d
      .toString()
      .padStart(2, '0')}`,
    minutes: hour * 60 + minute,
    date: new Date(Date.UTC(y, m - 1, d, 12)),
  };
}

/**
 * Ipe cutoff (America/Sao_Paulo):
 * - before 10:00 → D+1 B3
 * - 10:00–17:30 → same B3 business day (or next if today is not)
 * - after 17:30 → D+2 B3
 */
export function resolveAccruesOn(now = new Date()): string {
  const { minutes, date } = saoPauloClock(now);
  if (minutes < CUTOFF_MORNING_MIN) {
    return toYYYYMMDD(addB3BusinessDays(date, 1));
  }
  if (minutes <= CUTOFF_AFTERNOON_MIN) {
    return toYYYYMMDD(nextB3BusinessDayOnOrAfter(date));
  }
  return toYYYYMMDD(addB3BusinessDays(date, 2));
}

export function todaySaoPauloYmd(now = new Date()): string {
  return toYYYYMMDD(getCalendarDateInSaoPaulo(now));
}

export { saoPauloClock };
