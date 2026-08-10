/**
 * Cost Calculator — memetakan model LLM ke estimasi biaya per 1.000 token dalam mata uang Rupiah (IDR).
 * Mendukung tarif SumoPod Proxy & DeepSeek Direct dengan Prompt Caching (Cache Hit vs Cache Miss).
 * Kurs diset ke 1 USD = Rp 18.000 (dapat disesuaikan via env USD_TO_IDR).
 */

const USD_TO_IDR = Number(process.env.USD_TO_IDR || 18000);

export interface ModelPricing {
  provider: string;
  promptCostPer1kIdr: number; // Cache Miss rate
  promptCacheHitCostPer1kIdr?: number; // Cache Hit rate
  completionCostPer1kIdr: number;
}

/**
 * Tabel tarif per 1.000 token (IDR) berdasarkan provider/model.
 * Menggunakan tarif resmi SumoPod Proxy:
 * - DeepSeek Cache Hit: $0.003 / 1M
 * - DeepSeek Cache Miss: $0.14 / 1M
 * - DeepSeek Output Tokens: $0.28 / 1M
 */
const MODEL_PRICING_MAP: Record<string, ModelPricing> = {
  // DeepSeek / SumoPod Proxy Pricing
  'deepseek-chat': {
    provider: 'SumoPod (DeepSeek)',
    promptCostPer1kIdr: (0.14 / 1000) * USD_TO_IDR, // Cache Miss
    promptCacheHitCostPer1kIdr: (0.003 / 1000) * USD_TO_IDR, // Cache Hit
    completionCostPer1kIdr: (0.28 / 1000) * USD_TO_IDR,
  },
  'deepseek-v4-flash': {
    provider: 'SumoPod (DeepSeek)',
    promptCostPer1kIdr: (0.14 / 1000) * USD_TO_IDR,
    promptCacheHitCostPer1kIdr: (0.003 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (0.28 / 1000) * USD_TO_IDR,
  },
  'deepseek-reasoner': {
    provider: 'SumoPod (DeepSeek Reasoner)',
    promptCostPer1kIdr: (0.55 / 1000) * USD_TO_IDR,
    promptCacheHitCostPer1kIdr: (0.14 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (2.19 / 1000) * USD_TO_IDR,
  },

  // MiniMax Models (via SumoPod)
  // Tarif per Agust 2026: promo diskon 90% — Input $0.03 / 1M, Output $0.12 / 1M
  // (harga normal: $0.30 / 1M input, $1.20 / 1M output; konteks 204.800 token).
  'minimax-m2.7-highspeed': {
    provider: 'MiniMax',
    promptCostPer1kIdr: (0.03 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (0.12 / 1000) * USD_TO_IDR,
  },

  // OpenAI Models
  'gpt-4o-mini': {
    provider: 'OpenAI',
    promptCostPer1kIdr: (0.15 / 1000) * USD_TO_IDR,
    promptCacheHitCostPer1kIdr: (0.075 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (0.60 / 1000) * USD_TO_IDR,
  },
  'gpt-4o': {
    provider: 'OpenAI',
    promptCostPer1kIdr: (2.50 / 1000) * USD_TO_IDR,
    promptCacheHitCostPer1kIdr: (1.25 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (10.00 / 1000) * USD_TO_IDR,
  },

  // Qwen Models
  'qwen3.7-flash-2026-07-15': {
    provider: 'Alibaba Qwen',
    promptCostPer1kIdr: (0.03 / 1000) * USD_TO_IDR,
    promptCacheHitCostPer1kIdr: (0.006 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (0.13 / 1000) * USD_TO_IDR,
  },

  // Google Gemini
  'gemini-1.5-flash': {
    provider: 'Google Gemini',
    promptCostPer1kIdr: (0.075 / 1000) * USD_TO_IDR,
    promptCacheHitCostPer1kIdr: (0.01875 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (0.30 / 1000) * USD_TO_IDR,
  },
  'gemini-2.5-flash': {
    provider: 'Google Gemini',
    promptCostPer1kIdr: (0.075 / 1000) * USD_TO_IDR,
    promptCacheHitCostPer1kIdr: (0.01875 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (0.30 / 1000) * USD_TO_IDR,
  },
};

const DEFAULT_PRICING: ModelPricing = {
  provider: 'LLM Provider',
  promptCostPer1kIdr: (0.03 / 1000) * USD_TO_IDR,
  completionCostPer1kIdr: (0.12 / 1000) * USD_TO_IDR,
};

/**
 * Menentukan provider aktual dari base URL yang benar-benar dipakai request
 * (SumoPod vs DeepSeek Direct vs OpenAI), bukan dari nama model — karena nama
 * model bisa sama tapi di-host oleh provider berbeda (mis. deepseek-v4-flash
 * di SumoPod vs di api.deepseek.com).
 */
export function deriveProvider(baseUrl?: string | null): string {
  const raw = (baseUrl || '').toLowerCase();
  if (!raw) return 'LLM Provider';
  if (raw.includes('sumopod')) return 'SumoPod';
  if (raw.includes('api.deepseek.com') || raw.includes('deepseek.com')) return 'DeepSeek Direct';
  if (raw.includes('api.openai.com') || raw.includes('openai.azure') || raw.includes('ai.azure.com')) return 'OpenAI';
  try {
    return new URL(raw).host;
  } catch {
    return raw.replace(/^https?:\/\//, '').split('/')[0] || 'LLM Provider';
  }
}

/**
 * Menghitung estimasi total biaya LLM dalam Rupiah (IDR) berdasarkan token prompt (miss & hit) dan completion.
 */
export function calculateLlmCost(
  modelName: string,
  promptTokens: number,
  completionTokens: number,
  cachedPromptTokens: number = 0
): { provider: string; promptCostIdr: number; completionCostIdr: number; totalCostIdr: number } {
  const normalizedName = (modelName || '').toLowerCase().trim();
  const pricing = MODEL_PRICING_MAP[normalizedName] || DEFAULT_PRICING;

  const hitTokens = Math.min(promptTokens, Math.max(0, cachedPromptTokens));
  const missTokens = Math.max(0, promptTokens - hitTokens);

  const hitRatePer1k = pricing.promptCacheHitCostPer1kIdr ?? pricing.promptCostPer1kIdr;
  const promptCostIdr = (missTokens / 1000) * pricing.promptCostPer1kIdr + (hitTokens / 1000) * hitRatePer1k;
  const completionCostIdr = (completionTokens / 1000) * pricing.completionCostPer1kIdr;
  const totalCostIdr = promptCostIdr + completionCostIdr;

  return {
    provider: pricing.provider,
    promptCostIdr: Number(promptCostIdr.toFixed(4)),
    completionCostIdr: Number(completionCostIdr.toFixed(4)),
    totalCostIdr: Number(totalCostIdr.toFixed(4)),
  };
}
