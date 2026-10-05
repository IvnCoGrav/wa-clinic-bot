import { describe, it, expect } from 'vitest';
import { hasAgeQuestion } from '../../../src/v3/agent/pipeline/guardrail-pipeline';

/**
 * Gerbang anti-todong usia (insiden Rizky): pola lama hanya kenal kata "usia",
 * sehingga "umur si kecil berapa?" lolos dari SEMUA gerbang usia.
 * Kontrol ini deterministik (pola teknis sapaan bot), bukan hafalan kalimat user.
 */
describe('hasAgeQuestion — deteksi todong usia lintas leksikon (usia/umur)', () => {
  it('ragam "umur" terdeteksi', () => {
    expect(hasAgeQuestion('umur si kecil berapa?')).toBe(true);
    expect(hasAgeQuestion('kalau boleh tahu umurnya berapa ya Bunda?')).toBe(true);
    expect(hasAgeQuestion('umur anak berapa bulan?')).toBe(true);
    expect(hasAgeQuestion('berapa umur si kecil ya?')).toBe(true);
  });

  it('ragam "usia" tetap terdeteksi', () => {
    expect(hasAgeQuestion('usianya berapa bulan atau berapa tahun ya Bunda?')).toBe(true);
    expect(hasAgeQuestion('usia si kecil berapa?')).toBe(true);
    expect(hasAgeQuestion('berapa bulan usia anak?')).toBe(true);
  });

  it('kalimat tanpa todong usia → false', () => {
    expect(hasAgeQuestion('Baik Bunda, kami bantu cek jadwalnya ya 😊')).toBe(false);
    expect(hasAgeQuestion('Layanan ini untuk bayi usia aktif')).toBe(false);
    expect(hasAgeQuestion('')).toBe(false);
  });
});
