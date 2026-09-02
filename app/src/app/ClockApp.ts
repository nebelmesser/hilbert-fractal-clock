import {
  ARB_DEBOUNCE_MS, ASPECT_MAX, ASPECT_MIN, AVAIL_H_MIN, CAPTION_FALLBACK,
  INSET_MAX_D, LOOP_MAX_MS, LOOP_MIN_MS, MIN_CSS_PX, MS_MIN, ORIENT_RELAYOUT_MS,
  PROBE_ROW_CAP, RESIZE_DEBOUNCE_MS, RESIZE_EPS, STAGE_GUTTER, STAGE_MIN_W,
  TILE_MIN, WIDE_STAGE_RATIO, ZOOM_KEEP_AREA_HI, ZOOM_KEEP_AREA_LO, ZOOM_MIN_AREA,
  ZOOM_IDS,
} from '../constants';
import { curves } from '../curve/HilbertCurve';
import { grids } from '../grid/GridPlanner';
import { FitLayout, type Slot } from '../layout/FitLayout';
import { BoundRenderer } from '../map/BoundRenderer';
import { FillRenderer } from '../map/FillRenderer';
import { HighlightRenderer } from '../map/HighlightRenderer';
import { LabelRenderer } from '../map/LabelRenderer';
import { TimeMap, type MapHost } from '../map/TimeMap';
import { labels } from '../labels/LabelPlacer';
import { clamp } from '../math';
import { browserStorage, FrameStore } from '../persist/FrameStore';
import { Theme } from '../theme/Theme';
import { ClockTime } from '../time/ClockTime';
import {
  advanceEndedCustom, inclusiveDatesToRange, localDateValue, navStamp,
  parseDateInput, rangeForMode, startOfDay,
} from '../time/calendar';
import { ChromeController } from '../ui/ChromeController';
import { drawAllConnectors } from '../ui/connectors';
import { PresetBar } from '../ui/PresetBar';
import type { GridSpec, ModeId, TimeRange, ZoomWindow } from '../types';
import { ZoomLadder } from '../zoom/ZoomLadder';

/**
 * Top-level clock: presets, fit layout, zoom lock, tick loop, and persistence.
 * Owns the two map slots and keeps them packed into the viewport.
 */
export class ClockApp {
  private readonly clock: ClockTime;
  private readonly theme = new Theme();
  private readonly store: FrameStore;
  private readonly zoomLadder: ZoomLadder;
  private readonly layout: FitLayout;
  private readonly presets: PresetBar;
  private readonly chrome: ChromeController;
  private readonly host: MapHost;

  private readonly stage: HTMLElement;
  private readonly stackEl: HTMLElement;
  private readonly connectors: SVGSVGElement;
  private readonly arbitraryRow: HTMLElement;
  private readonly arbFrom: HTMLInputElement;
  private readonly arbTo: HTMLInputElement;

  private readonly slots: Slot[] = [];
  private mode: ModeId = 'today';
  private arbitrary: TimeRange | null = null;
  private zoomSizeByMode: Record<ModeId, number> = { today: 0, month: 0, year: 0, epoch: 0, arbitrary: 0 };
  private zoomMsByMode: Record<ModeId, number> = { today: 0, month: 0, year: 0, epoch: 0, arbitrary: 0 };
  private zoomFollowStored = true;
  private lastZoomKey = '';
  private lastNavStamp = '';
  private lastLayoutWidth = 0;
  private lastLayoutHeight = 0;
  private resizeTimer = 0;
  private arbTimer = 0;
  private pendingResetZoom = false;

