import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildVisitEvidence,
  hasVisitEvidence,
  resolveEvidenceWindow,
} from '../../src/domain/visit-evidence';
import {
  DEFAULT_VISIT_EVIDENCE_POLICY,
  VisitEvidenceService,
} from '../../src/services/visit-evidence.service';

const BOOKING = new Date('2026-11-07T08:00:00.000Z'); // 15:00 WIB
const at = (minutes: number, base: Date = BOOKING) =>
  new Date(base.getTime() + minutes * 60_000);

const baseTiming = {
  bookingDate: BOOKING,
  durationMinutes: 60,
  arrivedAt: null as Date | null,
  otwSentAt: null as Date | null,
};

describe('resolveEvidenceWindow', () => {
  it('memakai durasi + buffer saat belum tiba', () => {
    const window = resolveEvidenceWindow(baseTiming, 30);
    expect(window?.start.toISOString()).toBe(BOOKING.toISOString());
    expect(window?.end.toISOString()).toBe(at(90).toISOString());
  });

  it('memotong di jam tiba bila tiba lebih awal dari batas durasi', () => {
    const window = resolveEvidenceWindow({ ...baseTiming, arrivedAt: at(20) }, 30);
    expect(window?.end.toISOString()).toBe(at(20).toISOString());
  });

  it('tidak melewati batas durasi meski tiba sangat terlambat', () => {
    const window = resolveEvidenceWindow({ ...baseTiming, arrivedAt: at(120) }, 30);
    expect(window?.end.toISOString()).toBe(at(90).toISOString());
  });

  it('tiba sebelum jadwal menghasilkan jendela kosong', () => {
    const window = resolveEvidenceWindow({ ...baseTiming, arrivedAt: at(-10) }, 30);
    expect(window?.end.toISOString()).toBe(BOOKING.toISOString());
  });

  it('durasi kosong memakai default 60 menit', () => {
    const window = resolveEvidenceWindow({ ...baseTiming, durationMinutes: null }, 30);
    expect(window?.end.toISOString()).toBe(at(90).toISOString());
  });

  it('tanpa jam jadwal tidak ada jendela', () => {
    expect(resolveEvidenceWindow({ ...baseTiming, bookingDate: null }, 30)).toBeNull();
  });
});

describe('buildVisitEvidence — terukur', () => {
  it('membuat bukti TAP dengan selisih menit', () => {
    const result = buildVisitEvidence({
      timing: { ...baseTiming, arrivedAt: at(93) },
      messages: [],
    });

    expect(result.status).toBe('MEASURED');
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toMatchObject({
      source: 'TAP',
      observedMinutes: 93,
      reviewStatus: 'AUTO',
    });
    expect(hasVisitEvidence(result)).toBe(true);
  });

  it('kunjungan terukur tidak membuat kandidat chat', () => {
    const result = buildVisitEvidence({
      timing: { ...baseTiming, arrivedAt: at(20) },
      messages: [{ id: 'm1', createdAt: at(45) }],
    });

    expect(result.status).toBe('MEASURED');
    expect(result.chatCandidate).toBeNull();
    expect(result.drafts.some((draft) => draft.source === 'CHAT')).toBe(false);
  });
});

describe('buildVisitEvidence — kandidat chat', () => {
  it('mengambil pesan terakhir di jendela yang lewat ambang', () => {
    const result = buildVisitEvidence({
      timing: baseTiming,
      messages: [
        { id: 'm-late', createdAt: at(60) },
        { id: 'm-mid', createdAt: at(31) },
        { id: 'm-early', createdAt: at(10) },
      ],
    });

    expect(result.status).toBe('CHAT_CANDIDATE');
    expect(result.chatCandidate).toMatchObject({ messageId: 'm-late', observedMinutes: 60 });
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toMatchObject({
      source: 'CHAT',
      observedMinutes: 60,
      reviewStatus: 'NEEDS_REVIEW',
      messageId: 'm-late',
    });
  });

  it('pesan tepat 30 menit tidak dianggap menunggu', () => {
    const result = buildVisitEvidence({
      timing: baseTiming,
      messages: [{ id: 'm30', createdAt: at(30) }],
    });

    expect(result.chatCandidate).toBeNull();
    expect(result.status).toBe('UNKNOWN');
  });

  it('pesan di luar jendela durasi diabaikan', () => {
    const result = buildVisitEvidence({
      timing: baseTiming,
      messages: [{ id: 'm95', createdAt: at(95) }],
    });

    expect(result.chatCandidate).toBeNull();
  });

  it('pesan sebelum jadwal diabaikan', () => {
    const result = buildVisitEvidence({
      timing: baseTiming,
      messages: [{ id: 'm-early', createdAt: at(-5) }],
    });

    expect(result.chatCandidate).toBeNull();
  });

  it('urutan input tidak memengaruhi pilihan pesan terakhir', () => {
    const result = buildVisitEvidence({
      timing: baseTiming,
      messages: [
        { id: 'm60', createdAt: at(60) },
        { id: 'm40', createdAt: at(40) },
      ],
    });

    expect(result.chatCandidate?.messageId).toBe('m60');
  });
});

