import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { auditService } from '../../src/services/audit.service';
import { customerService } from '../../src/services/customer.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

const ADMIN_KEY = 'test_admin_key_quick_hold';

describe('Admin Quick Booking / Slot Hold (POST /api/admin/reservation/quick-hold & PATCH /release-hold)', () => {
  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    vi.restoreAllMocks();
  });

  it('1. Quick hold dengan customerId yang sudah ada → tersimpan dengan status "hold"', async () => {
    const customer = {
      id: 'cust-hold-1',
      tenant_id: DEFAULT_TENANT_ID,
      phone: '628123456789',
      name: 'Bunda Rina',
      status: 'active',
    };
    const bookingDate = new Date('2026-09-03T10:00:00.000Z');
    const mockReservation = {
      id: 'res-hold-1',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: customer.id,
      treatment_category: 'BABY',
      treatment_detail: '[HOLD] Slot Ditawarkan',
      booking_date: bookingDate,
      assigned_staff_id: 'staff-1',
      raw_text: '[Admin Quick Hold] Ditawarkan: 03/09/2026',
      status: 'hold',
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.mocked(prisma.reservation.create).mockResolvedValueOnce(mockReservation as any);
    const auditSpy = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation/quick-hold',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: {
        customerId: customer.id,
        bookingDate: bookingDate.toISOString(),
        assignedStaffId: 'staff-1',
        notes: 'Tunggu konfirmasi suami',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('res-hold-1');
    expect(body.data.status).toBe('hold');

    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE_QUICK_HOLD_RESERVATION',
        targetId: 'res-hold-1',
      })
    );
  });

  it('2. Quick hold dengan nomor HP & Nama baru → getOrCreateCustomer dipanggil', async () => {
    const phone = '081299988877';
    const cleanPhone = '6281299988877';
    const customer = {
      id: 'cust-new-hold',
      tenant_id: DEFAULT_TENANT_ID,
      phone: cleanPhone,
      name: 'Bunda Maya',
    };
    const bookingDate = new Date('2026-09-04T14:00:00.000Z');
    const mockReservation = {
      id: 'res-hold-2',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: customer.id,
      treatment_category: 'MOMS',
      treatment_detail: '[HOLD] Slot Ditawarkan (MOMS)',
      booking_date: bookingDate,
      status: 'hold',
      created_at: new Date(),
      updated_at: new Date(),
    };

    const getOrCreateSpy = vi.spyOn(customerService, 'getOrCreateCustomer').mockResolvedValueOnce(customer as any);
    vi.mocked(prisma.reservation.create).mockResolvedValueOnce(mockReservation as any);
    vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation/quick-hold',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: {
        customerPhone: phone,
        customerName: 'Bunda Maya',
        bookingDate: bookingDate.toISOString(),
        treatmentCategory: 'MOMS',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('hold');
    expect(getOrCreateSpy).toHaveBeenCalledWith(cleanPhone, 'Bunda Maya', DEFAULT_TENANT_ID);
  });

  it('3. Validasi error jika bookingDate kosong', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation/quick-hold',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: {
        customerId: 'cust-123',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.error).toContain('bookingDate wajib diisi');
  });

  it('5. Quick hold dengan durationMinutes 120 → duration_minutes tersimpan (treatment >1 jam)', async () => {
    const bookingDate = new Date('2026-09-05T03:00:00.000Z'); // 10:00 WIB
    const mockReservation = {
      id: 'res-hold-dur',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-hold-1',
      treatment_category: 'BABY',
      treatment_detail: '[HOLD] Slot Ditawarkan (BABY) [120m]',
      booking_date: bookingDate,
      duration_minutes: 120,
      status: 'hold',
      created_at: new Date(),
      updated_at: new Date(),
    };

    const createSpy = vi.mocked(prisma.reservation.create).mockResolvedValueOnce(mockReservation as any);
    vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation/quick-hold',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: {
        customerId: 'cust-hold-1',
        bookingDate: bookingDate.toISOString(),
        durationMinutes: 120,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.duration_minutes).toBe(120);
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ duration_minutes: 120 }),
      })
    );
  });

  it('6. durationMinutes berlebih di-clamp ke 480 (9999 → 480)', async () => {
    const bookingDate = new Date('2026-09-05T03:00:00.000Z');
    const createSpy = vi.mocked(prisma.reservation.create).mockResolvedValueOnce({
      id: 'res-hold-clamp',
      status: 'hold',
    } as any);
    vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation/quick-hold',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: {
        customerId: 'cust-hold-1',
        bookingDate: bookingDate.toISOString(),
        durationMinutes: 9999,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ duration_minutes: 480 }),
      })
    );
  });

  it('7. daily-slots: hold 120 mnt jam 10:00 ikut menutup slot 11:00 (overlap interval)', async () => {
    const staff = [
      { id: 'st-1', tenant_id: DEFAULT_TENANT_ID, name: 'Bidan A', role: 'THERAPIST', active: true },
      { id: 'st-2', tenant_id: DEFAULT_TENANT_ID, name: 'Bidan B', role: 'THERAPIST', active: true },
    ];
    const holdBooking = {
      booking_date: new Date('2026-09-10T03:00:00.000Z'), // 10:00 WIB
      status: 'hold',
      duration_minutes: 120,
      assigned_staff: null,
      customer: { name: 'Bunda Rina', kelurahan: null, kecamatan: null },
      treatment_detail: '[HOLD] Slot Ditawarkan (BABY) [120m]',
      raw_text: '',
    };
    vi.mocked((prisma as any).staff.findMany).mockResolvedValueOnce(staff as any);
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([holdBooking] as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/reservations/daily-slots?date=2026-09-10',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    const slot11 = (body.slots as any[]).find((s) => s.time === '11:00');
    expect(slot11).toBeTruthy();
    // Hold 10:00 + 120 mnt (s.d. 12:00) overlap jendela slot 11:00 [11:00–12:30)
    expect(slot11.bookings.length).toBe(1);
    expect(slot11.status).toBe('hold');
  });

  it('8. daily-slots: hold tanpa durasi (default 60 mnt) TIDAK menutup slot 11:00', async () => {
    const staff = [
      { id: 'st-1', tenant_id: DEFAULT_TENANT_ID, name: 'Bidan A', role: 'THERAPIST', active: true },
      { id: 'st-2', tenant_id: DEFAULT_TENANT_ID, name: 'Bidan B', role: 'THERAPIST', active: true },
    ];
    const holdBooking = {
      booking_date: new Date('2026-09-10T03:00:00.000Z'), // 10:00 WIB
      status: 'hold',
      duration_minutes: null,
      assigned_staff: null,
      customer: { name: 'Bunda Rina', kelurahan: null, kecamatan: null },
      treatment_detail: '[HOLD] Slot Ditawarkan',
      raw_text: '',
    };
    vi.mocked((prisma as any).staff.findMany).mockResolvedValueOnce(staff as any);
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([holdBooking] as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/reservations/daily-slots?date=2026-09-10',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const slot11 = (body.slots as any[]).find((s) => s.time === '11:00');
    expect(slot11).toBeTruthy();
    // Hold 10:00 + 60 mnt berakhir tepat 11:00 → tidak overlap (batas eksklusif)
    expect(slot11.bookings.length).toBe(0);
    expect(slot11.status).toBe('available');
  });

  it('4. PATCH /api/admin/reservation/:id/release-hold → menghapus permanen hold (deleted:true)', async () => {
    const app = buildApp();
    // Buat hold via fallback in-memory (DB offline)
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation/quick-hold',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: {
        customerId: 'cust-hold-1',
        bookingDate: new Date('2026-09-03T10:00:00.000Z').toISOString(),
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = JSON.parse(createRes.body);
    const holdId = created.data.id;
    const auditSpy = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined as any);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/reservation/${holdId}/release-hold`,
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.deleted).toBe(true);
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DELETE_HOLD_RESERVATION',
        targetId: holdId,
      })
    );
  });
});