  /**
   * Wire DOM, restore the last frame, and start the tick loop.
   */
  constructor() {
    this.clock = new ClockTime(location.search);
    this.store = new FrameStore(browserStorage());
    this.zoomLadder = new ZoomLadder(curves, grids);
    this.stage = document.getElementById('stage')!;
    this.stackEl = document.getElementById('map-stack')!;
    this.connectors = document.getElementById('connectors') as unknown as SVGSVGElement;
    this.arbitraryRow = document.getElementById('arbitrary')!;
    this.arbFrom = document.getElementById('arb-from') as HTMLInputElement;
    this.arbTo = document.getElementById('arb-to') as HTMLInputElement;
    this.layout = new FitLayout(this.stage, this.stackEl);
    this.presets = new PresetBar(
      document.getElementById('presets')!,
      (id) => this.setMode(id),
      (dir) => this.nudgeZoomSize(dir),
    );
    this.chrome = new ChromeController(this.stackEl, () => {
      this.lastLayoutWidth = 0;
      this.lastLayoutHeight = 0;
      this.relayout();
    });
    this.host = {
      curves, grids, zoom: this.zoomLadder,
      labels: new LabelRenderer(labels),
      fill: new FillRenderer(),
      bounds: new BoundRenderer(),
      highlight: new HighlightRenderer(),
      theme: this.theme,
      clock: this.clock,
      zoomWantArea: (grid) => this.zoomWantArea(grid),
      currentZoomArea: () => this.currentZoomArea(),
      currentZoomMs: () => this.currentZoomMs(),
    };
    this.bindEvents();
    this.boot();
  }

  /** Stored yellow-box area for the active preset. */
  private currentZoomArea(): number {
    return this.zoomSizeByMode[this.mode] || 0;
  }

  /** Locked inset duration; survives reload and Fit grid changes. */
  private currentZoomMs(): number {
    return this.zoomMsByMode[this.mode] || 0;
  }

  /** Cells on this grid that match the locked window duration. */
  private zoomWantArea(grid: GridSpec): number {
    const lock = this.slots[0] && this.slots[0].map && this.slots[0].map._zoomLock;
    const dur = lock && lock.wantMs > 0 ? lock.wantMs : (this.zoomFollowStored ? this.currentZoomMs() : 0);
    if (dur > 0 && dur < 1e14 && grid && grid.cellDur > 0) return dur / grid.cellDur;
    if (!this.zoomFollowStored) return 0;
    const area = this.currentZoomArea();
    if (area >= ZOOM_MIN_AREA && area < 1e14) return area;
    return 0;
  }

  /** Persist the locked duration so reload does not jump a mixed sibling. */
  private persistZoomLevel(grid: GridSpec, wantArea: number, wantMs: number): void {
    if (!(wantMs > 0) || wantMs >= 1e14) return;
    const area = wantArea >= ZOOM_MIN_AREA ? wantArea : Math.round(wantMs / Math.max(1, grid && grid.cellDur || 1));
    this.zoomFollowStored = true;
    if (this.zoomSizeByMode[this.mode] === area && this.zoomMsByMode[this.mode] === wantMs) return;
    this.zoomSizeByMode[this.mode] = area;
    this.zoomMsByMode[this.mode] = wantMs;
    this.saveFrame();
  }

  /** Drop stored zoom (day − past coarsest, or a fresh +/− step). */
  private clearZoomLevel(): void {
    this.zoomSizeByMode[this.mode] = 0;
    this.zoomMsByMode[this.mode] = 0;
  }

  /** Stored duration is for the old grid — forget it after a real window resize. */
  private forgetZoomOnResize(): void {
    this.zoomFollowStored = false;
    for (let i = 0; i < ZOOM_IDS.length; i++) {
      this.zoomSizeByMode[ZOOM_IDS[i]] = 0;
      this.zoomMsByMode[ZOOM_IDS[i]] = 0;
    }
    const main = this.slots[0] && this.slots[0].map;
    if (main) main._zoomLock = null;
    this.saveFrame();
  }

  /** Write last preset + custom dates + zoom area/duration per mode. */
  private saveFrame(): void {
    this.store.save({
      mode: this.mode,
      layout: 'fit',
      zoom: this.zoomSizeByMode,
      zoomMs: this.zoomMsByMode,
      arbitrary: this.arbitrary || undefined,
    });
  }

  /** Create map tiles lazily; slot 0 is the parent. */
  private ensureSlot(i: number): Slot {
    while (this.slots.length <= i) {
      const block = document.createElement('div');
      block.className = 'map-block';
      const wrap = document.createElement('div');
      wrap.className = this.slots.length > 0 ? 'map map-zoom' : 'map';
      const cap = document.createElement('div');
      cap.className = 'caption';
      block.appendChild(wrap);
      block.appendChild(cap);
      this.stackEl.appendChild(block);
      this.slots.push({ block, map: new TimeMap(this.host, wrap, cap) });
    }
    this.slots[i].block.style.display = '';
    return this.slots[i];
  }

