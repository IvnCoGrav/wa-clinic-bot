import { describe, it, expect } from 'vitest';
import { isTypoAtMostOne } from '../../src/utils/typo-match';
import { hasNewLocationEntity } from '../../src/v3/tools/tool-masker';

describe('typo-match shared util (Fase 2)', () => {
  it('isTypoAtMostOne identik true', () => {
    expect(isTypoAtMostOne('bungurasih', 'bungurasih')).toBe(true);
  });
  it('1-huruf beda true (bungurasi vs bungurasih)', () => {
    expect(isTypoAtMostOne('bungurasi', 'bungurasih')).toBe(true);
  });
  it('2-huruf beda false', () => {
    expect(isTypoAtMostOne('bungurasi', 'bunguraxxh')).toBe(false);
  });
  it('kecamatan pendek waru membuka via exact (fail-open disengaja)', () => {
    expect(hasNewLocationEntity('waru')).toBe(true);
  });
  it('typo kelurahan bungurasi membuka calculate_delivery', () => {
    expect(hasNewLocationEntity('di bungurasi')).toBe(true);
  });
  it('typo kecamatan sedatigede vs sedati gede membuka', () => {
    // tokenisasi: sedatigede (10) vs sedati (7) — jarak edit >1, jadi harus via token split
    expect(hasNewLocationEntity('sedati gede')).toBe(true);
  });
  it('kota luar malang membuka via outside-city (bukan typo)', () => {
    expect(hasNewLocationEntity('malang kak')).toBe(true);
  });
  it('sapaan murni tidak membuka', () => {
    expect(hasNewLocationEntity('halo kak')).toBe(false);
  });
  it('typo 2-huruf tetap false (bungurasxx)', () => {
    // bungurasxx vs bungurasih = 2+ edit → false, tapi mungkin tetap false karena tidak match token lain
    expect(isTypoAtMostOne('bungurasxx', 'bungurasih')).toBe(false);
  });
});
