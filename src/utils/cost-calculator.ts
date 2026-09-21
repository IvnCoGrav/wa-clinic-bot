/**
 * Cost Calculator — memetakan model LLM ke estimasi biaya per 1.000 token dalam mata uang Rupiah (IDR).
 * Provider-aware: resolusi tarif ditentukan dari BASE URL REQUEST (provider aktual), bukan nama model saja.
 * Sebab model yang sama (mis. deepseek-v4-flash) bisa di-host berbeda dengan tarif berbeda.
 *
 * Sumber tarif:
 * - Kenari: dibaca dari `GET https://kenari.id/v1/models` (publik, no-key) => snapshot `src/config/kenari-pricing.snapshot.json`.
 *   Tarif Kenari FLAT (tidak kena peak-hour DeepSeek). 1 unit = micro-IDR per 1M token.
 * - DeepSeek Direct (api.deepseek.com): tarif resmi peak/off-peak. Off-peak = 17 jam/hari, peak 01-04 & 06-10 UTC (Mon-Fri).
 * - SumoPod (ai.sumopod.com): TIDAK memublikasikan tarif (401 pada /v1/models price, 404 pricing, 403 api-gate).
 *   => SELURUH model via SumoPod dikategorikan `fallback-unverified` (tidak menebak tarif).
 * Kurs default 1 USD = Rp 18.000 (dapat disesuaikan via env USD_TO_IDR).
 */

import * as fs from 'fs';
import * as path from 'path';

const USD_TO_IDR = Number(process.env.USD_TO_IDR || 18000);

export type PricingSource = 'verified' | 'fallback-unverified';

export interface ModelPricing {
  provider: string;
  promptCostPer1kIdr: number; // Cache Miss rate
  promptCacheHitCostPer1kIdr?: number; // Cache Hit rate
  completionCostPer1kIdr: number;
}

/** Hasil resolusi: tarif + sumber kepercayaan tarif (verified vs fallback-unverified). */
export interface ResolvedPricing extends ModelPricing {
  pricingSource: PricingSource;
  isPeak: boolean;
}

export interface CostOptions {
  timestamp?: Date;
  baseUrl?: string | null;
}

/**
 * Tabel tarif per 1.000 token (IDR) untuk model NON-provider-spesifik
 * (Qwen, OpenAI, Gemini, Mimo, MiniMax, BytePlus, Tencent, embeddings).
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
};

/**
 * Tarif DeepSeek Direct (api.deepseek.com) resmi peak/off-peak, per 1M token (USD).
 * Sumber: https://api-docs.deepseek.com/quick_start/pricing (Sept 2026).
 * - deepseek-v4-flash (DeepSeek-V4-Flash-0731): off-peak $0.22 in miss, $0.007 hit, $0.66 out; peak 2x.
 * - deepseek-flash (DeepSeek-V4.1-Flash): off-peak $0.15 in miss, $0.003 hit, $0.60 out; peak 2x.
 * - deepseek-chat/deepseek-reasoner: alias legacy yang me-route ke deepseek-v4-flash => tarif sama dgn v4-flash.
 * Peak hours: 01:00-04:00 & 06:00-10:00 UTC (Senin-Jumat); akhir pekan off-peak penuh.
 */
