import { FORMAT_MAX_PARTS, MS_100, MS_DAY, MS_HOUR, MS_MIN, MS_SEC, ORDINAL_TEEN_HI, ORDINAL_TEEN_LO } from '../constants';
import { pad2, pad3 } from '../math';

/** 1st, 2nd, 3rd, 4th…11th…21st — calendar days, not zero-padded hours. */
export function ordinalDay(n: number): string {
  const mod100 = n % 100;
  const suffix = (mod100 >= ORDINAL_TEEN_LO && mod100 <= ORDINAL_TEEN_HI) ? 'th'
    : (n % 10 === 1) ? 'st'
      : (n % 10 === 2) ? 'nd'
        : (n % 10 === 3) ? 'rd'
          : 'th';
  return n + suffix;
}

/** Greedy roman numerals for centuries (20 → XX). Covers 1…3999. */
export function romanNumeral(n: number): string {
  if (!(n > 0) || n >= 4000) return String(n);
  const pairs: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let s = '';
  let rest = n;
  for (let i = 0; i < pairs.length; i++) {
    while (rest >= pairs[i][0]) {
      s += pairs[i][1];
      rest -= pairs[i][0];
    }
  }
  return s;
}

/** Caption duration: 1m 52.5s, never a raw millisecond count for whole units. */
export function formatDur(ms: number): string {
  if (!(ms > 0) || !Number.isFinite(ms)) return '0s';
  if (ms < 1) return (ms * 1000).toFixed(0) + 'µs';
  if (ms < MS_SEC) {
    if (ms === MS_100) return '0.1s';
    if (ms === 250) return '0.25s';
    if (ms === 500) return '0.5s';
    if (ms >= MS_100 && ms % MS_100 === 0) return (ms / MS_SEC) + 's';
    return Math.round(ms) + 'ms';
  }
  const day = MS_DAY;
  const hour = MS_HOUR;
  const min = MS_MIN;
  const sec = MS_SEC;
  if (ms % day === 0) return (ms / day) + 'd';
  if (ms % hour === 0 && ms < day) return (ms / hour) + 'h';
  if (ms % min === 0 && ms < hour) return (ms / min) + 'm';
  if (ms % sec === 0 && ms < min) return (ms / sec) + 's';
  if (ms < min) {
    const s = ms / sec;
    return (Number.isInteger(s) ? s : parseFloat(s.toFixed(2))) + 's';
  }
  const parts: string[] = [];
  let rest = ms;
  const d = Math.floor(rest / day);
  if (d) { parts.push(d + 'd'); rest -= d * day; }
  const h = Math.floor(rest / hour);
  if (h) { parts.push(h + 'h'); rest -= h * hour; }
  const m = Math.floor(rest / min);
  if (m && parts.length < FORMAT_MAX_PARTS) { parts.push(m + 'm'); rest -= m * min; }
  if (rest >= 1 && parts.length < FORMAT_MAX_PARTS) {
    const s = rest / sec;
    parts.push((Number.isInteger(s) ? s : parseFloat(s.toFixed(1))) + 's');
  }
  return parts.join(' ') || '0s';
}

/** Caption date (and time if the span is under two days). */
export function formatRange(start: number, end: number): string {
  const a = new Date(start);
  const b = new Date(end - 1);
  const fa = a.getFullYear() + '-' + pad2(a.getMonth() + 1) + '-' + pad2(a.getDate());
  const fb = b.getFullYear() + '-' + pad2(b.getMonth() + 1) + '-' + pad2(b.getDate());
  if (end - start < 2 * MS_DAY) {
    const ta = pad2(a.getHours()) + ':' + pad2(a.getMinutes());
    const tb = pad2(b.getHours()) + ':' + pad2(b.getMinutes());
    if (fa === fb) return fa + ' ' + ta + ' → ' + tb;
    return fa + ' ' + ta + ' → ' + fb + ' ' + tb;
  }
  if (fa === fb) return fa;
  return fa + ' → ' + fb;
}

/** Hover title: local instant of a cell; precision follows cellDur. */
export function formatMoment(t: number, cellDur: number): string {
  const d = new Date(t);
  const date = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  if (!(cellDur < MS_DAY)) return date;
  const hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  if (!(cellDur < MS_MIN)) return date + ' ' + hm;
  const hms = hm + ':' + pad2(d.getSeconds());
  if (!(cellDur < MS_SEC)) return date + ' ' + hms;
  const ms = ((t % 1000) + 1000) % 1000;
  if (!(cellDur < 1)) return date + ' ' + hms + '.' + pad3(Math.floor(ms));
  return date + ' ' + hms + '.' + ms.toFixed(3).padStart(7, '0');
}
