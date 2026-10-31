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

export type CanonicalTreatmentCategory = 'BABY' | 'KIDS' | 'MOMS' | 'BOTH';

/**
 * Normalisasi kategori dari lapisan mana pun (frontend `BUNDLE`, string bebas,
 * enum Prisma) ke nilai enum DB kanonis. Nilai tak dikenal -> null (JANGAN
 * ditebak) agar data lama tetap NULL, bukan salah kategori.
 */
export function normalizeTreatmentCategory(
  value: string | null | undefined
): CanonicalTreatmentCategory | null {
  const v = String(value || '').toUpperCase().trim();
  if (!v) return null;
  if (v === 'BUNDLE') return 'BOTH';
  if (v === 'BABY' || v === 'KIDS' || v === 'MOMS' || v === 'BOTH') return v;
  return null;
}

/**
 * Klaster ANAK: narasi follow-up boleh menyinggung bayi/anak.
 * BOTH = paket ibu & anak sekaligus -> tetap memuat narasi anak.
 */
export function isChildCategory(value: string | null | undefined): boolean {
  const v = normalizeTreatmentCategory(value);
  return v === 'BABY' || v === 'KIDS' || v === 'BOTH';
}

/** Klaster MOMS murni: narasi bayi DILARANG. Kategori kosong -> bukan MOMS. */
export function isMomsCategory(value: string | null | undefined): boolean {
  return normalizeTreatmentCategory(value) === 'MOMS';
}
