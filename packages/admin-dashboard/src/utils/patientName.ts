/**
 * patientName.ts — penyajian nama PASIEN untuk kartu kalender.
 *
 * Kenapa terpisah dari `resolveStaffName.staffDisplayName()`:
 * daftar gelar pasien ("Bunda", "Ibu", "Mama", "Moms") berbeda dari daftar
 * jabatan staff ("Bidan", "Suster", "Terapis"), dan perilaku untuk nama yang
 * seluruhnya gelar juga berbeda — pasien diberi fallback "Pasien" oleh pemanggil.
 *
 * Kenapa BUKAN `cleanBundaName()` (F-28):
 * fungsi itu juga memotong nama wilayah di ekor nama. Di kalender, wilayah
 * punya baris sendiri, sehingga memotongnya berisiko memutilasi nama asli.
 */

const HONORIFIC_PREFIX =
  /^(?:bunda|ibu|ny\.?|nn\.?|sdri\.?|mama|moms?|mom|kak|kakak|mrs\.?)\s+/i;

const HONORIFIC_ONLY = /^(?:bunda|ibu|ny\.?|nn\.?|sdri\.?|mama|moms?|mom|kak|kakak|mrs\.?)$/i;

/**
 * Buang gelar sapaan di depan nama pasien.
 *
 * Mengembalikan string kosong bila nama SELURUHNYA gelar ("Bunda"), sehingga
 * pemanggil bisa memakai fallback yang jujur ("Pasien") alih-alih menampilkan
 * gelar yang tidak informatif.
 *
 * Hanya memotong bila gelar diikuti spasi + sisa nama, sehingga "Bundaku",
 * "Bunda2", dan "Ani Bunda" tidak tersentuh.
 */
export function stripHonorific(name?: string | null): string {
  if (typeof name !== 'string') return '';
  const raw = name.replace(/\s+/g, ' ').trim();
  if (!raw) return '';

  const stripped = raw.replace(HONORIFIC_PREFIX, '').trim();
  if (!stripped) return '';
  return HONORIFIC_ONLY.test(stripped) ? '' : stripped;
}
