import { LABEL_FONT, LABEL_FONT_STACK } from '../constants';
import { eraseFrameBand, forEachHistRect, maskCentroid, zoomFramePadCells } from '../labels/LabelPlacer';
import { boundStrokeFromFill } from '../theme/pastRamp';
import type { CellBox, MapLayout, ThemeColors } from '../types';

export type TextRect = { x: number; y: number; w: number; h: number };
export type PeriodLabel = TextRect & { id: string; text: string; font: number; sample: number; cx: number; cy: number };
type Ink = { left: number; right: number; ascent: number; descent: number };
const TEXT_GAP = 0;

export function glyphInk(ctx: CanvasRenderingContext2D, text: string): Ink {
  const metrics = ctx.measureText(text);
  const size = Number(ctx.font.match(/([\d.]+)px/)?.[1] ?? 16);
  return {
    left: metrics.actualBoundingBoxLeft ?? metrics.width / 2,
    right: metrics.actualBoundingBoxRight ?? metrics.width / 2,
    ascent: metrics.actualBoundingBoxAscent ?? size * 0.6,
    descent: metrics.actualBoundingBoxDescent ?? size * 0.6,
  };
}

export function glyphRect(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): TextRect {
  const ink = glyphInk(ctx, text);
  return { x: x - ink.left, y: y - ink.ascent, w: ink.left + ink.right, h: ink.ascent + ink.descent };
}

export function textRectsOverlap(a: TextRect, b: TextRect, gap = TEXT_GAP): boolean {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x &&
    a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}

/** Move a fixed-size glyph inside its own region only when its first position collides. */
export function findFreeTextPosition(
  mask: Uint8Array, bw: number, bh: number, ox: number, oy: number, cw: number, ch: number,
  ink: Ink, reserved: readonly TextRect[], preferredX: number, preferredY: number,
): { x: number; y: number } | null {
  const available = new Uint8Array(mask);
  for (const box of reserved) {
    const x0 = Math.max(0, Math.floor(box.x / cw) - ox), x1 = Math.min(bw, Math.ceil((box.x + box.w) / cw) - ox);
    const y0 = Math.max(0, Math.floor(box.y / ch) - oy), y1 = Math.min(bh, Math.ceil((box.y + box.h) / ch) - oy);
    if (x0 >= x1 || y0 >= y1) continue;
    for (let y = y0; y < y1; y++) available.fill(0, y * bw + x0, y * bw + x1);
  }
  const width = ink.left + ink.right, height = ink.ascent + ink.descent;
  let best: { x: number; y: number } | null = null, bestDistance = Infinity;
  forEachHistRect(available, bw, bh, (x, y, w, h) => {
    if (w * cw < width || h * ch < height) return;
    const ax = Math.max((ox + x) * cw + ink.left, Math.min((ox + x + w) * cw - ink.right, preferredX));
    const ay = Math.max((oy + y) * ch + ink.ascent, Math.min((oy + y + h) * ch - ink.descent, preferredY));
    const rect = { x: ax - ink.left, y: ay - ink.ascent, w: width, h: height };
    if (reserved.some((box) => textRectsOverlap(rect, box))) return;
    const distance = (ax - preferredX) ** 2 + (ay - preferredY) ** 2;
    if (distance < bestDistance) { best = { x: ax, y: ay }; bestDistance = distance; }
  });
  return best;
}

