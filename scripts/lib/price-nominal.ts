/**
 * price-nominal.ts — Parser nominal rupiah untuk scorer D1 (Akurasi Harga).
 *
 * Pure function, tanpa dependensi — aman di-import dari test maupun harness.
 * Aturan: nominal HANYA diakui bila ada penanda eksplisit (prefix Rp/IDR,
 * suffix rb/ribu/k/jt/juta, atau format ribuan bertitik >= 10.000).
 * Angka tanggal/jam/durasi/usia/suhu (26, 2026, 10, 40, 38.2, 14) BUKAN nominal.
 */

/** Ekstrak daftar nominal rupiah (integer) dari teks bebas. */
export function parseNominalRibu(text: string): number[] {
  const out: number[] = [];

  // 1. Nominal dengan prefix Rp/IDR eksplisit: "Rp 60.000", "Rp.15000", "Rp 60k", "IDR 100rb"
  const prefixMatches = text.match(/(?:rp\.?|idr)\s*(\d{1,3}(?:\.\d{3})+|\d+)\s*(rb|ribu|k|jt|juta)?/gi) || [];
  for (const raw of prefixMatches) {
    const cleaned = raw.replace(/(?:rp\.?|idr)\s*/i, '').replace(/\./g, '');
    const m = /^(\d+)\s*(rb|ribu|k|jt|juta)?$/i.exec(cleaned.trim());
    if (m) {
      let n = Number(m[1]);
      const unit = (m[2] || '').toLowerCase();
      if (unit === 'rb' || unit === 'ribu' || unit === 'k') n *= 1000;
      if (unit === 'jt' || unit === 'juta') n *= 1_000_000;
      if (n >= 1000) out.push(n);
    }
  }

  // 2. Nominal dengan suffix satuan eksplisit tanpa Rp: "60rb", "100ribu", "65k", "2juta"
  // Guard pecahan desimal: "1.5 juta" TIDAK boleh dibaca "5 juta" (rule 4 yang menangani)
  const suffixRe = /\b(\d+)\s*(rb|ribu|k|jt|juta)\b/gi;
  let sm: RegExpExecArray | null;
  while ((sm = suffixRe.exec(text)) !== null) {
    if (/[.,]\d*$/.test(text.slice(0, sm.index))) continue;
    const m = /^(\d+)\s*(rb|ribu|k|jt|juta)$/i.exec(sm[0].trim());
    if (m) {
      let n = Number(m[1]);
      const unit = m[2].toLowerCase();
      if (unit === 'rb' || unit === 'ribu' || unit === 'k') n *= 1000;
      if (unit === 'jt' || unit === 'juta') n *= 1_000_000;
      if (n >= 1000 && !out.includes(n)) out.push(n);
    }
  }

  // 3. Format desimal ribuan harga standar (>= 10.000): "60.000", "165.000" (bukan tahun "2026", bukan jam "10.30")
  const dotMatches = text.match(/\b(\d{2,3})\.(\d{3})\b/g) || [];
  for (const raw of dotMatches) {
    const n = Number(raw.replace(/\./g, ''));
    if (n >= 10000 && n <= 10000000 && !out.includes(n)) out.push(n);
  }

  // 4. Desimal dengan satuan: "1.5 juta", "2.5jt", "1,5 rb"
  const decimalUnitMatches = text.match(/(\d+)[.,](\d+)\s*(rb|ribu|k|jt|juta)\b/gi) || [];
  for (const raw of decimalUnitMatches) {
    const m = /^(\d+)[.,](\d+)\s*(rb|ribu|k|jt|juta)$/i.exec(raw.trim());
    if (m) {
      const n = Number(m[1] + '.' + m[2]);
      const unit = m[3].toLowerCase();
      let val = n;
      if (unit === 'rb' || unit === 'ribu' || unit === 'k') val *= 1000;
      if (unit === 'jt' || unit === 'juta') val *= 1_000_000;
      const rounded = Math.round(val);
      if (rounded >= 1000 && !out.includes(rounded)) out.push(rounded);
    }
  }

  return out;
}
