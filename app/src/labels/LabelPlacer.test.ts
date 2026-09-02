import { describe, expect, it } from 'vitest';
import { LabelPlacer } from './LabelPlacer';

const theme = {
  past: 0, pastFrom: 0, pastSatDip: 0.5, future: 0xff161616, curPast: 0, curFuture: 0, head: 0, surplus: 0,
  labelAlpha: 0.38, labelEmptyAlpha: 0.34,
  labelLive: 'live', labelLiveEmpty: 'live-empty',
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
});
