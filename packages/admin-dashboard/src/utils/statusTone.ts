import type { StatusTone } from '../lib/statusTones';
import { normalizeReservationStatus, isEnRouteStatus } from './reservationStatus';

/**
 * statusTone.ts — Pemetaan kanonis status reservasi ke semantic StatusTone (v2).
 * Single Source of Truth penentuan warna status di seluruh modul.
 *
 * `paid` hanya relevan untuk status `completed`: reservasi selesai yang sudah
 * lunas = `success`, yang belum lunas = `caution` (perlu penagihan). Bila
 * informasi pembayaran tidak diketahui (`undefined`), tone tetap `neutral`
 * supaya UI tidak menyatakan lunas/belum lunas tanpa data.
 */
export function reservationStatusToTone(status?: string | null, paid?: boolean): StatusTone {
  const norm = normalizeReservationStatus(status);

  if (isEnRouteStatus(norm)) {
    return 'info';
  }

  switch (norm) {
    case 'confirmed':
      return 'success';
    case 'completed':
      if (paid === true) return 'success';
      if (paid === false) return 'caution';
      return 'neutral';
    case 'cancelled':
    case 'rejected':
      return 'danger';
    case 'hold':
    case 'pending':
      return 'warning';
    default:
      return 'neutral';
  }
}
