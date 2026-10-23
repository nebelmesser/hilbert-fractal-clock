import { describe, expect, it } from 'vitest';
import { curves } from '../curve/HilbertCurve';
import type { MapLayout, ThemeColors } from '../types';
import { civilDate, type LifePeriod } from './PeriodStore';
import { periodCellPixel, periodTimeline, projectPeriods } from './PeriodProjection';
import { findFreeTextPosition, glyphRect, placePeriodLabels, textRectsOverlap } from './PeriodLabels';

const theme = { future: 0xff161616, periodFutureBrightness: 0.18 } as ThemeColors;
const a: LifePeriod = { id: 'a', label: 'Учёба', from: '2026-01-01', to: '2026-01-04', color: '#ff0000' };
const b: LifePeriod = { id: 'b', label: 'Работа', from: '2026-01-03', to: '2026-01-06', color: '#0000ff' };

function layout(w = 8, h = 8, start = civilDate('2026-01-01'), dur = 86400000 / 8): MapLayout {
  return {
    grid: { w, h, cells: w * h, cellDur: dur, leftover: 0 },
    g: curves.get(w, h), levels: [], levelIds: [], labelLevel: 0, cssWidth: 640,
    cellStart: Float64Array.from({ length: w * h }, (_, i) => start + i * dur),
  };
}

