import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { findOverlappingSlots, sweepOverlappingSlots, type SlotOverlapReservation } from '../../src/services/slot-overlap.service';

// Isolasi I/O notifikasi: kita hanya ingin memverifikasi pemanggilannya.
vi.mock('../../src/services/web-push.service', () => ({
  webPushService: { sendPushToRole: vi.fn().mockResolvedValue({ sent: 1, failed: 0 }) },
}));
vi.mock('../../src/services/alert.service', () => ({
  alertService: { notifyAlert: vi.fn().mockResolvedValue({ sent: true, channel: 'console' }) },
  AlertType: { DAILY_OPS_REPORT: 'DAILY_OPS_REPORT' },
  AlertSeverity: { WARNING: 'WARNING', CRITICAL: 'CRITICAL', INFO: 'INFO' },
}));

const WIB = 7 * 60 * 60 * 1000;

/** Bangun Date UTC dari jam WIB pada offset hari tertentu (0 = hari ini WIB). */
function wib(dayOffset: number, hour: number, minute = 0): Date {
  const nowWib = new Date(Date.now() + WIB);
  return new Date(
    Date.UTC(nowWib.getUTCFullYear(), nowWib.getUTCMonth(), nowWib.getUTCDate() + dayOffset, hour, minute, 0, 0) - WIB
  );
}

function res(partial: Partial<SlotOverlapReservation> & { id: string }): SlotOverlapReservation {
  return {
    booking_date: null,
    duration_minutes: null,
    assigned_staff_id: null,
    status: 'confirmed',
    customer_id: 'cust-1',
    ...partial,
  };
}

