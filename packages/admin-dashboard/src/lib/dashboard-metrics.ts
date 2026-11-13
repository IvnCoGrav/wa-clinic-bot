/**
 * Helper murni untuk kalkulasi dan validasi metrik dashboard (audit anti-slop).
 * Bebas efek samping — mudah diuji unit test offline.
 */

export function pickNumber(val: unknown, fallback: number | null = null): number | null {
  if (typeof val === 'number' && !isNaN(val) && isFinite(val)) {
    return val;
  }
  return fallback;
}

export function hasChartData(data: Array<{ revenue?: number; bookings?: number }>): boolean {
  if (!Array.isArray(data) || data.length === 0) return false;
  return data.some((item) => (item.revenue && item.revenue > 0) || (item.bookings && item.bookings > 0));
}

/**
 * Dipertahankan sebagai re-export agar pemanggil lama tidak rusak. Implementasi
 * tunggal ada di `utils/money.ts` supaya nominal di dashboard, invoice, dan chat
 * tidak lagi berbeda format.
 */
export { formatRupiah } from '../utils/money';
