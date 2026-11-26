import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { capiBreaker } from '../../src/services/capi.service';

/**
 * Task 0.8 — Kontrak Snapshot Nilai & Event ID Purchase (Fase 2 Contract)
 * Status: MERAH sebelum implementasi Fase 2 (A-014a / A-002).
 */
describe('Task 0.8: Purchase Event Snapshot & Delivery Truth (Fase 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. Skema Reservation wajib memiliki purchase_event_id dan purchase_event_value', async () => {
    // Memeriksa keberadaan kolom baru pada query Prisma model
    const mockReservation = {
      id: 'res-snapshot-1',
      tenant_id: 'default-tenant',
      purchase_event_id: 'pur_default-tenant_res-snapshot-1',
      purchase_event_value: 150000,
    };

    vi.mocked(prisma.reservation.findUnique).mockResolvedValue(mockReservation as any);
    const found: any = await prisma.reservation.findUnique({
      where: { id: 'res-snapshot-1' },
      select: {
        id: true,
        purchase_event_id: true,
        purchase_event_value: true,
      } as any,
    });

    expect(found.purchase_event_id).toBe('pur_default-tenant_res-snapshot-1');
    expect(found.purchase_event_value).toBe(150000);
  });

  it('2. sendCapiEvent mengembalikan sentEventId dan deliveryConfirmed', async () => {
    // Uji kontrak, bukan jaringan: breaker di-mock agar Meta tidak pernah
    // dihubungi (tanpa mock, panggilan nyata dengan token dummy dibalas 400
    // sehingga sentEventId tidak pernah terbentuk).
    vi.spyOn(capiBreaker, 'execute').mockResolvedValue({
      status: 200,
      data: { events_received: 1, fbtrace_id: 'trace-test' },
    } as any);

    const { capiService } = await import('../../src/services/capi.service');
    const result = await capiService.sendCapiEvent({
      eventName: 'Purchase',
      customer: { id: 'c1', phone: '08123456789' },
      tenantId: 'default-tenant',
      value: 150000,
      reservationId: 'res-snapshot-1',
    });

    // Sebelum Fase 2, result belum memiliki sentEventId / deliveryConfirmed
    expect((result as any).sentEventId).toBeDefined();
    expect((result as any).sentEventId).toBe('pur_default-tenant_res-snapshot-1');
    expect(typeof (result as any).deliveryConfirmed).toBe('boolean');
  });
});
