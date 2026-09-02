import type { ThemeColors } from '../types';

/** Read map / label / bound colors from :root CSS custom properties. */
export class Theme {
  colors: ThemeColors = {
    past: 0, future: 0, curPast: 0, curFuture: 0, head: 0, surplus: 0,
    label: '', labelEmpty: '', labelLive: '', labelLiveEmpty: '',
    currentOutline: '', zoom: '',
    bound0: '', bound1: '', bound2: '', bound3: '',
  };

  private probe: HTMLCanvasElement | null = null;
  private probeCtx: CanvasRenderingContext2D | null = null;

  /** Computed :root token. */
  cssVar(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
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
      future: this.cssPixel('--future'),
      curPast: this.cssPixel('--cur-past'),
      curFuture: this.cssPixel('--cur-future'),
      head: this.cssPixel('--head'),
      surplus: this.cssPixel('--surplus'),
      label: this.cssVar('--label'),
      labelEmpty: this.cssVar('--label-empty'),
      labelLive: this.cssVar('--label-live'),
      labelLiveEmpty: this.cssVar('--label-live-empty'),
      currentOutline: this.cssVar('--current-outline'),
      zoom: this.cssVar('--zoom'),
      bound0: this.cssVar('--bound-0'),
      bound1: this.cssVar('--bound-1'),
      bound2: this.cssVar('--bound-2'),
      bound3: this.cssVar('--bound-3'),
    };
    return this.colors;
  }
}
