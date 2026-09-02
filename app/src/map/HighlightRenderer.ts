import { CURRENT_OUTLINE_W, ZOOM_FRAME_OUTSET, ZOOM_FRAME_W } from '../constants';
import type { CellBox, MapLayout, ThemeColors } from '../types';

/** Live-unit outline and the yellow zoom frame outside the cells. */
export class HighlightRenderer {
  /** Current-unit outline + yellow zoom frame (or the inset hug). */
  paint(
    ctx: CanvasRenderingContext2D,
    layout: MapLayout,
    cssW: number,
    cssH: number,
    hlPad: number,
    theme: ThemeColors,
    curId: number | null,
    zoomBox: CellBox | null,
    insetFrame: boolean,
  ): void {
    ctx.clearRect(-hlPad, -hlPad, cssW + hlPad * 2, cssH + hlPad * 2);
    const { grid, g, levelIds } = layout;
    const cw = cssW / grid.w;
    const ch = cssH / grid.h;
    const at = g.at;
    if (curId != null && levelIds[0]) {
      const ids = levelIds[0];
      const inside = (j: number) => j >= 0 && j < grid.cells && ids[j] === curId;
      ctx.strokeStyle = theme.currentOutline;
      ctx.lineWidth = CURRENT_OUTLINE_W;
      ctx.beginPath();
      for (let i = 0; i < grid.cells; i++) {
        if (ids[i] !== curId) continue;
        const x = g.xs[i], y = g.ys[i];
        if (x === 0 || !inside(at[y * grid.w + x - 1])) {
          ctx.moveTo(x * cw, y * ch);
          ctx.lineTo(x * cw, (y + 1) * ch);
        }
        if (x === grid.w - 1 || !inside(at[y * grid.w + x + 1])) {
          ctx.moveTo((x + 1) * cw, y * ch);
          ctx.lineTo((x + 1) * cw, (y + 1) * ch);
        }
        if (y === 0 || !inside(at[(y - 1) * grid.w + x])) {
          ctx.moveTo(x * cw, y * ch);
          ctx.lineTo((x + 1) * cw, y * ch);
        }
        if (y === grid.h - 1 || !inside(at[(y + 1) * grid.w + x])) {
          ctx.moveTo(x * cw, (y + 1) * ch);
          ctx.lineTo((x + 1) * cw, (y + 1) * ch);
        }
      }
      ctx.stroke();
    }
    if (zoomBox) {
      const b = zoomBox;
      const rx = b.x * cw;
      const ry = b.y * ch;
      const rw = b.w * cw;
      const rh = b.h * ch;
      ctx.strokeStyle = theme.zoom;
      ctx.lineWidth = ZOOM_FRAME_W;
      ctx.lineJoin = 'miter';
      ctx.strokeRect(rx - ZOOM_FRAME_OUTSET, ry - ZOOM_FRAME_OUTSET, rw + ZOOM_FRAME_OUTSET * 2, rh + ZOOM_FRAME_OUTSET * 2);
    } else if (insetFrame) {
      ctx.strokeStyle = theme.zoom;
      ctx.lineWidth = ZOOM_FRAME_W;
      ctx.lineJoin = 'miter';
      ctx.strokeRect(-ZOOM_FRAME_OUTSET, -ZOOM_FRAME_OUTSET, cssW + ZOOM_FRAME_OUTSET * 2, cssH + ZOOM_FRAME_OUTSET * 2);
    }
  }
}
