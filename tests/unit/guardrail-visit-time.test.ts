import { describe, it, expect } from 'vitest';
import { detectVisitTimeQuestion } from '../../src/v3/agent/pipeline/guardrail-pipeline';

/**
 * Fase 3 sesi 614425: Aturan Emas melarang chatbot menanyakan JAM kunjungan
 * spesifik. Detektor ini adalah jaring pengaman deterministik pasca-Call-2.
 */
describe('Guardrail — deteksi pertanyaan jam kunjungan (sesi 614425)', () => {
  it('menangkap balasan yang menanyakan jam spesifik', () => {
    expect(detectVisitTimeQuestion('bolehkah Bunda konfirmasi jam kunjungan yang diinginkan?')).toBe(true);
    expect(detectVisitTimeQuestion('mau jam berapa ya Bunda?')).toBe(true);
    expect(detectVisitTimeQuestion('pukul berapa kira-kira?')).toBe(true);
    expect(detectVisitTimeQuestion('silahkan pilih jam kedatangan')).toBe(true);
  });

  it('lolos untuk balasan yang menanyakan HARI (bukan jam)', () => {
    expect(detectVisitTimeQuestion('rencana mau kami jadwalkan di hari apa ya Bunda? 🙏')).toBe(false);
    expect(detectVisitTimeQuestion('Baik Bunda, jadwalnya akan kami konfirmasi oleh tim Bidan ya 🌸')).toBe(false);
  });

  it('lolos untuk balasan informatif soal jam operasional', () => {
    expect(detectVisitTimeQuestion('Jam operasional klinik kami 08.00-17.00 WIB ya Bunda.')).toBe(false);
  });

  it('aman untuk input kosong', () => {
    expect(detectVisitTimeQuestion('')).toBe(false);
    expect(detectVisitTimeQuestion('   ')).toBe(false);
  });
});
