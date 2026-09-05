import { describe, expect, it } from 'vitest';
import { formatDayClock, OVERLAY_FIT, topClockAnchors } from './dayOverlay';

describe('dayOverlay', () => {
  it('formats local HH:mm', () => {
    expect(formatDayClock(new Date(2026, 7, 5, 15, 35, 40).getTime())).toBe('15:35');
    expect(formatDayClock(new Date(2026, 7, 5, 9, 5, 0).getTime())).toBe('09:05');
  });

  it('fits the top overlay to a fixed wide mask, not the live digits', () => {
    expect(OVERLAY_FIT).toBe('88:88');
    expect(OVERLAY_FIT.length).toBe(formatDayClock(0).length);
  });

  it('pins the colon to the panel center', () => {
    expect(topClockAnchors(400, 20)).toEqual({ hhX: 390, colonX: 400, mmX: 410 });
  });
});
