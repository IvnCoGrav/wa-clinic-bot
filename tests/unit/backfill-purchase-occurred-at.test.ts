import { describe, it, expect, vi } from 'vitest';
import {
  BACKFILL_ACTION,
  SOURCE_AUDIT_CREATED_AT,
  SOURCE_AUDIT_PAYLOAD,
  SOURCE_BOOKING_DATE,
  SOURCE_EVENT_SENT_AT,
  resolvePurchaseOccurredAt,
  runBackfill,
} from '../../scripts/backfill-purchase-occurred-at.mjs';

/**
 * D2 (keputusan owner 2026-11-19): backfill `purchase_occurred_at` kosong.
 * Kontrak: prioritas sumber tetap, fallback `booking_date` dipakai terakhir,
 * dan setiap baris yang diubah meninggalkan jejak audit berisi sumbernya.
 */
describe('backfill purchase_occurred_at (D2)', () => {
  describe('resolvePurchaseOccurredAt', () => {
    it('prioritas 1: memakai purchase_occurred_at dari payload audit', () => {
      const { date, source } = resolvePurchaseOccurredAt({
        auditPayload: { purchase_occurred_at: '2026-10-01T03:00:00.000Z' },
        auditCreatedAt: new Date('2026-10-02T03:00:00.000Z'),
        purchaseEventSentAt: new Date('2026-10-03T03:00:00.000Z'),
        bookingDate: new Date('2026-10-04T03:00:00.000Z'),
      });
      expect(source).toBe(SOURCE_AUDIT_PAYLOAD);
      expect(date?.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    });

    it('prioritas 2: jatuh ke created_at audit bila payload tidak memuat tanggal valid', () => {
      const { date, source } = resolvePurchaseOccurredAt({
        auditPayload: { purchase_occurred_at: 'bukan-tanggal' },
        auditCreatedAt: new Date('2026-10-02T03:00:00.000Z'),
        purchaseEventSentAt: new Date('2026-10-03T03:00:00.000Z'),
      });
      expect(source).toBe(SOURCE_AUDIT_CREATED_AT);
      expect(date?.toISOString()).toBe('2026-10-02T03:00:00.000Z');
    });

    it('prioritas 3: purchase_event_sent_at saat tidak ada audit log', () => {
      const { date, source } = resolvePurchaseOccurredAt({
        purchaseEventSentAt: new Date('2026-10-03T03:00:00.000Z'),
        bookingDate: new Date('2026-10-04T03:00:00.000Z'),
      });
      expect(source).toBe(SOURCE_EVENT_SENT_AT);
      expect(date?.toISOString()).toBe('2026-10-03T03:00:00.000Z');
    });

    it('prioritas 4: fallback booking_date (disetujui D2)', () => {
      const { date, source } = resolvePurchaseOccurredAt({
        bookingDate: new Date('2026-10-04T03:00:00.000Z'),
      });
      expect(source).toBe(SOURCE_BOOKING_DATE);
      expect(date?.toISOString()).toBe('2026-10-04T03:00:00.000Z');
    });

    it('tanpa sumber sama sekali → null, tidak mengarang tanggal', () => {
      const { date, source } = resolvePurchaseOccurredAt({});
      expect(date).toBeNull();
      expect(source).toBe('none');
    });

    it('payload berupa string JSON hasil audit tetap terbaca lewat runBackfill', async () => {
      const prisma = buildFakePrisma({
        candidates: [baseReservation()],
        auditLog: { payload: JSON.stringify({ purchase_occurred_at: '2026-09-09T01:00:00.000Z' }), created_at: new Date('2026-09-10T01:00:00.000Z') },
      });
      const result = await runBackfill({ prisma, apply: false, logger: silentLogger() });
      expect(result.sourceDistribution[SOURCE_AUDIT_PAYLOAD]).toBe(1);
    });
  });

  describe('runBackfill', () => {
    it('dry-run tidak menulis apa pun (tanpa update, tanpa audit log)', async () => {
      const prisma = buildFakePrisma({
        candidates: [baseReservation(), baseReservation({ id: 'res-2' })],
        auditLog: null,
      });
      const result = await runBackfill({ prisma, apply: false, logger: silentLogger() });

      expect(result.dryRun).toBe(true);
      expect(result.totalCandidates).toBe(2);
      expect(result.resolvedCount).toBe(2);
      expect(result.appliedCount).toBe(0);
      expect(prisma.reservation.updateMany).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('apply menulis tanggal + audit log berisi sumber (tanpa PII)', async () => {
      const prisma = buildFakePrisma({
        candidates: [baseReservation()],
        auditLog: { payload: null, created_at: new Date('2026-10-02T03:00:00.000Z') },
      });
      const result = await runBackfill({ prisma, apply: true, backupRef: 'backup.dump', logger: silentLogger() });

      expect(result.appliedCount).toBe(1);
      expect(prisma.reservation.updateMany).toHaveBeenCalledTimes(1);
      const updateArg = prisma.reservation.updateMany.mock.calls[0][0];
      expect(updateArg.where).toMatchObject({ id: 'res-1', purchase_occurred_at: null });
      expect(updateArg.data.purchase_occurred_at).toBeInstanceOf(Date);

      const auditArg = prisma.auditLog.create.mock.calls[0][0].data;
      expect(auditArg.action).toBe(BACKFILL_ACTION);
      expect(auditArg.target_id).toBe('res-1');
      expect(auditArg.tenant_id).toBe('tenant-a');
      const payload = JSON.parse(auditArg.payload);
      expect(payload.source).toBe(SOURCE_AUDIT_CREATED_AT);
      expect(Object.keys(payload).sort()).toEqual(['previous_value', 'purchase_occurred_at', 'source']);
    });

    it('idempoten: baris yang sudah terisi tidak ditimpa (updateMany count=0)', async () => {
      const prisma = buildFakePrisma({
        candidates: [baseReservation()],
        auditLog: null,
        updateCount: 0,
      });
      const result = await runBackfill({ prisma, apply: true, backupRef: 'backup.dump', logger: silentLogger() });

      expect(result.alreadyCorrectCount).toBe(1);
      expect(result.appliedCount).toBe(0);
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('reservasi tanpa tanggal sama sekali dilaporkan unresolved, tidak diubah', async () => {
      const prisma = buildFakePrisma({
        candidates: [baseReservation({ booking_date: null, purchase_event_sent_at: null })],
        auditLog: null,
      });
      const result = await runBackfill({ prisma, apply: true, backupRef: 'backup.dump', logger: silentLogger() });

      expect(result.unresolvedCount).toBe(1);
      expect(result.appliedCount).toBe(0);
      expect(prisma.reservation.updateMany).not.toHaveBeenCalled();
    });

    it('DB error dilaporkan jujur (dbAvailable=false) tanpa crash', async () => {
      const prisma = {
        reservation: { findMany: vi.fn().mockRejectedValue(new Error('Database offline')) },
        auditLog: { findFirst: vi.fn(), create: vi.fn() },
        $transaction: vi.fn(),
      };
      const result = await runBackfill({ prisma: prisma as any, apply: true, backupRef: 'x', logger: silentLogger() });
      expect(result.dbAvailable).toBe(false);
      expect(result.note).toContain('Database offline');
    });
  });
});

function silentLogger() {
  return { log: () => {} };
}

function baseReservation(overrides: Record<string, any> = {}) {
  return {
    id: 'res-1',
    tenant_id: 'tenant-a',
    booking_date: new Date('2026-10-05T03:00:00.000Z'),
    created_at: new Date('2026-10-01T03:00:00.000Z'),
    purchase_event_sent_at: new Date('2026-10-03T03:00:00.000Z'),
    ...overrides,
  };
}

function buildFakePrisma({ candidates, auditLog, updateCount = 1 }: { candidates: any[]; auditLog: any; updateCount?: number }) {
  const prisma: any = {
    reservation: {
      findMany: vi.fn().mockResolvedValue(candidates),
      updateMany: vi.fn().mockResolvedValue({ count: updateCount }),
    },
    auditLog: {
      findFirst: vi.fn().mockResolvedValue(auditLog),
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
  };
  return prisma;
}
