import {
  LABEL_ECHO_ALPHA, LABEL_ECHO_EMPTY_ALPHA, LABEL_ECHO_LIVE_ALPHA,
  LABEL_FALLBACK_PX, LABEL_FONT, LABEL_FONT_STACK, LABEL_LIVE_MS, LABEL_MAX_PX, LABEL_TINY_FRAC,
} from '../constants';
import { LabelPlacer, eraseFrameBand, maskCentroid, pickSharedLabelFont, zoomFramePadCells, type GlyphMetrics, type LabelGeometry } from '../labels/LabelPlacer';
import { monthAbbrev } from '../time/format';
import { innerCurId, pastColorAt, rampCurId, resolveInner, resolveRamp } from '../theme/pastRamp';
import type { CellBox, MapLayout, ThemeColors, TimeUnit } from '../types';

export type LiveLabelCache = {
  slot: number;
  text: string;
  geometry: LabelGeometry;
  ox: number;
  oy: number;
  onFilled: boolean;
  zoomKey: string;
};

export type PinnedPlaces = Map<string, LabelGeometry>;

type Pending = {
  text: string;
  n: number;
  live: boolean;
  onFilled: boolean;
  masks: Array<{ mask: Uint8Array; onFilled: boolean }>;
  center: { x: number; y: number };
  bw: number;
  bh: number;
  ox: number;
  oy: number;
  color: string;
  liveColors?: { filled: string; empty: string };
};

type Item = {
  n: number;
  color: string;
  liveColors?: { filled: string; empty: string };
  geometry: LabelGeometry;
  variants: Array<{ text: string; glyph: GlyphMetrics; maxFont: number }>;
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
  innerIds: Int32Array | null;
  innerId: number | null;
  innerUnitId: string | null;
  hideLiveHour: boolean;
};

/** Fit the shared text scale, then maximize each label's clearance from its boundaries. */
export class LabelRenderer {
  private regions = new WeakMap<MapLayout, Map<string, LabelRegion[]>>();

  /** Bind the geometry solver used for mask → measured text. */
  constructor(private placer: LabelPlacer) {}

