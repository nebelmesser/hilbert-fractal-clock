import { describe, expect, it } from 'vitest';
import { LabelPlacer, cssWithAlpha, eraseFrameBand, pickSharedLabelFont, preferLargerHalf } from './LabelPlacer';

const theme = {
  past: 0, pastFrom: 0, pastMid: 0, pastTo: 0, pastSatDip: 0.5, future: 0xff161616, curPast: 0, curInner: 0, curFuture: 0, head: 0, surplus: 0,
  labelAlpha: 0.38, labelEmptyAlpha: 0.34,
  labelLive: 'live', labelLiveEmpty: 'live-empty', overlay: '', overlayMaxPx: 160,
  currentOutline: '', zoom: '', bound0: '', boundAlpha1: 0.55, boundAlpha2: 0.28, boundAlpha3: 0.12,
};

const pink = 0xffa4a4c7;

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

  it('keeps placeMask on the full region in timelapse', () => {
    const p = new LabelPlacer();
    const full = new Uint8Array([1, 1, 0]);
    const past = new Uint8Array([1, 0, 0]);
    const future = new Uint8Array([0, 1, 0]);
    const placed = p.placeMaskForRegion({
      timeLapse: true, live: true, unitId: 'hour',
      full, past, future, nPast: 1, nFuture: 1,
    });
    expect(placed.placeMask).toBe(full);
    expect(placed.onFilled).toBe(true);
  });

  it('uses the filled half for a live non-second unit in wall-clock mode', () => {
    const p = new LabelPlacer();
    const full = new Uint8Array([1, 1]);
    const past = new Uint8Array([1, 0]);
    const future = new Uint8Array([0, 1]);
    const placed = p.placeMaskForRegion({
      timeLapse: false, live: true, unitId: 'hour',
      full, past, future, nPast: 4, nFuture: 1,
    });
    expect(placed.placeMask).toBe(past);
    expect(placed.onFilled).toBe(true);
  });

  it('keeps the larger half when a rect cuts the region, like a live unit', () => {
    const base = new Uint8Array([1, 1, 1, 1, 1]);
    const outBox = new Uint8Array([1, 1, 1, 0, 0]);
    const inBox = new Uint8Array([0, 0, 0, 1, 1]);
    expect([...preferLargerHalf(base, outBox, inBox)]).toEqual([...outBox]);
  });

  it('leaves the mask alone when the zoom box does not split the region', () => {
    const base = new Uint8Array([1, 1, 0]);
    const outBox = new Uint8Array([1, 1, 1]);
    const inBox = new Uint8Array([0, 0, 0]);
    expect(preferLargerHalf(base, outBox, inBox)).toBe(base);
  });

  it('places the glyph slot entirely in the larger half of a cut region', () => {
    const p = new LabelPlacer();
    const bw = 8, bh = 4;
    const full = new Uint8Array(bw * bh).fill(1);
    const inBox = new Uint8Array(bw * bh);
    const outBox = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        if (y < 1) inBox[y * bw + x] = 1;
        else outBox[y * bw + x] = 1;
      }
    }
    const mask = preferLargerHalf(full, outBox, inBox);
    const place = p.largestSlotInMask(mask, bw, bh, '16x9', bw / 2, bh / 2);
    expect(place.area).toBeGreaterThan(0);
    expect(place.y).toBeGreaterThanOrEqual(1);
    expect(place.y + place.h).toBeLessThanOrEqual(bh);
  });

  it('erases the zoom-frame band so the slot sits in the remaining interior', () => {
    const p = new LabelPlacer();
    const bw = 16, bh = 10;
    const full = new Uint8Array(bw * bh).fill(1);
    const box = { x: 0, y: 0, w: 16, h: 10 };
    const pad = 2;
    const mask = eraseFrameBand(full, bw, bh, 0, 0, box, pad);
    const place = p.largestSlotInMask(mask, bw, bh, '16x9', bw / 2, bh / 2);
    expect(place.area).toBeGreaterThan(0);
    expect(place.x).toBeGreaterThanOrEqual(pad);
    expect(place.y).toBeGreaterThanOrEqual(pad);
    expect(place.x + place.w).toBeLessThanOrEqual(bw - pad);
    expect(place.y + place.h).toBeLessThanOrEqual(bh - pad);
  });
});

describe('pickSharedLabelFont', () => {
  it('sizes the layer from typical slots and skips a much smaller one', () => {
    const picked = pickSharedLabelFont([
      { i: 0, score: 8, px: 4 },
      { i: 1, score: 40, px: 18 },
      { i: 2, score: 42, px: 20 },
      { i: 3, score: 38, px: 16 },
    ], 0.55, 10);
    expect(picked.draw.has(0)).toBe(false);
    expect(picked.draw.has(1)).toBe(true);
    expect(picked.draw.has(2)).toBe(true);
    expect(picked.draw.has(3)).toBe(true);
    expect(picked.fontSize).toBe(18);
  });

  it('keeps every slot when sizes are similar', () => {
    const picked = pickSharedLabelFont([
      { i: 0, score: 30, px: 14 },
      { i: 1, score: 32, px: 16 },
      { i: 2, score: 28, px: 12 },
    ], 0.55, 10);
    expect([...picked.draw].sort((a, b) => a - b)).toEqual([0, 1, 2]);
    expect(picked.fontSize).toBe(14);
  });
});
