import {
  LABEL_ECHO_ALPHA, LABEL_ECHO_EMPTY_ALPHA, LABEL_ECHO_LIVE_ALPHA,
  LABEL_FALLBACK_PX, LABEL_FIT_PAD, LABEL_FONT, LABEL_FONT_STACK,
  LABEL_LIVE_MS, LABEL_MAX_PX, LABEL_OUTLIER_RATIO, LABEL_TINY_FRAC,
} from '../constants';
import { LabelPlacer, cellInBox, eraseFrameBand, labelSlotKind, maskCentroid, preferLargerHalf, zoomFramePadCells } from '../labels/LabelPlacer';
import { median } from '../math';
import { pastColorAt, rampCurId, resolveRamp } from '../theme/pastRamp';
import type { CellBox, LabelPlace, LabelSlotKind, MapLayout, ThemeColors, TimeUnit } from '../types';

export type LiveLabelCache = {
  slot: number;
  text: string;
  place: LabelPlace;
  ox: number;
  oy: number;
  onFilled: boolean;
  kind: LabelSlotKind;
  zoomKey: string;
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

type LabelRegion = {
  id: number; idx: number[]; minx: number; miny: number; maxx: number; maxy: number;
};

type LayerOpts = {
  zoomBox: CellBox | null;
  liveLabel: LiveLabelCache | null;
  labelPlaces: PinnedPlaces | null;
  keyPrefix: string;
  capPx: number | null;
  alphas?: { filled: number; empty: number; live?: number };
};

/** Draw unit labels: one slot kind per layer, pinned places in timelapse. */
export class LabelRenderer {
  private regions = new WeakMap<MapLayout, Map<string, LabelRegion[]>>();

  /** Bind the slot placer used for mask → rectangle. */
  constructor(private placer: LabelPlacer) {}

  /**
   * Layer-wide slot (square / 4×3 / 16×9); one font except a single small outlier.
   * Live glyph stays `--label-live*`. Other glyphs use the block fill plus `--label-*-alpha`.
   * On the inset, the parent unit is drawn first (faint, uncapped) under the local labels.
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
    zoomBox: CellBox | null = null,
    echoLive: LiveLabelCache | null = null,
  ): { liveLabel: LiveLabelCache | null; echoLive: LiveLabelCache | null; labelPlaces: PinnedPlaces | null } {
    ctx.clearRect(0, 0, cssW, cssH);
    const { grid, levels, labelLevel, echo } = layout;
    if (!grid) return { liveLabel, echoLive, labelPlaces };
    const cw = cssW / grid.w;
    const ch = cssH / grid.h;
    const t0 = layout.ramp ? layout.ramp.start : 0;
    const t1 = layout.ramp ? layout.ramp.end : Number.POSITIVE_INFINITY;
    const curId = rampCurId(layout, now, t0, t1);
    const { ids: ids0, minId, maxId, pinkId } = resolveRamp(layout, curId);
    const colorAt = ids0 ? pastColorAt(theme, minId, maxId, pinkId, curId) : null;
    let nextPlaces = labelPlaces;
    let nextEcho = echoLive;

    if (echo) {
      const painted = this.paintLayer(ctx, layout, echo.unit, echo.ids, cw, ch, now, theme, timeLapse, curId, colorAt, {
        zoomBox: null,
        liveLabel: echoLive,
        labelPlaces: nextPlaces,
        keyPrefix: 'echo:',
        capPx: null,
        alphas: { filled: LABEL_ECHO_ALPHA, empty: LABEL_ECHO_EMPTY_ALPHA, live: LABEL_ECHO_LIVE_ALPHA },
      });
      nextEcho = timeLapse ? echoLive : painted.liveLabel;
      nextPlaces = painted.labelPlaces;
    }

    if (!levels.length) return { liveLabel, echoLive: nextEcho, labelPlaces: nextPlaces };
    const li = labelLevel || 0;
    const unit = levels[li];
    const ids = layout.levelIds[li];
    if (!unit || !ids) return { liveLabel, echoLive: nextEcho, labelPlaces: nextPlaces };
    const local = this.paintLayer(ctx, layout, unit, ids, cw, ch, now, theme, timeLapse, curId, colorAt, {
      zoomBox,
      liveLabel,
      labelPlaces: nextPlaces,
      keyPrefix: '',
      capPx: LABEL_MAX_PX,
    });
    return {
      liveLabel: timeLapse ? liveLabel : local.liveLabel,
      echoLive: nextEcho,
      labelPlaces: local.labelPlaces,
    };
  }

  /**
   * One unit: collect regions, place slots, draw. Echo passes `capPx: null` and weaker alphas.
   */
  private paintLayer(
    ctx: CanvasRenderingContext2D,
    layout: MapLayout,
    unit: TimeUnit,
    ids: Int32Array,
    cw: number,
    ch: number,
    now: number,
    theme: ThemeColors,
    timeLapse: boolean,
    curId: number | null,
    colorAt: ((id: number) => number) | null,
    opts: LayerOpts,
  ): { liveLabel: LiveLabelCache | null; labelPlaces: PinnedPlaces | null } {
    const { grid, g, cellStart } = layout;
    const regions = this.collectRegions(layout, ids, opts.keyPrefix + unit.id);
    if (!regions.length) return { liveLabel: opts.liveLabel, labelPlaces: opts.labelPlaces };
    const dur = grid.cellDur;
    const zoomBox = opts.zoomBox;
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
      const inBox = zoomBox ? new Uint8Array(bw * bh) : null;
      const outBox = zoomBox ? new Uint8Array(bw * bh) : null;
      let nPast = 0, nFuture = 0, tMin = Infinity, tMax = -Infinity;
      for (let k = 0; k < region.idx.length; k++) {
        const i = region.idx[k];
        const x = g.xs[i], y = g.ys[i];
        const mi = (y - region.miny) * bw + (x - region.minx);
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
        if (inBox && outBox && zoomBox) {
          if (cellInBox(x, y, zoomBox)) inBox[mi] = 1;
          else outBox[mi] = 1;
        }
      }
      const live = now >= tMin && now < tMax;
      const placed = this.placer.placeMaskForRegion({
        timeLapse, live, unitId: unit.id, full, past, future, nPast, nFuture,
      });
      let placeMask = (inBox && outBox)
        ? preferLargerHalf(placed.placeMask, outBox, inBox)
        : placed.placeMask;
      if (zoomBox) {
        placeMask = eraseFrameBand(placeMask, bw, bh, region.minx, region.miny, zoomBox, zoomFramePadCells(cw, ch));
      }
      let onFilled = tMax <= now;
      if (live) onFilled = placed.onFilled;
      else onFilled = tMax <= now;
      const sample = region.idx[0];
      const l1 = ids0Id(layout, sample);
      const fill = onFilled
        ? (colorAt ? colorAt(l1) : theme.past)
        : (curId != null && l1 === curId ? theme.curFuture : theme.future);
      pending.push({
        text, n: region.idx.length, live, onFilled,
        placeMask, bw, bh,
        ox: region.minx, oy: region.miny,
        color: this.placer.labelColor(theme, onFilled, live, fill, opts.alphas),
      });
    }

    const kind = labelSlotKind(texts);
    const liveSlot = Math.floor(now / LABEL_LIVE_MS);
    const zoomKey = zoomBox ? zoomBox.x + ',' + zoomBox.y + ',' + zoomBox.w + 'x' + zoomBox.h : '';
    const items: Item[] = [];
    let nextLive = opts.liveLabel;
    let nextPlaces = opts.labelPlaces;
    for (let r = 0; r < pending.length; r++) {
      const p = pending[r];
      const placeKey = opts.keyPrefix + p.ox + ':' + p.oy + ':' + p.text + ':' + zoomKey;
      const pinned = timeLapse && nextPlaces && nextPlaces.get(placeKey);
      if (pinned && pinned.kind === kind) {
        items.push({ text: p.text, n: p.n, color: p.color, place: pinned.place, ox: p.ox, oy: p.oy });
        continue;
      }
      const cached = nextLive;
      if (!timeLapse && p.live && cached && cached.slot === liveSlot && cached.text === p.text &&
          cached.ox === p.ox && cached.oy === p.oy &&
          cached.onFilled === p.onFilled && cached.kind === kind && cached.zoomKey === zoomKey) {
        items.push({ text: p.text, n: p.n, color: p.color, place: cached.place, ox: cached.ox, oy: cached.oy });
        continue;
      }
      const mid = maskCentroid(p.placeMask, p.bw, p.bh);
      const place = this.placer.largestSlotInMask(p.placeMask, p.bw, p.bh, kind, mid.x, mid.y);
      const item = { text: p.text, n: p.n, color: p.color, place, ox: p.ox, oy: p.oy };
      if (!timeLapse && p.live) {
        nextLive = { slot: liveSlot, text: p.text, place, ox: p.ox, oy: p.oy, onFilled: p.onFilled, kind, zoomKey };
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
    if (opts.capPx != null) {
      fontSize = Math.min(fontSize, opts.capPx);
      outlierPx = Math.min(outlierPx, opts.capPx);
    }

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
    return { liveLabel: timeLapse ? opts.liveLabel : nextLive, labelPlaces: nextPlaces };
  }

  /** Cells grouped by unit id, with a bounding box. Cached — the groups do not move. */
  private collectRegions(layout: MapLayout, ids: Int32Array, key: string): LabelRegion[] {
    let bag = this.regions.get(layout);
    if (!bag) {
      bag = new Map();
      this.regions.set(layout, bag);
    }
    const hit = bag.get(key);
    if (hit) return hit;
    const { grid, g } = layout;
    const groups = new Map<number, LabelRegion>();
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
    bag.set(key, list);
    return list;
  }
}

/** L1 id for color, from the shared ramp when the inset inherits the parent. */
function ids0Id(layout: MapLayout, sample: number): number {
  const ids = layout.ramp ? layout.ramp.ids : layout.levelIds[0];
  return ids ? ids[sample] : 0;
}
