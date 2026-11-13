import { describe, expect, it } from 'vitest';
import { resolveAccruesOn } from './fim-timing.js';

function spInstant(ymd: string, hour: number, minute: number): Date {
  // Approximate SP local as fixed offset -03:00 (no DST since 2019)
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, hour + 3, minute));
}

describe('resolveAccruesOn', () => {
  it('before 10:00 uses D+1 B3', () => {
    // Monday 2026-06-01 09:59 SP → Tuesday
    expect(resolveAccruesOn(spInstant('2026-06-01', 9, 59))).toBe('2026-06-02');
  });

  it('between 10:00 and 17:30 inclusive uses the same B3 day', () => {
    expect(resolveAccruesOn(spInstant('2026-06-01', 10, 0))).toBe('2026-06-01');
    expect(resolveAccruesOn(spInstant('2026-06-01', 17, 30))).toBe('2026-06-01');
  });

  it('after 17:30 uses D+2 B3', () => {
    expect(resolveAccruesOn(spInstant('2026-06-01', 17, 31))).toBe('2026-06-03');
  });
});
