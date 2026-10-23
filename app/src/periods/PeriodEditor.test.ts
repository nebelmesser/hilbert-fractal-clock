// @vitest-environment jsdom
import shell from '../../periods.html?raw';
import { beforeEach, describe, expect, it } from 'vitest';
import { PeriodEditor, nextPeriodDate } from './PeriodEditor';
import { PeriodStore, type LifePeriod } from './PeriodStore';

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
};
let storage = memory();
const rows = () => [...document.querySelectorAll<HTMLFormElement>('.period-inline')];
const field = (row: number, name: string) => rows()[row].querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
const input = (row: number, name: string, value: string) => {
  const element = field(row, name);
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
};
const add = () => (document.getElementById('period-add') as HTMLButtonElement).click();
const first: LifePeriod = { id: 'first', label: 'Учёба', from: '2020-01-01', to: '2024-02-28', color: '#91b9a4' };

beforeEach(() => {
  document.documentElement.innerHTML = shell;
  storage = memory();
});

describe('inline period editor', () => {
  it('edits rows without replacing inputs, saves each valid change and supports remove/undo', () => {
    const store = new PeriodStore(storage);
    store.save([first]);
    new PeriodEditor(document, store);
    const originalInput = field(0, 'label');
    input(0, 'label', 'Работа'); input(0, 'color', '#123456');
    expect(store.load()).toMatchObject([{ id: first.id, label: 'Работа', color: '#123456' }]);
    expect(field(0, 'label')).toBe(originalInput);
    rows()[0].querySelector<HTMLButtonElement>('.period-remove')!.click();
    expect(store.load()).toEqual([]);
    expect(document.getElementById('period-empty')!.hidden).toBe(false);
    document.querySelector<HTMLButtonElement>('.period-undo')!.click();
    expect(store.load()[0].id).toBe(first.id);
    expect(field(0, 'label').value).toBe('Работа');
  });

  it('starts a new row the day after the previous row and does not save an unnamed draft', () => {
    const store = new PeriodStore(storage);
    store.save([first]);
    new PeriodEditor(document, store);
    add();
    expect(field(1, 'from').value).toBe('2024-02-29');
    expect(field(1, 'to').value).toBe('2024-02-29');
    expect(store.load()).toHaveLength(1);
    input(1, 'label', 'Новый период');
    expect(store.load()).toHaveLength(2);
    expect(store.load()[1].color).not.toBe(first.color);
    add();
    expect(field(2, 'from').value).toBe('2024-03-01');
    expect(nextPeriodDate('2026-12-31')).toBe('2027-01-01');
  });

  it('limits Unicode labels and keeps the saved interval while an edited range is invalid', () => {
    const store = new PeriodStore(storage);
    store.save([first]);
    new PeriodEditor(document, store);
    input(0, 'label', '😀'.repeat(35));
    expect(Array.from(store.load()[0].label)).toHaveLength(32);
    expect(document.querySelector('.period-label-count')!.textContent).toBe('32/32');
    input(0, 'from', '2030-01-02');
    expect(store.load()[0].from).toBe(first.from);
    expect(document.querySelector<HTMLElement>('.period-row-error')!.hidden).toBe(false);
    input(0, 'to', '2030-01-02');
    expect(store.load()[0].from).toBe('2030-01-02');
    expect(document.querySelector<HTMLElement>('.period-row-error')!.hidden).toBe(true);
  });

  it('keeps a failed edit visible and reports storage failure', () => {
    const store = new PeriodStore({ getItem: () => null, setItem: () => { throw new Error('quota'); } });
    new PeriodEditor(document, store);
    add(); input(0, 'label', '<b>Text</b>');
    expect(document.querySelector<HTMLElement>('.period-row-error')!.hidden).toBe(false);
    expect(field(0, 'label').value).toBe('<b>Text</b>');
    expect(document.querySelectorAll('b')).toHaveLength(0);
    expect(store.load()).toEqual([]);
  });
});