describe('buildVisitEvidence — sumber tambahan', () => {
  it('menyertakan OTW dan foto tanpa mengubah status', () => {
    const result = buildVisitEvidence({
      timing: { ...baseTiming, otwSentAt: at(-30) },
      messages: [],
      photo: { capturedAt: at(20) },
    });

    expect(result.status).toBe('UNKNOWN');
    expect(result.drafts.map((draft) => draft.source)).toEqual(['OTW', 'PHOTO']);
    expect(result.drafts[0].observedMinutes).toBe(-30);
    expect(result.drafts[1].observedMinutes).toBe(20);
  });

  it('OTW saja bukan bukti yang cukup', () => {
    const result = buildVisitEvidence({
      timing: { ...baseTiming, otwSentAt: at(5) },
      messages: [],
    });

    expect(result.status).toBe('UNKNOWN');
    expect(hasVisitEvidence(result)).toBe(false);
  });
});

describe('buildVisitEvidence — jaminan tidak menyentuh arrived_at', () => {
  it('draft tidak memiliki field arrived_at/arrivedAt', () => {
    const result = buildVisitEvidence({
      timing: { ...baseTiming, arrivedAt: at(45) },
      messages: [],
      photo: { capturedAt: at(50) },
    });

    const serialized = JSON.stringify(result.drafts);
    expect(serialized).not.toContain('arrived_at');
    expect(serialized).not.toContain('arrivedAt');
  });
});

describe('VisitEvidenceService', () => {
  let prisma: any;
  let service: VisitEvidenceService;

  beforeEach(() => {
    prisma = {
      reservation: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      message: { findMany: vi.fn() },
      visitArrivalEvidence: { findUnique: vi.fn(), upsert: vi.fn() },
      $queryRaw: vi.fn().mockRejectedValue(new Error('DB offline')),
    };
    service = new VisitEvidenceService(prisma);
  });

  it('mengumpulkan kandidat chat tanpa menulis apa pun', async () => {
    prisma.reservation.findFirst.mockResolvedValue({
      id: 'r1',
      customer_id: 'c1',
      booking_date: BOOKING,
      duration_minutes: 60,
      arrived_at: null,
      otw_sent_at: null,
    });
    prisma.message.findMany.mockResolvedValue([{ id: 'm1', created_at: at(45) }]);

    const result = await service.collectForReservation(
      'r1',
      'default-tenant',
      DEFAULT_VISIT_EVIDENCE_POLICY
    );

    expect(result?.status).toBe('CHAT_CANDIDATE');
    expect(result?.chatCandidate).toMatchObject({ messageId: 'm1', observedMinutes: 45 });
    expect(prisma.visitArrivalEvidence.upsert).not.toHaveBeenCalled();
    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it('menyimpan bukti tanpa field arrived_at', async () => {
    prisma.visitArrivalEvidence.findUnique.mockResolvedValue(null);
    prisma.visitArrivalEvidence.upsert.mockResolvedValue({});

    await service.persistDrafts('r1', 'default-tenant', [
      {
        source: 'TAP',
        evidenceAt: at(20),
        observedMinutes: 20,
        confidence: null,
        messageId: null,
        reviewStatus: 'AUTO',
      },
    ]);

    expect(prisma.visitArrivalEvidence.upsert).toHaveBeenCalledTimes(1);
    const payload = prisma.visitArrivalEvidence.upsert.mock.calls[0][0];
    expect(payload.create).toMatchObject({
      tenant_id: 'default-tenant',
      reservation_id: 'r1',
      source: 'TAP',
      observed_minutes: 20,
      review_status: 'AUTO',
    });
    expect(Object.keys(payload.create)).not.toContain('arrived_at');
    expect(Object.keys(payload.create)).not.toContain('arrivedAt');
  });

  it('tidak menimpa bukti yang sudah di-review admin', async () => {
    prisma.visitArrivalEvidence.findUnique.mockResolvedValue({ review_status: 'APPROVED' });

    const result = await service.persistDrafts('r1', 'default-tenant', [
      {
        source: 'CHAT',
        evidenceAt: at(45),
        observedMinutes: 45,
        confidence: null,
        messageId: 'm1',
        reviewStatus: 'NEEDS_REVIEW',
      },
    ]);

    expect(result).toEqual({ persisted: 0, skippedReviewed: 1 });
    expect(prisma.visitArrivalEvidence.upsert).not.toHaveBeenCalled();
  });

  it('backfill periode tidak pernah memanggil update reservasi', async () => {
    prisma.reservation.findMany.mockResolvedValue([{ id: 'r1' }]);
    prisma.reservation.findFirst.mockResolvedValue({
      id: 'r1',
      customer_id: 'c1',
      booking_date: BOOKING,
      duration_minutes: 60,
      arrived_at: at(10),
      otw_sent_at: null,
    });
    prisma.message.findMany.mockResolvedValue([]);

    const summary = await service.collectForPeriod({
      tenantId: 'default-tenant',
      from: at(-24 * 60),
      to: at(24 * 60),
      commit: false,
    });

    expect(summary.total).toBe(1);
    expect(summary.measured).toBe(1);
    expect(prisma.reservation.update).not.toHaveBeenCalled();
    expect(prisma.reservation.updateMany).not.toHaveBeenCalled();
  });
});
