import { describe, it, expect } from 'vitest';
import { buildScheduleCta } from '../../src/v3/tools/calculate-delivery.tool';
import { replaceTreatmentAmnesia, hasTreatmentQuestion } from '../../src/v3/agent/pipeline/guardrail-pipeline';

/**
 * Fase 4 (Delivery anti-amnesia): setelah paket dipilih/hitung ongkir, bot
 * DILARANG menanyakan "rencana mau perawatan apa" lagi. Gerbang deterministik
 * mengganti kalimat amnesia dengan CTA state-aware (tanya hari / cek jadwal).
 */
describe('delivery treatment awareness', () => {
  it('buildScheduleCta dengan treatment → tanya hari, bukan "perawatan apa"', () => {
    const cta = buildScheduleCta({ candidateTreatmentName: 'Kala Baby – Pijat Ceria', hasCartItems: true });
    expect(cta).toContain('Pijat Ceria');
    expect(cta.toLowerCase()).not.toContain('mau ambil perawatan apa');
  });

  it('deteksi kalimat amnesia treatment', () => {
    expect(hasTreatmentQuestion('Area Sedati masuk jangkauan. Rencana mau ambil perawatan apa untuk si kecil atau Bunda? 🤗')).toBe(true);
    expect(hasTreatmentQuestion('Untuk layanan *Pijat Ceria*, rencana mau kami bantu jadwalkan di hari apa ya Bunda?')).toBe(false);
  });

  it('replaceTreatmentAmnesia menukar kalimat amnesia dengan CTA hari', () => {
    const amnesia = 'Area Sedati masuk dalam area jangkauan layanan homecare Bidan kami ya Bunda.\n\nRencana mau ambil perawatan apa untuk si kecil atau Bunda? 🤗';
    const out = replaceTreatmentAmnesia(amnesia, 'Untuk layanan *Pijat Ceria*, rencana mau kami bantu jadwalkan di hari apa ya Bunda? 🙏😊');
    expect(out.toLowerCase()).not.toContain('mau ambil perawatan apa');
    expect(out).toContain('Pijat Ceria');
    expect(out).toContain('hari apa');
  });

  it('tanpa kalimat amnesia → tidak diubah', () => {
    const good = 'Area Sedati masuk dalam area jangkauan layanan homecare Bidan kami ya Bunda. Rencana mau kami bantu jadwalkan di hari apa ya Bunda?';
    expect(replaceTreatmentAmnesia(good, 'X')).toBe(good);
  });
});
