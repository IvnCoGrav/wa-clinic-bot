import { describe, it, expect } from 'vitest';
import { getLogDateString } from '../../src/utils/log-date';

/**
 * Karakterisasi kanonis `getLogDateString`.
 *
 * Fungsi ini menentukan nama file log harian (`logs/llm-YYYY-MM-DD.jsonl`,
 * `logs/app-YYYY-MM-DD.log`). Perubahan perilaku di sini berarti file log lama
 * tidak lagi terbaca oleh panel log dashboard.
 */
describe('utils/log-date — getLogDateString', () => {
  it('memberi padding dua digit untuk bulan dan hari satu digit', () => {
    expect(getLogDateString(new Date(2026, 0, 2))).toBe('2026-01-02');
    expect(getLogDateString(new Date(2026, 8, 9))).toBe('2026-09-09');
  });

  it('menangani batas akhir bulan dan akhir tahun', () => {
    expect(getLogDateString(new Date(2026, 0, 31))).toBe('2026-01-31');
    expect(getLogDateString(new Date(2026, 11, 31))).toBe('2026-12-31');
    expect(getLogDateString(new Date(2026, 1, 28))).toBe('2026-02-28');
  });

  it('menangani tahun kabisat dengan benar', () => {
    expect(getLogDateString(new Date(2024, 1, 29))).toBe('2024-02-29');
    expect(getLogDateString(new Date(2000, 1, 29))).toBe('2000-02-29');
  });

  it('memakai komponen tanggal lokal, bukan UTC (perilaku historis dipertahankan)', () => {
    // 00:30 waktu lokal: toISOString() bisa jatuh ke hari sebelumnya di zona
    // waktu positif, tetapi nama file log harus tetap memakai hari lokal.
    const localEarlyMorning = new Date(2026, 5, 15, 0, 30, 0);
    expect(getLogDateString(localEarlyMorning)).toBe('2026-06-15');

    const localLateNight = new Date(2026, 5, 15, 23, 59, 59, 999);
    expect(getLogDateString(localLateNight)).toBe('2026-06-15');
  });

  it('deterministik: Date yang sama selalu menghasilkan string yang sama', () => {
    const d = new Date(2026, 2, 7, 12, 0, 0);
    const results = new Set(Array.from({ length: 20 }, () => getLogDateString(d)));
    expect(results.size).toBe(1);
    expect([...results][0]).toBe('2026-03-07');
  });

  it('default parameter menghasilkan tanggal hari ini dalam format YYYY-MM-DD', () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}`;
    expect(getLogDateString()).toBe(expected);
    expect(getLogDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('tidak pernah mengembalikan nilai kosong atau format longgar untuk tanggal ekstrem', () => {
    expect(getLogDateString(new Date(1970, 0, 1))).toBe('1970-01-01');
    expect(getLogDateString(new Date(2099, 11, 31))).toBe('2099-12-31');
  });
});
