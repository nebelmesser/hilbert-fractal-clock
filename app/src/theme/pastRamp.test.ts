import { describe, expect, it } from 'vitest';
import type { ThemeColors } from '../types';
import { boundStrokeFromFill, l1RampSpan, lerpHslPacked, lerpPacked, packedToRgb, pastBlockPixel, pastColorAt, rgbToHsl } from './pastRamp';

const violet = 0xffb8689a; // #9a68b8
const pink = 0xffa4a4c7; // #c7a4a4

const theme = {
  pastFrom: violet,
  pastSatDip: 0.5,
  curPast: pink,
} as ThemeColors;

describe('pastRamp', () => {
  it('keeps the live first-level block on --cur-past', () => {
    expect(pastBlockPixel(theme, 15, 0, 15, 15, 15)).toBe(pink);
  });

  it('steps earliest violet → live pink through magenta when the range is elapsed', () => {
    expect(pastBlockPixel(theme, 0, 0, 15, 15, 15)).toBe(violet);
    const mid = pastBlockPixel(theme, 7, 0, 15, 15, 15);
    expect(mid).not.toBe(violet);
    expect(mid).not.toBe(pink);
    const [h] = rgbToHsl(mid & 255, (mid >>> 8) & 255, (mid >>> 16) & 255);
    expect(h).toBeGreaterThan(280);
    expect(h).toBeLessThan(350);
    const late = pastBlockPixel(theme, 14, 0, 15, 15, 15);
    expect(late & 255).toBeGreaterThan(mid & 255);
  });

  it('uses only the last quarter of the ramp when a quarter is filled', () => {
    const first = pastBlockPixel(theme, 0, 0, 15, 4, 4);
    expect(first).toBe(lerpHslPacked(violet, pink, 1 - 4 / 15, theme.pastSatDip));
    expect(first).not.toBe(violet);
    expect(first).not.toBe(pink);
  });

  it('lerpHslPacked stays on the violet–pink hue arc', () => {
    const mid = lerpHslPacked(violet, pink, 0.5, 0.5);
    const [h] = rgbToHsl(mid & 255, (mid >>> 8) & 255, (mid >>> 16) & 255);
    expect(h).toBeGreaterThan(280);
    expect(h).toBeLessThan(350);
  });

  it('dips midpoint saturation without leaving the hue arc', () => {
    const linear = lerpHslPacked(violet, pink, 0.5, 0);
    const dipped = lerpHslPacked(violet, pink, 0.5, 0.5);
    const [, sLin] = rgbToHsl(linear & 255, (linear >>> 8) & 255, (linear >>> 16) & 255);
    const [hDip, sDip] = rgbToHsl(dipped & 255, (dipped >>> 8) & 255, (dipped >>> 16) & 255);
    expect(sDip).toBeLessThan(sLin);
    expect(hDip).toBeGreaterThan(280);
    expect(hDip).toBeLessThan(350);
  });

  it('uses the last map block as pink when nothing is live', () => {
    expect(pastBlockPixel(theme, 23, 0, 23, 23, null)).toBe(pink);
  });

  it('takes min/max from first-level ids and pins pink to the live id', () => {
    const ids = Int32Array.from([10, 11, 12, 11]);
    expect(l1RampSpan(ids, 4, 11)).toEqual({ minId: 10, maxId: 12, pinkId: 11 });
  });

  it('lerpPacked is a at 0 and b at 1', () => {
    expect(lerpPacked(violet, pink, 0)).toBe(violet);
    expect(lerpPacked(violet, pink, 1)).toBe(pink);
  });

  it('pastColorAt matches pastBlockPixel and reuses the blended pixel', () => {
    const at = pastColorAt(theme, 0, 15, 4, 4);
    expect(at(0)).toBe(pastBlockPixel(theme, 0, 0, 15, 4, 4));
    expect(at(4)).toBe(pink);
    expect(at(0)).toBe(at(0));
  });

  it('boundStrokeFromFill uses white on dark fills and black on pastels', () => {
    expect(packedToRgb(pink)).toBe('rgb(199,164,164)');
    expect(boundStrokeFromFill(0xff161616, 0.55)).toBe('rgba(255,255,255,0.55)');
    expect(boundStrokeFromFill(pink, 0.28)).toBe('rgba(0,0,0,0.28)');
  });
});
