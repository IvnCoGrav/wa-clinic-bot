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

export function formatRupiah(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return '—';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}
