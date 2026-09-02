import { l1RampSpan, pastColorAt } from '../theme/pastRamp';
import type { MapLayout, ThemeColors } from '../types';

type FillBuf = { w: number; h: number; img: ImageData; buf: Uint32Array };

/** Paint past / future / live / surplus cells into the base ImageData layer. */
export class FillRenderer {
  private bufs = new WeakMap<CanvasRenderingContext2D, FillBuf>();

  /**
   * Fill along the curve up to now.
   * Elapsed first-level blocks use the last elapsed fraction of `--past-from` → `--cur-past`;
   * the live block stays pink.
   */
  paint(
    ctx: CanvasRenderingContext2D,
    layout: MapLayout,
    now: number,
    theme: ThemeColors,
    curId: number | null,
  ): void {
    const { grid, g, levelIds, cellStart } = layout;
    const rec = this.buffer(ctx, grid.w, grid.h);
    const buf = rec.buf;
    buf.fill(theme.surplus);
    const ids = levelIds[0];
    const n = grid.cells;
    const dur = grid.cellDur;
    const { minId, maxId, pinkId } = l1RampSpan(ids, n, curId);
    const colorAt = ids ? pastColorAt(theme, minId, maxId, pinkId, curId) : null;
    for (let i = 0; i < n; i++) {
      const p = g.xs[i] + g.ys[i] * grid.w;
      const t0 = cellStart[i];
      const inCur = curId != null && ids && ids[i] === curId;
      if (now >= t0 + dur) {
        buf[p] = colorAt
          ? colorAt(ids[i])
          : (inCur ? theme.curPast : theme.past);
      } else if (now >= t0) {
        buf[p] = theme.head;
      } else {
        buf[p] = inCur ? theme.curFuture : theme.future;
      }
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
