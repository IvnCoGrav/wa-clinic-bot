/**
 * Cost Calculator — memetakan model LLM ke estimasi biaya per 1.000 token dalam mata uang Rupiah (IDR).
 * Asumsi kurs 1 USD = Rp 16.000 (dapat disesuaikan via env USD_TO_IDR).
 */

const USD_TO_IDR = Number(process.env.USD_TO_IDR || 16000);

export interface ModelPricing {
  promptCostPer1kIdr: number;
  completionCostPer1kIdr: number;
}

/**
 * Tabel tarif per 1.000 token (IDR) berdasarkan provider/model.
 */
const MODEL_PRICING_MAP: Record<string, ModelPricing> = {
  // DeepSeek Chat / V3 (Input: $0.14 / 1M, Output: $0.28 / 1M)
  'deepseek-chat': {
    promptCostPer1kIdr: (0.14 / 1000) * USD_TO_IDR, // ~Rp 2.24 per 1k
    completionCostPer1kIdr: (0.28 / 1000) * USD_TO_IDR, // ~Rp 4.48 per 1k
  },
  'deepseek-reasoner': {
    promptCostPer1kIdr: (0.55 / 1000) * USD_TO_IDR, // ~Rp 8.80 per 1k
    completionCostPer1kIdr: (2.19 / 1000) * USD_TO_IDR, // ~Rp 35.04 per 1k
  },

  // MiniMax Models
  'minimax-m2.7-highspeed': {
    promptCostPer1kIdr: 0.002 * USD_TO_IDR, // ~Rp 3.20 per 1k
    completionCostPer1kIdr: 0.006 * USD_TO_IDR, // ~Rp 9.60 per 1k
  },

  // OpenAI Models
  'gpt-4o-mini': {
    promptCostPer1kIdr: (0.15 / 1000) * USD_TO_IDR, // ~Rp 2.40 per 1k
    completionCostPer1kIdr: (0.60 / 1000) * USD_TO_IDR, // ~Rp 9.60 per 1k
  },
  'gpt-4o': {
    promptCostPer1kIdr: (2.50 / 1000) * USD_TO_IDR, // ~Rp 40.00 per 1k
    completionCostPer1kIdr: (10.00 / 1000) * USD_TO_IDR, // ~Rp 160.00 per 1k
  },

  // Qwen Models
  'qwen3.7-flash-2026-07-15': {
    promptCostPer1kIdr: 0.001 * USD_TO_IDR, // ~Rp 1.60 per 1k
    completionCostPer1kIdr: 0.003 * USD_TO_IDR, // ~Rp 4.80 per 1k
  },
};

const DEFAULT_PRICING: ModelPricing = {
  promptCostPer1kIdr: 0.002 * USD_TO_IDR, // Rp 3.20 per 1k
  completionCostPer1kIdr: 0.006 * USD_TO_IDR, // Rp 9.60 per 1k
};

/**
 * Menghitung estimasi total biaya LLM dalam Rupiah (IDR) berdasarkan token prompt dan completion.
 */
export function calculateLlmCost(
  modelName: string,
  promptTokens: number,
  completionTokens: number
): { promptCostIdr: number; completionCostIdr: number; totalCostIdr: number } {
  const normalizedName = (modelName || '').toLowerCase().trim();
  const pricing = MODEL_PRICING_MAP[normalizedName] || DEFAULT_PRICING;

  const promptCostIdr = (promptTokens / 1000) * pricing.promptCostPer1kIdr;
  const completionCostIdr = (completionTokens / 1000) * pricing.completionCostPer1kIdr;
  const totalCostIdr = promptCostIdr + completionCostIdr;

  return {
    promptCostIdr: Number(promptCostIdr.toFixed(4)),
    completionCostIdr: Number(completionCostIdr.toFixed(4)),
    totalCostIdr: Number(totalCostIdr.toFixed(4)),
  };
}
