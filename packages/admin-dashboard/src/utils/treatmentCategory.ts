/**
 * Kontrak Kanonis Kategori Layanan & Status Reservasi (Frontend Mirror)
 *
 * Menyelaraskan relasi kategori layanan lintas lapisan (Prisma DB, Core Service, & Admin Dashboard):
 * - DB Enum (Prisma): BABY, KIDS, MOMS, BOTH
 * - Frontend Extractor: BABY, KIDS, MOMS, BUNDLE, BOTH
 *
 * Kanonis:
 * - BOTH (DB) == BUNDLE (Frontend) == mencakup MOMS + BABY + KIDS
 * - Klaster Anak: BABY dan KIDS beririsan satu sama lain
 *
 * CATATAN UNIFIKASI (Issue-257-PR): file ini cermin (frontend tidak bisa import `src/`).
 * Dua konsep SENGAJA dibedakan:
 *  - isActiveReservationStatus = cermin `src/domain/reservation-status.ts`
 *    ("menempati slot"; completed/in_progress = false).
 *  - isScheduleBlockingStatus = konsep khusus UI ("sudah ada catatan same-day",
 *    termasuk yang baru selesai/dikerjakan hari ini → completed/in_progress = true).
 *    Dipakai findExistingReservationForSchedule agar banner hijau tersupresi.
 */

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

export function isActiveReservationStatus(s: string | null | undefined): boolean {
  return new Set(['confirmed', 'en_route', 'pending', 'hold']).has(
    String(s || '').toLowerCase().trim()
  );
}

/**
 * Status yang menghalangi pembuatan jadwal baru di tanggal yang sama (same-day).
 * Lebih luas dari "slot aktif": mencakup `completed` (baru selesai hari ini —
 * jangan buat duplikat) dan `in_progress` (sedang dikerjakan).
 */
export function isScheduleBlockingStatus(s: string | null | undefined): boolean {
  return new Set(['confirmed', 'en_route', 'hold', 'pending', 'in_progress', 'completed']).has(
    String(s || '').toLowerCase().trim()
  );
}