  /** Hide the inset (and any further) tiles. */
  private hideSlotsFrom(i: number): void {
    for (let k = i; k < this.slots.length; k++) {
      this.slots[k].block.style.display = 'none';
      this.slots[k].map.setZoomHighlight(null);
    }
    if (i <= 1) requestAnimationFrame(() => this.redrawConnectors());
  }

  /** Today: − past coarsest hides the second panel (parent may already be ~1s). */
  private insetDismissible(main: TimeMap | undefined): boolean {
    if (this.mode === 'today') return true;
    return !!(main && main.layout && main.layout.grid.cellDur <= INSET_MAX_D);
  }

  /** True while the second tile is visible. */
  private insetSlotOn(): boolean {
    return !!(this.slots[1] && this.slots[1].block.style.display !== 'none');
  }

  /** Detect when the inset window must move. */
  private zoomChainKey(now: number): string {
    const main = this.slots[0] && this.slots[0].map;
    if (!main || !main.layout) return '';
    if (this.insetDismissible(main) && this.currentZoomArea() <= 0) return 'none';
    if (!main.zoomRange) return this.listZoomLadder(now).uniq.length ? 'need' : 'none';
    if (!main.zoomContainsNow(now)) {
      const dur = main.layout.grid.cellDur;
      const idx = clamp(Math.floor((now - main.start) / dur), 0, main.layout.grid.cells - 1);
      return 'moved:' + idx;
    }
    const b = main.zoomBox;
    return b ? ('box:' + b.x + ',' + b.y + ',' + b.w + 'x' + b.h) : (main.zoomRange.start + '-' + main.zoomRange.end);
  }

  /** Switch preset; abandon a pending custom-date edit. */
  setMode(id: ModeId): void {
    clearTimeout(this.arbTimer);
    this.arbTimer = 0;
    this.mode = id;
    this.arbitraryRow.classList.toggle('open', id === 'arbitrary');
    if (id === 'arbitrary') {
      this.syncArbitraryBounds();
      if (!this.arbitrary) {
        const r = rangeForMode('today', this.clock.nowMs(), null);
        this.arbitrary = r;
        this.arbFrom.value = localDateValue(r.start);
        this.arbTo.value = localDateValue(r.end - 1);
      }
    }
    this.saveFrame();
    this.lastNavStamp = navStamp(this.clock.nowMs());
    this.presets.render(this.mode);
    this.syncZoomButtons();
    this.relayout();
  }

  /** Retitle D/M/Y at midnight; roll a finished custom range forward. */
  private followLiveCalendar(now: number): void {
    const rolled = advanceEndedCustom(this.arbitrary, now, !!this.arbTimer);
    if (rolled) {
      this.arbitrary = rolled;
      this.arbFrom.value = localDateValue(rolled.start);
      this.arbTo.value = localDateValue(rolled.end - 1);
      this.saveFrame();
    }
    if (navStamp(now) !== this.lastNavStamp) {
      this.lastNavStamp = navStamp(now);
      this.presets.render(this.mode);
      this.syncZoomButtons();
      this.syncArbitraryBounds();
    } else if (rolled) {
      this.syncArbitraryBounds();
    }
    if (rolled && this.mode === 'arbitrary') {
      this.relayout();
      return;
    }
    if (this.mode !== 'today' && this.mode !== 'month' && this.mode !== 'year') return;
    const r = rangeForMode(this.mode, now, this.arbitrary);
    const main = this.slots[0] && this.slots[0].map;
    if (main && main.start === r.start && main.end === r.end) return;
    this.relayout();
  }

  /** Today, one panel: grid follows the page — portrait phone → tall grid. */
  private rebuildNatural(main: TimeMap): void {
    const metrics = this.layout.layoutMetrics(this.slots, this.chrome.hidden);
    const box = this.layout.availBox();
    const cap = this.slots[0] ? this.layout.captionExtra(this.slots[0], this.chrome.hidden) : CAPTION_FALLBACK;
    const slotW = Math.max(TILE_MIN, box.w);
    const slotH = Math.max(TILE_MIN, metrics.availH, box.h - cap);
    main.rebuild(slotW, this.layout.slotAspect(slotW, slotH));
    if (slotW > MIN_CSS_PX && slotH > MIN_CSS_PX) main.setDisplaySize(slotW, slotH);
  }

