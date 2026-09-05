import { describe, expect, it } from 'vitest';
import { ClockTime, parseClockTime, parseOverlay, parseSpeedup } from './ClockTime';

describe('ClockTime', () => {
  it('parses YYYY-MM-DD-HH:MM:SS and YYYY-MM-DD as local midnight', () => {
    const full = parseClockTime('2026-09-01-12:30:00');
    expect(full).toBe(new Date(2026, 8, 1, 12, 30, 0).getTime());
    const day = parseClockTime('2026-09-01');
    expect(day).toBe(new Date(2026, 8, 1).getTime());
    expect(parseClockTime('nope')).toBeNull();
  });

  it('falls invalid speedup back to 1 and caps at 1e12', () => {
    expect(parseSpeedup(null)).toBe(1);
    expect(parseSpeedup('')).toBe(1);
    expect(parseSpeedup('-2')).toBe(1);
    expect(parseSpeedup('foo')).toBe(1);
    expect(parseSpeedup('10')).toBe(10);
    expect(parseSpeedup('1e20')).toBe(1e12);
  });

  it('parses overlay=inside and overlay=top', () => {
    expect(parseOverlay(null)).toBe(null);
    expect(parseOverlay('')).toBe(null);
    expect(parseOverlay('1')).toBe(null);
    expect(parseOverlay('inside')).toBe('inside');
    expect(parseOverlay('top')).toBe('top');
    expect(new ClockTime('overlay=inside').overlay).toBe('inside');
    expect(new ClockTime('overlay=top').overlay).toBe('top');
    expect(new ClockTime('').overlay).toBe(null);
  });

  it('advances nowMs as origin + speedup × elapsed', () => {
    const wall = 1_000_000;
    const clock = new ClockTime('time=2026-01-01-00:00:00&speedup=10', wall);
    const origin = new Date(2026, 0, 1).getTime();
    expect(clock.timeLapse).toBe(true);
    expect(clock.nowMs(wall + 2000)).toBe(origin + 20_000);
  });
});
