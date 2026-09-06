import { describe, it, expect } from 'vitest';
import { OutputSanitizer } from '../../src/v3/guardrails/sanitizer';
import { PersonaPromptBuilder } from '../../src/v3/agent/persona';

/**
 * AI-First (Minimal-Regex Mandate): sanitizer hilir TIDAK PERNAH memotong
 * nominal/kata di tengah kalimat. Kendali harga hidup di hulu (prompt +
 * tool inquirePrice). Tes ini memverifikasi kalimat LLM lolos UTUH tanpa
 * mutilasi ("danya", "menjadi ,", "(normal)" yatim, "untukperawatan").
 * Offline, tanpa LLM — murni unit guardrail + prompt.
 */
describe('Price Slang, Nominal Confirmation & STR Mention (AI-First)', () => {
  it('Kasus konfirmasi nominal ("Pijat baby relaksi 60rb ya"): harga utuh, tanpa kata cacat', () => {
    const llmReply =
      'Untuk *Pijat Bayi Ceria (Rileksasi)*, saat ini ada promo menjadi *Rp 60.000*, dan durasinya 40 menit ya Bunda 😊';
    const out = OutputSanitizer.cleanOutboundReply(llmReply, 'Pijat baby relaksi 60rb ya');
    expect(out).toContain('*Rp 60.000*');
    expect(out).toContain('40 menit');
    expect(out).not.toContain('danya');
    expect(out).not.toContain('menjadi ,');
  });

  it('Kasus singkatan ("Hrga brp y kak??"): promo & normal tampil lengkap', () => {
    const llmReply =
      'Untuk keluhan batuk pilek, paket *Pijat Bayi Pulih Ceria* durasinya 40 menit dan saat ini lagi promo jadi *Rp 70.000* saja Bunda (harga normal *Rp 90.000*) 😊';
    const out = OutputSanitizer.cleanOutboundReply(llmReply, 'Hrga brp y kak??');
    expect(out).toContain('*Rp 70.000*');
    expect(out).toContain('*Rp 90.000*');
    expect(out).toContain('40 menit');
    expect(out).not.toContain('danya');
  });

  it('Kasus usia ("Pijat bayi 1 bln bisa kak?"): tanpa artefak mutilasi', () => {
    const llmReply =
      'Bisa banget Bunda 😊 Pijat bayi usia 1 bulan aman dan nyaman untuk membantu relaksasi si kecil. Apakah si kecil ada keluhan tertentu Bunda? 🤗';
    const out = OutputSanitizer.cleanOutboundReply(llmReply, 'Pijat bayi 1 bln bisa kak?');
    expect(out).toContain('Bisa banget');
    expect(out).not.toContain('(normal)');
    expect(out).not.toContain('danya');
    expect(out).not.toContain('untukperawatan');
  });

  it('Eliminasi STR: balasan umum memakai "Bidan kami"', () => {
    const raw =
      'Perawatannya meliputi pijat stimulasi seluruh badan oleh Bidan ber-STR aktif ya Bunda 😊';
    const out = OutputSanitizer.cleanOutboundReply(raw, 'pijat buat baby apa ya kak rekomendasinya');
    expect(out).not.toContain('ber-STR aktif');
    expect(out).toContain('Bidan kami');
  });

  it('Pertanyaan legalitas: sebutan STR dipertahankan', () => {
    const raw =
      'Seluruh terapis kami adalah Bidan ber-STR aktif yang terlatih khusus ya Bunda 😊';
    const out = OutputSanitizer.cleanOutboundReply(raw, 'Apakah bidannya bersertifikat?');
    expect(out).toContain('ber-STR aktif');
  });

  it('Prompt persona: aturan harga, konfirmasi nominal & contoh kontras tercantum', () => {
    const prompt = PersonaPromptBuilder.buildSystemPrompt({ genderGreeting: 'Bunda' } as any, true);
    expect(prompt).toContain('kecocokan usia bayi');
    expect(prompt).toContain('DILARANG memuntahkan harga/promo');
    expect(prompt).toContain('inquirePrice: true');
    expect(prompt).toContain('Pijat baby relaksi 60rb ya');
    expect(prompt).toContain('HANYA disebutkan jika customer secara eksplisit menanyakan kualifikasi');
    expect(prompt).not.toContain('oleh Bidan ber-STR aktif');
  });
});
