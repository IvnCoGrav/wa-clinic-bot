import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { auditService } from '../../src/services/audit.service';

describe('Admin Verify Payment Integration Tests (POST /api/admin/reservation/:id/verify-payment)', () => {
  const app = buildApp();
  const ADMIN_KEY = 'test_admin_key_verify_payment';

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = ADMIN_KEY;
  });

  it('menolak verifikasi jika bukti bayar tidak ada (HTTP 400)', async () => {
    (prisma.reservation.findFirst as any).mockResolvedValue({
      id: 'res-no-proof',
      tenant_id: 'default-tenant',
      customer_id: 'cust-1',
      status: 'confirmed',
      booking_date: new Date('2026-11-10T03:00:00Z'),
      proof_url: null,
      purchase_occurred_at: null,
      items: [{ price: 100000 }],
      delivery_fee: 20000,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation/res-no-proof/verify-payment',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { paymentMethod: 'TRANSFER' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Bukti transfer wajib ada');
  });

  it('berhasil memverifikasi reservasi yang memiliki proof_url (HTTP 200)', async () => {
    const auditSpy = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue({} as any);

    (prisma.reservation.findFirst as any).mockResolvedValue({
      id: 'res-valid-proof',
      tenant_id: 'default-tenant',
      customer_id: 'cust-1',
      status: 'confirmed',
      booking_date: new Date('2026-11-10T03:00:00Z'),
      proof_url: 'https://cdn.example.com/proof123.jpg',
      purchase_occurred_at: null,
      items: [{ price: 100000 }],
      delivery_fee: 20000,
      customer: { id: 'cust-1', name: 'Bunda Ria' },
    });

    (prisma.reservation.update as any).mockImplementation((args: any) =>
      Promise.resolve({
        id: 'res-valid-proof',
        status: args.data?.status ?? 'completed',
        purchase_value: args.data?.purchase_value ?? 100000,
        purchase_occurred_at: args.data?.purchase_occurred_at ?? new Date(),
        payment_method: args.data?.payment_method ?? 'TRANSFER',
        proof_url: args.data?.proof_url ?? 'https://cdn.example.com/proof123.jpg',
      })
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation/res-valid-proof/verify-payment',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { paymentMethod: 'TRANSFER' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('completed');
    expect(body.data.completed).toBe(true);
    expect(body.data.alreadyPaid).toBe(false);
    expect(body.data.proofUrl).toBe('https://cdn.example.com/proof123.jpg');

    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ADMIN_VERIFY_PAYMENT',
        targetId: 'res-valid-proof',
      })
    );
  });

  it('idempoten: pemanggilan ulang pada reservasi yang sudah lunas tidak menulis ulang (HTTP 200, alreadyPaid: true)', async () => {
    const auditSpy = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue({} as any);
    const existingDate = new Date('2026-11-16T04:00:00Z');

    (prisma.reservation.findFirst as any).mockResolvedValue({
      id: 'res-already-paid',
      tenant_id: 'default-tenant',
      customer_id: 'cust-1',
      status: 'completed',
      booking_date: new Date('2026-11-10T03:00:00Z'),
      proof_url: 'https://cdn.example.com/proof123.jpg',
      purchase_occurred_at: existingDate,
      purchase_value: 100000,
      payment_method: 'TRANSFER',
      items: [{ price: 100000 }],
      delivery_fee: 20000,
      customer: { id: 'cust-1', name: 'Bunda Ria' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation/res-already-paid/verify-payment',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { paymentMethod: 'TRANSFER' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.alreadyPaid).toBe(true);
    expect(body.data.status).toBe('completed');
    expect(prisma.reservation.update).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });
});