  /** Pick range → rebuild parent → optional inset → Fit pack → shrink if overflow. */
  relayout(): void {
    this.layout.applyLayoutClass();
    const now = this.clock.nowMs();
    const range = rangeForMode(this.mode, now, this.arbitrary);
    this.lastLayoutWidth = this.layout.stageWidth();
    this.lastLayoutHeight = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    const main = this.ensureSlot(0).map;
    main.setRange(range.start, range.end);
    this.lastZoomKey = '';
    this.stackEl.classList.remove('fit-row', 'fit-col');
    this.stackEl.style.setProperty('--stack-row-gap', '0px');

    if (this.mode === 'today') {
      this.rebuildNatural(main);
      this.updateZoom(now, true);
      if (this.layout.fitSlots(this.slots).length < 2) {
        this.clearSlotBoxes();
        this.layout.enforceFitInStage(this.slots, this.chrome.hidden, () => this.redrawConnectors());
        this.syncZoomButtons();
        return;
      }
    } else {
      const box = this.layout.availBox();
      const wide = !this.layout.pageIsPortrait() && box.w >= box.h * WIDE_STAGE_RATIO;
      const rowGap = wide ? this.layout.rowStackGap() : 0;
      const probeW = wide ? Math.max(STAGE_MIN_W, Math.floor((box.w - rowGap) / 2)) : Math.max(STAGE_MIN_W, box.w);
      const probeH = wide ? Math.max(AVAIL_H_MIN, box.h - STAGE_GUTTER) : Math.max(AVAIL_H_MIN, Math.floor((box.h - PROBE_ROW_CAP) / 2));
      main.rebuild(probeW, clamp(probeW / probeH, ASPECT_MIN, ASPECT_MAX));
      this.updateZoom(now, true, probeW);
    }

    for (let i = 0; i < 3; i++) {
      const pack = this.layout.packFit(this.layout.availBox().w, this.layout.availBox().h, this.slots, this.chrome.hidden);
      if (!pack.widths.length) break;
      const same =
        (pack.dir === 'row' ? this.stackEl.classList.contains('fit-row') : this.stackEl.classList.contains('fit-col')) &&
        this.layout.visWidthClose(pack, this.slots);
      this.applyFitPack(pack, now, !same);
      if (same) break;
    }
    this.layout.enforceFitInStage(this.slots, this.chrome.hidden, () => this.redrawConnectors());
    this.layout.enforceRowGap(this.slots, this.chrome.hidden, () => this.redrawConnectors());
    this.syncZoomButtons();
  }

  /** Today one-panel: let the map size itself, do not lock Fit tiles. */
  private clearSlotBoxes(): void {
    for (let i = 0; i < this.slots.length; i++) {
      this.slots[i].block.style.width = '';
      this.slots[i].block.style.height = '';
    }
  }

  /** Size each tile to its grid; optionally rebuild the parent. */
  private applyFitPack(pack: { dir: 'row' | 'col'; widths: number[]; heights: number[] }, now: number, rebuildGrids: boolean): void {
    this.stackEl.classList.toggle('fit-row', pack.dir === 'row');
    this.stackEl.classList.toggle('fit-col', pack.dir !== 'row');
    const vis = this.layout.fitSlots(this.slots);
    this.stackEl.style.setProperty('--stack-row-gap', pack.dir === 'row' && vis.length > 1 ? this.layout.rowStackGap() + 'px' : '0px');
    if (rebuildGrids && vis[0]) {
      const w0 = Math.max(TILE_MIN, Math.round(pack.widths[0]));
      const h0 = Math.max(TILE_MIN, Math.round(pack.heights[0]));
      vis[0].map.rebuild(w0, clamp(w0 / h0, ASPECT_MIN, ASPECT_MAX));
      const insetW = pack.widths.length > 1 ? pack.widths[1] : w0;
      this.updateZoom(now, true, insetW);
    }
    const vis2 = this.layout.fitSlots(this.slots);
    for (let i = 0; i < vis2.length; i++) {
      const w = Math.max(TILE_MIN, Math.round(pack.widths[i] != null ? pack.widths[i] : pack.widths[0]));
      const h = Math.max(TILE_MIN, Math.round(pack.heights[i] != null ? pack.heights[i] : pack.heights[0]));
      this.layout.applySlotBox(vis2[i], w, h, this.chrome.hidden);
    }
  }

