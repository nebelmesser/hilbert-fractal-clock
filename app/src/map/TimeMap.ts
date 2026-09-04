import {
  CURRENT_UNIT_MAX_SHARE, DPR_MAX, HL_PAD_PX, LOOP_MAX_MS, MIN_CSS_PX, ZOOM_MIN_AREA,
} from '../constants';
import type { HilbertCurve } from '../curve/HilbertCurve';
import type { GridPlanner } from '../grid/GridPlanner';
import { clamp } from '../math';
import type { ClockTime } from '../time/ClockTime';
import { formatDur, formatMoment, formatRange } from '../time/format';
import { l1RampSpan, rampCurId } from '../theme/pastRamp';
import { fillUnitIds } from '../time/units';
import type { Theme } from '../theme/Theme';
import type {
  CellBox, GridSpec, MapLayout, TimeRange, ZoomLock, ZoomWindow,
} from '../types';
import { boxContainsCell, higherBoundUnits, pickLabelLevelIndex, pickLevels, ZoomLadder } from '../zoom/ZoomLadder';
import { BoundRenderer } from './BoundRenderer';
import { FillRenderer } from './FillRenderer';
import { HighlightRenderer } from './HighlightRenderer';
import { LabelRenderer, type LiveLabelCache, type PinnedPlaces } from './LabelRenderer';

/** Shared curve / grid / theme / clock services used by a TimeMap. */
export type MapHost = {
  curves: HilbertCurve;
  grids: GridPlanner;
  zoom: ZoomLadder;
  labels: LabelRenderer;
  fill: FillRenderer;
  bounds: BoundRenderer;
  highlight: HighlightRenderer;
  theme: Theme;
  clock: ClockTime;
  zoomWantArea: (grid: GridSpec) => number;
  currentZoomArea: () => number;
  currentZoomMs: () => number;
};

/**
 * One map panel: four canvases, parent or inset rebuild, tick, hover title.
 */
export class TimeMap {
  wrap: HTMLDivElement;
  captionEl: HTMLElement | null;
  base: HTMLCanvasElement;
  bounds: HTMLCanvasElement;
  labels: HTMLCanvasElement;
  hl: HTMLCanvasElement;
  ctxBase: CanvasRenderingContext2D;
  ctxBounds: CanvasRenderingContext2D;
  ctxLabels: CanvasRenderingContext2D;
  ctxHl: CanvasRenderingContext2D;
  start = 0;
  end = 0;
  layout: MapLayout | null = null;
  zoomBox: CellBox | null = null;
  zoomRange: TimeRange | null = null;
  _zoomLock: ZoomLock | null = null;
  _zoomMinute: number | undefined;
  _zoomAspect = 1;
  _lastKey = '';
  _lastLabelKey = '';
  _liveLabel: LiveLabelCache | null = null;
  _echoLive: LiveLabelCache | null = null;
  _labelPlaces: PinnedPlaces | null = null;
  _tipIdx = -1;
  _cropKey = '';
  tileW = 0;
  tileH = 0;
  cssW = 0;
  cssH = 0;
  dpr = 1;
  hlPad = HL_PAD_PX;

  /** Stack base / bounds / labels / highlight canvases inside wrap. */
  constructor(private host: MapHost, wrap: HTMLDivElement, captionEl: HTMLElement | null) {
    this.wrap = wrap;
    this.captionEl = captionEl;
    this.base = document.createElement('canvas');
    this.base.className = 'layer-base';
    this.bounds = document.createElement('canvas');
    this.bounds.className = 'layer-bounds';
    this.labels = document.createElement('canvas');
    this.labels.className = 'layer-labels';
    this.hl = document.createElement('canvas');
    this.hl.className = 'layer-hl';
    wrap.appendChild(this.base);
    wrap.appendChild(this.bounds);
    wrap.appendChild(this.labels);
    wrap.appendChild(this.hl);
    this.ctxBase = this.base.getContext('2d', { alpha: false })!;
    this.ctxBounds = this.bounds.getContext('2d')!;
    this.ctxLabels = this.labels.getContext('2d')!;
    this.ctxHl = this.hl.getContext('2d')!;
    wrap.addEventListener('pointermove', (e) => this._onHover(e), { passive: true });
    wrap.addEventListener('pointerleave', (e) => this._onHoverEnd(e), { passive: true });
  }

