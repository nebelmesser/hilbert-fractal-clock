import {
  ASPECT_MAX, ASPECT_MIN, CELL_CAP_SLACK, FACTOR_MIN, FINE_CELL_DURS,
  GRID_ORIENT_EPS, GRID_SEARCH_SPAN_FRAC, GRID_SEARCH_SPAN_MIN,
  INSET_CELL_DURS, INSET_MAX_D, INSET_MIN_D, MAX_CELLS, MAX_CELLS_HARD,
  MIN_CELL_PX, MIN_CELLS, MIN_CSS_PX, MS_SEC, NICE_DIMS, NICE_DURS,
  POW2_SIDE_HI, POW2_SIDE_LO, SCORE_COUNT_WEIGHT, SCORE_EXACT_BONUS,
  SCORE_FINE_DUR_BONUS, SCORE_LEFTOVER_WEIGHT, SCORE_NEAR_SQUARE_HI,
  SCORE_NEAR_SQUARE_LO, SCORE_NICE_DIM_BONUS, SCORE_NOT_ZOOMABLE,
  SCORE_ODD_PENALTY, SCORE_POW2_CELLS, SCORE_PREFER_DUR_BONUS,
  SCORE_QUAD_PENALTY, SCORE_SQUARE_BONUS, SCORE_TALL_WEIGHT,
  SCORE_WHOLE_SEC_BONUS, SCORE_WIDE_WEIGHT, SCORE_ZOOMABLE_BONUS,
  UNIX32_END, ZOOM_CSS_SLACK, ZOOM_K_DUR_EPS, ZOOM_KS, ZOOM_MIN_AREA,
  ZOOM_RES_MAX,
} from '../constants';
import { clamp } from '../math';
import type { CellBox, GridSpec, InsetPlan } from '../types';

const NICE_DIM_SET = new Set(NICE_DIMS);

/**
 * Pick w×h and cellDur for a time range, and plan inset refinement k×D.
 */
export class GridPlanner {
  /** Integer k with k² × D = parent cell duration (within ZOOM_K_DUR_EPS). */
  exactZoomK(parentDur: number, D: number): number {
    if (!(parentDur > 0) || !(D > 0)) return 0;
    const k = Math.round(Math.sqrt(parentDur / D));
    if (k < FACTOR_MIN) return 0;
    if (Math.abs(k * k * D - parentDur) > ZOOM_K_DUR_EPS) return 0;
    return k;
  }

  /** True if a parent cell can refine to some D in [1ms, 1s]. */
  isZoomableDur(cellDur: number): boolean {
    if (cellDur <= INSET_MAX_D) return true;
    const k = Math.ceil(Math.sqrt(cellDur / INSET_MAX_D) - 1e-12);
    if (k < 1) return false;
    const D = cellDur / (k * k);
    return D >= INSET_MIN_D - 1e-9 && D <= INSET_MAX_D + 1;
  }

  /** Pixel budget between MAX_CELLS and MAX_CELLS_HARD. */
  maxCellsFor(cssWidth: number, targetAspect: number): number {
    if (!(cssWidth > 0)) return MAX_CELLS;
    const cssH = Math.max(1, cssWidth / clamp(targetAspect || 1, ASPECT_MIN, ASPECT_MAX));
    return clamp(Math.ceil(cssWidth * cssH), MAX_CELLS, MAX_CELLS_HARD);
  }

  /** Exact w×h factorizations of a cell count. */
  factorPairs(n: number): Array<[number, number]> {
    const pairs: Array<[number, number]> = [];
    const lim = Math.floor(Math.sqrt(n));
    for (let a = FACTOR_MIN; a <= lim; a++) {
      if (n % a === 0) {
        const b = n / a;
        if (b >= FACTOR_MIN) {
          pairs.push([a, b]);
          if (a !== b) pairs.push([b, a]);
        }
      }
    }
    return pairs;
  }

