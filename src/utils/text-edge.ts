/**
 * Pembersihan tepi token untuk pencocokan kata utuh.
 *
 * Membuang semua karakter non-alfanumerik di awal dan akhir string. Yang
 * dianggap alfanumerik HANYA `a-z` dan `0-9` (perilaku historis tiga pemanggil
 * lama: pronoun-validator, persona intent extractor, lead-greeting detector).
 * Karena itu pemanggil WAJIB men-lowercase input lebih dulu; huruf besar
 * sengaja tidak dianggap alfanumerik agar perilaku lama tidak berubah.
 *
 * Bukan mutilasi kalimat: fungsi ini hanya membersihkan token hasil `split(' ')`
 * sebelum dibandingkan dengan himpunan kata, tidak pernah mengubah teks balasan.
 */
export function stripNonAlnumEdges(input: string): string {
  let s = input;
  while (s.length > 0) {
    const c = s.charCodeAt(0);
    if ((c >= 48 && c <= 57) || (c >= 97 && c <= 122)) break;
    s = s.slice(1);
  }
  while (s.length > 0) {
    const c = s.charCodeAt(s.length - 1);
    if ((c >= 48 && c <= 57) || (c >= 97 && c <= 122)) break;
    s = s.slice(0, -1);
  }
  return s;
}
