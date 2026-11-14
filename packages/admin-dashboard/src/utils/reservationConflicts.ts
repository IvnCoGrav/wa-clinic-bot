/**
 * Status reservasi yang boleh memicu peringatan "sudah punya jadwal aktif"
 * dan guard bentrok real-time (KNOWN #342).
 *
 * `completed` adalah riwayat — TIDAK boleh dihitung sebagai jadwal aktif,
 * meskipun tanggalnya sama dengan tanggal form (mis. mengedit/booking tanggal lampau).
 */

export const ACTIVE_BOOKING_STATUSES = ['confirmed', 'en_route', 'hold', 'pending'] as const;

export function isActiveBookingStatus(status: string | null | undefined): boolean {
  const s = String(status ?? '').trim().toLowerCase();
  return (ACTIVE_BOOKING_STATUSES as readonly string[]).includes(s);
}

/** True bila baris reservasi layak memicu peringatan konflik customer. */
export function isCustomerConflictCandidate(params: {
  status?: string | null;
  reservationId?: string | null;
  excludeReservationId?: string | null;
}): boolean {
  if (!isActiveBookingStatus(params.status)) return false;
  if (params.excludeReservationId && params.reservationId === params.excludeReservationId) return false;
  return true;
}
