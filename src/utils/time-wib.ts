/**
 * time-wib.ts — Facade kompatibilitas untuk wib-time.ts.
 *
 * CFG-10: Seluruh logika dipusatkan di wib-time.ts. File ini dipertahankan
 * sebagai re-export agar seluruh call-site lama tetap berfungsi tanpa breaking change.
 */

export * from './wib-time';
