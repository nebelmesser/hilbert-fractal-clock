import { describe, expect, it } from 'vitest';
import { UNITS } from './units';

describe('UNITS ladder', () => {
  it('keeps start < end and a stable index inside each interval', () => {
    const t = new Date(2026, 8, 2, 14, 30, 15, 250).getTime();
    for (const u of UNITS) {
      const a = u.start(t);
      const b = u.end(t);
      expect(a).toBeLessThan(b);
      expect(u.index(a)).toBe(u.index(t));
      expect(u.index(b - 1)).toBe(u.index(t));
    }
  });

  it('labels centuries in roman, days as ordinals, seconds as HH:MM:SS', () => {
    const century = UNITS.find((u) => u.id === 'century')!;
    const day = UNITS.find((u) => u.id === 'day')!;
    const second = UNITS.find((u) => u.id === 'second')!;
    expect(century.label(new Date(2001, 0, 1).getTime())).toBe('XXI');
    expect(day.label(new Date(2026, 8, 1).getTime())).toBe('1st');
    expect(day.label(new Date(2026, 8, 2).getTime())).toBe('2nd');
    expect(second.label(new Date(2026, 0, 1, 4, 5, 6).getTime())).toBe('04:05:06');
  });
});
