import { describe, it, expect } from 'vitest';
import { validateFactualClaims } from '../../../src/v3/guardrails/factual-claim-validator';
import { OutputSanitizer } from '../../../src/v3/guardrails/sanitizer';

/**
 * Fixing D1 (sesi 767713) â€” add-on sah ("Sinar Moksa") TIDAK boleh dituduh
 * halusinasi bila ada di katalog tenant (extraCatalogNames).
 */
describe('D1 fix â€” add-on katalog sah (sesi 767713)', () => {
  const tools = [
    { name: 'get_catalog_and_price', result: { treatments: [{ name: 'Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)' }] } },
  ];

  it('Sinar Moksa TANPA extraCatalogNames â†’ violation (perilaku lama)', () => {
    const r = validateFactualClaims(
      'Kami sarankan *Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)* + terapi hangat *Sinar Moksa* ya Bunda',
      tools as any, undefined, {} as any
    );
    expect(r.isValid).toBe(false);
  });

  it('Sinar Moksa DENGAN extraCatalogNames (katalog tenant) â†’ VALID', () => {
    const r = validateFactualClaims(
      'Kami sarankan *Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)* + terapi hangat *Sinar Moksa* ya Bunda',
      tools as any, undefined, { extraCatalogNames: ['Sinar Moksa (Add-on)'] } as any
    );
    expect(r.isValid).toBe(true);
  });

  it('nama fiktif tetap dicegat walau ada extraCatalogNames', () => {
    const r = validateFactualClaims(
      'Kami sarankan *Pijat Quantum Super* ya Bunda',
      tools as any, undefined, { extraCatalogNames: ['Sinar Moksa (Add-on)'] } as any
    );
    expect(r.isValid).toBe(false);
  });
});

/**
 * Fixing Fase 3 (sesi 767713) â€” frasa "melempar ke tim" saat ragu dibuang
 * deterministik; kalimat jadwal yang sah (cek ketersediaan) DIPERTAHANKAN.
 */
describe('Fase 3 â€” strip vague team deferral', () => {
  it('kalimat "cek dulu ke tim" murni dibuang', () => {
    const out = OutputSanitizer.stripVagueTeamDeferral(
      'Baik Bunda, usia 6 bulan aman untuk dipijat.\n\nUntuk terapi tambahan, informasinya akan kami cek dulu ke tim kami ya.'
    );
    expect(out).not.toMatch(/cek dulu ke tim/i);
    expect(out).toMatch(/aman untuk dipijat/i);
  });

  it('kalimat jadwal sahes ("kami cekkan ketersediaan jadwal") DIPERTAHANKAN', () => {
    const out = OutputSanitizer.stripVagueTeamDeferral(
      'Untuk ketersediaan jadwal hari Sabtu, kami bantu cekkan dulu ya Bunda.'
    );
    expect(out).toMatch(/cekkan/i);
  });
});
