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

  it('JSON terpotong (finish_reason=length) → dibuang, BUKAN ditebak', () => {
    const raw =
      O('DSML') + ' invoke name="calculate_delivery"\n' +
      '{ "locationText": "Wonokusumo", "isDontKnow": false, "isDontKnow2": false';
    expect(salvageToolCallsFromDsml(raw)).toHaveLength(0);
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
});
