/**
 * Kontrak Kanonis Kategori Layanan & Status Reservasi
 *
 * Menyelaraskan relasi kategori layanan lintas lapisan (Prisma DB, Core Service, & Admin Dashboard):
 * - DB Enum (Prisma): BABY, KIDS, MOMS, BOTH
 * - Frontend Extractor: BABY, KIDS, MOMS, BUNDLE, BOTH
 *
 * Kanonis:
 * - BOTH (DB) == BUNDLE (Frontend) == mencakup MOMS + BABY + KIDS
 * - Klaster Anak: BABY dan KIDS beririsan satu sama lain
 *
 * CATATAN UNIFIKASI (#257-PR): definisi "jadwal aktif" TIDAK tinggal di sini.
 * Satu-satunya rumah = `src/domain/reservation-status.ts` (di-re-export di bawah
 * agar import lama tetap jalan). "Sudah ada catatan same-day" (termasuk completed
 * hari ini) adalah konsep BERBEDA milik lapisan UI — lihat `isScheduleBlockingStatus`
 * di mirror frontend.
 */

// Re-export kanonis tunggal (hindari definisi tandingan yang drift).
export { isActiveReservationStatus } from '../domain/reservation-status';

export function isTreatmentCategoryOverlap(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const x = String(a || '').toUpperCase().trim();
  const y = String(b || '').toUpperCase().trim();

  // Jika salah satu kategori tidak spesifik/kosong, anggap berpotensi beririsan hari-sama
  if (!x || !y) return true;
  if (x === y) return true;

  const isBundleOrBoth = (c: string) => c === 'BOTH' || c === 'BUNDLE';
  if (isBundleOrBoth(x) || isBundleOrBoth(y)) return true;

  // Klaster anak: BABY dan KIDS saling mencakup untuk deteksi slot/jadwal
  const childCluster = new Set(['BABY', 'KIDS']);
  if (childCluster.has(x) && childCluster.has(y)) return true;

  return false;
}
