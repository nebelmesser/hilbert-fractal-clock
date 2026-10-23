import { describe, expect, it } from 'vitest';
import { LABEL_PADDING_EM } from '../constants';
import { LabelPlacer, cssWithAlpha, eraseFrameBand, pickSharedLabelFont, type GlyphMetrics } from './LabelPlacer';

const theme = {
  past: 0, pastFrom: 0, pastMid: 0, pastTo: 0, pastSatDip: 0.5, future: 0xff161616, curPast: 0, curInner: 0, curFuture: 0, head: 0, surplus: 0,
  labelAlpha: 0.38, labelEmptyAlpha: 0.34,
  labelLive: 'live', labelLiveEmpty: 'live-empty', overlay: '', overlayMaxPx: 160,
  currentOutline: '', zoom: '', bound0: '', boundAlpha1: 0.55, boundAlpha2: 0.28, boundAlpha3: 0.12,
};

const pink = 0xffa4a4c7;
const wideGlyph: GlyphMetrics = { left: 0, right: 3, ascent: 0.8, descent: 0.2, width: 3, height: 1 };

describe('LabelPlacer', () => {
  it('keeps the live glyph red and derives others from the block fill', () => {
    const p = new LabelPlacer();
    expect(p.labelColor(theme, true, true, pink)).toBe('live');
    expect(p.labelColor(theme, false, true, theme.future)).toBe('live-empty');
    expect(p.labelColor(theme, true, false, pink)).toBe('rgba(0,0,0,0.38)');
    expect(p.labelColor(theme, false, false, theme.future)).toBe('rgba(255,255,255,0.34)');
    expect(p.labelColor(theme, true, false, pink, { filled: 0.16, empty: 0.14, live: 0.22 }))
      .toBe('rgba(0,0,0,0.16)');
    const liveTheme = { ...theme, labelLive: '#db0202' };
    expect(p.labelColor(liveTheme, true, true, pink, { filled: 0.16, empty: 0.14, live: 0.22 }))
      .toBe('rgba(219,2,2,0.22)');
  });

  it('applies alpha to hex live colors for the inset watermark', () => {
    expect(cssWithAlpha('#db0202', 0.22)).toBe('rgba(219,2,2,0.22)');
    expect(cssWithAlpha('#abc', 0.5)).toBe('rgba(170,187,204,0.5)');
  });

  it('uses the actual text aspect ratio and can place text in a shallow strip', () => {
    const p = new LabelPlacer();
    const mask = new Uint8Array(20 * 10);
    mask.fill(1, 0, 40);
    for (let y = 6; y < 10; y++) mask.fill(1, y * 20, y * 20 + 4);
    const geometry = p.geometry(mask, 20, 10);
    const size = p.maxFont(geometry, wideGlyph, 1, 1);
    expect(size).toBeCloseTo(2 / (1 + 2 * LABEL_PADDING_EM));
    const place = p.placeGlyph(geometry, wideGlyph, size, 1, 1)!;
    expect(place.y).toBeGreaterThanOrEqual(0);
    expect(place.y + place.h).toBeLessThanOrEqual(2);
  });

  it('centers in the spacious interior instead of following a centroid into a narrow arm', () => {
    const p = new LabelPlacer();
    const mask = new Uint8Array(30 * 10);
    for (let y = 0; y < 10; y++) mask.fill(1, y * 30, y * 30 + 10);
    for (let y = 4; y < 6; y++) mask.fill(1, y * 30 + 10, y * 30 + 30);
    const geometry = p.geometry(mask, 30, 10);
    const box = p.placeGlyph(geometry, wideGlyph, 1, 1, 1)!;
    expect(box.x + box.w / 2).toBeCloseTo(5);
    expect(box.y + box.h / 2).toBeCloseTo(geometry.cy);
  });

  it('keeps the text and its padding away from the actual frame stroke', () => {
    const p = new LabelPlacer();
    const mask = eraseFrameBand(new Uint8Array(16 * 10).fill(1), 16, 10, 0, 0, { x: 0, y: 0, w: 16, h: 10 }, 2);
    const geometry = p.geometry(mask, 16, 10);
    const box = p.placeGlyph(geometry, wideGlyph, p.maxFont(geometry, wideGlyph, 1, 1), 1, 1)!;
    expect(box.x).toBeGreaterThanOrEqual(2);
    expect(box.y).toBeGreaterThanOrEqual(2);
    expect(box.x + box.w).toBeLessThanOrEqual(14);
    expect(box.y + box.h).toBeLessThanOrEqual(8);
  });

  it('matches exhaustive search for maximum scale, boundary clearance, and centering', () => {
    const p = new LabelPlacer();
    let seed = 1234;
    for (let sample = 0; sample < 100; sample++) {
      const mask = Uint8Array.from({ length: 25 }, () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed % 5 ? 1 : 0;
      });
      const rooms: Array<{ x: number; y: number; w: number; h: number }> = [];
      for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
        for (let h = 1; h <= 5 - y; h++) for (let w = 1; w <= 5 - x; w++) {
          let filled = true;
          for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
            if (!mask[yy * 5 + xx]) filled = false;
          }
          if (filled) rooms.push({ x, y, w, h });
        }
      }
      const geometry = p.geometry(mask, 5, 5);
      const cw = 1.4, ch = 0.7;
      const expected = Math.max(...rooms.map((r) => Math.min(
        r.w * cw / (3 + 2 * LABEL_PADDING_EM), r.h * ch / (1 + 2 * LABEL_PADDING_EM),
      )));
      expect(p.maxFont(geometry, wideGlyph, cw, ch)).toBeCloseTo(expected);
      const size = expected * 0.7;
      const box = p.placeGlyph(geometry, wideGlyph, size, cw, ch)!;
      const halfW = size * (1.5 + LABEL_PADDING_EM), halfH = size * (0.5 + LABEL_PADDING_EM);
      const cx = geometry.cx * cw, cy = geometry.cy * ch;
      const candidates = rooms.filter((r) => r.w * cw >= halfW * 2 && r.h * ch >= halfH * 2).map((r) => {
        const clearance = Math.min((r.w * cw - 3 * size) / 2, (r.h * ch - size) / 2);
        const hx = Math.max(halfW, 3 * size / 2 + clearance);
        const hy = Math.max(halfH, size / 2 + clearance);
        const x = Math.max(r.x * cw + hx, Math.min(cx, (r.x + r.w) * cw - hx));
        const y = Math.max(r.y * ch + hy, Math.min(cy, (r.y + r.h) * ch - hy));
        return { clearance, distance: (x - cx) ** 2 + (y - cy) ** 2 };
      });
      const maxClearance = Math.max(...candidates.map((c) => c.clearance));
      const minDistance = Math.min(...candidates.filter((c) => Math.abs(c.clearance - maxClearance) < 1e-7).map((c) => c.distance));
      expect(((box.x + box.w / 2) * cw - cx) ** 2 + ((box.y + box.h / 2) * ch - cy) ** 2).toBeCloseTo(minDistance);
      const actualClearance = Math.max(...rooms.map((r) => Math.min(
        (box.x - r.x) * cw, (r.x + r.w - box.x - box.w) * cw,
        (box.y - r.y) * ch, (r.y + r.h - box.y - box.h) * ch,
      )));
      expect(actualClearance).toBeCloseTo(maxClearance);
    }
  });
});

