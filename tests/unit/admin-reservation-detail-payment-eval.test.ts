import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { memoryReservations } from '../../src/routes/admin/stores';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

const ADMIN_KEY = process.env.ADMIN_API_KEY || 'test-admin-key';

describe('Admin GET /api/admin/reservation/:id — Payment Evaluation Contract (Temuan B)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memoryReservations.clear();
  });

  it('mengembalikan paymentEvaluation lengkap dengan isMismatch=true saat kurang bayar (DB)', async () => {
    const reservationId = 'res-test-eval-1';
    const mockRes = {
      id: reservationId,
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-1',
      status: 'pending',
      purchase_value: 100000,
      delivery_fee: 20000,
      discount_amount: 10000, // expected = 100.000 + 20.000 - 10.000 = 110.000
      payment_proof_url: 'https://cdn.example.com/proof1.jpg',
      receipt_amount: 90000, // kurang 20.000
      payment_proof_verified_at: new Date(),
      customer: {
        id: 'cust-1',
        name: 'Bunda Test',
        children: [],
      },
    };

    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(mockRes as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/reservation/${reservationId}`,
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();

    // Verifikasi kontrak paymentEvaluation hadir di level detail
    expect(body.data.paymentEvaluation).toBeDefined();
    expect(body.data.paymentEvaluation.expected).toBe(110000);
    expect(body.data.paymentEvaluation.receiptAmount).toBe(90000);
    expect(body.data.paymentEvaluation.isMismatch).toBe(true);
    expect(body.data.paymentEvaluation.isUnderpaid).toBe(true);
    expect(body.data.paymentEvaluation.status).toBe('UNDERPAID');
    expect(body.data.paymentEvaluation.difference).toBe(-20000);
  });

  it('mengembalikan paymentEvaluation saat jatuh ke memory fallback', async () => {
    const reservationId = 'res-mem-eval-2';
    memoryReservations.set(reservationId, {
      id: reservationId,
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-2',
      status: 'confirmed',
      purchase_value: 150000,
      delivery_fee: 0,
      discount_amount: 0,
      payment_proof_url: 'https://cdn.example.com/proof2.jpg',
      receipt_amount: 150000,
      payment_proof_verified_at: new Date(),
    } as any);

    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/reservation/${reservationId}`,
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.paymentEvaluation).toBeDefined();
    expect(body.data.paymentEvaluation.expected).toBe(150000);
    expect(body.data.paymentEvaluation.receiptAmount).toBe(150000);
    expect(body.data.paymentEvaluation.isMismatch).toBe(false);
    expect(body.data.paymentEvaluation.status).toBe('EXACT');
  });
});
