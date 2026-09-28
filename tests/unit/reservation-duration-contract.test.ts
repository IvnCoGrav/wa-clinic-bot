import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { findOverlappingStaffReservations } from '../../src/services/reservation-core.service';

/**
 * FASE 3.1 — Kontrak durasi TUNGGAL: `duration_minutes` = TOTAL menit terjadwal
 * SUDAH termasuk 1x buffer 20m. Backend DILARANG menambah buffer lagi
 * (sebelumnya 60 → 80 frontend → +20 backend = 100 = 409 palsu).
 */
describe('FASE 3.1 — findOverlappingStaffReservations (kontrak durasi tunggal)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const staff = 'staff-1';
  const start = new Date('2026-10-04T02:00:00.000Z'); // 09:00 WIB

  it('existing 60m pada slot 60m yang berakhir tepat di awal slot baru → TIDAK bentrok', async () => {
    // existing 09:00–10:00 (60m termasuk buffer), baru mulai 10:00 (60m) → bersentuhan, bukan overlap.
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([
      { id: 'ex1', booking_date: new Date('2026-10-04T02:00:00.000Z'), duration_minutes: 60, assigned_staff_id: staff },
    ] as any);
    const res = await findOverlappingStaffReservations({
      tenantId: 'default-tenant', staffId: staff,
      bookingDate: new Date('2026-10-04T03:00:00.000Z'), durationMinutes: 60,
    });
    expect(res).toHaveLength(0);
  });

  it('existing 60m tumpang tindih dengan slot baru (mulai 30 menit kemudian) → bentrok', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([
      { id: 'ex2', booking_date: new Date('2026-10-04T02:00:00.000Z'), duration_minutes: 60, assigned_staff_id: staff },
    ] as any);
    const res = await findOverlappingStaffReservations({
      tenantId: 'default-tenant', staffId: staff,
      bookingDate: new Date('2026-10-04T02:30:00.000Z'), durationMinutes: 60,
    });
    expect(res).toHaveLength(1);
  });

  it('slot berurutan (existing 80m, baru tepat setelahnya) → TIDAK ada 409 palsu', async () => {
    // existing 09:00–10:20 (80m), baru 10:20 → tidak overlap (inilah bug lama: backend +20 → 100m → overlap).
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([
      { id: 'ex3', booking_date: new Date('2026-10-04T02:00:00.000Z'), duration_minutes: 80, assigned_staff_id: staff },
    ] as any);
    const res = await findOverlappingStaffReservations({
      tenantId: 'default-tenant', staffId: staff,
      bookingDate: new Date('2026-10-04T03:20:00.000Z'), durationMinutes: 60,
    });
    expect(res).toHaveLength(0);
  });

  it('excludeId mengecualikan reservasi yang sedang diedit', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([
      { id: 'self', booking_date: new Date('2026-10-04T02:00:00.000Z'), duration_minutes: 60, assigned_staff_id: staff },
    ] as any);
    const res = await findOverlappingStaffReservations({
      tenantId: 'default-tenant', staffId: staff,
      bookingDate: new Date('2026-10-04T02:30:00.000Z'), durationMinutes: 60, excludeId: 'self',
    });
    expect(res).toHaveLength(0);
  });
});