describe('pickSharedLabelFont', () => {
  it('omits a much smaller region and fits every remaining label', () => {
    const picked = pickSharedLabelFont([
      { i: 0, area: 8, px: 4 },
      { i: 1, area: 40, px: 18 },
      { i: 2, area: 42, px: 20 },
      { i: 3, area: 38, px: 16 },
    ], 0.55, 10);
    expect(picked.draw.has(0)).toBe(false);
    expect(picked.draw.has(1)).toBe(true);
    expect(picked.draw.has(2)).toBe(true);
    expect(picked.draw.has(3)).toBe(true);
    expect(picked.fontSize).toBe(16);
  });

  it('shrinks the shared font for awkward slots in regions of similar area', () => {
    const picked = pickSharedLabelFont([
      { i: 0, area: 30, px: 14 },
      { i: 1, area: 32, px: 16 },
      { i: 2, area: 28, px: 3 },
    ], 0.55, 10);
    expect([...picked.draw].sort((a, b) => a - b)).toEqual([0, 1, 2]);
    expect(picked.fontSize).toBe(3);
  });

  it('omits at most three tiny regions, choosing the smallest by area', () => {
    const areas = [100, 8, 100, 5, 100, 7, 100, 4, 100, 6, 100];
    const picked = pickSharedLabelFont(areas.map((area, i) => ({ i, area, px: area / 2 })), 0.55, 10);
    expect(areas.map((_, i) => i).filter((i) => !picked.draw.has(i))).toEqual([3, 7, 9]);
    expect(picked.fontSize).toBe(3.5);
  });
});