  /** One inset; parent ≤1s stays one panel until +. */
  private updateZoom(now: number, force = false, insetCssWidth?: number, forcedWin?: ZoomWindow | null): void {
    const main = this.slots[0] && this.slots[0].map;
    if (!main || !main.layout) return;
    if (!forcedWin && this.insetDismissible(main) && this.currentZoomArea() <= 0) {
      main.setZoomHighlight(null);
      this.hideSlotsFrom(1);
      this.lastZoomKey = 'none';
      requestAnimationFrame(() => this.redrawConnectors());
      this.syncZoomButtons();
      return;
    }
    const minute = Math.floor(now / MS_MIN);
    let win = forcedWin || null;
    if (!win && !force && main._zoomLock && main.zoomContainsNow(now)) {
      win = main.lockedZoomWin();
    }
    if (!win && !force && main._zoomLock) win = main.slideZoomWindow(now);
    if (!win) {
      win = main.pickZoomWindow(now);
      if (!force && win && main._zoomLock && win.depth !== main._zoomLock.depth) {
        win = main.slideZoomWindow(now) || win;
      }
    }
    if (!win && main._zoomLock && main.zoomContainsNow(now)) win = main.lockedZoomWin();
    if (win) {
      const wantMs = (win.wantMs && win.wantMs > 0) ? win.wantMs : (win.wantArea || win.area) * main.layout.grid.cellDur;
      main._zoomLock = {
        depth: win.ladderDepth || win.depth,
        maxArea: win.wantArea || win.maxArea || win.area,
        wantMs,
        wantW: win.wantW ?? win.box.w,
        wantH: win.wantH ?? win.box.h,
        w: win.box.w, h: win.box.h, k: win.k, cssW: main.cssW,
      };
      main._zoomMinute = minute;
      this.persistZoomLevel(main.layout.grid, main._zoomLock.maxArea, wantMs);
    }
    if (!win) {
      main.setZoomHighlight(null);
      this.hideSlotsFrom(1);
      this.lastZoomKey = 'none';
      requestAnimationFrame(() => this.redrawConnectors());
      this.syncZoomButtons();
      return;
    }
    const cssW = Math.max(TILE_MIN, Math.round(insetCssWidth || main.cssW));
    const layoutKey = (win.depth || 0) + ':' + win.box.x + ',' + win.box.y + ':' + win.box.w + 'x' + win.box.h + 'k' + win.k + '@' + cssW;
    main.setZoomHighlight(win.box, { start: win.start, end: win.end });
    const inset = this.ensureSlot(1).map;
    main._zoomAspect = main.layout.grid.w / main.layout.grid.h;
    if (force || inset._cropKey !== layoutKey) {
      inset.rebuildZoom(cssW, main.layout, win);
      inset._cropKey = layoutKey;
    }
    this.hideSlotsFrom(2);
    this.lastZoomKey = this.zoomChainKey(now);
    const pack = this.layout.packFit(this.layout.availBox().w, this.layout.availBox().h, this.slots, this.chrome.hidden);
    if (pack.widths.length >= 2) {
      this.stackEl.classList.toggle('fit-row', pack.dir === 'row');
      this.stackEl.classList.toggle('fit-col', pack.dir !== 'row');
      this.stackEl.style.setProperty('--stack-row-gap', pack.dir === 'row' ? this.layout.rowStackGap() + 'px' : '0px');
      this.layout.applySlotBox(this.slots[0], pack.widths[0], pack.heights[0], this.chrome.hidden);
      this.layout.applySlotBox(this.slots[1], pack.widths[1], pack.heights[1], this.chrome.hidden);
    } else if (main.tileW > MIN_CSS_PX && main.tileH > MIN_CSS_PX) {
      this.layout.applySlotBox(this.slots[1], main.tileW, main.tileH, this.chrome.hidden);
    } else {
      inset.setDisplayWidth(main.cssW);
    }
    requestAnimationFrame(() => this.redrawConnectors());
    this.syncZoomButtons();
  }

