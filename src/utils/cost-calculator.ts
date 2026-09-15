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
  // Qwen Models (Alibaba) — Primary & Fallback Models
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

  // DeepSeek Models (Direct & Proxy Fallback with Peak/Off-Peak Support)
  'deepseek-chat': {
    provider: 'DeepSeek Direct',
    promptCostPer1kIdr: (0.14 / 1000) * USD_TO_IDR, // Cache Miss ($0.14 / 1M)
    promptCacheHitCostPer1kIdr: (0.003 / 1000) * USD_TO_IDR, // Cache Hit ($0.003 / 1M)
    completionCostPer1kIdr: (0.28 / 1000) * USD_TO_IDR, // Off-Peak ($0.28 / 1M)
  },
  'deepseek-v4-flash': {
    provider: 'DeepSeek',
    promptCostPer1kIdr: (0.22 / 1000) * USD_TO_IDR, // Off-Peak Cache Miss ($0.22 / 1M)
    promptCacheHitCostPer1kIdr: (0.007 / 1000) * USD_TO_IDR, // Off-Peak Cache Hit ($0.007 / 1M)
    completionCostPer1kIdr: (0.66 / 1000) * USD_TO_IDR, // Off-Peak Output ($0.66 / 1M)
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
    promptCostPer1kIdr: (0.14 / 1000) * USD_TO_IDR, // Cache Miss ($0.14 / 1M)
    promptCacheHitCostPer1kIdr: (0.003 / 1000) * USD_TO_IDR, // Cache Hit ($0.003 / 1M)
    completionCostPer1kIdr: (0.28 / 1000) * USD_TO_IDR, // Output ($0.28 / 1M)
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
    promptCostPer1kIdr: (0.03 / 1000) * USD_TO_IDR, // Cache Miss ($0.03 / 1M)
    promptCacheHitCostPer1kIdr: (0.030 / 1000) * USD_TO_IDR, // Cache Hit ($0.030 / 1M)
    completionCostPer1kIdr: (0.12 / 1000) * USD_TO_IDR, // Output ($0.12 / 1M)
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

  // DeepSeek :free variants (Kenari mendukung :free suffix untuk semua model)
  'deepseek-v4-flash:free': { provider: 'Kenari', promptCostPer1kIdr: 0, completionCostPer1kIdr: 0 },
  'deepseek-v4-1-flash:free': { provider: 'Kenari', promptCostPer1kIdr: 0, completionCostPer1kIdr: 0 },
  'deepseek-v4-pro:free': { provider: 'Kenari', promptCostPer1kIdr: 0, completionCostPer1kIdr: 0 },

  // Claude :free variants
  // Format asli: micro-IDR per 1M token → dikonversi ke IDR per 1k token (÷ 1_000_000).
  // Model dengan nama yang SUDAH ada di atas (mis. deepseek-v4-flash, minimax-m2.7-highspeed)
  // tidak diduplikasi — entry yang ada sudah dipakai saat OPENAI_BASE_URL=kenari.id/v1.
  // Model :free ditandai promptCostPer1kIdr=0 & completionCostPer1kIdr=0.

  // Agnes (gratis)
  'agnes-2-0-flash:free': { provider: 'Kenari', promptCostPer1kIdr: 0, completionCostPer1kIdr: 0 },
  'agnes-2-5-flash:free': { provider: 'Kenari', promptCostPer1kIdr: 0, completionCostPer1kIdr: 0 },
  'agnes-3-0-flash:free': { provider: 'Kenari', promptCostPer1kIdr: 0, completionCostPer1kIdr: 0 },

  // Anthropic
  'claude-fable-5': {
    provider: 'Kenari',
    promptCostPer1kIdr: 210.0,
    promptCacheHitCostPer1kIdr: 21.0,
    completionCostPer1kIdr: 1000.0,
  },
  'claude-opus-4-7': {
    provider: 'Kenari',
    promptCostPer1kIdr: 100.0,
    promptCacheHitCostPer1kIdr: 10.0,
    completionCostPer1kIdr: 520.0,
  },
  'claude-opus-4-8': {
    provider: 'Kenari',
    promptCostPer1kIdr: 100.0,
    promptCacheHitCostPer1kIdr: 10.0,
    completionCostPer1kIdr: 520.0,
  },
  'claude-opus-5': {
    provider: 'Kenari',
    promptCostPer1kIdr: 100.0,
    promptCacheHitCostPer1kIdr: 40.0,
    completionCostPer1kIdr: 500.0,
  },
  'claude-sonnet-4-6': {
    provider: 'Kenari',
    promptCostPer1kIdr: 63.0,
    promptCacheHitCostPer1kIdr: 6.3,
    completionCostPer1kIdr: 310.0,
  },
  'claude-sonnet-5': {
    provider: 'Kenari',
    promptCostPer1kIdr: 20.0,
    promptCacheHitCostPer1kIdr: 2.0,
    completionCostPer1kIdr: 100.0,
  },

  // Cohere (gratis)
  'north-mini-code:free': { provider: 'Kenari', promptCostPer1kIdr: 0, completionCostPer1kIdr: 0 },

  // DeepSeek (baru)
  'deepseek-v4-1-flash': {
    provider: 'Kenari',
    promptCostPer1kIdr: 0.15,
    promptCacheHitCostPer1kIdr: 0.004,
    completionCostPer1kIdr: 0.30,
  },
  'deepseek-v4-pro': {
    provider: 'Kenari',
    promptCostPer1kIdr: 10.0,
    promptCacheHitCostPer1kIdr: 0.10,
    completionCostPer1kIdr: 20.0,
  },

  // Google Gemini (baru)
  'gemini-2-5-flash': {
    provider: 'Kenari',
    promptCostPer1kIdr: 2.0,
    promptCacheHitCostPer1kIdr: 0.20,
    completionCostPer1kIdr: 15.0,
  },
  'gemini-2-5-flash-lite': {
    provider: 'Kenari',
    promptCostPer1kIdr: 0.40,
    promptCacheHitCostPer1kIdr: 0.04,
    completionCostPer1kIdr: 1.7,
  },
  'gemini-3-1-pro': {
    provider: 'Kenari',
    promptCostPer1kIdr: 21.0,
    promptCacheHitCostPer1kIdr: 2.1,
    completionCostPer1kIdr: 125.0,
  },
  'gemini-3-6-flash': {
    provider: 'Kenari',
    promptCostPer1kIdr: 6.0,
    promptCacheHitCostPer1kIdr: 0.60,
    completionCostPer1kIdr: 30.0,
  },
  'gemini-3-7-flash': {
    provider: 'Kenari',
    promptCostPer1kIdr: 6.0,
    promptCacheHitCostPer1kIdr: 0.60,
    completionCostPer1kIdr: 30.0,
  },
  'gemini-3-8-flash': {
    provider: 'Kenari',
    promptCostPer1kIdr: 6.0,
    promptCacheHitCostPer1kIdr: 0.60,
    completionCostPer1kIdr: 30.0,
  },
  'gemma-4-31b-it': {
    provider: 'Kenari',
    promptCostPer1kIdr: 1.8,
    promptCacheHitCostPer1kIdr: 0.72,
    completionCostPer1kIdr: 7.1,
  },

  // Meta
  'muse-spark-1-2': {
    provider: 'Kenari',
    promptCostPer1kIdr: 20.0,
    promptCacheHitCostPer1kIdr: 2.0,
    completionCostPer1kIdr: 80.0,
  },
  'muse-spark-1-2-contributor': {
    provider: 'Kenari',
    promptCostPer1kIdr: 2.0,
    promptCacheHitCostPer1kIdr: 0.04,
    completionCostPer1kIdr: 4.0,
  },
  'muse-spark-1-2-contributor:free': {
    provider: 'Kenari',
    promptCostPer1kIdr: 0,
    completionCostPer1kIdr: 0,
  },
  'muse-spark-1-3': {
    provider: 'Kenari',
    promptCostPer1kIdr: 20.0,
    promptCacheHitCostPer1kIdr: 2.0,
    completionCostPer1kIdr: 80.0,
  },
  'muse-spark-1-3-contributor': {
    provider: 'Kenari',
    promptCostPer1kIdr: 2.0,
    promptCacheHitCostPer1kIdr: 0.04,
    completionCostPer1kIdr: 4.0,
  },
  'muse-spark-1-3-contributor:free': {
    provider: 'Kenari',
    promptCostPer1kIdr: 0,
    completionCostPer1kIdr: 0,
  },

  // MiniMax (baru — model existing seperti minimax-m2.7-highspeed sudah ada di atas)
  'minimax-m2-7': {
    provider: 'Kenari',
    promptCostPer1kIdr: 6.3,
    promptCacheHitCostPer1kIdr: 1.2,
    completionCostPer1kIdr: 25.0,
  },

  // Mistral (gratis)
  'mistral-medium-3-5:free': { provider: 'Kenari', promptCostPer1kIdr: 0, completionCostPer1kIdr: 0 },

  // Moonshot
  'kimi-k2-6': {
    provider: 'Kenari',
    promptCostPer1kIdr: 10.0,
    promptCacheHitCostPer1kIdr: 5.0,
    completionCostPer1kIdr: 50.0,
  },
  'kimi-k2-7-code': {
    provider: 'Kenari',
    promptCostPer1kIdr: 10.0,
    promptCacheHitCostPer1kIdr: 2.0,
    completionCostPer1kIdr: 50.0,
  },
  'kimi-k3': {
    provider: 'Kenari',
    promptCostPer1kIdr: 30.0,
    promptCacheHitCostPer1kIdr: 3.0,
    completionCostPer1kIdr: 150.0,
  },

  // Nex AGI (gratis)
  'nex-n2-5-pro:free': { provider: 'Kenari', promptCostPer1kIdr: 0, completionCostPer1kIdr: 0 },

  // NVIDIA
  'nemotron-3-super-120b-a12b': {
    provider: 'Kenari',
    promptCostPer1kIdr: 1.7,
    promptCacheHitCostPer1kIdr: 0.17,
    completionCostPer1kIdr: 8.4,
  },
  'nemotron-3-super-120b-a12b:free': {
    provider: 'Kenari',
    promptCostPer1kIdr: 0,
    completionCostPer1kIdr: 0,
  },
  'nemotron-3-ultra-550b-a55b': {
    provider: 'Kenari',
    promptCostPer1kIdr: 12.0,
    promptCacheHitCostPer1kIdr: 1.2,
    completionCostPer1kIdr: 75.0,
  },
  'nemotron-3-ultra-550b-a55b:free': {
    provider: 'Kenari',
    promptCostPer1kIdr: 0,
    completionCostPer1kIdr: 0,
  },

  // OpenAI GPT (baru)
  'gpt-5-4': {
    provider: 'Kenari',
    promptCostPer1kIdr: 52.0,
    promptCacheHitCostPer1kIdr: 5.2,
    completionCostPer1kIdr: 310.0,
  },
  'gpt-5-4-mini': {
    provider: 'Kenari',
    promptCostPer1kIdr: 15.0,
    promptCacheHitCostPer1kIdr: 1.5,
    completionCostPer1kIdr: 94.0,
  },
  'gpt-5-5': {
    provider: 'Kenari',
    promptCostPer1kIdr: 100.0,
    promptCacheHitCostPer1kIdr: 10.0,
    completionCostPer1kIdr: 630.0,
  },
  'gpt-5-6-sol': {
    provider: 'Kenari',
    promptCostPer1kIdr: 52.0,
    promptCacheHitCostPer1kIdr: 20.8,
    completionCostPer1kIdr: 310.0,
  },
  'gpt-5-6-terra': {
    provider: 'Kenari',
    promptCostPer1kIdr: 42.0,
    promptCacheHitCostPer1kIdr: 16.8,
    completionCostPer1kIdr: 250.0,
  },
  'gpt-6-astra': {
    provider: 'Kenari',
    promptCostPer1kIdr: 200.0,
    promptCacheHitCostPer1kIdr: 20.0,
    completionCostPer1kIdr: 1000.0,
  },
  'gpt-oss-120b': {
    provider: 'Kenari',
    promptCostPer1kIdr: 0.63,
    promptCacheHitCostPer1kIdr: 0.063,
    completionCostPer1kIdr: 3.5,
  },
  'gpt-oss-20b': {
    provider: 'Kenari',
    promptCostPer1kIdr: 0.63,
    promptCacheHitCostPer1kIdr: 0.065,
    completionCostPer1kIdr: 2.7,
  },

  // Poolside (gratis)
  'laguna-s-2-1:free': {
    provider: 'Kenari',
    promptCostPer1kIdr: 0,
    promptCacheHitCostPer1kIdr: 0.19,
    completionCostPer1kIdr: 0,
  },
  'laguna-xs-2-1:free': {
    provider: 'Kenari',
    promptCostPer1kIdr: 0,
    promptCacheHitCostPer1kIdr: 1.2,
    completionCostPer1kIdr: 0,
  },

  // Qwen (baru)
  'qwen3-8-max': {
    provider: 'Kenari',
    promptCostPer1kIdr: 42.0,
    promptCacheHitCostPer1kIdr: 5.2,
    completionCostPer1kIdr: 120.0,
  },

  // StepFun
  'step-3-7-flash': {
    provider: 'Kenari',
    promptCostPer1kIdr: 4.2,
    promptCacheHitCostPer1kIdr: 0.84,
    completionCostPer1kIdr: 24.0,
  },
  'step-3-7-flash:free': {
    provider: 'Kenari',
    promptCostPer1kIdr: 0,
    completionCostPer1kIdr: 0,
  },

  // Tencent (baru)
  'hy3:free': { provider: 'Kenari', promptCostPer1kIdr: 0, completionCostPer1kIdr: 0 },
  'hy4-preview': {
    provider: 'Kenari',
    promptCostPer1kIdr: 12.0,
    promptCacheHitCostPer1kIdr: 1.2,
    completionCostPer1kIdr: 42.0,
  },

  // xAI
  'grok-4-5': {
    provider: 'Kenari',
    promptCostPer1kIdr: 21.0,
    promptCacheHitCostPer1kIdr: 3.25,
    completionCostPer1kIdr: 60.0,
  },
  'grok-4-6': {
    provider: 'Kenari',
    promptCostPer1kIdr: 21.0,
    promptCacheHitCostPer1kIdr: 3.25,
    completionCostPer1kIdr: 60.0,
  },

  // Xiaomi / Mimo (baru — model existing mimo-v2.5 sudah ada di atas)
  'mimo-v2-5:free': { provider: 'Kenari', promptCostPer1kIdr: 0, completionCostPer1kIdr: 0 },

  // Z-AI / GLM
  'glm-4-7-flash:free': { provider: 'Kenari', promptCostPer1kIdr: 0, completionCostPer1kIdr: 0 },
  'glm-5-2': {
    provider: 'Kenari',
    promptCostPer1kIdr: 10.0,
    promptCacheHitCostPer1kIdr: 4.0,
    completionCostPer1kIdr: 66.0,
  },
  'glm-5-3': {
    provider: 'Kenari',
    promptCostPer1kIdr: 10.0,
    promptCacheHitCostPer1kIdr: 4.0,
    completionCostPer1kIdr: 66.0,
  },
  'glm-5-3-flash': {
    provider: 'Kenari',
    promptCostPer1kIdr: 1.5,
    promptCacheHitCostPer1kIdr: 0.25,
    completionCostPer1kIdr: 5.0,
  },
};

