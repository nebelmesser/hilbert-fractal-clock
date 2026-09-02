import type { ModeId } from '../types';

/** D / M / Y / Unix / Range buttons plus + / − zoom. */
export class PresetBar {
  zoomInBtn: HTMLButtonElement | null = null;
  zoomOutBtn: HTMLButtonElement | null = null;

  /** Render into `root`; callbacks switch mode or step zoom. */
  constructor(
    private root: HTMLElement,
    private onMode: (id: ModeId) => void,
    private onZoom: (dir: number) => void,
  ) {}

  /** Rebuild D / M / Y / Unix / Range, then + / −. */
  render(mode: ModeId): void {
    this.root.innerHTML = '';
    const presets: Array<{ id: ModeId; label: string }> = [
      { id: 'today', label: 'D' },
      { id: 'month', label: 'M' },
      { id: 'year', label: 'Y' },
      { id: 'epoch', label: 'Unix' },
      { id: 'arbitrary', label: 'Range' },
    ];
    presets.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = p.label;
      b.setAttribute('aria-pressed', p.id === mode ? 'true' : 'false');
      b.addEventListener('click', () => this.onMode(p.id));
      this.root.appendChild(b);
    });
    const zoomWrap = document.createElement('div');
    zoomWrap.className = 'zoom-btns';
    this.zoomInBtn = document.createElement('button');
    this.zoomInBtn.type = 'button';
    this.zoomInBtn.innerHTML = '&plus;';
    this.zoomInBtn.setAttribute('aria-label', 'Zoom in');
    this.zoomInBtn.addEventListener('click', () => this.onZoom(-1));
    this.zoomOutBtn = document.createElement('button');
    this.zoomOutBtn.type = 'button';
    this.zoomOutBtn.innerHTML = '&minus;';
    this.zoomOutBtn.setAttribute('aria-label', 'Zoom out');
    this.zoomOutBtn.addEventListener('click', () => this.onZoom(1));
    zoomWrap.appendChild(this.zoomInBtn);
    zoomWrap.appendChild(this.zoomOutBtn);
    this.root.appendChild(zoomWrap);
  }

  /** Disable +/− when that step does not exist. */
  syncButtons(inDisabled: boolean, outDisabled: boolean): void {
    if (this.zoomInBtn) this.zoomInBtn.disabled = inDisabled;
    if (this.zoomOutBtn) this.zoomOutBtn.disabled = outDisabled;
  }
}
