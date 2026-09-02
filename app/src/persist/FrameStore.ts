import { FRAME_KEY, ZOOM_IDS } from '../constants';
import type { ModeId, TimeRange } from '../types';

export type FrameData = {
  mode: ModeId;
  layout: 'fit';
  zoom: Record<ModeId, number>;
  zoomMs: Record<ModeId, number>;
  arbitrary?: TimeRange;
};

/** Zero zoom area/duration per preset. */
function emptyZoom(): Record<ModeId, number> {
  return { today: 0, month: 0, year: 0, epoch: 0, arbitrary: 0 };
}

/** localStorage frame: last preset, custom dates, zoom per mode. F-mode is not written. */
export class FrameStore {
  /** Use injected storage so tests can run without a window. */
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'> | null = null) {}

  /** Persist mode, zoom maps, and an optional custom range. */
  save(data: FrameData): void {
    if (!this.storage) return;
    try {
      const payload: FrameData = {
        mode: data.mode,
        layout: 'fit',
        zoom: { ...data.zoom },
        zoomMs: { ...data.zoomMs },
      };
      if (data.arbitrary && Number.isFinite(data.arbitrary.start) && Number.isFinite(data.arbitrary.end) && data.arbitrary.end > data.arbitrary.start) {
        payload.arbitrary = { start: data.arbitrary.start, end: data.arbitrary.end };
      }
      this.storage.setItem(FRAME_KEY, JSON.stringify(payload));
    } catch {
      /* quota / private mode */
    }
  }

  /** Restore the last frame; ignore corrupt JSON. */
  load(): { mode: ModeId; zoom: Record<ModeId, number>; zoomMs: Record<ModeId, number>; arbitrary: TimeRange | null } {
    const zoom = emptyZoom();
    const zoomMs = emptyZoom();
    let mode: ModeId = 'today';
    let arbitrary: TimeRange | null = null;
    if (!this.storage) return { mode, zoom, zoomMs, arbitrary };
    try {
      const raw = JSON.parse(this.storage.getItem(FRAME_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return { mode, zoom, zoomMs, arbitrary };
      if (raw.arbitrary && Number.isFinite(+raw.arbitrary.start) && Number.isFinite(+raw.arbitrary.end) && +raw.arbitrary.end > +raw.arbitrary.start) {
        arbitrary = { start: +raw.arbitrary.start, end: +raw.arbitrary.end };
      }
      if (raw.mode === 'today' || raw.mode === 'month' || raw.mode === 'year' || raw.mode === 'epoch' || raw.mode === 'arbitrary') {
        if (raw.mode !== 'arbitrary' || arbitrary) mode = raw.mode;
      }
      this.loadZoomMap(raw.zoom, zoom);
      this.loadZoomMap(raw.zoomMs, zoomMs);
    } catch {
      /* ignore corrupt JSON */
    }
    return { mode, zoom, zoomMs, arbitrary };
  }

  /** Copy finite ≥0 numbers onto dest. */
  private loadZoomMap(raw: unknown, dest: Record<ModeId, number>): void {
    if (!raw || typeof raw !== 'object') return;
    const rec = raw as Record<string, unknown>;
    for (let i = 0; i < ZOOM_IDS.length; i++) {
      const n = +(rec[ZOOM_IDS[i]] as number);
      if (Number.isFinite(n) && n >= 0) dest[ZOOM_IDS[i]] = n;
    }
  }
}

/** window.localStorage, or null if storage is blocked. */
export function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
