import { cellAppearance } from '../theme/mapAppearance';
import type { MapLayout, ThemeColors } from '../types';

type FillBuf = { w: number; h: number; img: ImageData; buf: Uint32Array };

/** Paint past / future / live / surplus cells into the base ImageData layer. */
export class FillRenderer {
  private bufs = new WeakMap<CanvasRenderingContext2D, FillBuf>();

  /**
   * Fill along the curve up to now.
   * Elapsed first-level blocks use the last elapsed fraction of
   * `--past-from` → `--past-mid` → `--past-to`; the live L1 block is `--cur-past`.
   * The elapsed part of the live L2 block (parent's second unit on the inset) is `--cur-inner`.
   */
  paint(
    ctx: CanvasRenderingContext2D,
    layout: MapLayout,
    now: number,
    theme: ThemeColors,
    curId: number | null,
  ): void {
    const { grid, g } = layout;
    const rec = this.buffer(ctx, grid.w, grid.h);
    const buf = rec.buf;
    buf.fill(theme.surplus);
    const colorAt = cellAppearance(layout, now, theme, curId);
    const n = grid.cells;
    for (let i = 0; i < n; i++) {
      const p = g.xs[i] + g.ys[i] * grid.w;
      buf[p] = colorAt(i);
    }
    ctx.putImageData(rec.img, 0, 0);
  }

  /** Reuse ImageData per canvas so speedup does not allocate a full grid every tick. */
  private buffer(ctx: CanvasRenderingContext2D, w: number, h: number): FillBuf {
    let rec = this.bufs.get(ctx);
    if (!rec || rec.w !== w || rec.h !== h) {
      const img = ctx.createImageData(w, h);
      rec = { w, h, img, buf: new Uint32Array(img.data.buffer) };
      this.bufs.set(ctx, rec);
    }
    return rec;
  }
}
