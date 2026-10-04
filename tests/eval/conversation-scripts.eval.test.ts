import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../src/v3/state/goal-tracker';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';
import { OutputSanitizer } from '../../src/v3/guardrails/sanitizer';
import {
  buildScheduleCta,
} from '../../src/v3/tools/calculate-delivery.tool';
import {
  checkReplyContract,
  replyMentionsRupiah,
  replyMentionsDay,
  ensureRepromptClosingCta,
} from '../../src/v3/agent/pipeline/guardrail-pipeline';

/**
 * Fase 5 — EVAL skrip percakapan (offline, deterministic). Menguji lapisan
 * deterministik yang menjamin kontrak alur (cart, CTA, trimmer, kontrak
 * jawaban) pada 12 skenario nyata. BUKAN eval LLM penuh (tidak memanggil
 * model) — ini jaring regresi lapisan yang kita kendalikan.
 */
const catalog = treatmentCatalogService.getAllServices(true).map((s) => ({
  id: (s as any).id,
  name: s.name,
  promoPrice: s.promoPrice,
  originalPrice: s.originalPrice,
  category: s.category,
  bundleItemIds: (s as any).bundleItemIds || [],
  isAddon: (treatmentCatalogService as any).isAddonService(s),
}));
const msg = (content: string, role = 'user') => ({ role, content });
const cartOf = (history: any[]) => GoalTracker.syncCartItems({ cartItems: [] } as any, history, catalog as any);

describe('Fase 5 — eval skrip percakapan (deterministik)', () => {
  it('S1 tanya harga → kontrak wajib memuat Rp bila data harga ada', () => {
    const bad = checkReplyContract('Untuk Pijat Ceria ya Bunda', { priceAsked: true, priceDataAvailable: true });
    expect(bad.missingPrice).toBe(true);
    const good = checkReplyContract('Promo jadi *Rp 60.000* ya Bunda', { priceAsked: true, priceDataAvailable: true });
    expect(good.missingPrice).toBe(false);
  });

  it('S2 ongkir + paket → CTA jadwal, bukan "perawatan apa"', () => {
    const cta = buildScheduleCta({ candidateTreatmentName: 'Kala Baby – Pijat Ceria', hasCartItems: true });
    expect(cta.toLowerCase()).not.toContain('mau ambil perawatan apa');
    expect(replyMentionsDay(cta) || cta.includes('hari apa')).toBe(true);
  });

  it('S3 bumil umum → cart tidak pernah mengunci layanan induksi (gerbang tool terpisah)', () => {
    // Lapisan cart tidak mengenal klinis; di sini kita pastikan nama induksi
    // TIDAK terpilih dari sapaan asisten (active user commitment).
    const cart = cartOf([
      msg('saya sedang hamil, badan pegal', 'user'),
      msg('Bisa dibantu *Induksi Massage* ya Bunda', 'assistant'),
    ]);
    expect(cart.some((c) => c.name.toLowerCase().includes('induksi'))).toBe(false);
  });

  it('S4 bundle cukur+pijat ceria → paket presisi, bukan Full+Mandi', () => {
    const cart = cartOf([msg('mau bundle selapan cukur + pijat ceria')]);
    expect(cart).toHaveLength(1);
    expect(cart[0].name).toContain('Cukur + Pijat Ceria');
    expect(cart[0].name).not.toContain('Mandi');
  });

  it('S5 "boleh deh yang itu" tanpa rujukan → cart kosong', () => {
    const cart = cartOf([
      msg('ada promo apa?', 'user'),
      msg('Kami ada Cukur, Mandi, Tindik, Pijat Ceria ya Bunda', 'assistant'),
      msg('boleh deh yang itu', 'user'),
    ]);
    expect(cart).toHaveLength(0);
  });

  it('S6 cukur + pulih ceria + moksa → bundle + addon', () => {
    const cart = cartOf([
      msg('cukur rambut bayi untuk si kecil'),
      msg('tambah sinar moksa juga'),
      msg('jadi ambil cukur + pijat pulih ceria saja'),
    ]);
    const names = cart.map((c) => c.name);
    expect(names.some((n) => n.includes('Cukur + Pijat Pulih Ceria'))).toBe(true);
    expect(names.some((n) => n.toLowerCase().includes('moksa'))).toBe(true);
  });

  it('S7 paket dipilih, tanpa hari → kontrak minta jadwal (schedule)', () => {
    const r = checkReplyContract('Baik Bunda, kami siapkan perlengkapannya.', { scheduleExpected: true });
    expect(r.missingSchedule).toBe(true);
    const fixed = ensureRepromptClosingCta('Baik Bunda, kami siapkan perlengkapannya.', buildScheduleCta({ candidateTreatmentName: 'Kala Baby – Pijat Ceria', hasCartItems: true }));
    expect(replyMentionsDay(fixed) || fixed.includes('hari apa')).toBe(true);
  });

  it('S8 trimmer: daftar opsi tidak terpotong', () => {
    const draft =
      'Halo Bunda, promo masih berjalan ya. Untuk paketnya ada dua pilihan nih:\n\n' +
      '1. Cukur + Pijat Ceria Rp 80.000\n2. Full Cukur + Ceria + Mandi Rp 100.000';
    const out = OutputSanitizer.trimToMaxSentences(draft, 3);
    expect(out).toContain('2. Full Cukur + Ceria + Mandi');
  });

  it('S9 reprompt buntu → diberi CTA penutup', () => {
    const out = ensureRepromptClosingCta('Baik Bunda, untuk pijat si kecil kami siap bantu.', buildScheduleCta({ hasCartItems: false }));
    expect(out.trim().length).toBeGreaterThan('Baik Bunda, untuk pijat si kecil kami siap bantu.'.length);
  });

  it('S10 kontrak harga: balasan "60rb" tanpa "Rp" jujur dianggap missing', () => {
    expect(replyMentionsRupiah('promo 60rb ya')).toBe(false);
    expect(checkReplyContract('promo 60rb ya', { priceAsked: true, priceDataAvailable: true }).missingPrice).toBe(true);
  });

  it('S11 bumil aterm eksplisit induksi → boleh dikunci dari pesan USER', () => {
    const cart = cartOf([msg('saya uk 38 weeks, mau ambil induksi massage fullbody')]);
    expect(cart.some((c) => c.name.toLowerCase().includes('induksi'))).toBe(true);
  });

  it('S12 tanpa sinyal → tidak ada tuduhan kontrak (anti-kaku)', () => {
    const r = checkReplyContract('Siap Bunda 😊', { priceAsked: false, priceDataAvailable: false, scheduleExpected: false });
    expect(r.missingPrice).toBe(false);
    expect(r.missingSchedule).toBe(false);
  });
});
