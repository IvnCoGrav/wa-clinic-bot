/**
 * Kunci tanggal untuk penamaan file log harian (`YYYY-MM-DD`).
 *
 * Mempertahankan perilaku historis logger: komponen tanggal diambil dari zona
 * waktu lokal server, bukan WIB. Jangan diubah ke WIB tanpa migrasi nama file
 * log lama yang sudah tersimpan di disk.
 */
export function getLogDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
