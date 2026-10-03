import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { followUpService, CANCEL_REASON } from '../../src/services/follow-up.service';

/**
 * Root cause historis: `followUpService.onReservationCreated` memutasi
 * `Reservation.is_repeat_order = true` setiap kali pasien baru yang masih
 * memiliki follow-up NO_PURCHASE aktif melakukan booking pertama. Akibatnya
 * transaksi PERTAMA (order #1) salah tertandai "Repeat Order" di DB, merembet
 * ke CAPI queue & label lifecycle.
 *
 * Gerbang fondasional yang dikunci test ini: method tersebut HANYA boleh
 * membatalkan follow-up aktif; kolom `is_repeat_order` adalah domain eksklusif
 * reservation-core (computeIsRepeatOrder). Diuji adversarial: multi follow-up,
 * no-op, dan DB offline — tidak ada satu pun jalur yang boleh menyentuh
 * reservation.update/updateMany.
 */
describe('followUpService.onReservationCreated — DILARANG menyentuh is_repeat_order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('membatalkan follow-up aktif dengan alasan kanonis, TANPA memutasi reservasi', async () => {
    vi.mocked(prisma.followUp.findMany).mockResolvedValueOnce([
      { id: 'fu-1' },
      { id: 'fu-2' },
      { id: 'fu-3' },
    ] as any);
    vi.mocked(prisma.followUp.updateMany).mockResolvedValueOnce({ count: 3 } as any);

    await followUpService.onReservationCreated('cust-multi', 'res-1', 'default-tenant');

    expect(prisma.followUp.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.followUp.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['fu-1', 'fu-2', 'fu-3'] } },
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancel_reason: CANCEL_REASON.RESERVATION_CREATED,
          reservation_id: null,
        }),
      })
    );
    // Inti perbaikan: tidak ada mutasi kolom repeat order sama sekali.
    expect(prisma.reservation.update).not.toHaveBeenCalled();
    expect(prisma.reservation.updateMany).not.toHaveBeenCalled();
  });

  it('skenario root cause: pasien baru + follow-up NO_PURCHASE aktif → transaksi #1 tidak ditandai repeat', async () => {
    vi.mocked(prisma.followUp.findMany).mockResolvedValueOnce([
      { id: 'fu-no-purchase-1', type: 'NO_PURCHASE_1' },
    ] as any);
    vi.mocked(prisma.followUp.updateMany).mockResolvedValueOnce({ count: 1 } as any);

    await followUpService.onReservationCreated('cust-baru-lifecycle', 'res-pertama', 'default-tenant');

    expect(prisma.reservation.update).not.toHaveBeenCalled();
    expect(prisma.reservation.updateMany).not.toHaveBeenCalled();
  });

  it('tanpa follow-up aktif → no-op total (follow-up & reservasi tak disentuh)', async () => {
    vi.mocked(prisma.followUp.findMany).mockResolvedValueOnce([] as any);

    await followUpService.onReservationCreated('cust-diam', 'res-diam', 'default-tenant');

    expect(prisma.followUp.updateMany).not.toHaveBeenCalled();
    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it('DB offline saat findMany → resolve tenang, tidak melempar, tidak menyentuh reservasi', async () => {
    vi.mocked(prisma.followUp.findMany).mockRejectedValueOnce(new Error('Database offline'));

    await expect(
      followUpService.onReservationCreated('cust-db-off', 'res-db-off')
    ).resolves.toBeUndefined();

    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });
});
