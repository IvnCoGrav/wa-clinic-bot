/**
 * Domain: Pemilihan pemenang merge kartu alamat (FUNGSI MURNI).
 *
 * Dipakai oleh skrip healing `heal-shareloc-split-cards.ts`. Dipisah ke domain
 * agar bisa diuji tanpa menyentuh DB/script runtime.
 *
 * INVARIAN MUTLAK:
 *  1. Kartu yang memegang TEKS JALAN tidak boleh menjadi korban bila kartu lain
 *     tidak punya teks (anti kehilangan alamat).
 *  2. Koordinat GPS SELALU bersumber dari kartu ber-`location_source = 'gps_pin'`,
 *     TIDAK PERNAH dari kartu estimasi/tanpa koordinat (anti downgrade presisi).
 *  3. Bila kedua kartu ber-teks, kartu GPS menang (koordinat presisi dipertahankan).
 */

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export interface HealingCard {
  id: string;
  address?: string | null;
  location_source?: string | null;
  is_primary?: boolean | null;
  [key: string]: any;
}

export interface HealingWinner {
  winner: HealingCard;
  victim: HealingCard;
}

/**
 * Tentukan pemenang & korban merge. Korban akan dihapus; koordinat pemenang
 * WAJIB diambil dari kartu GPS (bukan dari korban).
 */
export function pickHealingWinner(
  gpsCard: HealingCard,
  olderCandidates: HealingCard[]
): HealingWinner | null {
  if (!gpsCard || !Array.isArray(olderCandidates) || olderCandidates.length === 0) {
    return null;
  }

  const gpsHasText = hasText(gpsCard.address);
  const withText = olderCandidates.filter((x) => hasText(x.address));

  // Kasus 1: kartu GPS tidak ber-teks, tapi ada kartu lama ber-teks.
  // Pemenang WAJIB kartu ber-teks (identitas alamat), korban = kartu GPS.
  if (!gpsHasText && withText.length > 0) {
    const preferred =
      withText.find((x) => x.location_source === 'manual_staff') || withText[0];
    return { winner: preferred, victim: gpsCard };
  }

  // Kasus 2: kartu GPS ber-teks (atau tidak ada teks sama sekali).
  // Pemenang = kartu GPS (koordinat presisi + teks), korban = kartu lama.
  return { winner: gpsCard, victim: olderCandidates[0] };
}
