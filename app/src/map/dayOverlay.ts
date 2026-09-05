import { LABEL_FILL, LABEL_FONT, LABEL_FONT_STACK } from '../constants';
import { forEachHistRect, labels, landscapeRoom } from '../labels/LabelPlacer';
import { pad2 } from '../math';
import type { OverlayMode } from '../time/ClockTime';
import type { MapLayout, ThemeColors } from '../types';

/** `HH:mm` in local time. */
export function formatDayClock(now: number): string {
  const d = new Date(now);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/** Wide HH:mm mask so `top` does not resize when digits change. */
export const OVERLAY_FIT = '88:88';

/** Colon sits at `cx`; hours to the left, minutes to the right. */
export function topClockAnchors(cx: number, colonW: number): { hhX: number; colonX: number; mmX: number } {
  const half = colonW / 2;
  return { hhX: cx - half, colonX: cx, mmX: cx + half };
}

function capOverlayPx(px: number, maxPx: number): number {
  return maxPx > 0 ? Math.min(px, maxPx) : px;
}

function fillClockTop(
  ctx: CanvasRenderingContext2D,
  now: number,
  cx: number,
  cy: number,
  boxW: number,
  boxH: number,
  color: string,
  maxPx: number,
): void {
  const px = capOverlayPx(labels.fontFit(ctx, OVERLAY_FIT, boxW, boxH, 1), maxPx);
  if (!(px > 1)) return;
  ctx.font = LABEL_FONT + px + LABEL_FONT_STACK;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  const { hhX, colonX, mmX } = topClockAnchors(cx, ctx.measureText(':').width);
  const d = new Date(now);
  ctx.textAlign = 'right';
  ctx.fillText(pad2(d.getHours()), hhX, cy);
  ctx.textAlign = 'center';
  ctx.fillText(':', colonX, cy);
  ctx.textAlign = 'left';
  ctx.fillText(pad2(d.getMinutes()), mmX, cy);
}

function fillClock(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  boxW: number,
  boxH: number,
  color: string,
  frac?: number,
  fitText?: string,
  maxPx?: number,
): void {
  const px = capOverlayPx(labels.fontFit(ctx, fitText || text, boxW, boxH, frac), maxPx ?? 0);
  if (!(px > 1)) return;
  ctx.font = LABEL_FONT + px + LABEL_FONT_STACK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/**
 * Day HH:mm overlay. `inside` — largest landscape room of the live hour.
 * `top` — middle of the panel. No-op unless L1 is hours.
 */
export function paintDayClock(
  ctx: CanvasRenderingContext2D,
  layout: MapLayout,
  cssW: number,
  cssH: number,
  now: number,
  theme: ThemeColors,
  curId: number | null,
  mode: OverlayMode | null,
): void {
  const { grid, g, levels, levelIds } = layout;
  if (!mode || levels[0]?.id !== 'hour') return;
  const text = formatDayClock(now);
  if (mode === 'top') {
    fillClockTop(ctx, now, cssW / 2, cssH / 2, cssW * 0.72, cssH * 0.42, theme.overlay, theme.overlayMaxPx);
    return;
  }
  if (curId == null || !levelIds[0]) return;
  const ids = levelIds[0];
  let minx = grid.w, miny = grid.h, maxx = -1, maxy = -1;
  const idx: number[] = [];
  for (let i = 0; i < grid.cells; i++) {
    if (ids[i] !== curId) continue;
    idx.push(i);
    const x = g.xs[i], y = g.ys[i];
    if (x < minx) minx = x;
    if (y < miny) miny = y;
    if (x > maxx) maxx = x;
    if (y > maxy) maxy = y;
  }
  if (!idx.length || maxx < minx) return;
  const bw = maxx - minx + 1;
  const bh = maxy - miny + 1;
  const mask = new Uint8Array(bw * bh);
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    mask[(g.ys[i] - miny) * bw + (g.xs[i] - minx)] = 1;
  }
  let best = { x: 0, y: 0, w: 0, h: 0, area: 0 };
  forEachHistRect(mask, bw, bh, (x, y, w, h) => {
    const room = landscapeRoom(x, y, w, h);
    if (room.area > best.area) best = room;
  });
  if (!best.area) return;
  const cw = cssW / grid.w;
  const ch = cssH / grid.h;
  fillClock(
    ctx, text,
    (minx + best.x + best.w / 2) * cw, (miny + best.y + best.h / 2) * ch,
    best.w * cw, best.h * ch, theme.overlay, LABEL_FILL, undefined, theme.overlayMaxPx,
  );
}