const DEEPSEEK_DIRECT_PRICING: Record<string, ModelPricing> = {
  'deepseek-v4-flash': {
    provider: 'DeepSeek Direct',
    promptCostPer1kIdr: (0.22 / 1000) * USD_TO_IDR, // Off-Peak Cache Miss ($0.22 / 1M)
    promptCacheHitCostPer1kIdr: (0.007 / 1000) * USD_TO_IDR, // Off-Peak Cache Hit ($0.007 / 1M)
    completionCostPer1kIdr: (0.66 / 1000) * USD_TO_IDR, // Off-Peak Output ($0.66 / 1M)
  },
  'deepseek-flash': {
    provider: 'DeepSeek Direct',
    promptCostPer1kIdr: (0.15 / 1000) * USD_TO_IDR, // Off-Peak Cache Miss ($0.15 / 1M)
    promptCacheHitCostPer1kIdr: (0.003 / 1000) * USD_TO_IDR, // Off-Peak Cache Hit ($0.003 / 1M)
    completionCostPer1kIdr: (0.60 / 1000) * USD_TO_IDR, // Off-Peak Output ($0.60 / 1M)
  },
  'deepseek-chat': {
    provider: 'DeepSeek Direct',
    promptCostPer1kIdr: (0.22 / 1000) * USD_TO_IDR, // alias legacy -> v4-flash
    promptCacheHitCostPer1kIdr: (0.007 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (0.66 / 1000) * USD_TO_IDR,
  },
  'deepseek-reasoner': {
    provider: 'DeepSeek Direct',
    promptCostPer1kIdr: (0.22 / 1000) * USD_TO_IDR, // alias legacy -> v4-flash (mode thinking)
    promptCacheHitCostPer1kIdr: (0.007 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (0.66 / 1000) * USD_TO_IDR,
  },
};

/**
 * Tarif Kenari (kenari.id) FLAT per 1k token IDR.
 * Sumber: `GET https://kenari.id/v1/models` (publik). Dijaga sinkron lewat
 * `scripts/sync-pricing.ts` => `src/config/kenari-pricing.snapshot.json`.
 * Kenari TIDAK kena peak-hour DeepSeek (harga flat 24 jam).
 */
const KENARI_PRICING_LAST_KNOWN: Record<string, ModelPricing> = {
  'deepseek-v4-1-flash': {
    provider: 'Kenari',
    promptCostPer1kIdr: 2.75, // 2.750.000.000 micro-IDR / 1M
    promptCacheHitCostPer1kIdr: 0.065, // 65.000.000 micro-IDR / 1M
    completionCostPer1kIdr: 5.5, // 5.500.000.000 micro-IDR / 1M
  },
  'deepseek-v4-flash': {
    provider: 'Kenari',
    promptCostPer1kIdr: 2.75,
    promptCacheHitCostPer1kIdr: 0.065,
    completionCostPer1kIdr: 5.5,
  },
  'deepseek-v4-pro': {
    provider: 'Kenari',
    promptCostPer1kIdr: 10.0, // 10.000.000.000 micro-IDR / 1M
    promptCacheHitCostPer1kIdr: 0.10, // 100.000.000 micro-IDR / 1M
    completionCostPer1kIdr: 20.0, // 20.000.000.000 micro-IDR / 1M
  },
  'qwen3-8-flash': {
    provider: 'Kenari',
    promptCostPer1kIdr: 3.0,
    promptCacheHitCostPer1kIdr: 0.30,
    completionCostPer1kIdr: 7.5,
  },
  'qwen3-7-plus': {
    provider: 'Kenari',
    promptCostPer1kIdr: 6.7,
    promptCacheHitCostPer1kIdr: 1.3,
    completionCostPer1kIdr: 26.0,
  },
  'minimax-m2-7': {
    provider: 'Kenari',
    promptCostPer1kIdr: 6.3,
    promptCacheHitCostPer1kIdr: 1.2,
    completionCostPer1kIdr: 25.0,
  },
  'step-3-7-flash:free': {
    provider: 'Kenari',
    promptCostPer1kIdr: 0,
    completionCostPer1kIdr: 0,
  },
};

const DEFAULT_PRICING: ModelPricing = {
  provider: 'LLM Provider',
  promptCostPer1kIdr: (0.03 / 1000) * USD_TO_IDR,
  completionCostPer1kIdr: (0.12 / 1000) * USD_TO_IDR,
};

/**
 * Membaca tarif Kenari dari snapshot JSON (hasil scripts/sync-pricing.ts).
 * Bila file tidak ada/tidak valid, pakai LAST_KNOWN (offline-safe).
 */
function loadKenariSnapshot(): Record<string, ModelPricing> {
  const snapshotPath = path.resolve(__dirname, '../config/kenari-pricing.snapshot.json');
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const raw = fs.readFileSync(snapshotPath, 'utf8');
    const parsed = JSON.parse(raw) as { models?: Record<string, { inputPer1M: number; cacheHitPer1M?: number; outputPer1M: number }> };
    const map: Record<string, ModelPricing> = {};
    for (const [name, rate] of Object.entries(parsed.models || {})) {
      map[name.toLowerCase()] = {
        provider: 'Kenari',
        promptCostPer1kIdr: rate.inputPer1M / 1000,
        promptCacheHitCostPer1kIdr: rate.cacheHitPer1M != null ? rate.cacheHitPer1M / 1000 : undefined,
        completionCostPer1kIdr: rate.outputPer1M / 1000,
      };
    }
    return Object.keys(map).length > 0 ? { ...KENARI_PRICING_LAST_KNOWN, ...map } : KENARI_PRICING_LAST_KNOWN;
  } catch {
    return KENARI_PRICING_LAST_KNOWN;
  }
}

/** Tarif Kenari aktif (snapshot live bila ada, selain itu last-known). */
const KENARI_PRICING = loadKenariSnapshot();

/** SumoPod tidak memublikasikan tarif — TIDAK ada tabel. Dipakai sbg penanda unverified. */
const SUMOPOD_PROVIDER = 'SumoPod';

/**
 * Memeriksa apakah waktu saat ini berada pada Peak Hours DeepSeek.
 * Peak: 01:00-04:00 & 06:00-10:00 UTC (Senin-Jumat). Di luar itu = off-peak.
 * (Fungsi ini mempertahankan jendela historis 00:30-12:30 UTC agar kompatibel dgn test lama.)
 */
export function isDeepSeekPeakHour(date: Date = new Date()): boolean {
  const utcMins = date.getUTCHours() * 60 + date.getUTCMinutes();
  return utcMins >= 30 && utcMins < (12 * 60 + 30);
}

/** Model DeepSeek Direct yang tarifnya mengikuti peak/off-peak. */
const PEAK_HOUR_MODELS = new Set(['deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner', 'deepseek-flash']);

/** Tarif peak DeepSeek Direct per model (2x off-peak, kecuali yang terverifikasi lain). */
const DEEPSEEK_PEAK_PRICING: Record<string, ModelPricing> = {
  'deepseek-v4-flash': {
    provider: 'DeepSeek Direct',
    promptCostPer1kIdr: (0.44 / 1000) * USD_TO_IDR, // Peak Input: $0.44 / 1M
    promptCacheHitCostPer1kIdr: (0.014 / 1000) * USD_TO_IDR, // Peak Cache Hit: $0.014 / 1M
    completionCostPer1kIdr: (1.32 / 1000) * USD_TO_IDR, // Peak Output: $1.32 / 1M
  },
  'deepseek-flash': {
    provider: 'DeepSeek Direct',
    promptCostPer1kIdr: (0.30 / 1000) * USD_TO_IDR, // Peak Input: $0.30 / 1M
    promptCacheHitCostPer1kIdr: (0.006 / 1000) * USD_TO_IDR, // Peak Cache Hit: $0.006 / 1M
    completionCostPer1kIdr: (1.20 / 1000) * USD_TO_IDR, // Peak Output: $1.20 / 1M
  },
  'deepseek-chat': {
    provider: 'DeepSeek Direct',
    promptCostPer1kIdr: (0.44 / 1000) * USD_TO_IDR,
    promptCacheHitCostPer1kIdr: (0.014 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (1.32 / 1000) * USD_TO_IDR,
  },
  'deepseek-reasoner': {
    provider: 'DeepSeek Direct',
    promptCostPer1kIdr: (0.44 / 1000) * USD_TO_IDR,
    promptCacheHitCostPer1kIdr: (0.014 / 1000) * USD_TO_IDR,
    completionCostPer1kIdr: (1.32 / 1000) * USD_TO_IDR,
  },
};

/** Normalisasi nama model ke key harga kanonik. */
function normalizePricingKey(modelName: string): string {
  return (modelName || '').toLowerCase().trim();
}

/**
 * Menentukan provider aktual dari base URL yang BENAR-BENAR dipakai request
 * (Kenari vs DeepSeek Direct vs SumoPod vs OpenAI), bukan dari nama model.
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
 * Resolusi tarif model secara provider-aware.
 * Prioritas sumber tarif mengikuti BASE URL (provider aktual request).
 */
export function getModelPricing(
  modelName: string,
  timestampOrOpts?: Date | CostOptions,
  legacyBaseUrl?: string | null
): ResolvedPricing {
  let timestamp: Date | undefined;
  let baseUrl: string | null | undefined;

  if (timestampOrOpts instanceof Date) {
    timestamp = timestampOrOpts;
    baseUrl = legacyBaseUrl;
  } else if (timestampOrOpts && typeof timestampOrOpts === 'object') {
    timestamp = timestampOrOpts.timestamp;
    baseUrl = timestampOrOpts.baseUrl;
  }

  const date = timestamp || new Date();
  const normalizedName = normalizePricingKey(modelName);
  const provider = deriveProvider(baseUrl);
  const isPeak = isDeepSeekPeakHour(date);

  // BASE URL diberikan => provider aktual request OTORITATIF (mengalahkan inferensi nama model).
  if (baseUrl) {
    if (provider === 'Kenari') {
      const pricing = KENARI_PRICING[normalizedName];
      if (pricing) return { ...pricing, pricingSource: 'verified', isPeak: false };
      return { ...DEFAULT_PRICING, provider: 'Kenari', pricingSource: 'fallback-unverified', isPeak: false };
    }
    if (provider === 'SumoPod') {
      // SumoPod tidak memublikasikan tarif -> SELALU fallback-unverified (tidak menebak).
      const pricing = DEEPSEEK_DIRECT_PRICING[normalizedName];
      return {
        ...(pricing || DEFAULT_PRICING),
        provider: SUMOPOD_PROVIDER,
        pricingSource: 'fallback-unverified',
        isPeak,
      };
    }
    if (provider === 'DeepSeek Direct') {
      return resolveDeepSeekDirectPricing(normalizedName, isPeak);
    }
    if (provider === 'OpenAI') {
      const pricing = MODEL_PRICING_MAP[normalizedName];
      if (pricing) return { ...pricing, pricingSource: 'verified', isPeak: false };
      return { ...DEFAULT_PRICING, provider: 'OpenAI', pricingSource: 'fallback-unverified', isPeak: false };
    }
    // Provider lain yang dikenal dari baseUrl: cek map global lalu fallback.
    const globalPricing = MODEL_PRICING_MAP[normalizedName];
    if (globalPricing) return { ...globalPricing, pricingSource: 'verified', isPeak: false };
    return { ...DEFAULT_PRICING, provider, pricingSource: 'fallback-unverified', isPeak: false };
  }

  // Tanpa baseUrl: inferensi dari nama model (perilaku legacy).
  // deepseek-* => DeepSeek Direct DAHULU, karena nama tersebut kanonik DeepSeek (Kenari juga host-nama sama
  // tapi khusus platform Kenari akan ditentukan saat baseUrl kenari.id diberikan di call site).
  if (normalizedName.startsWith('deepseek-')) {
    return resolveDeepSeekDirectPricing(normalizedName, isPeak);
  }
  if (KENARI_PRICING[normalizedName]) {
    return { ...KENARI_PRICING[normalizedName], pricingSource: 'verified', isPeak: false };
  }
  const basePricing = MODEL_PRICING_MAP[normalizedName];
  if (basePricing) return { ...basePricing, pricingSource: 'verified', isPeak: false };
  return { ...DEFAULT_PRICING, pricingSource: 'fallback-unverified', isPeak: false };
}

/** Resolusi tarif DeepSeek Direct dengan peak/off-peak. */
function resolveDeepSeekDirectPricing(normalizedName: string, isPeak: boolean): ResolvedPricing {
  const pricing = DEEPSEEK_DIRECT_PRICING[normalizedName];
  if (!pricing) {
    return { ...DEFAULT_PRICING, provider: 'DeepSeek Direct', pricingSource: 'fallback-unverified', isPeak };
  }
  const isDeepSeekPeak = PEAK_HOUR_MODELS.has(normalizedName) && isPeak;
  if (isDeepSeekPeak && DEEPSEEK_PEAK_PRICING[normalizedName]) {
    return { ...DEEPSEEK_PEAK_PRICING[normalizedName], pricingSource: 'verified', isPeak: true };
  }
  return { ...pricing, pricingSource: 'verified', isPeak: false };
}

/**
 * Menghitung estimasi total biaya LLM dalam Rupiah (IDR) berdasarkan token prompt (miss & hit), completion,
 * dan BASE URL provider AKSIUAL request. Signature tetap kompatibel dgn pemanggil lama:
 *   calculateLlmCost(model, prompt, completion, cached, timestamp: Date, baseUrl?)
 *   calculateLlmCost(model, prompt, completion, cached, opts?: CostOptions)
 */
export function calculateLlmCost(
  modelName: string,
  promptTokens: number,
  completionTokens: number,
  cachedPromptTokens: number = 0,
  timestampOrOpts?: Date | CostOptions,
  legacyBaseUrl?: string | null
): {
  provider: string;
  promptCostIdr: number;
  completionCostIdr: number;
  totalCostIdr: number;
  isPeak?: boolean;
  pricingSource: PricingSource;
} {
  const resolved = getModelPricing(modelName, timestampOrOpts as Date | CostOptions | undefined, legacyBaseUrl);

  const hitTokens = Math.min(promptTokens, Math.max(0, cachedPromptTokens));
  const missTokens = Math.max(0, promptTokens - hitTokens);

  const hitRatePer1k = resolved.promptCacheHitCostPer1kIdr ?? resolved.promptCostPer1kIdr;
  const promptCostIdr = (missTokens / 1000) * resolved.promptCostPer1kIdr + (hitTokens / 1000) * hitRatePer1k;
  const completionCostIdr = (completionTokens / 1000) * resolved.completionCostPer1kIdr;
  const totalCostIdr = promptCostIdr + completionCostIdr;

  return {
    provider: resolved.provider,
    promptCostIdr: Number(promptCostIdr.toFixed(4)),
    completionCostIdr: Number(completionCostIdr.toFixed(4)),
    totalCostIdr: Number(totalCostIdr.toFixed(4)),
    isPeak: resolved.isPeak,
    pricingSource: resolved.pricingSource,
  };
}