  /** New [start,end) drops zoom; same range keeps the window. */
  setRange(start: number, end: number): void {
    this._clearHoverTip();
    if (this.start !== start || this.end !== end) {
      this.zoomRange = null;
      this.zoomBox = null;
      this._zoomLock = null;
      this._zoomMinute = undefined;
    }
    this.start = start;
    this.end = end;
    this.layout = null;
    this._lastKey = '';
    this._lastLabelKey = '';
    this._liveLabel = null;
    this._echoLive = null;
    this._labelPlaces = null;
  }

  /** Parent map for [start, end). */
  rebuild(cssWidth: number, targetAspect: number): void {
    const duration = this.end - this.start;
    if (!(duration > 0) || cssWidth < MIN_CSS_PX) return;
    this.zoomBox = null;
    const grid = this.host.grids.pickGrid(duration, targetAspect, cssWidth);
    const g = this.host.curves.get(grid.w, grid.h);
    const cellStart = new Float64Array(grid.cells);
    for (let i = 0; i < grid.cells; i++) cellStart[i] = this.start + i * grid.cellDur;
    const levels = pickLevels(this.start, this.end, grid.cellDur);
    const levelIds = levels.map((u) => fillUnitIds(u, grid.cellDur, grid.cells, cellStart));
    const labelLevel = pickLabelLevelIndex(levels, this.start, this.end);
    this.layout = { grid, g, levels, levelIds, labelLevel, cssWidth, cellStart };
    this._cropKey = '';
    delete this.layout.cssHeight;
    this.tileW = cssWidth;
    this.tileH = 0;
    this._layoutCanvases();
    this._renderBounds();
    this._lastKey = '';
    this._lastLabelKey = '';
    this._liveLabel = null;
    this._echoLive = null;
    this._labelPlaces = null;
    this.tick(this.host.clock.nowMs(), true);
    if (this.captionEl) {
      this.captionEl.textContent =
        formatRange(this.start, this.end) + ' · ' +
        grid.w + '×' + grid.h + ' @ ' + formatDur(grid.cellDur) +
        (grid.leftover ? ' · +' + grid.leftover : '');
    }
  }

