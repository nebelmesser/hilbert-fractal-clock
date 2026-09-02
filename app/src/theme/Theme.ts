import { BOUND_ALPHA_1, BOUND_ALPHA_2, BOUND_ALPHA_3, LABEL_ALPHA, LABEL_EMPTY_ALPHA, PAST_SAT_DIP } from '../constants';
import type { ThemeColors } from '../types';

/** Read map / label / bound colors from :root CSS custom properties. */
export class Theme {
  colors: ThemeColors = {
    past: 0, pastFrom: 0, pastSatDip: PAST_SAT_DIP, future: 0, curPast: 0, curFuture: 0, head: 0, surplus: 0,
    labelAlpha: LABEL_ALPHA, labelEmptyAlpha: LABEL_EMPTY_ALPHA, labelLive: '', labelLiveEmpty: '',
    currentOutline: '', zoom: '',
    bound0: '',
    boundAlpha1: BOUND_ALPHA_1, boundAlpha2: BOUND_ALPHA_2, boundAlpha3: BOUND_ALPHA_3,
  };

  private probe: HTMLCanvasElement | null = null;
  private probeCtx: CanvasRenderingContext2D | null = null;

  /** Computed :root token. */
  cssVar(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /** Numeric :root token, or `fallback` if missing / invalid. */
  cssNumber(name: string, fallback: number): number {
    const n = parseFloat(this.cssVar(name));
    return Number.isFinite(n) ? n : fallback;
  }

  /** CSS color → little-endian 0xAABBGGRR for ImageData. */
  cssPixel(name: string): number {
    if (!this.probe) {
      this.probe = document.createElement('canvas');
      this.probe.width = this.probe.height = 1;
      this.probeCtx = this.probe.getContext('2d', { willReadFrequently: true });
    }
    const ctx = this.probeCtx;
    if (!ctx) return 0;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = this.cssVar(name);
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return (d[3] << 24) | (d[2] << 16) | (d[1] << 8) | d[0];
  }

  /** Pull the current palette from the stylesheet. */
  load(): ThemeColors {
    this.colors = {
      past: this.cssPixel('--past'),
      pastFrom: this.cssPixel('--past-from'),
      pastSatDip: this.cssNumber('--past-sat-dip', PAST_SAT_DIP),
      future: this.cssPixel('--future'),
      curPast: this.cssPixel('--cur-past'),
      curFuture: this.cssPixel('--cur-future'),
      head: this.cssPixel('--head'),
      surplus: this.cssPixel('--surplus'),
      labelAlpha: this.cssNumber('--label-alpha', LABEL_ALPHA),
      labelEmptyAlpha: this.cssNumber('--label-empty-alpha', LABEL_EMPTY_ALPHA),
      labelLive: this.cssVar('--label-live'),
      labelLiveEmpty: this.cssVar('--label-live-empty'),
      currentOutline: this.cssVar('--current-outline'),
      zoom: this.cssVar('--zoom'),
      bound0: this.cssVar('--bound-0'),
      boundAlpha1: this.cssNumber('--bound-1-alpha', BOUND_ALPHA_1),
      boundAlpha2: this.cssNumber('--bound-2-alpha', BOUND_ALPHA_2),
      boundAlpha3: this.cssNumber('--bound-3-alpha', BOUND_ALPHA_3),
    };
    return this.colors;
  }
}
