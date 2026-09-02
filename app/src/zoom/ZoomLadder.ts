import {
  FACTOR_MIN, HILBERT_ZOOM_MAX_DEPTH, LABEL_DAY_MAX, LABEL_DAY_MIN,
  LABEL_FILL, LABEL_TARGET_REGIONS, LABEL_TOO_FEW, LABEL_TOO_FEW_WEIGHT,
  LABEL_TOO_MANY, MAX_BOUND_LEVELS, MS_DAY, UNIT_MIN_CELL_SPAN,
  UNIT_MIN_CELLS_PER, UNIT_MIN_REGIONS, ZOOM_BOX_MIN_PX, ZOOM_DEPTH_AREA_RATIO,
  ZOOM_KEEP_AREA_HI, ZOOM_KEEP_AREA_LO, ZOOM_MIN_AREA, ZOOM_MIN_FILL_MS,
  ZOOM_PARENT_SHARE, ZOOM_STEP_MIN_SHRINK,
} from '../constants';
import type { HilbertCurve } from '../curve/HilbertCurve';
import type { GridPlanner } from '../grid/GridPlanner';
import { UNITS } from '../time/units';
import type { CellBox, GridSpec, HilbertBlock, HilbertGrid, TimeUnit, ZoomLevel } from '../types';

/** True if now's parent cell sits inside the yellow box. */
export function boxContainsCell(box: CellBox, g: HilbertGrid, nowIdx: number): boolean {
  const x = g.xs[nowIdx], y = g.ys[nowIdx];
  return x >= box.x && y >= box.y && x < box.x + box.w && y < box.y + box.h;
}

/** Up to 3 units, each large enough to draw and not a single slab. */
export function pickLevels(start: number, end: number, cellDur: number): TimeUnit[] {
  const duration = end - start;
  const picked: TimeUnit[] = [];
  for (let i = 0; i < UNITS.length; i++) {
    const u = UNITS[i];
    if (u.typical < cellDur * UNIT_MIN_CELL_SPAN) continue;
    const nRegions = duration / u.typical;
    const cellsPer = u.typical / cellDur;
    if (nRegions < UNIT_MIN_REGIONS) continue;
    if (cellsPer < UNIT_MIN_CELLS_PER) continue;
    picked.push(u);
    if (picked.length === MAX_BOUND_LEVELS) break;
  }
  return picked;
}

