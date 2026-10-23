import { periodCellPixel } from '../periods/PeriodProjection';
import type { MapLayout, ThemeColors } from '../types';
import { cellFillPixel, innerCurId, pastColorAt, resolveInner, resolveRamp } from './pastRamp';

/** The same final background drives fill, boundary contrast and label contrast. */
export function cellAppearance(layout: MapLayout, now: number, theme: ThemeColors, curId: number | null): (i: number) => number {
  const { ids, minId, maxId, pinkId } = resolveRamp(layout, curId);
  const inner = resolveInner(layout);
  const innerId = innerCurId(layout, now);
  const colorAt = ids ? pastColorAt(theme, minId, maxId, pinkId, curId) : null;
  return (i) => periodCellPixel(layout, i, cellFillPixel(
    theme, now, layout.cellStart[i], layout.grid.cellDur, ids ? ids[i] : 0, curId,
    inner?.ids[i], innerId, colorAt,
  ), now);
}
