import { CHROME_DBL_MS, CHROME_DBL_PX } from '../constants';

/** F-mode: hide the top bar and captions. Session only — not persisted. */
export class ChromeController {
  hidden = false;
  private dblAt = 0;
  private dblX = 0;
  private dblY = 0;
  private dblType = '';

  /** Double-click / double-tap a panel toggles F. */
  constructor(
    private stackEl: HTMLElement,
    private onToggle: (hidden: boolean) => void,
  ) {
    stackEl.addEventListener('pointerdown', (e) => this.onPointerDown(e), { passive: false });
  }

  /** Hide D/M/Y bar and rebuild the maps into the freed space. */
  setHidden(on: boolean): void {
    this.hidden = !!on;
    document.body.classList.toggle('chrome-hidden', this.hidden);
    this.onToggle(this.hidden);
  }

  /** Flip chrome visibility. */
  toggle(): void {
    this.setHidden(!this.hidden);
  }

  /** Double-click or double-tap a panel = F; ignore ghost mouse after touch. */
  private onPointerDown(e: PointerEvent): void {
    if (!e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!(e.target as Element).closest('.map-block')) return;
    if (e.pointerType === 'mouse' && this.dblType === 'touch' &&
        (e.timeStamp - this.dblAt) < 700) return;
    const dt = e.timeStamp - this.dblAt;
    const dist = Math.hypot(e.clientX - this.dblX, e.clientY - this.dblY);
    if (this.dblAt && this.dblType === e.pointerType && dt <= CHROME_DBL_MS && dist <= CHROME_DBL_PX) {
      this.dblAt = 0;
      this.dblType = '';
      e.preventDefault();
      this.toggle();
      return;
    }
    this.dblAt = e.timeStamp;
    this.dblX = e.clientX;
    this.dblY = e.clientY;
    this.dblType = e.pointerType;
  }
}
