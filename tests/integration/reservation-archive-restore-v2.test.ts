import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { reservationArchiveService } from '../../src/services/reservation-archive.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('A-005: Reservation Archive & Restore v2 (Fase 0)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('0.5: restoreReservation mempertahankan duration_minutes, purchase_occurred_at, data maternal, dan memulihkan follow-up', async () => {
    const mockArchive = {
      id: 'arch-v2-1',
      tenant_id: DEFAULT_TENANT_ID,
      reservation_id: 'res-v2-1',
      restored_at: null,
      restore_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      payload: {
        schemaVersion: 2,
        reservation: {
          id: 'res-v2-1',
          tenant_id: DEFAULT_TENANT_ID,
          customer_id: 'cust-v2-1',
          treatment_category: 'MOMS',
          treatment_detail: 'Pijat Hamil 90 Menit',
          booking_date: '2026-11-20T10:00:00.000Z',
          duration_minutes: 90,
          status: 'confirmed',
          raw_text: 'Pijat Hamil',
          purchase_value: 150000,
          purchase_occurred_at: '2026-11-20T11:30:00.000Z',
          purchase_review_status: 'approved',
          gestational_weeks: 32,
          mom_stage: 'PREGNANT',
        },
        items: [
          {
            id: 'item-1',
            custom_name: 'Pijat Hamil',
            price: 150000,
            duration_minutes: 90,
          },
        ],
        followUps: [
          {
            id: 'fu-1',
            type: 'REVIEW_H1_MOMS',
            stage: 'H1',
            scheduled_at: '2026-11-21T10:00:00.000Z',
            status: 'SCHEDULED',
          },
        ],
      },
    };

    vi.mocked(prisma.reservationArchive.findFirst).mockResolvedValue(mockArchive as any);
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null);

    let createdReservationData: any = null;
    const txFollowUpCreates: any[] = [];
    const txFollowUpUpdates: any[] = [];

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        reservation: {
          create: vi.fn().mockImplementation(async ({ data }: any) => {
            createdReservationData = data;
            return { id: data.id, ...data };
          }),
        },
        reservationItem: {
          create: vi.fn().mockResolvedValue({ id: 'item-1' }),
        },
        child: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        followUp: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(async ({ data }: any) => {
            txFollowUpCreates.push(data);
            return data;
          }),
          update: vi.fn().mockImplementation(async ({ data }: any) => {
            txFollowUpUpdates.push(data);
            return data;
          }),
        },
        reservationArchive: {
          update: vi.fn().mockResolvedValue({ ...mockArchive, restored_at: new Date() }),
        },
      };
      return cb(tx);
    });

    const result = await reservationArchiveService.restoreReservation({
      archiveId: 'arch-v2-1',
      tenantId: DEFAULT_TENANT_ID,
      actor: 'admin-test',
    });

    expect(result.reservationId).toBe('res-v2-1');
    expect(createdReservationData).not.toBeNull();
    // Pada kode saat ini (A-005), field duration_minutes diabaikan saat restore (undefined)
    expect(createdReservationData.duration_minutes).toBe(90);
    expect(createdReservationData.purchase_occurred_at).toBeInstanceOf(Date);
    expect(createdReservationData.gestational_weeks).toBe(32);
    expect(createdReservationData.mom_stage).toBe('PREGNANT');

    // Pada kode saat ini (A-005), follow-up tidak dipulihkan sama sekali (0)
    expect(txFollowUpCreates.length + txFollowUpUpdates.length).toBeGreaterThanOrEqual(1);
  });
  it('0.5b: P5 - restoreReservation pada arsip lama tanpa purchase_review_status TIDAK menjadi pending (anti double CAPI)', async () => {
    const mockArchiveV1 = {
      id: 'arch-v1-old',
      tenant_id: DEFAULT_TENANT_ID,
      reservation_id: 'res-v1-old',
      restored_at: null,
      restore_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      payload: {
        schemaVersion: 1,
        reservation: {
          id: 'res-v1-old',
          tenant_id: DEFAULT_TENANT_ID,
          customer_id: 'cust-v1-1',
          treatment_category: 'BABY',
          treatment_detail: 'Pijat Bayi Ceria',
          booking_date: '2026-11-20T10:00:00.000Z',
          status: 'confirmed',
          raw_text: 'Pijat Bayi',
          purchase_value: 80000,
          // Field purchase_review_status TIDAK ADA pada arsip v1
          purchase_occurred_at: '2026-11-20T11:00:00.000Z',
          purchase_event_sent_at: null,
        },
      },
    };

    vi.mocked(prisma.reservationArchive.findFirst).mockResolvedValue(mockArchiveV1 as any);
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null);

    let createdRes: any = null;
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        reservation: {
          create: vi.fn().mockImplementation(async ({ data }: any) => {
            createdRes = data;
            return { id: data.id, ...data };
          }),
        },
        reservationItem: { create: vi.fn().mockResolvedValue({ id: 'item-1' }) },
        child: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        followUp: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() },
        reservationArchive: { update: vi.fn().mockResolvedValue({ ...mockArchiveV1, restored_at: new Date() }) },
      };
      return cb(tx);
    });

    await reservationArchiveService.restoreReservation({
      archiveId: 'arch-v1-old',
      tenantId: DEFAULT_TENANT_ID,
      actor: 'admin-test',
    });

    expect(createdRes).not.toBeNull();
    // P5: Harus not_applicable, BUKAN pending yang bisa memicu kiriman ulang ke Meta CAPI
    expect(createdRes.purchase_review_status).toBe('not_applicable');
  });
});