  /** Tree depths, small→large; idx is the locked depth. */
  private listZoomLadder(now: number): { uniq: Array<{ box: { x: number; y: number; w: number; h: number }; w: number; h: number; area: number; k: number; depth: number; start: number; end: number }>; idx: number } {
    const main = this.slots[0] && this.slots[0].map;
    if (!main || !main.layout) return { uniq: [], idx: -1 };
    const { grid } = main.layout;
    const cssW = main.tileW || main.cssW;
    const nowIdx = (now >= main.start && now < main.end)
      ? clamp(Math.floor((now - main.start) / grid.cellDur), 0, grid.cells - 1)
      : 0;
    const levels = this.zoomLadder.ladderLevels(grid, cssW, main.start, main.end, nowIdx);
    const uniq = [];
    for (let t = 0; t < levels.length; t++) {
      const L = levels[t];
      uniq.push({
        box: { x: 0, y: 0, w: L.nowW ?? L.w, h: L.nowH ?? L.h },
        w: L.nowW ?? L.w,
        h: L.nowH ?? L.h,
        area: L.nowArea ?? L.area,
        k: L.k,
        depth: L.depth,
        start: 0,
        end: 0,
      });
    }
    uniq.sort((a, b) => a.area - b.area);
    const lock = main._zoomLock;
    let idx = -1;
    if (lock && lock.depth >= 1) {
      for (let i = 0; i < uniq.length; i++) {
        if (uniq[i].depth !== lock.depth) continue;
        if (lock.maxArea >= ZOOM_MIN_AREA) {
          const a = uniq[i].area;
          if (a < lock.maxArea * ZOOM_KEEP_AREA_LO || a > lock.maxArea * ZOOM_KEEP_AREA_HI) continue;
        }
        idx = i;
        break;
      }
    }
    if (idx < 0 && lock && lock.wantW >= 1 && lock.wantH >= 1) {
      for (let i = 0; i < uniq.length; i++) {
        if (uniq[i].w === lock.wantW && uniq[i].h === lock.wantH) { idx = i; break; }
      }
    }
    if (idx < 0 && lock && lock.w >= 1 && lock.h >= 1) {
      for (let i = 0; i < uniq.length; i++) {
        if (uniq[i].w === lock.w && uniq[i].h === lock.h) { idx = i; break; }
      }
    }
    if (idx < 0 && main.zoomBox) {
      for (let i = 0; i < uniq.length; i++) {
        if (uniq[i].w === main.zoomBox.w && uniq[i].h === main.zoomBox.h) { idx = i; break; }
      }
    }
    if (idx < 0 && main.zoomBox) {
      const area = main.zoomBox.w * main.zoomBox.h;
      let best = Infinity;
      for (let i = 0; i < uniq.length; i++) {
        const d = Math.abs(uniq[i].area - area);
        if (d < best) { best = d; idx = i; }
      }
    }
    if (idx < 0 && this.currentZoomArea() > 0 && this.currentZoomArea() < 1e14) {
      const want = this.currentZoomArea();
      let best = Infinity;
      for (let i = 0; i < uniq.length; i++) {
        const d = Math.abs(uniq[i].area - want);
        if (d < best) { best = d; idx = i; }
      }
    }
    return { uniq, idx };
  }

  /** Disable +/− when that step does not exist. */
  private syncZoomButtons(): void {
    const main = this.slots[0] && this.slots[0].map;
    const lad = this.listZoomLadder(this.clock.nowMs());
    const n = lad.uniq.length;
    const dismiss = this.insetDismissible(main);
    const on = !!(main && main.zoomRange && this.insetSlotOn());
    if (dismiss && !on) {
      this.presets.syncButtons(n < 1, true);
      return;
    }
    const idx = lad.idx < 0 ? 0 : lad.idx;
    this.presets.syncButtons(n < 1 || idx <= 0, dismiss ? false : (n < 2 || idx >= n - 1));
  }

  /** Parent ≤1s: − past the coarsest window drops the second panel. */
  private hideFineInset(): void {
    this.clearZoomLevel();
    this.saveFrame();
    const main = this.slots[0] && this.slots[0].map;
    if (main) main.setZoomHighlight(null);
    this.hideSlotsFrom(1);
    this.lastZoomKey = 'none';
    this.relayout();
  }

