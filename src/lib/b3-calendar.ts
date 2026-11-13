/**
 * Calendário de pregão B3 (dias sem sessão).
 * Fonte: Anbima / B3 — atualizado 2026-11-13. Inclui Consciência Negra (20/11).
 * Manter 3 anos à frente; revisar anualmente.
 */

const B3_HOLIDAYS = new Set<string>([
  // 2025
  '2025-01-01',
  '2025-03-03',
  '2025-03-04',
  '2025-04-18',
  '2025-04-21',
  '2025-05-01',
  '2025-06-19',
  '2025-09-07',
  '2025-10-12',
  '2025-11-02',
  '2025-11-15',
  '2025-11-20',
  '2025-12-25',
  // 2026
  '2026-01-01',
  '2026-02-16',
  '2026-02-17',
  '2026-04-03',
  '2026-04-21',
  '2026-05-01',
  '2026-06-04',
  '2026-09-07',
  '2026-10-12',
  '2026-11-02',
  '2026-11-15',
  '2026-11-20',
  '2026-12-25',
  // 2027
  '2027-01-01',
  '2027-02-08',
  '2027-02-09',
  '2027-03-26',
  '2027-04-21',
  '2027-05-01',
  '2027-05-27',
  '2027-09-07',
  '2027-10-12',
  '2027-11-02',
  '2027-11-15',
  '2027-11-20',
  '2027-12-25',
]);

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseYmd(ymd: string): Date {
  return new Date(`${ymd}T12:00:00.000Z`);
}

function addCalendarDays(date: Date, n: number): Date {
  const out = new Date(date);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

function isWeekdayUtc(date: Date): boolean {
  const weekday = date.getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

export function isB3Holiday(dateStr: string): boolean {
  return B3_HOLIDAYS.has(dateStr);
}

/** Dia útil B3: segunda–sexta e fora da lista de feriados de pregão. */
export function isB3BusinessDay(date: Date): boolean {
  if (!isWeekdayUtc(date)) return false;
  return !isB3Holiday(toYmd(date));
}

/** Avança `n` dias úteis B3 a partir de `date` (não conta o próprio dia). */
export function addB3BusinessDays(date: Date, n: number): Date {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error('addB3BusinessDays exige n inteiro >= 0');
  }
  let out = new Date(date);
  let remaining = n;
  while (remaining > 0) {
    out = addCalendarDays(out, 1);
    if (isB3BusinessDay(out)) remaining -= 1;
  }
  return out;
}

/** Próximo dia útil B3 em ou após `date` (inclusive). */
export function nextB3BusinessDayOnOrAfter(date: Date): Date {
  let out = new Date(date);
  while (!isB3BusinessDay(out)) {
    out = addCalendarDays(out, 1);
  }
  return out;
}

export function addB3BusinessDaysFromYmd(ymd: string, n: number): string {
  return toYmd(addB3BusinessDays(parseYmd(ymd), n));
}

export function toB3Ymd(date: Date): string {
  return toYmd(date);
}
