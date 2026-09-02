import { describe, expect, it } from 'vitest';
import { HilbertCurve } from './HilbertCurve';

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

describe('HilbertCurve', () => {
  it('fills w×h with exactly w*h cells and a reversible at[]', () => {
    const c = new HilbertCurve();
    for (const [w, h] of [[8, 8], [12, 9], [7, 5], [16, 16]]) {
      const g = c.build(w, h);
      expect(g.n).toBe(w * h);
      const seen = new Set<number>();
      for (let i = 0; i < g.n; i++) {
        const x = g.xs[i], y = g.ys[i];
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(w);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(h);
        expect(g.at[y * w + x]).toBe(i);
        seen.add(y * w + x);
      }
      expect(seen.size).toBe(w * h);
    }
  });

  it('keeps consecutive cells 4-connected on an even square', () => {
    const c = new HilbertCurve();
    const g = c.build(16, 16);
    for (let i = 1; i < g.n; i++) {
      expect(manhattan(g.xs[i - 1], g.ys[i - 1], g.xs[i], g.ys[i])).toBe(1);
    }
  });

  it('stays 8-connected on a non-square Gilbert grid', () => {
    const c = new HilbertCurve();
    const g = c.build(15, 10);
    for (let i = 1; i < g.n; i++) {
      const dx = Math.abs(g.xs[i] - g.xs[i - 1]);
      const dy = Math.abs(g.ys[i] - g.ys[i - 1]);
      expect(Math.max(dx, dy)).toBe(1);
    }
  });

  it('splits an even 2ⁿ square into four quadrants, not a 3-way band', () => {
    const c = new HilbertCurve();
    const g = c.build(8, 8);
    const n = 64;
    const q = n / 4;
    const boxes = [];
    for (let qid = 0; qid < 4; qid++) {
      let minx = 8, miny = 8, maxx = -1, maxy = -1;
      for (let i = qid * q; i < (qid + 1) * q; i++) {
        minx = Math.min(minx, g.xs[i]);
        miny = Math.min(miny, g.ys[i]);
        maxx = Math.max(maxx, g.xs[i]);
        maxy = Math.max(maxy, g.ys[i]);
      }
      boxes.push({ w: maxx - minx + 1, h: maxy - miny + 1 });
    }
    for (const b of boxes) {
      expect(b.w).toBe(4);
      expect(b.h).toBe(4);
    }
  });

  it('returns a unique packed leaf that contains nowIdx', () => {
    const c = new HilbertCurve();
    const leaf = c.leafAt(16, 16, 40, 2);
    expect(leaf).not.toBeNull();
    expect(leaf!.i0).toBeLessThanOrEqual(40);
    expect(leaf!.i1).toBeGreaterThan(40);
    expect(leaf!.box.w * leaf!.box.h).toBe(leaf!.area);
  });
});
