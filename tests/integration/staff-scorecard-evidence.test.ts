import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/services/role-scope.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/role-scope.service')>();
  return {
    ...actual,
    isApiScopeAllowed: vi.fn().mockResolvedValue({ allowed: true, managed: false }),
  };
});

import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { auditService } from '../../src/services/audit.service';

const EVIDENCE_ROW = {
  id: 'ev-1',
  tenant_id: 'default-tenant',
  reservation_id: 'res-1',
  source: 'CHAT',
  evidence_at: new Date('2026-11-15T04:00:00Z'),
  observed_minutes: 45,
  confidence: 0.92,
  review_status: 'NEEDS_REVIEW',
  message_id: 'msg-1',
  reservation: {
    id: 'res-1',
    booking_date: new Date('2026-11-15T03:00:00Z'),
    customer: { name: 'Bunda Eka' },
    assigned_staff: { name: 'Bidan Thabita' },
  },
};

describe('Staff Scorecard Evidence Review (F4)', () => {
  const app = buildApp();
  const ADMIN_KEY = 'test_admin_key_evidence';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    (prisma.visitArrivalEvidence.findMany as any).mockReset();
    (prisma.visitArrivalEvidence.findMany as any).mockRejectedValue(
      new Error('Database offline')
    );
    (prisma.visitArrivalEvidence.findFirst as any).mockReset();
    (prisma.visitArrivalEvidence.findFirst as any).mockRejectedValue(
      new Error('Database offline')
    );
    (prisma.visitArrivalEvidence.update as any).mockReset();
    (prisma.visitArrivalEvidence.update as any).mockRejectedValue(
      new Error('Database offline')
    );
    (prisma.message.findMany as any).mockReset();
    (prisma.message.findMany as any).mockRejectedValue(new Error('Database offline'));
    vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined as any);
  });

  it('GET antrean mengembalikan bukti + kutipan pesan', async () => {
    (prisma.visitArrivalEvidence.findMany as any).mockResolvedValue([EVIDENCE_ROW]);
    (prisma.message.findMany as any).mockResolvedValue([
      { id: 'msg-1', content: 'sudah sampai mana ya?', created_at: new Date('2026-11-15T04:00:00Z') },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/staff-scorecard/evidence?status=NEEDS_REVIEW',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: 'ev-1',
      source: 'CHAT',
      observedMinutes: 45,
      reviewStatus: 'NEEDS_REVIEW',
      message: { content: 'sudah sampai mana ya?' },
      reservation: {
        customerName: 'Bunda Eka',
        staffName: 'Bidan Thabita',
      },
    });
  });

  it('POST setujui mengubah status + audit, tanpa menyentuh reservasi', async () => {
    (prisma.visitArrivalEvidence.findFirst as any).mockResolvedValue({
      id: 'ev-1',
      review_status: 'NEEDS_REVIEW',
    });
    (prisma.visitArrivalEvidence.update as any).mockResolvedValue({
      id: 'ev-1',
      reservation_id: 'res-1',
      source: 'CHAT',
      review_status: 'APPROVED',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/staff-scorecard/evidence/ev-1/review',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { action: 'APPROVE', note: 'Customer jelas menunggu.' },
    });

    expect(res.statusCode).toBe(200);
    expect(prisma.visitArrivalEvidence.update).toHaveBeenCalledTimes(1);
    const updateArg = (prisma.visitArrivalEvidence.update as any).mock.calls[0][0];
    expect(updateArg.data.review_status).toBe('APPROVED');
    expect(updateArg.data.review_note).toBe('Customer jelas menunggu.');
    expect(auditService.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'REVIEW_ARRIVAL_EVIDENCE',
        targetId: 'ev-1',
      })
    );
    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it('POST tolak menyimpan status REJECTED + catatan', async () => {
    (prisma.visitArrivalEvidence.findFirst as any).mockResolvedValue({
      id: 'ev-1',
      review_status: 'NEEDS_REVIEW',
    });
    (prisma.visitArrivalEvidence.update as any).mockResolvedValue({
      id: 'ev-1',
      reservation_id: 'res-1',
      source: 'CHAT',
      review_status: 'REJECTED',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/staff-scorecard/evidence/ev-1/review',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { action: 'REJECT', note: 'Pesan soal jadwal berikutnya.' },
    });

    expect(res.statusCode).toBe(200);
    const updateArg = (prisma.visitArrivalEvidence.update as any).mock.calls[0][0];
    expect(updateArg.data.review_status).toBe('REJECTED');
    expect(updateArg.data.review_note).toBe('Pesan soal jadwal berikutnya.');
  });

  it('menolak review ulang bukti yang sudah diputuskan (409)', async () => {
    (prisma.visitArrivalEvidence.findFirst as any).mockResolvedValue({
      id: 'ev-1',
      review_status: 'APPROVED',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/staff-scorecard/evidence/ev-1/review',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { action: 'REJECT', note: 'Ubah pikiran.' },
    });

    expect(res.statusCode).toBe(409);
    expect(prisma.visitArrivalEvidence.update).not.toHaveBeenCalled();
  });

  it('menolak aksi selain APPROVE/REJECT (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/staff-scorecard/evidence/ev-1/review',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { action: 'DELETE' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('INVALID_ACTION');
  });

  it('bukti yang tidak ditemukan menghasilkan 404', async () => {
    (prisma.visitArrivalEvidence.findFirst as any).mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/staff-scorecard/evidence/ev-x/review',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { action: 'APPROVE' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('status review tidak dikenal ditolak 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/staff-scorecard/evidence?status=WHATEVER',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('INVALID_STATUS');
  });
});
