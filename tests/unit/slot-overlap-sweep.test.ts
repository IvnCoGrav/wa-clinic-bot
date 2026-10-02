import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import {
  findOverlappingSlots,
  sweepOverlappingSlots,
  formatOverlapAlert,
  computeOverlapFingerprint,
  __clearSlotOverlapDedupFallback,
  type SlotOverlapReservation,
} from '../../src/services/slot-overlap.service';

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

const OPTS = { tenantId: 'default-tenant', activeStaffCount: 3 };

describe('findOverlappingSlots (murni, triase 4 kategori)', () => {
  it('Case 1 — satu Bidan tumpang waktu → STAFF_DOUBLE_BOOKED/CRITICAL', () => {
    const out = findOverlappingSlots(
      [
        res({ id: 'a', booking_date: wib(1, 9, 0), duration_minutes: 60, assigned_staff_id: 'staff-1', customer_id: 'c1' }),
        res({ id: 'b', booking_date: wib(1, 9, 30), duration_minutes: 60, assigned_staff_id: 'staff-1', customer_id: 'c2' }),
      ],
      OPTS
    );
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('STAFF_DOUBLE_BOOKED');
    expect(out[0].severity).toBe('CRITICAL');
    expect(out[0].staffId).toBe('staff-1');
    expect(out[0].reservationIds.sort()).toEqual(['a', 'b']);
  });

  it('Case 2 — pasien sama lintas Bidan (blind spot lama) → CUSTOMER_DOUBLE_BOOKED/WARNING', () => {
    const out = findOverlappingSlots(
      [
        res({ id: 'a', booking_date: wib(1, 10, 0), duration_minutes: 120, assigned_staff_id: 'staff-1', customer_id: 'cust-x' }),
        res({ id: 'b', booking_date: wib(1, 10, 0), duration_minutes: 100, assigned_staff_id: 'staff-2', customer_id: 'cust-x' }),
      ],
      OPTS
    );
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('CUSTOMER_DOUBLE_BOOKED');
    expect(out[0].severity).toBe('WARNING');
    expect(out[0].customerId).toBe('cust-x');
    expect(out[0].reservationIds.sort()).toEqual(['a', 'b']);
  });

  it('Case 3 — 2 unassigned overlap, kuota 3 Bidan → UNASSIGNED_PENDING_ACTION/INFO (bukan bentrok)', () => {
    const out = findOverlappingSlots(
      [
        res({ id: 'a', booking_date: wib(1, 9, 0), duration_minutes: 60, assigned_staff_id: null, customer_id: 'c1' }),
        res({ id: 'b', booking_date: wib(1, 9, 0), duration_minutes: 60, assigned_staff_id: null, customer_id: 'c2' }),
      ],
      OPTS
    );
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('UNASSIGNED_PENDING_ACTION');
    expect(out[0].severity).toBe('INFO');
    expect(out.some((o) => o.severity === 'CRITICAL')).toBe(false);
  });

  it('Case 4 — 3 unassigned overlap, kuota 2 Bidan → UNASSIGNED_OVERCAPACITY/CRITICAL', () => {
    const out = findOverlappingSlots(
      [
        res({ id: 'a', booking_date: wib(1, 9, 0), duration_minutes: 60, assigned_staff_id: null, customer_id: 'c1' }),
        res({ id: 'b', booking_date: wib(1, 9, 0), duration_minutes: 60, assigned_staff_id: null, customer_id: 'c2' }),
        res({ id: 'c', booking_date: wib(1, 9, 0), duration_minutes: 60, assigned_staff_id: null, customer_id: 'c3' }),
      ],
      { tenantId: 'default-tenant', activeStaffCount: 2 }
    );
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('UNASSIGNED_OVERCAPACITY');
    expect(out[0].severity).toBe('CRITICAL');
    expect(out[0].reservationIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('Case 5 — back-to-back (08:00-60m vs 09:00-60m) TIDAK tumpang', () => {
    const out = findOverlappingSlots(
      [
        res({ id: 'a', booking_date: wib(1, 8, 0), duration_minutes: 60, assigned_staff_id: 'staff-1' }),
        res({ id: 'b', booking_date: wib(1, 9, 0), duration_minutes: 60, assigned_staff_id: 'staff-1' }),
      ],
      OPTS
    );
    expect(out).toHaveLength(0);
  });

  it('Case 6 — lintas batas hari WIB (23:30+120m vs 00:30 besok) → hari berbeda', () => {
    const out = findOverlappingSlots(
      [
        res({ id: 'a', booking_date: wib(1, 23, 30), duration_minutes: 120, assigned_staff_id: 'staff-1' }),
        res({ id: 'b', booking_date: wib(2, 0, 30), duration_minutes: 60, assigned_staff_id: 'staff-1' }),
      ],
      OPTS
    );
    expect(out).toHaveLength(0);
  });

  it('Case 7 — tenantId diteruskan ke keluaran, bukan string kosong', () => {
    const out = findOverlappingSlots(
      [
        res({ id: 'a', booking_date: wib(1, 9, 0), duration_minutes: 60, assigned_staff_id: 'staff-1' }),
        res({ id: 'b', booking_date: wib(1, 9, 30), duration_minutes: 60, assigned_staff_id: 'staff-1' }),
      ],
      OPTS
    );
    expect(out[0].tenantId).toBe('default-tenant');
  });

  it('Case 7b — tenantId kosong → melempar (fail-closed)', () => {
    expect(() =>
      findOverlappingSlots(
        [
          res({ id: 'a', booking_date: wib(1, 9, 0), duration_minutes: 60, assigned_staff_id: 'staff-1' }),
          res({ id: 'b', booking_date: wib(1, 9, 30), duration_minutes: 60, assigned_staff_id: 'staff-1' }),
        ],
        { tenantId: '  ', activeStaffCount: 3 }
      )
    ).toThrow(/tenantId/);
  });

  it('Case 8 — kuota Bidan 0 + ada booking aktif → UNASSIGNED_OVERCAPACITY/CRITICAL', () => {
    const out = findOverlappingSlots(
      [res({ id: 'a', booking_date: wib(1, 9, 0), duration_minutes: 60, assigned_staff_id: null, customer_id: 'c1' })],
      { tenantId: 'default-tenant', activeStaffCount: 0 }
    );
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('UNASSIGNED_OVERCAPACITY');
    expect(out[0].severity).toBe('CRITICAL');
  });

  it('Case 9 — kuota tidak diketahui (null) → audit kapasitas dilewati, bentrok Bidan tetap terdeteksi', () => {
    const out = findOverlappingSlots(
      [
        res({ id: 'a', booking_date: wib(1, 9, 0), duration_minutes: 60, assigned_staff_id: 'staff-1' }),
        res({ id: 'b', booking_date: wib(1, 9, 30), duration_minutes: 60, assigned_staff_id: 'staff-1' }),
        res({ id: 'c', booking_date: wib(1, 10, 0), duration_minutes: 60, assigned_staff_id: null, customer_id: 'c1' }),
        res({ id: 'd', booking_date: wib(1, 10, 0), duration_minutes: 60, assigned_staff_id: null, customer_id: 'c2' }),
      ],
      { tenantId: 'default-tenant', activeStaffCount: null }
    );
    expect(out.some((o) => o.type === 'STAFF_DOUBLE_BOOKED')).toBe(true);
    expect(out.some((o) => o.type === 'UNASSIGNED_OVERCAPACITY')).toBe(false);
    expect(out.some((o) => o.type === 'UNASSIGNED_PENDING_ACTION')).toBe(false);
  });

  it('Case 10 — reservasi staf berbeda jam sama → TIDAK dianggap bentrok Bidan', () => {
    const out = findOverlappingSlots(
      [
        res({ id: 'a', booking_date: wib(1, 8, 0), duration_minutes: 60, assigned_staff_id: 'staff-1', customer_id: 'c1' }),
        res({ id: 'b', booking_date: wib(1, 8, 0), duration_minutes: 60, assigned_staff_id: 'staff-2', customer_id: 'c2' }),
      ],
      OPTS
    );
    expect(out.filter((o) => o.type === 'STAFF_DOUBLE_BOOKED')).toHaveLength(0);
  });

  it('Case 11 — tumpang tiga arah satu Bidan → satu grup 3 id', () => {
    const out = findOverlappingSlots(
      [
        res({ id: 'a', booking_date: wib(1, 8, 0), duration_minutes: 60, assigned_staff_id: 'staff-1', customer_id: 'c1' }),
        res({ id: 'b', booking_date: wib(1, 8, 30), duration_minutes: 60, assigned_staff_id: 'staff-1', customer_id: 'c2' }),
        res({ id: 'c', booking_date: wib(1, 8, 45), duration_minutes: 60, assigned_staff_id: 'staff-1', customer_id: 'c3' }),
      ],
      OPTS
    );
    expect(out).toHaveLength(1);
    expect(out[0].reservationIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('Case 12 — pending tidak dihitung bentrok Bidan tapi terhitung duplikasi pasien', () => {
    const out = findOverlappingSlots(
      [
        res({ id: 'a', booking_date: wib(1, 9, 0), duration_minutes: 60, assigned_staff_id: 'staff-1', status: 'pending', customer_id: 'c1' }),
        res({ id: 'b', booking_date: wib(1, 9, 30), duration_minutes: 60, assigned_staff_id: 'staff-1', status: 'confirmed', customer_id: 'c1' }),
      ],
      OPTS
    );
    expect(out.some((o) => o.type === 'STAFF_DOUBLE_BOOKED')).toBe(false);
    expect(out.some((o) => o.type === 'CUSTOMER_DOUBLE_BOOKED')).toBe(true);
  });
});

describe('formatOverlapAlert (murni)', () => {
  it('memuat tanggal WIB, kategori, dan link aksi dari baseUrl', () => {
    const out = findOverlappingSlots(
      [
        res({ id: 'a', booking_date: wib(1, 9, 0), duration_minutes: 60, assigned_staff_id: null, customer_id: 'c1', customer_name: 'Bunda Satu' }),
        res({ id: 'b', booking_date: wib(1, 9, 0), duration_minutes: 60, assigned_staff_id: null, customer_id: 'c2', customer_name: 'Bunda Dua' }),
      ],
      OPTS
    );
    const { title, body } = formatOverlapAlert(out, { baseUrl: 'https://admin.example.com/admin/', activeStaffCount: 3 });
    expect(title).toContain('OPERASIONAL JADWAL');
    expect(body).toContain('Buka Jadwal: https://admin.example.com/admin/reservations?date=');
    expect(body).toContain('3 Bidan aktif');
    expect(body).toContain('Perlu Pembagian Bidan');
    expect(body).toContain('Bunda Satu');
    expect(body).toContain('Bunda Dua');
  });
});

describe('sweepOverlappingSlots (I/O + dedup persisten)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearSlotOverlapDedupFallback();
  });

  function mockRows(rows: any[]) {
    vi.mocked((prisma.reservation as any).findMany).mockResolvedValue(rows as any);
  }

  it('ada tumpang → kirim Web Push + alert, alertSent true', async () => {
    mockRows([
      { id: 'a', booking_date: wib(1, 8, 0), duration_minutes: 60, assigned_staff_id: 'staff-1', status: 'confirmed', customer_id: 'c1', treatment_detail: 'X', customer: { name: 'A' }, assigned_staff: { name: 'Bidan Yusi' } },
      { id: 'b', booking_date: wib(1, 8, 30), duration_minutes: 60, assigned_staff_id: 'staff-1', status: 'confirmed', customer_id: 'c2', treatment_detail: 'Y', customer: { name: 'B' }, assigned_staff: { name: 'Bidan Yusi' } },
    ]);

    const { webPushService } = await import('../../src/services/web-push.service');
    const { alertService } = await import('../../src/services/alert.service');

    const result = await sweepOverlappingSlots('default-tenant');

    expect(result.overlappingGroups).toBe(1);
    expect(result.reservationCount).toBe(2);
    expect(result.alertSent).toBe(true);
    expect(vi.mocked(webPushService.sendPushToRole)).toHaveBeenCalledWith(
      'default-tenant',
      'ADMIN',
      expect.objectContaining({
        tag: 'slot_overlap',
        url: expect.stringMatching(/^\/admin\/reservations\?date=\d{4}-\d{2}-\d{2}$/),
      })
    );
    expect(vi.mocked(alertService.notifyAlert)).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'default-tenant' })
    );
  });

  it('Case Dedup — dua sweep beruntun data sama hanya mengirim 1 alarm', async () => {
    mockRows([
      { id: 'a', booking_date: wib(1, 8, 0), duration_minutes: 60, assigned_staff_id: 'staff-1', status: 'confirmed', customer_id: 'c1', treatment_detail: 'X', customer: { name: 'A' }, assigned_staff: { name: 'Bidan Yusi' } },
      { id: 'b', booking_date: wib(1, 8, 30), duration_minutes: 60, assigned_staff_id: 'staff-1', status: 'confirmed', customer_id: 'c2', treatment_detail: 'Y', customer: { name: 'B' }, assigned_staff: { name: 'Bidan Yusi' } },
    ]);

    const { alertService } = await import('../../src/services/alert.service');

    const first = await sweepOverlappingSlots('default-tenant');
    const second = await sweepOverlappingSlots('default-tenant');

    expect(first.alertSent).toBe(true);
    expect(second.alertSent).toBe(false);
    expect(second.deduped).toBe(true);
    expect(vi.mocked(alertService.notifyAlert)).toHaveBeenCalledTimes(1);
  });

  it('tidak ada tumpang → tidak kirim notifikasi', async () => {
    mockRows([
      { id: 'a', booking_date: wib(1, 8, 0), duration_minutes: 60, assigned_staff_id: 'staff-1', status: 'confirmed', customer_id: 'c1', treatment_detail: 'X', customer: { name: 'A' }, assigned_staff: { name: 'S' } },
      { id: 'b', booking_date: wib(1, 9, 0), duration_minutes: 60, assigned_staff_id: 'staff-1', status: 'confirmed', customer_id: 'c2', treatment_detail: 'Y', customer: { name: 'B' }, assigned_staff: { name: 'S' } },
    ]);

    const { webPushService } = await import('../../src/services/web-push.service');
    const { alertService } = await import('../../src/services/alert.service');

    const result = await sweepOverlappingSlots('default-tenant');

    expect(result).toEqual({ overlappingGroups: 0, reservationCount: 0, alertSent: false, deduped: false });
    expect(vi.mocked(webPushService.sendPushToRole)).not.toHaveBeenCalled();
    expect(vi.mocked(alertService.notifyAlert)).not.toHaveBeenCalled();
  });

  it('DB offline → kembalikan nol tanpa melempar', async () => {
    vi.mocked((prisma.reservation as any).findMany).mockRejectedValueOnce(new Error('Database offline'));
    await expect(sweepOverlappingSlots('default-tenant')).resolves.toEqual({
      overlappingGroups: 0,
      reservationCount: 0,
      alertSent: false,
      deduped: false,
    });
  });
});

describe('computeOverlapFingerprint', () => {
  it('menyertakan tenantId dan berubah saat daftar reservasi berubah', () => {
    const base = findOverlappingSlots(
      [
        res({ id: 'a', booking_date: wib(1, 9, 0), duration_minutes: 60, assigned_staff_id: 'staff-1' }),
        res({ id: 'b', booking_date: wib(1, 9, 30), duration_minutes: 60, assigned_staff_id: 'staff-1' }),
      ],
      OPTS
    );
    const fp1 = computeOverlapFingerprint(base, 't1');
    const fp2 = computeOverlapFingerprint(base, 't2');
    expect(fp1).toContain('t1');
    expect(fp2).toContain('t2');
    expect(fp1).not.toBe(fp2);
  });
});
