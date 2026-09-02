import { LABEL_FILL, LABEL_FONT, LABEL_FONT_STACK } from '../constants';
import { boundStrokeFromFill } from '../theme/pastRamp';
import type { LabelPlace, LabelSlotKind, ThemeColors } from '../types';

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
   */
  labelColor(theme: ThemeColors, onFilled: boolean, live: boolean, fill: number): string {
    if (live) return onFilled ? theme.labelLive : theme.labelLiveEmpty;
    return boundStrokeFromFill(fill, onFilled ? theme.labelAlpha : theme.labelEmptyAlpha);
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
