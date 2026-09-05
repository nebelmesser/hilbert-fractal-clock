import { describe, expect, it } from 'vitest';
import type { ThemeColors } from '../types';
import type { MapLayout, TimeUnit } from '../types';
import { boundStrokeFromFill, cellFillPixel, innerCurId, l1RampSpan, lerpHslPacked, lerpPacked, lerpRampPacked, packedToRgb, pastBlockPixel, pastColorAt, resolveInner, resolveRamp, rgbToHsl } from './pastRamp';

const violet = 0xffb8689a; // #9a68b8
const mauve = 0xff978494; // #948497
const pink = 0xffa4a4c7; // #c7a4a4
const live = 0xff2020ff; // #ff2020

const theme = {
  pastFrom: violet,
  pastMid: mauve,
  pastTo: pink,
  pastSatDip: 0.5,
  curPast: live,
  curInner: 0xff6060e0,
  curFuture: 0xff22223a,
  future: 0xff161616,
  past: 0xffa6a6a6,
  head: 0xff0000ff,
} as ThemeColors;

describe('pastRamp', () => {
  it('keeps the live first-level block on --cur-past, not a ramp stop', () => {
    expect(pastBlockPixel(theme, 15, 0, 15, 15, 15)).toBe(live);
    expect(pastBlockPixel(theme, 14, 0, 15, 15, 15)).not.toBe(live);
  });

  it('hits --past-mid at the elapsed midpoint', () => {
    expect(pastBlockPixel(theme, 8, 0, 16, 16, 16)).toBe(mauve);
  });

  it('steps earliest violet → mid → near-past pink through magenta when the range is elapsed', () => {
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
    expect(first).toBe(lerpRampPacked(violet, mauve, pink, 1 - 4 / 15, theme.pastSatDip));
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

  it('uses the last map block as --past-to when nothing is live', () => {
    expect(pastBlockPixel(theme, 23, 0, 23, 23, null)).toBe(pink);
  });

  it('lerpRampPacked is from / mid / to at 0 / 0.5 / 1', () => {
    expect(lerpRampPacked(violet, mauve, pink, 0, 0.5)).toBe(violet);
    expect(lerpRampPacked(violet, mauve, pink, 0.5, 0.5)).toBe(mauve);
    expect(lerpRampPacked(violet, mauve, pink, 1, 0.5)).toBe(pink);
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
    expect(at(4)).toBe(live);
    expect(at(0)).toBe(at(0));
  });

  it('resolveRamp on an inset keeps the parent first-level span', () => {
    const unit = { index: (t: number) => Math.floor(t / 3600) } as TimeUnit;
    const parentIds = Int32Array.from([0, 0, 1, 1]);
    const insetIds = Int32Array.from([10, 11, 12]);
    const layout = {
      grid: { cells: 3 },
      levelIds: [insetIds],
      ramp: { minId: 0, maxId: 23, ids: parentIds, unit, start: 0, end: 86400 },
    } as MapLayout;
    expect(resolveRamp(layout, 5)).toEqual({ ids: parentIds, minId: 0, maxId: 23, pinkId: 5 });
    expect(resolveRamp(layout, null)).toEqual({ ids: parentIds, minId: 0, maxId: 23, pinkId: 23 });
  });

  it('boundStrokeFromFill uses white on dark fills and black on pastels', () => {
    expect(packedToRgb(pink)).toBe('rgb(199,164,164)');
    expect(boundStrokeFromFill(0xff161616, 0.55)).toBe('rgba(255,255,255,0.55)');
    expect(boundStrokeFromFill(pink, 0.28)).toBe('rgba(0,0,0,0.28)');
  });

  it('paints only the elapsed live inner unit; its future stays --cur-future', () => {
    const at = pastColorAt(theme, 0, 15, 8, 8);
    expect(cellFillPixel(theme, 100, 95, 10, 8, 8, 3, 3, at)).toBe(theme.head);
    expect(cellFillPixel(theme, 100, 0, 10, 8, 8, 3, 3, at)).toBe(theme.curInner);
    expect(cellFillPixel(theme, 100, 200, 10, 8, 8, 3, 3, at)).toBe(theme.curFuture);
    expect(cellFillPixel(theme, 100, 0, 10, 8, 8, 2, 3, at)).toBe(theme.curPast);
    expect(cellFillPixel(theme, 100, 200, 10, 8, 8, 2, 3, at)).toBe(theme.curFuture);
    expect(cellFillPixel(theme, 100, 200, 10, 7, 8, 2, 3, at)).toBe(theme.future);
  });

  it('resolveInner prefers the parent L2 share so the inset matches the main map', () => {
    const day = { id: 'day', index: (t: number) => Math.floor(t / 86400) } as TimeUnit;
    const hour = { id: 'hour', index: (t: number) => Math.floor(t / 3600) } as TimeUnit;
    const parentDays = Int32Array.from([4, 4, 5]);
    const layout = {
      grid: { cells: 3, cellDur: 3600 },
      cellStart: Float64Array.from([0, 3600, 7200]),
      levels: [hour],
      levelIds: [Int32Array.from([0, 1, 2])],
      inner: { unit: day, ids: parentDays },
    } as MapLayout;
    expect(resolveInner(layout)).toEqual({ unit: day, ids: parentDays });
    expect(innerCurId(layout, 4000)).toBe(0);
    expect(innerCurId(layout, 20000)).toBe(null);
  });
});
