import { describe, it, expect } from 'vitest';
import { OutputSanitizer } from '../../src/v3/guardrails/sanitizer';

describe('Sanitizer HTML & meta-bicara (Fase 4)', () => {
  it('<br><br><br> → newline', () => {
    const out = OutputSanitizer.cleanOutboundReply('Halo Bunda<br><br>Apa kabar<br/>hari ini?');
    expect(out).not.toMatch(/<br/i);
    expect(out).toContain('\n');
  });

  it('<div> dan </p> generik terstrip', () => {
    const out = OutputSanitizer.cleanOutboundReply('Halo<div>teks</div> lagi');
    expect(out).not.toMatch(/<div|<\/div>/i);
    expect(out).toContain('teks');
  });

  it('<3 emotikon tidak termakan', () => {
    const out = OutputSanitizer.cleanOutboundReply('I love you <3 Bunda');
    expect(out).toContain('<3');
  });

  it('karena data faq belum tersedia → dibuang (generik)', () => {
    const raw = 'Halo Bunda. Karena data FAQ belum tersedia, kami cekkan dulu ya. Terima kasih Bunda.';
    const out = OutputSanitizer.cleanOutboundReply(raw);
    expect(out.toLowerCase()).not.toContain('karena data faq');
    expect(out).toContain('Halo Bunda');
  });

  it('kami cekkan dari katalog resmi dulu → dibuang', () => {
    const raw = 'Mohon maaf. Kami cekkan dari katalog resmi dulu ya Bunda.';
    const out = OutputSanitizer.cleanOutboundReply(raw);
    expect(out.toLowerCase()).not.toContain('cekkan dari katalog');
  });

  it('informasi faq belum ada → dibuang (bersama kalimat valid)', () => {
    const raw = 'Halo Bunda. Informasi FAQ belum ada, nanti kami update ya Bunda. Terima kasih ya.';
    const out = OutputSanitizer.cleanOutboundReply(raw);
    expect(out.toLowerCase()).not.toContain('informasi faq');
    expect(out).toContain('Halo Bunda');
  });

  it('kalimat jadwal sah tidak terhapus (guard SCHEDULE)', () => {
    const raw = 'Kami cekkan ketersediaan jadwal untuk Bunda ya.';
    const out = OutputSanitizer.cleanOutboundReply(raw);
    expect(out).toContain('jadwal');
  });

  // Fase 1.3 — Pertahanan lapis akhir: tag metadata katalog internal
  // `[BUNDLE:...]`/`[ADDON]` DILARANG sampai ke customer (bukti CASE-063).
  it('tag [BUNDLE:...] internal dibersihkan tanpa mutilasi kalimat', () => {
    const raw = 'Untuk *Kala Bundle Selapan Full* ya Bunda 😊\n\n[BUNDLE:baby-cukur,baby-massage-pulih-ceria,baby-mandi] Paket komplit saat selapanan: cukur + pijat + mandi.';
    const out = OutputSanitizer.cleanOutboundReply(raw);
    expect(out).not.toContain('[BUNDLE:');
    expect(out).toContain('Paket komplit');
    expect(out).not.toMatch(/,\s*,/);
  });

  it('tag [ADDON] internal dibersihkan', () => {
    const out = OutputSanitizer.cleanOutboundReply('[ADDON] Terapi moksa hangat untuk melegakan pernapasan.');
    expect(out).not.toContain('[ADDON]');
    expect(out).toContain('Terapi moksa');
  });

  it('cek an / ongkir nya TIDAK dipaksa join (anti-mutilasi)', () => {
    const raw = 'Kami bantu cek an ongkir nya ya Bunda.';
    const out = OutputSanitizer.cleanOutboundReply(raw);
    // sanitizer tidak mengubah "cek an" atau "ongkir nya" di tengah kalimat
    expect(out).toContain('cek an');
    expect(out).toContain('ongkir nya');
  });
});
