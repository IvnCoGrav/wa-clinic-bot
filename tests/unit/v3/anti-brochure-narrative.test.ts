import { describe, it, expect } from 'vitest';
import { executeGetCatalog } from '../../../src/v3/tools/get-catalog.tool';
import { PersonaPromptBuilder } from '../../../src/v3/agent/persona';

/**
 * Phase 3+5 (sesi 214956) — Anti-brosur bernomor + pertanyaan pemantik klinis:
 * rekomendasi usia mengalir 1 paragraf naratif dan WAJIB ditutup pertanyaan
 * keluhan-vs-relaksasi (sehat/sakit), bukan daftar kaku "1. ... 2. ...".
 */
describe('Anti-Brochure Narrative & Clinical Inquiry (sesi 214956)', () => {
  it('tool: panduan message menuntut narasi 1 paragraf + pemantik klinis', async () => {
    const out = await executeGetCatalog(
      { category: 'BABY', childAgeMonths: 17, inquirePrice: false },
      'default-tenant'
    );
    expect(out.success).toBe(true);
    expect(out.message).toContain('1 PARAGRAF');
    expect(out.message).toContain('pemantik klinis');
    expect(out.message).toContain('relaksasi saja');
    expect(out.message).toContain('daftar bernomor');
  });

  it('tool: template total resmi multi-item dihitung mesin (bukan mental LLM)', async () => {
    const out = await executeGetCatalog(
      { category: 'BOTH', inquirePrice: true },
      'default-tenant',
      {
        ongkirPromo: 15000,
        cartItems: [
          { name: 'Pijat Lahap Juara', promoPrice: 75000, price: 95000 },
          { name: 'Oksitosin Massage Fullbody', promoPrice: 105000, price: 130000 },
        ],
      }
    );
    expect(out.cartTotalReply).toBeDefined();
    expect(out.cartTotalReply!).toContain('195.000');
    // Template kutipan bersih; instruksi anti-hitung-ulang hidup di message.
    expect(out.message).toContain('JANGAN hitung ulang');
    expect(out.message).toContain('WAJIB kutip angka total resmi');
  });

  it('tool: tanpa harga (inquirePrice false) tidak ada nominal di template', async () => {
    const out = await executeGetCatalog(
      { category: 'BABY', childAgeMonths: 17, inquirePrice: false },
      'default-tenant'
    );
    expect(out.cartTotalReply).toBeUndefined();
    expect(out.suggestedPriceReply).toBeUndefined();
  });

  it('persona KONDISI A.1: aturan anti-brosur + contoh naratif + pemantik klinis', () => {
    const prompt = PersonaPromptBuilder.buildSystemPrompt({ genderGreeting: 'Bunda' } as any, true);
    expect(prompt).toContain('ANTI-BROSUR MENU');
    expect(prompt).toContain('daftar bernomor kaku');
    expect(prompt).toContain('relaksasi saja?');
  });
});
