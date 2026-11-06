/**
 * Pemilihan reservasi untuk interpolasi Balasan Cepat (audit #316).
 *
 * Dulu `interpolateQuickReplyContent` memilih reservasi `confirmed` PERTAMA
 * tanpa melihat tanggal — template `{tanggal}/{jam}/{layanan}` bisa berisi
 * jadwal lama berminggu-minggu. Fungsi murni ini memilih yang paling relevan:
 *   1) jadwal terdekat yang belum lewat (termasuk sesi yang sedang berjalan 2 jam),
 *   2) bila tidak ada, sesi paling akhir dalam 24 jam terakhir,
 *   3) selain itu null (jangan mengarang jadwal).
 */

export interface QuickReplyReservationLike {
  id?: string | null;
  status?: string | null;
  booking_date?: string | Date | null;
  treatment_detail?: string | null;
  treatment_name?: string | null;
}

const ACTIVE_STATUSES = new Set(['confirmed', 'en_route', 'hold', 'pending']);
const ONGOING_GRACE_MS = 2 * 60 * 60 * 1000;
const RECENT_PAST_MS = 24 * 60 * 60 * 1000;

function toTime(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

export function selectQuickReplyReservation<T extends QuickReplyReservationLike>(
  reservations: T[] | null | undefined,
  now: number = Date.now()
): T | null {
  if (!Array.isArray(reservations) || reservations.length === 0) return null;

  const candidates = reservations
    .map((reservation) => ({ reservation, time: toTime(reservation?.booking_date) }))
    .filter(
      (entry): entry is { reservation: T; time: number } =>
        entry.time !== null && ACTIVE_STATUSES.has(String(entry.reservation?.status || ''))
    );

  if (candidates.length === 0) return null;

  // 1) Terdekat yang belum lewat (sesi yang sedang berjalan masih dihitung).
  const upcoming = candidates
    .filter((entry) => entry.time >= now - ONGOING_GRACE_MS)
    .sort((a, b) => a.time - b.time);
  if (upcoming.length > 0) return upcoming[0].reservation;

  // 2) Fallback: sesi paling akhir dalam 24 jam terakhir (mis. baru selesai hari ini).
  const recentPast = candidates
    .filter((entry) => entry.time >= now - RECENT_PAST_MS)
    .sort((a, b) => b.time - a.time);
  return recentPast[0]?.reservation || null;
}
