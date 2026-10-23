export const PERIODS_KEY = 'clock-hilbert-periods';
export const PERIOD_LABEL_MAX = 32;

/** Muted, distinct starting points; every period can also use a custom color. */
export const PERIOD_PALETTE = [
  { name: 'Sage', color: '#91b9a4' },
  { name: 'Lavender', color: '#b4a1ce' },
  { name: 'Apricot', color: '#d7ac86' },
  { name: 'Sky', color: '#8db3cf' },
  { name: 'Rose', color: '#cf9daa' },
  { name: 'Sand', color: '#c5be8c' },
  { name: 'Teal', color: '#80bab9' },
  { name: 'Lilac', color: '#c79ac3' },
  { name: 'Olive', color: '#a7b783' },
  { name: 'Clay', color: '#cd9b87' },
] as const;

export type LifePeriod = {
  id: string;
  label: string;
  from: string;
  to: string;
  color: string;
};

/** Civil dates stay strings in storage; resolve them in the clock's local calendar. */
export function civilDate(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return NaN;
  const [, year, month, day] = match.map(Number);
  if (year < 1) return NaN;
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date.getTime() : NaN;
}

/** Inclusive end date, including 23/25-hour days at daylight-saving transitions. */
export function periodRange(period: LifePeriod): { start: number; end: number } {
  const end = new Date(civilDate(period.to));
  end.setDate(end.getDate() + 1);
  return { start: civilDate(period.from), end: end.getTime() };
}

export function validatePeriod(value: unknown): LifePeriod | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (typeof p.id !== 'string' || !/^[\w-]{1,100}$/.test(p.id) ||
      typeof p.label !== 'string' || typeof p.from !== 'string' ||
      typeof p.to !== 'string' || typeof p.color !== 'string') return null;
  const label = p.label.replace(/\s+/gu, ' ').trim();
  if (!label || Array.from(label).length > PERIOD_LABEL_MAX ||
      !/^#[\da-f]{6}$/i.test(p.color) ||
      !Number.isFinite(civilDate(p.from)) || !Number.isFinite(civilDate(p.to)) || p.from > p.to) return null;
  return { id: p.id, label, from: p.from, to: p.to, color: p.color.toLowerCase() };
}

export function nextPeriodColor(periods: readonly LifePeriod[]): string {
  let best: string = PERIOD_PALETTE[0].color;
  let least = Infinity;
  for (const { color } of PERIOD_PALETTE) {
    const count = periods.filter((p) => p.color === color).length;
    if (count < least) { best = color; least = count; }
  }
  return best;
}

/** Separate from the frame: changing Range never changes someone's life dates. */
export class PeriodStore {
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'> | null) {}

  load(): LifePeriod[] {
    try {
      const data = JSON.parse(this.storage?.getItem(PERIODS_KEY) || 'null');
      if (data?.version !== 1 || !Array.isArray(data.periods)) return [];
      const seen = new Set<string>();
      return data.periods.flatMap((raw: unknown) => {
        const period = validatePeriod(raw);
        if (!period || seen.has(period.id)) return [];
        seen.add(period.id);
        return [period];
      });
    } catch { return []; }
  }

  save(periods: readonly LifePeriod[]): boolean {
    if (!this.storage) return false;
    const clean = periods.map(validatePeriod);
    if (clean.some((p) => !p) || new Set(clean.map((p) => p!.id)).size !== clean.length) return false;
    try {
      this.storage.setItem(PERIODS_KEY, JSON.stringify({ version: 1, periods: clean }));
      return true;
    } catch { return false; }
  }
}
