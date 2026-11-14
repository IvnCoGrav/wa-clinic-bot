import { describe, it, expect } from 'vitest';
import {
  applyPullResistance,
  shouldTriggerRefresh,
  pullToRefreshLabel,
  PULL_THRESHOLD_PX,
  PULL_MAX_PX,
} from '../../packages/admin-dashboard/src/utils/pullToRefresh';

describe('pullToRefresh — logika gestur swipe-down', () => {
  it('hambatan 0.5 dan batas maksimum', () => {
    expect(applyPullResistance(100)).toBe(50);
    expect(applyPullResistance(1000)).toBe(PULL_MAX_PX);
  });

  it('delta negatif / tidak valid dianggap 0 (tidak menarik)', () => {
    expect(applyPullResistance(-40)).toBe(0);
    expect(applyPullResistance(Number.NaN)).toBe(0);
  });

  it('refresh hanya terpicu setelah ambang', () => {
    expect(shouldTriggerRefresh(PULL_THRESHOLD_PX - 1)).toBe(false);
    expect(shouldTriggerRefresh(PULL_THRESHOLD_PX)).toBe(true);
    expect(shouldTriggerRefresh(PULL_THRESHOLD_PX + 20)).toBe(true);
  });

  it('label indikator mengikuti fase', () => {
    expect(pullToRefreshLabel(0, false)).toBe('');
    expect(pullToRefreshLabel(10, false)).toBe('Tarik untuk refresh');
    expect(pullToRefreshLabel(PULL_THRESHOLD_PX, false)).toBe('Lepas untuk refresh');
    expect(pullToRefreshLabel(0, true)).toBe('Memuat data terbaru…');
  });
});
