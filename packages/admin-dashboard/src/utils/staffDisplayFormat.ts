/**
 * staffDisplayFormat.ts
 * Utilitas tipografi deterministik untuk tampilan kartu tugas STAFF/CS.
 * Dipakai bersama oleh TodayTreatments (tenant) & StaffToday (staff) agar tidak
 * terjadi duplikasi/divergensi pemformatan antar halaman.
 */

/**
 * Title Case non-destruktif untuk nama pasien.
 * Hanya mengkapitalkan huruf PERTAMA tiap kata; sisa huruf TIDAK dipaksa lowercase
 * agar tidak merusak nama seperti "McDonald", "S.Pd", atau inisial yang disengaja.
 * Prefix "Bunda"/"Bunda X" dibiarkan sebagaimana adanya.
 */
export function formatPatientName(name?: string | null): string {
  if (!name) return 'Customer';
  const trimmed = name.trim();
  if (!trimmed) return 'Customer';
  return trimmed
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * Normalisasi spasi angka-satuan usia anak ("6bulan" -> "6 bulan",
 * "2thn" -> "2 thn"). Hanya menyisipkan spasi; tidak mengubah semantik angka.
 */
export function formatChildAgeText(ageText?: string | null): string {
  if (!ageText) return '';
  return ageText
    .replace(/(\d+)\s*(bulan|bln|tahun|thn|hari|hr|minggu|mgg)/gi, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}
