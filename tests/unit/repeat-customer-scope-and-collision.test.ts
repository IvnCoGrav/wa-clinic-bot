import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../src/db/client';
import { ConversationService } from '../../src/services/conversation.service';
import { reservationCoreService } from '../../src/services/reservation-core.service';
import { isPrematureCompletion } from '../../src/domain/reservation-status';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { buildApp } from '../../src/app';
import { FastifyInstance } from 'fastify';
import { queueService } from '../../src/services/queue.service';

vi.mock('../../src/services/reservation-lifecycle.service', () => ({
  reservationLifecycleService: {
    onReservationCreated: vi.fn().mockResolvedValue(undefined),
    onReservationCompleted: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../../src/services/follow-up.service', () => ({
  followUpService: { createReservationFollowUps: vi.fn().mockResolvedValue(undefined), onReservationCancelled: vi.fn().mockResolvedValue(undefined) },
}));

/**
 * Regresi fondasional (keputusan product owner):
 *  - Pasien lama / legacy DIKUNCI PERMANEN ke CS manusia (no auto-release ke bot).
 *  - Jadwal masa depan TIDAK boleh ditandai `completed` (guard premature).
 *  - Form berulang pada hari kalender sama dari kanal otomatis = UPDATE, bukan duplikat.
 */
describe('Scope-lock pasien lama', () => {
  const svc = new ConversationService();

  const conv = (reason: string, hours: number) => ({
    id: `conv_${reason}`,
    is_human_handling: true,
    human_handling_since: new Date(Date.now() - hours * 60 * 60 * 1000),
    escalation_reason: reason,
    previous_state: 'INITIAL',
    current_state: 'HUMAN_HANDLING',
  });

  it.each([
    ['EXISTING_PATIENT_MANUAL', 720],
    ['LEGACY_CUSTOMER_MANUAL', 5000],
    ['LEGACY_AI_SCOPE_DISABLED', 99999],
  ])('%s TIDAK PERNAH auto-release ke bot walau %i jam', (reason, hours) => {
    const res = svc.checkAndApplyAutoRelease(conv(reason, hours), DEFAULT_TENANT_ID);
    expect(res.released).toBe(false);
    expect(res.updatedConversation.is_human_handling).toBe(true);
    expect(res.updatedConversation.escalation_reason).toBe(reason);
  });

  it('ACTIVE_APPOINTMENT_MANUAL tetap sewa 48 jam (bukan permanen) lalu release', () => {
    const under = svc.checkAndApplyAutoRelease(conv('ACTIVE_APPOINTMENT_MANUAL', 10), DEFAULT_TENANT_ID);
    expect(under.released).toBe(false);
    const over = svc.checkAndApplyAutoRelease(conv('ACTIVE_APPOINTMENT_MANUAL', 72), DEFAULT_TENANT_ID);
    expect(over.released).toBe(true);
    expect(over.updatedConversation.is_human_handling).toBe(false);
  });
});

describe('Guard anti-completed prematur (domain + endpoint)', () => {
  it('helper: menolak >24 jam ke depan, mengizinkan hari-H', () => {
    const now = Date.now();
    expect(isPrematureCompletion(new Date(now + 11 * 24 * 3600 * 1000), now)).toBe(true);
    expect(isPrematureCompletion(new Date(now + 2 * 3600 * 1000), now)).toBe(false); // same-day
    expect(isPrematureCompletion(null, now)).toBe(false);
    expect(isPrematureCompletion(new Date(now - 3600 * 1000), now)).toBe(false);
  });

  let app: FastifyInstance;
  const ADMIN_KEY = 'test_admin_key_scope_lock';
  const H = { 'x-api-key': ADMIN_KEY };

  beforeAll(async () => {
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    app = buildApp();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await queueService.close();
  });

  beforeEach(() => vi.clearAllMocks());

  const futureRes = {
    id: 'res-jennifer',
    tenant_id: DEFAULT_TENANT_ID,
    customer_id: 'cust-jennifer',
    status: 'confirmed',
    booking_date: new Date(Date.now() + 11 * 24 * 3600 * 1000),
    treatment_category: 'BABY',
    duration_minutes: 60,
    assigned_staff_id: null,
  };

  it('PATCH /:id/complete menolak jadwal 11 hari lagi (400 PREMATURE_COMPLETION_BLOCKED)', async () => {
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(futureRes as any);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/reservation/${futureRes.id}/complete`,
      headers: H,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('PREMATURE_COMPLETION_BLOCKED');
    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it('PATCH /:id/status menolak completed prematur, & forceComplete lolos', async () => {
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(futureRes as any);
    const blocked = await app.inject({
      method: 'PATCH',
      url: `/api/admin/reservation/${futureRes.id}/status`,
      headers: H,
      payload: { status: 'completed' },
    });
    expect(blocked.statusCode).toBe(400);
    expect(JSON.parse(blocked.body).code).toBe('PREMATURE_COMPLETION_BLOCKED');

    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(futureRes as any);
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({ ...futureRes, status: 'completed' } as any);
    const forced = await app.inject({
      method: 'PATCH',
      url: `/api/admin/reservation/${futureRes.id}/status`,
      headers: H,
      payload: { status: 'completed', forceComplete: true },
    });
    expect(forced.statusCode).toBe(200);
  });

  it('PATCH /:id edit penuh menolak status completed prematur', async () => {
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(futureRes as any);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/reservation/${futureRes.id}`,
      headers: H,
      payload: { status: 'completed' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('PREMATURE_COMPLETION_BLOCKED');
  });
});

describe('Anti-duplikat slot same-day (kanal otomatis)', () => {
  beforeEach(() => vi.clearAllMocks());

  const base = {
    tenantId: DEFAULT_TENANT_ID,
    customerId: 'cust-detya',
    chatId: '6281@c.us',
    treatmentCategory: 'BABY' as const,
    source: 'WEBHOOK' as const,
  };
  const slotSame = new Date('2026-10-02T03:00:00.000Z'); // 10:00 WIB

  it('WEBHOOK hari sama + treatment beda redaksi → UPDATE (merge), bukan create', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([
      {
        id: 'primary-1',
        booking_date: slotSame,
        duration_minutes: 120,
        treatment_category: 'BABY',
        treatment_detail: 'pijat bayi dan kids ceria',
        purchase_value: 130000,
        assigned_staff_id: 'bidan-yusi',
        status: 'confirmed',
      } as any,
    ]);
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({ id: 'primary-1', status: 'confirmed' } as any);

    const res = await reservationCoreService.saveReservation({
      ...base,
      bookingDate: slotSame,
      treatmentDetail: 'pijat kids ceria + Kala Baby - Pijat Ceria Total 130.000',
      purchaseValue: 130000,
    });

    expect(res.isNew).toBe(false);
    expect(res.isUpdate).toBe(true);
    expect(res.reservation.id).toBe('primary-1');
    expect(prisma.reservation.create).not.toHaveBeenCalled();
  });

  it('ADMIN_PANEL tanpa force tetap 409 DUPLICATE_BOOKING (series manual dilindungi)', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([
      {
        id: 'primary-2',
        booking_date: slotSame,
        duration_minutes: 60,
        treatment_category: 'BABY',
        treatment_detail: 'Pijat Bayi Ceria',
        status: 'confirmed',
      } as any,
    ]);
    await expect(
      reservationCoreService.saveReservation({
        ...base,
        source: 'ADMIN_PANEL',
        bookingDate: slotSame,
        treatmentDetail: 'Pijat Bayi Ceria',
      })
    ).rejects.toMatchObject({ code: 'DUPLICATE_BOOKING', statusCode: 409 });
  });
});
