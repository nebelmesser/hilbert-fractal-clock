import { HILBERT_CACHE_MAX, HILBERT_ZOOM_MAX_DEPTH, ZOOM_MIN_AREA } from '../constants';
import { sign } from '../math';
import type { CellBox, HilbertBlock, HilbertGrid } from '../types';

type WalkChild = (
  x: number, y: number, ax: number, ay: number, bx: number, by: number,
  iStart: number, depth: number,
) => void;

type ZoomVariant = {
  xs: Uint16Array;
  ys: Uint16Array;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
};

/**
 * Generalized Hilbert / Gilbert curve: build, cache, packed partitions, and 4-connected zoom paths.
 */
export class HilbertCurve {
  private cache = new Map<string, HilbertGrid>();
  private packedTileCache = new Map<string, HilbertBlock[]>();
  private zoomVarCache = new Map<number, ZoomVariant[]>();
  private packScratch: {
    minx: Int32Array;
    maxx: Int32Array;
    miny: Int32Array;
    maxy: Int32Array;
    length: number;
  } | null = null;

  /** Drop parent-curve, packed-tile, and zoom-variant caches. */
  clear(): void {
    this.cache.clear();
    this.packedTileCache.clear();
    this.zoomVarCache.clear();
  }

  /** Cached parent-grid curve for w×h. */
  get(w: number, h: number): HilbertGrid {
    const key = w + 'x' + h;
    let g = this.cache.get(key);
    if (!g) {
      g = this.build(w, h);
      if (this.cache.size > HILBERT_CACHE_MAX) this.cache.clear();
      this.cache.set(key, g);
    }
    return g;
  }