/** Labels belong to original regions, including their overlaps. No unique-color-area requirement. */
export function placePeriodLabels(
  layout: MapLayout, cssW: number, cssH: number, zoom: CellBox | null,
  measureAtOnePx: (text: string) => number, minFont = 12, maxFont = 48,
  measureInk?: (text: string) => Ink,
): PeriodLabel[] {
  const { grid, g, periods } = layout;
  if (!periods) return [];
  const cw = cssW / grid.w, ch = cssH / grid.h;
  const placed: PeriodLabel[] = [];
  // Give detail a chance before a broad contextual title reserves its space.
  const regions = [...periods.regions].sort((a, b) => (a.i1 - a.i0) - (b.i1 - b.i0) || a.period.id.localeCompare(b.period.id));
  for (const region of regions) {
    const { x: ox, y: oy, w, h, period } = region;
    let mask: Uint8Array = new Uint8Array(w * h);
    for (let i = region.i0; i < region.i1; i++) mask[(g.ys[i] - oy) * w + g.xs[i] - ox] = 1;
    if (zoom) mask = eraseFrameBand(mask, w, h, ox, oy, zoom, zoomFramePadCells(cw, ch));
    // Erasing occupied glyph rectangles exposes alternative rooms inside the same region.
    for (const box of placed) {
      const x0 = Math.max(0, Math.floor((box.x - TEXT_GAP) / cw) - ox);
      const x1 = Math.min(w, Math.ceil((box.x + box.w + TEXT_GAP) / cw) - ox);
      const y0 = Math.max(0, Math.floor((box.y - TEXT_GAP) / ch) - oy);
      const y1 = Math.min(h, Math.ceil((box.y + box.h + TEXT_GAP) / ch) - oy);
      if (x0 >= x1 || y0 >= y1) continue;
      for (let y = y0; y < y1; y++) mask.fill(0, y * w + x0, y * w + x1);
    }
    const center = maskCentroid(mask, w, h);
    const textRatio = Math.max(0.1, measureAtOnePx(period.label));
    const ink = measureInk?.(period.label) ?? { left: textRatio / 2, right: textRatio / 2, ascent: 0.6, descent: 0.6 };
    const inkW = Math.max(0.1, ink.left + ink.right), inkH = Math.max(0.1, ink.ascent + ink.descent);
    let best: PeriodLabel | null = null, bestDistance = Infinity;
    forEachHistRect(mask, w, h, (x, y, rw, rh) => {
      const font = Math.floor(Math.min(maxFont, rw * cw * 0.86 / inkW, rh * ch * 0.86 / inkH));
      if (font < minFont) return;
      const boxW = inkW * font, boxH = inkH * font;
      const px = (ox + x + rw / 2) * cw, py = (oy + y + rh / 2) * ch;
      const box = { x: px - boxW / 2, y: py - boxH / 2, w: boxW, h: boxH };
      if (placed.some((p) => textRectsOverlap(box, p))) return;
      const distance = ((px / cw - ox - center.x) * cw) ** 2 + ((py / ch - oy - center.y) * ch) ** 2;
      if (best && (font < best.font || (font === best.font && distance >= bestDistance))) return;
      const gx = Math.min(grid.w - 1, Math.max(0, Math.floor(px / cw)));
      const gy = Math.min(grid.h - 1, Math.max(0, Math.floor(py / ch)));
      best = { ...box, id: period.id, text: period.label, font, sample: g.at[gy * grid.w + gx],
        cx: px + (ink.left - ink.right) * font / 2, cy: py + (ink.ascent - ink.descent) * font / 2 };
      bestDistance = distance;
    });
    if (best) placed.push(best);
  }
  return placed;
}

type Cached = { projection: MapLayout['periods']; key: string; labels: PeriodLabel[] };

export class PeriodLabels {
  private cache = new WeakMap<MapLayout, Cached>();

  paint(
    ctx: CanvasRenderingContext2D, layout: MapLayout, cssW: number, cssH: number,
    zoom: CellBox | null, theme: ThemeColors, fillAt: (i: number) => number,
  ): TextRect[] {
    if (!layout.periods) return [];
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const key = [cssW, cssH, zoom?.x, zoom?.y, zoom?.w, zoom?.h, theme.periodLabelMinPx, theme.periodLabelMaxPx].join(':');
    let cached = this.cache.get(layout);
    if (!cached || cached.projection !== layout.periods || cached.key !== key) {
      ctx.font = LABEL_FONT + '100' + LABEL_FONT_STACK;
      const labels = placePeriodLabels(layout, cssW, cssH, zoom, (text) => ctx.measureText(text).width / 100,
        theme.periodLabelMinPx, theme.periodLabelMaxPx, (text) => {
          const ink = glyphInk(ctx, text);
          return { left: ink.left / 100, right: ink.right / 100, ascent: ink.ascent / 100, descent: ink.descent / 100 };
        });
      cached = { projection: layout.periods, key, labels };
      this.cache.set(layout, cached);
    }
    const reserved: TextRect[] = [];
    for (const label of cached.labels) {
      const fill = label.sample >= 0 ? fillAt(label.sample) : theme.future;
      ctx.font = LABEL_FONT + label.font + LABEL_FONT_STACK;
      ctx.fillStyle = boundStrokeFromFill(fill, theme.periodLabelAlpha);
      ctx.fillText(label.text, label.cx, label.cy);
      reserved.push(glyphRect(ctx, label.text, label.cx, label.cy));
    }
    ctx.restore();
    return reserved;
  }
}
