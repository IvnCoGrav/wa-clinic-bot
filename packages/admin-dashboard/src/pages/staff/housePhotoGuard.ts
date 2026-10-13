/**
 * housePhotoGuard.ts
 * Helper logika murni untuk deteksi kebutuhan foto rumah dan penentuan mode modal lokasi (view vs edit).
 * Dipisahkan agar stateless, mudah diuji secara otomatis (unit-test), dan dapat digunakan bersama
 * oleh tampilan StaffToday (HP Bidan) dan TodayTreatments (Dashboard Admin).
 */

export interface TaskWithAddressLocation {
  address?: {
    housePhotoUrl?: string | null;
    lat?: number | null;
    lng?: number | null;
    landmark?: string | null;
    addressDetail?: string | null;
  } | null;
}

/**
 * Menentukan apakah tugas kunjungan masih membutuhkan foto rumah.
 * Mengembalikan true jika foto rumah belum diunggah atau kosong.
 */
export function needsHousePhoto(t?: TaskWithAddressLocation | null): boolean {
  const photo = t?.address?.housePhotoUrl;
  return !photo || typeof photo !== 'string' || photo.trim().length === 0;
}

/**
 * Menentukan mode modal lokasi:
 * - 'edit' jika foto rumah belum ada (agar kamera & form langsung siap 1-tap tanpa harus klik tombol Edit lagi).
 * - 'view' jika foto rumah sudah tersimpan lengkap.
 */
export function resolveLocModalMode(t?: TaskWithAddressLocation | null): 'view' | 'edit' {
  if (needsHousePhoto(t)) {
    return 'edit';
  }
  return 'view';
}
