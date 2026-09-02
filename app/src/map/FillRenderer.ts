import type { MapLayout, ThemeColors } from '../types';

/** Paint past / future / live / surplus cells into the base ImageData layer. */
export class FillRenderer {
  /** Fill along the curve up to now; tint the current coarsest unit. */
  paint(
    ctx: CanvasRenderingContext2D,
    layout: MapLayout,
    now: number,
    theme: ThemeColors,
    curId: number | null,
  ): void {
    const { grid, g, levelIds, cellStart } = layout;
    const img = ctx.createImageData(grid.w, grid.h);
    const buf = new Uint32Array(img.data.buffer);
    buf.fill(theme.surplus);
    const ids = levelIds[0];
    const n = grid.cells;
    const dur = grid.cellDur;
    for (let i = 0; i < n; i++) {
      const p = g.xs[i] + g.ys[i] * grid.w;
      const t0 = cellStart[i];
      const inCur = curId != null && ids && ids[i] === curId;
      if (now >= t0 + dur) buf[p] = inCur ? theme.curPast : theme.past;
      else if (now >= t0) buf[p] = theme.head;
      else buf[p] = inCur ? theme.curFuture : theme.future;
    }
    ctx.putImageData(img, 0, 0);
  }
}
