import { prisma } from '../db/client';

export interface AuthorizedReservationResult {
  ok: true;
  reservation: any;
}

export interface UnauthorizedReservationResult {
  ok: false;
  status: number;
  error: string;
}

export type LoadAuthorizedReservationResult =
  | AuthorizedReservationResult
  | UnauthorizedReservationResult;

/**
 * Helper kanonis: muat reservasi + guard tenant/anti-IDOR untuk rute staf.
 * Fail-closed untuk unassigned; supervisor boleh lintas-terapis.
 *
 * Ditempatkan di layer service agar route tidak melakukan akses Prisma langsung
 * (anggaran arsitektur `PRISMA_BUDGET_EXCEEDED`).
 */
export async function loadAuthorizedReservation(
  reservationId: string,
  staffId: string,
  tenantId: string,
  isSupervisor: boolean
): Promise<LoadAuthorizedReservationResult> {
  if (!reservationId || typeof reservationId !== 'string') {
    return { ok: false, status: 400, error: 'reservationId wajib disertakan.' };
  }
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      customer: { select: { id: true, lat: true, lng: true, name: true } },
      assigned_staff: { select: { name: true } },
    },
  });
  if (!reservation || (reservation as any).tenant_id !== tenantId) {
    return { ok: false, status: 404, error: 'Reservasi tidak ditemukan.' };
  }
  if (!isSupervisor) {
    const assigned = (reservation as any).assigned_staff_id;
    if (!assigned || assigned !== staffId) {
      return {
        ok: false,
        status: 403,
        error: 'Anda tidak memiliki hak akses untuk perjalanan jadwal terapis lain.',
      };
    }
  }
  return { ok: true, reservation };
}