  /** Generalized Hilbert fill of width×height. Even squares split 4-way. */
  build(width: number, height: number): HilbertGrid {
    const n = width * height;
    const xs = new Uint16Array(n);
    const ys = new Uint16Array(n);
    const at = new Int32Array(n);
    let i = 0;
    const visit = (x: number, y: number) => {
      xs[i] = x;
      ys[i] = y;
      at[y * width + x] = i;
      i++;
    };
    const hilbert2d = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
      const w = Math.abs(ax + ay);
      const h = Math.abs(bx + by);
      const dax = sign(ax), day = sign(ay);
      const dbx = sign(bx), dby = sign(by);
      if (h === 1) {
        for (let k = 0; k < w; k++) { visit(x, y); x += dax; y += day; }
        return;
      }
      if (w === 1) {
        for (let k = 0; k < h; k++) { visit(x, y); x += dbx; y += dby; }
        return;
      }
      this.gilbertSplitWalk(x, y, ax, ay, bx, by, 0, 0, w, h, (nx, ny, nax, nay, nbx, nby) => {
        hilbert2d(nx, ny, nax, nay, nbx, nby);
      });
    };
    hilbert2d(0, 0, width, 0, 0, height);
    return { xs, ys, at, n: i };
  }

  /** Axis-aligned box of one Hilbert partition. */
  cellRect(x: number, y: number, ax: number, ay: number, bx: number, by: number): CellBox {
    const w = Math.abs(ax + ay);
    const h = Math.abs(bx + by);
    const dax = sign(ax), day = sign(ay);
    const dbx = sign(bx), dby = sign(by);
    const x1 = x + dax * Math.max(0, w - 1) + dbx * Math.max(0, h - 1);
    const y1 = y + day * Math.max(0, w - 1) + dby * Math.max(0, h - 1);
    return { x: Math.min(x, x1), y: Math.min(y, y1), w: Math.abs(x1 - x) + 1, h: Math.abs(y1 - y) + 1 };
  }

  /** 4-way Hilbert on even squares; otherwise Gilbert 2- or 3-way. */
  gilbertSplitWalk(
    x: number, y: number, ax: number, ay: number, bx: number, by: number,
    iStart: number, depth: number, w: number, h: number, walkChild: WalkChild,
  ): void {
    const dax = sign(ax), day = sign(ay);
    const dbx = sign(bx), dby = sign(by);
    let ax2 = Math.floor(ax / 2), ay2 = Math.floor(ay / 2);
    let bx2 = Math.floor(bx / 2), by2 = Math.floor(by / 2);
    const w2 = Math.abs(ax2 + ay2);
    const h2 = Math.abs(bx2 + by2);
    if (w === h && (w % 2 === 0) && w > 1) {
      const aQ = w2 * Math.abs(bx2 + by2);
      walkChild(x, y, bx2, by2, ax2, ay2, iStart, depth + 1);
      walkChild(x + bx2, y + by2, ax2, ay2, bx2, by2, iStart + aQ, depth + 1);
      walkChild(x + ax2 + bx2, y + ay2 + by2, ax2, ay2, bx2, by2, iStart + 2 * aQ, depth + 1);
      walkChild(
        x + (ax - dax) + (bx2 - dbx),
        y + (ay - day) + (by2 - dby),
        -bx2, -by2, -(ax - ax2), -(ay - ay2),
        iStart + 3 * aQ, depth + 1,
      );
      return;
    }
    if (2 * w > 3 * h) {
      if ((w2 % 2) && (w > 2)) { ax2 += dax; ay2 += day; }
      const a1 = Math.abs(ax2 + ay2) * h;
      walkChild(x, y, ax2, ay2, bx, by, iStart, depth + 1);
      walkChild(x + ax2, y + ay2, ax - ax2, ay - ay2, bx, by, iStart + a1, depth + 1);
    } else {
      if ((h2 % 2) && (h > 2)) { bx2 += dbx; by2 += dby; }
      const a1 = Math.abs(bx2 + by2) * Math.abs(ax2 + ay2);
      const a2 = w * Math.abs((bx - bx2) + (by - by2));
      walkChild(x, y, bx2, by2, ax2, ay2, iStart, depth + 1);
      walkChild(x + bx2, y + by2, ax, ay, bx - bx2, by - by2, iStart + a1, depth + 1);
      walkChild(
        x + (ax - dax) + (bx2 - dbx),
        y + (ay - day) + (by2 - dby),
        -bx2, -by2, -(ax - ax2), -(ay - ay2),
        iStart + a1 + a2, depth + 1,
      );
    }
  }

  /** Walk every Gilbert split; optional nowIdx prune; stopArea skips children. */
  walkPartitions(
    width: number, height: number,
    visit: (box: CellBox, iStart: number, iEnd: number, area: number) => void,
    nowIdx: number | null, stopArea: number | null,
  ): void {
    const walk = (x: number, y: number, ax: number, ay: number, bx: number, by: number, iStart: number) => {
      const w = Math.abs(ax + ay);
      const h = Math.abs(bx + by);
      const area = w * h;
      const iEnd = iStart + area;
      if (nowIdx != null && (nowIdx < iStart || nowIdx >= iEnd)) return;
      const box = this.cellRect(x, y, ax, ay, bx, by);
      visit(box, iStart, iEnd, area);
      if (h === 1 || w === 1) return;
      if (stopArea != null && area <= stopArea) return;
      this.gilbertSplitWalk(x, y, ax, ay, bx, by, iStart, 0, w, h, (nx, ny, nax, nay, nbx, nby, ni) => {
        walk(nx, ny, nax, nay, nbx, nby, ni);
      });
    };
    walk(0, 0, width, 0, 0, height, 0);
  }

  /** Packed leaves at one partition depth; nowIdx prunes branches that miss now. */
  coverWalk(
    width: number, height: number, nowIdx: number | null, maxDepth: number,
    visitLeaf: (box: CellBox, iStart: number, iEnd: number, area: number) => void,
  ): void {
    const walk = (
      x: number, y: number, ax: number, ay: number, bx: number, by: number,
      iStart: number, depth: number,
    ) => {
      const w = Math.abs(ax + ay);
      const h = Math.abs(bx + by);
      const area = w * h;
      const iEnd = iStart + area;
      if (nowIdx != null && (nowIdx < iStart || nowIdx >= iEnd)) return;
      if (h === 1 || w === 1 || depth >= maxDepth) {
        visitLeaf(this.cellRect(x, y, ax, ay, bx, by), iStart, iEnd, area);
        return;
      }
      this.gilbertSplitWalk(x, y, ax, ay, bx, by, iStart, depth, w, h, walk);
    };
    walk(0, 0, width, 0, 0, height, 0, 0);
  }

  /** The unique packed cell at this depth that contains nowIdx. */
  leafAt(width: number, height: number, nowIdx: number, depth: number): HilbertBlock | null {
    if (!(depth >= 1) || nowIdx == null || nowIdx < 0) return null;
    let found: HilbertBlock | null = null;
    this.coverWalk(width, height, nowIdx, depth, (box, i0, i1, area) => {
      found = { box, i0, i1, area };
    });
    return found;
  }

  /** Packed partitions that contain now, with area ≤ maxArea. */
  collectBlocks(width: number, height: number, nowIdx: number, maxArea: number): HilbertBlock[] {
    const out: HilbertBlock[] = [];
    this.walkPartitions(width, height, (box, i0, i1, area) => {
      if (area >= ZOOM_MIN_AREA && area <= maxArea && box.w * box.h === area) {
        out.push({ box, i0, i1, area });
      }
    }, nowIdx, null);
    return out;
  }

  /** Every packed w×h window on the curve, not only Gilbert nodes. */
  collectPackedTiles(width: number, height: number, wantW: number, wantH: number): HilbertBlock[] {
    const wantArea = wantW * wantH;
    if (!(wantArea > 0) || wantW < 1 || wantH < 1 || wantW > width || wantH > height) return [];
    const key = width + 'x' + height + ':' + wantW + 'x' + wantH;
    const hit = this.packedTileCache.get(key);
    if (hit) return hit;
    const g = this.get(width, height);
    const xs = g.xs, ys = g.ys, n = g.n;
    if (wantArea > n) return [];
    if (!this.packScratch || this.packScratch.length < n) {
      this.packScratch = {
        minx: new Int32Array(n),
        maxx: new Int32Array(n),
        miny: new Int32Array(n),
        maxy: new Int32Array(n),
        length: n,
      };
    }
    const minxQ = this.packScratch.minx, maxxQ = this.packScratch.maxx;
    const minyQ = this.packScratch.miny, maxyQ = this.packScratch.maxy;
    let minxH = 0, minxT = 0, maxxH = 0, maxxT = 0, minyH = 0, minyT = 0, maxyH = 0, maxyT = 0;
    const out: HilbertBlock[] = [];
    for (let i = 0; i < n; i++) {
      const xv = xs[i], yv = ys[i];
      while (minxT > minxH && xs[minxQ[minxT - 1]] >= xv) minxT--;
      minxQ[minxT++] = i;
      while (maxxT > maxxH && xs[maxxQ[maxxT - 1]] <= xv) maxxT--;
      maxxQ[maxxT++] = i;
      while (minyT > minyH && ys[minyQ[minyT - 1]] >= yv) minyT--;
      minyQ[minyT++] = i;
      while (maxyT > maxyH && ys[maxyQ[maxyT - 1]] <= yv) maxyT--;
      maxyQ[maxyT++] = i;
      const i0 = i - wantArea + 1;
      if (i0 < 0) continue;
      while (minxH < minxT && minxQ[minxH] < i0) minxH++;
      while (maxxH < maxxT && maxxQ[maxxH] < i0) maxxH++;
      while (minyH < minyT && minyQ[minyH] < i0) minyH++;
      while (maxyH < maxyT && maxyQ[maxyH] < i0) maxyH++;
      const x0 = xs[minxQ[minxH]], x1v = xs[maxxQ[maxxH]];
      const y0 = ys[minyQ[minyH]], y1v = ys[maxyQ[maxyH]];
      if (x1v - x0 + 1 === wantW && y1v - y0 + 1 === wantH) {
        out.push({ box: { x: x0, y: y0, w: wantW, h: wantH }, i0, i1: i0 + wantArea, area: wantArea });
      }
    }
    if (this.packedTileCache.size >= 24) this.packedTileCache.delete(this.packedTileCache.keys().next().value!);
    this.packedTileCache.set(key, out);
    return out;
  }

  /** Largest packed partition containing now. */
  findBlock(width: number, height: number, nowIdx: number, maxArea: number): HilbertBlock | null {
    const blocks = this.collectBlocks(width, height, nowIdx, maxArea);
    let best: HilbertBlock | null = null;
    for (let i = 0; i < blocks.length; i++) {
      if (!best || blocks[i].area > best.area) best = blocks[i];
    }
    return best;
  }

  /** Packed-leaf stats at this Hilbert/Gilbert depth. */
  depthInfo(width: number, height: number, depth: number): {
    depth: number; n: number; packedN: number; maxArea: number; minArea: number;
    maxBox: CellBox | null; commonW: number; commonH: number; commonArea: number;
    commonCount: number; uniform: boolean;
  } {
    let maxArea = 0, minArea = Infinity, n = 0, packedN = 0;
    let maxBox: CellBox | null = null;
    let commonArea = 0, commonCount = 0, commonW = 0, commonH = 0;
    const sizes: Record<string, number> = {};
    this.coverWalk(width, height, null, depth, (box, _i0, _i1, area) => {
      n++;
      if (box.w * box.h !== area) return;
      packedN++;
      if (area > maxArea) {
        maxArea = area;
        maxBox = { x: box.x, y: box.y, w: box.w, h: box.h };
      }
      if (area < minArea) minArea = area;
      const key = box.w + 'x' + box.h;
      const c = (sizes[key] || 0) + 1;
      sizes[key] = c;
      if (c > commonCount || (c === commonCount && area > commonArea)) {
        commonCount = c;
        commonArea = area;
        commonW = box.w;
        commonH = box.h;
      }
    });
    return {
      depth, n, packedN, maxArea, minArea, maxBox,
      commonW, commonH, commonArea, commonCount,
      uniform: Object.keys(sizes).length === 1,
    };
  }

  /** Packed leaf at each depth that contains now. */
  leavesAt(width: number, height: number, nowIdx: number): HilbertBlock[] {
    const out: HilbertBlock[] = [];
    for (let d = 1; d <= HILBERT_ZOOM_MAX_DEPTH; d++) {
      const leaf = this.leafAt(width, height, nowIdx, d);
      if (!leaf) continue;
      if (leaf.area < ZOOM_MIN_AREA) break;
      if (leaf.box.w * leaf.box.h !== leaf.area) continue;
      out.push({ box: leaf.box, i0: leaf.i0, i1: leaf.i1, area: leaf.area, depth: d });
    }
    return out;
  }

  /** 8 reflections × 2 directions of a k×k Hilbert — pick one so the zoom path stays 4-connected. */
  variants(k: number): ZoomVariant[] {
    let vars = this.zoomVarCache.get(k);
    if (vars) return vars;
    const g = this.get(k, k);
    const n = k * k;
    const maps: Array<(x: number, y: number) => [number, number]> = [
      (x, y) => [x, y],
      (x, y) => [k - 1 - y, x],
      (x, y) => [k - 1 - x, k - 1 - y],
      (x, y) => [y, k - 1 - x],
      (x, y) => [k - 1 - x, y],
      (x, y) => [x, k - 1 - y],
      (x, y) => [y, x],
      (x, y) => [k - 1 - y, k - 1 - x],
    ];
    vars = [];
    for (let m = 0; m < maps.length; m++) {
      for (let rev = 0; rev < 2; rev++) {
        const xs = new Uint16Array(n);
        const ys = new Uint16Array(n);
        for (let i = 0; i < n; i++) {
          const j = rev ? n - 1 - i : i;
          const p = maps[m](g.xs[j], g.ys[j]);
          xs[i] = p[0];
          ys[i] = p[1];
        }
        vars.push({ xs, ys, sx: xs[0], sy: ys[0], ex: xs[n - 1], ey: ys[n - 1] });
      }
    }
    this.zoomVarCache.set(k, vars);
    return vars;
  }

  /** First variant whose start/end touch the previous/next parent cell. */
  pickZoomVariant(
    vars: ZoomVariant[], k: number, ox: number, oy: number,
    prevx: number, prevy: number, nextOx: number | null, nextOy: number | null,
  ): ZoomVariant | null {
    for (let i = 0; i < vars.length; i++) {
      const v = vars[i];
      const sx = ox + v.sx;
      const sy = oy + v.sy;
      const ex = ox + v.ex;
      const ey = oy + v.ey;
      if (prevx >= 0 && Math.abs(sx - prevx) + Math.abs(sy - prevy) !== 1) continue;
      if (nextOx != null && nextOy != null) {
        const c0 = Math.abs(ex - nextOx) + Math.abs(ey - nextOy) === 1;
        const c1 = Math.abs(ex - (nextOx + k - 1)) + Math.abs(ey - nextOy) === 1;
        const c2 = Math.abs(ex - nextOx) + Math.abs(ey - (nextOy + k - 1)) === 1;
        const c3 = Math.abs(ex - (nextOx + k - 1)) + Math.abs(ey - (nextOy + k - 1)) === 1;
        if (!c0 && !c1 && !c2 && !c3) continue;
      }
      return v;
    }
    return null;
  }

  /** Each parent cell → k×k in place; the refined path stays 4-connected. */
  buildZoom(parentG: HilbertGrid, box: CellBox, i0: number, i1: number, k: number, indices?: number[] | null): HilbertGrid {
    const W = box.w * k;
    const H = box.h * k;
    const seq = indices || null;
    const count = seq ? seq.length : (i1 - i0);
    const n = W * H;
    const xs = new Uint16Array(n);
    const ys = new Uint16Array(n);
    const at = new Int32Array(n);
    at.fill(-1);
    const vars = this.variants(k);
    const kk = k * k;
    let t = 0;
    let prevx = -1;
    let prevy = -1;
    for (let s = 0; s < count; s++) {
      const i = seq ? seq[s] : (i0 + s);
      const ox = (parentG.xs[i] - box.x) * k;
      const oy = (parentG.ys[i] - box.y) * k;
      let nextOx: number | null = null;
      let nextOy: number | null = null;
      if (s + 1 < count) {
        const ni = seq ? seq[s + 1] : (i0 + s + 1);
        nextOx = (parentG.xs[ni] - box.x) * k;
        nextOy = (parentG.ys[ni] - box.y) * k;
      }
      let v = this.pickZoomVariant(vars, k, ox, oy, prevx, prevy, nextOx, nextOy);
      if (!v) v = this.pickZoomVariant(vars, k, ox, oy, prevx, prevy, null, null);
      if (!v) v = vars[0];
      for (let j = 0; j < kk; j++) {
        const x = ox + v.xs[j];
        const y = oy + v.ys[j];
        xs[t] = x;
        ys[t] = y;
        at[y * W + x] = t;
        t++;
        prevx = x;
        prevy = y;
      }
    }
    return { xs, ys, at, n: t };
  }
}

export const curves = new HilbertCurve();