  /** +1 larger yellow box, −1 smaller; + / ↑ send −1. */
  nudgeZoomSize(dir: number): void {
    const main = this.slots[0] && this.slots[0].map;
    if (!main || !main.layout) return;
    const now = this.clock.nowMs();
    const lad = this.listZoomLadder(now);
    const dismiss = this.insetDismissible(main);
    const on = !!(main.zoomRange && this.insetSlotOn());
    if (dismiss && !on) {
      if (dir >= 0 || !lad.uniq.length) return;
      this.zoomFollowStored = false;
      this.zoomSizeByMode[this.mode] = 1e15;
      this.zoomMsByMode[this.mode] = 0;
      this.saveFrame();
      this.relayout();
      return;
    }
    if (!lad.uniq.length) {
      if (dismiss && on && dir > 0) this.hideFineInset();
      return;
    }
    let idx = lad.idx;
    if (idx < 0) {
      const want = this.currentZoomArea();
      if (on && want > 0 && want < 1e14) {
        let best = Infinity;
        for (let i = 0; i < lad.uniq.length; i++) {
          const d = Math.abs(lad.uniq[i].area - want);
          if (d < best) { best = d; idx = i; }
        }
      } else {
        idx = on ? lad.uniq.length - 1 : 0;
      }
    }
    const next = idx + dir;
    if (next >= lad.uniq.length && dismiss && dir > 0) {
      this.hideFineInset();
      return;
    }
    if (next < 0 || next >= lad.uniq.length) return;
    const win = lad.uniq[next];
    this.zoomFollowStored = false;
    this.zoomSizeByMode[this.mode] = win.area;
    this.zoomMsByMode[this.mode] = 0;
    this.saveFrame();
    main._zoomLock = null;
    main._zoomMinute = Math.floor(now / MS_MIN);
    this.updateZoom(now, true);
  }

  /** from ≤ today; to ≥ today. */
  private syncArbitraryBounds(): void {
    const today = localDateValue(startOfDay(new Date(this.clock.nowMs())));
    this.arbFrom.max = today;
    this.arbTo.min = today;
    if (this.arbFrom.value && this.arbFrom.value > today) this.arbFrom.value = today;
    if (this.arbTo.value && this.arbTo.value < today) this.arbTo.value = today;
  }

  /** Date inputs are inclusive; engine range is [start, end). */
  private applyArbitraryFromInputs(): void {
    this.arbTimer = 0;
    this.syncArbitraryBounds();
    const a = parseDateInput(this.arbFrom.value);
    const b = parseDateInput(this.arbTo.value);
    const today = startOfDay(new Date(this.clock.nowMs()));
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return;
    if (a > today || b < today) return;
    const next = inclusiveDatesToRange(a, b);
    if (this.mode === 'arbitrary' && this.arbitrary && this.arbitrary.start === next.start && this.arbitrary.end === next.end) return;
    this.arbitrary = next;
    this.mode = 'arbitrary';
    this.arbitraryRow.classList.add('open');
    this.saveFrame();
    this.lastNavStamp = navStamp(this.clock.nowMs());
    this.presets.render(this.mode);
    this.relayout();
  }

  /** Custom: relayout after the last edit settles. */
  private scheduleArbitraryApply(): void {
    clearTimeout(this.arbTimer);
    this.arbTimer = window.setTimeout(() => this.applyArbitraryFromInputs(), ARB_DEBOUNCE_MS);
  }

