/**
 * calendarCardLod.ts — keputusan "apa yang ditampilkan" pada kartu view Harian.
 *
 * F-32: tinggi kartu event dihitung dari durasi × `hourHeight`, sedangkan isinya
 * (nama + jam + kategori + status + detail + area + bidan) bisa lebih tinggi.
 * Karena kartu memakai `overflow-hidden`, kelebihan isi dipotong di BAGIAN BAWAH —
 * tepat di elemen terakhir, yaitu nama bidan penanggung jawab.
 *
 * Solusi bukan menambah padding, melainkan menyusun ulang model tata letak:
 * elemen dibuang berurutan dari prioritas terendah.
 *
 * Urutan prioritas (yang bertahan paling lama di atas):
 *   nama pasien → jam mulai → **nama bidan** → area → detail treatment
 *
 * Catatan penting: baris bidan **tidak** punya flag LOD di sini. Ia wajib selalu
 * tampil (lihat test `calendar-card-lod.test.ts`). Menambahkan flag untuk bidan
 * akan mengulang bug yang sedang diperbaiki.
 */
export interface DayCardLod {
  /** Baris detail treatment (prioritas paling rendah → dibuang pertama). */
  showDetail: boolean;
  /** Baris area/kelurahan. */
  showArea: boolean;
}

/** Ambang tinggi kartu (px). Harus AREA < DETAIL agar urutan prioritas terjaga. */
export const DAY_CARD_LOD = {
  AREA_MIN_PX: 74,
  DETAIL_MIN_PX: 96,
} as const;

export function computeDayCardLod(heightPx: number | null | undefined): DayCardLod {
  const height =
    typeof heightPx === 'number' && !Number.isNaN(heightPx) ? heightPx : 0;
  return {
    showArea: height >= DAY_CARD_LOD.AREA_MIN_PX,
    showDetail: height >= DAY_CARD_LOD.DETAIL_MIN_PX,
  };
}