  /** First INSET_CELL_DURS plan that fits the cell cap. */
  planInsetWithCap(parentDur: number, srcW: number, srcH: number, cap: number): InsetPlan | null {
    let best: InsetPlan | null = null;
    for (let i = 0; i < INSET_CELL_DURS.length; i++) {
      const D = INSET_CELL_DURS[i];
      const k = this.exactZoomK(parentDur, D);
      if (!k) continue;
      const W = srcW * k;
      const H = srcH * k;
      if (W * H > cap) continue;
      best = { k, D, W, H };
      break;
    }
    return best;
  }

  /** Do not let the inset greatly out-resolve the parent or the CSS tile. */
  insetCellCap(srcW: number, srcH: number, cssWidth: number, parentW: number, parentH: number): number {
    const aspect = srcW / Math.max(1, srcH);
    const cssH = Math.max(1, cssWidth / clamp(aspect || 1, ASPECT_MIN, ASPECT_MAX));
    const cssN = Math.ceil(Math.max(1, cssWidth) * cssH);
    const parentN = Math.max(1, (parentW || 0) * (parentH || 0));
    const fromCss = Math.ceil(cssN * ZOOM_CSS_SLACK);
    const fromParent = parentN > 1 ? Math.ceil(parentN * ZOOM_RES_MAX) : MAX_CELLS_HARD;
    const fromHard = this.maxCellsFor(cssWidth, aspect);
    return Math.max(ZOOM_MIN_AREA * FACTOR_MIN * FACTOR_MIN, Math.min(fromHard, fromCss, fromParent));
  }

  /** Finest D that fits the inset cap — no hard fallback past the parent. */
  planInset(parentDur: number, srcW: number, srcH: number, cssWidth: number, parentW: number, parentH: number): InsetPlan | null {
    return this.planInsetWithCap(parentDur, srcW, srcH, this.insetCellCap(srcW, srcH, cssWidth, parentW, parentH));
  }

  /** 1s (or a fraction) when the whole range fits the pixel budget. */
  pickFineCellDur(durationMs: number, cssWidth: number, targetAspect: number, cellCap?: number): number | null {
    if (!(durationMs > 0) || !(cssWidth > 0)) return null;
    const cap = cellCap && cellCap > 0 ? cellCap : this.maxCellsFor(cssWidth, targetAspect);
    if (durationMs / MS_SEC > cap) return null;
    const cssH = Math.max(1, cssWidth / clamp(targetAspect, ASPECT_MIN, ASPECT_MAX));
    const px = cssWidth * cssH;
    let chosen: number | null = null;
    for (let i = 0; i < FINE_CELL_DURS.length; i++) {
      const D = FINE_CELL_DURS[i];
      const cells = Math.ceil(durationMs / D);
      if (cells < MIN_CELLS || cells > cap) continue;
      if (Math.sqrt(px / cells) >= MIN_CELL_PX) chosen = D;
    }
    return chosen;
  }

  /** Finest nice D that still fits the inset cap. */
  pickInsetPreferDur(durationMs: number, cap: number): number {
    const durs = [1, 2, 5, 10, 20, 50, 100, 250, 500, MS_SEC];
    for (let i = 0; i < durs.length; i++) {
      const D = durs[i];
      const cells = Math.ceil(durationMs / D);
      if (cells >= MIN_CELLS && cells <= cap) return D;
    }
    return MS_SEC;
  }

