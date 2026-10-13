import { describe, it, expect } from 'vitest';
import { getSharelocCardStatus } from '../../packages/admin-dashboard/src/utils/sharelocCardStatus';

describe('Shareloc Card Status (Frontend Mirror / Pure Utility)', () => {
  const fixedNow = new Date('2026-10-13T10:00:00+07:00');

  it('mengembalikan needed=false jika tidak ada reservasi aktif', () => {
    const status = getSharelocCardStatus({
      conversationId: 'conv-1',
      activeConfirmedReservation: null,
      activeHoldReservation: null,
      locationSource: 'estimated_area',
    }, fixedNow);

    expect(status.needed).toBe(false);
    expect(status.reason).toBe('no_active_reservation');
    expect(status.label).toBeNull();
  });

  it('mengembalikan needed=false jika lokasi sudah presisi (gps_pin / url_coords / bidan_shareloc)', () => {
    const statusGps = getSharelocCardStatus({
      conversationId: 'conv-1',
      activeConfirmedReservation: {
        id: 'res-1',
        booking_date: '2026-10-13T14:00:00+07:00',
      },
      locationSource: 'gps_pin',
      shareLocationSent: true,
    }, fixedNow);

    expect(statusGps.needed).toBe(false);
    expect(statusGps.reason).toBe('already_precise');

    const statusCoords = getSharelocCardStatus({
      conversationId: 'conv-2',
      activeConfirmedReservation: {
        id: 'res-2',
        booking_date: '2026-10-13T14:00:00+07:00',
      },
      locationSource: 'url_coords',
    }, fixedNow);

    expect(statusCoords.needed).toBe(false);
    expect(statusCoords.reason).toBe('already_precise');
  });

  it('mengembalikan needed=false jika dalam masa cooldown < 6 jam sejak sharelocRequestedAt', () => {
    // Diminta 3 jam lalu
    const reqAt = new Date(fixedNow.getTime() - 3 * 3600 * 1000).toISOString();

    const status = getSharelocCardStatus({
      conversationId: 'conv-1',
      activeConfirmedReservation: {
        id: 'res-1',
        booking_date: '2026-10-13T14:00:00+07:00',
      },
      locationSource: 'estimated_area',
      sharelocRequestedAt: reqAt,
    }, fixedNow);

    expect(status.needed).toBe(false);
    expect(status.reason).toBe('cooldown_6h');
  });

  it('mengembalikan needed=true dan urgent=true untuk reservasi same-day (hari ini WIB)', () => {
    const status = getSharelocCardStatus({
      conversationId: 'conv-1',
      activeConfirmedReservation: {
        id: 'res-1',
        booking_date: '2026-10-13T15:00:00+07:00',
      },
      locationSource: 'estimated_area',
      shareLocationSent: false,
    }, fixedNow);

    expect(status.needed).toBe(true);
    expect(status.urgent).toBe(true);
    expect(status.reason).toBe('same_day');
    expect(status.label).toBe('📍 Butuh Shareloc (Hari Ini)');
    expect(status.borderClass).toContain('border-l-orange-500');
  });

  it('mengembalikan needed=true dan urgent=false untuk reservasi masa depan (advance booking)', () => {
    const status = getSharelocCardStatus({
      conversationId: 'conv-1',
      activeConfirmedReservation: {
        id: 'res-1',
        booking_date: '2026-10-16T10:00:00+07:00',
      },
      locationSource: 'estimated_area',
      shareLocationSent: false,
    }, fixedNow);

    expect(status.needed).toBe(true);
    expect(status.urgent).toBe(false);
    expect(status.reason).toBe('advance_due');
    expect(status.label).toBe('📍 Butuh Shareloc');
    expect(status.borderClass).toContain('border-l-amber-500');
  });

  it('bekerja juga untuk activeHoldReservation', () => {
    const status = getSharelocCardStatus({
      conversationId: 'conv-1',
      activeHoldReservation: {
        id: 'hold-1',
        booking_date: '2026-10-13T16:00:00+07:00',
      },
      locationSource: 'estimated_area',
      shareLocationSent: false,
    }, fixedNow);

    expect(status.needed).toBe(true);
    expect(status.urgent).toBe(true);
    expect(status.reason).toBe('same_day');
  });
});
