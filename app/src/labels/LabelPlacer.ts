import { LABEL_FILL, LABEL_FONT, LABEL_FONT_STACK, ZOOM_FRAME_OUTSET, ZOOM_FRAME_W } from '../constants';
import { boundStrokeFromFill } from '../theme/pastRamp';
import type { CellBox, LabelPlace, LabelSlotKind, ThemeColors } from '../types';

/** Visit every maximal axis-aligned rectangle in a binary mask. */
export function forEachHistRect(
  mask: Uint8Array, bw: number, bh: number,
  fn: (x: number, y: number, w: number, h: number) => void,
): void {
  const height = new Int32Array(bw);
  const stackH = new Int32Array(bw + 1);
  const stackI = new Int32Array(bw + 1);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) height[x] = mask[y * bw + x] ? height[x] + 1 : 0;
    let sp = 0;
    for (let x = 0; x <= bw; x++) {
      const ht = x < bw ? height[x] : 0;
      let start = x;
      while (sp && stackH[sp - 1] > ht) {
        const sh = stackH[--sp];
        const si = stackI[sp];
        fn(si, y - sh + 1, x - si, sh);
        start = si;
      }
      stackH[sp] = ht;
      stackI[sp] = start;
      sp++;
    }
  }
}

/** Largest landscape tw:th (tw ≥ th) box inside boxW×boxH. */
export function maxAspectInside(boxW: number, boxH: number, tw: number, th: number): { w: number; h: number; area: number } {
  if (!(boxW > 0) || !(boxH > 0) || !(tw > 0) || !(th > 0)) return { w: 0, h: 0, area: 0 };
  if (tw < th) { const swap = tw; tw = th; th = swap; }
  const s = Math.min(boxW / tw, boxH / th);
  let w = Math.max(1, Math.floor(tw * s + 1e-9));
  let h = Math.max(1, Math.floor(th * s + 1e-9));
  if (w > boxW) w = boxW;
  if (h > boxH) h = boxH;
  if (h > w) h = w;
  return { w, h, area: w * h };
}

/** Layer-wide slot: square (≤4), 4×3 (4–6), else 16×9. */
export function labelSlotKind(texts: string[]): LabelSlotKind {
  let le4 = true;
  let mid = true;
  for (let i = 0; i < texts.length; i++) {
    const n = texts[i].length;
    if (n > 4) le4 = false;
    if (n < 4 || n > 6) mid = false;
  }
  if (le4) return 'square';
  if (mid) return '4x3';
  return '16x9';
}

/** Horizontal slot ratios only — never 3×4 / 9×16. */
export function slotRatios(kind: LabelSlotKind): Array<[number, number]> {
  if (kind === 'square') return [[1, 1]];
  if (kind === '4x3') return [[4, 3]];
  return [[16, 9]];
}

/** Cell is inside the axis-aligned zoom box. */
export function cellInBox(x: number, y: number, box: CellBox): boolean {
  return x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
}

/**
 * Same rule as the live unit: keep the larger of two complementary halves.
 * If the cut does not split `base`, return `base` unchanged.
 */
export function preferLargerHalf(base: Uint8Array, a: Uint8Array, b: Uint8Array): Uint8Array {
  let nA = 0, nB = 0;
  for (let i = 0; i < base.length; i++) {
    if (!base[i]) continue;
    if (a[i]) nA++;
    else if (b[i]) nB++;
  }
  if (!nA || !nB) return base;
  const keepA = nA >= nB;
  const out = new Uint8Array(base.length);
  for (let i = 0; i < base.length; i++) {
    if (base[i] && (keepA ? a[i] : b[i])) out[i] = 1;
  }
  return out;
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
  const px = Math.max(16, ZOOM_FRAME_W + ZOOM_FRAME_OUTSET * 2);
  const cell = Math.min(cellW, cellH);
  return Math.max(1, Math.ceil(px / Math.max(1e-6, cell)));
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

/** Place a layer-wide label slot inside a region mask. */
export class LabelPlacer {
  /** Largest horizontal room, then 1×1 / 4×3 / 16×9 centered in it. */
  largestSlotInMask(mask: Uint8Array, bw: number, bh: number, kind: LabelSlotKind, cx: number, cy: number): LabelPlace {
    const ratios = slotRatios(kind);
    const tw = ratios[0][0], th = ratios[0][1];
    let bestRoom = 0;
    const rooms: LabelPlace[] = [];
    forEachHistRect(mask, bw, bh, (x, y, w, h) => {
      const room = landscapeRoom(x, y, w, h);
      if (!room.area) return;
      if (room.area > bestRoom) {
        bestRoom = room.area;
        rooms.length = 0;
        rooms.push(room);
      } else if (room.area === bestRoom) {
        rooms.push(room);
      }
    });
    if (!bestRoom) return { x: 0, y: 0, w: 0, h: 0, area: 0 };
    let room = rooms[0], bestD = Infinity;
    for (let i = 0; i < rooms.length; i++) {
      const r = rooms[i];
      const dx = r.x + r.w / 2 - cx, dy = r.y + r.h / 2 - cy;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        room = r;
      }
    }
    const fit = maxAspectInside(room.w, room.h, tw, th);
    if (!fit.area || fit.h > fit.w) return { x: 0, y: 0, w: 0, h: 0, area: 0 };
    return {
      x: room.x + ((room.w - fit.w) >> 1),
      y: room.y + ((room.h - fit.h) >> 1),
      w: fit.w,
      h: fit.h,
      area: fit.area,
    };
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

  /** Full region in timelapse; otherwise filled or empty half of a live unit. */
  placeMaskForRegion(opts: {
    timeLapse: boolean;
    live: boolean;
    unitId: string;
    full: Uint8Array;
    past: Uint8Array;
    future: Uint8Array;
    nPast: number;
    nFuture: number;
  }): { placeMask: Uint8Array; onFilled: boolean } {
    const { timeLapse, live, unitId, full, past, future, nPast, nFuture } = opts;
    let onFilled = false;
    let placeMask = full;
    if (!timeLapse && live && unitId !== 'second') {
      if (nPast >= nFuture && nPast > 0) {
        placeMask = past;
        onFilled = true;
      } else if (nFuture > 0) {
        placeMask = future;
        onFilled = false;
      }
    } else if (live) {
      onFilled = nPast >= nFuture && nPast > 0;
    }
    return { placeMask, onFilled };
  }

  /** Largest font that fits `frac` of the place box. */
  fontFit(ctx: CanvasRenderingContext2D, text: string, pw: number, ph: number, frac?: number): number {
    const f = frac == null ? LABEL_FILL : frac;
    const maxW = Math.max(1, pw * f);
    const maxH = Math.max(1, ph * f);
    let size = maxH;
    ctx.font = LABEL_FONT + size + LABEL_FONT_STACK;
    const tw = ctx.measureText(text).width;
    if (tw > maxW) size *= maxW / tw;
    return size;
  }
}

export const labels = new LabelPlacer();
