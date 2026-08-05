import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { auditService } from '../../src/services/audit.service';
import { reservationLifecycleService } from '../../src/services/reservation-lifecycle.service';
import { customerService } from '../../src/services/customer.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Admin Create Reservation Endpoint (Task 9) — test unit.
 * POST /api/admin/reservation (input terstruktur), validasi, & shared side effects.
 */

const ADMIN_KEY = 'test_admin_key_123';

describe('Admin Create Reservation (POST /api/admin/reservation)', () => {
  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
  });

  it('Input valid → reservasi tersimpan + audit "CREATE_RESERVATION_MANUAL" + side effects lifecycle', async () => {
    const phone = `6289910${Date.now()}`;
    const customer = {
      id: 'cust-abc', tenant_id: DEFAULT_TENANT_ID, phone, name: 'Bunda Sari', status: 'active',
    };
    const reservation = {
      id: `res_${Date.now()}`,
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: customer.id,
      treatment_category: 'BABY',
      treatment_detail: 'Pijat Bayi Ceria',
      booking_date: null,
      raw_text: '[Admin Manual] BABY: Pijat Bayi Ceria',
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(customerService, 'getCustomerById').mockResolvedValue(customer as any);
    vi.mocked(prisma.reservation.create).mockResolvedValueOnce(reservation as any);
    const auditSpy = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined);
    const lifecycleSpy = vi.spyOn(reservationLifecycleService, 'onReservationCreated').mockResolvedValue(undefined);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: {
        customerId: customer.id,
        treatmentCategory: 'BABY',
        treatmentDetail: 'Pijat Bayi Ceria',
        babies: [{ name: 'Zayn', ageText: '6 bulan' }],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(reservation.id);

    expect(lifecycleSpy).toHaveBeenCalledWith(expect.objectContaining({
      customerId: customer.id,
      tenantId: DEFAULT_TENANT_ID,
      chatId: `${phone}@c.us`,
      babies: [{ name: 'Zayn', age: '6 bulan' }],
    }));
    expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CREATE_RESERVATION_MANUAL',
      targetId: reservation.id,
    }));
  });

  it('Tanpa customerId → 400', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { treatmentCategory: 'BABY', treatmentDetail: 'X' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('treatmentCategory invalid → 400', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { customerId: 'x', treatmentCategory: 'INVALID', treatmentDetail: 'Detail' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('treatmentCategory');
  });

  it('customer tidak ada → 404', async () => {
    vi.spyOn(customerService, 'getCustomerById').mockResolvedValue(null);
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { customerId: 'not-found', treatmentCategory: 'MOMS', treatmentDetail: 'Detail' },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toContain('Customer tidak ditemukan');
  });

  it('Side effects: followUp + children + labels dipanggil via reservationLifecycleService', async () => {
    const customer = {
      id: 'cust-xyz', tenant_id: DEFAULT_TENANT_ID, phone: `6289911${Date.now()}`, name: 'Bunda X',
    };
    const reservation = {
      id: `res_side_${Date.now()}`, tenant_id: DEFAULT_TENANT_ID, customer_id: customer.id,
      treatment_category: 'BOTH', treatment_detail: 'Baby & Moms', booking_date: null,
      raw_text: '[Admin Manual] BOTH: Baby & Moms', status: 'pending', created_at: new Date(), updated_at: new Date(),
    };
    vi.spyOn(customerService, 'getCustomerById').mockResolvedValue(customer as any);
    vi.mocked(prisma.reservation.create).mockResolvedValueOnce(reservation as any);
    vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined);
    const lifecycleSpy = vi.spyOn(reservationLifecycleService, 'onReservationCreated').mockResolvedValue(undefined);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: {
        customerId: customer.id,
        treatmentCategory: 'BOTH',
        treatmentDetail: 'Baby & Moms',
        babies: [{ name: 'Rara', ageText: '3 bulan' }, { name: 'Riri', ageText: '2 tahun' }],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(lifecycleSpy).toHaveBeenCalledTimes(1);
    expect(lifecycleSpy.mock.calls[0][0].reservationId).toBe(reservation.id);
  });
});