  /**
   * One maximal font that fits all retained regions, using measured ink bounds.
   * Only up to three much-smaller regions may stay unlabeled.
   * Months: full English name when it fits; else first three letters.
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
    overlay = false,
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
    const inner = resolveInner(layout);
    const innerId = innerCurId(layout, now);
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
        innerIds: inner ? inner.ids : null,
        innerId,
        innerUnitId: inner ? inner.unit.id : null,
        hideLiveHour: false,
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
      innerIds: inner ? inner.ids : null,
      innerId,
      innerUnitId: inner ? inner.unit.id : null,
      hideLiveHour: overlay && unit.id === 'hour',
    });
    return {
      liveLabel: timeLapse ? liveLabel : local.liveLabel,
      echoLive: nextEcho,
      labelPlaces: local.labelPlaces,
    };
  }

  /**
   * One unit: collect allowed regions, solve the layer size, center text, draw.
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
    const framePad = zoomBox ? zoomFramePadCells(cw, ch) : 0;
    const pending: Pending[] = [];

    for (let r = 0; r < regions.length; r++) {
      const region = regions[r];
      const t = cellStart[region.idx[0]] + dur * 0.5;
      const text = unit.label(t);
      const bw = region.maxx - region.minx + 1;
      const bh = region.maxy - region.miny + 1;
      const full = new Uint8Array(bw * bh);
      const past = new Uint8Array(bw * bh);
      const future = new Uint8Array(bw * bh);
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
      }
      const live = now >= tMin && now < tMax;
      // Both backgrounds are candidates. Separate masks keep the glyph from
      // crossing the fill front; area alone must not discard the better room.
      const splitLive = live && !timeLapse && unit.id !== 'second' && nPast + nFuture > 0;
      const onFilled = live ? nPast >= nFuture && nPast > 0 : tMax <= now;
      let masks: Pending['masks'] = splitLive
        ? [{ mask: past, onFilled: true }, { mask: future, onFilled: false }]
        : [{ mask: full, onFilled }];
      if (zoomBox) {
        masks = masks.map(({ mask, onFilled }) => ({
          mask: eraseFrameBand(mask, bw, bh, region.minx, region.miny, zoomBox, framePad), onFilled,
        }));
      }
      const sample = region.idx[0];
      const l1 = ids0Id(layout, sample);
      const inInner = onFilled && opts.innerUnitId === unit.id &&
        opts.innerId != null && opts.innerIds != null && opts.innerIds[sample] === opts.innerId;
      const fill = inInner
        ? theme.curInner
        : onFilled
          ? (colorAt ? colorAt(l1) : theme.past)
          : (curId != null && l1 === curId ? theme.curFuture : theme.future);
      pending.push({
        text, n: region.idx.length, live, onFilled,
        masks, center: maskCentroid(full, bw, bh), bw, bh,
        ox: region.minx, oy: region.miny,
        color: this.placer.labelColor(theme, onFilled, live, fill, opts.alphas),
        liveColors: splitLive ? {
          filled: this.placer.labelColor(theme, true, true, fill, opts.alphas),
          empty: this.placer.labelColor(theme, false, true, fill, opts.alphas),
        } : undefined,
      });
    }

    const isMonth = unit.id === 'month';
    const liveSlot = Math.floor(now / LABEL_LIVE_MS);
    const zoomKey = zoomBox ? zoomBox.x + ',' + zoomBox.y + ',' + zoomBox.w + 'x' + zoomBox.h + ':' + framePad : '';
    const items: Item[] = [];
    let nextLive = opts.liveLabel;
    let nextPlaces = opts.labelPlaces;
    for (let r = 0; r < pending.length; r++) {
      const p = pending[r];
      if (opts.hideLiveHour && p.live) continue;
      const placeKey = opts.keyPrefix + p.ox + ':' + p.oy + ':' + p.text + ':' + zoomKey;
      let geometry = (timeLapse || !p.live) ? nextPlaces?.get(placeKey) : undefined;
      const cached = nextLive;
      if (!geometry && !timeLapse && p.live && cached && cached.slot === liveSlot && cached.text === p.text &&
          cached.ox === p.ox && cached.oy === p.oy &&
          cached.onFilled === p.onFilled && cached.zoomKey === zoomKey) {
        geometry = cached.geometry;
      }
      if (!geometry) {
        geometry = { cx: p.center.x, cy: p.center.y, rooms: p.masks.flatMap(({ mask, onFilled }) =>
          this.placer.geometry(mask, p.bw, p.bh).rooms.map((room) => ({ ...room, onFilled })),
        ) };
      }
      if (!timeLapse && p.live) {
        nextLive = { slot: liveSlot, text: p.text, geometry, ox: p.ox, oy: p.oy, onFilled: p.onFilled, zoomKey };
      }
      if (timeLapse || !p.live) {
        if (!nextPlaces) nextPlaces = new Map();
        nextPlaces.set(placeKey, geometry);
      }
      const texts = isMonth ? [p.text, monthAbbrev(p.text)] : [p.text];
      const variants = texts.map((text) => {
        const glyph = this.placer.measureGlyph(ctx, text);
        return { text, glyph, maxFont: this.placer.maxFont(geometry, glyph, cw, ch) };
      });
      items.push({ n: p.n, color: p.color, liveColors: p.liveColors, geometry, variants, ox: p.ox, oy: p.oy });
    }

    const scored = items.map((it, i) => ({ i, area: it.n, px: Math.max(...it.variants.map((v) => v.maxFont)) }));
    const picked = pickSharedLabelFont(scored, LABEL_TINY_FRAC, LABEL_FALLBACK_PX);
    // Optical sizing makes system-font ink bounds nonlinear in font size.
    // Reference metrics only bracket the search; every fit and the final
    // placement use ink measured at the actual candidate size.
    const measurements = new Map<number, Map<string, GlyphMetrics>>();
    const glyphAt = (text: string, size: number): GlyphMetrics => {
      let atSize = measurements.get(size);
      if (!atSize) { atSize = new Map(); measurements.set(size, atSize); }
      let glyph = atSize.get(text);
      if (!glyph) { glyph = this.placer.measureGlyph(ctx, text, size); atSize.set(text, glyph); }
      return glyph;
    };
    const fits = (size: number) => items.every((it, i) => !picked.draw.has(i) || it.variants.some((variant) =>
      this.placer.maxFont(it.geometry, glyphAt(variant.text, size), cw, ch) + 1e-7 >= size,
    ));
    let upper = opts.capPx == null ? picked.fontSize : opts.capPx;
    if (opts.capPx == null) while (fits(upper)) upper *= 2;
    let fontSize = upper;
    if (!fits(upper)) {
      let lower = 0;
      for (let iteration = 0; iteration < 20; iteration++) {
        const middle = (lower + upper) / 2;
        if (fits(middle)) lower = middle;
        else upper = middle;
      }
      fontSize = lower;
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = LABEL_FONT + fontSize + LABEL_FONT_STACK;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!picked.draw.has(i)) continue;
      // Prefer the full name at the solved scale; an abbreviation is just another glyph.
      const variant = it.variants.find((v) =>
        this.placer.maxFont(it.geometry, glyphAt(v.text, fontSize), cw, ch) + 1e-7 >= fontSize,
      )!;
      const glyph = glyphAt(variant.text, fontSize);
      const box = this.placer.placeGlyph(it.geometry, glyph, fontSize, cw, ch)!;
      ctx.fillStyle = it.liveColors && box.onFilled != null
        ? (box.onFilled ? it.liveColors.filled : it.liveColors.empty)
        : it.color;
      ctx.fillText(variant.text,
        (it.ox + box.x + box.w / 2) * cw + (glyph.left - glyph.right) * fontSize / 2,
        (it.oy + box.y + box.h / 2) * ch + (glyph.ascent - glyph.descent) * fontSize / 2);
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
