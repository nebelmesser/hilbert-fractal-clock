import { lerpPacked } from '../theme/pastRamp';
import type { MapLayout, ThemeColors } from '../types';
import { periodRange, type LifePeriod } from './PeriodStore';

type RGB = [number, number, number];
export type PeriodSegment = { start: number; end: number; ids: string[]; rgb: RGB };
export type PeriodRegion = {
  period: LifePeriod;
  i0: number; i1: number;
  x: number; y: number; w: number; h: number;
};
export type PeriodProjection = {
  source: readonly LifePeriod[];
  colors: Uint32Array;
  futureColors: Uint32Array;
  coverage: Float32Array;
  memberships: Int32Array;
  regions: PeriodRegion[];
  /** Cell-space edges, [sample index, x0, y0, x1, y1]. Independent of label visibility. */
  edges: number[];
};

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function encoded(channel: number): number {
  return Math.round(255 * (channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055));
}

function pack(rgb: RGB): number {
  return (0xff000000 | encoded(rgb[2]) << 16 | encoded(rgb[1]) << 8 | encoded(rgb[0])) >>> 0;
}

/** Exact time segments. Equal-weight linear-light mixing is independent of insertion order. */
export function periodTimeline(periods: readonly LifePeriod[]): PeriodSegment[] {
  const events: Array<{ time: number; id: string; rgb: RGB; delta: number }> = [];
  for (const p of periods) {
    const { start, end } = periodRange(p);
    const rgb = [1, 3, 5].map((i) => linear(parseInt(p.color.slice(i, i + 2), 16))) as RGB;
    events.push({ time: start, id: p.id, rgb, delta: 1 }, { time: end, id: p.id, rgb, delta: -1 });
  }
  events.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id) || a.delta - b.delta);
  const active = new Set<string>();
  const sum: RGB = [0, 0, 0];
  const out: PeriodSegment[] = [];
  for (let i = 0; i < events.length;) {
    const start = events[i].time;
    while (i < events.length && events[i].time === start) {
      const e = events[i++];
      if (e.delta > 0) active.add(e.id); else active.delete(e.id);
      for (let c = 0; c < 3; c++) sum[c] += e.delta * e.rgb[c];
    }
    if (active.size && i < events.length) {
      out.push({ start, end: events[i].time, ids: [...active].sort(), rgb: sum.map((v) => Math.max(0, Math.min(1, v / active.size))) as RGB });
    }
    if (!active.size) sum.fill(0);
  }
  return out;
}

function lowerBound(starts: Float64Array, time: number): number {
  let lo = 0, hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (starts[mid] < time) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Project exact segments onto either panel; coarse cells integrate time coverage. */
export function projectPeriods(layout: MapLayout, source: readonly LifePeriod[], theme: ThemeColors): PeriodProjection {
  const { grid, cellStart, g } = layout;
  const segments = periodTimeline(source);
  const colors = new Uint32Array(grid.cells);
  const futureColors = new Uint32Array(grid.cells);
  const coverage = new Float32Array(grid.cells);
  const memberships = new Int32Array(grid.cells);
  const keys = new Map<string, number>();
  const intern = (ids: string[]) => {
    const key = ids.join(',');
    let id = keys.get(key);
    if (id == null) { id = keys.size + 1; keys.set(key, id); }
    return id;
  };
  const segmentKeys = segments.map((s) => intern(s.ids));
  const futureStrength = theme.periodFutureBrightness ?? 0.18;
  const segmentPixels = segments.map((s) => pack(s.rgb));
  const futurePixels = segmentPixels.map((color) => lerpPacked(theme.future, color, futureStrength));
  let si = 0;
  for (let i = 0; i < grid.cells; i++) {
    const start = cellStart[i], end = start + grid.cellDur;
    while (si < segments.length && segments[si].end <= start) si++;
    if (si === segments.length || segments[si].start >= end) continue;
    if (segments[si].start <= start && segments[si].end >= end) {
      colors[i] = segmentPixels[si]; futureColors[i] = futurePixels[si];
      coverage[i] = 1; memberships[i] = segmentKeys[si];
      continue;
    }
    let covered = 0;
    const rgb: RGB = [0, 0, 0];
    let last = si;
    for (let s = si; s < segments.length && segments[s].start < end; s++) {
      const seg = segments[s];
      const duration = Math.min(end, seg.end) - Math.max(start, seg.start);
      if (duration <= 0) continue;
      covered += duration;
      for (let c = 0; c < 3; c++) rgb[c] += seg.rgb[c] * duration;
      last = s;
    }
    if (!covered) continue;
    colors[i] = pack(rgb.map((v) => v / covered) as RGB);
    futureColors[i] = lerpPacked(theme.future, colors[i], futureStrength);
    coverage[i] = Math.min(1, covered / grid.cellDur);
    // The footprint union preserves every boundary at this grid's resolution.
    // The exact timeline above still distinguishes adjacent periods from overlaps.
    memberships[i] = last === si ? segmentKeys[si]
      : intern([...new Set(segments.slice(si, last + 1).flatMap((s) => s.ids))].sort());
  }
  const regions: PeriodRegion[] = [];
  for (const period of source) {
    const { start, end } = periodRange(period);
    let i0 = lowerBound(cellStart, start - grid.cellDur);
    while (i0 < grid.cells && cellStart[i0] + grid.cellDur <= start) i0++;
    const i1 = lowerBound(cellStart, end);
    if (i0 >= i1) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = i0; i < i1; i++) {
      x0 = Math.min(x0, g.xs[i]); y0 = Math.min(y0, g.ys[i]);
      x1 = Math.max(x1, g.xs[i]); y1 = Math.max(y1, g.ys[i]);
    }
    regions.push({ period, i0, i1, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  const edges: number[] = [];
  const idAt = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) return 0;
    const i = g.at[y * grid.w + x];
    return i >= 0 && i < grid.cells ? memberships[i] : 0;
  };
  for (let i = 0; i < grid.cells; i++) {
    const x = g.xs[i], y = g.ys[i], id = memberships[i];
    const right = idAt(x + 1, y), bottom = idAt(x, y + 1);
    if (id !== right) edges.push(i, x + 1, y, x + 1, y + 1);
    if (id !== bottom) edges.push(i, x, y + 1, x + 1, y + 1);
    const validAt = (xx: number, yy: number) => xx >= 0 && yy >= 0 && g.at[yy * grid.w + xx] >= 0 && g.at[yy * grid.w + xx] < grid.cells;
    if (id && !validAt(x - 1, y)) edges.push(i, x, y, x, y + 1);
    if (id && !validAt(x, y - 1)) edges.push(i, x, y, x + 1, y);
  }
  return { source, colors, futureColors, coverage, memberships, regions, edges };
}

export function periodCellPixel(layout: MapLayout, i: number, fallback: number, now: number): number {
  const p = layout.periods;
  if (!p || !p.coverage[i]) return fallback;
  const start = layout.cellStart[i], end = start + layout.grid.cellDur;
  if (now >= start && now < end) return fallback;
  const color = now >= end ? p.colors[i] : p.futureColors[i];
  return p.coverage[i] === 1 ? color : lerpPacked(fallback, color, p.coverage[i]);
}