  /** Ignore sub-RESIZE_EPS jitter (mobile chrome hide). */
  private scheduleRelayout(resetZoom = false): void {
    if (resetZoom) this.pendingResetZoom = true;
    clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      const w = this.layout.stageWidth();
      const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
      if (Math.abs(w - this.lastLayoutWidth) < RESIZE_EPS && Math.abs(h - this.lastLayoutHeight) < RESIZE_EPS) {
        this.pendingResetZoom = false;
        requestAnimationFrame(() => this.redrawConnectors());
        return;
      }
      if (this.pendingResetZoom) this.forgetZoomOnResize();
      this.pendingResetZoom = false;
      this.relayout();
    }, RESIZE_DEBOUNCE_MS);
  }

  /** Browser fullscreen: hide panel captions and relayout like F. */
  private syncFullscreenClass(): void {
    const on = this.layout.pageIsFullscreen();
    if (document.body.classList.contains('is-fullscreen') === on) return;
    document.body.classList.toggle('is-fullscreen', on);
    this.lastLayoutWidth = 0;
    this.lastLayoutHeight = 0;
    this.relayout();
  }

  /** Yellow leaders from the parent box to the inset frame. */
  private redrawConnectors(): void {
    drawAllConnectors(this.stage, this.connectors, this.stackEl, this.slots);
  }

  /** Keyboard, resize, orientation, custom dates. */
  private bindEvents(): void {
    this.arbFrom.addEventListener('input', () => this.scheduleArbitraryApply());
    this.arbTo.addEventListener('input', () => this.scheduleArbitraryApply());
    document.addEventListener('fullscreenchange', () => this.syncFullscreenClass());
    document.addEventListener('webkitfullscreenchange', () => this.syncFullscreenClass());
    document.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('resize', () => this.scheduleRelayout(true));
    window.visualViewport?.addEventListener('resize', () => this.scheduleRelayout(true));
    if (typeof window.matchMedia === 'function') {
      const orientMq = window.matchMedia('(orientation: portrait)');
      const onOrient = () => { this.lastLayoutWidth = 0; this.scheduleRelayout(true); };
      if (orientMq.addEventListener) orientMq.addEventListener('change', onOrient);
      else orientMq.addListener(onOrient);
    }
    window.addEventListener('orientationchange', () => {
      this.lastLayoutWidth = 0;
      this.pendingResetZoom = true;
      setTimeout(() => {
        if (this.pendingResetZoom) this.forgetZoomOnResize();
        this.pendingResetZoom = false;
        this.relayout();
      }, ORIENT_RELAYOUT_MS);
    });
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.scheduleRelayout()).observe(this.stage);
    }
  }

  /** D/M/Y/U presets, F chrome, +/− zoom. Ignore when typing in an input. */
  private onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'f') {
      e.preventDefault();
      this.chrome.toggle();
      return;
    }
    if (k === 'ArrowUp' || k === 'ArrowDown' || k === '+' || k === '-' || k === '=' || k === '_') {
      e.preventDefault();
      const zoomIn = k === 'ArrowUp' || k === '+' || k === '=';
      this.nudgeZoomSize(zoomIn ? -1 : 1);
      return;
    }
    const modes: Record<string, ModeId> = { d: 'today', m: 'month', y: 'year', u: 'epoch' };
    if (!modes[k]) return;
    e.preventDefault();
    this.setMode(modes[k]);
  }

  /** Restore frame, paint the first maps, start the aligned tick loop. */
  private boot(): void {
    this.theme.load();
    const saved = this.store.load();
    this.mode = saved.mode;
    this.zoomSizeByMode = saved.zoom;
    this.zoomMsByMode = saved.zoomMs;
    this.arbitrary = saved.arbitrary;
    this.layout.applyLayoutClass();
    this.lastNavStamp = navStamp(this.clock.nowMs());
    this.presets.render(this.mode);
    this.arbitraryRow.classList.toggle('open', this.mode === 'arbitrary');
    const now = this.clock.nowMs();
    const rolled = advanceEndedCustom(this.arbitrary, now, false);
    if (rolled) this.arbitrary = rolled;
    if (this.arbitrary) {
      this.arbFrom.value = localDateValue(this.arbitrary.start);
      this.arbTo.value = localDateValue(this.arbitrary.end - 1);
    } else {
      const today = rangeForMode('today', now, null);
      this.arbFrom.value = localDateValue(today.start);
      this.arbTo.value = localDateValue(today.end - 1);
    }
    this.syncArbitraryBounds();
    if (this.arbitrary) {
      const a = parseDateInput(this.arbFrom.value);
      const b = parseDateInput(this.arbTo.value);
      if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
        this.arbitrary = inclusiveDatesToRange(a, b);
      }
    }
    this.relayout();
    this.loop();
  }

  /** Tick every cell (or cell/speedup); realign to wall so speedup stays smooth. */
  private loop(): void {
    const now = this.clock.nowMs();
    this.followLiveCalendar(now);
    let finest = LOOP_MAX_MS;
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i].block.style.display === 'none' || !this.slots[i].map.layout) continue;
      this.slots[i].map.tick(now);
      finest = Math.min(finest, this.slots[i].map.layout!.grid.cellDur);
    }
    if (this.zoomChainKey(now) !== this.lastZoomKey) this.updateZoom(now);
    const step = Math.max(LOOP_MIN_MS, Math.min(LOOP_MAX_MS, finest / this.clock.speedup));
    const wall = Date.now();
    setTimeout(() => this.loop(), clamp(step - (wall % step), LOOP_MIN_MS, LOOP_MAX_MS));
  }
}
