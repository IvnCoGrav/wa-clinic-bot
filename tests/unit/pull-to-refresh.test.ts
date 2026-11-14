import { describe, it, expect } from 'vitest';
import {
  applyPullResistance,
  shouldTriggerRefresh,
  pullProgress,
  canStartPull,
  pullToRefreshAriaLabel,
  PULL_THRESHOLD_PX,
  PULL_MAX_PX,
  PULL_COOLDOWN_MS,
} from '../../packages/admin-dashboard/src/utils/pullToRefresh';

describe('pullToRefresh — logika gestur swipe-down', () => {
  it('hambatan & batas maksimum jarak visual', () => {
    expect(applyPullResistance(100)).toBeCloseTo(55, 5);
    expect(applyPullResistance(10000)).toBe(PULL_MAX_PX);
  });

  it('delta negatif / tidak valid dianggap 0', () => {
    expect(applyPullResistance(-40)).toBe(0);
    expect(applyPullResistance(Number.NaN)).toBe(0);
  });

  it('refresh hanya terpicu setelah ambang', () => {
    expect(shouldTriggerRefresh(PULL_THRESHOLD_PX - 1)).toBe(false);
    expect(shouldTriggerRefresh(PULL_THRESHOLD_PX)).toBe(true);
  });

  it('progress 0..1 untuk rotasi ikon', () => {
    expect(pullProgress(0)).toBe(0);
    expect(pullProgress(PULL_THRESHOLD_PX / 2)).toBeCloseTo(0.5, 5);
    expect(pullProgress(PULL_THRESHOLD_PX * 3)).toBe(1);
  });

  it('cooldown menolak gestur segera setelah refresh', () => {
    const now = 1_000_000;
    expect(canStartPull(now, now + PULL_COOLDOWN_MS)).toBe(false);
    expect(canStartPull(now + PULL_COOLDOWN_MS, now + PULL_COOLDOWN_MS)).toBe(true);
  });

  it('label aksesibilitas mengikuti fase (visual hanya ikon)', () => {
    expect(pullToRefreshAriaLabel('idle')).toBe('');
    expect(pullToRefreshAriaLabel('pulling')).toBe('Tarik untuk memperbarui');
    expect(pullToRefreshAriaLabel('armed')).toBe('Lepas untuk memperbarui');
    expect(pullToRefreshAriaLabel('refreshing')).toBe('Memuat data terbaru');
    expect(pullToRefreshAriaLabel('done')).toBe('Data sudah diperbarui');
  });
});
