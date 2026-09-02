/** Parse `?start=` / `?time=` as YYYY-MM-DD-HH:MM:SS or YYYY-MM-DD (local midnight). */
export function parseClockTime(raw: string | null): number | null {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})-(\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (m) {
    const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
    return Number.isFinite(t) ? t : null;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const t = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Parse `?speedup=`; invalid or empty values fall back to 1, cap 1e12. */
export function parseSpeedup(raw: string | null): number {
  if (raw == null || raw === '') return 1;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || !(n > 0)) return 1;
  return Math.min(n, 1e12);
}

/**
 * Simulated clock: wall time, or a query origin plus optional speedup.
 * `timeLapse` is true when speedup ≠ 1 (pin glyph slots, still retint live colors).
 */
export class ClockTime {
  readonly origin: number;
  readonly speedup: number;
  readonly timeLapse: boolean;
  private readonly wallOrigin: number;

  /** Read `start`/`time`/`speedup` from a query string. */
  constructor(search = '', wallNow = Date.now()) {
    const qs = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const parsed = parseClockTime(qs.get('start') || qs.get('time'));
    this.speedup = parseSpeedup(qs.get('speedup'));
    this.timeLapse = this.speedup !== 1;
    this.wallOrigin = wallNow;
    this.origin = parsed == null ? wallNow : parsed;
  }

  /** Current simulated instant: origin + speedup × elapsed wall time. */
  nowMs(wallNow = Date.now()): number {
    return this.origin + this.speedup * (wallNow - this.wallOrigin);
  }
}
