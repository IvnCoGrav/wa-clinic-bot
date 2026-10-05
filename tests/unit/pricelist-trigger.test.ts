import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { evaluatePricelistTrigger } from '../../src/v3/agent/pipeline/pricelist-gate';
import { extractFastIntents } from '../../src/v3/agent/persona';
import { resolvePricelistImageTarget } from '../../src/services/pricelist-config.service';

/**
 * Suite adversarial pemulihan pengiriman gambar pricelist V3.
 * Menguji 3 seam: intent semantik, gerbang keputusan murni, dan resolver provider.
 * Offline penuh (tests/setup.ts: DB mock reject → fallback env/aset).
 */

const MEDIA_ROOT = path.join(process.cwd(), 'storage', 'media');
const TEST_TENANT = 'test-pricelist-tenant';
const TEST_REL = `/media/outbound/${TEST_TENANT}/adversarial.png`;
const TEST_ABS = path.join(MEDIA_ROOT, 'outbound', TEST_TENANT, 'adversarial.png');

const deliveryOk = (over: Record<string, any> = {}) => [
  { name: 'calculate_delivery', result: { success: true, isOutOfCoverage: false, distanceKm: 5, ...over } },
];

describe('PRICELIST GATE — gerbang keputusan deterministik (murni)', () => {
  it('EXPLICIT: multi-frasa permintaan pricelist → force-resend (bukan hafalan 1 kalimat)', () => {
    const phrases = [
      'Boleh minta pricelist nya?',
      'pricelist ga masuk kak',
      'minta pricelistnya lagi dong',
      'katalog harganya ada?',
      'daftar tarifnya kak',
      'menu treatmentnya apa aja?',
      'saya mau price list',
    ];
    for (const p of phrases) {
      const intents = extractFastIntents(p);
      const v = evaluatePricelistTrigger({ intents, executedTools: [], pricelistSent: true });
      expect(v, `frasa: "${p}" intents=${intents.join(',')}`).toEqual({
        send: true,
        forceResend: true,
        reason: 'EXPLICIT_REQUEST',
      });
    }
  });

  it('EXPLICIT: singkatan populer "PL" (token utuh) → ask_pricelist_image', () => {
    const phrases = [
      'Boleh minta PL nya',
      'PL nya kak',
      'minta PL dong',
      'spill PL',
      'PL',
    ];
    for (const p of phrases) {
      const intents = extractFastIntents(p);
      expect(intents, `frasa: "${p}"`).toContain('ask_pricelist_image');
      const v = evaluatePricelistTrigger({ intents, executedTools: [], pricelistSent: true });
      expect(v, `frasa: "${p}"`).toEqual({ send: true, forceResend: true, reason: 'EXPLICIT_REQUEST' });
    }
  });

  it('NEGATIF: token "pl" di tengah kata lain BUKAN permintaan pricelist', () => {
    expect(extractFastIntents('tolong jelasin sample nya')).not.toContain('ask_pricelist_image');
    expect(extractFastIntents('boleh minta pil nya ga')).not.toContain('ask_pricelist_image');
    expect(extractFastIntents('terapkan template nya')).not.toContain('ask_pricelist_image');
  });

  it('POST_DELIVERY: ongkir sukses dalam jangkauan, pricelistSent=false → kirim non-force', () => {
    const v = evaluatePricelistTrigger({
      intents: [],
      executedTools: deliveryOk(),
      pricelistSent: false,
    });
    expect(v).toEqual({ send: true, forceResend: false, reason: 'POST_DELIVERY' });
  });

  it('IDEMPOTENCY: ongkir sukses saat pricelistSent=true → tidak kirim', () => {
    const v = evaluatePricelistTrigger({
      intents: [],
      executedTools: deliveryOk(),
      pricelistSent: true,
    });
    expect(v).toEqual({ send: false, forceResend: false, reason: 'NONE' });
  });

  it('OUT-OF-COVERAGE: isOutOfCoverage=true → tidak kirim (adversarial Jakarta)', () => {
    const v = evaluatePricelistTrigger({
      intents: [],
      executedTools: deliveryOk({ isOutOfCoverage: true }),
      pricelistSent: false,
    });
    expect(v.send).toBe(false);
    expect(v.reason).toBe('NONE');
  });

  it('TOOL GAGAL/timeout: success=false (fallback tool-pipeline) → tidak kirim', () => {
    const v = evaluatePricelistTrigger({
      intents: [],
      executedTools: [{ name: 'calculate_delivery', result: { success: false, isOutOfCoverage: false } }],
      pricelistSent: false,
    });
    expect(v.send).toBe(false);
  });

  it('NEGATIF: tanya nominal/ongkir ("biayanya brp?") BUKAN permintaan gambar', () => {
    expect(extractFastIntents('biayanya brp?')).not.toContain('ask_pricelist_image');
    expect(extractFastIntents('ongkir ke waru berapa?')).not.toContain('ask_pricelist_image');
    const v = evaluatePricelistTrigger({
      intents: extractFastIntents('biayanya brp?'),
      executedTools: [],
      pricelistSent: false,
    });
    expect(v.send).toBe(false);
  });

  it('KETAHANAN: input kosong/undefined tidak melempar', () => {
    expect(() => evaluatePricelistTrigger({ intents: [], executedTools: [], pricelistSent: false })).not.toThrow();
    expect(evaluatePricelistTrigger({ intents: undefined as any, executedTools: [] as any, pricelistSent: false }).send).toBe(false);
  });
});

describe('RESOLVER PRICELIST — provider-aware (WAHA vs WABA)', () => {
  beforeEach(() => {
    fs.mkdirSync(path.dirname(TEST_ABS), { recursive: true });
    fs.writeFileSync(TEST_ABS, Buffer.from('png'));
    process.env.CLINIC_PRICELIST_IMAGE_URL = TEST_REL;
  });

  afterEach(() => {
    try { fs.unlinkSync(TEST_ABS); } catch {}
    delete process.env.CLINIC_PRICELIST_IMAGE_URL;
    delete process.env.PUBLIC_BASE_URL;
  });

  it('WAHA: /media/outbound/… → path file lokal', async () => {
    const target = await resolvePricelistImageTarget(TEST_TENANT, 'WAHA');
    expect(target).toBe(TEST_ABS);
  });

  it('WABA: /media/outbound/… + PUBLIC_BASE_URL → URL publik', async () => {
    process.env.PUBLIC_BASE_URL = 'https://app.example.com';
    const target = await resolvePricelistImageTarget(TEST_TENANT, 'WABA');
    expect(target).toBe(`https://app.example.com${TEST_REL}`);
  });

  it('WABA: tanpa PUBLIC_BASE_URL → null (bukan URL mati)', async () => {
    const target = await resolvePricelistImageTarget(TEST_TENANT, 'WABA');
    expect(target).toBeNull();
  });

  it('path file lokal sembarang: WAHA langsung, WABA null', async () => {
    process.env.CLINIC_PRICELIST_IMAGE_URL = 'assets/pricelist_spa.jpg';
    expect(await resolvePricelistImageTarget(TEST_TENANT, 'WAHA')).toBe('assets/pricelist_spa.jpg');
    expect(await resolvePricelistImageTarget(TEST_TENANT, 'WABA')).toBeNull();
  });
});
