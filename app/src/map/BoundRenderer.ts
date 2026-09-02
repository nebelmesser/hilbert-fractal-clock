import { BOUND_W, HAIR_GAIN, HAIR_MAX, HAIR_MIN, HAIR_REF_PX, INHERIT_W } from '../constants';
import { clamp } from '../math';
import { boundStrokeFromFill, l1RampSpan, pastColorAt } from '../theme/pastRamp';
import type { MapLayout, ThemeColors } from '../types';

/** Flat edge list: cell index + CSS segment, 5 numbers per edge. */
type EdgeList = number[];

type BoundGeom = {
  cssW: number;
  cssH: number;
  levels: EdgeList[];
  inherit: EdgeList[];
};

/** Stroke unit edges: local ladder plus inherited coarser units on the inset. */
export class BoundRenderer {
  private geom = new WeakMap<MapLayout, BoundGeom>();

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
    this.strokeEdges(ctx, this.collectEdges(layout, cssW, cssH, ids), lw, () => 0, () => color);
  }

  /**
   * Same edges as `strokeIds`, batched by an integer key so each color is one stroke.
   * Only the right / bottom neighbour of each cell is considered, so each edge is drawn once.
   */
  strokeIdsKeyed(
    ctx: CanvasRenderingContext2D,
    layout: MapLayout,
    cssW: number,
    cssH: number,
    ids: Int32Array,
    lw: number,
    keyOf: (i: number) => number,
    colorOf: (key: number) => string,
  ): void {
    this.strokeEdges(ctx, this.collectEdges(layout, cssW, cssH, ids), lw, keyOf, colorOf);
  }

  /**
   * Up to 3 local levels + inherited coarser edges on the inset.
   * 3rd-order and anything finer than the labels are hairlines.
   * Stroke color is the cell fill plus `--bound-N-alpha` (white on dark, black on past).
   */
  paint(
    ctx: CanvasRenderingContext2D,
    layout: MapLayout,
    cssW: number,
    cssH: number,
    theme: ThemeColors,
    now = 0,
    curId: number | null = null,
  ): void {
    const { grid, levels, levelIds, inherit, cellStart } = layout;
    ctx.clearRect(0, 0, cssW, cssH);
    const cw = cssW / grid.w;
    const ch = cssH / grid.h;
    const labelLi = layout.labelLevel || 0;
    const ids0 = levelIds[0];
    const dur = grid.cellDur;
    const { minId, maxId, pinkId } = l1RampSpan(ids0, grid.cells, curId);
    const colorAt = ids0 ? pastColorAt(theme, minId, maxId, pinkId, curId) : null;
    const futureKey = 0x7fffffff;
    const curFutureKey = 0x7ffffffe;
    const rec = this.geometry(layout, cssW, cssH);
    for (let li = levels.length - 1; li >= 0; li--) {
      const cellsPer = Math.max(1, levels[li].typical / grid.cellDur);
      const sidePx = Math.sqrt(cellsPer) * Math.min(cw, ch);
      // 3rd level, or anything finer than the labels (minutes under hour numbers).
      const hair = li >= 2 || li > labelLi;
      const lw = hair
        ? clamp(HAIR_GAIN * (sidePx / HAIR_REF_PX), HAIR_MIN, HAIR_MAX)
        : (BOUND_W[li] || BOUND_W[2]);
      const alpha = hair || li >= 2 ? theme.boundAlpha3 : (li === 0 ? theme.boundAlpha1 : theme.boundAlpha2);
      const edges = rec.levels[li];
      if (!ids0 || !colorAt) {
        this.strokeEdges(ctx, edges, lw, () => 0, () => boundStrokeFromFill(theme.future, alpha));
        continue;
      }
      const strokeMemo = new Map<number, string>();
      this.strokeEdges(
        ctx, edges, lw,
        (i) => {
          if (now >= cellStart[i] + dur) return ids0[i];
          if (curId != null && ids0[i] === curId) return curFutureKey;
          return futureKey;
        },
        (key) => {
          let s = strokeMemo.get(key);
          if (s) return s;
          if (key === futureKey) s = boundStrokeFromFill(theme.future, alpha);
          else if (key === curFutureKey) s = boundStrokeFromFill(theme.curFuture, alpha);
          else s = boundStrokeFromFill(colorAt(key), alpha);
          strokeMemo.set(key, s);
          return s;
        },
      );
    }
    if (inherit) {
      for (let i = 0; i < inherit.length; i++) {
        this.strokeEdges(ctx, rec.inherit[i], INHERIT_W, () => 0, () => theme.bound0);
      }
    }
  }

  /** Neighbour walk is cached per layout + CSS size; speedup only rekeys and restrokes. */
  private geometry(layout: MapLayout, cssW: number, cssH: number): BoundGeom {
    const { grid, levelIds, inherit } = layout;
    let rec = this.geom.get(layout);
    if (rec && rec.cssW === cssW && rec.cssH === cssH) return rec;
    rec = {
      cssW,
      cssH,
      levels: levelIds.map((ids) => this.collectEdges(layout, cssW, cssH, ids)),
      inherit: inherit ? inherit.map((ids) => this.collectEdges(layout, cssW, cssH, ids)) : [],
    };
    this.geom.set(layout, rec);
    return rec;
  }

  /** Right / bottom unit edges as `[i, x1, y1, x2, y2, ...]`. */
  private collectEdges(layout: MapLayout, cssW: number, cssH: number, ids: Int32Array): EdgeList {
    const { grid, g } = layout;
    const cw = cssW / grid.w;
    const ch = cssH / grid.h;
    const at = g.at;
    const nCells = grid.cells;
    const out: number[] = [];
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        const i = at[y * grid.w + x];
        if (i < 0 || i >= nCells) continue;
        const id = ids[i];
        if (x + 1 < grid.w) {
          const j = at[y * grid.w + x + 1];
          if (j >= 0 && j < nCells && ids[j] !== id) {
            const px = (x + 1) * cw;
            out.push(i, px, y * ch, px, (y + 1) * ch);
          }
        }
        if (y + 1 < grid.h) {
          const j = at[(y + 1) * grid.w + x];
          if (j >= 0 && j < nCells && ids[j] !== id) {
            const py = (y + 1) * ch;
            out.push(i, x * cw, py, (x + 1) * cw, py);
          }
        }
      }
    }
    return out;
  }

  private strokeEdges(
    ctx: CanvasRenderingContext2D,
    edges: EdgeList,
    lw: number,
    keyOf: (i: number) => number,
    colorOf: (key: number) => string,
  ): void {
    const buckets = new Map<number, number[]>();
    for (let e = 0; e < edges.length; e += 5) {
      const key = keyOf(edges[e]);
      let pts = buckets.get(key);
      if (!pts) { pts = []; buckets.set(key, pts); }
      pts.push(edges[e + 1], edges[e + 2], edges[e + 3], edges[e + 4]);
    }
    ctx.lineWidth = lw;
    ctx.lineJoin = 'miter';
    buckets.forEach((pts, key) => {
      ctx.strokeStyle = colorOf(key);
      ctx.beginPath();
      for (let k = 0; k < pts.length; k += 4) {
        ctx.moveTo(pts[k], pts[k + 1]);
        ctx.lineTo(pts[k + 2], pts[k + 3]);
      }
      ctx.stroke();
    });
  }
}
