/**
 * reservationStatus.ts — Single Source of Truth status reservasi di dashboard.
 *
 * Mencegah drift literal (mis. `=== 'otw'` vs DB `en_route`) yang dulu
 * menyembunyikan tab OTW, badge, dan radar CS. Selaras dengan kontrak domain
 * backend `src/domain/reservation-status.ts`.
 */

/** Status "sudah berangkat" — DB kanonik `en_route`, plus alias legacy defensif. */
export const EN_ROUTE_STATUSES: readonly string[] = ['en_route', 'on_the_way', 'otw'];

/** Status yang setara `confirmed` untuk perhitungan jadwal aktif/riwayat. */
export const CONFIRMED_FAMILY_STATUSES: readonly string[] = ['confirmed', 'en_route'];

/** Normalisasi case-insensitive, aman untuk null/undefined. */
export function normalizeReservationStatus(status: string | null | undefined): string {
  return String(status ?? '').trim().toLowerCase();
}

/** True bila reservasi sedang dalam perjalanan (Bidan OTW). */
export function isEnRouteStatus(status: string | null | undefined): boolean {
  return EN_ROUTE_STATUSES.includes(normalizeReservationStatus(status));
}

/** True bila status setara `confirmed` (confirmed atau en_route). */
export function isConfirmedFamilyStatus(status: string | null | undefined): boolean {
  return CONFIRMED_FAMILY_STATUSES.includes(normalizeReservationStatus(status));
}
