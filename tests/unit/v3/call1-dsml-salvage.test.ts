import { describe, it, expect } from 'vitest';
import { salvageToolCallsFromDsml } from '../../../src/v3/agent/pipeline/dsml-tool-salvage';

/**
 * Defense-in-depth Call 1: model netra via gateway kadang memuntahkan sintaks
 * tool-call DSML ke `content` (bukan `tool_calls` terstruktur). Salvage murni
 * merekonstruksi invoke name + args JSON; keamanan anti-halusinasi tetap di
 * gerbang verbatim tool-pipeline. Uji adversarial: DSML valid, terpotong, dan
 * teks biasa.
 */
const O = (inner: string) => `<\u009C\u009C${inner}\u009C\u009D>`;

describe('Call 1 DSML tool-call salvage', () => {
  it('memulihkan invoke + argumen JSON dari pola DSML riil (netra)', () => {
    const raw = [
      O('DSML') + ' calls',
      O('DSML') + ' invoke name="calculate_delivery"',
      '{ "locationText": "Wonokusumo Surabaya", "commitment": "EXPLORING", "asksDeliveryFee": false }',
      O('/DSML') + ' invoke',
      O('/DSML') + ' calls',
    ].join('\n');
    const calls = salvageToolCallsFromDsml(raw);
    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe('calculate_delivery');
    const args = JSON.parse(calls[0].function.arguments);
    expect(args.locationText).toBe('Wonokusumo Surabaya');
    expect(args.asksDeliveryFee).toBe(false);
  });

  it('memulihkan invoke dari blok <parameter>', () => {
    const raw =
      O('DSML') + ' invoke name="get_catalog_and_price"\n' +
      '<parameter name="symptoms" string="true">bayi batuk pilek</parameter>\n' +
      O('/DSML') + ' invoke';
    const calls = salvageToolCallsFromDsml(raw);
    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe('get_catalog_and_price');
    expect(JSON.parse(calls[0].function.arguments).symptoms).toBe('bayi batuk pilek');
  });

  it('JSON terpotong: pasangan lengkap dipungut, key rusak di ujung dibuang', () => {
    // Kontrak baru (insiden Waru): stream `finish_reason=length` memungut
    // pasangan UTUH saja; key terpotong ("isDontKnow2" tanpa nilai) dibuang.
    const raw =
      O('DSML') + ' invoke name="calculate_delivery"\n' +
      '{ "locationText": "Wonokusumo", "isDontKnow": false, "isDontKnow2": false';
    const calls = salvageToolCallsFromDsml(raw);
    expect(calls).toHaveLength(1);
    const args = JSON.parse(calls[0].function.arguments);
    expect(args.locationText).toBe('Wonokusumo');
    expect(args.isDontKnow).toBe(false);
  });

  it('tanpa artefak DSML → array kosong (teks natural tak disentuh)', () => {
    expect(salvageToolCallsFromDsml('Baik Bunda, kami bantu cek jadwalnya ya 😊')).toHaveLength(0);
    expect(salvageToolCallsFromDsml('')).toHaveLength(0);
  });

  it('brace di dalam string tidak memutus ekstraksi (balanced-aware)', () => {
    const raw =
      O('DSML') + ' invoke name="save_reservation"\n' +
      '{ "note": "alamat {patokan} masjid", "ok": true }';
    const calls = salvageToolCallsFromDsml(raw);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].function.arguments).note).toBe('alamat {patokan} masjid');
  });

  // Insiden Waru (6281390541340, 2026-10-03): netra gagap intermiten tanpa
  // `thinking` — stream `finish_reason=length` TAK PERNAH seimbang, padahal
  // `"locationText": "Waru"` sudah lengkap. Salvage parsial WAJIB memungut
  // pasangan yang utuh saja, tanpa merekonstruksi yang hilang.
  it('stream terpotong: memungut pasangan lengkap (locationText) — partial salvage', () => {
    const raw =
      O('DSML') + ' invoke name="calculate_delivery">\n' +
      '{\n' +
      '  "locationText": "Waru",\n' +
      '  "asksDeliveryFee": false,\n' +
      '  "commitment": "EXPLORING"\n' +
      '  , "candidateTreatmentName": "Kala Baby – Pijat Ceria"\n' +
      '  , "streetDetail": ""\n' +
      '  , "candidateTreatmentName": ""\n' +
      '  , "candidateTrea';
    const calls = salvageToolCallsFromDsml(raw);
    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe('calculate_delivery');
    const args = JSON.parse(calls[0].function.arguments);
    expect(args.locationText).toBe('Waru');
    expect(args.asksDeliveryFee).toBe(false);
    expect(args.commitment).toBe('EXPLORING');
  });

  it('partial salvage: string terpotong di tengah tidak diambil (bukan ditebak)', () => {
    const raw =
      O('DSML') + ' invoke name="calculate_delivery">\n' +
      '{ "locationText": "Waru", "candidateTreatmentName": "Kala Ba';
    const calls = salvageToolCallsFromDsml(raw);
    expect(calls).toHaveLength(1);
    const args = JSON.parse(calls[0].function.arguments);
    expect(args.locationText).toBe('Waru');
    expect(args.candidateTreatmentName).toBeUndefined();
  });

  it('partial salvage tidak menyerap key berulang berlebihan (dedup first-wins)', () => {
    const loop = Array.from({ length: 50 }, () => '  , "candidateTreatmentName": ""').join('\n');
    const raw =
      O('DSML') + ' invoke name="calculate_delivery">\n' +
      '{ "locationText": "Waru", "asksDeliveryFee": false\n' + loop;
    const calls = salvageToolCallsFromDsml(raw);
    expect(calls).toHaveLength(1);
    const args = JSON.parse(calls[0].function.arguments);
    expect(args.locationText).toBe('Waru');
    expect(Object.keys(args)).toContain('candidateTreatmentName');
  });
});
