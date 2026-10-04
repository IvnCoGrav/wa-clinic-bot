import { describe, it, expect } from 'vitest';
import { ensureRepromptClosingCta, hasClosingCta } from '../../src/v3/agent/pipeline/guardrail-pipeline';

/**
 * Fase 5 (Reprompt continuity): bila pertanyaan usia/jam dihapus, balasan
 * DILARANG berakhir buntu. Gerbang deterministik menempel CTA penutup bila
 * tidak ada pertanyaan/ajakan. Bukan larangan teks prompt.
 */
describe('age reprompt closing CTA', () => {
  it('deteksi balasan tanpa CTA (dead-end)', () => {
    expect(hasClosingCta('Baik Bunda, untuk pijat si kecil kami siap bantu.')).toBe(false);
    expect(hasClosingCta('Baik Bunda, mau kami bantu carikan jadwalnya?')).toBe(true);
  });

  it('balasan buntu ditambahi CTA penutup', () => {
    const out = ensureRepromptClosingCta(
      'Baik Bunda, untuk pijat si kecil kami siap bantu.',
      'Mau kami bantu cekkan ketersediaan jadwal hari kunjungan Bunda? 😊'
    );
    expect(out).toContain('cekkan ketersediaan jadwal');
  });

  it('balasan yang sudah punya CTA tidak ditambahi', () => {
    const good = 'Baik Bunda, untuk pijat si kecil kami siap bantu. Apakah Bunda ingin kami carikan jadwalnya?';
    expect(ensureRepromptClosingCta(good, 'TAMBAHAN')).toBe(good);
  });

  it('adversarial 4 ragam statement-only → semua dapat CTA', () => {
    const drafts = [
      'Baik Bunda, untuk pijat si kecil kami siap bantu.',
      'Perawatan tersebut aman untuk usia si kecil.',
      'Kami bisa bantu menyiapkan perlengkapannya.',
      'Terima kasih atas informasinya Bunda.',
    ];
    for (const d of drafts) {
      const out = ensureRepromptClosingCta(d, 'Mau kami bantu jadwalkan di hari apa ya Bunda?');
      expect(out, d).toContain('Mau kami bantu jadwalkan');
    }
  });
});
