/**
 * Prefill & pemilihan data anak dari profil customer (KNOWN #340).
 *
 * Anak tersimpan di tabel `children` (kunci `customer_id + name_norm`) dan
 * payload detail customer menghidrasi `current_age`. Form reservasi memakai
 * daftar itu agar staf tidak mengetik ulang setiap booking.
 */

export interface BabyInput {
  name: string;
  ageText: string;
}

export interface SavedChildLike {
  name?: string | null;
  current_age?: string | null;
  raw_age_text?: string | null;
  birth_date?: string | Date | null;
  [key: string]: any;
}

const norm = (v?: string | null) => String(v ?? '').trim().toLowerCase();

/** Ubah baris `children` menjadi input form (nama + usia). */
export function mapChildrenToBabyInputs(children: SavedChildLike[] | null | undefined): BabyInput[] {
  if (!Array.isArray(children)) return [];
  return children
    .filter((c) => c && typeof c.name === 'string' && c.name.trim().length > 0)
    .map((c) => ({
      name: String(c.name).trim(),
      ageText: String(c.current_age ?? c.raw_age_text ?? '').trim(),
    }));
}

/** True bila anak sudah ada di daftar input (bandingkan nama ternormalisasi). */
export function isChildSelected(babies: BabyInput[], child: SavedChildLike): boolean {
  const target = norm(child?.name);
  if (!target) return false;
  return (babies || []).some((b) => norm(b?.name) === target);
}

/** Toggle anak tersimpan: sudah dipilih → hapus, belum → tambah. */
export function toggleChildSelection(babies: BabyInput[], child: SavedChildLike): BabyInput[] {
  const target = norm(child?.name);
  if (!target) return babies || [];
  if (isChildSelected(babies, child)) {
    return (babies || []).filter((b) => norm(b?.name) !== target);
  }
  const mapped = mapChildrenToBabyInputs([child])[0];
  return mapped ? [...(babies || []), mapped] : (babies || []);
}
