import { BOUND_W, HAIR_GAIN, HAIR_MAX, HAIR_MIN, HAIR_REF_PX, INHERIT_W } from '../constants';
import { clamp } from '../math';
import type { MapLayout, ThemeColors } from '../types';

/** Stroke unit edges: local ladder plus inherited coarser units on the inset. */
export class BoundRenderer {
  /** Edges where neighbouring cells change unit id. */
  strokeIds(
    ctx: CanvasRenderingContext2D,
    layout: MapLayout,
    cssW: number,
    cssH: number,
    ids: Int32Array,
    lw: number,
    color: string,
  ): void {
    const { grid, g } = layout;
    const cw = cssW / grid.w;
    const ch = cssH / grid.h;
    const at = g.at;
    const nCells = grid.cells;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        const i = at[y * grid.w + x];
        if (i < 0 || i >= nCells) continue;
        const id = ids[i];
        if (x + 1 < grid.w) {
          const j = at[y * grid.w + x + 1];
          if (j >= 0 && j < nCells && ids[j] !== id) {
            const px = (x + 1) * cw;
            ctx.moveTo(px, y * ch);
            ctx.lineTo(px, (y + 1) * ch);
          }
        }
        if (y + 1 < grid.h) {
          const j = at[(y + 1) * grid.w + x];
          if (j >= 0 && j < nCells && ids[j] !== id) {
            const py = (y + 1) * ch;
            ctx.moveTo(x * cw, py);
            ctx.lineTo((x + 1) * cw, py);
          }
        }
      }
    }
    ctx.stroke();
  }

  /**
   * Up to 3 local levels + inherited coarser edges on the inset.
   * 3rd-order and anything finer than the labels are hairlines in `--bound-3`.
   */
  paint(ctx: CanvasRenderingContext2D, layout: MapLayout, cssW: number, cssH: number, theme: ThemeColors): void {
    const { grid, levels, levelIds, inherit } = layout;
    ctx.clearRect(0, 0, cssW, cssH);
    const cw = cssW / grid.w;
    const ch = cssH / grid.h;
    const labelLi = layout.labelLevel || 0;
    for (let li = levels.length - 1; li >= 0; li--) {
      const cellsPer = Math.max(1, levels[li].typical / grid.cellDur);
      const sidePx = Math.sqrt(cellsPer) * Math.min(cw, ch);
      // 3rd level, or anything finer than the labels (minutes under hour numbers).
      const hair = li >= 2 || li > labelLi;
      const lw = hair
        ? clamp(HAIR_GAIN * (sidePx / HAIR_REF_PX), HAIR_MIN, HAIR_MAX)
        : (BOUND_W[li] || BOUND_W[2]);
      const color = hair
        ? theme.bound3
        : (li === 0 ? theme.bound1 : theme.bound2);
      this.strokeIds(ctx, layout, cssW, cssH, levelIds[li], lw, color);
    }
    if (inherit) {
      for (let i = 0; i < inherit.length; i++) {
        this.strokeIds(ctx, layout, cssW, cssH, inherit[i], INHERIT_W, theme.bound0);
      }
    }
  }
}
