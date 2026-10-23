import { describe, expect, it } from 'vitest';
import { LabelPlacer } from '../labels/LabelPlacer';
import { glyphRect, textRectsOverlap } from '../periods/PeriodLabels';
import { projectPeriods } from '../periods/PeriodProjection';
import { civilDate, type LifePeriod } from '../periods/PeriodStore';
import { Theme } from '../theme/Theme';
import type { MapLayout, TimeUnit } from '../types';
import { LabelRenderer } from './LabelRenderer';

describe('calendar labels around personal titles', () => {
  it.each([[20, 20, 2], [40, 10, 1]])('labels every complete region with a narrow or outlier slot (%i × %i)', (w, h, band) => {
    // Ten equal-area calendar regions: two long strips and eight rectangles.
    // The strips can fit the layer's year text but not its traditional square slot.
    const cells = w * h, dur = 86400000;
    const coords: Array<{ x: number; y: number; id: number }> = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      coords.push({ x, y, id: y < band ? 0 : y >= h - band ? 9 : 1 + Math.floor((y - band) / 4) * (w / 10) + Math.floor(x / 10) });
    }
    coords.sort((a, b) => a.id - b.id || a.y - b.y || a.x - b.x);
    const ids = Int32Array.from(coords, (p) => p.id);
    const at = new Int32Array(cells);
    coords.forEach((p, i) => { at[p.y * w + p.x] = i; });
    const start = civilDate('2026-01-01');
    const index = (t: number) => Math.floor((t - start) / (dur * 40));
    const unit: TimeUnit = {
      id: 'year', typical: dur * 40, index, start: (t) => start + index(t) * dur * 40,
      end: (t) => start + (index(t) + 1) * dur * 40,
      label: (t) => String(1984 + ids[Math.floor((t - start) / dur)]),
    };
    const layout: MapLayout = {
      grid: { w, h, cells, cellDur: dur, leftover: 0 },
      g: { n: cells, xs: Uint16Array.from(coords, (p) => p.x), ys: Uint16Array.from(coords, (p) => p.y), at },
      levels: [unit], levelIds: [ids], labelLevel: 0, cssWidth: w * 20,
      cellStart: Float64Array.from({ length: cells }, (_, i) => start + i * dur),
    };
    const period: LifePeriod = { id: 'home', label: 'Home', from: '2026-01-01', to: '2027-12-31', color: '#91b9a4' };
    const theme = new Theme().colors;
    layout.periods = projectPeriods(layout, [period], theme);
    const drawn: Array<{ text: string; rect: ReturnType<typeof glyphRect>; alpha: number }> = [];
    const savedFonts: string[] = [];
    const ctx = {
      font: '500 16px system-ui', textAlign: 'center', textBaseline: 'middle', fillStyle: '',
      clearRect() {}, save() { savedFonts.push(this.font); }, restore() { this.font = savedFonts.pop()!; },
      measureText(text: string) {
        const size = Number(this.font.match(/([\d.]+)px/)![1]);
        return { width: text.length * size * 0.6, actualBoundingBoxLeft: text.length * size * 0.3,
          actualBoundingBoxRight: text.length * size * 0.3, actualBoundingBoxAscent: size * 0.5, actualBoundingBoxDescent: size * 0.2 };
      },
      fillText(text: string, x: number, y: number) { drawn.push({ text, rect: glyphRect(this as unknown as CanvasRenderingContext2D, text, x, y),
        alpha: Number(String(this.fillStyle).match(/,([\d.]+)\)$/)?.[1]) }); },
    } as unknown as CanvasRenderingContext2D;
    new LabelRenderer(new LabelPlacer()).paint(ctx, layout, w * 20, h * 20, civilDate('2028-01-01'), theme, false, null, null);
    expect(drawn.map((d) => d.text)).toContain('Home');
    for (let year = 1984; year <= 1993; year++) expect(drawn.map((d) => d.text)).toContain(String(year));
    const title = drawn.find((d) => d.text === 'Home')!.rect;
    for (const label of drawn.filter((d) => d.text !== 'Home')) expect(textRectsOverlap(label.rect, title)).toBe(false);
    expect(drawn.find((d) => d.text === 'Home')!.alpha).toBeGreaterThan(Math.max(...drawn.filter((d) => d.text !== 'Home').map((d) => d.alpha)));
  });
});
