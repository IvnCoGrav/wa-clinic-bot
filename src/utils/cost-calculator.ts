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
  // Qwen Models (Alibaba) — Primary Model
  'qwen3.7-flash-2026-07-15': {
    provider: 'Alibaba Qwen',
    promptCostPer1kIdr: (0.03 / 1000) * USD_TO_IDR, // Cache Miss ($0.03 / 1M)
    promptCacheHitCostPer1kIdr: (0.006 / 1000) * USD_TO_IDR, // Cache Hit ($0.006 / 1M)
    completionCostPer1kIdr: (0.13 / 1000) * USD_TO_IDR, // Output ($0.13 / 1M)
  },
  'qwen3.6-flash': {
    provider: 'Alibaba Qwen',
    promptCostPer1kIdr: (0.25 / 1000) * USD_TO_IDR,
    promptCacheHitCostPer1kIdr: (0.025 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (1.50 / 1000) * USD_TO_IDR,
  },
  'qwen3.7-plus': {
    provider: 'Alibaba Qwen',
    promptCostPer1kIdr: (0.32 / 1000) * USD_TO_IDR,
    promptCacheHitCostPer1kIdr: (0.032 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (1.28 / 1000) * USD_TO_IDR,
  },

  // OpenAI Models (Internal Fallback)
  'gpt-5-nano': {
    provider: 'OpenAI',
    promptCostPer1kIdr: (0.05 / 1000) * USD_TO_IDR, // Cache Miss ($0.05 / 1M)
    promptCacheHitCostPer1kIdr: (0.005 / 1000) * USD_TO_IDR, // Cache Hit ($0.005 / 1M)
    completionCostPer1kIdr: (0.40 / 1000) * USD_TO_IDR, // Output ($0.40 / 1M)
  },
  'gpt-4.1-nano': {
    provider: 'OpenAI',
    promptCostPer1kIdr: (0.10 / 1000) * USD_TO_IDR,
    promptCacheHitCostPer1kIdr: (0.025 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (0.40 / 1000) * USD_TO_IDR,
  },
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
  'gpt-5.4-nano': {
    provider: 'OpenAI',
    promptCostPer1kIdr: (0.20 / 1000) * USD_TO_IDR,
    promptCacheHitCostPer1kIdr: (0.020 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (1.25 / 1000) * USD_TO_IDR,
  },
  'gpt-5.6-luna': {
    provider: 'OpenAI',
    promptCostPer1kIdr: (0.20 / 1000) * USD_TO_IDR,
    promptCacheHitCostPer1kIdr: (0.020 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (1.20 / 1000) * USD_TO_IDR,
  },

  // Embedding Models
  'text-embedding-3-small': {
    provider: 'OpenAI',
    promptCostPer1kIdr: (0.02 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: 0,
  },
  'text-embedding-3-large': {
    provider: 'OpenAI',
    promptCostPer1kIdr: (0.13 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: 0,
  },
  'gemini/gemini-embedding-001': {
    provider: 'Google Gemini',
    promptCostPer1kIdr: (0.15 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: 0,
  },
  'gemini-embedding-001': {
    provider: 'Google Gemini',
    promptCostPer1kIdr: (0.15 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: 0,
  },

  // DeepSeek Models (Direct & Proxy Fallback)
  'deepseek-chat': {
    provider: 'DeepSeek Direct',
    promptCostPer1kIdr: (0.14 / 1000) * USD_TO_IDR, // Cache Miss ($0.14 / 1M)
    promptCacheHitCostPer1kIdr: (0.003 / 1000) * USD_TO_IDR, // Cache Hit ($0.003 / 1M)
    completionCostPer1kIdr: (0.28 / 1000) * USD_TO_IDR, // Output ($0.28 / 1M)
  },
  'deepseek-v4-flash': {
    provider: 'DeepSeek',
    promptCostPer1kIdr: (0.22 / 1000) * USD_TO_IDR, // Off-peak ($0.22 / 1M)
    promptCacheHitCostPer1kIdr: (0.007 / 1000) * USD_TO_IDR, // Off-peak ($0.007 / 1M)
    completionCostPer1kIdr: (0.66 / 1000) * USD_TO_IDR, // Off-peak ($0.66 / 1M)
  },
  'deepseek-reasoner': {
    provider: 'DeepSeek Direct',
    promptCostPer1kIdr: (0.55 / 1000) * USD_TO_IDR,
    promptCacheHitCostPer1kIdr: (0.14 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (2.19 / 1000) * USD_TO_IDR,
  },

  // Mimo Models
  'mimo-v2.5': {
    provider: 'Mimo',
    promptCostPer1kIdr: (0.14 / 1000) * USD_TO_IDR,
    promptCacheHitCostPer1kIdr: (0.003 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (0.28 / 1000) * USD_TO_IDR,
  },
  'mimo-v2.5-pro': {
    provider: 'Mimo',
    promptCostPer1kIdr: (0.43 / 1000) * USD_TO_IDR,
    promptCacheHitCostPer1kIdr: (0.004 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (0.87 / 1000) * USD_TO_IDR,
  },

  // MiniMax Models
  'minimax-m2.7-highspeed': {
    provider: 'MiniMax',
    promptCostPer1kIdr: (0.03 / 1000) * USD_TO_IDR,
    promptCacheHitCostPer1kIdr: (0.030 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (0.12 / 1000) * USD_TO_IDR,
  },
  'minimax-m3': {
    provider: 'MiniMax',
    promptCostPer1kIdr: (0.30 / 1000) * USD_TO_IDR,
    promptCacheHitCostPer1kIdr: (0.060 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (1.20 / 1000) * USD_TO_IDR,
  },

  // BytePlus / Tencent
  'seed-2-0-mini': {
    provider: 'BytePlus',
    promptCostPer1kIdr: (0.10 / 1000) * USD_TO_IDR,
    promptCacheHitCostPer1kIdr: (0.020 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (0.40 / 1000) * USD_TO_IDR,
  },
  'hy3': {
    provider: 'Tencent',
    promptCostPer1kIdr: (0.13 / 1000) * USD_TO_IDR,
    promptCacheHitCostPer1kIdr: (0.033 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (0.53 / 1000) * USD_TO_IDR,
  },

  // Google Gemini
  'gemini/gemini-3.1-flash-lite': {
    provider: 'Google Gemini',
    promptCostPer1kIdr: (0.25 / 1000) * USD_TO_IDR,
    promptCacheHitCostPer1kIdr: (0.025 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (1.50 / 1000) * USD_TO_IDR,
  },
  'gemini-3.1-flash-lite': {
    provider: 'Google Gemini',
    promptCostPer1kIdr: (0.25 / 1000) * USD_TO_IDR,
    promptCacheHitCostPer1kIdr: (0.025 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (1.50 / 1000) * USD_TO_IDR,
  },
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