  /** Lower is better; must stay 1s-zoomable when the parent cell is > 1s. */
  scoreGrid(
    w: number, h: number, cells: number, cellDur: number,
    targetAspect: number, targetCells: number, preferDur: number | null,
  ): number {
    const n = w * h;
    const leftover = n - cells;
    const leftoverRatio = leftover / n;
    const aspectLog = Math.log((w / h) / Math.max(1e-6, targetAspect));
    const aspectErr = Math.abs(aspectLog) * (aspectLog > 0 ? SCORE_WIDE_WEIGHT : SCORE_TALL_WEIGHT);
    const oddPenalty = ((w % 2) + (h % 2)) * SCORE_ODD_PENALTY;
    const quadPenalty = ((w % 4 !== 0 ? 1 : 0) + (h % 4 !== 0 ? 1 : 0)) * SCORE_QUAD_PENALTY;
    const durationSeconds = cells * cellDur / MS_SEC;
    const logDur = Math.log2(Math.max(1e-9, durationSeconds));
    const durationIsPow2 = durationSeconds > SCORE_POW2_CELLS && Math.abs(durationSeconds - Math.pow(2, Math.round(logDur))) < 1e-3;
    const nearSquareTarget = targetAspect > SCORE_NEAR_SQUARE_LO && targetAspect < SCORE_NEAR_SQUARE_HI;
    const pow2Square = leftover === 0 && w === h && n >= SCORE_POW2_CELLS && (n & (n - 1)) === 0 && durationIsPow2;
    const squareBonus = pow2Square && nearSquareTarget ? SCORE_SQUARE_BONUS : 0;
    const exactBonus = leftover === 0 ? SCORE_EXACT_BONUS : leftoverRatio * SCORE_LEFTOVER_WEIGHT;
    const countErr = Math.abs(Math.log(n / targetCells));
    const niceDimBonus = (NICE_DIM_SET.has(w) && NICE_DIM_SET.has(h)) ? SCORE_NICE_DIM_BONUS : 0;
    const preferBonus = preferDur && Math.abs(cellDur - preferDur) < 1e-3 ? SCORE_PREFER_DUR_BONUS : 0;
    let fineBonus = 0;
    for (let fi = 0; fi < FINE_CELL_DURS.length; fi++) {
      if (Math.abs(cellDur - FINE_CELL_DURS[fi]) < 1e-3) { fineBonus = SCORE_FINE_DUR_BONUS; break; }
    }
    let zoomBonus = 0;
    if (cellDur > INSET_MAX_D) {
      zoomBonus = this.isZoomableDur(cellDur) ? SCORE_ZOOMABLE_BONUS : SCORE_NOT_ZOOMABLE;
      if (Math.abs(cellDur / MS_SEC - Math.round(cellDur / MS_SEC)) < 1e-6) zoomBonus += SCORE_WHOLE_SEC_BONUS;
    }
    return aspectErr + exactBonus + oddPenalty + quadPenalty + squareBonus + countErr * SCORE_COUNT_WEIGHT + niceDimBonus + preferBonus + fineBonus + zoomBonus;
  }

  /** Keep the lowest scoreGrid among legal factorizations. */
  consider(
    best: GridSpec | null, w: number, h: number, cells: number, cellDur: number,
    targetAspect: number, targetCells: number, preferDur: number | null, maxCells: number,
  ): GridSpec | null {
    if (w < FACTOR_MIN || h < FACTOR_MIN) return best;
    if (w * h < cells) return best;
    if (w * h > (maxCells || MAX_CELLS) * CELL_CAP_SLACK) return best;
    const score = this.scoreGrid(w, h, cells, cellDur, targetAspect, targetCells, preferDur);
    if (!best || score < (best.score ?? Infinity)) {
      return { w, h, cells, cellDur, leftover: w * h - cells, score };
    }
    return best;
  }

  /** Nice durations plus exact-fit and zoomable k²×D values. */
  candidateDurs(durationMs: number): Set<number> {
    const durs = new Set(NICE_DURS);
    for (let i = 0; i < NICE_DIMS.length; i++) {
      for (let j = 0; j < NICE_DIMS.length; j++) {
        const cells = NICE_DIMS[i] * NICE_DIMS[j];
        if (cells >= MIN_CELLS && cells <= MAX_CELLS) durs.add(durationMs / cells);
      }
    }
    for (let e = POW2_SIDE_LO; e <= POW2_SIDE_HI; e++) {
      const side = 1 << e;
      const cells = side * side;
      if (cells <= MAX_CELLS) durs.add(durationMs / cells);
    }
    for (let ki = 0; ki < ZOOM_KS.length; ki++) {
      const k = ZOOM_KS[ki];
      for (let di = 0; di < INSET_CELL_DURS.length; di++) {
        durs.add(k * k * INSET_CELL_DURS[di]);
      }
    }
    return durs;
  }