describe('period projection and labels', () => {
  it('tests actual glyph bounds, not the line-height box or the owning period area', () => {
    const ctx = { font: '500 28px system-ui', measureText: () => ({
      width: 42, actualBoundingBoxLeft: 20, actualBoundingBoxRight: 21,
      actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 3,
    }) } as unknown as CanvasRenderingContext2D;
    const actual = glyphRect(ctx, '1984', 100, 65);
    expect(actual).toEqual({ x: 80, y: 57, w: 41, h: 11 });
    const title = { x: 50, y: 30, w: 100, h: 24 };
    expect(textRectsOverlap(actual, title)).toBe(false);
    expect(textRectsOverlap({ x: 79, y: 48, w: 42, h: 34 }, title)).toBe(true);
    expect(textRectsOverlap(actual, { x: 80, y: 40, w: 41, h: 17 })).toBe(false);
  });

  it('finds another position in a full-size region when only the first position is blocked', () => {
    const mask = new Uint8Array(100 * 100).fill(1);
    const title = { x: 25, y: 35, w: 50, h: 30 };
    const ink = { left: 15, right: 15, ascent: 7, descent: 3 };
    const position = findFreeTextPosition(mask, 100, 100, 0, 0, 1, 1, ink, [title], 50, 50)!;
    expect(position).not.toBeNull();
    const text = { x: position.x - ink.left, y: position.y - ink.ascent, w: 30, h: 10 };
    expect(textRectsOverlap(text, title)).toBe(false);
    expect(text.x).toBeGreaterThanOrEqual(0);
    expect(text.y).toBeGreaterThanOrEqual(0);
    expect(text.x + text.w).toBeLessThanOrEqual(100);
    expect(text.y + text.h).toBeLessThanOrEqual(100);
    expect(findFreeTextPosition(mask, 100, 100, 0, 0, 1, 1, ink, [{ x: 0, y: 0, w: 100, h: 100 }], 50, 50)).toBeNull();
  });

  it('splits partial, nested and coincident overlaps without losing original identities', () => {
    const segments = periodTimeline([a, b]);
    expect(segments.map((s) => s.ids)).toEqual([['a'], ['a', 'b'], ['b']]);
    expect(segments).toEqual(periodTimeline([b, a]));
    const nested = { ...b, from: '2026-01-02', to: '2026-01-03' };
    expect(periodTimeline([a, nested]).map((s) => s.ids)).toEqual([['a'], ['a', 'b'], ['a']]);
    expect(periodTimeline([a, { ...a, id: 'same' }])[0].ids).toEqual(['a', 'same']);
  });

  it('integrates adjacent days in a coarse cell without inventing a time overlap', () => {
    const first = { ...a, to: '2026-01-01' };
    const second = { ...b, from: '2026-01-02', to: '2026-01-02' };
    expect(periodTimeline([first, second]).map((s) => s.ids)).toEqual([['a'], ['b']]);
    const map = layout(1, 1, civilDate('2026-01-01'), 2 * 86400000);
    const projection = projectPeriods(map, [first, second], theme);
    expect(projection.colors[0]).toBe(0xffbc00bc); // equal linear-light red + blue
    expect(projection.coverage[0]).toBe(1);
    expect(projection.regions).toHaveLength(2);
    const partial = projectPeriods(map, [first], theme);
    expect(partial.coverage[0]).toBe(0.5);
    expect(partial.colors[0]).toBe(0xff0000ff);
  });

  it('keeps the same segment color on parent and refined cells and dims only future cells', () => {
    const main = layout();
    const inset = layout(8, 8, civilDate('2026-01-03'), 86400000 / 64);
    main.periods = projectPeriods(main, [a, b], theme);
    inset.periods = projectPeriods(inset, [b, a], theme);
    expect(main.periods.colors[16]).toBe(inset.periods.colors[0]);
    const start = main.cellStart[16], dur = main.grid.cellDur;
    expect(periodCellPixel(main, 16, 123, start + dur / 2)).toBe(123);
    expect(periodCellPixel(main, 16, 123, start + dur)).toBe(main.periods.colors[16]);
    expect(periodCellPixel(main, 16, 123, start - 1)).toBe(main.periods.futureColors[16]);
    expect(periodCellPixel(main, 63, 123, start)).toBe(123);
  });

  it('retains boundaries between equal colors and around a region, even if labels cannot fit', () => {
    const map = layout(8, 8);
    const first = { ...a, to: '2026-01-02' };
    const second = { ...b, color: a.color };
    map.periods = projectPeriods(map, [first, second], theme);
    expect(map.periods.colors[15]).toBe(map.periods.colors[16]);
    expect(map.periods.memberships[15]).not.toBe(map.periods.memberships[16]);
    const x = map.g.xs[15], y = map.g.ys[15], xx = map.g.xs[16], yy = map.g.ys[16];
    const edges = map.periods.edges;
    expect(edges.some((_, i) => i % 5 === 0 && (
      x !== xx ? edges[i + 1] === Math.max(x, xx) && edges[i + 3] === Math.max(x, xx) && edges[i + 2] === y
        : edges[i + 2] === Math.max(y, yy) && edges[i + 4] === Math.max(y, yy) && edges[i + 1] === x
    ))).toBe(true);
    expect(placePeriodLabels(map, 8, 8, null, (text) => text.length * 0.6)).toEqual([]);
    expect(edges.length).toBeGreaterThan(0);
  });

  it('places nested and coincident labels inside original regions without collisions', () => {
    const map = layout(32, 32, civilDate('2026-01-01'), 86400000 / 128);
    const same = { ...a, id: 'same', label: 'Переезд' };
    const nested = { ...b, label: 'Проект', from: '2026-01-02', to: '2026-01-03' };
    map.periods = projectPeriods(map, [a, same, nested], theme);
    const labels = placePeriodLabels(map, 800, 800, null, (text) => text.length * 0.6);
    expect(labels).toHaveLength(3);
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) expect(textRectsOverlap(labels[i], labels[j])).toBe(false);
      const region = map.periods.regions.find((r) => r.period.id === labels[i].id)!;
      const label = labels[i];
      const cw = 800 / map.grid.w, ch = 800 / map.grid.h;
      for (let y = Math.floor(label.y / ch); y < Math.ceil((label.y + label.h) / ch); y++) {
        for (let x = Math.floor(label.x / cw); x < Math.ceil((label.x + label.w) / cw); x++) {
          const cell = map.g.at[y * map.grid.w + x];
          expect(cell).toBeGreaterThanOrEqual(region.i0);
          expect(cell).toBeLessThan(region.i1);
        }
      }
    }
    expect(placePeriodLabels(map, 800, 800, null, (text) => text.length * 0.6)).toEqual(labels);
  });
});