  /** Inset: each parent cell → k×k in place so fill matches the yellow box. */
  rebuildZoom(cssWidth: number, parentLayout: MapLayout, win: ZoomWindow): void {
    if (!parentLayout || !win || !win.box || cssWidth < MIN_CSS_PX) return;
    this.start = win.start;
    this.end = win.end;
    const parent = parentLayout.grid;
    const k = win.k >= 1 ? win.k : this.host.grids.chooseZoomK(parent.cellDur, win.box.w, win.box.h, cssWidth, parent.w, parent.h);
    if (k < 1) return;
    const cellDur = parent.cellDur / (k * k);
    const idx = win.idx || null;
    const nParent = idx ? idx.length : (win.i1 - win.i0);
    if (!(nParent > 0)) return;
    const g = this.host.curves.buildZoom(parentLayout.g, win.box, win.i0, win.i1, k, idx);
    const grid: GridSpec = {
      w: win.box.w * k,
      h: win.box.h * k,
      cells: g.n,
      cellDur,
      leftover: win.box.w * k * win.box.h * k - g.n,
    };
    const cellStart = new Float64Array(grid.cells);
    const parentStart = parentLayout.cellStart;
    const kk = k * k;
    for (let p = 0; p < nParent; p++) {
      const pi = idx ? idx[p] : (win.i0 + p);
      const base = parentStart[pi];
      for (let j = 0; j < kk; j++) cellStart[p * kk + j] = base + j * cellDur;
    }
    const levels = pickLevels(this.start, this.end, cellDur);
    const levelIds = levels.map((u) => fillUnitIds(u, cellDur, grid.cells, cellStart));
    const labelLevel = pickLabelLevelIndex(levels, this.start, this.end);
    const inherit = higherBoundUnits(levels, cellDur).map((u) =>
      fillUnitIds(u, cellDur, grid.cells, cellStart),
    );
    const parentUnit = parentLayout.levels[0];
    const parentDur = parentLayout.grid.cellDur;
    const parentSpan = parentUnit && parentLayout.levelIds[0]
      ? l1RampSpan(parentLayout.levelIds[0], parentLayout.grid.cells, null)
      : null;
    const ramp = parentUnit && parentSpan
      ? {
        minId: parentSpan.minId,
        maxId: parentSpan.maxId,
        ids: fillUnitIds(parentUnit, cellDur, grid.cells, cellStart),
        unit: parentUnit,
        start: parentLayout.cellStart[0],
        end: parentLayout.cellStart[parentLayout.grid.cells - 1] + parentDur,
      }
      : undefined;
    const parentLabel = parentLayout.levels[parentLayout.labelLevel || 0];
    const localLabel = levels[labelLevel];
    const echo = parentLabel && (!localLabel || parentLabel.id !== localLabel.id)
      ? { unit: parentLabel, ids: fillUnitIds(parentLabel, cellDur, grid.cells, cellStart) }
      : undefined;
    this.layout = { grid, g, levels, levelIds, labelLevel, cssWidth, cellStart, inherit, ramp, echo };
    const keepW = this.tileW;
    const keepH = this.tileH;
    this.tileW = keepW > 0 ? keepW : cssWidth;
    this.tileH = keepH > 0 ? keepH : 0;
    this._layoutCanvases();
    this._renderBounds();
    this._lastKey = '';
    this._lastLabelKey = '';
    this._liveLabel = null;
    this._echoLive = null;
    this._labelPlaces = null;
    this.tick(this.host.clock.nowMs(), true);
    if (this.captionEl) {
      this.captionEl.textContent =
        formatRange(this.start, this.end) + ' · ' +
        grid.w + '×' + grid.h + ' @ ' + formatDur(grid.cellDur) +
        (grid.leftover ? ' · +' + grid.leftover : '');
    }
  }

  /** Yellow box → inset window; packed range when the crop is a contiguous curve slice. */
  winFromBox(box: CellBox, k: number, depth: number): ZoomWindow | null {
    if (!this.layout) return null;
    const { grid, g, cellStart } = this.layout;
    const at = g.at;
    const idx: number[] = [];
    for (let y = box.y; y < box.y + box.h; y++) {
      for (let x = box.x; x < box.x + box.w; x++) {
        const i = at[y * grid.w + x];
        if (i >= 0 && i < grid.cells) idx.push(i);
      }
    }
    if (!idx.length) return null;
    idx.sort((a, b) => a - b);
    let packed = idx.length === box.w * box.h;
    if (packed) {
      for (let i = 1; i < idx.length; i++) {
        if (idx[i] !== idx[0] + i) { packed = false; break; }
      }
    }
    const plan = this.host.grids.insetPlanForBox(grid, box, this.tileW || this.cssW);
    const kUse = (k >= 1) ? k : (plan ? plan.k : 0);
    if (!(kUse >= 1)) return null;
    const i0 = idx[0];
    const i1 = packed ? idx[0] + idx.length : idx[idx.length - 1] + 1;
    const win: ZoomWindow = {
      i0, i1,
      start: cellStart[i0],
      end: cellStart[idx[idx.length - 1]] + grid.cellDur,
      box, k: kUse, depth: depth || (this._zoomLock && this._zoomLock.depth) || 0,
      area: box.w * box.h,
      D: plan ? plan.D : grid.cellDur / (kUse * kUse),
      px: 0, err: 0, flip: false,
    };
    if (!packed) win.idx = idx;
    return win;
  }

