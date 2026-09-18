import { describe, it, expect } from 'vitest';
import { ToolExecutionPipeline } from '../../src/v3/agent/pipeline/tool-pipeline';

describe('Fase 2.1 — buildLlmSafeToolPayload pure structured data', () => {
  it('calculate_delivery: suggestedTemplateReply & nominal leak removed', () => {
    const raw = {
      success: true,
      distanceKm: 8.5,
      ongkirNormal: 15000,
      ongkirPromo: 5000,
      suggestedTemplateReply: 'Format Penyampaian Harga ... Rp 5.000 ...',
      suggestedPriceReply: 'Rp 5.000',
      suggestedConsultationReply: 'Pilihan yang bagus ...',
      message: 'Jarak 8.5 km ... Format penyampaian yang disarankan: ... sugestedTemplateReply ...',
      __internalOngkirNormal: 15000,
      __internalOngkirPromo: 5000,
    };
    const safe = ToolExecutionPipeline.buildLlmSafeToolPayload('calculate_delivery', raw);
    expect(safe).not.toHaveProperty('suggestedTemplateReply');
    expect(safe).not.toHaveProperty('suggestedPriceReply');
    expect(safe).not.toHaveProperty('suggestedConsultationReply');
    expect(safe).not.toHaveProperty('__internalOngkirNormal');
    expect(safe.message).not.toContain('Format penyampaian');
  });

  it('get_catalog: suggestedConsultationReply removed', () => {
    const raw = { suggestedConsultationReply: 'Pilihan yang bagus ...', pricingBreakdown: { promoPrice: 70000 } };
    const safe = ToolExecutionPipeline.buildLlmSafeToolPayload('get_catalog_and_price', raw);
    expect(safe).not.toHaveProperty('suggestedConsultationReply');
    expect(safe.pricingBreakdown).toBeDefined();
  });

  it('non-object passthrough', () => {
    expect(ToolExecutionPipeline.buildLlmSafeToolPayload('search_knowledge_faq', null)).toBeNull();
    expect(ToolExecutionPipeline.buildLlmSafeToolPayload('search_knowledge_faq', 'text')).toBe('text');
  });
});
