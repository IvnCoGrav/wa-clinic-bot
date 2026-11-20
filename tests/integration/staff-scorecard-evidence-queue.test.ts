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
import { StaffScorecardService } from '../../src/services/staff-scorecard.service';

const ADMIN_KEY = 'test_admin_key_evidence_queue';

const ANCHOR = {
  id: 'msg-1',
  content: 'sudah sampai mana ya bun?',
  created_at: new Date('2026-11-15T04:00:00Z'),
  conversation_id: 'conv-1',
  direction: 'INBOUND',
  sender_type: 'CUSTOMER',
};

const ROW = {
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
    assigned_staff_id: 'staff-thabita',
    customer: { name: 'Bunda Eka' },
    assigned_staff: { name: 'Bidan Thabita' },
  },
};

describe('Antrean verifikasi — filter, pagination, konteks (F8 UX)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = ADMIN_KEY;

    (prisma.visitArrivalEvidence.findMany as any).mockReset();
    (prisma.visitArrivalEvidence.findMany as any).mockResolvedValue([ROW]);
    (prisma.visitArrivalEvidence.count as any).mockReset();
    (prisma.visitArrivalEvidence.count as any).mockResolvedValue(1);
    (prisma.message.findMany as any).mockReset();
    (prisma.message.findMany as any).mockResolvedValue([ANCHOR]);
    (prisma.staff.findMany as any).mockReset();
    (prisma.staff.findMany as any).mockResolvedValue([{ id: 'staff-thabita' }]);
  });

  it('mengirim meta total/limit/offset dan konteks 3 pesan sebelum/sesudah', async () => {
    (prisma.message.findMany as any)
      .mockResolvedValueOnce([ANCHOR])
      .mockResolvedValueOnce([
        {
          ...ANCHOR,
          id: 'msg-before-2',
          content: 'sudah otw ya',
          created_at: new Date('2026-11-15T03:50:00Z'),
        },
        {
          ...ANCHOR,
          id: 'msg-before-1',
          content: 'bun, bidannya dimana?',
          created_at: new Date('2026-11-15T03:55:00Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          ...ANCHOR,
          id: 'msg-after-1',
          content: 'maaf bun, segera sampai',
          created_at: new Date('2026-11-15T04:10:00Z'),
          direction: 'OUTBOUND',
          sender_type: 'STAFF',
        },
      ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/staff-scorecard/evidence?status=NEEDS_REVIEW&limit=15&offset=0',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.meta).toMatchObject({ total: 1, limit: 15, offset: 0 });
    expect(body.data[0]).toMatchObject({
      id: 'ev-1',
      conversationId: 'conv-1',
      reservation: { staffId: 'staff-thabita' },
    });
    const context = body.data[0].context as Array<{ id: string; isAnchor: boolean }>;
    expect(context.map((row) => row.id)).toEqual([
      'msg-before-1',
      'msg-before-2',
      'msg-1',
      'msg-after-1',
    ]);
    expect(context.find((row) => row.isAnchor)?.id).toBe('msg-1');
    expect((prisma.visitArrivalEvidence.findMany as any).mock.calls[0][0]).toMatchObject({
      skip: 0,
      take: 15,
    });
  });

  it('offset diteruskan ke query (pagination tidak mengulang item)', async () => {
    (prisma.visitArrivalEvidence.count as any).mockResolvedValue(33);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/staff-scorecard/evidence?status=NEEDS_REVIEW&limit=15&offset=15',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).meta.total).toBe(33);
    expect((prisma.visitArrivalEvidence.findMany as any).mock.calls[0][0]).toMatchObject({
      skip: 15,
      take: 15,
    });
  });

  it('onlyScored membatasi ke staf aktif + incentive_eligible', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/staff-scorecard/evidence?status=NEEDS_REVIEW&onlyScored=true',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(200);
    expect(prisma.staff.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id: 'default-tenant', active: true, incentive_eligible: true },
      })
    );
    const findArgs = (prisma.visitArrivalEvidence.findMany as any).mock.calls[0][0];
    expect(findArgs.where.reservation.assigned_staff_id).toEqual({ in: ['staff-thabita'] });
  });

  it('tanpa onlyScored tidak memanggil daftar staf (staf non-penilaian tetap tampil)', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/admin/staff-scorecard/evidence?status=NEEDS_REVIEW',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(prisma.staff.findMany).not.toHaveBeenCalled();
    const findArgs = (prisma.visitArrivalEvidence.findMany as any).mock.calls[0][0];
    expect(findArgs.where.reservation?.assigned_staff_id).toBeUndefined();
  });

  it('kegagalan baca konteks tidak menghilangkan bukti (fail-soft)', async () => {
    (prisma.message.findMany as any).mockRejectedValue(new Error('Database offline'));

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/staff-scorecard/evidence?status=NEEDS_REVIEW',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].context).toEqual([]);
  });

  it('GET impact mengembalikan preview per bidan', async () => {
    const impact = [
      {
        staffId: 'staff-thabita',
        staffName: 'Bidan Thabita',
        pending: 18,
        current: { punctualityPct: 50, score: 56.6, grade: 'D', coveragePct: 36.8 },
        projected: { punctualityPct: 21.9, score: 36.5, grade: 'E', coveragePct: 84.2 },
      },
    ];
    vi.spyOn(StaffScorecardService.prototype, 'previewPendingImpact').mockResolvedValue(
      impact as any
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/staff-scorecard/evidence/impact?year=2026&month=11',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toEqual(impact);
  });

  it('GET thread mengembalikan percakapan di sekitar pesan bukti', async () => {
    (prisma.visitArrivalEvidence.findFirst as any).mockResolvedValue({
      message_id: 'msg-1',
      reservation: {
        booking_date: new Date('2026-11-15T03:00:00Z'),
        customer: { name: 'Bunda Eka' },
        assigned_staff: { name: 'Bidan Thabita' },
      },
    });
    (prisma.message.findFirst as any).mockResolvedValue(ANCHOR);
    (prisma.message.findMany as any)
      .mockResolvedValueOnce([
        {
          ...ANCHOR,
          id: 'msg-before-1',
          content: 'bun, bidannya dimana?',
          created_at: new Date('2026-11-15T03:55:00Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          ...ANCHOR,
          id: 'msg-after-1',
          content: 'maaf bun, segera sampai',
          created_at: new Date('2026-11-15T04:10:00Z'),
          direction: 'OUTBOUND',
          sender_type: 'ADMIN',
        },
      ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/staff-scorecard/evidence/ev-1/thread?limit=20',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data;
    expect(data).toMatchObject({
      conversationId: 'conv-1',
      anchorId: 'msg-1',
      customerName: 'Bunda Eka',
      staffName: 'Bidan Thabita',
    });
    expect(data.messages.map((row: any) => row.id)).toEqual([
      'msg-before-1',
      'msg-1',
      'msg-after-1',
    ]);
    expect(data.messages.find((row: any) => row.isAnchor)?.id).toBe('msg-1');
  });

  it('GET thread 404 bila bukti tidak punya pesan', async () => {
    (prisma.visitArrivalEvidence.findFirst as any).mockResolvedValue({
      message_id: null,
      reservation: null,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/staff-scorecard/evidence/ev-1/thread',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).code).toBe('THREAD_NOT_FOUND');
  });
});
