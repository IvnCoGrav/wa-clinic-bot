import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { StaffReservationService } from '../../src/services/staff-reservation.service';
import * as delayWatchdogConfig from '../../src/config/delay-watchdog-config';

describe('StaffTaskItem Delay Payload Contract (SOP No-HP)', () => {
  const tenantId = 'test-tenant-task-delay';
  const staffId = 'staff-thabita';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('memuat delay payload pada StaffTaskItem dan TIDAK membocorkan field phone', async () => {
    vi.spyOn(delayWatchdogConfig, 'getDelayWatchdogSettings').mockResolvedValue({
      toleranceMinutes: 30,
      criticalExtraMinutes: 15,
      maxPrevOriginGapHours: 3,
      adminRecipients: ['08123456789'],
    });

    const now = new Date('2026-11-20T10:00:00Z');
    const bookingDate = new Date('2026-11-20T10:15:00Z'); // 15 menit lagi

    const findManySpy = vi.spyOn(prisma.reservation, 'findMany').mockResolvedValue([
      {
        id: 'res-task-1',
        treatment_detail: 'Pijat Laktasi',
        treatment_category: 'MOMS',
        booking_date: bookingDate,
        duration_minutes: 60,
        status: 'confirmed',
        purchase_value: 150000,
        discount_amount: null,
        delivery_fee: null,
        purchase_occurred_at: null,
        updated_at: new Date(),
        otw_sent_at: null,
        arrived_at: null,
        payment_method: null,
        proof_url: null,
        receipt_amount: null,
        items: [],
        assigned_staff: {
          id: staffId,
          name: 'Bidan Thabita',
          role: 'THERAPIST',
          base_lat: -7.249,
          base_lng: 112.72,
          base_address: 'Demak Surabaya',
        },
        customer: {
          name: 'Bunda Rini',
          lat: -7.26,
          lng: 112.74,
          kelurahan: 'Tegalsari',
          kecamatan: 'Tegalsari',
          kota: 'Surabaya',
          location_source: 'gps',
          distance_km: 3,
          ongkir: 0,
          preferences: {},
          profile_picture_url: null,
          children: [],
          conversations: [],
        },
        children: [],
        customer_address: null,
      } as any,
    ]);

    const tasks = await StaffReservationService.getTodayTasks(staffId, tenantId);

    expect(tasks.length).toBe(1);
    const task = tasks[0];

    // 1) Field delay harus ada dan terstruktur
    expect(task.delay).toBeDefined();
    expect(typeof task.delay?.delayMinutes).toBe('number');
    expect(['none', 'warning', 'critical']).toContain(task.delay?.level);
    expect(typeof task.delay?.estimatedArrivalWib).toBe('string');
    expect(typeof task.delay?.missedDeparture).toBe('boolean');
    expect(task.delay?.originSource).toBe('staff_base');
    expect(task.delay?.originName).toBe('Demak Surabaya');

    // 2) KONTRAK KERAS SOP NO-HP:
    // Tidak boleh ada field phone pada StaffTaskItem maupun objek delay
    expect((task as any).phone).toBeUndefined();
    expect((task.delay as any).phone).toBeUndefined();
    expect((task.delay as any).customerPhone).toBeUndefined();
    expect((task.delay as any).adminPhone).toBeUndefined();

    // 3) Select DB tidak boleh meminta kolom phone customer
    const select = (findManySpy.mock.calls[0]?.[0] as any)?.select?.customer?.select || {};
    expect(select.phone).toBeUndefined();
  });
});
