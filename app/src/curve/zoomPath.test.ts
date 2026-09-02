import { describe, expect, it } from 'vitest';
import { ZOOM_K_DUR_EPS } from '../constants';
import { grids } from '../grid/GridPlanner';
import { HilbertCurve } from './HilbertCurve';

describe('zoom path', () => {
  it('keeps a k×k refinement 4-connected', () => {
    const c = new HilbertCurve();
    const parent = c.get(8, 8);
    const box = { x: 0, y: 0, w: 4, h: 4 };
    const zoom = c.buildZoom(parent, box, 0, 16, 4);
    expect(zoom.n).toBe(16 * 16);
    for (let i = 1; i < zoom.n; i++) {
      const d = Math.abs(zoom.xs[i] - zoom.xs[i - 1]) + Math.abs(zoom.ys[i] - zoom.ys[i - 1]);
      expect(d).toBe(1);
    }
  });

  it('finds integer k with k² × D = parentDur', () => {
    expect(grids.exactZoomK(16_000, 1000)).toBe(4);
    expect(grids.exactZoomK(1000, 1000)).toBe(0);
    const k = grids.exactZoomK(250 * 9, 250);
    expect(k).toBe(3);
    expect(Math.abs(k * k * 250 - 250 * 9)).toBeLessThanOrEqual(ZOOM_K_DUR_EPS);
  });
});
