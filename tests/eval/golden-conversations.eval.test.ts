import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../src/v3/state/goal-tracker';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';
import { PersonaPromptBuilder } from '../../src/v3/agent/persona';

/**
 * Fase 1 (program "chatbot lebih cerdas") — UJIAN EMAS + PAGAR ANGGARAN PROMPT.
 *
 * Dua tujuan:
 *  1. AGREGAT: mencetak skor kelulusan beberapa skenario nyata (booking,
 *     konsultasi, multi-opsi, anti-hijack) sebagai baseline reproducible.
 *  2. PAGAR PROMPT: mengunci ukuran system prompt agar Fase 2 (perampingan)
 *     punya gerbang regresi — prompt DILARANG membengkak lagi.
 *
 * Deterministik, offline (tanpa panggilan LLM/token).
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
const pulihCeriaName =
  treatmentCatalogService.getServiceById('baby-massage-pulih-ceria')?.name
  ?? 'Kala Baby - Pijat Pulih Ceria';
const cartOf = (history: any[], session: any = {}) =>
  GoalTracker.syncCartItems({ cartItems: [], ...session } as any, history, catalog as any);

interface GoldenCase {
  id: string;
  desc: string;
  run: () => boolean;
}

const baseSession = { genderGreeting: 'Bunda' } as any;

const cases: GoldenCase[] = [
  {
    id: 'G01',
    desc: 'Sapaan + booking → cart TIDAK terkunci (active user commitment)',
    run: () => cartOf([msg('halo bu bidan, saya mau booking home service')]).length === 0,
  },
  {
    id: 'G02',
    desc: 'Komitmen jelas "mau ambil pijat ceria" → cart terisi',
    run: () => cartOf([msg('mau ambil pijat ceria ya bund')]).length > 0,
  },
  {
    id: 'G03',
    desc: 'Konsultasi tanpa "?" ("pulih ceria itu gmna ya") → cart KOSONG',
    run: () => cartOf([msg('maaf untuk pulih ceria itu gmna ya')]).length === 0,
  },
  {
    id: 'G04',
    desc: 'Menu multi-opsi + "boleh deh yang itu" → cart KOSONG (ambigu)',
    run: () =>
      cartOf([
        msg('ada promo apa?'),
        msg('Ada Cukur, Mandi, Tindik, Pijat Ceria ya Bunda', 'assistant'),
        msg('boleh deh yang itu'),
      ]).length === 0,
  },
  {
    id: 'G05',
    desc: 'Tawaran tunggal + afirmasi "boleh" → cart terisi',
    run: () =>
      cartOf([
        msg('anak batuk pilek, treatment apa ya?'),
        msg(`Bisa dibantu *${pulihCeriaName}* ya Bunda`, 'assistant'),
        msg('boleh'),
      ]).length > 0,
  },
  {
    id: 'G07',
    desc: 'Bumil aterm eksplisit induksi → cart terisi dari pesan USER',
    run: () => cartOf([msg('saya uk 38 weeks, mau ambil induksi massage fullbody')]).length > 0,
  },
  {
    id: 'G08',
    desc: 'Bundle cukur+pulih ceria presisi (bukan Full+Mandi)',
    run: () => {
      const c = cartOf([msg('mau bundle selapan cukur + pijat ceria')]);
      return c.length === 1 && c[0].name.includes('Cukur + Pijat Ceria') && !c[0].name.includes('Mandi');
    },
  },
];

describe('Fase 1 — Ujian Emas (deterministik)', () => {
  it('menjalankan seluruh skenario emas & mencetak skor', () => {
    const results = cases.map((c) => ({ id: c.id, desc: c.desc, pass: (() => {
      try { return c.run() === true; } catch { return false; }
    })() }));
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n[GOLDEN SCORE] ${passed}/${results.length}`);
    for (const r of results) {
      // eslint-disable-next-line no-console
      console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.desc}`);
    }
    expect(results.every((r) => r.pass)).toBe(true);
  });
});

describe('Fase 1 — Pagar anggaran prompt (gerbang Fase 2)', () => {
  it('mengukur & membatasi panjang system prompt (anti-membengkak)', () => {
    const followUp = PersonaPromptBuilder.buildSystemPrompt(baseSession, true);
    const initial = PersonaPromptBuilder.buildSystemPrompt(baseSession, false);
    const slimEarly = PersonaPromptBuilder.buildSystemPrompt(
      { genderGreeting: 'Bunda', location: null, cartItems: [] } as any,
      true,
      { phaseInjection: { focus: ['EARLY_LOCATION'], slim: true } }
    );
    const slimConsult = PersonaPromptBuilder.buildSystemPrompt(
      { genderGreeting: 'Bunda', location: { kecamatan: 'Wonokromo' }, cartItems: [] } as any,
      true,
      { phaseInjection: { focus: ['CONSULTATION'], slim: true } }
    );
    const slimSched = PersonaPromptBuilder.buildSystemPrompt(
      { genderGreeting: 'Bunda', location: { kecamatan: 'Wonokromo' }, cartItems: [{ name: 'Pijat Ceria', price: 60000, promoPrice: 60000, type: 'PRIMARY' }], booking: { preferredDate: '2026-10-10' } } as any,
      true,
      { phaseInjection: { focus: ['CONSULTATION', 'SCHEDULING'], slim: true } }
    );
    // eslint-disable-next-line no-console
    console.log(`\n[PROMPT BUDGET] full followUp=${followUp.length} initial=${initial.length} | slim EARLY=${slimEarly.length} CONSULT=${slimConsult.length} CONSULT+SCHED=${slimSched.length}`);
    // Jalur produksi (Call 2) = slim state-gated. Pagar ini MENGUNCI perbaikan
    // Fase 2 (prompt DILARANG membengkak lagi); target lanjutan turun lebih dalam.
    expect(slimEarly.length).toBeLessThan(34000);
    expect(slimConsult.length).toBeLessThan(43000);
    expect(slimSched.length).toBeLessThan(45000);
    // Referensi rakitan penuh (bukan jalur produksi) tetap dicatat.
    expect(followUp.length).toBeLessThan(60000);
    expect(initial.length).toBeLessThan(60000);
  });
});
