import { describe, it, expect } from 'vitest';
import { ContextGrounder } from '../../../src/v3/agent/pipeline/context-grounder';
import {
  executeCalculateDelivery,
  buildScheduleCta,
} from '../../../src/v3/tools/calculate-delivery.tool';

/**
 * Phase 3+5 (audit 337101 Turn 5-6) — CTA ongkir context-aware: waktu yang
 * sudah diminta DILARANG ditanyakan ulang.
 *
 * Direvisi (2026-09-18): CTA kini STATE-AWARE (Aturan Emas 20) — sandaran pada
 * state sesi (hari/treatment/keranjang), bukan pola kalimat. Tambahan assertion
 * netralitas agama + anti format-menempel.
 */
describe('Delivery Schedule CTA Context', () => {
  it('extractTimeHint: sekarang/hari ini/nama hari; "3 minggu" dikecualikan', () => {
    expect(ContextGrounder.extractTimeHint('sekarang bisa?')).toBe('sekarang');
    expect(ContextGrounder.extractTimeHint('Untuk jumat besok apakah bisa?')).toBe('jumat');
    expect(ContextGrounder.extractTimeHint('hari ini bisa jam berapa?')).toBe('hari ini');
    expect(ContextGrounder.extractTimeHint('bayi saya umur 3 minggu')).toBeNull();
    expect(ContextGrounder.extractTimeHint('harganya berapa ya?')).toBeNull();
  });

  describe('buildScheduleCta — 3 cabang state-aware', () => {
    it('ada hari -> akui+cekkan, DILARANG tanya hari', () => {
      const cta = buildScheduleCta('sekarang');
      expect(cta).toContain('sekarang');
      expect(cta).not.toMatch(/hari apa/i);
    });

    it('ada hari (object form) -> akui+cekkan', () => {
      const cta = buildScheduleCta({ preferredDate: 'besok pagi' });
      expect(cta).toContain('besok pagi');
      expect(cta).toContain('akan kami bantu cekkan');
      expect(cta).not.toMatch(/hari apa/i);
    });

    it('ada treatment & tanpa hari -> tanya hari kunjungan', () => {
      const cta = buildScheduleCta({ candidateTreatmentName: 'Pijat Batuk Pilek' });
      expect(cta).toContain('Pijat Batuk Pilek');
      expect(cta).toMatch(/hari apa/i);
    });

    it('ada item keranjang & tanpa hari -> tanya hari kunjungan', () => {
      const cta = buildScheduleCta({ hasCartItems: true });
      expect(cta).toMatch(/hari apa/i);
    });

    it('tanpa treatment & tanpa hari -> tanya kebutuhan perawatan, BUKAN hari (Aturan Emas 20)', () => {
      const cta = buildScheduleCta({});
      expect(cta).toContain('perawatan apa');
      expect(cta).not.toMatch(/hari apa/i);
    });

    it('string kosong / undefined -> tanya kebutuhan perawatan', () => {
      expect(buildScheduleCta('')).toContain('perawatan apa');
      expect(buildScheduleCta(undefined)).toContain('perawatan apa');
    });
  });

  it('delivery + preferredDate -> template TANPA "hari apa", DENGAN waktu diminta', async () => {
    const out = await executeCalculateDelivery({
      locationText: 'https://www.google.com/maps/@-7.340000,112.720000,17z',
      candidateTreatmentName: 'Pijat Bayi Ceria (Rileksasi)',
      preferredDate: 'sekarang',
    });
    expect(out.success).toBe(true);
    expect(out.suggestedTemplateReply).not.toMatch(/hari apa/i);
    expect(out.suggestedTemplateReply).toContain('sekarang');
  });

  it('delivery tanpa preferredDate & tanpa treatment -> tanya kebutuhan perawatan, bukan hari', async () => {
    const out = await executeCalculateDelivery({
      locationText: 'https://www.google.com/maps/@-7.340000,112.720000,17z',
    });
    expect(out.success).toBe(true);
    expect(out.suggestedTemplateReply).not.toMatch(/hari apa/i);
    expect(out.suggestedTemplateReply).toMatch(/perawatan apa/i);
  });

  it('delivery tanpa preferredDate & ADA candidateTreatmentName -> tanya hari kunjungan', async () => {
    const out = await executeCalculateDelivery({
      locationText: 'https://www.google.com/maps/@-7.340000,112.720000,17z',
      candidateTreatmentName: 'Pijat Bayi Ceria (Rileksasi)',
    });
    expect(out.success).toBe(true);
    expect(out.suggestedTemplateReply).toMatch(/hari apa/i);
    expect(out.suggestedTemplateReply).toContain('Pijat Bayi Ceria');
  });

  it('netralitas agama: hasil delivery TIDAK boleh memuat kata keagamaan sepihak', async () => {
    const out = await executeCalculateDelivery({
      locationText: 'https://www.google.com/maps/@-7.340000,112.720000,17z',
    });
    expect(out.success).toBe(true);
    expect(out.suggestedTemplateReply).not.toMatch(/alhamdulillah/i);
    expect(out.message).not.toMatch(/alhamdulillah/i);
  });

  it('anti format-menempel: tidak ada titik langsung diikuti huruf kapital tanpa spasi/newline', async () => {
    const out = await executeCalculateDelivery({
      locationText: 'https://www.google.com/maps/@-7.340000,112.720000,17z',
      candidateTreatmentName: 'Pijat Bayi Ceria (Rileksasi)',
    });
    expect(out.success).toBe(true);
    expect(out.suggestedTemplateReply || '').not.toMatch(/\.[A-Z]/);
  });
});
