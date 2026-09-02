/** Sign of a Hilbert walk axis: +1, −1, or 0. */
export function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/** Inclusive clamp to [a, b]. */
export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

/** Zero-pad a number to two digits (hours 00–23). */
export function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

/** Zero-pad a number to three digits (milliseconds 000–999). */
export function pad3(n: number): string {
  return n < 10 ? '00' + n : n < 100 ? '0' + n : String(n);
}

/** Typical region size; fragments below a fraction of this are skipped. */
export function median(values: number[]): number {
  if (!values.length) return 0;
  const a = values.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
