import {
  LABEL_FALLBACK_PX, LABEL_FIT_PAD, LABEL_FONT, LABEL_FONT_STACK,
  LABEL_LIVE_MS, LABEL_MAX_PX, LABEL_OUTLIER_RATIO, LABEL_TINY_FRAC,
} from '../constants';
import { LabelPlacer, labelSlotKind, maskCentroid } from '../labels/LabelPlacer';
import { median } from '../math';
import { pastColorAt, rampCurId, resolveRamp } from '../theme/pastRamp';
import type { LabelPlace, LabelSlotKind, MapLayout, ThemeColors } from '../types';

export type LiveLabelCache = {
  slot: number;
  text: string;
  place: LabelPlace;
  ox: number;
  oy: number;
  onFilled: boolean;
  kind: LabelSlotKind;
};

export type PinnedPlaces = Map<string, { place: LabelPlace; kind: LabelSlotKind }>;

type Pending = {
  text: string;
  n: number;
  live: boolean;
  onFilled: boolean;
  placeMask: Uint8Array;
  bw: number;
  bh: number;
  ox: number;
  oy: number;
  color: string;
};

type Item = {
  text: string;
  n: number;
  color: string;
  place: LabelPlace;
  ox: number;
  oy: number;
};

/** Draw unit labels: one slot kind per layer, pinned places in timelapse. */
type LabelRegion = {
  id: number; idx: number[]; minx: number; miny: number; maxx: number; maxy: number;
};

export class LabelRenderer {
  private regions = new WeakMap<MapLayout, { li: number; list: LabelRegion[] }>();

  /** Bind the slot placer used for mask → rectangle. */
  constructor(private placer: LabelPlacer) {}

