import { describe, expect, it } from 'vitest';
import { formatDur, ordinalDay, romanNumeral } from './format';

describe('format', () => {
  it('formats nice durations without raw millisecond dumps', () => {
    expect(formatDur(100)).toBe('0.1s');
    expect(formatDur(250)).toBe('0.25s');
    expect(formatDur(86_400_000)).toBe('1d');
    expect(formatDur(86_400_000 + 4 * 3_600_000)).toBe('1d 4h');
    expect(formatDur(112_500)).not.toMatch(/112500/);
  });

  it('builds ordinals and roman centuries', () => {
    expect(ordinalDay(1)).toBe('1st');
    expect(ordinalDay(11)).toBe('11th');
    expect(ordinalDay(23)).toBe('23rd');
    expect(romanNumeral(21)).toBe('XXI');
  });
});
