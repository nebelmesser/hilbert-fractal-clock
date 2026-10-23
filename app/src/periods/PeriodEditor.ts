import { localDateValue } from '../time/calendar';
import { civilDate, PERIOD_LABEL_MAX, PERIOD_PALETTE, PeriodStore, nextPeriodColor, validatePeriod, type LifePeriod } from './PeriodStore';

type Entry = { value: LifePeriod; saved: LifePeriod | null };

export function nextPeriodDate(previousEnd?: string): string {
  if (!previousEnd || !Number.isFinite(civilDate(previousEnd))) return localDateValue(Date.now());
  const date = new Date(civilDate(previousEnd));
  date.setDate(date.getDate() + 1);
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Each row is editable. Valid changes save without rebuilding inputs or moving focus. */
export class PeriodEditor {
  private entries: Entry[];
  private undo: Entry[] | null = null;

  constructor(private root: Document, private store: PeriodStore) {
    this.entries = store.load().map((value) => ({ value, saved: { ...value } }));
    this.el('period-add').addEventListener('click', () => this.add());
    this.render();
  }

  private el(id: string): HTMLElement { return this.root.getElementById(id)!; }

  private node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
    const node = this.root.createElement(tag);
    node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  private saved(entries = this.entries): LifePeriod[] { return entries.flatMap((entry) => entry.saved ? [entry.saved] : []); }

  private add(): void {
    const from = nextPeriodDate(this.entries.at(-1)?.value.to);
    const value = { id: crypto.randomUUID(), label: '', from, to: from, color: nextPeriodColor(this.entries.map((e) => e.value)) };
    const entry = { value, saved: null };
    this.entries.push(entry);
    this.undo = null;
    this.el('period-status').replaceChildren();
    this.el('period-list').append(this.row(entry));
    this.updateCount();
    this.root.querySelector<HTMLInputElement>(`[data-id="${value.id}"] input[name="label"]`)!.focus();
  }

  private updateCount(): void {
    this.el('period-total').textContent = String(this.entries.length);
    this.el('period-empty').hidden = this.entries.length > 0;
  }

  private row(entry: Entry): HTMLLIElement {
    const row = this.node('li', 'period-row');
    const form = this.node('form', 'period-inline');
    form.dataset.id = entry.value.id;
    const error = this.node('p', 'period-row-error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const field = (name: string, title: string, type: string, value: string) => {
      const label = this.node('label', `period-inline-field period-field-${name}`);
      const caption = this.node('span', 'period-input-caption', title);
      const input = this.node('input');
      input.name = name; input.type = type; input.value = value; input.required = true;
      input.setAttribute('aria-label', title);
      if (type === 'date') { input.min = '0001-01-01'; input.max = '9999-12-31'; }
      label.append(caption, input);
      return { label, input };
    };
    const label = field('label', 'Label', 'text', entry.value.label);
    label.input.autocomplete = 'off';
    const counter = this.node('span', 'period-label-count');
    label.label.append(counter);
    const from = field('from', 'From', 'date', entry.value.from);
    const to = field('to', 'To', 'date', entry.value.to);
    const picker = this.node('details', 'period-color-picker');
    const summary = this.node('summary', 'period-color-summary');
    summary.title = 'Choose color';
    summary.setAttribute('aria-label', 'Choose color');
    const palette = this.node('div', 'period-color-options');
    const swatches = this.node('div', 'period-palette');
    const custom = this.node('label', 'custom-color');
    const color = this.node('input');
    color.type = 'color'; color.name = 'color'; color.value = entry.value.color;
    color.setAttribute('aria-label', 'Custom color');
    custom.append(color, this.node('span', '', 'Custom color'));
    palette.append(swatches, custom); picker.append(summary, palette);
    const refresh = () => {
      counter.textContent = `${Array.from(label.input.value).length}/${PERIOD_LABEL_MAX}`;
      summary.style.setProperty('--swatch', color.value);
      for (const button of swatches.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.color === color.value));
    };
    const save = (showErrors: boolean) => {
      entry.value = { ...entry.value, label: label.input.value, from: from.input.value, to: to.input.value, color: color.value };
      to.input.setCustomValidity(from.input.value && to.input.value && from.input.value > to.input.value ? 'The end date must be on or after the start date.' : '');
      refresh();
      const clean = validatePeriod(entry.value);
      if (!clean || !form.checkValidity()) {
        if (showErrors) {
          error.textContent = 'Enter a label and a valid date range. The last saved values are kept until then.';
          error.hidden = false;
        }
        return;
      }
      if (JSON.stringify(clean) === JSON.stringify(entry.saved)) { error.hidden = true; return; }
      const next = this.entries.flatMap((e) => e === entry ? [clean] : e.saved ? [e.saved] : []);
      if (!this.store.save(next)) {
        error.textContent = 'Could not save changes in this browser.';
        error.hidden = false;
        return;
      }
      entry.saved = clean;
      error.hidden = true;
      this.undo = null;
      this.el('period-status').textContent = 'Saved.';
    };
    label.input.addEventListener('input', () => {
      label.input.value = Array.from(label.input.value).slice(0, PERIOD_LABEL_MAX).join('');
      save(false);
    });
    for (const input of [label.input, from.input, to.input]) input.addEventListener('change', () => save(true));
    for (const input of [from.input, to.input]) input.addEventListener('input', () => {
      to.input.setCustomValidity('');
      entry.value = { ...entry.value, from: from.input.value, to: to.input.value };
    });
    color.addEventListener('input', () => save(false));
    for (const entry of PERIOD_PALETTE) {
      const button = this.node('button', 'period-swatch');
      button.type = 'button'; button.title = entry.name;
      button.dataset.color = entry.color;
      button.style.setProperty('--swatch', entry.color);
      button.setAttribute('aria-label', entry.name);
      button.addEventListener('click', () => { color.value = entry.color; save(false); picker.open = false; });
      swatches.append(button);
    }
    const remove = this.node('button', 'period-remove', 'Remove');
    remove.type = 'button';
    remove.addEventListener('click', () => this.remove(entry));
    form.addEventListener('submit', (event) => { event.preventDefault(); save(true); form.reportValidity(); });
    form.append(picker, label.label, from.label, to.label, remove);
    row.append(form, error);
    refresh();
    return row;
  }

  private remove(entry: Entry): void {
    const next = this.entries.filter((e) => e !== entry);
    if (entry.saved && !this.store.save(this.saved(next))) { this.showError(); return; }
    this.undo = this.entries.map((e) => ({ value: { ...e.value }, saved: e.saved ? { ...e.saved } : null }));
    this.entries = next;
    this.render();
    const status = this.el('period-status');
    status.textContent = 'Period removed. ';
    const button = this.node('button', 'period-undo', 'Undo');
    button.type = 'button';
    button.addEventListener('click', () => {
      if (!this.undo) return;
      const records = this.saved(this.undo);
      if (JSON.stringify(records) !== JSON.stringify(this.saved()) && !this.store.save(records)) { this.showError(); return; }
      this.entries = this.undo; this.undo = null;
      this.render();
      status.textContent = 'Period restored.';
    });
    status.append(button);
  }

  private showError(): void {
    const error = this.el('period-error');
    error.textContent = 'Could not save changes in this browser.';
    error.hidden = false;
  }

  private render(): void {
    this.el('period-list').replaceChildren(...this.entries.map((entry) => this.row(entry)));
    this.el('period-error').hidden = true;
    this.updateCount();
  }
}
