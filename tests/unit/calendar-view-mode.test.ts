import { describe, expect, it } from 'vitest';
import {
  VIEW_MODE_OPTIONS,
  isCalendarView,
  nextStatusForView,
} from '../../packages/admin-dashboard/src/utils/calendarViewMode';

/**
 * F-47: aturan reset status saat ganti view sebelumnya ditulis 5 kali
 * (1 dropdown + 4 tombol). Test ini mengunci satu-satunya aturan yang sah,
 * sehingga salinan yang menyimpang tidak bisa lolos lagi.
 */
describe('nextStatusForView — aturan reset status tunggal (F-47)', () => {
  it('pindah ke mode tabel: "all" menjadi "upcoming"', () => {
    expect(nextStatusForView('table', 'all')).toBe('upcoming');
  });

  it('pindah ke mode tabel: status spesifik TIDAK diubah', () => {
    for (const status of ['upcoming', 'hold', 'confirmed', 'completed', 'pending', 'overdue']) {
      expect(nextStatusForView('table', status)).toBe(status);
    }
  });

  it('pindah ke mode kalender: "upcoming" menjadi "all" (tanggal lampau tidak kosong)', () => {
    for (const mode of ['day', 'week', 'month'] as const) {
      expect(nextStatusForView(mode, 'upcoming')).toBe('all');
    }
  });

  it('pindah ke mode kalender: status lain dibiarkan apa adanya', () => {
    for (const status of ['all', 'hold', 'confirmed', 'completed']) {
      expect(nextStatusForView('week', status)).toBe(status);
    }
  });

  it('idempoten: menerapkan aturan dua kali tidak mengubah hasil', () => {
    const once = nextStatusForView('table', 'all');
    expect(nextStatusForView('table', once)).toBe(once);
    const back = nextStatusForView('day', once);
    expect(nextStatusForView('day', back)).toBe(back);
  });
});

describe('VIEW_MODE_OPTIONS — kontrak daftar mode', () => {
  it('berisi 4 mode unik dengan label tidak kosong', () => {
    expect(VIEW_MODE_OPTIONS).toHaveLength(4);
    expect(new Set(VIEW_MODE_OPTIONS.map((o) => o.mode)).size).toBe(4);
    for (const opt of VIEW_MODE_OPTIONS) {
      expect(opt.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('memuat tepat mode yang dipakai halaman (table, day, week, month)', () => {
    expect(VIEW_MODE_OPTIONS.map((o) => o.mode)).toEqual(['table', 'day', 'week', 'month']);
  });

  it('label konsisten dengan istilah UI (Tabel, bukan "List")', () => {
    expect(VIEW_MODE_OPTIONS.find((o) => o.mode === 'table')?.label).toBe('Tabel');
  });
});

describe('isCalendarView', () => {
  it('tabel bukan kalender; tiga mode lain kalender', () => {
    expect(isCalendarView('table')).toBe(false);
    expect(isCalendarView('day')).toBe(true);
    expect(isCalendarView('week')).toBe(true);
    expect(isCalendarView('month')).toBe(true);
  });
});
