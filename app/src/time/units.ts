import { MONTHS, MS_10, MS_100, MS_DAY, MS_HOUR, MS_MIN, MS_SEC } from '../constants';
import { pad2 } from '../math';
import type { TimeUnit } from '../types';
import {
  daySerial,
  startOfCentury,
  startOfDay,
  startOfHour,
  startOfMinute,
  startOfMonth,
  startOfSecond,
  startOfYear,
} from './calendar';
import { ordinalDay, romanNumeral } from './format';

/** Boundary ladder, coarse → fine. No weeks. */
export const UNITS: TimeUnit[] = [
  {
    id: 'century', typical: 100 * 365.2425 * MS_DAY,
    index: (t) => Math.floor(new Date(t).getFullYear() / 100),
    start: (t) => startOfCentury(new Date(t)),
    end: (t) => {
      const d = new Date(t);
      return new Date(Math.floor(d.getFullYear() / 100) * 100 + 100, 0, 1).getTime();
    },
    label: (t) => romanNumeral(Math.floor(new Date(t).getFullYear() / 100) + 1),
  },
  {
    id: 'year', typical: 365.2425 * MS_DAY,
    index: (t) => new Date(t).getFullYear(),
    start: (t) => startOfYear(new Date(t)),
    end: (t) => {
      const d = new Date(t);
      return new Date(d.getFullYear() + 1, 0, 1).getTime();
    },
    label: (t) => String(new Date(t).getFullYear()),
  },
  {
    id: 'month', typical: 30.436875 * MS_DAY,
    index: (t) => {
      const d = new Date(t);
      return d.getFullYear() * 12 + d.getMonth();
    },
    start: (t) => startOfMonth(new Date(t)),
    end: (t) => {
      const d = new Date(t);
      return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    },
    label: (t) => MONTHS[new Date(t).getMonth()],
  },
  {
    id: 'day', typical: MS_DAY,
    index: (t) => daySerial(new Date(t)),
    start: (t) => startOfDay(new Date(t)),
    end: (t) => {
      const d = new Date(t);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    },
    label: (t) => ordinalDay(new Date(t).getDate()),
  },
  {
    id: 'hour', typical: MS_HOUR,
    index: (t) => {
      const d = new Date(t);
      return daySerial(d) * 24 + d.getHours();
    },
    start: (t) => startOfHour(new Date(t)),
    end: (t) => {
      const d = new Date(t);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
    },
    label: (t) => pad2(new Date(t).getHours()),
  },
  {
    id: 'minute', typical: MS_MIN,
    index: (t) => {
      const d = new Date(t);
      return (daySerial(d) * 24 + d.getHours()) * 60 + d.getMinutes();
    },
    start: (t) => startOfMinute(new Date(t)),
    end: (t) => {
      const d = new Date(t);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes() + 1).getTime();
    },
    label: (t) => pad2(new Date(t).getHours()) + ':' + pad2(new Date(t).getMinutes()),
  },
  {
    id: 'second', typical: MS_SEC,
    index: (t) => Math.floor(t / 1000),
    start: (t) => startOfSecond(new Date(t)),
    end: (t) => startOfSecond(new Date(t)) + MS_SEC,
    label: (t) => {
      const d = new Date(t);
      return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    },
  },
  {
    id: 'ms100', typical: MS_100,
    index: (t) => Math.floor(t / MS_100),
    start: (t) => Math.floor(t / MS_100) * MS_100,
    end: (t) => Math.floor(t / MS_100) * MS_100 + MS_100,
    label: (t) => ((t % MS_SEC) / MS_100 | 0) + '0cs',
  },
  {
    id: 'ms10', typical: MS_10,
    index: (t) => Math.floor(t / MS_10),
    start: (t) => Math.floor(t / MS_10) * MS_10,
    end: (t) => Math.floor(t / MS_10) * MS_10 + MS_10,
    label: (t) => pad2(t % MS_SEC) + 'ms',
  },
  {
    id: 'ms1', typical: 1,
    index: (t) => Math.floor(t),
    start: (t) => Math.floor(t),
    end: (t) => Math.floor(t) + 1,
    label: (t) => (t % MS_SEC | 0) + 'ms',
  },
];

/** Unit index at each cell midpoint, for boundary and label grouping. */
export function fillUnitIds(unit: TimeUnit, cellDur: number, n: number, cellStart: Float64Array): Int32Array {
  const ids = new Int32Array(n);
  for (let i = 0; i < n; i++) ids[i] = unit.index(cellStart[i] + cellDur * 0.5);
  return ids;
}
