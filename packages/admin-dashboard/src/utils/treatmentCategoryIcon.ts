/**
 * treatmentCategoryIcon.ts — pemetaan `TreatmentCategory` (enum DB) → ikon.
 *
 * F-33: kartu kalender menulis kategori sebagai teks `BABY`/`MOMS`/`BOTH`/`KIDS`.
 * Di layar HP, teks itu memakan lebar yang seharusnya dipakai nama pasien/bidan.
 *
 * Catatan arsitektur:
 * - Ini **bukan** data bisnis baru. Nilai kanonisnya sudah ada di
 *   `prisma/schema.prisma` (enum `TreatmentCategory`: BABY, KIDS, MOMS, BOTH).
 *   Yang ditambahkan hanya representasi visual (ikon + label aksesibilitas).
 * - Label teks tetap disimpan agar makna ikon tidak hilang untuk pembaca layar
 *   dan tooltip (informasi tidak boleh hanya bergantung pada bentuk/warna).
 */
import { Baby, Heart, Smile, Users, type LucideIcon } from 'lucide-react';

export type TreatmentCategoryKey = 'BABY' | 'KIDS' | 'MOMS' | 'BOTH';

export interface TreatmentCategoryMeta {
  /** Label Bahasa Indonesia untuk tooltip & `aria-label`. */
  label: string;
  Icon: LucideIcon;
}

export const TREATMENT_CATEGORY_META: Record<TreatmentCategoryKey, TreatmentCategoryMeta> = {
  BABY: { label: 'Bayi', Icon: Baby },
  KIDS: { label: 'Anak', Icon: Smile },
  MOMS: { label: 'Ibu', Icon: Heart },
  BOTH: { label: 'Ibu & Anak', Icon: Users },
};

/**
 * Normalisasi nilai dari API menjadi kunci enum yang dikenal.
 * Mengembalikan `null` untuk nilai kosong/tak dikenal, sehingga pemanggil bisa
 * memilih untuk tidak menampilkan apa pun (bukan menampilkan ikon salah).
 */
export function normalizeTreatmentCategory(
  category: string | null | undefined
): TreatmentCategoryKey | null {
  if (typeof category !== 'string') return null;
  const key = category.trim().toUpperCase();
  if (!key) return null;
  // `hasOwnProperty` — bukan `in` — agar 'constructor'/'toString' tidak lolos.
  return Object.prototype.hasOwnProperty.call(TREATMENT_CATEGORY_META, key)
    ? (key as TreatmentCategoryKey)
    : null;
}

export function getTreatmentCategoryMeta(
  category: string | null | undefined
): TreatmentCategoryMeta | null {
  const key = normalizeTreatmentCategory(category);
  return key ? TREATMENT_CATEGORY_META[key] : null;
}
