/**
 * brand.ts — identitas brand tunggal untuk admin dashboard.
 * Dipakai konsisten di seluruh UI. Nilai bisa di-override dari env saat build.
 */

const raw = (import.meta.env.VITE_CLINIC_NAME as string) || '';

export const BRAND = {
  businessName: raw || 'Kala Moms and Baby Spa',
  panelName: raw ? `${raw} Panel` : 'Kala Moms & Baby Spa Panel',
  initial: raw ? raw.charAt(0).toUpperCase() : 'K',
};
