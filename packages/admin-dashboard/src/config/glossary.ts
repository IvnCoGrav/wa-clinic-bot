/**
 * Glosarium istilah kanonik dashboard klinik.
 *
 * Keputusan produk 2026-11-10:
 * - **Pasien** — bukan Customer/Pelanggan. "Customer" hanya boleh muncul di nama
 *   teknis (tabel, endpoint, tipe data), bukan di teks yang dibaca staf.
 * - **Layanan** — bukan Treatment. "Treatment" tetap istilah klinis internal di
 *   database dan dokumentasi medis.
 * - **Terapis** — bukan Staf/Bidan saat merujuk peran yang mengunjungi pasien.
 *   "Bidan" tetap dipakai bila memang menyebut profesi.
 * - **Ongkir** — bukan "tarif pengiriman"/"ongkos kirim" di label UI.
 *
 * Modul yang belum dimigrasikan tetap boleh memakai istilah lama sampai
 * pemanggil terakhirnya dipindah (pola seam kanonis, satu arah).
 */

export const GLOSSARY = {
  patient: 'Pasien',
  service: 'Layanan',
  therapist: 'Terapis',
  deliveryFee: 'Ongkir',
  schedule: 'Jadwal',
  reservation: 'Reservasi',
  invoice: 'Invoice',
} as const;

/** Label UI siap pakai untuk istilah yang sering berulang. */
export const UI_TERMS = {
  patientDatabase: 'Database Pasien',
  patientLabels: 'Label Pasien',
  serviceCatalog: 'Katalog Layanan & Harga',
  therapistAccounts: 'Terapis & Akun Pengguna',
  serviceToday: 'Layanan Hari Ini',
} as const;
