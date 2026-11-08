import { prisma } from '../../../db/client';

/**
 * Relink jadwal AKTIF yang memakai kartu alamat tertentu + selaraskan ongkir.
 * Seam tunggal agar semua jalur penulisan lokasi (PUT kartu, PUT /location
 * berbasis kartu) memakai gerbang yang sama — mencegah jadwal tertinggal di
 * rumah lama saat pin/kartu diperbarui. Best-effort, tidak pernah throw.
 */
export async function relinkActiveReservationsForCard(params: {
  tenantId: string;
  customerId: string;
  cardId: string;
  fee?: number | null;
}): Promise<void> {
  const { tenantId, customerId, cardId, fee } = params;
  try {
    const { isActiveReservation, ACTIVE_RESERVATION_STATUSES } = await import('../../../domain/reservation-status');
    const activeRows = await prisma.reservation.findMany({
      where: {
        tenant_id: tenantId,
        customer_id: customerId,
        customer_address_id: cardId,
        status: { in: ACTIVE_RESERVATION_STATUSES },
      },
    }).catch(() => []);
    for (const r of ((activeRows || []) as any[]).filter((row) => isActiveReservation(row))) {
      await prisma.reservation.update({
        where: { id: r.id },
        data: {
          customer_address_id: cardId,
          ...(typeof fee === 'number' ? { delivery_fee: fee } : {}),
        },
      }).catch(() => {});
    }
  } catch (syncErr: any) {
    console.warn('[ADMIN][addresses] relink active reservation skipped:', syncErr?.message);
  }
}
