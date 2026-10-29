/**
 * reservationQuery.ts — kontrak TUNGGAL parameter `GET /api/admin/reservations`.
 *
 * Kenapa file ini ada (F-42):
 * Sebelumnya parameter query disusun di dalam komponen dengan **dua blok if
 * terpisah** (mode tabel vs mode kalender). Blok kalender tidak mengirim
 * `status`, sehingga chip "Terjadwal / Pending / Hold / Selesai" di atas
 * kalender **tidak menyaring apa pun** — admin bisa mengira sedang melihat
 * "hanya Hold" padahal semua status tampil. API sendiri sudah mendukung
 * `status` bersama `startDate`/`endDate`.
 *
 * Dengan satu fungsi murni:
 * - Perbedaan antar mode menjadi eksplisit dan bisa diuji.
 * - Celah "satu cabang lupa mengirim parameter" tidak bisa terulang tanpa
 *   membuat test gagal.
 *
 * Sengaja TANPA React dan TANPA `fetch` agar bisa diuji di lingkungan node.
 */

export const CALENDAR_FETCH_LIMIT = 500;

export type ReservationsViewMode = 'week' | 'day' | 'month' | 'table';

export interface ReservationQueryFilters {
  status?: string | null;
  staffId?: string | null;
  category?: string | null;
  searchQuery?: string | null;
}

export interface BuildReservationsQueryInput {
  viewMode: ReservationsViewMode;
  filters: ReservationQueryFilters;
  /** Hanya dipakai mode tabel. */
  page?: number;
  pageSize?: number;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  /** Hanya dipakai mode kalender (rentang hari/minggu/bulan yang terlihat). */
  range?: { startDate: string; endDate: string } | null;
}

/** Nilai yang berarti "jangan saring" — dibandingkan setelah trim. */
const TANPA_FILTER = 'all';

function nilaiFilter(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === TANPA_FILTER) return null;
  return trimmed;
}

export function buildReservationsQuery(input: BuildReservationsQueryInput): URLSearchParams {
  const params = new URLSearchParams();
  const isTable = input.viewMode === 'table';
  const filters = input.filters || {};

  if (isTable) {
    params.set('page', String(input.page ?? 1));
    params.set('pageSize', String(input.pageSize ?? 20));
  } else {
    // Kalender mengambil satu jendela penuh untuk rentang tanggal yang terlihat.
    params.set('page', '1');
    params.set('pageSize', String(CALENDAR_FETCH_LIMIT));
  }

  // F-42: status berlaku di KEDUA mode.
  const status = nilaiFilter(filters.status);
  if (status) params.set('status', status);

  const staffId = nilaiFilter(filters.staffId);
  // 'unassigned' adalah filter sah ("Belum Ada Terapis"), bukan "all".
  if (staffId) params.set('staffId', staffId);

  const category = nilaiFilter(filters.category);
  if (category) params.set('category', category);

  const search = typeof filters.searchQuery === 'string' ? filters.searchQuery.trim() : '';
  if (search) params.set('search', search);

  if (isTable) {
    params.set('sortBy', input.sortField || 'booking_date');
    params.set('sortOrder', input.sortOrder === 'desc' ? 'desc' : 'asc');
  } else if (input.range && input.range.startDate && input.range.endDate) {
    params.set('startDate', input.range.startDate);
    params.set('endDate', input.range.endDate);
  }

  return params;
}
