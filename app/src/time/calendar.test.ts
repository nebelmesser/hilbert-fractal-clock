import { describe, expect, it } from 'vitest';
import { UNIX32_END } from '../constants';
import {
  advanceEndedCustom, inclusiveDatesToRange, rangeForMode, startOfDay, startOfMonth, startOfYear,
} from './calendar';

describe('calendar presets', () => {
  it('uses local civil bounds for today / month / year', () => {
    const now = new Date(2026, 8, 2, 15, 0, 0).getTime();
    const d = new Date(now);
    expect(rangeForMode('today', now, null)).toEqual({
      start: startOfDay(d),
      end: new Date(2026, 8, 3).getTime(),
    });
    expect(rangeForMode('month', now, null)).toEqual({
      start: startOfMonth(d),
      end: new Date(2026, 9, 1).getTime(),
    });
    expect(rangeForMode('year', now, null)).toEqual({
      start: startOfYear(d),
      end: new Date(2027, 0, 1).getTime(),
    });
  });

  it('maps epoch to [0, UNIX32_END)', () => {
    expect(rangeForMode('epoch', Date.now(), null)).toEqual({ start: 0, end: UNIX32_END });
  });

  it('turns inclusive dates into a half-open engine range', () => {
    const from = new Date(2026, 8, 1).getTime();
    const to = new Date(2026, 8, 3).getTime();
    expect(inclusiveDatesToRange(from, to)).toEqual({
      start: from,
      end: new Date(2026, 8, 4).getTime(),
    });
  });

  it('rolls a finished custom window forward by its own length', () => {
    const start = new Date(2026, 7, 1).getTime();
    const end = new Date(2026, 8, 1).getTime();
    const now = new Date(2026, 9, 15).getTime();
    const next = advanceEndedCustom({ start, end }, now, false);
    expect(next).not.toBeNull();
    expect(next!.end - next!.start).toBe(end - start);
    expect(now).toBeGreaterThanOrEqual(next!.start);
    expect(now).toBeLessThan(next!.end);
  });
});
