import { describe, expect, it } from 'vitest';
import { LABEL_MAX_PX, LABEL_PADDING_EM } from '../constants';
import { HilbertCurve } from '../curve/HilbertCurve';
import { LabelPlacer } from '../labels/LabelPlacer';
import { Theme } from '../theme/Theme';
import { fillUnitIds, UNITS } from '../time/units';
import type { CellBox, MapLayout } from '../types';
import { LabelRenderer } from './LabelRenderer';

/** Canvas measurements scale with the current font, as they do in a browser. */
function recordingContext(opticalSizing = false) {
  const drawn: Array<{ text: string; x: number; y: number; width: number; height: number; size: number; color: string }> = [];
  const ctx = {
    font: '', textAlign: '', textBaseline: '', fillStyle: '',
    clearRect() {},
    measureText(text: string) {
      const width = text.length * this.fontSize() * 0.56 * (opticalSizing && this.fontSize() < 24 ? 1.06 : 1);
      return { width, actualBoundingBoxLeft: -0.02 * this.fontSize(),
        actualBoundingBoxRight: width, actualBoundingBoxAscent: 0.72 * this.fontSize(),
        actualBoundingBoxDescent: 0.04 * this.fontSize() };
    },
    fontSize() { return Number(this.font.match(/([\d.]+)px/)?.[1] || 0); },
    fillText(text: string, x: number, y: number) {
      const m = this.measureText(text);
      drawn.push({ text, x: x + (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2,
        y: y + (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2,
        width: m.actualBoundingBoxLeft + m.actualBoundingBoxRight,
        height: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent, size: this.fontSize(), color: this.fillStyle });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn };
}

function octoberLayout(w: number, h: number, cellDur: number): MapLayout {
  const start = new Date(2026, 9, 1).getTime();
  const end = new Date(2026, 10, 1).getTime();
  const cells = Math.ceil((end - start) / cellDur);
  const cellStart = Float64Array.from({ length: cells }, (_, i) => start + i * cellDur);
  const day = UNITS.find((u) => u.id === 'day')!;
  return {
    grid: { w, h, cells, cellDur, leftover: w * h - cells },
    g: new HilbertCurve().get(w, h),
    cellStart, levels: [day], levelIds: [fillUnitIds(day, cellDur, cells, cellStart)],
    labelLevel: 0, cssWidth: w,
  };
}

describe('LabelRenderer', () => {
  it('labels a live unit represented by only its current cell', () => {
    const start = new Date(2026, 9, 23, 12).getTime();
    const minute = UNITS.find((unit) => unit.id === 'minute')!;
    const layout: MapLayout = {
      grid: { w: 1, h: 1, cells: 1, cellDur: 60000, leftover: 0 },
      g: new HilbertCurve().get(1, 1), cellStart: new Float64Array([start]),
      levels: [minute], levelIds: [new Int32Array([minute.index(start)])], labelLevel: 0, cssWidth: 100,
    };
    const { ctx, drawn } = recordingContext();
    new LabelRenderer(new LabelPlacer()).paint(ctx, layout, 100, 100, start + 30000,
      new Theme().colors, false, null, null);
    expect(drawn).toHaveLength(1);
    expect(drawn[0].size).toBe(LABEL_MAX_PX);
  });

  it('reserves the full margin using actual-size metrics when the font has optical sizing', () => {
    const layout = octoberLayout(668, 1004, 4000);
    const { ctx, drawn } = recordingContext(true);
    const scale = 320 / 668;
    const result = new LabelRenderer(new LabelPlacer()).paint(
      ctx, layout, 320, 1004 * scale, new Date(2026, 9, 23, 18).getTime(),
      new Theme().colors, false, null, null, { x: 498, y: 500, w: 170, h: 126 },
    );
    const label = drawn.find((d) => d.text === '23rd')!;
    const live = result.liveLabel!;
    const clearance = Math.max(...live.geometry.rooms.map((room) => Math.min(
      label.x - label.width / 2 - (live.ox + room.x) * scale,
      (live.ox + room.x + room.w) * scale - label.x - label.width / 2,
      label.y - label.height / 2 - (live.oy + room.y) * scale,
      (live.oy + room.y + room.h) * scale - label.y - label.height / 2,
    )));
    expect(clearance).toBeGreaterThanOrEqual(label.size * LABEL_PADDING_EM - 1e-6);
    expect(drawn).toHaveLength(31);
    expect(new Set(drawn.map((d) => d.size)).size).toBe(1);
  });
  it.each([668, 320])('centers the live day inside the zoom frame at CSS width %i, on one background', (cssW) => {
    const layout = octoberLayout(668, 1004, 4000);
    const scale = cssW / 668;
    const colors = { ...new Theme().colors, labelLive: 'past-live', labelLiveEmpty: 'future-live' };
    for (const hour of [0, 6, 12, 18, 20, 22]) {
      const { ctx, drawn } = recordingContext();
      const now = new Date(2026, 9, 23, hour).getTime();
      new LabelRenderer(new LabelPlacer()).paint(
        ctx, layout, cssW, 1004 * scale, now, colors, false, null, null, { x: 500, y: 500, w: 168, h: 126 },
      );
      const label = drawn.find((d) => d.text === '23rd')!;
      expect(drawn).toHaveLength(31);
      expect((label.x - label.width / 2) / scale, `hour ${hour}`).toBeGreaterThan(502);
      expect((label.x + label.width / 2) / scale, `hour ${hour}`).toBeLessThan(666);
      expect((label.y - label.height / 2) / scale, `hour ${hour}`).toBeGreaterThan(502);
      expect((label.y + label.height / 2) / scale, `hour ${hour}`).toBeLessThan(624);
      if (hour === 12) expect(label.color).toBe('future-live');
      for (let y = Math.floor((label.y - label.height / 2) / scale); y < (label.y + label.height / 2) / scale; y++) {
        for (let x = Math.floor((label.x - label.width / 2) / scale); x < (label.x + label.width / 2) / scale; x++) {
          const i = layout.g.at[y * 668 + x];
          expect(layout.levels[0].label(layout.cellStart[i] + 2000)).toBe('23rd');
          if (label.color === 'past-live') expect(layout.cellStart[i] + 4000).toBeLessThanOrEqual(now);
          else expect(layout.cellStart[i]).toBeGreaterThan(now);
        }
      }
    }
  });

  it('keeps timelapse placements pinned to the full region across the fill front', () => {
    const layout = octoberLayout(668, 1004, 4000);
    const renderer = new LabelRenderer(new LabelPlacer());
    const first = recordingContext();
    const result = renderer.paint(first.ctx, layout, 668, 1004, new Date(2026, 9, 23, 6).getTime(),
      new Theme().colors, true, null, null, { x: 500, y: 500, w: 168, h: 126 });
    const second = recordingContext();
    renderer.paint(second.ctx, layout, 668, 1004, new Date(2026, 9, 23, 20).getTime(),
      new Theme().colors, true, null, result.labelPlaces, { x: 500, y: 500, w: 168, h: 126 });
    expect(second.drawn.map(({ text, x, y, size }) => ({ text, x, y, size })))
      .toEqual(first.drawn.map(({ text, x, y, size }) => ({ text, x, y, size })));
  });
  it.each([
    { zoomBox: null, timeLapse: false, cssW: 668 },
    { zoomBox: { x: 500, y: 500, w: 168, h: 126 }, timeLapse: false, cssW: 668 },
    { zoomBox: null, timeLapse: true, cssW: 668 },
    { zoomBox: null, timeLapse: false, cssW: 320 },
  ])('labels every day on the reported portrait month grid (%j)',
    ({ zoomBox, timeLapse, cssW }: { zoomBox: CellBox | null; timeLapse: boolean; cssW: number }) => {
      const layout = octoberLayout(668, 1004, 4000);
      const { ctx, drawn } = recordingContext();
      const scale = cssW / 668;
      new LabelRenderer(new LabelPlacer()).paint(
        ctx, layout, cssW, 1004 * scale, new Date(2026, 9, 23, 12).getTime(),
        new Theme().colors, timeLapse, null, null, zoomBox,
      );
      expect(drawn).toHaveLength(31);
      expect(new Set(drawn.map((d) => d.size)).size).toBe(1);
      // Use the available room, while retaining the explicit maximum size.
      expect(drawn[0].size).toBeGreaterThanOrEqual(Math.min(LABEL_MAX_PX, 26 * scale));
      expect(drawn[0].size).toBeLessThanOrEqual(LABEL_MAX_PX);

      // Every glyph rectangle stays in its own region, including around the frame.
      for (const label of drawn) {
        for (let y = Math.floor((label.y - label.height / 2) / scale); y < (label.y + label.height / 2) / scale; y++) {
          for (let x = Math.floor((label.x - label.width / 2) / scale); x < (label.x + label.width / 2) / scale; x++) {
            const i = layout.g.at[y * layout.grid.w + x];
            expect(i).toBeGreaterThanOrEqual(0);
            expect(layout.levels[0].label(layout.cellStart[i] + 2000)).toBe(label.text);
          }
        }
      }
    },
  );

  it('keeps all month names at a shared font, using abbreviations where needed', () => {
    const layout = octoberLayout(668, 1004, 4000);
    const month = UNITS.find((u) => u.id === 'month')!;
    // Reuse day-shaped regions, with the twelve month names repeated across them.
    const day = layout.levels[0];
    layout.levels = [{ ...day, id: 'month', label: (t) => month.label(new Date(2026, new Date(t).getDate() % 12, 1).getTime()) }];
    const { ctx, drawn } = recordingContext();
    new LabelRenderer(new LabelPlacer()).paint(
      ctx, layout, 320, 1004 * 320 / 668, new Date(2026, 9, 23, 12).getTime(),
      new Theme().colors, false, null, null,
    );
    expect(drawn).toHaveLength(31);
    expect(new Set(drawn.map((d) => d.size)).size).toBe(1);
    expect(drawn.some((d) => d.text.length === 3)).toBe(true);
    expect(drawn.some((d) => d.text.length > 3)).toBe(true);
  });
});
