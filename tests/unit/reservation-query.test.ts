import { describe, expect, it } from 'vitest';
import {
  CALENDAR_FETCH_LIMIT,
  buildReservationsQuery,
} from '../../packages/admin-dashboard/src/utils/reservationQuery';

/**
 * F-42: filter status TIDAK berfungsi di mode kalender.
 *
 * Bukti akar masalah: `loadReservations()` hanya mengirim `status` pada cabang
 * `viewMode === 'table'`; cabang kalender tidak mengirimnya sama sekali,
 * padahal API mendukung `status` bersama `startDate`/`endDate`
 * (`src/routes/admin/reservation-crud.route.ts:236`).
 *
 * Test ini menjaga kontrak query di SATU seam (bukan dua blok if yang
 * diduplikasi di komponen), sehingga celah yang sama tidak bisa muncul lagi.
 */
const FILTER_KOSONG = { status: 'all', staffId: 'all', category: 'all', searchQuery: '' };

describe('buildReservationsQuery — mode kalender', () => {
  it('MENGIRIM status di mode kalender (inti perbaikan F-42)', () => {
    const q = buildReservationsQuery({
      viewMode: 'day',
      filters: { ...FILTER_KOSONG, status: 'hold' },
      range: { startDate: '2026-10-29', endDate: '2026-10-29' },
    });
    expect(q.get('status')).toBe('hold');
  });

  it('bekerja untuk seluruh status yang dipakai chip UI', () => {
    for (const status of ['pending', 'confirmed', 'completed', 'cancelled', 'hold', 'upcoming', 'overdue']) {
      const q = buildReservationsQuery({
        viewMode: 'week',
        filters: { ...FILTER_KOSONG, status },
      });
      expect(q.get('status')).toBe(status);
    }
  });

  it('TIDAK mengirim status untuk "all"/kosong (jangan saring apa pun)', () => {
    for (const status of ['all', '', null, undefined, '   ']) {
      const q = buildReservationsQuery({
        viewMode: 'month',
        filters: { ...FILTER_KOSONG, status: status as string | null | undefined },
      });
      expect(q.has('status')).toBe(false);
    }
  });

  it('merapikan spasi status, bukan mengubah huruf', () => {
    const q = buildReservationsQuery({
      viewMode: 'day',
      filters: { ...FILTER_KOSONG, status: '  hold  ' },
    });
    expect(q.get('status')).toBe('hold');
  });

  it('memakai jendela 500 baris, bukan pageSize tabel', () => {
    const q = buildReservationsQuery({
      viewMode: 'week',
      filters: FILTER_KOSONG,
      page: 7,
      pageSize: 20,
    });
    expect(q.get('page')).toBe('1');
    expect(q.get('pageSize')).toBe(String(CALENDAR_FETCH_LIMIT));
  });

  it('mengirim rentang tanggal hanya bila lengkap', () => {
    const lengkap = buildReservationsQuery({
      viewMode: 'week',
      filters: FILTER_KOSONG,
      range: { startDate: '2026-10-26', endDate: '2026-11-01' },
    });
    expect(lengkap.get('startDate')).toBe('2026-10-26');
    expect(lengkap.get('endDate')).toBe('2026-11-01');

    const tanpa = buildReservationsQuery({ viewMode: 'week', filters: FILTER_KOSONG });
    expect(tanpa.has('startDate')).toBe(false);
    expect(tanpa.has('endDate')).toBe(false);

    const separuh = buildReservationsQuery({
      viewMode: 'week',
      filters: FILTER_KOSONG,
      range: { startDate: '2026-10-26', endDate: '' },
    });
    expect(separuh.has('startDate')).toBe(false);
    expect(separuh.has('endDate')).toBe(false);
  });

  it('tidak mengirim sortBy/sortOrder di kalender (urutan grid = jam)', () => {
    const q = buildReservationsQuery({
      viewMode: 'day',
      filters: FILTER_KOSONG,
      sortField: 'customer',
      sortOrder: 'desc',
    });
    expect(q.has('sortBy')).toBe(false);
    expect(q.has('sortOrder')).toBe(false);
  });
});

describe('buildReservationsQuery — filter non-status', () => {
  it('mempertahankan staffId "unassigned" (bukan dianggap "all")', () => {
    const q = buildReservationsQuery({
      viewMode: 'week',
      filters: { ...FILTER_KOSONG, staffId: 'unassigned' },
    });
    expect(q.get('staffId')).toBe('unassigned');
  });

  it('membuang staffId/category "all"', () => {
    const q = buildReservationsQuery({ viewMode: 'day', filters: FILTER_KOSONG });
    expect(q.has('staffId')).toBe(false);
    expect(q.has('category')).toBe(false);
  });

  it('memangkas search dan membuang yang hanya spasi', () => {
    const rapih = buildReservationsQuery({
      viewMode: 'day',
      filters: { ...FILTER_KOSONG, searchQuery: '  Bunda Ayu  ' },
    });
    expect(rapih.get('search')).toBe('Bunda Ayu');

    const kosong = buildReservationsQuery({
      viewMode: 'day',
      filters: { ...FILTER_KOSONG, searchQuery: '   ' },
    });
    expect(kosong.has('search')).toBe(false);
  });

  it('meng-encode karakter khusus agar URL tidak rusak', () => {
    const q = buildReservationsQuery({
      viewMode: 'day',
      filters: { ...FILTER_KOSONG, searchQuery: 'Ayu & Sari + 2' },
    });
    expect(q.get('search')).toBe('Ayu & Sari + 2');
    expect(q.toString()).toContain('Ayu+%26+Sari');
  });
});

describe('buildReservationsQuery — mode tabel (jangan diregresikan)', () => {
  it('tetap mengirim page, pageSize, status, dan sort', () => {
    const q = buildReservationsQuery({
      viewMode: 'table',
      filters: { ...FILTER_KOSONG, status: 'upcoming', category: 'MOMS', staffId: 'st-1' },
      page: 3,
      pageSize: 25,
      sortField: 'created_at',
      sortOrder: 'desc',
    });
    expect(q.get('page')).toBe('3');
    expect(q.get('pageSize')).toBe('25');
    expect(q.get('status')).toBe('upcoming');
    expect(q.get('category')).toBe('MOMS');
    expect(q.get('staffId')).toBe('st-1');
    expect(q.get('sortBy')).toBe('created_at');
    expect(q.get('sortOrder')).toBe('desc');
  });

  it('memakai default sort by booking_date asc', () => {
    const q = buildReservationsQuery({ viewMode: 'table', filters: FILTER_KOSONG });
    expect(q.get('sortBy')).toBe('booking_date');
    expect(q.get('sortOrder')).toBe('asc');
  });

  it('TIDAK mengirim rentang tanggal di mode tabel', () => {
    const q = buildReservationsQuery({
      viewMode: 'table',
      filters: FILTER_KOSONG,
      range: { startDate: '2026-10-26', endDate: '2026-11-01' },
    });
    expect(q.has('startDate')).toBe(false);
    expect(q.has('endDate')).toBe(false);
  });
});
