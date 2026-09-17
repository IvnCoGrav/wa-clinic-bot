import { describe, it, expect } from 'vitest';
import { OutputSanitizer } from '../../../src/v3/guardrails/sanitizer';
import { LOCATION_HIERARCHY_BLOCK } from '../../../src/v3/agent/prompt/phases/location-rules.phase';
import { buildPricingCatalogBlock } from '../../../src/v3/agent/prompt/phases/pricing-catalog.phase';

/**
 * Sesi 310995 Turn 3: bot memuntahkan "*Rp [total]*" karena menyalin token
 * template dari prompt. Dua lapis pertahanan: prompt hygiene (tak ada token
 * kurung siku di contoh) + sanitizer deterministik pembersih artefak.
 */
describe('Anti-bocor placeholder sistem (sesi 310995)', () => {
  it('sanitizer membuang "*Rp [total]*" dan kalimat total fiktif', () => {
    const dirty = 'Untuk Pijat Kids Ceria, totalnya jadi *Rp [total]* ya Bunda.';
    const out = OutputSanitizer.stripSystemPlaceholders(dirty);
    expect(out).not.toMatch(/\[total\]/i);
    expect(out).not.toMatch(/Rp\s*\[/i);
    expect(out).toContain('Pijat Kids Ceria');
  });

  it('sanitizer membuang token sistem telanjang [Harga], [Nama Treatment], [jarak]', () => {
    const out = OutputSanitizer.stripSystemPlaceholders(
      'Untuk [Nama Treatment] harganya Rp [Harga] dan jarak [jarak] km.'
    );
    expect(out).not.toMatch(/\[Harga\]/i);
    expect(out).not.toMatch(/\[Nama Treatment\]/i);
    expect(out).not.toMatch(/\[jarak\]/i);
  });

  it('tidak merusak nominal/angka NYATA di tengah kalimat', () => {
    const clean = 'Total keseluruhannya menjadi *Rp 100.000* ya Bunda 😊';
    expect(OutputSanitizer.stripSystemPlaceholders(clean)).toBe(clean);
  });

  it('cleanOutboundReply ikut membersihkan placeholder (defense-in-depth)', () => {
    const out = OutputSanitizer.cleanOutboundReply(
      'Baik Bunda, totalnya jadi *Rp [total]* ya.',
      'berapa totalnya?',
      true
    );
    expect(out).not.toMatch(/\[total\]/i);
  });

  it('prompt hygiene: token *Rp [Total]* hanya muncul di baris larangan, bukan sebagai contoh', () => {
    // Token boleh disebut di kalimat "DILARANG menulis placeholder ..." (sebagai
    // penanda yang dilarang), TAPI tidak boleh ada di contoh yang dijiplak LLM.
    const offending = [LOCATION_HIERARCHY_BLOCK, buildPricingCatalogBlock()]
      .flatMap((b) => b.split('\n'))
      .filter((line) => /Rp\s*\[(?:total|harga|ongkir|promo)\]/i.test(line))
      // Baris yang mengutip token semata untuk MELARANG (DILARANG/JANGAN ...
      // placeholder) bukan contoh yang dijiplak LLM.
      .filter((line) => !/(DILARANG|JANGAN)[^.]*placeholder/i.test(line));
    expect(offending).toEqual([]);
  });

  it('prompt hygiene: ada aturan tegas larangan menulis placeholder kurung siku', () => {
    expect(LOCATION_HIERARCHY_BLOCK).toMatch(/DILARANG KERAS menulis teks placeholder bertanda kurung siku/i);
  });
});