describe('findOverlappingSlots (murni)', () => {
  it('dua reservasi staf sama yang tumpang waktu → terdeteksi', () => {
    const out = findOverlappingSlots([
      res({ id: 'a', booking_date: wib(1, 8, 0), duration_minutes: 60, assigned_staff_id: 'staff-1' }),
      res({ id: 'b', booking_date: wib(1, 8, 30), duration_minutes: 60, assigned_staff_id: 'staff-1' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].staffId).toBe('staff-1');
    expect(out[0].reservationIds.sort()).toEqual(['a', 'b']);
  });

  it('dua reservasi berurutan (08:00-09:00 vs 09:00-10:00) → TIDAK terdeteksi', () => {
    const out = findOverlappingSlots([
      res({ id: 'a', booking_date: wib(1, 8, 0), duration_minutes: 60, assigned_staff_id: 'staff-1' }),
      res({ id: 'b', booking_date: wib(1, 9, 0), duration_minutes: 60, assigned_staff_id: 'staff-1' }),
    ]);
    expect(out).toHaveLength(0);
  });

  it('waktu sama tapi staf BERBEDA → TIDAK terdeteksi', () => {
    const out = findOverlappingSlots([
      res({ id: 'a', booking_date: wib(1, 8, 0), duration_minutes: 60, assigned_staff_id: 'staff-1' }),
      res({ id: 'b', booking_date: wib(1, 8, 0), duration_minutes: 60, assigned_staff_id: 'staff-2' }),
    ]);
    expect(out).toHaveLength(0);
  });

  it('booking_date null → dilewati', () => {
    const out = findOverlappingSlots([
      res({ id: 'a', booking_date: null, assigned_staff_id: 'staff-1' }),
      res({ id: 'b', booking_date: null, assigned_staff_id: 'staff-1' }),
    ]);
    expect(out).toHaveLength(0);
  });

  it('duration default 60 saat null (08:00 vs 08:30) → terdeteksi', () => {
    const out = findOverlappingSlots([
      res({ id: 'a', booking_date: wib(1, 8, 0), duration_minutes: null, assigned_staff_id: 'staff-1' }),
      res({ id: 'b', booking_date: wib(1, 8, 30), duration_minutes: null, assigned_staff_id: 'staff-1' }),
    ]);
    expect(out).toHaveLength(1);
  });

  it('clamp bawah: duration 5 → 15 menit (08:00 vs 08:10) terdeteksi', () => {
    const out = findOverlappingSlots([
      res({ id: 'a', booking_date: wib(1, 8, 0), duration_minutes: 5, assigned_staff_id: 'staff-1' }),
      res({ id: 'b', booking_date: wib(1, 8, 10), duration_minutes: 60, assigned_staff_id: 'staff-1' }),
    ]);
    expect(out).toHaveLength(1);
  });

  it('clamp atas: duration 999 → 480 menit (08:00 vs 17:00) TIDAK tumpang', () => {
    const out = findOverlappingSlots([
      res({ id: 'a', booking_date: wib(1, 8, 0), duration_minutes: 999, assigned_staff_id: 'staff-1' }),
      res({ id: 'b', booking_date: wib(1, 17, 0), duration_minutes: 60, assigned_staff_id: 'staff-1' }),
    ]);
    expect(out).toHaveLength(0);
  });

  it('tumpang tiga arah → satu grup dengan 3 id', () => {
    const out = findOverlappingSlots([
      res({ id: 'a', booking_date: wib(1, 8, 0), duration_minutes: 60, assigned_staff_id: 'staff-1' }),
      res({ id: 'b', booking_date: wib(1, 8, 30), duration_minutes: 60, assigned_staff_id: 'staff-1' }),
      res({ id: 'c', booking_date: wib(1, 8, 45), duration_minutes: 60, assigned_staff_id: 'staff-1' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].reservationIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('tanpa staf (assigned_staff_id null) tumpang di hari sama → grup staff null', () => {
    const out = findOverlappingSlots([
      res({ id: 'a', booking_date: wib(1, 10, 0), duration_minutes: 60, assigned_staff_id: null }),
      res({ id: 'b', booking_date: wib(1, 10, 30), duration_minutes: 60, assigned_staff_id: null }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].staffId).toBeNull();
  });

  it('batas hari WIB (23:30 vs 00:30 hari berikutnya) → hari berbeda, tidak dikelompokkan', () => {
    const out = findOverlappingSlots([
      res({ id: 'a', booking_date: wib(1, 23, 30), duration_minutes: 120, assigned_staff_id: 'staff-1' }),
      res({ id: 'b', booking_date: wib(2, 0, 30), duration_minutes: 60, assigned_staff_id: 'staff-1' }),
    ]);
    expect(out).toHaveLength(0);
  });
});

describe('sweepOverlappingSlots (I/O + notifikasi admin)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ada tumpang → kirim Web Push + alert ADMIN, kembalikan alertSent true', async () => {
    vi.mocked((prisma.reservation as any).findMany).mockResolvedValueOnce([
      { id: 'a', booking_date: wib(1, 8, 0), duration_minutes: 60, assigned_staff_id: 'staff-1', status: 'confirmed', customer_id: 'c1', treatment_detail: 'X' },
      { id: 'b', booking_date: wib(1, 8, 30), duration_minutes: 60, assigned_staff_id: 'staff-1', status: 'confirmed', customer_id: 'c2', treatment_detail: 'Y' },
    ] as any);

    const { webPushService } = await import('../../src/services/web-push.service');
    const { alertService } = await import('../../src/services/alert.service');

    const result = await sweepOverlappingSlots('default-tenant');

    expect(result).toEqual({ overlappingGroups: 1, reservationCount: 2, alertSent: true });
    expect(vi.mocked(webPushService.sendPushToRole)).toHaveBeenCalledWith(
      'default-tenant',
      'ADMIN',
      expect.objectContaining({ tag: 'slot_overlap', data: expect.objectContaining({ type: 'SLOT_OVERLAP', count: 1 }) })
    );
    expect(vi.mocked(alertService.notifyAlert)).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'default-tenant', metadata: { overlappingGroups: 1, reservationCount: 2 } })
    );
  });

  it('tidak ada tumpang → tidak kirim notifikasi', async () => {
    vi.mocked((prisma.reservation as any).findMany).mockResolvedValueOnce([
      { id: 'a', booking_date: wib(1, 8, 0), duration_minutes: 60, assigned_staff_id: 'staff-1', status: 'confirmed', customer_id: 'c1', treatment_detail: 'X' },
      { id: 'b', booking_date: wib(1, 9, 0), duration_minutes: 60, assigned_staff_id: 'staff-1', status: 'confirmed', customer_id: 'c2', treatment_detail: 'Y' },
    ] as any);

    const { webPushService } = await import('../../src/services/web-push.service');
    const { alertService } = await import('../../src/services/alert.service');

    const result = await sweepOverlappingSlots('default-tenant');

    expect(result).toEqual({ overlappingGroups: 0, reservationCount: 0, alertSent: false });
    expect(vi.mocked(webPushService.sendPushToRole)).not.toHaveBeenCalled();
    expect(vi.mocked(alertService.notifyAlert)).not.toHaveBeenCalled();
  });

  it('DB offline → kembalikan nol tanpa melempar', async () => {
    vi.mocked((prisma.reservation as any).findMany).mockRejectedValueOnce(new Error('Database offline'));
    await expect(sweepOverlappingSlots('default-tenant')).resolves.toEqual({
      overlappingGroups: 0,
      reservationCount: 0,
      alertSent: false,
    });
  });
});
