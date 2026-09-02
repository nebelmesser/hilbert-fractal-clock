import { describe, expect, it } from 'vitest';
import { FRAME_KEY } from '../constants';
import { FrameStore } from './FrameStore';

/** In-memory Storage stand-in for FrameStore tests. */
class MemoryStore {
  map = new Map<string, string>();
  /** Read a stored JSON string. */
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  /** Write a stored JSON string. */
  setItem(k: string, v: string): void { this.map.set(k, v); }
}

describe('FrameStore', () => {
  it('round-trips mode, zoom, and a custom range', () => {
    const mem = new MemoryStore();
    const store = new FrameStore(mem);
    store.save({
      mode: 'month',
      layout: 'fit',
      zoom: { today: 12, month: 48, year: 0, epoch: 0, arbitrary: 0 },
      zoomMs: { today: 1000, month: 2000, year: 0, epoch: 0, arbitrary: 0 },
      arbitrary: { start: 10, end: 20 },
    });
    const loaded = store.load();
    expect(loaded.mode).toBe('month');
    expect(loaded.zoom.month).toBe(48);
    expect(loaded.zoomMs.month).toBe(2000);
    expect(loaded.arbitrary).toEqual({ start: 10, end: 20 });
    expect(JSON.parse(mem.getItem(FRAME_KEY)!).chromeHidden).toBeUndefined();
  });

  it('ignores corrupt JSON and never writes F-mode', () => {
    const mem = new MemoryStore();
    mem.setItem(FRAME_KEY, '{not json');
    const store = new FrameStore(mem);
    const loaded = store.load();
    expect(loaded.mode).toBe('today');
    expect(loaded.arbitrary).toBeNull();
    store.save({
      mode: 'today',
      layout: 'fit',
      zoom: { today: 0, month: 0, year: 0, epoch: 0, arbitrary: 0 },
      zoomMs: { today: 0, month: 0, year: 0, epoch: 0, arbitrary: 0 },
    });
    expect(JSON.parse(mem.getItem(FRAME_KEY)!)).not.toHaveProperty('chromeHidden');
  });
});
