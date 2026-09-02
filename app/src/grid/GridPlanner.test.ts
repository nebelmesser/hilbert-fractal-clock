import { describe, expect, it } from 'vitest';
import { INSET_MAX_D, MIN_CELLS, MS_DAY, MS_SEC, UNIX32_END } from '../constants';
import { GridPlanner } from './GridPlanner';

describe('GridPlanner', () => {
  it('maps Unix 2³¹ seconds to a 2ⁿ square', () => {
    const g = new GridPlanner().pickUnixSquare(UNIX32_END);
    expect(g).not.toBeNull();
    expect(g!.w).toBe(g!.h);
    expect((g!.w & (g!.w - 1)) === 0).toBe(true);
    expect(g!.leftover).toBe(0);
    expect(g!.cells).toBe(g!.w * g!.h);
  });

  it('keeps leftover ≥ 0 and a parent > 1s zoomable', () => {
    const planner = new GridPlanner();
    const grid = planner.pickGrid(MS_DAY, 1.2, 800);
    expect(grid.leftover).toBeGreaterThanOrEqual(0);
    expect(grid.w * grid.h).toBeGreaterThanOrEqual(grid.cells);
    expect(grid.cells).toBeGreaterThanOrEqual(MIN_CELLS);
    if (grid.cellDur > INSET_MAX_D) {
      expect(planner.isZoomableDur(grid.cellDur)).toBe(true);
    }
  });

  it('treats 1s and k²×{0.1,0.25,0.5,1}s parent cells as zoomable', () => {
    const planner = new GridPlanner();
    expect(planner.isZoomableDur(MS_SEC)).toBe(true);
    expect(planner.isZoomableDur(3 * MS_SEC)).toBe(true);
    expect(planner.isZoomableDur(16 * MS_SEC)).toBe(true);
    expect(planner.exactZoomK(16 * MS_SEC, MS_SEC)).toBe(4);
  });
});
