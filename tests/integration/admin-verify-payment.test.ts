import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { auditService } from '../../src/services/audit.service';
import { reservationStatusService } from '../../src/services/reservation-status.service';

/**
 * Seam kanonis verifikasi pembayaran CS/Admin.
 *
 * Kontrak yang ditegakkan di sini (audit D1–D6):
 *  - Verifikasi PEMBAYARAN tidak menyelesaikan kunjungan (status tetap; Gate 6.1).
 *  - `purchase_value` disimpan GROSS (diskon dipotong sekali oleh pembaca kanonis).
 *  - Server adalah otoritas nominal: `amount` klien hanya pembanding.
 *  - Bukti wajib ada; tenant lain tidak bisa; idempoten bila sudah lunas.
 */
describe('Admin Verify Payment Integration Tests (POST /api/admin/reservation/:id/verify-payment)', () => {
  const app = buildApp();
  const ADMIN_KEY = 'test_admin_key_verify_payment';

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = ADMIN_KEY;
  });

  const baseReservation = (overrides: any = {}) => ({
    id: 'res-verify-1',
    tenant_id: 'default-tenant',
    customer_id: 'cust-1',
    status: 'confirmed',
    booking_date: new Date('2026-11-10T03:00:00Z'),
    proof_url: 'https://cdn.example.com/proof123.jpg',
    purchase_occurred_at: null,
    purchase_value: 100000,
    discount_amount: 0,
    delivery_fee: 20000,
    assigned_staff_id: 'staff-1',
    treatment_detail: null,
    items: [],
    customer: { id: 'cust-1', name: 'Bunda Ria' },
    ...overrides,
  });

  /** Update DB: status sengaja TIDAK pernah berubah (kunjungan tetap wewenang bidan). */
  const mockUpdatePreservingStatus = (status = 'confirmed') => {
    (prisma.reservation.update as any).mockImplementation((args: any) =>
      Promise.resolve({
        id: args.where?.id ?? 'res-verify-1',
        status,
        purchase_value: args.data?.purchase_value,
        purchase_occurred_at: args.data?.purchase_occurred_at ?? new Date(),
        payment_method: args.data?.payment_method,
        proof_url: args.data?.proof_url,
      })
    );
  };

  it('menolak verifikasi jika bukti bayar tidak ada (HTTP 400)', async () => {
    (prisma.reservation.findFirst as any).mockResolvedValue(baseReservation({ proof_url: null }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation/res-verify-1/verify-payment',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { paymentMethod: 'TRANSFER' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Bukti transfer wajib ada');
    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it('hanya mencatat pembayaran: status kunjungan TIDAK berubah & Gate 6.1 tidak dilewati', async () => {
    const auditSpy = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue({} as any);
    const applySpy = vi.spyOn(reservationStatusService, 'applyTransition');

    // Reservasi belum punya bidan + jadwal masih di masa depan hari ini.
    (prisma.reservation.findFirst as any).mockResolvedValue(
      baseReservation({ assigned_staff_id: null, booking_date: new Date(Date.now() + 3 * 60 * 60 * 1000) })
    );
    mockUpdatePreservingStatus('confirmed');

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation/res-verify-1/verify-payment',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { paymentMethod: 'TRANSFER' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('confirmed');
    expect(body.data.completed).toBe(false);
    expect(body.data.alreadyPaid).toBe(false);

    const updateArg = (prisma.reservation.update as any).mock.calls[0][0];
    expect(updateArg.data.status).toBeUndefined();
    expect(updateArg.data.purchase_occurred_at).toBeInstanceOf(Date);
    expect(applySpy).not.toHaveBeenCalled();
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ADMIN_VERIFY_PAYMENT',
        targetId: 'res-verify-1',
        tenantId: 'default-tenant',
        payload: expect.objectContaining({ statusChanged: false }),
      })
    );
  });

  it('diskon dipotong sekali: purchase_value disimpan GROSS (bukan NET)', async () => {
    vi.spyOn(auditService, 'logAdminAction').mockResolvedValue({} as any);

    (prisma.reservation.findFirst as any).mockResolvedValue(
      baseReservation({ purchase_value: 70000, discount_amount: 10000, delivery_fee: 0 })
    );
    mockUpdatePreservingStatus('confirmed');

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation/res-verify-1/verify-payment',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { paymentMethod: 'TRANSFER' },
    });

    expect(res.statusCode).toBe(200);
    const updateArg = (prisma.reservation.update as any).mock.calls[0][0];
    // Tagihan riil Rp 60.000, tetapi kolom purchase_value menyimpan GROSS Rp 70.000.
    expect(updateArg.data.purchase_value).toBe(70000);
    expect(JSON.parse(res.body).data.purchaseValue).toBe(70000);
  });

  it('menolak nominal klien yang tidak sesuai tagihan resmi (HTTP 400, tanpa menulis)', async () => {
    (prisma.reservation.findFirst as any).mockResolvedValue(
      baseReservation({ purchase_value: 100000, discount_amount: 0, delivery_fee: 20000 })
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation/res-verify-1/verify-payment',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { paymentMethod: 'TRANSFER', amount: 50000 },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('tidak sesuai tagihan resmi');
    expect(body.expectedTotal).toBe(120000);
    expect(body.receivedAmount).toBe(50000);
    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it('menolak verifikasi bila harga layanan belum ada di sistem (HTTP 400)', async () => {
    (prisma.reservation.findFirst as any).mockResolvedValue(
      baseReservation({ purchase_value: null, discount_amount: 0, delivery_fee: 0, items: [], treatment_detail: null })
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation/res-verify-1/verify-payment',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { paymentMethod: 'TRANSFER' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('Harga layanan belum ada');
    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it('idempoten: pemanggilan ulang pada reservasi yang sudah lunas tidak menulis ulang', async () => {
    const auditSpy = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue({} as any);
    const existingDate = new Date('2026-11-16T04:00:00Z');

    (prisma.reservation.findFirst as any).mockResolvedValue(
      baseReservation({
        status: 'confirmed',
        purchase_occurred_at: existingDate,
        purchase_value: 100000,
        payment_method: 'TRANSFER',
      })
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation/res-verify-1/verify-payment',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { paymentMethod: 'TRANSFER' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.alreadyPaid).toBe(true);
    expect(body.data.purchaseOccurredAt).toBe(existingDate.toISOString());
    expect(prisma.reservation.update).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });
});
