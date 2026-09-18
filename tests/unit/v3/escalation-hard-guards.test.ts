import { describe, it, expect } from 'vitest';
import { MedicalDetectionService } from '../../../src/services/medical-detection.service';
import { buildRouterToolRoutingBlock } from '../../../src/v3/agent/prompt/phases/router-tool-routing.layer';

/**
 * Audit simulator (DeepSeek Flash over-helpful): varian bahasa non-formal
 * infeksi/nifas/laktasi WAJIB terdeteksi MEDIUM (jalur eskalasi deterministik
 * machine.ts), dan bullet escalate_to_human WAJIB mencakup komplain purna-layanan.
 */
describe('Escalation hard-guards (audit simulator)', () => {
  it('infeksi tali pusat non-formal → MEDIUM', () => {
    for (const q of ['tali pusar bau', 'tali pusarnya bau', 'pusarnya bau', 'pusar berbau']) {
      const r = MedicalDetectionService.detectMedicalConcern(`bayi saya ${q}, gimana ya?`);
      expect(r.isMedical, q).toBe(true);
      expect(r.severity, q).toBe('MEDIUM');
    }
  });

  it('nyeri nifas non-formal → MEDIUM', () => {
    for (const q of ['jahitan ngilu', 'jahitannya ngilu', 'jahitan masih ngilu', 'ngilu bekas jahitan']) {
      const r = MedicalDetectionService.detectMedicalConcern(`bu, ${q} setelah melahirkan`);
      expect(r.isMedical, q).toBe(true);
      expect(r.severity, q).toBe('MEDIUM');
    }
  });

  it('laktasi berat → MEDIUM', () => {
    const r = MedicalDetectionService.detectMedicalConcern('payudara mengeras nyeri dan bengkak');
    expect(r.isMedical).toBe(true);
    expect(r.severity).toBe('MEDIUM');
  });

  it('non-medis tetap NONE (anti false-positive)', () => {
    const r = MedicalDetectionService.detectMedicalConcern('Berapa harga paket pijat bayi home treatment?');
    expect(r.isMedical).toBe(false);
    expect(r.severity).toBe('NONE');
  });

  it('bullet escalate_to_human mencakup komplain purna-layanan + slot spesifik + medis non-spa', () => {
    const block = buildRouterToolRoutingBlock();
    expect(block).toContain('tindik miring');
    expect(block).toContain('nyasar');
    expect(block).toContain('tali pusar berbau');
    expect(block).toContain('escalate_to_human');
  });
});
