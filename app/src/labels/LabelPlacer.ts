import { LABEL_FILL, LABEL_FONT, LABEL_FONT_STACK, LABEL_MAX_OMISSIONS, LABEL_PADDING_EM, ZOOM_FRAME_OUTSET, ZOOM_FRAME_W } from '../constants';
import { median } from '../math';
import { boundStrokeFromFill } from '../theme/pastRamp';
import type { CellBox, LabelPlace, ThemeColors } from '../types';

/** Ink bounds per font pixel, measured with left alignment and an alphabetic baseline. */
export type GlyphMetrics = {
  left: number; right: number; ascent: number; descent: number; width: number; height: number;
};

export type GlyphPlace = LabelPlace & { onFilled?: boolean };

/** Maximal empty rectangles and the region's area centroid, in grid cells. */
export type LabelGeometry = {
  rooms: GlyphPlace[];
  cx: number;
  cy: number;
};

/** Visit every maximal axis-aligned rectangle in a binary mask. */
export function forEachHistRect(
  mask: Uint8Array, bw: number, bh: number,
  fn: (x: number, y: number, w: number, h: number) => void,
): void {
  const height = new Int32Array(bw);
  const stackH = new Int32Array(bw + 1);
  const stackI = new Int32Array(bw + 1);
  const below = new Int32Array(bw + 1);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) height[x] = mask[y * bw + x] ? height[x] + 1 : 0;
    if (y + 1 < bh) {
      for (let x = 0; x < bw; x++) below[x + 1] = below[x] + (mask[(y + 1) * bw + x] ? 0 : 1);
    }
    let sp = 0;
    for (let x = 0; x <= bw; x++) {
      const ht = x < bw ? height[x] : 0;
      let start = x;
      while (sp && stackH[sp - 1] > ht) {
        const sh = stackH[--sp];
        const si = stackI[sp];
        // A room that can grow downward is contained in a later rectangle.
        if (y + 1 === bh || below[x] !== below[si]) fn(si, y - sh + 1, x - si, sh);
        start = si;
      }
      if (ht > 0 && (!sp || stackH[sp - 1] < ht)) {
        stackH[sp] = ht;
        stackI[sp] = start;
        sp++;
      }
    }
  }
}

/** Cell sits on the zoom-box rim (inside or just outside), `pad` cells thick. */
export function cellInFrameBand(x: number, y: number, box: CellBox, pad: number): boolean {
  if (pad < 1) return false;
  const x0 = box.x, x1 = box.x + box.w, y0 = box.y, y1 = box.y + box.h;
  const distX = x < x0 ? x0 - x : x >= x1 ? x - (x1 - 1) : 0;
  const distY = y < y0 ? y0 - y : y >= y1 ? y - (y1 - 1) : 0;
  const cheb = Math.max(distX, distY);
  if (cheb > pad) return false;
  const inside = x >= x0 && x < x1 && y >= y0 && y < y1;
  if (inside) {
    return Math.min(x - x0, x1 - 1 - x, y - y0, y1 - 1 - y) < pad;
  }
  return cheb >= 1;
}

/** Drop the frame band from a region mask; return `mask` if that would empty it. */
export function eraseFrameBand(
  mask: Uint8Array, bw: number, bh: number, ox: number, oy: number, box: CellBox, pad: number,
): Uint8Array {
  const out = new Uint8Array(mask);
  let kept = 0;
  for (let i = 0; i < out.length; i++) {
    if (!out[i]) continue;
    const x = ox + (i % bw);
    const y = oy + ((i / bw) | 0);
    if (cellInFrameBand(x, y, box, pad)) out[i] = 0;
    else kept++;
  }
  return kept ? out : mask;
}

/** Stroke-width band in cells so a glyph slot cannot sit on the yellow frame. */
export function zoomFramePadCells(cellW: number, cellH: number): number {
  const px = ZOOM_FRAME_W / 2 + ZOOM_FRAME_OUTSET;
  const cell = Math.min(cellW, cellH);
  return Math.max(1, Math.ceil(px / Math.max(1e-6, cell)));
}

/**
 * Only the smallest area outliers may be omitted, up to the layer limit.
 * Shrink the shared font until every remaining region can hold its glyph.
 */
export function pickSharedLabelFont(
  scored: Array<{ i: number; area: number; px: number }>,
  tinyFraction: number,
  fallback: number,
): { fontSize: number; draw: Set<number> } {
  if (!scored.length) return { fontSize: fallback, draw: new Set() };
  const typical = median(scored.map((s) => s.area));
  const omitted = new Set(scored
    .filter((s) => s.area < typical * tinyFraction)
    .sort((a, b) => a.area - b.area || a.i - b.i)
    .slice(0, LABEL_MAX_OMISSIONS)
    .map((s) => s.i));
  const keep = scored.filter((s) => !omitted.has(s.i));
  const pool = keep.length ? keep : scored;
  return {
    fontSize: Math.min(...pool.map((s) => s.px)),
    draw: new Set(pool.map((s) => s.i)),
  };
}

/** Centre of mass of filled mask cells. */
export function maskCentroid(mask: Uint8Array, bw: number, bh: number): { x: number; y: number } {
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    sx += (i % bw) + 0.5;
    sy += ((i / bw) | 0) + 0.5;
    n++;
  }
  return n ? { x: sx / n, y: sy / n } : { x: bw / 2, y: bh / 2 };
}

