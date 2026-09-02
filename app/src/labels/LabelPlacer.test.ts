import { describe, expect, it } from 'vitest';
import { LabelPlacer } from './LabelPlacer';

const theme = {
  past: 0, future: 0, curPast: 0, curFuture: 0, head: 0, surplus: 0,
  label: 'past', labelEmpty: 'empty', labelLive: 'live', labelLiveEmpty: 'live-empty',
  currentOutline: '', zoom: '', bound0: '', bound1: '', bound2: '', bound3: '',
};

describe('LabelPlacer', () => {
  it('picks live / past / empty colors', () => {
    const p = new LabelPlacer();
    expect(p.labelColor(theme, true, false)).toBe('past');
    expect(p.labelColor(theme, false, false)).toBe('empty');
    expect(p.labelColor(theme, true, true)).toBe('live');
    expect(p.labelColor(theme, false, true)).toBe('live-empty');
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
