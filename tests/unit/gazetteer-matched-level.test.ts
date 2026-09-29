import { describe, it, expect } from 'vitest';
import { getGazetteerCoordinates } from '../../src/utils/gazetteer';

/**
 * #161a — Sentroid kecamatan masih membawa nama desa-pertama.
 *
 * `getGazetteerCoordinates('perum banjarmukti blok g6a buduran')` dulu mengembalikan
 * `kelurahan: 'Sidokerto'` (desa pertama kecamatan Buduran) walau customer TIDAK
 * menyebut desa itu. Konsumen tidak punya cara membedakan "customer menyebut
 * kelurahan" vs "kecamatan-only (sentroid)". Fix: flag `matchedLevel` deterministik.
 */
describe('#161a getGazetteerCoordinates — matchedLevel (anti-tebak sentroid)', () => {
  it('query kelurahan eksplisit → matchedLevel "kelurahan"', () => {
    const r = getGazetteerCoordinates('banjarkemantren buduran');
    expect(r).not.toBeNull();
    expect(r!.matchedLevel).toBe('kelurahan');
    expect(r!.kelurahan).toBe('Banjarkemantren');
  });

  it('query kecamatan-only → matchedLevel "kecamatan" (nama desa = sentroid, bukan sebutan customer)', () => {
    const r = getGazetteerCoordinates('perum banjarmukti blok g6a buduran');
    expect(r).not.toBeNull();
    expect(r!.matchedLevel).toBe('kecamatan');
    expect(r!.kecamatan).toBe('Buduran');
  });

  it('nama dual-admin polos (kelurahan==kecamatan) → flag terisi, kecamatan benar', () => {
    // "Buduran" ada sebagai kelurahan DAN kecamatan → exact-kelurahan menang.
    // Yang penting: flag ada (konsumen tak menebak) & kecamatan benar.
    const r = getGazetteerCoordinates('buduran');
    expect(r).not.toBeNull();
    expect(r!.kecamatan).toBe('Buduran');
    expect(['kelurahan', 'kecamatan']).toContain(r!.matchedLevel);
  });

  it('exact kelurahan → matchedLevel "kelurahan"', () => {
    const r = getGazetteerCoordinates('sidokerto buduran');
    expect(r).not.toBeNull();
    expect(r!.matchedLevel).toBe('kelurahan');
    expect(r!.kelurahan).toBe('Sidokerto');
  });
});
