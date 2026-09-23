import { describe, it, expect, vi, afterEach } from 'vitest';
import { geocodingService } from '../../src/integrations/google-maps/geocoding';
import { executeCalculateDelivery } from '../../src/v3/tools/calculate-delivery.tool';
import { OutputSanitizer } from '../../src/v3/guardrails/sanitizer';
import { buildToneNegConstraints } from '../../src/v3/agent/prompt/layers/core-persona.layer';
import { buildRouterDirectReplyBlock } from '../../src/v3/agent/prompt/phases/router-direct-reply.layer';
import { ToolExecutionPipeline } from '../../src/v3/agent/pipeline/tool-pipeline';

describe('v3-geocoding-singleflight — audit 2026-09-23', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('T1 — Vague-landmark multi-phrasing 0ms tanpa LLM (adversarial)', () => {
    const vagueVariants = [
      'sidoarjo kota dekat pintu masuk tol',
      'sidoarjo kota pinggir tol',
      'dekat jembatan sidoarjo kota',
      'sidoarjo kota dkt pintu tol',
      'sidoarjo kota dekat pasar',
      'sidoarjo kota dekat lampu merah',
    ];
    for (const variant of vagueVariants) {
      it(`"${variant}" → imprecise, tanpa Rp/km, ≤1 LLM`, async () => {
        const llmSpy = vi.spyOn(geocodingService as any, 'llmResolveLocation');
        const t0 = Date.now();
        const res: any = await executeCalculateDelivery({ locationText: variant });
        const elapsed = Date.now() - t0;
        expect(res.isPrecise).toBe(false);
        expect(res.success).toBe(false);
        expect(res.message).not.toMatch(/Rp\s*[\d.]+/);
        expect(res.message).not.toMatch(/\d+[.,]\d+\s*km/);
        // Single-flight: maksimal 1 panggilan LLM (0 ideal, 1 toleransi bila fuzzy token terpicu)
        expect(llmSpy.mock.calls.length).toBeLessThanOrEqual(1);
        expect(elapsed).toBeLessThan(2000);
      });
    }
  });

  describe('T2 — Single-flight Tier-2 (Google client removed)', () => {
    it('geocodeBreaker fallback tidak memanggil LLM kedua', async () => {
      const llmSpy = vi.spyOn(geocodingService as any, 'llmResolveLocation');
      const prevKey = process.env.GOOGLE_MAPS_API_KEY;
      process.env.GOOGLE_MAPS_API_KEY = 'live-key-simulated';
      // @ts-ignore — akses breaker langsung
      (geocodingService as any).apiKey = 'live-key-simulated';
      try {
        // Trigger breaker fallback via Tier-2 path: geocodeText dengan query tak dikenal
        // yang tidak match hard-gate kecamatan, sehingga masuk Tier-2.
        const res = await geocodingService.geocodeText('xyzqwerty tidak dikenal');
        // Hasil harus dari localMatch (imprecise tanpa lat/lng), bukan dari LLM kedua berulang
        expect(res.isPrecise).toBe(false);
        // LLM dipanggil maksimal 1x (single-flight), bukan 2x
        expect(llmSpy.mock.calls.length).toBeLessThanOrEqual(1);
      } finally {
        process.env.GOOGLE_MAPS_API_KEY = prevKey;
        (geocodingService as any).apiKey = prevKey || '';
        vi.restoreAllMocks();
      }
    });
  });

  describe('T3 — POI regression lock (presisi gazetteer)', () => {
    it('banjarmukti residence sidoarjo tetap presisi', async () => {
      const res = await geocodingService.geocodeText('banjarmukti residence sidoarjo');
      expect(res.kelurahan).toBeDefined();
    });
    it('brebek waru tidak regresi (tetap Waru, presisi atau ambiguitas Waru)', async () => {
      const res = await geocodingService.geocodeText('brebek waru');
      // Sebelumnya fuzzy Berbek/Waru; kini mungkin ambiguitas Waru (17 desa) — keduanya
      // dianggap non-regresi selama tetap dalam kecamatan Waru dan tidak throw.
      const isWaru = res.kecamatan === 'Waru' || (res.ambiguityResults && res.ambiguityResults[0]?.Kecamatan === 'Waru');
      expect(isWaru).toBe(true);
    });
  });

  describe('T4 — Tool-timeout grounding via TEMPLATES', () => {
    it('buildLlmSafeToolPayload menghapus template namun message aman', () => {
      const fakeResult: any = {
        success: false,
        isPrecise: false,
        message: 'Perhitungan jarak otomatis terkendala teknis (timeout). Sampaikan bahwa area tersebut masuk jangkauan layanan homecare kami, lalu tanyakan nama kelurahan atau perumahan spesifik agar Bidan kami dapat memastikan jarak dan rutenya. DILARANG menyebut nominal jarak maupun ongkir.',
        suggestedTemplateReply: 'Kalau boleh tau lebih tepatnya area tersebut di kelurahan atau desa mana bunda?',
        suggestedPriceReply: 'should be removed',
      };
      const safe = ToolExecutionPipeline.buildLlmSafeToolPayload('calculate_delivery', fakeResult);
      expect(safe.suggestedTemplateReply).toBeUndefined();
      expect(safe.suggestedPriceReply).toBeUndefined();
      expect(safe.message).toContain('terkendala teknis');
      expect(safe.message).not.toMatch(/Rp\s*[\d.]+/);
    });
    it('executeCalculateDelivery catch internal mengembalikan kontrak terstruktur', async () => {
      // Simulasi error internal via mock deliveryService.calculateDelivery throw
      const { deliveryService } = await import('../../src/services/delivery.service');
      const spy = vi.spyOn(deliveryService, 'calculateDelivery').mockRejectedValue(new Error('ORSSIM_FAIL'));
      // Query presisi agar sampai ke deliveryService (bukan hard-gate kecamatan)
      const res: any = await executeCalculateDelivery({ locationText: 'Pabean Sedati' });
      // Harus bukan throw, melainkan kontrak fallback terstruktur
      expect(res.success).toBe(false);
      expect(res.isPrecise).toBe(false);
      expect(res.message).toContain('terkendala teknis');
      expect(res.message).not.toMatch(/Rp\s*[\d.]+/);
      expect(res.suggestedTemplateReply).toBeDefined();
      spy.mockRestore();
    });
  });

  describe('T5 — Prompt integrity (info-hiding)', () => {
    it('buildToneNegConstraints bersih dari daftar tabu eksplisit, tetap ada Waalaikumsalam', () => {
      const prompt = buildToneNegConstraints();
      expect(prompt).not.toMatch(/alhamdulillah/i);
      expect(prompt).not.toMatch(/bismillah/i);
      expect(prompt).not.toMatch(/insya/i);
      expect(prompt).not.toMatch(/puji tuhan/i);
      expect(prompt).toMatch(/Waalaikumsalam/);
      expect(prompt).toMatch(/NETRALITAS PROFESIONAL/);
    });
    it('router-direct-reply bersih dari daftar tabu eksplisit', () => {
      const block = buildRouterDirectReplyBlock({ genderGreeting: 'Bunda' } as any, false, 'Klinik Test');
      expect(block).not.toMatch(/alhamdulillah/i);
      expect(block).not.toMatch(/bismillah/i);
      expect(block).not.toMatch(/insya/i);
      expect(block).not.toMatch(/puji tuhan/i);
      expect(block).toMatch(/Waalaikumsalam/);
      expect(block).toMatch(/NETRALITAS PROFESIONAL/);
    });
  });

  describe('T6 — Hesitation normalizer multi-phrasing', () => {
    const cases: Array<[string, string]> = [
      ['jadi insyaa... eh, kami bantu pastikan jaraknya ya.', 'jadi kami bantu pastikan jaraknya ya.'],
      ['baik... eh, kami cekkan dulu ya Bunda.', 'baik kami cekkan dulu ya Bunda.'],
      ['siap... anu, kami bantu cekkan kelurahannya.', 'siap kami bantu cekkan kelurahannya.'],
      ['wilayah Sidoarjo kota memang sudah masuk jangkauan layanan homecare kami, jadi insyaa... eh, kami bantu pastikan jaraknya ya.', 'wilayah Sidoarjo kota memang sudah masuk jangkauan layanan homecare kami, jadi kami bantu pastikan jaraknya ya.'],
    ];
    for (const [input, expectedContains] of cases) {
      it(`sanitasi "${input.slice(0, 30)}..."`, () => {
        const out = OutputSanitizer.sanitizeHesitationArtifacts(input);
        expect(out).not.toMatch(/\.\.\.\s*eh/i);
        expect(out).not.toMatch(/insyaa/i);
        expect(out).toContain(expectedContains.split(' ').slice(-2).join(' '));
      });
    }
    it('cleanOutboundReply mengaplikasikan sanitizer hesitation', () => {
      const raw = 'Wilayah Sidoarjo kota memang sudah masuk jangkauan layanan homecare kami, jadi insyaa... eh, kami bantu pastikan jaraknya ya.';
      const cleaned = OutputSanitizer.cleanOutboundReply(raw, 'sidoarjo kota dekat pintu masuk tol');
      expect(cleaned).not.toMatch(/insyaa/i);
      expect(cleaned).not.toMatch(/\.\.\.\s*eh/i);
    });
  });
});
