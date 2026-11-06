import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reservationCoreService, ConflictCheckUnavailableError } from '../../src/services/reservation-core.service';
import { prisma } from '../../src/db/client';

describe('A-006: Advisory Lock Fail-Closed in Production (Fase 0)', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalFallback = process.env.ALLOW_ADVISORY_LOCK_FALLBACK;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_ADVISORY_LOCK_FALLBACK;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    if (originalFallback !== undefined) {
      process.env.ALLOW_ADVISORY_LOCK_FALLBACK = originalFallback;
    } else {
      delete process.env.ALLOW_ADVISORY_LOCK_FALLBACK;
    }
  });

  it('0.6: Saat NODE_ENV=production, kegagalan akuisisi advisory lock harus throw ConflictCheckUnavailableError (fail-closed)', async () => {
    // Simulasi prisma.$transaction gagal akuisisi lock
    (prisma as any).$executeRawUnsafe = vi.fn().mockRejectedValue(new Error('pg_advisory_xact_lock connection error'));
    (prisma as any).$transaction = vi.fn(async () => {
      throw new Error('pg_advisory_xact_lock connection error');
    });

    // DB operasional normal untuk query lainnya
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([]);
    vi.mocked(prisma.customer.findUnique).mockResolvedValue({ id: 'cust-lock-test' } as any);
    vi.mocked(prisma.customer.findFirst).mockResolvedValue({ id: 'cust-lock-test' } as any);
    vi.mocked(prisma.reservation.create).mockResolvedValue({ id: 'res-new', booking_date: new Date('2026-11-20T10:00:00Z') } as any);
    vi.mocked(prisma.reservationItem.create).mockResolvedValue({ id: 'item-1' } as any);

    // Di kode saat ini (A-006), error ditangkap dan work(prisma) dijalankan (fail-open berhasil).
    // Di kode baru (Fase 5), harus melempar ConflictCheckUnavailableError dengan scope 'advisory_lock'.
    await expect(
      reservationCoreService.saveReservation({
        tenantId: 'default-tenant',
        source: 'BOT',
        bookingDate: new Date('2026-11-20T10:00:00Z'),
        customerId: 'cust-lock-test',
        customerName: 'Bunda Lock Test',
        treatmentCategory: 'BABY',
        treatmentDetail: 'Pijat Bayi',
        durationMinutes: 60,
        purchaseValue: 70000,
      })
    ).rejects.toThrow(ConflictCheckUnavailableError);
  });
});
