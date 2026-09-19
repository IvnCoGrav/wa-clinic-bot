import { describe, it, expect } from 'vitest';
import { tryParseIndonesianDate } from '../../src/utils/reservation-text-parser';

/**
 * Cross-validation kontradiksi HARI vs ANGKA TANGGAL pada parser.
 *
 * Masalah nyata: customer menulis "Selasa, 21 September 2026" padahal 21 Sep 2026
 * jatuh pada hari Senin (slip 1 hari — typo manusia yang sangat umum). Parser lama
 * buta terhadap kontradiksi ini dan menghasilkan jadwal di hari yang salah.
 *
 * Aturan: bila nama hari eksplisit tertulis DAN selisihnya tepat ±1 hari dari
 * tanggal numerik, koreksi ke tanggal yang cocok dengan nama hari (Slip-1 recovery).
 * Jika selisihnya > 1 hari (kontradiksi berat), nama hari diabaikan (tanggal numerik
 * menang) agar tidak melompat liar.
 */
describe('Parser day-date cross-validation (slip hari manusia)', () => {
  it('"Selasa, 21 September 2026" (21 Sep = Senin) → dikoreksi ke Selasa 22 Sep 2026', () => {
    const d = tryParseIndonesianDate('Selasa, 21 September 2026 jam 09.30');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(8); // September
    expect(d!.getDate()).toBe(22);
    expect(d!.getDay()).toBe(2); // Selasa
    expect(d!.getHours()).toBe(9);
    expect(d!.getMinutes()).toBe(30);
  });

  it('"Senin, 22 September 2026" (22 Sep = Selasa) → dikoreksi mundur ke Senin 21 Sep 2026', () => {
    const d = tryParseIndonesianDate('Senin, 22 September 2026 jam 10.00');
    expect(d).not.toBeNull();
    expect(d!.getMonth()).toBe(8);
    expect(d!.getDate()).toBe(21);
    expect(d!.getDay()).toBe(1); // Senin
  });

  it('hari & tanggal yang SUDAH konsisten TIDAK diubah (Selasa 22 Sep 2026 tetap)', () => {
    const d = tryParseIndonesianDate('Selasa, 22 September 2026 jam 09.30');
    expect(d).not.toBeNull();
    expect(d!.getDate()).toBe(22);
    expect(d!.getDay()).toBe(2);
  });

  it('kontradiksi > 1 hari → nama hari diabaikan, tanggal numerik menang (tidak melompat liar)', () => {
    // 21 Sep 2026 = Senin; "Kamis" berjarak 3 hari → jangan koreksi.
    const d = tryParseIndonesianDate('Kamis, 21 September 2026 jam 09.30');
    expect(d).not.toBeNull();
    expect(d!.getDate()).toBe(21);
    expect(d!.getDay()).toBe(1); // tetap Senin (tanggal numerik menang)
  });

  it('tanpa nama hari eksplisit: tanggal numerik apa adanya', () => {
    const d = tryParseIndonesianDate('21 September 2026 jam 09.30');
    expect(d).not.toBeNull();
    expect(d!.getDate()).toBe(21);
    expect(d!.getDay()).toBe(1);
  });

  it('slip hari tetap aman pada format DD-MM-YYYY (Selasa 21-09-2026 → 22-09-2026)', () => {
    const d = tryParseIndonesianDate('Selasa, 21-09-2026 jam 09.30');
    expect(d).not.toBeNull();
    expect(d!.getDate()).toBe(22);
    expect(d!.getDay()).toBe(2);
  });
});
