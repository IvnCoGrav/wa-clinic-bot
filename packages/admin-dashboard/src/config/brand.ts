/**
 * brand.ts — identitas brand tunggal untuk admin dashboard.
 *
 * Nilai di sini hanya *fallback* netral. Nama klinik yang benar milik tenant
 * dan idealnya datang dari API (`/api/admin/settings`) saat dashboard dimuat,
 * supaya satu build bisa dipakai banyak tenant. `VITE_CLINIC_NAME` tetap
 * tersedia sebagai override saat build untuk deployment khusus.
 */

const raw = (import.meta.env.VITE_CLINIC_NAME as string) || '';

export const BRAND = {
  businessName: raw || 'Klinik',
  panelName: raw ? `${raw} Panel` : 'Panel Klinik',
  initial: raw ? raw.charAt(0).toUpperCase() : 'K',
};