  /** 2³¹ s → 2ⁿ×2ⁿ; do not chase the CSS tile. */
  pickUnixSquare(durationMs: number): GridSpec | null {
    if (Math.abs(durationMs - UNIX32_END) > 1) return null;
    const sides = [1024, 512, 256];
    for (let i = 0; i < sides.length; i++) {
      const side = sides[i];
      const cells = side * side;
      const cellDur = UNIX32_END / cells;
      if (!this.isZoomableDur(cellDur)) continue;
      return { w: side, h: side, cells, cellDur, leftover: 0, score: 0 };
    }
    return null;
  }

  /** w×h and cellDur for this range; leftover cells stay surplus. */
  pickGrid(durationMs: number, targetAspect: number, cssWidth: number, cellCap?: number): GridSpec {
    const unixGrid = this.pickUnixSquare(durationMs);
    if (unixGrid) return unixGrid;
    let best: GridSpec | null = null;
    const cap = cellCap && cellCap > 0 ? cellCap : this.maxCellsFor(cssWidth, targetAspect);
    const preferDur = cellCap && cellCap > 0
      ? this.pickInsetPreferDur(durationMs, cap)
      : this.pickFineCellDur(durationMs, cssWidth, targetAspect);
    const targetCells = preferDur
      ? Math.min(cap, Math.ceil(durationMs / preferDur))
      : Math.min(cap, Math.max(MIN_CELLS, durationMs / MS_SEC));
    const durs = this.candidateDurs(durationMs);
    if (preferDur) durs.add(preferDur);
    durs.forEach((cellDur) => {
      if (!(cellDur > 0)) return;
      const cells = Math.ceil(durationMs / cellDur - 1e-9);
      if (cells < FACTOR_MIN) return;
      if (cells < MIN_CELLS && cellDur > 1) return;
      const needsZoom = durationMs / MS_SEC > cap && cellDur > INSET_MAX_D;
      if (needsZoom && !this.isZoomableDur(cellDur)) return;
      const durCap = cellCap && cellCap > 0
        ? cap
        : (needsZoom || this.isZoomableDur(cellDur) ? Math.max(cap, MAX_CELLS_HARD) : cap);
      if (cells > durCap) return;

      const pairs = this.factorPairs(cells);
      for (let p = 0; p < pairs.length; p++) {
        best = this.consider(best, pairs[p][0], pairs[p][1], cells, cellDur, targetAspect, targetCells, preferDur, durCap);
      }

      const approxW = Math.max(FACTOR_MIN, Math.round(Math.sqrt(cells * targetAspect)));
      const span = Math.max(GRID_SEARCH_SPAN_MIN, Math.round(approxW * GRID_SEARCH_SPAN_FRAC));
      const lo = Math.max(FACTOR_MIN, approxW - span);
      const hi = approxW + span;
      for (let w = lo; w <= hi; w++) {
        const h = Math.ceil(cells / w);
        best = this.consider(best, w, h, cells, cellDur, targetAspect, targetCells, preferDur, durCap);
      }
      for (let ni = 0; ni < NICE_DIMS.length; ni++) {
        const w = NICE_DIMS[ni];
        const h = Math.ceil(cells / w);
        best = this.consider(best, w, h, cells, cellDur, targetAspect, targetCells, preferDur, durCap);
        best = this.consider(best, h, w, cells, cellDur, targetAspect, targetCells, preferDur, durCap);
      }
    });
    if (!best) {
      const cells = Math.min(cap, Math.max(MIN_CELLS, Math.ceil(durationMs / (preferDur || MS_SEC))));
      const w = Math.max(FACTOR_MIN, Math.round(Math.sqrt(cells * targetAspect)));
      const h = Math.ceil(cells / w);
      best = { w, h, cells, cellDur: preferDur || durationMs / cells, leftover: w * h - cells, score: 0 };
    }
    if (Math.abs(targetAspect - 1) > GRID_ORIENT_EPS) {
      const wantWide = targetAspect > 1;
      if ((best.w > best.h) !== wantWide) {
        const t = best.w;
        best.w = best.h;
        best.h = t;
      }
    }
    return best;
  }

