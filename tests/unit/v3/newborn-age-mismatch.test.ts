import { describe, it, expect } from 'vitest';
import { hasNewbornAgeMismatch } from '../../../src/v3/guardrails/factual-claim-validator';

/**
 * Gerbang deterministik anti-salah-usia (insiden Rizky 6285236127747):
 * anak 19 bulan DILARANG ditawari layanan "Newborn" (0-6 bln).
 * Prompt "DILARANG..." rapuh → ini gerbang kode murni.
 */
describe('hasNewbornAgeMismatch — gate kode usia vs layanan Newborn', () => {
  it('usia 19 bulan + balasan memuat "Newborn" → mismatch (true)', () => {
    expect(hasNewbornAgeMismatch('Kami sarankan *Kala Baby – Pijat Ceria Newborn* ya Bunda', 19)).toBe(true);
    expect(hasNewbornAgeMismatch('paket newborn cocok untuk si kecil', 12)).toBe(true);
  });

  it('usia ≤ 6 bulan + "Newborn" → BUKAN mismatch (relevan)', () => {
    expect(hasNewbornAgeMismatch('Kami sarankan Pijat Ceria Newborn ya Bunda', 3)).toBe(false);
    expect(hasNewbornAgeMismatch('paket newborn', 6)).toBe(false);
  });

  it('usia belum diketahui → false (jangan blok, tunggu klarifikasi)', () => {
    expect(hasNewbornAgeMismatch('paket newborn', null)).toBe(false);
    expect(hasNewbornAgeMismatch('paket newborn', undefined)).toBe(false);
    expect(hasNewbornAgeMismatch('paket newborn', NaN)).toBe(false);
  });

  it('usia > 6 bulan tanpa kata "Newborn" → false (tidak salah-tembak)', () => {
    expect(hasNewbornAgeMismatch('Kami sarankan Pijat Lahap Juara ya Bunda', 19)).toBe(false);
    expect(hasNewbornAgeMismatch('', 19)).toBe(false);
  });
});
