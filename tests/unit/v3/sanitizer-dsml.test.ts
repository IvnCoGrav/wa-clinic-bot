import { describe, it, expect } from 'vitest';
import { OutputSanitizer } from '../../../src/v3/guardrails/sanitizer';

/**
 * Audit DeepSeek Flash: model via gateway OpenAI-compatible kadang memuntahkan
 * format tool-call native (DSML/XML) ke dalam properti teks `content`.
 * Sanitizer WAJIB membersihkan tag mesin ini tanpa mutilasi kalimat customer.
 */
describe('Sanitizer — kebocoran tag DSML/XML native (DeepSeek)', () => {
  it('membersihkan blok DSML lengkap beserta isinya', () => {
    // Lead-in non-sapaan agar tak tersentuh guard sapaan Turn-0 yang ortogonal.
    const dirty = 'Baik Bunda 😊<｜｜DSML｜｜calls><｜｜DSML｜｜call><name>get_catalog</name></｜｜DSML｜｜call></｜｜DSML｜｜calls> Kami bantu cek ya.';
    const out = OutputSanitizer.cleanOutboundReply(dirty, 'pijat bayi apa?', true);
    expect(out).not.toContain('DSML');
    expect(out).not.toContain('get_catalog');
    expect(out).toContain('Baik Bunda');
    expect(out).toContain('Kami bantu cek ya');
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