  /**
   * Layer-wide slot (square / 4×3 / 16×9); one font except a single small outlier.
   * Live glyph stays `--label-live*`. Other glyphs use the block fill plus `--label-*-alpha`.
   */
  paint(
    ctx: CanvasRenderingContext2D,
    layout: MapLayout,
    cssW: number,
    cssH: number,
    now: number,
    theme: ThemeColors,
    timeLapse: boolean,
    liveLabel: LiveLabelCache | null,
    labelPlaces: PinnedPlaces | null,
  ): { liveLabel: LiveLabelCache | null; labelPlaces: PinnedPlaces | null } {
    ctx.clearRect(0, 0, cssW, cssH);
    const { grid, g, levels, labelLevel, cellStart, levelIds } = layout;
    if (!levels.length) return { liveLabel, labelPlaces };
    const li = labelLevel || 0;
    const unit = levels[li];
    const regions = this.collectRegions(layout, li);
    if (!regions.length) return { liveLabel, labelPlaces };
    const cw = cssW / grid.w;
    const ch = cssH / grid.h;
    const dur = grid.cellDur;
    const t0 = layout.ramp ? layout.ramp.start : 0;
    const t1 = layout.ramp ? layout.ramp.end : Number.POSITIVE_INFINITY;
    const curId = rampCurId(layout, now, t0, t1);
    const { ids: ids0, minId, maxId, pinkId } = resolveRamp(layout, curId);
    const colorAt = ids0 ? pastColorAt(theme, minId, maxId, pinkId, curId) : null;
    const pending: Pending[] = [];
    const texts: string[] = [];

    for (let r = 0; r < regions.length; r++) {
      const region = regions[r];
      const t = cellStart[region.idx[0]] + dur * 0.5;
      const text = unit.label(t);
      texts.push(text);
      const bw = region.maxx - region.minx + 1;
      const bh = region.maxy - region.miny + 1;
      const full = new Uint8Array(bw * bh);
      const past = new Uint8Array(bw * bh);
      const future = new Uint8Array(bw * bh);
      let nPast = 0, nFuture = 0, tMin = Infinity, tMax = -Infinity;
      for (let k = 0; k < region.idx.length; k++) {
        const i = region.idx[k];
        const mi = (g.ys[i] - region.miny) * bw + (g.xs[i] - region.minx);
        full[mi] = 1;
        const t0 = cellStart[i];
        const t1 = t0 + dur;
        if (t0 < tMin) tMin = t0;
        if (t1 > tMax) tMax = t1;
        if (t1 <= now) {
          past[mi] = 1;
          nPast++;
        } else if (t0 > now) {
          future[mi] = 1;
          nFuture++;
        }
      }
      const live = now >= tMin && now < tMax;
      const placed = this.placer.placeMaskForRegion({
        timeLapse, live, unitId: unit.id, full, past, future, nPast, nFuture,
      });
      let onFilled = tMax <= now;
      if (live) onFilled = placed.onFilled;
      else onFilled = tMax <= now;
      const sample = region.idx[0];
      const l1 = ids0 ? ids0[sample] : 0;
      const fill = onFilled
        ? (colorAt ? colorAt(l1) : theme.past)
        : (curId != null && l1 === curId ? theme.curFuture : theme.future);
      pending.push({
        text, n: region.idx.length, live, onFilled,
        placeMask: placed.placeMask, bw, bh,
        ox: region.minx, oy: region.miny,
        color: this.placer.labelColor(theme, onFilled, live, fill),
      });
    }

    const kind = labelSlotKind(texts);
    const liveSlot = Math.floor(now / LABEL_LIVE_MS);
    const items: Item[] = [];
    let nextLive = liveLabel;
    let nextPlaces = labelPlaces;
    for (let r = 0; r < pending.length; r++) {
      const p = pending[r];
      const placeKey = p.ox + ':' + p.oy + ':' + p.text;
      const pinned = timeLapse && nextPlaces && nextPlaces.get(placeKey);
      if (pinned && pinned.kind === kind) {
        items.push({ text: p.text, n: p.n, color: p.color, place: pinned.place, ox: p.ox, oy: p.oy });
        continue;
      }
      const cached = nextLive;
      if (!timeLapse && p.live && cached && cached.slot === liveSlot && cached.text === p.text &&
          cached.ox === p.ox && cached.oy === p.oy &&
          cached.onFilled === p.onFilled && cached.kind === kind) {
        items.push({ text: p.text, n: p.n, color: p.color, place: cached.place, ox: cached.ox, oy: cached.oy });
        continue;
      }
      const mid = maskCentroid(p.placeMask, p.bw, p.bh);
      const place = this.placer.largestSlotInMask(p.placeMask, p.bw, p.bh, kind, mid.x, mid.y);
      const item = { text: p.text, n: p.n, color: p.color, place, ox: p.ox, oy: p.oy };
      if (!timeLapse && p.live) {
        nextLive = { slot: liveSlot, text: p.text, place, ox: p.ox, oy: p.oy, onFilled: p.onFilled, kind };
      }
      if (timeLapse) {
        if (!nextPlaces) nextPlaces = new Map();
        nextPlaces.set(placeKey, { place, kind });
      }
      items.push(item);
    }

    const med = median(items.map((it) => it.n));
    const scored: Array<{ i: number; score: number; px: number }> = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const pr = it.place;
      if (!pr || !pr.area || it.n < med * LABEL_TINY_FRAC) continue;
      scored.push({
        i,
        score: Math.min(pr.w * cw, pr.h * ch),
        px: this.placer.fontFit(ctx, it.text, pr.w * cw, pr.h * ch),
      });
    }
    scored.sort((a, b) => a.score - b.score);
    let outlierI = -1;
    if (scored.length >= 2 && scored[0].score < LABEL_OUTLIER_RATIO * scored[1].score) {
      outlierI = scored[0].i;
    }
    let fontSize = Infinity;
    let outlierPx = LABEL_FALLBACK_PX;
    for (let s = 0; s < scored.length; s++) {
      if (scored[s].i === outlierI) {
        outlierPx = scored[s].px;
        continue;
      }
      if (scored[s].px < fontSize) fontSize = scored[s].px;
    }
    if (!isFinite(fontSize)) fontSize = scored.length ? scored[0].px : LABEL_FALLBACK_PX;
    fontSize = Math.min(fontSize, LABEL_MAX_PX);
    outlierPx = Math.min(outlierPx, LABEL_MAX_PX);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let lastPx = -1;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const pr = it.place;
      if (!pr || !pr.area) continue;
      if (it.n < med * LABEL_TINY_FRAC) continue;
      const px = i === outlierI ? outlierPx : fontSize;
      if (px !== lastPx) {
        ctx.font = LABEL_FONT + px + LABEL_FONT_STACK;
        lastPx = px;
      }
      const tw = ctx.measureText(it.text).width;
      if (tw > pr.w * cw * LABEL_FIT_PAD || px > pr.h * ch * LABEL_FIT_PAD) continue;
      ctx.fillStyle = it.color;
      ctx.fillText(it.text, (it.ox + pr.x + pr.w / 2) * cw, (it.oy + pr.y + pr.h / 2) * ch);
    }
    return { liveLabel: timeLapse ? liveLabel : nextLive, labelPlaces: nextPlaces };
  }

  /** Cells grouped by unit id, with a bounding box. Cached — the groups do not move. */
  private collectRegions(layout: MapLayout, levelIndex: number): LabelRegion[] {
    const hit = this.regions.get(layout);
    if (hit && hit.li === levelIndex) return hit.list;
    const { grid, g, levelIds } = layout;
    const ids = levelIds[levelIndex];
    const groups = new Map<number, { id: number; idx: number[]; minx: number; miny: number; maxx: number; maxy: number }>();
    for (let i = 0; i < grid.cells; i++) {
      const id = ids[i];
      let rec = groups.get(id);
      if (!rec) {
        rec = { id, idx: [], minx: g.xs[i], miny: g.ys[i], maxx: g.xs[i], maxy: g.ys[i] };
        groups.set(id, rec);
      }
      rec.idx.push(i);
      const x = g.xs[i], y = g.ys[i];
      if (x < rec.minx) rec.minx = x;
      if (y < rec.miny) rec.miny = y;
      if (x > rec.maxx) rec.maxx = x;
      if (y > rec.maxy) rec.maxy = y;
    }
    const list = [...groups.values()];
    this.regions.set(layout, { li: levelIndex, list });
    return list;
  }
}