  /** Fill the tile; prefer D ≤ 1s without a huge inset grid. */
  chooseZoomK(parentDur: number, srcW: number, srcH: number, cssWidth: number, parentW: number, parentH: number): number {
    const cap = this.insetCellCap(srcW, srcH, cssWidth, parentW, parentH);
    const area = Math.max(1, srcW * srcH);
    let kCss = Math.floor(Math.sqrt(cap / area));
    if (kCss < 1) kCss = 1;
    const kFine = Math.max(1, Math.floor(Math.sqrt(parentDur / INSET_MIN_D)));
    const kCoarse = Math.max(1, Math.ceil(Math.sqrt(parentDur / INSET_MAX_D) - 1e-12));
    let k = Math.min(kCss, kFine);
    if (k < kCoarse && kCoarse <= kFine) {
      const cells = area * kCoarse * kCoarse;
      const parentN = Math.max(1, (parentW || 0) * (parentH || 0));
      if (cells <= Math.max(cap, parentN) * 1.25) k = kCoarse;
    }
    return k < 1 ? 0 : k;
  }

  /** Prefer D ≤ 1s; if that grid would be huge, keep the k that fits the tile. */
  insetPlanForBox(grid: GridSpec, box: CellBox, cssWidth: number): InsetPlan | null {
    const k = this.chooseZoomK(grid.cellDur, box.w, box.h, cssWidth, grid.w, grid.h);
    if (k < 1) return null;
    const fitted = { k, D: grid.cellDur / (k * k) };
    if (fitted.D <= INSET_MAX_D + 1) return fitted;
    const kNeed = Math.max(1, Math.ceil(Math.sqrt(grid.cellDur / INSET_MAX_D) - 1e-12));
    const D = grid.cellDur / (kNeed * kNeed);
    if (D > INSET_MAX_D + 1) return fitted;
    const cells = box.w * box.h * kNeed * kNeed;
    const parentN = Math.max(1, grid.w * grid.h);
    if (cells > Math.max(MAX_CELLS_HARD, parentN * 2.5)) return fitted;
    return { k: kNeed, D };
  }

  /** Largest aspect-w/h rectangle that fits in boxW×boxH. */
  letterboxIn(aspect: number, boxW: number, boxH: number): { w: number; h: number } {
    const boxA = boxW / Math.max(1, boxH);
    if (Math.abs(Math.log(boxA / Math.max(1e-6, aspect))) < 0.02) {
      return { w: boxW, h: boxH };
    }
    if (boxA > aspect) {
      return { w: Math.max(MIN_CSS_PX, Math.round(boxH * aspect)), h: boxH };
    }
    return { w: boxW, h: Math.max(MIN_CSS_PX, Math.round(boxW / aspect)) };
  }

  /** CSS box of the refined block inside the Fit tile. */
  insetLetterbox(boxW: number, boxH: number, k: number, tileW: number, tileH: number): { cssW: number; cssH: number } {
    const w = boxW * k, h = boxH * k;
    const box = this.letterboxIn(w / Math.max(1, h), tileW, tileH);
    return { cssW: box.w, cssH: box.h };
  }
}

export const grids = new GridPlanner();