const DEFAULT_PRICING: ModelPricing = {
  provider: 'LLM Provider',
  promptCostPer1kIdr: (0.03 / 1000) * USD_TO_IDR,
  completionCostPer1kIdr: (0.12 / 1000) * USD_TO_IDR,
};

/**
 * Memeriksa apakah waktu saat ini berada pada Peak Hours DeepSeek.
 * Peak Hours: 08:30 - 20:30 UTC+8 (Beijing Time) = 00:30 - 12:30 UTC = 07:30 - 19:30 WIB.
 */
export function isDeepSeekPeakHour(date: Date = new Date()): boolean {
  const utcMins = date.getUTCHours() * 60 + date.getUTCMinutes();
  return utcMins >= 30 && utcMins < (12 * 60 + 30);
}

/**
 * Resolusi tarif model dengan mempertimbangkan Peak Hours dinamis.
 */
export function getModelPricing(modelName: string, date: Date = new Date()): ModelPricing {
  const normalizedName = (modelName || '').toLowerCase().trim();
  const basePricing = MODEL_PRICING_MAP[normalizedName] || DEFAULT_PRICING;

  // DeepSeek Peak Hour adjustment (Input $0.44/1M, Hit $0.014/1M, Output $1.32/1M saat peak hours)
  if (normalizedName.startsWith('deepseek') && isDeepSeekPeakHour(date)) {
    if (normalizedName === 'deepseek-v4-flash') {
      return {
        ...basePricing,
        promptCostPer1kIdr: (0.44 / 1000) * USD_TO_IDR, // Peak Input: $0.44 / 1M
        promptCacheHitCostPer1kIdr: (0.014 / 1000) * USD_TO_IDR, // Peak Cache Hit: $0.014 / 1M
        completionCostPer1kIdr: (1.32 / 1000) * USD_TO_IDR, // Peak Output: $1.32 / 1M
      };
    }
    if (normalizedName === 'deepseek-chat') {
      return {
        ...basePricing,
        completionCostPer1kIdr: (1.32 / 1000) * USD_TO_IDR, // Peak Output: $1.32 / 1M
      };
    }
  }

  return basePricing;
}

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
  if (raw.includes('kenari.id')) return 'Kenari';
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
  cachedPromptTokens: number = 0,
  timestamp: Date = new Date()
): { provider: string; promptCostIdr: number; completionCostIdr: number; totalCostIdr: number; isPeak?: boolean } {
  const normalizedName = (modelName || '').toLowerCase().trim();
  const isPeak = normalizedName.startsWith('deepseek') ? isDeepSeekPeakHour(timestamp) : false;
  const pricing = getModelPricing(modelName, timestamp);

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
    isPeak,
  };
}
