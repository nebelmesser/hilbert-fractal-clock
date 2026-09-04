import {
  ASPECT_MAX, ASPECT_MIN, AVAIL_H_CHROME, AVAIL_H_MIN, CAPTION_FALLBACK,
  CAPTION_MIN, CAPTION_PAD, CHROME_BASE, CHROME_TOP_GAP, FIT_PAD, FIT_SHRINK,
  FIT_SHRINK_EPS, GRID_ORIENT_EPS, OVERFLOW_SLACK, PACK_CLOSE_PX, PINCH_SCALE_EPS,
  PORTRAIT_MIN_H_OVER_W, STAGE_GUTTER, STAGE_MIN_W, STAGE_USE_CLIENT_MIN,
  STACK_COL_GAP, STACK_ROW_FRAME, TILE_MIN,
} from '../constants';
import { clamp } from '../math';
import type { FitPack } from '../types';
import type { TimeMap } from '../map/TimeMap';

export type Slot = { block: HTMLDivElement; map: TimeMap };

/** Pack one or two maps into the viewport without scrolling. */
export class FitLayout {
  /** Stage is the paint box; stackEl holds the tiles. */
  constructor(
    private stage: HTMLElement,
    private stackEl: HTMLElement,
  ) {}

  /** Device upright — do not trust a collapsed stage or a short Chrome innerHeight. */
  pageIsPortrait(): boolean {
    if (typeof window.matchMedia === 'function') {
      if (window.matchMedia('(orientation: portrait)').matches) return true;
      if (window.matchMedia('(orientation: landscape)').matches) return false;
    }
    const sw = screen && screen.width, sh = screen && screen.height;
    if (sw && sh && sw !== sh) return sh > sw;
    return window.innerHeight >= window.innerWidth;
  }

  /** Fullscreen API (F11 on the document, or element.requestFullscreen). */
  pageIsFullscreen(): boolean {
    const doc = document as Document & { webkitFullscreenElement?: Element; msFullscreenElement?: Element };
    return !!(document.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement);
  }

  /** F chrome-off or OS/browser fullscreen — maps keep the caption strip. */
  captionsHidden(chromeHidden: boolean): boolean {
    return chromeHidden || this.pageIsFullscreen();
  }

  /** Caption height reserved under the tile. */
  captionExtra(slot: Slot, chromeHidden: boolean): number {
    if (this.captionsHidden(chromeHidden)) return 0;
    const el = slot.block.querySelector('.caption');
    if (!el) return CAPTION_FALLBACK;
    return Math.max(CAPTION_MIN, Math.ceil(el.getBoundingClientRect().height) + CAPTION_PAD);
  }

  /** Usable stage width, never below STAGE_MIN_W. */
  stageWidth(): number {
    return Math.max(STAGE_MIN_W, Math.round(this.stage.clientWidth || document.documentElement.clientWidth - STAGE_GUTTER));
  }

  /** Top bar + caption slack when the stage box is unknown. */
  chromeHeight(): number {
    let h = CHROME_BASE;
    const top = document.querySelector('.top-bar');
    const th = top ? top.getBoundingClientRect().height : 0;
    if (th > 0) h += th + CHROME_TOP_GAP;
    return h;
  }

  /** Height left under the top bar; take the largest of Chrome's conflicting height APIs. */
  viewportRemainH(): number {
    const vv = window.visualViewport;
    const pinch = !!(vv && Math.abs(vv.scale - 1) > PINCH_SCALE_EPS);
    let viewH = Math.max(
      window.innerHeight || 0,
      (document.documentElement && document.documentElement.clientHeight) || 0,
      (!pinch && vv && vv.height) || 0,
    );
    const sw = screen && screen.width, sh = screen && screen.height;
    if (this.pageIsPortrait() && sw && sh && sh > sw && window.innerWidth > 0) {
      viewH = Math.max(viewH, Math.round(window.innerWidth * sh / sw));
    }
    const top = document.querySelector('.top-bar');
    const th = top ? top.getBoundingClientRect().height : 0;
    const topUsed = th > 0 ? th + CHROME_TOP_GAP : 0;
    return Math.max(AVAIL_H_MIN, viewH - topUsed - AVAIL_H_CHROME);
  }

  /** Stage inner box in Fit mode. */
  availBox(): { w: number; h: number } {
    const st = getComputedStyle(this.stage);
    const pl = parseFloat(st.paddingLeft) || 0;
    const pr = parseFloat(st.paddingRight) || 0;
    const pt = parseFloat(st.paddingTop) || 0;
    const pb = parseFloat(st.paddingBottom) || 0;
    const w = this.stage.clientWidth - pl - pr;
    const h = this.stage.clientHeight - pt - pb;
    if (w > STAGE_USE_CLIENT_MIN && h > STAGE_USE_CLIENT_MIN) return { w, h };
    return {
      w: this.stageWidth(),
      h: Math.max(STAGE_MIN_W, window.innerHeight - this.chromeHeight()),
    };
  }

