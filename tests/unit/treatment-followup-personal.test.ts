import { describe, it, expect, beforeEach } from 'vitest';
import { TEMPLATES } from '../../src/config/persona';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';

/**
 * 20 Test Case — Personal Treatment Follow-Up (faqFollowUp)
 * Memvalidasi: nama treatment ter-extract benar, CTA personal tidak kaku,
 * dan fallback generic tetap berfungsi.
 */

describe('Personal Treatment Follow-Up (20 Test Cases)', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  // ============ A. faqFollowUp dengan nama treatment → CTA personal ============
  it('1. faqFollowUp + nama treatment → mengandung nama treatment', () => {
    const res = TEMPLATES.faqFollowUp('Sinar moksa itu adalah terapi inframerah.', 'Sinar Moksa');
    expect(res).toContain('Sinar Moksa');
  });

  it('2. faqFollowUp + nama treatment → TIDAK pakai teks generic', () => {
    const res = TEMPLATES.faqFollowUp('Jawaban.', 'Pijat Bayi Ceria');
    expect(res).not.toContain('lanjut ke pengisian list reservasi');
  });

  it('3. faqFollowUp + nama treatment → CTA mengajak booking', () => {
    const res = TEMPLATES.faqFollowUp('Jawaban.', 'Sinar Moksa');
    expect(res).toMatch(/pilih treatment|booking|jadwalkan|book|dibantu/i);
  });

  it('4. faqFollowUp + nama treatment → jawaban tetap ada di depan', () => {
    const res = TEMPLATES.faqFollowUp('Ini jawaban FAQ.', 'Sinar Moksa');
    expect(res.startsWith('Ini jawaban FAQ.')).toBe(true);
  });

  it('5. faqFollowUp tanpa nama → tetap pakai teks generic lama', () => {
    const res = TEMPLATES.faqFollowUp('Jawaban.');
    expect(res).toContain('lanjut ke pengisian list reservasi treatment sekarang');
  });

  it('6. faqFollowUp dengan treatmentName kosong string → generic', () => {
    const res = TEMPLATES.faqFollowUp('Jawaban.', '   ');
    expect(res).toContain('lanjut ke pengisian list reservasi');
  });

  it('7. faqFollowUp dengan treatmentName null → generic', () => {
    const res = TEMPLATES.faqFollowUp('Jawaban.', null as any);
    expect(res).toContain('lanjut ke pengisian list reservasi');
  });

  it('8. Rotasi variasi: panggil 20x harus menghasilkan CTA yang valid semua', () => {
    for (let i = 0; i < 20; i++) {
      const res = TEMPLATES.faqFollowUp('Jawaban.', 'Nebulizer');
      expect(res).toContain('Nebulizer');
      expect(res).toMatch(/pilih treatment|booking|jadwalkan|book|dibantu/i);
    }
  });

  it('9. Rotasi menghasilkan variasi teks (tidak selalu sama)', () => {
    const outputs = new Set<string>();
    for (let i = 0; i < 30; i++) {
      outputs.add(TEMPLATES.faqFollowUp('Jawaban.', 'Sinar Moksa'));
    }
    expect(outputs.size).toBeGreaterThan(1); // ada variasi
  });

  it('10. Nama treatment dengan strip parens tidak memengaruhi output', () => {
    const res = TEMPLATES.faqFollowUp('Jawaban.', 'Sinar Moksa');
    expect(res).toContain('Sinar Moksa');
  });

  // ============ B. Extract nama treatment dari searchCatalog ============
  it('11. "moksa itu apa" → searchCatalog mengembalikan Sinar Moksa (Add-on)', () => {
    const res = treatmentCatalogService.searchCatalog('moksa itu apa ya');
    expect(res).toContain('Sinar Moksa (Add-on)');
  });

  it('12. Extract nama resmi dari line pertama hasil searchCatalog', () => {
    const res = treatmentCatalogService.searchCatalog('moksa itu apa ya');
    const firstLine = res.split('\n').find((l) => l.startsWith('• *'));
    expect(firstLine).toBeDefined();
    const m = firstLine!.match(/• \*([^*]+)\*/);
    expect(m![1]).toContain('Sinar Moksa');
  });

  it('13. Nama clean (tanpa parens) bisa dihasilkan dari nama resmi', () => {
    const res = treatmentCatalogService.searchCatalog('moksa itu apa ya');
    const firstLine = res.split('\n').find((l) => l.startsWith('• *'))!;
    const m = firstLine.match(/• \*([^*]+)\*/)!;
    const clean = m[1].trim().replace(/\s*\([^)]*\)\s*$/, '').trim();
    expect(clean).toBe('Sinar Moksa');
  });

  it('14. "nebulizer" → extract nama clean "Nebulizer"', () => {
    const res = treatmentCatalogService.searchCatalog('nebulizer');
    const firstLine = res.split('\n').find((l) => l.startsWith('• *'))!;
    const m = firstLine.match(/• \*([^*]+)\*/)!;
    const clean = m[1].trim().replace(/\s*\([^)]*\)\s*$/, '').trim();
    expect(clean).toBe('Nebulizer');
  });

  it('15. "pijat bayi ceria" → extract nama clean "Pijat Bayi Ceria"', () => {
    const res = treatmentCatalogService.searchCatalog('pijat bayi ceria itu apa');
    const firstLine = res.split('\n').find((l) => l.startsWith('• *'))!;
    const m = firstLine.match(/• \*([^*]+)\*/)!;
    const clean = m[1].trim().replace(/\s*\([^)]*\)\s*$/, '').trim();
    expect(clean).toBe('Pijat Bayi Ceria');
  });

  it('16. "prenatal massage" → extract nama clean "Prenatal Massage"', () => {
    const res = treatmentCatalogService.searchCatalog('prenatal massage');
    const firstLine = res.split('\n').find((l) => l.startsWith('• *'))!;
    const m = firstLine.match(/• \*([^*]+)\*/)!;
    const clean = m[1].trim().replace(/\s*\([^)]*\)\s*$/, '').trim();
    expect(clean).toBe('Prenatal Massage');
  });

  it('17. "cukur rambut bayi" → extract nama clean "Cukur Rambut Bayi"', () => {
    const res = treatmentCatalogService.searchCatalog('cukur rambut bayi');
    const firstLine = res.split('\n').find((l) => l.startsWith('• *'))!;
    const m = firstLine.match(/• \*([^*]+)\*/)!;
    const clean = m[1].trim().replace(/\s*\([^)]*\)\s*$/, '').trim();
    expect(clean).toBe('Cukur Rambut Bayi');
  });

  it('18. "tindik telinga" → extract nama clean "Tindik Telinga Bayi"', () => {
    const res = treatmentCatalogService.searchCatalog('tindik telinga bayi');
    const firstLine = res.split('\n').find((l) => l.startsWith('• *'))!;
    const m = firstLine.match(/• \*([^*]+)\*/)!;
    const clean = m[1].trim().replace(/\s*\([^)]*\)\s*$/, '').trim();
    expect(clean).toBe('Tindik Telinga Bayi');
  });

  it('19. "pijat lahap juara" → extract nama clean "Pijat Lahap Juara"', () => {
    const res = treatmentCatalogService.searchCatalog('pijat lahap juara');
    const firstLine = res.split('\n').find((l) => l.startsWith('• *'))!;
    const m = firstLine.match(/• \*([^*]+)\*/)!;
    const clean = m[1].trim().replace(/\s*\([^)]*\)\s*$/, '').trim();
    expect(clean).toBe('Pijat Lahap Juara');
  });

  // ============ C. Kasus Tanpa Match ============
  it('20. Pertanyaan umum "ada treatment apa saja" → searchCatalog kosong (tidak ada nama untuk follow-up)', () => {
    const res = treatmentCatalogService.searchCatalog('ada treatment apa saja');
    expect(res).toBe('');
  });
});
