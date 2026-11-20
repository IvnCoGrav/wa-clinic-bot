/**
 * features.ts
 * Gerbang rollout fitur di Admin Dashboard. Nilai dibaca saat build (Vite),
 * jadi perubahan flag memerlukan rebuild dashboard.
 */

/**
 * F8: portal mobile bidan (Raport Saya). Default OFF — raport hanya dibuka
 * lewat dashboard admin sampai owner memvalidasi angka satu periode penuh.
 * Aktifkan dengan build-arg/env `VITE_SCORECARD_STAFF_UI_ENABLED=true`
 * (backend juga wajib `SCORECARD_STAFF_UI_ENABLED=true`).
 */
export const SCORECARD_STAFF_UI_ENABLED =
  String(import.meta.env.VITE_SCORECARD_STAFF_UI_ENABLED || '')
    .trim()
    .toLowerCase() === 'true';
