import { describe, expect, it } from 'vitest';
import { MS_DAY, ZOOM_MIN_AREA, ZOOM_PARENT_SHARE } from '../constants';
import { HilbertCurve } from '../curve/HilbertCurve';
import { GridPlanner } from '../grid/GridPlanner';
import { ZoomLadder } from './ZoomLadder';

describe('ZoomLadder', () => {
  it('returns packed leaves that contain nowIdx and meet ZOOM_MIN_AREA', () => {
    const curves = new HilbertCurve();
    const grids = new GridPlanner();
    const ladder = new ZoomLadder(curves, grids);
    const grid = grids.pickGrid(MS_DAY, 1.1, 640);
    const g = curves.get(grid.w, grid.h);
    const nowIdx = Math.floor(g.n / 3);
    const levels = ladder.ladderLevels(grid, 640, 0, MS_DAY, nowIdx);
    for (const L of levels) {
      expect(L.nowArea ?? L.area).toBeGreaterThanOrEqual(ZOOM_MIN_AREA);
      expect((L.nowArea ?? L.area)).toBeLessThanOrEqual(grid.w * grid.h * ZOOM_PARENT_SHARE + 1e-9);
      const leaf = curves.leafAt(grid.w, grid.h, nowIdx, L.depth);
      expect(leaf).not.toBeNull();
      expect(leaf!.i0).toBeLessThanOrEqual(nowIdx);
      expect(leaf!.i1).toBeGreaterThan(nowIdx);
    }
  });
});
