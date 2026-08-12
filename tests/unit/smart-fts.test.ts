import { describe, it, expect } from 'vitest';
import { sanitizeQueryForFts } from '../../src/services/knowledge.service';

describe('Smart FTS Query Sanitizer Unit Tests', () => {
  it('should strip polite greetings and normalize slang min. & brp', () => {
    const raw = 'Selamat sore. Saya ingin tanya untuk pijat bayi min. di usia brp ya?';
    const clean = sanitizeQueryForFts(raw);
    expect(clean).toBe('pijat bayi minimal usia berapa');
  });

  it('should normalize slang abbreviations (utk, bln, thn, dgn, klo)', () => {
    const raw = 'Halo kak info utk spa anak 2 bln dgn bidan brp ya thn ini';
    const clean = sanitizeQueryForFts(raw);
    expect(clean).toBe('info spa anak 2 bulan bidan berapa tahun');
  });

  it('should retain domain terms like pijat, bayi, harga, lokasi', () => {
    const raw = 'Halo bunda mau tanya harga pijat bayi di mana ya';
    const clean = sanitizeQueryForFts(raw);
    expect(clean).toBe('harga pijat bayi mana');
  });
});