/** One label level; prefer days on a ~month view; else ~18 regions. */
export function pickLabelLevelIndex(levels: TimeUnit[], start: number, end: number): number {
  if (!levels.length) return 0;
  const duration = end - start;
  const nDays = duration / MS_DAY;
  const dayIdx = levels.findIndex((u) => u.id === 'day');
  if (dayIdx >= 0 && nDays >= LABEL_DAY_MIN && nDays <= LABEL_DAY_MAX) return dayIdx;
  let best = 0;
  let bestScore = Infinity;
  for (let i = 0; i < levels.length; i++) {
    const n = duration / levels[i].typical;
    const score = n > LABEL_TOO_MANY ? n - LABEL_TOO_MANY
      : n < LABEL_TOO_FEW ? (LABEL_TOO_FEW - n) * LABEL_TOO_FEW_WEIGHT
        : Math.abs(n - LABEL_TARGET_REGIONS);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** The unit this map would letter. */
export function zoomLabelUnit(start: number, end: number, cellDur: number): TimeUnit | null {
  const levels = pickLevels(start, end, cellDur);
  if (!levels.length) return null;
  return levels[pickLabelLevelIndex(levels, start, end)];
}

/** Coarsest zoom must letter a finer unit than the parent. */
export function zoomRefinesLabels(
  parentStart: number, parentEnd: number, parentDur: number,
  zStart: number, zEnd: number, insetD: number,
): boolean {
  const parent = zoomLabelUnit(parentStart, parentEnd, parentDur);
  const inset = zoomLabelUnit(zStart, zEnd, insetD);
  if (!parent || !inset) return true;
  const pi = UNITS.findIndex((u) => u.id === parent.id);
  const zi = UNITS.findIndex((u) => u.id === inset.id);
  return zi > pi;
}

/** Inset: units coarser than levels[0], stroked as bound-0. */
export function higherBoundUnits(levels: TimeUnit[], cellDur: number): TimeUnit[] {
  const currentId = levels[0] && levels[0].id;
  const cut = currentId ? UNITS.findIndex((u) => u.id === currentId) : UNITS.length;
  const out: TimeUnit[] = [];
  for (let i = 0; i < cut; i++) {
    if (UNITS[i].typical < cellDur * UNIT_MIN_CELL_SPAN) continue;
    out.push(UNITS[i]);
  }
  return out;
}

/**
 * Hilbert-tree zoom depths: packed leaves around now, skip half-splits.
 */
export class ZoomLadder {
  private cache = new Map<string, ZoomLevel[]>();

  /** Bind curve + grid planners used to score depths. */
  constructor(private curves: HilbertCurve, private grids: GridPlanner) {}

  /** Drop the depth-list cache. */
  clear(): void {
    this.cache.clear();
  }

  /** Yellow box large enough to see on the parent canvas. */
  zoomBoxCssOk(grid: GridSpec, box: CellBox, cssW: number): boolean {
    if (!(cssW > 0)) return true;
    const cell = cssW / Math.max(1, grid.w);
    return box.w * cell >= ZOOM_BOX_MIN_PX && box.h * cell >= ZOOM_BOX_MIN_PX;
  }

  /** Coarsest-first: one Hilbert tree depth per +/− step. */
  levels(grid: GridSpec, cssW: number, rangeStart: number, rangeEnd: number): ZoomLevel[] {
    const t0 = Number.isFinite(rangeStart) ? rangeStart : 0;
    const t1 = Number.isFinite(rangeEnd) && rangeEnd > t0
      ? rangeEnd
      : t0 + grid.cellDur * Math.max(1, grid.cells);
    const key = grid.w + 'x' + grid.h + ':' + grid.cellDur + ':' + Math.round(cssW || 0) + ':' + t0 + ':' + t1;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const out: ZoomLevel[] = [];
    for (let d = 1; d <= HILBERT_ZOOM_MAX_DEPTH; d++) {
      const info = this.curves.depthInfo(grid.w, grid.h, d);
      if (!info.maxBox || info.maxArea < ZOOM_MIN_AREA) break;
      const w = info.commonW, h = info.commonH;
      if (!(w >= 1 && h >= 1)) continue;
      const area = info.commonArea || (w * h);
      if (area > grid.w * grid.h * ZOOM_PARENT_SHARE) continue;
      if (!this.zoomBoxCssOk(grid, info.maxBox, cssW)) break;
      const plan = this.grids.insetPlanForBox(grid, info.maxBox, cssW);
      if (!plan) continue;
      const zEnd = Math.min(t1, t0 + area * grid.cellDur);
      if (!zoomRefinesLabels(t0, t1, grid.cellDur, t0, zEnd, plan.D)) continue;
      if (out.length && info.maxArea > out[out.length - 1].maxArea / ZOOM_DEPTH_AREA_RATIO) continue;
      out.push({
        depth: d, w, h, area, maxArea: info.maxArea, k: plan.k, D: plan.D, mixed: !info.uniform,
      });
    }
    if (this.cache.size >= 24) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, out);
    return out;
  }

  /** 0 / 1e15 → coarsest (largest packed cells with D ≤ 1s). */
  pickLevel(levels: ZoomLevel[], storedArea: number): ZoomLevel | null {
    if (!levels.length) return null;
    let best = levels[0];
    if (storedArea > 0 && storedArea < 1e14) {
      let bestD = Infinity;
      for (let i = 0; i < levels.length; i++) {
        const a = levels[i].nowArea && levels[i].nowArea! > 0 ? levels[i].nowArea! : levels[i].area;
        const d = Math.abs(a - storedArea);
        const bestA = best.nowArea && best.nowArea > 0 ? best.nowArea : best.area;
        if (d < bestD || (d === bestD && a > bestA)) {
          bestD = d;
          best = levels[i];
        }
      }
    }
    return best;
  }

  /** Unique packed tree leaf at this depth that contains now. */
  pickLeaf(
    width: number, height: number, nowIdx: number, depth: number,
    grid: GridSpec, cssW: number, rangeStart: number, rangeEnd: number,
  ): HilbertBlock | null {
    const leaf = this.curves.leafAt(width, height, nowIdx, depth);
    if (!leaf || leaf.area < ZOOM_MIN_AREA) return null;
    if (leaf.box.w * leaf.box.h !== leaf.area) return null;
    if (leaf.area > width * height * ZOOM_PARENT_SHARE) return null;
    if (!this.zoomBoxCssOk(grid, leaf.box, cssW)) return null;
    const plan = this.grids.insetPlanForBox(grid, leaf.box, cssW);
    if (!plan) return null;
    const t0 = Number.isFinite(rangeStart) ? rangeStart : 0;
    const t1 = Number.isFinite(rangeEnd) && rangeEnd > t0
      ? rangeEnd
      : t0 + grid.cellDur * Math.max(1, grid.cells);
    const zStart = t0 + leaf.i0 * grid.cellDur;
    const zEnd = Math.min(t1, zStart + leaf.area * grid.cellDur);
    if (zEnd - zStart < ZOOM_MIN_FILL_MS) return null;
    if (!zoomRefinesLabels(t0, t1, grid.cellDur, zStart, zEnd, plan.D)) return null;
    leaf.depth = depth;
    return leaf;
  }

  /** +/− stops; skip a depth that only halves now's leaf. */
  ladderLevels(grid: GridSpec, cssW: number, rangeStart: number, rangeEnd: number, nowIdx: number): ZoomLevel[] {
    const levels = this.levels(grid, cssW, rangeStart, rangeEnd);
    const out: ZoomLevel[] = [];
    for (let t = 0; t < levels.length; t++) {
      const L = levels[t];
      const leaf = this.pickLeaf(grid.w, grid.h, nowIdx, L.depth, grid, cssW, rangeStart, rangeEnd);
      if (!leaf) continue;
      if (out.length && leaf.area * ZOOM_STEP_MIN_SHRINK > (out[out.length - 1].nowArea ?? 0)) continue;
      out.push({
        depth: L.depth, w: L.w, h: L.h, area: L.area, maxArea: L.maxArea,
        k: L.k, D: L.D, mixed: L.mixed,
        nowArea: leaf.area, nowW: leaf.box.w, nowH: leaf.box.h,
      });
    }
    return out;
  }

  /** Prefer a leaf whose area stays near wantArea so mixed siblings do not zoom in. */
  pickLeafNearArea(
    leaves: HilbertBlock[], wantArea: number, width: number, height: number,
    grid: GridSpec, cssW: number, rangeStart: number, rangeEnd: number, loose: boolean,
  ): HilbertBlock | null {
    if (!leaves.length || !(wantArea >= ZOOM_MIN_AREA)) return null;
    const lo = wantArea * ZOOM_KEEP_AREA_LO;
    const hi = wantArea * ZOOM_KEEP_AREA_HI;
    const t0 = Number.isFinite(rangeStart) ? rangeStart : 0;
    const t1 = Number.isFinite(rangeEnd) && rangeEnd > t0
      ? rangeEnd
      : t0 + grid.cellDur * Math.max(1, grid.cells);
    let best: HilbertBlock | null = null, bestScore = Infinity;
    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      if (!loose && leaf.area > width * height * ZOOM_PARENT_SHARE) continue;
      if (!this.zoomBoxCssOk(grid, leaf.box, cssW)) continue;
      const plan = this.grids.insetPlanForBox(grid, leaf.box, cssW);
      if (!plan) continue;
      const zStart = t0 + leaf.i0 * grid.cellDur;
      const zEnd = Math.min(t1, zStart + leaf.area * grid.cellDur);
      if (zEnd - zStart < ZOOM_MIN_FILL_MS) continue;
      if (!loose) {
        if (!zoomRefinesLabels(t0, t1, grid.cellDur, zStart, zEnd, plan.D)) continue;
      }
      const a = leaf.area;
      const inBand = a >= lo && a <= hi;
      const rel = Math.abs(a - wantArea) / wantArea;
      const score = inBand ? rel : (10 + Math.abs(Math.log(a / Math.max(1, wantArea))) + (a < lo ? 5 : 0));
      if (score < bestScore) {
        bestScore = score;
        best = leaf;
      }
    }
    return best;
  }

  /** Typical glyph size if this window were the inset. */
  estimateInsetLabelPx(
    zStart: number, zEnd: number, box: CellBox, k: number,
    parentDur: number, tileW: number, tileH: number,
  ): number {
    const kk = k >= FACTOR_MIN ? k : 1;
    const D = k >= FACTOR_MIN ? parentDur / (k * k) : parentDur;
    if (!(D > 0) || !(tileW > 0) || !(tileH > 0)) return 0;
    const levels = pickLevels(zStart, zEnd, D);
    if (!levels.length) return 0;
    const unit = levels[pickLabelLevelIndex(levels, zStart, zEnd)];
    const n = Math.max(1, (zEnd - zStart) / unit.typical);
    const css = this.grids.insetLetterbox(box.w, box.h, kk, tileW, tileH);
    return Math.min(css.cssW, css.cssH) / n * LABEL_FILL;
  }
}
