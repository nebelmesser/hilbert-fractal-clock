import { describe, expect, it } from 'vitest';
import { civilDate, nextPeriodColor, PERIOD_PALETTE, PERIODS_KEY, PeriodStore, periodRange, validatePeriod, type LifePeriod } from './PeriodStore';

const period: LifePeriod = { id: 'one', label: 'Учёба', from: '2026-10-18', to: '2026-10-18', color: '#91b9a4' };
const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
};

describe('personal period dates and persistence', () => {
  it('includes a full end day, accepts future dates and rejects invalid civil dates', () => {
    const range = periodRange(period);
    expect(new Date(range.end).getDate()).toBe(19);
    expect(range.start).toBe(civilDate('2026-10-18'));
    expect(validatePeriod({ ...period, from: '2030-01-01', to: '2031-01-01' })).not.toBeNull();
    expect(validatePeriod({ ...period, from: '2026-02-30' })).toBeNull();
    expect(validatePeriod({ ...period, to: '2026-10-17' })).toBeNull();
    expect(Number.isNaN(civilDate('0000-01-01'))).toBe(true);
    expect(new Date(civilDate('0099-01-01')).getFullYear()).toBe(99);
  });

  it('normalizes labels and enforces the 32-character limit, including non-BMP text', () => {
    expect(validatePeriod({ ...period, label: '  First\n  job  ' })?.label).toBe('First job');
    expect(validatePeriod({ ...period, label: 'я'.repeat(33) })).toBeNull();
    expect(validatePeriod({ ...period, label: '😀'.repeat(32) })).not.toBeNull();
    expect(validatePeriod({ ...period, label: ' ' })).toBeNull();
    expect(validatePeriod({ ...period, color: 'url(evil)' })).toBeNull();
  });

  it('round-trips without frame state and filters corrupt, duplicate and unsupported records', () => {
    const mem = memory();
    const store = new PeriodStore(mem);
    expect(store.save([period])).toBe(true);
    expect(store.load()).toEqual([period]);
    mem.setItem(PERIODS_KEY, JSON.stringify({ version: 1, periods: [period, period, { ...period, id: 'bad', to: '' }] }));
    expect(store.load()).toEqual([period]);
    expect(store.save([period, period])).toBe(false);
    mem.setItem(PERIODS_KEY, '{broken');
    expect(store.load()).toEqual([]);
    mem.setItem(PERIODS_KEY, JSON.stringify({ version: 2, periods: [period] }));
    expect(store.load()).toEqual([]);
    expect(new PeriodStore(null).save([period])).toBe(false);
  });

  it('uses every default color before repeating one, then picks a least-used color', () => {
    const periods: LifePeriod[] = [];
    for (let i = 0; i < PERIOD_PALETTE.length; i++) periods.push({ ...period, id: String(i), color: nextPeriodColor(periods) });
    expect(new Set(periods.map((p) => p.color)).size).toBe(PERIOD_PALETTE.length);
    const next = nextPeriodColor(periods);
    periods.push({ ...period, id: 'extra', color: next });
    expect(nextPeriodColor(periods)).not.toBe(next);
  });
});
