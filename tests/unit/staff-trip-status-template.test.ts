import { describe, it, expect, afterEach, vi } from 'vitest';
import { StaffReservationService } from '../../src/services/staff-reservation.service';
import { prisma } from '../../src/db/client';

/**
 * Uji cabang DB `getTripStatusMessageText` (tipe `STAFF_TRIP_STATUS`) — sebelumnya
 * tak teruji karena `tests/setup.ts` tidak memock `prisma.followUpTemplate`.
 * Di sini model di-inject khusus di file ini (tanpa mengubah setup global).
 */
describe('getTripStatusMessageText (DB-driven STAFF_TRIP_STATUS)', () => {
  const original = (prisma as any).followUpTemplate;
  afterEach(() => {
    (prisma as any).followUpTemplate = original;
    vi.restoreAllMocks();
  });

  it('memakai template kustom tenant + merender placeholder', async () => {
    (prisma as any).followUpTemplate = {
      findUnique: vi.fn().mockResolvedValue({ text: 'Hai {name}, Bidan di {areaName}, {etaMinutes} menit lagi.' }),
    };
    const text = await StaffReservationService.getTripStatusMessageText('tenant-x', {
      patientName: 'Bunda Rina',
      areaName: 'Area Flyover Waru',
      etaMinutes: 7,
    });
    expect(text).toBe('Hai Rina, Bidan di Area Flyover Waru, 7 menit lagi.');
  });

  it('fallback ke rolling template saat DB offline tanpa throw', async () => {
    (prisma as any).followUpTemplate = {
      findUnique: vi.fn().mockRejectedValue(new Error('Database offline')),
    };
    const text = await StaffReservationService.getTripStatusMessageText('tenant-x', {
      patientName: 'Bunda Rina',
      areaName: 'Area Waru',
      etaMinutes: 5,
    });
    expect(text).toContain('Rina');
    expect(text).toContain('Area Waru');
    expect(text.length).toBeGreaterThan(10);
  });

  it('nama/area/ETA kosong tetap aman (tidak menghasilkan "{name}")', async () => {
    (prisma as any).followUpTemplate = { findUnique: vi.fn().mockResolvedValue(null) };
    const text = await StaffReservationService.getTripStatusMessageText('tenant-x', {
      patientName: '',
      areaName: '',
      etaMinutes: null as any,
    });
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('{name}');
    expect(text).not.toContain('Bunda ,');
  });
});

describe('getTripDelayMessageText (DB-driven STAFF_TRIP_DELAY)', () => {
  const original = (prisma as any).followUpTemplate;
  afterEach(() => {
    (prisma as any).followUpTemplate = original;
    vi.restoreAllMocks();
  });

  it('memakai template kustom tenant + merender placeholder delay', async () => {
    (prisma as any).followUpTemplate = {
      findUnique: vi.fn().mockResolvedValue({
        text: 'Maaf Bunda {name}, telat {delayMinutes} menit, tiba {arrivalTime} WIB.',
      }),
    };
    const text = await StaffReservationService.getTripDelayMessageText('tenant-x', {
      patientName: 'Bunda Rina',
      delayMinutes: 25,
      arrivalTime: '10:25',
    });
    expect(text).toBe('Maaf Bunda Rina, telat 25 menit, tiba 10:25 WIB.');
  });

  it('fallback ke rolling template saat DB offline tanpa throw', async () => {
    (prisma as any).followUpTemplate = {
      findUnique: vi.fn().mockRejectedValue(new Error('Database offline')),
    };
    const text = await StaffReservationService.getTripDelayMessageText('tenant-x', {
      patientName: 'Bunda Rina',
      delayMinutes: 22,
      arrivalTime: '10:22',
    });
    expect(text).toContain('Rina');
    expect(text).toContain('10:22');
    expect(text).not.toContain('{delayMinutes}');
    expect(text).not.toContain('{arrivalTime}');
  });

  it('nama/delay/jam kosong tetap aman (tidak menghasilkan placeholder mentah)', async () => {
    (prisma as any).followUpTemplate = { findUnique: vi.fn().mockResolvedValue(null) };
    const text = await StaffReservationService.getTripDelayMessageText('tenant-x', {
      patientName: '',
      delayMinutes: null as any,
      arrivalTime: '',
    });
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('{name}');
    expect(text).not.toContain('Bunda ,');
  });
});
