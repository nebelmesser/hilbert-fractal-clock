import { MS_DAY } from '../constants';
import { pad2 } from '../math';
import type { ModeId, TimeRange } from '../types';
import { UNIX32_END } from '../constants';

/** Local civil day as days since 1970-01-01 UTC. */
export function daySerial(d: Date): number {
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1970, 0, 1)) / MS_DAY);
}

/** Local midnight of the given date. */
export function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** First instant of the local month. */
export function startOfMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/** First instant of the local year. */
export function startOfYear(d: Date): number {
  return new Date(d.getFullYear(), 0, 1).getTime();
}

/** First instant of the local hour. */
export function startOfHour(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
}

/** First instant of the local minute. */
export function startOfMinute(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()).getTime();
}

/** First instant of the local second. */
export function startOfSecond(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()).getTime();
}

/** 1 January of the century that contains the date (1900, 2000, …). */
export function startOfCentury(d: Date): number {
  return new Date(Math.floor(d.getFullYear() / 100) * 100, 0, 1).getTime();
}

/** YYYY-MM-DD for `<input type=date>`. */
export function localDateValue(t: number): string {
  const d = new Date(t);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/** YYYY-MM-DD from a date input → local midnight ms. */
export function parseDateInput(v: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '').trim());
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
}

/** Half-open [start, end) for a preset; custom is stored inclusive-end + 1 day. */
export function rangeForMode(id: ModeId, now: number, arbitrary: TimeRange | null): TimeRange {
  const d = new Date(now);
  if (id === 'today') {
    return { start: startOfDay(d), end: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() };
  }
  if (id === 'month') {
    return { start: startOfMonth(d), end: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() };
  }
  if (id === 'year') {
    return { start: startOfYear(d), end: new Date(d.getFullYear() + 1, 0, 1).getTime() };
  }
  if (id === 'epoch') {
    return { start: 0, end: UNIX32_END };
  }
  if (id === 'arbitrary' && arbitrary) return arbitrary;
  return { start: startOfDay(d), end: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() };
}

/** Day+month+year stamp so midnight retitles D / M / Y. */
export function navStamp(now: number): string {
  const d = new Date(now);
  return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
}

/** Advance a finished custom window to the next same-length interval that contains now. */
export function advanceEndedCustom(arbitrary: TimeRange | null, now: number, pendingEdit: boolean): TimeRange | null {
  if (!arbitrary || pendingEdit) return null;
  const dur = arbitrary.end - arbitrary.start;
  if (!(dur > 0) || now < arbitrary.end) return null;
  const k = Math.floor((now - arbitrary.start) / dur);
  if (k < 1) return null;
  const start = arbitrary.start + k * dur;
  return { start, end: start + dur };
}

/** Inclusive date inputs → engine half-open range [from, to+1day). */
export function inclusiveDatesToRange(fromMs: number, toMs: number): TimeRange {
  const end = new Date(toMs);
  end.setDate(end.getDate() + 1);
  return { start: fromMs, end: end.getTime() };
}