  /** w/h for pickGrid; on a portrait phone never ask for a landscape grid. */
  slotAspect(w: number, h: number): number {
    const measured = Math.max(1, h);
    if (this.pageIsPortrait()) {
      const tallH = Math.max(measured, this.viewportRemainH(), w * PORTRAIT_MIN_H_OVER_W);
      return clamp(w / tallH, ASPECT_MIN, 1 - GRID_ORIENT_EPS);
    }
    return clamp(w / measured, ASPECT_MIN, ASPECT_MAX);
  }

  /** Slot the day map should fill: stage box, but never shorter than the viewport remainder. */
  layoutMetrics(slots: Slot[], chromeHidden = false): { width: number; aspect: number; availH: number } {
    const box = this.availBox();
    const cap = slots[0] && slots[0].block.style.display !== 'none'
      ? this.captionExtra(slots[0], chromeHidden) : CAPTION_FALLBACK;
    const width = Math.max(STAGE_MIN_W, box.w);
    const slotH = Math.max(AVAIL_H_MIN, box.h - cap);
    const availH = Math.max(slotH, this.viewportRemainH());
    return { width, aspect: this.slotAspect(width, availH), availH };
  }

  /** Horizontal padding from a map to the window edge (body + stage). */
  stageEdgeX(): number {
    const body = getComputedStyle(document.body);
    const st = getComputedStyle(this.stage);
    const bodyX = Math.max(parseFloat(body.paddingLeft) || 0, parseFloat(body.paddingRight) || 0);
    const stageX = Math.max(parseFloat(st.paddingLeft) || 0, parseFloat(st.paddingRight) || 0, FIT_PAD);
    return bodyX + stageX;
  }

  /** Between row tiles; >= stage edge, plus frames so they do not overlap. */
  rowStackGap(): number {
    return this.stageEdgeX() + STACK_ROW_FRAME;
  }

  /** Visible maps that already have a layout. */
  fitSlots(slots: Slot[]): Slot[] {
    return slots.filter((s) => s.block.style.display !== 'none' && s.map.layout);
  }

  /** Row: same paint height; column: same paint width; scale to the stage. */
  packFit(availW: number, availH: number, slots: Slot[], chromeHidden: boolean): FitPack {
    const vis = this.fitSlots(slots);
    const n = vis.length;
    if (!n) return { dir: 'col', widths: [], heights: [] };
    const caps = vis.map((s) => this.captionExtra(s, chromeHidden));
    const capMax = Math.max.apply(null, caps);
    const capSum = caps.reduce((a, b) => a + b, 0);
    const colGap = n > 1 ? STACK_COL_GAP : 0;
    const rowGap = n > 1 ? this.rowStackGap() : 0;

    if (n === 1) {
      const r = vis[0].map.layout!.grid.h / vis[0].map.layout!.grid.w;
      const w = Math.max(TILE_MIN, Math.min(availW, Math.floor((availH - caps[0]) / Math.max(1e-6, r))));
      return { dir: 'col', widths: [w], heights: [Math.max(TILE_MIN, Math.round(w * r))] };
    }

    const aspects = vis.map((s) => {
      const g = s.map.layout && s.map.layout.grid;
      return (g && g.w > 0 && g.h > 0) ? g.w / g.h : 1;
    });

    const hBudget = Math.max(TILE_MIN, availH - capSum - colGap);
    const colInv = aspects.reduce((s, a) => s + 1 / Math.max(1e-6, a), 0);
    const colW = Math.max(TILE_MIN, Math.min(availW, Math.floor(hBudget / Math.max(1e-6, colInv))));
    const colHeights = aspects.map((a) => Math.max(TILE_MIN, Math.round(colW / a)));
    const col: FitPack = {
      dir: 'col',
      widths: vis.map(() => colW),
      heights: colHeights,
      area: colHeights.reduce((s, h) => s + colW * h, 0),
    };

    const wBudget = Math.max(TILE_MIN, availW - rowGap);
    const rowSumA = aspects.reduce((s, a) => s + a, 0);
    const rowH = Math.max(TILE_MIN, Math.min(
      Math.floor(availH - capMax),
      Math.floor(wBudget / Math.max(1e-6, rowSumA)),
    ));
    const rowWidths = aspects.map((a) => Math.max(TILE_MIN, Math.round(rowH * a)));
    const row: FitPack = {
      dir: 'row',
      widths: rowWidths,
      heights: vis.map(() => rowH),
      area: rowWidths.reduce((s, w) => s + w * rowH, 0),
    };

    if (this.pageIsPortrait()) return col;
    return (row.area ?? 0) > (col.area ?? 0) ? row : col;
  }

  /** Fit budget is tileW×tileH; canvas letterboxes to the grid. */
  applySlotBox(slot: Slot, tileW: number, tileH: number, chromeHidden: boolean): void {
    slot.map.setDisplaySize(tileW, tileH);
    slot.block.style.width = tileW + 'px';
    slot.block.style.height = (tileH + this.captionExtra(slot, chromeHidden)) + 'px';
  }

