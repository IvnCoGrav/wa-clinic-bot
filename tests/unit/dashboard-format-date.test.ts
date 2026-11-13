import { describe, expect, it } from 'vitest';
import {
  formatMonthYearWib,
  formatWib,
  formatWibClock,
  formatWibDate,
} from '../../packages/admin-dashboard/src/utils/dateWib';

describe('formatWibDate', () => {
  it('mempertahankan tanggal untuk date-key murni (YYYY-MM-DD)', () => {
    // Date-key tidak boleh digeser: ini tanggal kalender, bukan instant.
    expect(formatWibDate('2026-11-10', { day: '2-digit', month: 'short', year: 'numeric' })).toBe(
      '10 Nov 2026'
    );
  });

  it('menggeser ke tanggal WIB untuk timestamp UTC malam hari', () => {
    // 23:30 UTC = 06:30 WIB keesokan harinya.
    expect(formatWibDate('2026-11-10T23:30:00Z', { day: '2-digit', month: 'short' })).toBe('11 Nov');
  });

  it('tidak bergantung pada zona waktu perangkat', () => {
    const original = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      expect(formatWibDate('2026-11-10T23:30:00Z', { day: '2-digit', month: 'short' })).toBe('11 Nov');
      expect(formatWibDate('2026-11-10', { day: '2-digit', month: 'short' })).toBe('10 Nov');
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('mengembalikan string kosong untuk nilai tidak valid', () => {
    expect(formatWibDate(null)).toBe('');
    expect(formatWibDate('')).toBe('');
    expect(formatWibDate('bukan tanggal')).toBe('');
  });
});

describe('formatWibClock', () => {
  it('menampilkan jam WIB untuk timestamp UTC', () => {
    // 01:30 UTC = 08:30 WIB.
    expect(formatWibClock('2026-11-10T01:30:00Z')).toMatch(/^08[.:]30$/);
  });

  it('menerima Date object dan tetap memakai WIB', () => {
    expect(formatWibClock(new Date('2026-11-10T01:30:00Z'))).toMatch(/^08[.:]30$/);
  });

  it('mengembalikan string kosong untuk nilai tidak valid', () => {
    expect(formatWibClock(null)).toBe('');
    expect(formatWibClock('bukan tanggal')).toBe('');
  });
});

describe('formatWib (alias)', () => {
  it('berperilaku sama dengan formatWibDate', () => {
    expect(formatWib('2026-11-10', { day: '2-digit', month: 'short' })).toBe('10 Nov');
  });
});

describe('formatMonthYearWib', () => {
  it('tidak pernah memindahkan label bulan', () => {
    expect(formatMonthYearWib(2026, 0)).toBe('Januari 2026');
    expect(formatMonthYearWib(2026, 11)).toBe('Desember 2026');
  });
});
