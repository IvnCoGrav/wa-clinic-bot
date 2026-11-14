/**
 * Kontrak pemilihan alamat reservasi — KARTU-FIRST.
 *
 * Alamat kartu adalah satu-satunya sumber kebenaran saat kartu tersedia
 * (KNOWN #338/#339). Teks dari chat/profil root hanya dipakai bila customer
 * belum punya kartu sama sekali (jalur bootstrap).
 */

export interface AddressCardLike {
  id: string;
  address?: string | null;
  landmark?: string | null;
  ongkir?: number | null;
  isPrimary?: boolean;
  [key: string]: any;
}

export interface ResolveAddressInput {
  cards: AddressCardLike[];
  selectedCardId?: string | null;
  fallbackText?: string | null;
  fallbackLandmark?: string | null;
}

export interface ResolvedAddress {
  card: AddressCardLike | null;
  address: string;
  landmark: string;
  ongkir: number | null;
}

/** Kartu target: pilihan eksplisit → primary → kartu pertama. */
export function pickAddressCard(
  cards: AddressCardLike[],
  selectedCardId?: string | null
): AddressCardLike | null {
  if (!Array.isArray(cards) || cards.length === 0) return null;
  if (selectedCardId) {
    const chosen = cards.find((c) => c.id === selectedCardId);
    if (chosen) return chosen;
  }
  return cards.find((c) => c.isPrimary) || cards[0] || null;
}

/** Nilai final alamat/landmark/ongkir yang ditampilkan di form. */
export function resolveReservationAddress({
  cards,
  selectedCardId,
  fallbackText,
  fallbackLandmark,
}: ResolveAddressInput): ResolvedAddress {
  const card = pickAddressCard(cards, selectedCardId);
  const fallbackAddress = (fallbackText || '').trim();
  const fallbackLm = (fallbackLandmark || '').trim();

  if (!card) {
    return { card: null, address: fallbackAddress, landmark: fallbackLm, ongkir: null };
  }

  return {
    card,
    address: (card.address || '').trim() || fallbackAddress,
    landmark: (card.landmark || '').trim() || fallbackLm,
    ongkir: typeof card.ongkir === 'number' ? card.ongkir : null,
  };
}

/** Form alamat read-only bila customer sudah punya kartu. */
export function isAddressFormLocked(cards: AddressCardLike[]): boolean {
  return Array.isArray(cards) && cards.length > 0;
}
