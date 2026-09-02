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

  it('4. PATCH /api/admin/reservation/:id/release-hold → mengubah status menjadi cancelled', async () => {
    const mockCancelledRes = {
      id: 'res-hold-1',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-1',
      status: 'cancelled',
      updated_at: new Date(),
    };

    vi.mocked(prisma.reservation.update).mockResolvedValueOnce(mockCancelledRes as any);
    const auditSpy = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined);

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/reservation/res-hold-1/release-hold',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('cancelled');
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RELEASE_HOLD_RESERVATION',
        targetId: 'res-hold-1',
      })
    );
  });
});