  /** Packed leaf containing now; keep locked duration when sliding / reload. */
  placeZoomWindow(now: number, depth: number, _maxArea: number, _wantW: number, _wantH: number, k: number): ZoomWindow | null {
    if (!this.layout || !(depth >= 1)) return null;
    const { grid } = this.layout;
    if (now < this.start || now >= this.end) return null;
    const nowIdx = clamp(Math.floor((now - this.start) / grid.cellDur), 0, grid.cells - 1);
    const cssW = this.tileW || this.cssW;
    const lock = this._zoomLock;
    const wantArea = this.host.zoomWantArea(grid);
    let block = null;
    if (wantArea >= ZOOM_MIN_AREA) {
      block = this.host.zoom.pickLeafNearArea(
        this.host.curves.leavesAt(grid.w, grid.h, nowIdx),
        wantArea, grid.w, grid.h, grid, cssW, this.start, this.end, true,
      );
    }
    if (!block) block = this.host.zoom.pickLeaf(grid.w, grid.h, nowIdx, depth, grid, cssW, this.start, this.end);
    if (!block) return null;
    const placeDepth = block.depth || depth;
    const same = lock && lock.w === block.box.w && lock.h === block.box.h && lock.k >= 1;
    const kUse = (same && lock && lock.k >= 1) ? lock.k : (k >= 1 ? k : 0);
    const win = this.winFromBox(block.box, kUse, placeDepth);
    if (win) {
      const keep = wantArea >= ZOOM_MIN_AREA;
      win.ladderDepth = (keep && lock && lock.depth >= 1) ? lock.depth : placeDepth;
      win.wantArea = keep ? wantArea : block.area;
      win.maxArea = win.wantArea;
      win.wantMs = (lock && lock.wantMs > 0) ? lock.wantMs
        : (keep && this.host.currentZoomMs() > 0 && this.host.currentZoomMs() < 1e14) ? this.host.currentZoomMs()
          : block.area * grid.cellDur;
      win.wantW = block.box.w;
      win.wantH = block.box.h;
    }
    return win;
  }

  /** Stored area picks a Hilbert tree depth; the yellow box is the leaf that contains now. */
  pickZoomWindow(now: number): ZoomWindow | null {
    if (!this.layout) return null;
    const { grid } = this.layout;
    const cssW = this.tileW || this.cssW;
    this._zoomAspect = grid.w / grid.h;
    if (now < this.start || now >= this.end) return null;
    const nowIdx = clamp(Math.floor((now - this.start) / grid.cellDur), 0, grid.cells - 1);
    const levels = this.host.zoom.ladderLevels(grid, cssW, this.start, this.end, nowIdx);
    if (!levels.length) return null;
    const L = this.host.zoom.pickLevel(levels, this.host.currentZoomArea());
    const tried: Record<number, boolean> = {};
    const tryDepth = (Lv: typeof L) => {
      if (!Lv || tried[Lv.depth]) return null;
      tried[Lv.depth] = true;
      return this.placeZoomWindow(now, Lv.depth, Lv.maxArea, Lv.w, Lv.h, 0);
    };
    let win = tryDepth(L);
    if (win) return win;
    const rest = levels.slice().sort((a, b) => {
      const want = L ? L.area : 0;
      const da = Math.abs(a.area - want), db = Math.abs(b.area - want);
      if (da !== db) return da - db;
      return b.area - a.area;
    });
    for (let i = 0; i < rest.length; i++) {
      win = tryDepth(rest[i]);
      if (win) return win;
    }
    return null;
  }

