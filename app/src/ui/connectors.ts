import { INSET_FRAME_OUT } from '../constants';
import type { Slot } from '../layout/FitLayout';

/** Two leaders: outer yellow frame → outer inset frame. */
export function drawAllConnectors(stage: HTMLElement, connectors: SVGSVGElement, stackEl: HTMLElement, slots: Slot[]): void {
  const svgNS = 'http://www.w3.org/2000/svg';
  while (connectors.firstChild) connectors.removeChild(connectors.firstChild);
  const stageRect = stage.getBoundingClientRect();
  connectors.setAttribute('viewBox', '0 0 ' + stageRect.width + ' ' + stageRect.height);
  connectors.setAttribute('width', String(stageRect.width));
  connectors.setAttribute('height', String(stageRect.height));
  const parentOut = INSET_FRAME_OUT;
  for (let i = 0; i < slots.length - 1; i++) {
    const a = slots[i];
    const b = slots[i + 1];
    if (a.block.style.display === 'none' || b.block.style.display === 'none') continue;
    const box = a.map.zoomBox;
    if (!box || !a.map.layout) continue;
    const grid = a.map.layout.grid;
    const mainPaint = a.map.base.getBoundingClientRect();
    const insetPaint = b.map.base.getBoundingClientRect();
    const cw = mainPaint.width / grid.w;
    const ch = mainPaint.height / grid.h;
    const ox = mainPaint.left - stageRect.left;
    const oy = mainPaint.top - stageRect.top;
    const L = ox + box.x * cw - parentOut;
    const T = oy + box.y * ch - parentOut;
    const R = ox + (box.x + box.w) * cw + parentOut;
    const B = oy + (box.y + box.h) * ch + parentOut;
    const iL = insetPaint.left - stageRect.left - parentOut;
    const iT = insetPaint.top - stageRect.top - parentOut;
    const iR = insetPaint.right - stageRect.left + parentOut;
    const iB = insetPaint.bottom - stageRect.top + parentOut;
    const side = stackEl.classList.contains('fit-row');
    const corners = side ? [
      [R, T, iL, iT],
      [R, B, iL, iB],
    ] : [
      [L, B, iL, iT],
      [R, B, iR, iT],
    ];
    for (let k = 0; k < corners.length; k++) {
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', String(corners[k][0]));
      line.setAttribute('y1', String(corners[k][1]));
      line.setAttribute('x2', String(corners[k][2]));
      line.setAttribute('y2', String(corners[k][3]));
      connectors.appendChild(line);
    }
  }
}
