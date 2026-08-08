import { describe, it, expect } from 'vitest';
import {
  stripNonIndonesianScripts,
  containsForeignScripts,
} from '../../src/utils/language-sanitizer';

describe('language-sanitizer (anti bocor aksara asing)', () => {
  it('membuang karakter Mandarin dari tengah kalimat Indonesia', () => {
    const input = 'Boleh tahu大概 lokasinya di mana ya, Bund? Supaya bisa bantu informasikan';
    const out = stripNonIndonesianScripts(input);
    expect(out).not.toContain('大概');
    expect(out).toContain('Boleh tahu');
    expect(out).toContain('lokasinya di mana');
  });

  it('membersihkan Kanji Jepang & Hangul Korea', () => {
    expect(stripNonIndonesianScripts('あいう karena itu にほん')).toBe(' karena itu ');
    expect(stripNonIndonesianScripts('안녕 halo')).toBe(' halo');
  });

  it('membersihkan karakter Cyrillic (Rusia)', () => {
    expect(stripNonIndonesianScripts('привет selamat')).toBe(' selamat');
  });

  it('tidak mengubah teks Indonesia asli (latin + angka + emoji)', () => {
    const clean = 'Halo Bunda, harganya Rp60.000 untuk 40 menit ya 🙏🏻';
    expect(stripNonIndonesianScripts(clean)).toBe(clean);
    expect(containsForeignScripts(clean)).toBe(false);
  });

  it('containsForeignScripts mendeteksi aksara asing', () => {
    expect(containsForeignScripts('lokasi大概')).toBe(true);
    expect(containsForeignScripts('lokasi')).toBe(false);
    expect(containsForeignScripts('')).toBe(false);
    expect(containsForeignScripts(null as any)).toBe(false);
  });

  it('handle null/empty dengan aman', () => {
    expect(stripNonIndonesianScripts('')).toBe('');
    expect(stripNonIndonesianScripts(null as any)).toBeNull();
    expect(stripNonIndonesianScripts(undefined as any)).toBeUndefined();
  });
});