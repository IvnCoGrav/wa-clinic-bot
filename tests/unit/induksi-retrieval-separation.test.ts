import { describe, it, expect } from 'vitest';
import { KB_KEYWORD_RULES } from '../../src/services/keyword-enrichment.service';
import { faqs } from '../../src/cli/faq-corpus';

/**
 * Fase 2 — pemisahan retrieval: penanda ATERM (induksi) DILARANG tercampur
 * dengan keluhan relaksasi umum (lelah/ngilu/kaki bengkak) agar bumil di usia
 * jauh dari aterm tidak tertarik ke narasi induksi.
 */
const keywordsOfRule = (fragment: string): string[] => {
  const rule = KB_KEYWORD_RULES.find((r) => r.keys.some((k) => k.includes(fragment)));
  return rule ? rule.keywords.map((x) => x.toLowerCase()) : [];
};

describe('Fase 2 — pemisahan retrieval induksi (aterm) vs relaksasi bumil umum', () => {
  it('rule induksi TIDAK memuat kata relaksasi umum', () => {
    const k = keywordsOfRule('induksi');
    expect(k).not.toContain('capek');
    expect(k).not.toContain('pegal');
    expect(k).not.toContain('hamil trimester 3');
  });

  it('rule induksi tetap memuat penanda aterm', () => {
    const k = keywordsOfRule('induksi');
    expect(k).toContain('induksi');
    expect(k.some((x) => x.includes('37') || x.includes('38') || x === 'aterm' || x === 'hpl' || x === 'kontraksi')).toBe(true);
  });

  it('rule ibu memuat kata relaksasi umum (pindahan)', () => {
    const k = keywordsOfRule('pilihan treatment untuk ibu');
    expect(k).toContain('pegal');
  });

  it('FAQ induksi tidak lagi memetakan keluhan umum ke Induksi Fullbody sebagai "paling tepat"', () => {
    const faq: any = faqs.find((f: any) => /induksi/i.test(f.question || ''));
    expect(faq).toBeTruthy();
    const text = `${faq.answer || ''} ${faq.keywords || ''}`.toLowerCase();
    expect(text).not.toMatch(/capek|pegal/);
    expect(text).toMatch(/37-38|aterm/);
  });
});
