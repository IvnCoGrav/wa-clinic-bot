import { describe, it, expect } from 'vitest';
import { OutputSanitizer } from '../../../src/v3/guardrails/sanitizer';

/**
 * Audit DeepSeek Flash: model via gateway OpenAI-compatible kadang memuntahkan
 * format tool-call native (DSML/XML) ke dalam properti teks `content`.
 * Sanitizer WAJIB membersihkan tag mesin ini tanpa mutilasi kalimat customer.
 */
describe('Sanitizer — kebocoran tag DSML/XML native (DeepSeek)', () => {
  // POLA RIIL produksi (log llm-2026-09-21.jsonl, sesi 89-turn): tag DSML
  // dibungkus KARAKTER KONTROL C1 U+009C/U+009D (terlihat sebagai mojibake),
  // dengan '<' pembuka dan '/' penutup DI ANTARA control chars — BUKAN pipe.
  // Regex lama `<｜｜DSML｜｜` tidak pernah match pola ini.
  const O = (inner: string) => `<\u009C\u009C${inner}\u009C\u009D>`;
  const realDsmlBlock = [
    O('DSML') + ' calls',
    O('DSML') + ' invoke name="get_catalog_and_price"',
    O('DSML') + ' parameter name="symptoms" string="true">oksitosin massage ibu menyusui' + O('/DSML') + ' parameter',
    O('/DSML') + ' invoke',
    O('/DSML') + ' calls',
  ].join('\n');

  it('membersihkan POLA RIIL DSML control-char dari log produksi', () => {
    const dirty = `Baik Bunda 😊${realDsmlBlock}`;
    const out = OutputSanitizer.cleanOutboundReply(dirty, 'oksitosin tiap hari?', true);
    expect(out).not.toContain('DSML');
    expect(out).not.toContain('get_catalog_and_price');
    expect(out).not.toContain('invoke');
    expect(out).toContain('Baik Bunda');
  });

  it('membersihkan blok DSML pola pipe fullwidth tunggal & dobel', () => {
    // Kontrak trim-from-first: teks SEBELUM artefak dipertahankan; teks
    // SETELAH artefak TIDAK dijamin (draf korup) — recovery grounded di
    // guardrail-pipeline yang mengisi ulang bila draf jadi kosong.
    const single = 'Baik Bunda 😊<｜DSML｜calls><｜DSML｜invoke name="get_catalog"></｜DSML｜invoke></｜DSML｜calls> Kami bantu cek ya.';
    const outSingle = OutputSanitizer.cleanOutboundReply(single, 'pijat bayi apa?', true);
    expect(outSingle).not.toContain('DSML');
    expect(outSingle).not.toContain('get_catalog');
    expect(outSingle).toContain('Baik Bunda');

    const double = 'Baik Bunda 😊<｜｜DSML｜｜calls><｜｜DSML｜｜call><name>get_catalog</name></｜｜DSML｜｜call></｜｜DSML｜｜calls> Kami bantu cek ya.';
    const outDouble = OutputSanitizer.cleanOutboundReply(double, 'pijat bayi apa?', true);
    expect(outDouble).not.toContain('DSML');
    expect(outDouble).not.toContain('get_catalog');
    expect(outDouble).not.toContain('<name>');
    expect(outDouble).toContain('Baik Bunda');
  });

  it('membersihkan <result> dan <tool_call> XML', () => {
    const dirty = '<result><name>calculate_delivery</name><args>{}</args></result>Baik Bunda<tool_call>{"x":1}</tool_call>, dicatat ya.';
    const out = OutputSanitizer.cleanOutboundReply(dirty, 'dimana?', true);
    expect(out).not.toContain('<result>');
    expect(out).not.toContain('tool_call');
    expect(out).toContain('Baik Bunda');
    expect(out).toContain('dicatat ya');
  });

  it('membersihkan tag calls/invoke/parameter soliter', () => {
    const dirty = 'Siap<calls><invoke name="x"><parameter>1</parameter></invoke></calls> Bunda.';
    const out = OutputSanitizer.cleanOutboundReply(dirty, 'ok?', true);
    expect(out).not.toMatch(/<\/?(calls|invoke|parameter)[^>]*>/i);
    expect(out).toContain('Siap');
    expect(out).toContain('Bunda');
  });

  it('teks bersih TANPA artefak tidak berubah (anti-mutilasi)', () => {
    const clean = 'Baik Bunda, jadwalnya kami cekkan dulu ya 😊';
    expect(OutputSanitizer.cleanOutboundReply(clean, 'jadwal?', true)).toBe(clean);
  });

  it('tidak menghapus kata "result" bahasa alami customer', () => {
    const natural = 'Hasil pijatnya bagus ya Bunda, result memuaskan.';
    const out = OutputSanitizer.cleanOutboundReply(natural, 'gimana?', true);
    expect(out).toContain('result memuaskan');
  });
});
