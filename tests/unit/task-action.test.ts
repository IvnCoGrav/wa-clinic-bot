import { describe, it, expect } from 'vitest';
import { resolveTaskAction } from '../../packages/admin-dashboard/src/pages/staff/taskAction';

describe('taskAction — resolveTaskAction', () => {
  const NOW = new Date('2026-10-15T02:00:00.000Z').getTime(); // 09:00 WIB
  const NAV_URL = 'https://maps.google.com/?q=-7.34,112.75';

  it('completed → complete', () => {
    const action = resolveTaskAction({ status: 'completed' });
    expect(action.primary).toBe('complete');
    expect(action.secondary).toBeNull();
  });

  it('arrived → arrive', () => {
    const action = resolveTaskAction({ arrived: true });
    expect(action.primary).toBe('arrive');
    expect(action.secondary).toBeNull();
  });

  it('H-90 → otw', () => {
    const bookingDate = new Date(NOW + 90 * 60000).toISOString();
    const action = resolveTaskAction({ bookingDate, navUrl: NAV_URL, nowMs: NOW });
    expect(action.primary).toBe('otw');
    expect(action.secondary).toBeNull();
  });

  it('H-10 → arrive + secondary otw', () => {
    const bookingDate = new Date(NOW + 10 * 60000).toISOString();
    const action = resolveTaskAction({ bookingDate, navUrl: NAV_URL, nowMs: NOW });
    expect(action.primary).toBe('arrive');
    expect(action.secondary).toBe('otw');
    expect(action.showExtraNav).toBe(true);
  });

  it('H+20 → map tanpa otw', () => {
    const bookingDate = new Date(NOW - 20 * 60000).toISOString();
    const action = resolveTaskAction({ bookingDate, navUrl: NAV_URL, nowMs: NOW });
    expect(action.primary).toBe('map');
    expect(action.secondary).toBeNull();
  });

  it('sudah OTW → map', () => {
    const bookingDate = new Date(NOW + 30 * 60000).toISOString();
    const action = resolveTaskAction({
      bookingDate,
      navUrl: NAV_URL,
      otwSent: true,
      nowMs: NOW,
    });
    expect(action.primary).toBe('map');
    expect(action.secondary).toBeNull();
  });

  it('tanpa navUrl → otw', () => {
    const bookingDate = new Date(NOW + 90 * 60000).toISOString();
    const action = resolveTaskAction({ bookingDate, navUrl: null, nowMs: NOW });
    expect(action.primary).toBe('otw');
    expect(action.secondary).toBeNull();
  });

  it('arrivedAt tercatat → complete', () => {
    const action = resolveTaskAction({ arrivedAt: new Date(NOW - 10 * 60000).toISOString() });
    expect(action.primary).toBe('complete');
    expect(action.secondary).toBeNull();
  });

  it('H-10 tanpa navUrl → arrive tanpa secondary otw', () => {
    const bookingDate = new Date(NOW + 10 * 60000).toISOString();
    const action = resolveTaskAction({ bookingDate, navUrl: null, nowMs: NOW });
    expect(action.primary).toBe('arrive');
    expect(action.secondary).toBeNull();
  });
});
