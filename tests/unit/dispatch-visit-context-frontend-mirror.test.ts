import { describe, it, expect } from 'vitest';
import {
  shouldWarnUnregisteredVisit,
  hasFreshSharelocToday,
  hasFreshDispatchMediaToday,
} from '../../packages/admin-dashboard/src/utils/dispatchVisitContext';
import { wibDayStartEnd } from '../../packages/admin-dashboard/src/utils/dateWib';
import { wibDayBoundsUtc } from '../../src/utils/wib-time';

describe('Dispatch Visit Context Frontend Mirror — Smoke & Paritas (MT-3.2)', () => {
  it('wibDayStartEnd frontend menghasilkan waktu yang identik dengan wibDayBoundsUtc(0) backend', () => {
    const fixedNow = new Date('2026-10-08T03:30:00.000Z');
    const backendBounds = wibDayBoundsUtc(0, fixedNow);
    const frontendBounds = wibDayStartEnd(fixedNow);

    expect(frontendBounds.start.getTime()).toBe(backendBounds.start.getTime());
    expect(frontendBounds.end.getTime()).toBe(backendBounds.end.getTime());
  });

  it('smoke: frontend mirror shouldWarnUnregisteredVisit menolak media 30 hari lalu dan menerima shareloc hari ini', () => {
    const fixedNow = new Date('2026-10-08T03:30:00.000Z');
    const bounds = wibDayStartEnd(fixedNow);

    // 1. Media lama 30 hari
    const oldMedia = [
      {
        direction: 'OUTBOUND',
        sender_type: 'ADMIN',
        content: '[IMAGE]',
        media: { url: 'https://example.com/asset-1.jpg' },
        created_at: new Date('2026-09-08T03:00:00.000Z'),
      },
    ];
    expect(hasFreshDispatchMediaToday(oldMedia, bounds.start, bounds.end)).toBe(false);
    expect(
      shouldWarnUnregisteredVisit({
        messages: oldMedia,
        dayStart: bounds.start,
        dayEnd: bounds.end,
        field: { hasTodayReservation: false, hasActiveTrip: false, hasOtwActive: false },
      })
    ).toBe(false);

    // 2. Shareloc hari ini
    const todayShareloc = [
      {
        direction: 'INBOUND',
        sender_type: 'CUSTOMER',
        location: { lat: -7.26, lng: 112.69 },
        created_at: fixedNow,
      },
    ];
    expect(hasFreshSharelocToday(todayShareloc, bounds.start, bounds.end)).toBe(true);
    expect(
      shouldWarnUnregisteredVisit({
        messages: todayShareloc,
        dayStart: bounds.start,
        dayEnd: bounds.end,
        field: { hasTodayReservation: false, hasActiveTrip: false, hasOtwActive: false },
      })
    ).toBe(true);
  });
});
