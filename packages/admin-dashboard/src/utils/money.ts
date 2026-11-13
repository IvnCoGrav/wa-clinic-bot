/**
 * Satu-satunya sumber format uang di dashboard.
 *
 * Dulu ada 11 definisi lokal dengan perilaku berbeda: ada yang mengembalikan
 * `'0'`, ada yang `'—'`, ada yang memakai `Intl` mata uang (menyisipkan spasi
 * non-breaking), ada yang hanya menempel `'Rp '`. Akibatnya nominal yang sama
 * bisa tampil berbeda di chat, invoice, dan laporan.
 */

/** Format rupiah penuh tanpa desimal. Contoh: `Rp 1.500.000`. */
export function formatRupiah(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  // Rupiah tidak memakai subunit di praktik klinik, jadi dibulatkan ke satuan
  // penuh. Nominal sangat kecil memakai formatRupiahPresisi.
  return 'Rp ' + n.toLocaleString('id-ID', { maximumFractionDigits: 0 });
}

/**
 * Khusus nominal sangat kecil (biaya token LLM) yang bisa berada di bawah Rp 1.
 * Tanpa ini, biaya Rp 0,42 akan tampil "Rp 0" dan terlihat seperti gratis.
 */
export function formatRupiahPresisi(
  value: number | string | null | undefined,
  maxFractionDigits = 2
): string {
  if (value === null || value === undefined || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return (
    'Rp ' +
    n.toLocaleString('id-ID', {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxFractionDigits,
    })
  );
}

/** Ringkas untuk kartu sempit. Contoh: `Rp 1,5 jt`, `Rp 250 rb`. */
export function formatRupiahRingkas(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000_000) {
    return `${sign}Rp ${(abs / 1_000_000_000).toFixed(1).replace('.0', '').replace('.', ',')} M`;
  }
  if (abs >= 1_000_000) {
    return `${sign}Rp ${(abs / 1_000_000).toFixed(1).replace('.0', '').replace('.', ',')} jt`;
  }
  if (abs >= 1_000) return `${sign}Rp ${Math.round(abs / 1000)} rb`;
  return `${sign}Rp ${abs}`;
}

/** Nol berarti gratis, bukan "Rp 0" — dipakai di katalog dan invoice. */
export function formatGratis(value: number | string | null | undefined, freeLabel = 'Gratis'): string {
  const n = Number(value);
  if (value !== null && value !== undefined && Number.isFinite(n) && n === 0) return freeLabel;
  return formatRupiah(value);
}
