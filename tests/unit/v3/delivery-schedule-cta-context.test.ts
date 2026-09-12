import { describe, it, expect } from 'vitest';
import { ContextGrounder } from '../../../src/v3/agent/pipeline/context-grounder';
import {
  executeCalculateDelivery,
  buildScheduleCta,
} from '../../../src/v3/tools/calculate-delivery.tool';

/**
 * Phase 3+5 (audit 337101 Turn 5-6) — CTA ongkir context-aware: waktu yang
 * sudah diminta DILARANG ditanyakan ulang.
 */
describe('Delivery Schedule CTA Context', () => {
  it('extractTimeHint: sekarang/hari ini/nama hari; "3 minggu" dikecualikan', () => {
    expect(ContextGrounder.extractTimeHint('sekarang bisa?')).toBe('sekarang');
    expect(ContextGrounder.extractTimeHint('Untuk jumat besok apakah bisa?')).toBe('jumat');
    expect(ContextGrounder.extractTimeHint('hari ini bisa jam berapa?')).toBe('hari ini');
    expect(ContextGrounder.extractTimeHint('bayi saya umur 3 minggu')).toBeNull();
    expect(ContextGrounder.extractTimeHint('harganya berapa ya?')).toBeNull();
  });

  it('buildScheduleCta: ada waktu -> akui+cekkan; kosong -> tanya hari', () => {
    const withTime = buildScheduleCta('sekarang');
    expect(withTime).toContain('sekarang');
    expect(withTime).not.toMatch(/hari apa/i);
    expect(buildScheduleCta(undefined)).toMatch(/hari apa/i);
    expect(buildScheduleCta('')).toMatch(/hari apa/i);
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

  it('delivery tanpa preferredDate -> CTA lama lestari', async () => {
    const out = await executeCalculateDelivery({
      locationText: 'https://www.google.com/maps/@-7.340000,112.720000,17z',
      candidateTreatmentName: 'Pijat Bayi Ceria (Rileksasi)',
    });
    expect(out.success).toBe(true);
    expect(out.suggestedTemplateReply).toMatch(/hari apa/i);
  });
});