  /** New parent grid: keep zoom depth, snap to the packed cell at now. */
  remapZoomRange(): ZoomWindow | null {
    if (!this.layout) return null;
    const lock = this._zoomLock;
    const { grid } = this.layout;
    const cssW = this.tileW || this.cssW;
    const levels = this.host.zoom.levels(grid, cssW, this.start, this.end);
    let L = this.host.zoom.pickLevel(levels, this.host.currentZoomArea());
    if (lock && lock.depth >= 1) {
      for (let i = 0; i < levels.length; i++) {
        if (levels[i].depth === lock.depth) { L = levels[i]; break; }
      }
    }
    if (!L) return null;
    return this.placeZoomWindow(this.host.clock.nowMs(), L.depth, L.maxArea, L.w, L.h, 0);
  }

  /** True while now's parent cell still sits in this packed cell. */
  zoomContainsNow(now: number): boolean {
    if (!this.zoomBox || !this.layout) return false;
    const { grid, g } = this.layout;
    if (now < this.start || now >= this.end) return false;
    const nowIdx = clamp(Math.floor((now - this.start) / grid.cellDur), 0, grid.cells - 1);
    return boxContainsCell(this.zoomBox, g, nowIdx);
  }

  /** Next packed cell; keep the locked area so mixed siblings do not zoom in. */
  slideZoomWindow(now: number): ZoomWindow | null {
    const lock = this._zoomLock;
    if (!lock || !this.layout || !(lock.depth >= 1) || !(lock.maxArea >= ZOOM_MIN_AREA)) return null;
    return this.placeZoomWindow(now, lock.depth, lock.maxArea, lock.wantW, lock.wantH, 0);
  }

  /** Reconstruct the current locked window while now is still inside it. */
  lockedZoomWin(): ZoomWindow | null {
    const lock = this._zoomLock;
    if (!lock || !this.zoomBox || !this.layout) return null;
    return this.winFromBox(this.zoomBox, lock.k, lock.depth);
  }

