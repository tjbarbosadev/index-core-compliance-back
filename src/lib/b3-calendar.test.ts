import { describe, expect, it } from 'vitest';
import { addB3BusinessDaysFromYmd, isB3BusinessDay, isB3Holiday } from './b3-calendar.js';

describe('b3-calendar', () => {
  it('treats Carnival 2026 as a holiday', () => {
    expect(isB3Holiday('2026-02-16')).toBe(true);
    expect(isB3Holiday('2026-02-17')).toBe(true);
  });

  it('skips B3 holidays when counting five business days', () => {
    // Thu 2026-04-02 → skip Good Friday 04-03, Tiradentes weekend area → +5 B3 days
    // From Mon 2026-04-20: Tue 21 is Tiradentes holiday → settles further
    expect(addB3BusinessDaysFromYmd('2026-04-20', 5)).toBe('2026-04-28');
  });

  it('rejects weekends as business days', () => {
    expect(isB3BusinessDay(new Date('2026-06-06T12:00:00.000Z'))).toBe(false);
    expect(isB3BusinessDay(new Date('2026-06-01T12:00:00.000Z'))).toBe(true);
  });
});
