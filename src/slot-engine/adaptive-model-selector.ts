import { CustomerSlate, ExtractedEntities } from './types';
import { AiModelConfigService, AiTaskModelConfig } from '../config/ai-models.config';
import { DEFAULT_TENANT_ID } from '../config/tenant';

export interface ModelSelectionResult {
  task: 'CHAT_REPLY' | 'CHAT_REPLY_DEEP';
  modelConfig: AiTaskModelConfig;
  modelName: string;
  reason: string;
  isDeepModel: boolean;
}

/**
 * AdaptiveModelSelector
 * Menentukan model LLM (Cepat vs Pintar/Deep) secara deterministik (0ms, 0 Token)
 * berdasarkan tingkat kompleksitas klinis dan percakapan customer.
 */
export class AdaptiveModelSelector {
  public static selectModel(
    slate: CustomerSlate,
    extraction: ExtractedEntities,
    options?: {
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
      customerInput?: string;
      tenantId?: string;
    }
  ): ModelSelectionResult {
    const tenantId = options?.tenantId || slate.tenantId || DEFAULT_TENANT_ID;
    const inputLower = (options?.customerInput || '').toLowerCase();
    const historyCount = options?.history?.length ?? 0;

    // 1. Kriteria Kompleksitas Tinggi (Deep Reasoning Model):
    // A. Pasien memiliki >= 2 gejala klinis kompleks
    const totalSymptoms = Array.from(new Set([...(slate.symptoms || []), ...(extraction.symptoms || [])]));
    const hasMultipleSymptoms = totalSymptoms.length >= 2;

    // B. Pertanyaan multi-intent klinis (konsultasi keluhan + tanya harga + tanya jadwal bersamaan)
    const hasMultiIntent =
      extraction.intents.includes('consult_symptom') &&
      (extraction.intents.includes('ask_price') || extraction.intents.includes('ask_schedule') || Boolean(extraction.preferredDateText));

    // C. Diskusi bundling multi-kategori (Moms/Laktasi + Baby secara bersamaan)
    const isMomsAndBabyCombo =
      /\b(laktasi|oksitosin|ibu|moms?|nifas)\b/i.test(inputLower) &&
      /\b(bayi|baby|anak|si\s*kecil|newborn|pulih|batuk|pilek)\b/i.test(inputLower);

    // D. Percakapan konsultasi panjang yang berliku (> 6 turn dengan keluhan)
    const isLongClinicalDialogue = historyCount >= 6 && totalSymptoms.length > 0;

    const shouldUseDeep = hasMultipleSymptoms || hasMultiIntent || isMomsAndBabyCombo || isLongClinicalDialogue;

    if (shouldUseDeep) {
      const deepConfig = AiModelConfigService.getModelConfig('CHAT_REPLY_DEEP', tenantId);
      let reason = 'Konsultasi keluhan kompleks';
      if (hasMultipleSymptoms) reason = `Multi-gejala klinis (${totalSymptoms.join(', ')})`;
      else if (isMomsAndBabyCombo) reason = 'Diskusi bundling layanan Moms & Baby';
      else if (hasMultiIntent) reason = 'Pertanyaan gabungan keluhan klinis + tarif/jadwal';
      else if (isLongClinicalDialogue) reason = 'Konsultasi mendalam multi-turn';

      return {
        task: 'CHAT_REPLY_DEEP',
        modelConfig: deepConfig,
        modelName: deepConfig.modelName || 'gpt-4o-mini',
        reason,
        isDeepModel: true,
      };
    }

    // Default: Gunakan Model Standar (Cepat & Ekonomis)
    const standardConfig = AiModelConfigService.getModelConfig('CHAT_REPLY', tenantId);
    return {
      task: 'CHAT_REPLY',
      modelConfig: standardConfig,
      modelName: standardConfig.modelName || 'gpt-4o-mini',
      reason: 'Pertanyaan umum / SOP standar / FAQ ringan',
      isDeepModel: false,
    };
  }
}