  /** Size four layers; hl is padded for the outside yellow frame. */
  _layoutCanvases(): void {
    if (!this.layout) return;
    const { grid, cssWidth } = this.layout;
    const cssHeight = this.layout.cssHeight != null
      ? Math.max(1, Math.round(this.layout.cssHeight))
      : Math.max(1, Math.round(cssWidth * grid.h / grid.w));
    this.cssW = cssWidth;
    this.cssH = cssHeight;
    if (!(this.tileW > 0)) this.tileW = cssWidth;
    if (!(this.tileH > 0)) this.tileH = cssHeight;
    const frameW = this.tileW;
    const frameH = this.tileH;
    const ox = Math.round((frameW - cssWidth) / 2);
    const oy = Math.round((frameH - cssHeight) / 2);
    this.wrap.style.width = frameW + 'px';
    this.wrap.style.height = frameH + 'px';
    this.base.width = grid.w;
    this.base.height = grid.h;
    this.base.style.width = cssWidth + 'px';
    this.base.style.height = cssHeight + 'px';
    this.base.style.left = ox + 'px';
    this.base.style.top = oy + 'px';
    const dpr = Math.min(DPR_MAX, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.hlPad = HL_PAD_PX;
    for (const c of [this.bounds, this.labels]) {
      c.width = Math.round(cssWidth * dpr);
      c.height = Math.round(cssHeight * dpr);
      c.style.width = cssWidth + 'px';
      c.style.height = cssHeight + 'px';
      c.style.left = ox + 'px';
      c.style.top = oy + 'px';
    }
    const pad = this.hlPad;
    this.hl.width = Math.round((cssWidth + pad * 2) * dpr);
    this.hl.height = Math.round((cssHeight + pad * 2) * dpr);
    this.hl.style.width = (cssWidth + pad * 2) + 'px';
    this.hl.style.height = (cssHeight + pad * 2) + 'px';
    this.hl.style.left = (ox - pad) + 'px';
    this.hl.style.top = (oy - pad) + 'px';
    this.ctxBounds.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctxLabels.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctxHl.setTransform(dpr, 0, 0, dpr, pad * dpr, pad * dpr);
  }

  /** Letterbox height from the grid aspect. */
  setDisplayWidth(cssWidth: number): void {
    if (!this.layout || !(cssWidth > MIN_CSS_PX)) return;
    cssWidth = Math.max(MIN_CSS_PX, Math.round(cssWidth));
    const h = Math.max(MIN_CSS_PX, Math.round(cssWidth * this.layout.grid.h / this.layout.grid.w));
    this.setDisplaySize(cssWidth, h);
  }

  /** Fit slot is tileW×tileH; canvas letterboxes to the grid — never stretch. */
  setDisplaySize(tileW: number, tileH: number): void {
    if (!this.layout || !(tileW > MIN_CSS_PX) || !(tileH > MIN_CSS_PX)) return;
    tileW = Math.max(MIN_CSS_PX, Math.round(tileW));
    tileH = Math.max(MIN_CSS_PX, Math.round(tileH));
    const box = this.host.grids.letterboxIn(this.layout.grid.w / this.layout.grid.h, tileW, tileH);
    const cssWidth = box.w;
    const cssHeight = box.h;
    if (this.tileW === tileW && this.tileH === tileH &&
        this.cssW === cssWidth && this.cssH === cssHeight &&
        this.layout.cssWidth === cssWidth && this.layout.cssHeight === cssHeight) return;
    this.tileW = tileW;
    this.tileH = tileH;
    this.layout.cssWidth = cssWidth;
    this.layout.cssHeight = cssHeight;
    this._layoutCanvases();
    this._renderBounds();
    this._lastKey = '';
    this._lastLabelKey = '';
    this.tick(this.host.clock.nowMs(), true);
  }

  /** Fill along the curve up to now; tint the current coarsest unit; redraw labels. */
  tick(now: number, force = false): void {
    if (!this.layout) return;
    const { grid, levels, labelLevel } = this.layout;
    const paintMs = Math.max(1, Math.min(LOOP_MAX_MS, grid.cellDur));
    const nowKey = Math.floor(now / paintMs);
    const localCurId = levels[0] && now >= this.start && now < this.end
      ? levels[0].index(now) : null;
    const curId = rampCurId(this.layout, now, this.start, this.end);
    const key = nowKey + ':' + curId + ':' + localCurId;
    if (!force && key === this._lastKey) return;
    const unitChanged = !this._lastKey.endsWith(':' + localCurId);
    this._lastKey = key;
    this.host.fill.paint(this.ctxBase, this.layout, now, this.host.theme.colors, curId);
    this._renderBounds(now, curId);
    const labelUnit = levels[labelLevel || 0];
    const z = this.zoomBox;
    const zkey = z ? z.x + ',' + z.y + ',' + z.w + 'x' + z.h : '';
    const labelKey = curId + ':' + localCurId + ':' + (labelUnit ? labelUnit.index(now) : '') + ':' + zkey;
    if (force || !this.host.clock.timeLapse || labelKey !== this._lastLabelKey) {
      this._renderLabels(now);
      this._lastLabelKey = labelKey;
    }
    if (force || unitChanged) this._renderOverlay(now, localCurId);
  }

  /** Coarsest unit at now, or the next if that unit is almost the whole map. */
  currentFillRange(now: number): { start: number; end: number; id: string } | null {
    if (!this.layout || !this.layout.levels[0]) return null;
    if (now < this.start || now >= this.end) return null;
    const unit = this.layout.levels[0];
    const a = Math.max(unit.start(now), this.start);
    const b = Math.min(unit.end(now), this.end);
    if (b <= a) return null;
    if ((b - a) / (this.end - this.start) > CURRENT_UNIT_MAX_SHARE) {
      if (!this.layout.levels[1]) return null;
      const u2 = this.layout.levels[1];
      const a2 = Math.max(u2.start(now), this.start);
      const b2 = Math.min(u2.end(now), this.end);
      if (b2 <= a2 || (b2 - a2) / (this.end - this.start) > CURRENT_UNIT_MAX_SHARE) return null;
      return { start: a2, end: b2, id: u2.id };
    }
    return { start: a, end: b, id: unit.id };
  }

  /** Yellow box on the parent; range is the inset interval. */
  setZoomHighlight(box: CellBox | null, range?: TimeRange | null): void {
    const prev = this.zoomBox;
    const boxChanged = !prev !== !box ||
      !!(box && prev && (box.x !== prev.x || box.y !== prev.y || box.w !== prev.w || box.h !== prev.h));
    this.zoomBox = box;
    this.zoomRange = range || null;
    if (!box && !this.zoomRange) this._zoomLock = null;
    if (!this.layout) return;
    const now = this.host.clock.nowMs();
    const curId = this.layout.levels[0] && now >= this.start && now < this.end
      ? this.layout.levels[0].index(now) : null;
    this._renderOverlay(now, curId);
    if (boxChanged) this._renderLabels(now);
  }

  /** Stroke unit edges on the bounds layer; L2/L3 follow the past ramp. */
  private _renderBounds(now?: number, curId?: number | null): void {
    if (!this.layout) return;
    const t = now ?? this.host.clock.nowMs();
    let id = curId;
    if (id === undefined) {
      id = rampCurId(this.layout, t, this.start, this.end);
    }
    this.host.bounds.paint(this.ctxBounds, this.layout, this.cssW, this.cssH, this.host.theme.colors, t, id);
  }

  /** Timelapse: still retint live/past; places stay on the full region. */
  private _renderLabels(now: number): void {
    if (!this.layout) return;
    const next = this.host.labels.paint(
      this.ctxLabels, this.layout, this.cssW, this.cssH, now,
      this.host.theme.colors, this.host.clock.timeLapse,
      this._liveLabel, this._labelPlaces, this.zoomBox, this._echoLive,
    );
    this._liveLabel = next.liveLabel;
    this._echoLive = next.echoLive;
    this._labelPlaces = next.labelPlaces;
  }

  /** Current-unit outline + yellow zoom frame outside the cells. */
  private _renderOverlay(now: number, curId: number | null): void {
    if (!this.layout) return;
    this.host.highlight.paint(
      this.ctxHl, this.layout, this.cssW, this.cssH, this.hlPad,
      this.host.theme.colors, curId, this.zoomBox,
      this.wrap.classList.contains('map-zoom'),
    );
  }

  /** System title from this pixel; mouse only — touch must not set title. */
  private _onHover(e: PointerEvent): void {
    if (e.pointerType !== 'mouse') return;
    const text = this._momentAt(e.clientX, e.clientY);
    if (text == null) {
      this._clearHoverTip();
      return;
    }
    if (this.wrap.getAttribute('title') !== text) this.wrap.title = text;
  }

  /** Clear the hover title when the pointer leaves. */
  private _onHoverEnd(e: PointerEvent): void {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    this._clearHoverTip();
  }

  /** Drop the native tooltip. */
  private _clearHoverTip(): void {
    this._tipIdx = -1;
    this.wrap.removeAttribute('title');
  }

  /** Cell under the cursor → local instant; surplus / off-map → null. */
  private _momentAt(clientX: number, clientY: number): string | null {
    if (!this.layout) return null;
    const { grid, g, cellStart } = this.layout;
    const r = this.base.getBoundingClientRect();
    if (!(r.width > 0) || !(r.height > 0)) return null;
    const gx = Math.floor((clientX - r.left) / r.width * grid.w);
    const gy = Math.floor((clientY - r.top) / r.height * grid.h);
    if (gx < 0 || gy < 0 || gx >= grid.w || gy >= grid.h) return null;
    const i = g.at[gy * grid.w + gx];
    if (i < 0 || i >= grid.cells) return null;
    if (i === this._tipIdx) return this.wrap.getAttribute('title');
    this._tipIdx = i;
    return formatMoment(cellStart[i], grid.cellDur);
  }
}