/** Largest horizontal (w ≥ h) rect inside this one. */
export function landscapeRoom(x: number, y: number, w: number, h: number): LabelPlace {
  if (!(w > 0) || !(h > 0)) return { x, y, w: 0, h: 0, area: 0 };
  if (w >= h) return { x, y, w, h, area: w * h };
  return { x, y: y + ((h - w) >> 1), w, h: w, area: w * w };
}

/** `#rgb` / `#rrggbb` / `rgb()` / `rgba()` with a replaced alpha. Other strings pass through. */
export function cssWithAlpha(css: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const hex = css.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  const rgb = css.trim().match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i);
  if (rgb) return 'rgba(' + rgb[1] + ',' + rgb[2] + ',' + rgb[3] + ',' + a + ')';
  return css;
}

/** Fit measured text to a region, then center it at the chosen layer size. */
export class LabelPlacer {
  geometry(mask: Uint8Array, bw: number, bh: number): LabelGeometry {
    const { x: cx, y: cy } = maskCentroid(mask, bw, bh);
    const rooms: LabelPlace[] = [];
    forEachHistRect(mask, bw, bh, (x, y, w, h) => rooms.push({ x, y, w, h, area: w * h }));
    return { rooms, cx, cy };
  }

  measureGlyph(ctx: CanvasRenderingContext2D, text: string, reference = 100): GlyphMetrics {
    ctx.font = LABEL_FONT + reference + LABEL_FONT_STACK;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText(text);
    const hasInk = m.actualBoundingBoxLeft + m.actualBoundingBoxRight > 0 &&
      m.actualBoundingBoxAscent + m.actualBoundingBoxDescent > 0;
    const left = hasInk ? m.actualBoundingBoxLeft / reference : 0;
    const right = (hasInk ? m.actualBoundingBoxRight : m.width) / reference;
    const ascent = hasInk ? m.actualBoundingBoxAscent / reference : 0.8;
    const descent = hasInk ? m.actualBoundingBoxDescent / reference : 0.2;
    return { left, right, ascent, descent, width: left + right, height: ascent + descent };
  }

  /** Largest text scale with a uniform typographic margin on all four sides. */
  maxFont(geometry: LabelGeometry, glyph: GlyphMetrics, cw: number, ch: number): number {
    let size = 0;
    const paddedWidth = glyph.width + 2 * LABEL_PADDING_EM;
    const paddedHeight = glyph.height + 2 * LABEL_PADDING_EM;
    for (const room of geometry.rooms) {
      size = Math.max(size, Math.min(room.w * cw / paddedWidth, room.h * ch / paddedHeight));
    }
    return size;
  }

  /** Maximize clearance to every edge; use the area centroid only to break ties. */
  placeGlyph(geometry: LabelGeometry, glyph: GlyphMetrics, size: number, cw: number, ch: number): GlyphPlace | null {
    const inkW = glyph.width * size;
    const inkH = glyph.height * size;
    const padding = LABEL_PADDING_EM * size;
    const paddedW = inkW + 2 * padding;
    const paddedH = inkH + 2 * padding;
    let best: GlyphPlace | null = null;
    let bestClearance = -Infinity;
    let bestD = Infinity;
    for (const room of geometry.rooms) {
      const w = room.w * cw, h = room.h * ch;
      if (paddedW > w + 1e-7 || paddedH > h + 1e-7) continue;
      const clearance = Math.min((w - inkW) / 2, (h - inkH) / 2);
      if (clearance < bestClearance - 1e-7) continue;
      const halfW = inkW / 2 + clearance;
      const halfH = inkH / 2 + clearance;
      const cx = Math.max(room.x * cw + halfW,
        Math.min(geometry.cx * cw, (room.x + room.w) * cw - halfW));
      const cy = Math.max(room.y * ch + halfH,
        Math.min(geometry.cy * ch, (room.y + room.h) * ch - halfH));
      const dx = cx - geometry.cx * cw, dy = cy - geometry.cy * ch;
      const d = dx * dx + dy * dy;
      if (clearance > bestClearance + 1e-7 || d < bestD) {
        best = { x: (cx - inkW / 2) / cw, y: (cy - inkH / 2) / ch,
          w: inkW / cw, h: inkH / ch, area: inkW * inkH / (cw * ch), onFilled: room.onFilled };
        bestD = d;
        bestClearance = clearance;
      }
    }
    return best;
  }

  /**
   * Live unit stays `--label-live*`. Other glyphs use the block fill plus `--label-*-alpha`.
   * `alphas.live` tints the live CSS color (inset watermark); omit to keep it opaque.
   */
  labelColor(
    theme: ThemeColors, onFilled: boolean, live: boolean, fill: number,
    alphas?: { filled: number; empty: number; live?: number },
  ): string {
    if (live) {
      const base = onFilled ? theme.labelLive : theme.labelLiveEmpty;
      return alphas && alphas.live != null ? cssWithAlpha(base, alphas.live) : base;
    }
    const a = onFilled
      ? (alphas ? alphas.filled : theme.labelAlpha)
      : (alphas ? alphas.empty : theme.labelEmptyAlpha);
    return boundStrokeFromFill(fill, a);
  }

  /** Largest font that fits `frac` of the place box. */
  fontFit(ctx: CanvasRenderingContext2D, text: string, pw: number, ph: number, frac?: number): number {
    const f = frac == null ? LABEL_FILL : frac;
    const maxW = Math.max(0, pw * f);
    const maxH = Math.max(0, ph * f);
    let size = maxH;
    ctx.font = LABEL_FONT + size + LABEL_FONT_STACK;
    const tw = ctx.measureText(text).width;
    if (tw > maxW) size *= maxW / tw;
    return size;
  }
}

export const labels = new LabelPlacer();
