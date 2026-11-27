/**
 * Helper test: membaca komponen tanggal/jam sebuah `Date` dalam zona WIB.
 *
 * Parser reservasi mengembalikan INSTANT yang benar (contoh 09:00 WIB = 02:00 UTC),
 * jadi assertion tidak boleh memakai getter lokal (`getHours()`), karena hasilnya
 * bergantung zona waktu mesin: di laptop WIB lulus, di runner CI (UTC) gagal
 * dengan pesan menyesatkan seperti "expected 2 to be 9".
 */
export function wibParts(date: Date): {
  year: number;
  month: number;
  date: number;
  day: number;
  hours: number;
  minutes: number;
} {
  const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate(),
    day: shifted.getUTCDay(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
  };
}