  /** Pack matches current tiles within PACK_CLOSE_PX. */
  visWidthClose(pack: FitPack, slots: Slot[]): boolean {
    const vis = this.fitSlots(slots);
    if (vis.length !== pack.widths.length) return false;
    for (let i = 0; i < vis.length; i++) {
      const tw = vis[i].map.tileW || vis[i].map.cssW;
      const th = vis[i].map.tileH || vis[i].map.cssH;
      if (Math.abs(tw - pack.widths[i]) > PACK_CLOSE_PX) return false;
      if (Math.abs(th - pack.heights[i]) > PACK_CLOSE_PX) return false;
    }
    return true;
  }

  /** Union of map + highlight + caption, for overflow shrink. */
  fitPaintBounds(slots: Slot[]): { minL: number; minT: number; maxR: number; maxB: number } {
    const vis = this.fitSlots(slots);
    let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
    for (let i = 0; i < vis.length; i++) {
      const boxes = [vis[i].map.hl, vis[i].map.wrap, vis[i].block.querySelector('.caption')];
      for (let b = 0; b < boxes.length; b++) {
        if (!boxes[b]) continue;
        const r = (boxes[b] as HTMLElement).getBoundingClientRect();
        if (!r.width && !r.height) continue;
        minL = Math.min(minL, r.left);
        minT = Math.min(minT, r.top);
        maxR = Math.max(maxR, r.right);
        maxB = Math.max(maxB, r.bottom);
      }
    }
    return { minL, minT, maxR, maxB };
  }

  /** Uniform shrink if paint (incl. yellow frame) overflows the stage; grid unchanged. */
  enforceFitInStage(slots: Slot[], chromeHidden: boolean, onShrink: () => void): void {
    const vis = this.fitSlots(slots);
    if (!vis.length) return;
    const stageRect = this.stage.getBoundingClientRect();
    const pad = FIT_PAD;
    const inner = {
      left: stageRect.left + pad,
      top: stageRect.top + pad,
      right: stageRect.right - pad,
      bottom: stageRect.bottom - pad,
    };
    const b = this.fitPaintBounds(slots);
    if (!Number.isFinite(b.minL)) return;
    const contentW = Math.max(1, b.maxR - b.minL);
    const contentH = Math.max(1, b.maxB - b.minT);
    const innerW = Math.max(TILE_MIN, inner.right - inner.left);
    const innerH = Math.max(TILE_MIN, inner.bottom - inner.top);
    const overflow = b.minL < inner.left - OVERFLOW_SLACK || b.minT < inner.top - OVERFLOW_SLACK ||
      b.maxR > inner.right + OVERFLOW_SLACK || b.maxB > inner.bottom + OVERFLOW_SLACK;
    if (!overflow) return;
    const s = Math.min(innerW / contentW, innerH / contentH) * FIT_SHRINK;
    if (!(s < FIT_SHRINK_EPS) || s <= 0) return;
    const tw = vis[0].map.tileW || vis[0].map.cssW;
    const th = vis[0].map.tileH || vis[0].map.cssH;
    for (let i = 0; i < vis.length; i++) {
      const iw = vis[i].map.tileW || vis[i].map.cssW || tw;
      const ih = vis[i].map.tileH || vis[i].map.cssH || th;
      this.applySlotBox(vis[i], Math.max(TILE_MIN, Math.floor(iw * s)), Math.max(TILE_MIN, Math.floor(ih * s)), chromeHidden);
    }
    onShrink();
  }

  /** Painted left/right of the map, including yellow outline / hl pad. */
  panelPaintX(slot: Slot): { left: number; right: number } {
    const wrap = slot.map.wrap.getBoundingClientRect();
    let left = wrap.left;
    let right = wrap.right;
    const hl = slot.map.hl;
    if (hl) {
      const r = hl.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        left = Math.min(left, r.left);
        right = Math.max(right, r.right);
      }
    }
    return { left, right };
  }

  /** Row: gap between maps ≥ each map's margin to the window edge. */
  enforceRowGap(slots: Slot[], chromeHidden: boolean, onShrink: () => void): void {
    if (!this.stackEl.classList.contains('fit-row')) return;
    const vis = this.fitSlots(slots);
    if (vis.length < 2) return;
    const vw = document.documentElement.clientWidth;
    let shrunk = false;
    for (let k = 0; k < 4; k++) {
      const xs = vis.map((s) => this.panelPaintX(s));
      xs.sort((a, b) => a.left - b.left);
      const gap = xs[1].left - xs[0].right;
      const side = Math.min(xs[0].left, vw - xs[1].right);
      if (gap + OVERFLOW_SLACK >= side) {
        if (shrunk) onShrink();
        return;
      }
      shrunk = true;
      const s = FIT_SHRINK;
      for (let i = 0; i < vis.length; i++) {
        const tw = vis[i].map.tileW || vis[i].map.cssW;
        const th = vis[i].map.tileH || vis[i].map.cssH;
        this.applySlotBox(vis[i], Math.max(TILE_MIN, Math.floor(tw * s)), Math.max(TILE_MIN, Math.floor(th * s)), chromeHidden);
      }
    }
    if (shrunk) onShrink();
  }

  /** Fit is the only layout; class drives the CSS lock. */
  applyLayoutClass(): void {
    document.documentElement.classList.add('fit-mode');
    document.body.classList.add('fit-mode');
  }
}
