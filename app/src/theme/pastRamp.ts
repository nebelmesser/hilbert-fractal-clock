import { BOUND_LUMA_SPLIT } from '../constants';
import { clamp } from '../math';
import type { ThemeColors } from '../types';

/**
 * First-level id span used by the violet→pink past ramp.
 * `pinkId` is the live block, or the last block when the whole range is elapsed.
 * `maxId` is the last block on the map — the unused future keeps the unused (dark) start of the ramp.
 */
export function l1RampSpan(
  ids: Int32Array | undefined,
  n: number,
  curId: number | null,
): { minId: number; maxId: number; pinkId: number } {
  let minId = Infinity;
  let maxId = -Infinity;
  if (ids) {
    for (let i = 0; i < n; i++) {
      const id = ids[i];
      if (id < minId) minId = id;
      if (id > maxId) maxId = id;
    }
  }
  const pinkId = curId != null && curId >= minId ? curId : maxId;
  return { minId, maxId, pinkId };
}

/** Blend two little-endian 0xAABBGGRR pixels in sRGB. */
export function lerpPacked(a: number, b: number, t: number): number {
  t = clamp(t, 0, 1);
  const ar = a & 255, ag = (a >>> 8) & 255, ab = (a >>> 16) & 255, aa = (a >>> 24) & 255;
  const br = b & 255, bg = (b >>> 8) & 255, bb = (b >>> 16) & 255, ba = (b >>> 24) & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  const al = Math.round(aa + (ba - aa) * t);
  return ((al << 24) | (bl << 16) | (g << 8) | r) >>> 0;
}

/** sRGB 0–255 → HSL (H degrees, S/L 0–1). */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/** HSL (H degrees, S/L 0–1) → sRGB 0–255. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = h / 360;
  return [
    Math.round(hue2rgb(p, q, hk + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, hk) * 255),
    Math.round(hue2rgb(p, q, hk - 1 / 3) * 255),
  ];
}

/**
 * Blend packed pixels in HSL, taking the shorter hue arc.
 * `--past-from` → `--cur-past` walks through magenta, not green.
 * `satDip` scales saturation by `1 − dip × 4t(1−t)` so the midpoint is quieter than a linear HSL mix.
 */
export function lerpHslPacked(a: number, b: number, t: number, satDip = 0): number {
  t = clamp(t, 0, 1);
  if (t <= 0) return a;
  if (t >= 1) return b;
  const [h0, s0, l0] = rgbToHsl(a & 255, (a >>> 8) & 255, (a >>> 16) & 255);
  const [h1, s1, l1] = rgbToHsl(b & 255, (b >>> 8) & 255, (b >>> 16) & 255);
  let dh = h1 - h0;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  const dip = clamp(satDip, 0, 1);
  const s = (s0 + (s1 - s0) * t) * (1 - dip * 4 * t * (1 - t));
  const [r, g, bl] = hslToRgb(h0 + dh * t, s, l0 + (l1 - l0) * t);
  const al = Math.round(((a >>> 24) & 255) + ((((b >>> 24) & 255) - ((a >>> 24) & 255)) * t));
  return ((al << 24) | (bl << 16) | (g << 8) | r) >>> 0;
}

/**
 * Elapsed first-level block color: `--past-from` (violet) → `--cur-past` (pink).
 * The live block is always exactly `--cur-past`.
 * Only the elapsed fraction of the map uses the ramp: a quarter filled draws the last quarter
 * (closest to pink), so `--past-from` is reached only by blocks long in the past.
 */
export function pastBlockPixel(
  theme: ThemeColors,
  id: number,
  minId: number,
  maxId: number,
  pinkId: number,
  curId: number | null,
): number {
  if (curId != null && id === curId) return theme.curPast;
  const full = maxId - minId;
  if (!(full > 0) || !Number.isFinite(minId)) {
    return pinkId === id ? theme.curPast : theme.pastFrom;
  }
  return lerpHslPacked(theme.pastFrom, theme.curPast, 1 - (pinkId - id) / full, theme.pastSatDip ?? 0);
}

/**
 * Same as `pastBlockPixel`, but each first-level id is blended once.
 * The fill loop hits the same id for every cell in a block — HSL must not run per pixel.
 */
export function pastColorAt(
  theme: ThemeColors,
  minId: number,
  maxId: number,
  pinkId: number,
  curId: number | null,
): (id: number) => number {
  const span = maxId - minId;
  if (Number.isFinite(minId) && span >= 0 && span < 200000) {
    const colors = new Uint32Array(span + 1);
    const ready = new Uint8Array(span + 1);
    return (id) => {
      const k = id - minId;
      if (k < 0 || k > span) return pastBlockPixel(theme, id, minId, maxId, pinkId, curId);
      if (ready[k]) return colors[k];
      const c = pastBlockPixel(theme, id, minId, maxId, pinkId, curId);
      colors[k] = c;
      ready[k] = 1;
      return c;
    };
  }
  const memo = new Map<number, number>();
  return (id) => {
    let c = memo.get(id);
    if (c === undefined) {
      c = pastBlockPixel(theme, id, minId, maxId, pinkId, curId);
      memo.set(id, c);
    }
    return c;
  };
}

/** CSS `rgb()` from a packed pixel. */
export function packedToRgb(p: number): string {
  return 'rgb(' + (p & 255) + ',' + ((p >>> 8) & 255) + ',' + ((p >>> 16) & 255) + ')';
}

/** Rec. 709 luma of a packed pixel, 0–255. */
export function packedLuma(p: number): number {
  return 0.2126 * (p & 255) + 0.7152 * ((p >>> 8) & 255) + 0.0722 * ((p >>> 16) & 255);
}

/**
 * Bound stroke from the cell fill: only opacity is chosen.
 * Dark fills (future) get a white overlay — same as the original `--bound-*`.
 * Light fills (past ramp) get a black overlay so the line keeps the block hue underneath.
 */
export function boundStrokeFromFill(fill: number, alpha: number): string {
  const a = clamp(alpha, 0, 1);
  if (packedLuma(fill) < BOUND_LUMA_SPLIT) return 'rgba(255,255,255,' + a + ')';
  return 'rgba(0,0,0,' + a + ')';
}
