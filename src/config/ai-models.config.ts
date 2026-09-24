/**
 * Centralized AI Model Config Registry
 * Manages task-to-model mappings dynamically so models can be changed
 * without hunting through codebase, and exposed for UI management.
 *
 * Tenant-aware (SaaS): registry disimpan per-tenant (`Map<tenantId, Map<task, config>>`)
 * agar konfigurasi tenant A tidak tertimpa saat tenant B di-load dari DB.
 */
import dotenv from 'dotenv';
dotenv.config();
import { DEFAULT_TENANT_ID } from './tenant';

export type AiTaskType = 'HARVESTING' | 'CHAT_REPLY' | 'CHAT_REPLY_DEEP' | 'MEDICAL_CHECK' | 'SUMMARIZATION' | 'PII_SCRUBBING' | 'INTENT_CLASSIFICATION';

export interface AiTaskModelConfig {
  task: AiTaskType;
  provider: string;
  modelName: string;
  description: string;
  maxTokens: number;
  temperature: number;
  confidenceThreshold?: number;
}

// === Sumber kebenaran tunggal nama model per-provider (katalog live per 2026-09-21) ===
// Tier 1 (primary)  : SumoPod       -> glm-5.3-flash (server utama klinik, rekomendasi emas FAST_ECONOMICAL 50% off)
//   MiniMax-M2.7-highspeed tetap di katalog SumoPod sebagai alternatif (backward-compat), bukan default emas.
// Tier 2 (secondary): Kenari        -> deepseek-v4-1-flash
// Tier 3 (last)     : DeepSeek Direct (api.deepseek.com) -> deepseek-chat
export const SUMOPOD_PRIMARY_MODEL = 'glm-5.3-flash';
export const SUMOPOD_SECONDARY_MODEL = 'deepseek-v4-flash';
export const KENARI_PRIMARY_MODEL = 'deepseek-v4-1-flash';
export const KENARI_SECONDARY_MODEL = 'deepseek-v4-1-flash';
export const DEEPSEEK_DIRECT_MODEL = 'deepseek-chat';

/** Label display model default runtime. */
export const DISPLAY_MODEL_LABEL = 'glm-5.3-flash (SumoPod Utama)';

/** Katalog resmi SumoPod (server utama) — hanya 5 model ini yang valid. */
export const SUMOPOD_CATALOG = new Set([
  'glm-5.3-flash',
  'MiniMax-M2.7-highspeed',
  'minimax-m2.7-highspeed',
  'qwen3.7-flash-2026-07-15',
  'gpt-4o-mini',
  'deepseek-v4-flash-0731:netra',
  'deepseek-v4-flash',
]);

/** Katalog resmi Kenari (server cadangan) — hanya 3 model ini yang valid. */
export const KENARI_CATALOG = new Set([
  KENARI_PRIMARY_MODEL,
  'gemini-2-5-flash-lite',
  'muse-spark-1-3-contributor',
]);

/** Katalog DeepSeek Direct (last fallback api.deepseek.com). */
export const DEEPSEEK_DIRECT_CATALOG = new Set([
  'deepseek-chat',
  'deepseek-reasoner',
  'deepseek-flash',
  'deepseek-v4-flash',
]);

/**
 * Base URL otoritatif per label provider task (bukan provider aktif global).
 * Tanpa ini, task NLU OpenAI (gpt-4o-mini) ikut di-sanitize terhadap baseUrl gateway
 * aktif (mis. Kenari) lalu ter-remap paksa ke model Kenari — task Call 1 rusak
 * setiap kali admin menyimpan saat server cadangan aktif.
 * Return null = provider non-gateway (MiniMax/Qwen/dll): JANGAN remap samasekali.
 */
function baseUrlForProviderLabel(provider: string): string | null {
  const p = (provider || '').toLowerCase();
  if (p.includes('sumopod')) return (process.env.SUMOPOD_BASE_URL || 'https://ai.sumopod.com/v1').replace(/\/$/, '');
  if (p.includes('kenari')) return (process.env.KENARI_BASE_URL || 'https://kenari.id/v1').replace(/\/$/, '');
  if (p.includes('openai')) return 'https://api.openai.com/v1';
  if (p.includes('deepseek')) return (process.env.LLM_FALLBACK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
  return null;
}

// In-Memory dynamic registry (can be persisted or updated via Admin API / UI)
// Basis default (env-driven) untuk tiap tenant — di-clone ke per-tenant registry saat dipakai.
export function sanitizeModelForProvider(model: string, baseUrl?: string): string {
  const url = (baseUrl || process.env.OPENAI_BASE_URL || '').toLowerCase();

  // Alias legacy: nama lama DeepSeek diarahkan ke model kanonik per provider aktif.
  // SumoPod utama -> deepseek-v4-flash-0731:netra hanya bila model lama DeepSeek;
  // Kenari -> deepseek-v4-1-flash; DeepSeek Direct -> deepseek-chat.
  const legacyDeepseekAlias = (m: string): string | null => {
    const lower = m.toLowerCase();
    if (
      lower === 'deepseek-v4-flash' ||
      lower === 'deepseek-chat' ||
      lower === 'deepseek-v4-1-flash' ||
      lower === 'deepseek-reasoner' ||
      lower === 'deepseek-coder' ||
      lower === 'deepseek-flash'
    ) {
      if (url.includes('sumopod')) return SUMOPOD_SECONDARY_MODEL;
      if (url.includes('api.deepseek.com') || url.includes('deepseek.com')) return DEEPSEEK_DIRECT_MODEL;
      if (url.includes('api.openai.com')) return null;
      if (url.includes('kenari.id')) return KENARI_PRIMARY_MODEL;
      return null;
    }
    return null;
  };

  if (!model) {
    if (url.includes('api.openai.com')) return 'gpt-4o-mini';
    if (url.includes('sumopod')) return SUMOPOD_PRIMARY_MODEL;
    if (url.includes('api.deepseek.com') || url.includes('deepseek.com')) return DEEPSEEK_DIRECT_MODEL;
    if (url.includes('kenari.id')) return KENARI_PRIMARY_MODEL;
    // Default global: server utama = SumoPod
    return SUMOPOD_PRIMARY_MODEL;
  }

  const aliased = legacyDeepseekAlias(model);
  if (aliased) return aliased;

  // Jika endpoint resmi OpenAI, pastikan hanya model OpenAI valid
  if (url.includes('api.openai.com')) {
    if (!model.startsWith('gpt-') && !model.startsWith('o1') && !model.startsWith('o3')) {
      return 'gpt-4o-mini';
    }
  }

  // SumoPod (utama): hanya 5 model resmi valid — remap non-katalog ke primary agar tidak 400.
  // Perbandingan case-insensitive karena katalog punya varian huruf (MiniMax-M2.7-highspeed).
  if (url.includes('sumopod')) {
    const inCatalog = Array.from(SUMOPOD_CATALOG).some((c) => c.toLowerCase() === model.toLowerCase());
    if (!inCatalog) return SUMOPOD_PRIMARY_MODEL;
  }

  // Kenari (cadangan): hanya 3 model resmi valid — remap non-katalog ke default Kenari.
  if (url.includes('kenari.id')) {
    if (!KENARI_CATALOG.has(model)) {
      return KENARI_PRIMARY_MODEL;
    }
  }

  // DeepSeek Direct (last fallback): hanya katalog Direct yang valid.
  if (url.includes('api.deepseek.com') || url.includes('deepseek.com')) {
    const lower = model.toLowerCase();
    const inCatalog = Array.from(DEEPSEEK_DIRECT_CATALOG).some((c) => c.toLowerCase() === lower);
    if (!inCatalog) return DEEPSEEK_DIRECT_MODEL;
  }

  return model;
}

const defaultProvider = process.env.AI_PROVIDER_CHAT || 'SumoPod';
const rawChatModel = process.env.AI_MODEL_CHAT || process.env.OPENAI_MODEL || SUMOPOD_PRIMARY_MODEL;
const defaultChatModel = sanitizeModelForProvider(rawChatModel, process.env.SUMOPOD_BASE_URL || 'https://ai.sumopod.com/v1');
const rawNluModel = process.env.AI_MODEL_NLU || 'deepseek-v4-flash-0731:netra';
const defaultNluModel = sanitizeModelForProvider(rawNluModel, process.env.SUMOPOD_BASE_URL || 'https://ai.sumopod.com/v1');
const defaultDeepModel = sanitizeModelForProvider(process.env.AI_MODEL_CHAT_DEEP || 'deepseek-v4-flash-0731:netra', process.env.SUMOPOD_BASE_URL || 'https://ai.sumopod.com/v1');

const defaultTaskModelRegistry: Map<AiTaskType, AiTaskModelConfig> = new Map([
  [
    'HARVESTING',
    {
      task: 'HARVESTING',
      provider: 'SumoPod',
      modelName: 'deepseek-v4-flash-0731:netra',
      description: 'Digunakan untuk mengekstrak Q&A dan data transaksi dari konsolidasi berkas histori chat.',
      maxTokens: 4096,
      temperature: 0.2,
    },
  ],
  [
    'CHAT_REPLY',
    {
      task: 'CHAT_REPLY',
      provider: 'SumoPod',
      modelName: 'glm-5.3-flash',
      description: 'Digunakan untuk menghasilkan respon percakapan otomatis kepada customer.',
      maxTokens: 1024,
      temperature: 0.6,
    },
  ],
  [
    'CHAT_REPLY_DEEP',
    {
      task: 'CHAT_REPLY_DEEP',
      provider: 'SumoPod',
      modelName: 'deepseek-v4-flash-0731:netra',
      description: 'Digunakan untuk menghasilkan respon percakapan mendalam pada konsultasi klinis multi-gejala / multi-treatment.',
      maxTokens: 1024,
      temperature: 0.5,
    },
  ],
  [
    'MEDICAL_CHECK',
    {
      task: 'MEDICAL_CHECK',
      provider: 'Internal Engine',
      modelName: 'Regex/Keywords (Engine 5.2)',
      description: 'Deterministik Engine (Sesuai PRD Section 5.2 - Non-Switchable)',
      maxTokens: 512,
      temperature: 0.1,
    },
  ],
  [
    'SUMMARIZATION',
    {
      task: 'SUMMARIZATION',
      provider: 'SumoPod',
      modelName: 'deepseek-v4-flash-0731:netra',
      description: 'Digunakan untuk merangkum riwayat percakapan panjang.',
      maxTokens: 1024,
      temperature: 0.3,
    },
  ],
  [
    'PII_SCRUBBING',
    {
      task: 'PII_SCRUBBING',
      provider: 'SumoPod',
      modelName: 'deepseek-v4-flash-0731:netra',
      description: 'Digunakan untuk membantu pembersihan nama dan data sensitif dari teks.',
      maxTokens: 512,
      temperature: 0.0,
    },
  ],
  [
    'INTENT_CLASSIFICATION',
    {
      task: 'INTENT_CLASSIFICATION',
      provider: 'SumoPod',
      modelName: defaultNluModel,
      description: 'Tool Routing & Intent Extraction (Call 1) — evaluasi pemanggilan tool atau direct reply.',
      maxTokens: 2048,
      temperature: 0.1,
      confidenceThreshold: parseFloat(process.env.NLU_CONFIDENCE_THRESHOLD || '0.60'),
    },
  ],
]);

export const SUPPORTED_PROVIDERS = ['MiniMax', 'OpenAI', 'DeepSeek', 'Groq', 'Anthropic', 'Alibaba', 'Qwen', 'Kenari', 'SumoPod'];

// === Preset Profiles Standar — Pusat Kendali 1-Klik (User-Centric, Zero-Anxiety) ===
// Server utama = SumoPod (5 model resmi). Kenari = cadangan (3 model). DeepSeek Direct = last fallback.
// KENAPA 3 KINERJA (bukan 1 / bukan 7):
//  1) FAST_ECONOMICAL  = 95% chat harian (tanya harga/jadwal/bapil ringan) butuh CEPAT+MURAH.
//     glm-5.3-flash 50% off ($0.015 in / $0.25 out) adalah model routing cepat dengan reasoning internal.
//  2) DEEP_REASONING   = keluhan multi-gejala butuh PENALARAN klinis (elaborasi, empati).
//     deepseek-v4-flash-0731:netra 80% off adalah varian DeepSeek terpintar di katalog SumoPod.
//  3) DISCIPLINED_QWEN = kasus rawan format rusak butuh DISIPLIN aturan (anti-sebut harga, anti-Bunda).
//     qwen3.7-flash-2026-07-15 adalah model paling tertib format di katalog SumoPod.
// FAILOVER_KENARI (bukan kinerja ke-4 harian) = gerbang infra bila SumoPod down -> deepseek-v4-1-flash Kenari.
export const AI_PRESET_PROFILES = {
  FAST_ECONOMICAL: {
    id: 'FAST_ECONOMICAL' as const,
    name: 'Mode Kilat & Hemat (Rekomendasi Utama)',
    provider: 'SUMOPOD' as const,
    chatModel: 'glm-5.3-flash',
    // deepModel = netra: konsultasi multi-gejala butuh penalaran
    // DeepSeek tertinggi. Diselaraskan dengan resetToGoldenDefaults agar klik
    // preset "Mode Kilat & Hemat" ≡ "Kembalikan ke Rekomendasi Default".
    deepModel: 'deepseek-v4-flash-0731:netra',
    description: 'Super cepat (~1.1s), ramah ala Bidan, paling hemat 90% off. Cocok 95% operasional harian.',
  },
  DEEP_REASONING: {
    id: 'DEEP_REASONING' as const,
    name: 'Mode Konsultasi Mendalam',
    provider: 'SUMOPOD' as const,
    chatModel: 'deepseek-v4-flash-0731:netra',
    deepModel: 'deepseek-v4-flash-0731:netra',
    description: 'Penalaran DeepSeek tertinggi (~2.4s), empati & elaborasi komprehensif untuk keluhan kompleks.',
  },
  DISCIPLINED_QWEN: {
    id: 'DISCIPLINED_QWEN' as const,
    name: 'Mode Alternatif Disiplin Format',
    provider: 'SUMOPOD' as const,
    chatModel: 'qwen3.7-flash-2026-07-15',
    deepModel: 'qwen3.7-flash-2026-07-15',
    description: 'Respon cepat (~1.3s), ringkas dan sangat tertib aturan.',
  },
  FAILOVER_SUMOPOD: {
    id: 'FAILOVER_SUMOPOD' as const,
    name: 'Mode Cadangan / Darurat (Kenari)',
    provider: 'KENARI' as const,
    chatModel: 'deepseek-v4-1-flash',
    deepModel: 'deepseek-v4-1-flash',
    description: 'Jalur server cadangan Kenari bila SumoPod utama mengalami gangguan. Auto-failover siaga.',
  },
} as const;

export type AiPresetId = keyof typeof AI_PRESET_PROFILES;

// Registry per-tenant: Map<tenantId, Map<AiTaskType, AiTaskModelConfig>>.
// Default tenant di-seed dari env pada saat modul dimuat.
const tenantRegistries: Map<string, Map<AiTaskType, AiTaskModelConfig>> = new Map();

function getOrCreateTenantRegistry(tenantId: string): Map<AiTaskType, AiTaskModelConfig> {
  let reg = tenantRegistries.get(tenantId);
  if (!reg) {
    // Clone default registry (env-driven) sebagai basis tiap tenant.
    reg = new Map(Array.from(defaultTaskModelRegistry.entries()).map(([task, cfg]) => [task, { ...cfg }]));
    tenantRegistries.set(tenantId, reg);
  }
  return reg;
}

export class AiModelConfigService {
  /** Status bot aktif per-tenant (disable satu tenant tidak memengaruhi tenant lain). */
  static globalBotActive = new Map<string, boolean>();

  /** Provider aktif per tenant: 'KENARI' | 'SUMOPOD'. */
  static activeLlmProvider = new Map<string, 'KENARI' | 'SUMOPOD'>();

  static getActiveProvider(tenantId: string = DEFAULT_TENANT_ID): 'KENARI' | 'SUMOPOD' {
    const cached = this.activeLlmProvider.get(tenantId);
    if (cached) return cached;

    const envProvider = (process.env.ACTIVE_LLM_PROVIDER || '').toUpperCase();
    if (envProvider === 'SUMOPOD' || envProvider === 'KENARI') {
      return envProvider as 'KENARI' | 'SUMOPOD';
    }

    const currentBaseUrl = (process.env.OPENAI_BASE_URL || '').toLowerCase();
    if (currentBaseUrl.includes('kenari')) return 'KENARI';
    // Default global: server utama = SumoPod
    return 'SUMOPOD';
  }

  static async setActiveProvider(tenantId: string, provider: 'KENARI' | 'SUMOPOD'): Promise<void> {
    this.activeLlmProvider.set(tenantId, provider);

    // Sinkronkan model chat default sesuai provider yang dipilih
    if (provider === 'KENARI') {
      const kenariModel = process.env.KENARI_DEFAULT_MODEL || KENARI_PRIMARY_MODEL;
      this.updateTaskConfig('CHAT_REPLY', { provider: 'Kenari', modelName: kenariModel }, tenantId);
    } else {
      const sumopodModel = process.env.SUMOPOD_DEFAULT_MODEL || SUMOPOD_PRIMARY_MODEL;
      this.updateTaskConfig('CHAT_REPLY', { provider: 'SumoPod', modelName: sumopodModel }, tenantId);
    }

    // Fire-and-forget persist ke DB agar respons HTTP instan & tidak terhambat jika DB offline/lambat
    (async () => {
      try {
        const { prisma } = await import('../db/client');
        await prisma.tenantAiConfig.upsert({
          where: {
            tenant_id_task: {
              tenant_id: tenantId,
              task: 'ACTIVE_LLM_PROVIDER',
            },
          },
          create: {
            tenant_id: tenantId,
            task: 'ACTIVE_LLM_PROVIDER',
            provider: 'SYSTEM',
            model_name: provider,
            max_tokens: 0,
            temperature: 0,
          },
          update: {
            model_name: provider,
          },
        });
      } catch (err: any) {
        console.warn('[AI MODEL CONFIG] Failed to persist active LLM provider:', err.message);
      }
    })();
  }

  /**
   * Mengembalikan konfigurasi endpoint aktual berdasarkan provider aktif tenant.
   */
  static getActiveEndpointConfig(tenantId: string = DEFAULT_TENANT_ID): {
    provider: 'KENARI' | 'SUMOPOD';
    baseUrl: string;
    apiKey: string;
    defaultModel: string;
  } {
    const provider = this.getActiveProvider(tenantId);
    if (provider === 'KENARI') {
      return {
        provider: 'KENARI',
        baseUrl: (process.env.KENARI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://kenari.id/v1').replace(/\/$/, ''),
        apiKey: process.env.KENARI_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '',
        defaultModel: process.env.KENARI_DEFAULT_MODEL || KENARI_PRIMARY_MODEL,
      };
    }

    return {
      provider: 'SUMOPOD',
      baseUrl: (process.env.SUMOPOD_BASE_URL || process.env.OPENAI_BASE_URL || 'https://ai.sumopod.com/v1').replace(/\/$/, ''),
      apiKey: process.env.SUMOPOD_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '',
      defaultModel: process.env.SUMOPOD_DEFAULT_MODEL || SUMOPOD_PRIMARY_MODEL,
    };
  }

  static isBotActive(tenantId: string = DEFAULT_TENANT_ID): boolean {
    return this.globalBotActive.get(tenantId) ?? true;
  }

  static async setBotActive(tenantId: string, active: boolean): Promise<void> {
    this.globalBotActive.set(tenantId, active);
    try {
      const { prisma } = await import('../db/client');
      await prisma.tenantAiConfig.upsert({
        where: {
          tenant_id_task: {
            tenant_id: tenantId,
            task: 'GLOBAL_BOT_ENABLED',
          },
        },
        create: {
          tenant_id: tenantId,
          task: 'GLOBAL_BOT_ENABLED',
          provider: 'SYSTEM',
          model_name: active ? 'true' : 'false',
          max_tokens: 0,
          temperature: 0,
        },
        update: {
          model_name: active ? 'true' : 'false',
        },
      });
    } catch (err: any) {
      console.warn('[AI MODEL CONFIG] Failed to persist bot active status:', err.message);
    }
  }

  /**
   * Sync seluruh task model config ke database per tenant (SaaS-ready).
   * Sumber kebenaran: tabel tenant_ai_config. Fallback: registry in-memory.
   */
  static async loadConfigsFromDb(tenantId: string): Promise<void> {
    try {
      const { prisma } = await import('../db/client');
      const dbConfigs = await prisma.tenantAiConfig.findMany({
        where: { tenant_id: tenantId },
      });

      const botActiveConfig = dbConfigs.find((c) => c.task === 'GLOBAL_BOT_ENABLED');
      if (botActiveConfig) {
        this.globalBotActive.set(tenantId, botActiveConfig.model_name === 'true');
      }

      const providerConfig = dbConfigs.find((c) => c.task === 'ACTIVE_LLM_PROVIDER');
      if (providerConfig && (providerConfig.model_name === 'KENARI' || providerConfig.model_name === 'SUMOPOD')) {
        this.activeLlmProvider.set(tenantId, providerConfig.model_name as 'KENARI' | 'SUMOPOD');
      }

      const reg = getOrCreateTenantRegistry(tenantId);
      if (dbConfigs.length > 0) {
        for (const cfg of dbConfigs) {
          const task = cfg.task as AiTaskType;
          if (!defaultTaskModelRegistry.has(task)) continue;
          reg.set(task, {
            task,
            provider: cfg.provider,
            modelName: cfg.model_name,
            description: `DB config for task ${task}`,
            maxTokens: cfg.max_tokens,
            temperature: cfg.temperature,
            confidenceThreshold: cfg.confidence_threshold ?? undefined,
          });
        }
        return;
      }

      // Tidak ada di DB -> seed dari registry in-memory
      await this.saveConfigsToDb(tenantId);
    } catch (err) {
      console.warn('[AI MODEL CONFIG] DB unavailable, using in-memory:', (err as Error).message);
    }
  }

  /** Antrean serialisasi penyimpanan per-tenant: cegah balapan deleteMany+createMany
   *  antar updateTaskConfig konkuren (penyebab "save tidak tersave": unique violation
   *  tenant_id+task karena delete/create interleaved). Setiap save dirantai ke promise sebelumnya. */
  private static saveQueue = new Map<string, Promise<boolean>>();

  /**
   * Simpan seluruh task model config ke database per tenant (atomik + serial per-tenant).
   */
  static async saveConfigsToDb(tenantId: string): Promise<boolean> {
    const prev = this.saveQueue.get(tenantId) || Promise.resolve(true);
    const run = prev.catch(() => true).then(() => this.saveConfigsToDbInner(tenantId));
    this.saveQueue.set(tenantId, run);
    try {
      return await run;
    } finally {
      if (this.saveQueue.get(tenantId) === run) this.saveQueue.delete(tenantId);
    }
  }

  private static async saveConfigsToDbInner(tenantId: string): Promise<boolean> {
    try {
      const { prisma } = await import('../db/client');
      const entries = Array.from(getOrCreateTenantRegistry(tenantId).entries())
        .filter(([task]) => task !== 'MEDICAL_CHECK') // locked
        .map(([task, cfg]) => ({
          tenant_id: tenantId,
          task,
          provider: cfg.provider,
          model_name: cfg.modelName,
          max_tokens: cfg.maxTokens,
          temperature: cfg.temperature,
          confidence_threshold: cfg.confidenceThreshold ?? null,
        }));
      // Transaksi atomik: hapus task lama + tulis ulang + upsert provider aktif.
      // ACTIVE_LLM_PROVIDER wajib ikut persist — tanpanya provider revert setelah restart
      // (penyebab "save tidak tersave" untuk ganti Server Utama/Cadangan & preset).
      const activeProvider = this.activeLlmProvider.get(tenantId) || this.getActiveProvider(tenantId);
      await prisma.$transaction([
        prisma.tenantAiConfig.deleteMany({
          where: {
            tenant_id: tenantId,
            task: { notIn: ['GLOBAL_BOT_ENABLED', 'ACTIVE_LLM_PROVIDER'] },
          },
        }),
        ...(entries.length > 0 ? [prisma.tenantAiConfig.createMany({ data: entries })] : []),
        prisma.tenantAiConfig.upsert({
          where: { tenant_id_task: { tenant_id: tenantId, task: 'ACTIVE_LLM_PROVIDER' } },
          create: { tenant_id: tenantId, task: 'ACTIVE_LLM_PROVIDER', provider: 'SYSTEM', model_name: activeProvider, max_tokens: 0, temperature: 0 },
          update: { model_name: activeProvider },
        }),
      ]);
      return true;
    } catch (err) {
      console.error('[AI MODEL CONFIG] Failed to save to DB:', (err as Error).message);
      return false;
    }
  }

  /**
   * Mengambil konfigurasi AI Model untuk task tertentu (per-tenant).
   */
  static getModelConfig(task: AiTaskType, tenantId: string = DEFAULT_TENANT_ID): AiTaskModelConfig {
    const reg = getOrCreateTenantRegistry(tenantId);
    const config = reg.get(task);
    if (!config) {
      return {
        task,
        provider: defaultProvider,
        modelName: defaultChatModel,
        description: 'Default Fallback Model',
        maxTokens: 1024,
        temperature: 0.3,
      };
    }

    if (task === 'MEDICAL_CHECK') {
      return {
        ...config,
        provider: 'Internal Engine',
        modelName: 'Regex/Keywords (Engine 5.2)',
        description: 'Deterministik Engine (Sesuai PRD Section 5.2 - Non-Switchable)',
      };
    }

    const taskBase = baseUrlForProviderLabel(config.provider);
    const sanitizedModel = taskBase === null ? config.modelName : sanitizeModelForProvider(config.modelName, taskBase);
    if (sanitizedModel !== config.modelName) {
      return { ...config, modelName: sanitizedModel };
    }

    return config;
  }

  /**
   * Mengambil seluruh daftar task dan model yang terdaftar (untuk UI Admin).
   * Nilai yang dikembalikan adalah EFEKTIF (di-sanitize per provider masing-masing
   * task) agar yang tampil di UI sama dengan yang dipakai runtime — bukan nilai
   * mentah registry. Task OpenAI (NLU) tidak pernah terkonversi ke gateway.
   */
  static getAllTaskConfigs(tenantId: string = DEFAULT_TENANT_ID): AiTaskModelConfig[] {
    return Array.from(getOrCreateTenantRegistry(tenantId).values()).map(cfg => {
      if (cfg.task === 'MEDICAL_CHECK') {
        return {
          ...cfg,
          provider: 'Internal Engine',
          modelName: 'Regex/Keywords (Engine 5.2)',
          description: 'Deterministik Engine (Sesuai PRD Section 5.2 - Non-Switchable)',
        };
      }
      const taskBase = baseUrlForProviderLabel(cfg.provider);
      if (taskBase === null) return cfg;
      const sanitized = sanitizeModelForProvider(cfg.modelName, taskBase);
      return sanitized !== cfg.modelName ? { ...cfg, modelName: sanitized } : cfg;
    });
  }

  /**
   * Memperbarui konfigurasi AI Model untuk task tertentu (dinamis via Admin API / UI).
   * Tenant-aware: tenantId diteruskan (bukan hardcode 'default-tenant').
   * Opsi `{ persist: false }` untuk jalur batch: tunda tulis DB, pemanggil wajib
   * `await saveConfigsToDb()` sekali di akhir (hindari N save konkuren yang balapan).
   */
  static updateTaskConfig(task: AiTaskType, updates: Partial<AiTaskModelConfig>, tenantId: string = DEFAULT_TENANT_ID, opts?: { persist?: boolean }): AiTaskModelConfig {
    if (task === 'MEDICAL_CHECK') {
      throw new Error('MEDICAL_CHECK_LOCKED: Deteksi medis bersifat deterministik (Regex/Keywords) dan tidak dapat diubah ke model AI dinamis.');
    }

    if (updates.provider && !SUPPORTED_PROVIDERS.includes(updates.provider)) {
      throw new Error(`INVALID_PROVIDER: Provider '${updates.provider}' tidak didukung. Provider yang diizinkan: ${SUPPORTED_PROVIDERS.join(', ')}.`);
    }

    if (updates.modelName !== undefined && (!updates.modelName || typeof updates.modelName !== 'string' || !updates.modelName.trim())) {
      throw new Error('INVALID_MODEL_NAME: Nama model AI tidak boleh kosong.');
    }

    const existing = this.getModelConfig(task, tenantId);
    const updated = {
      ...existing,
      ...updates,
      task, // Ensure task ID remains unchanged
    };
    getOrCreateTenantRegistry(tenantId).set(task, updated);
    console.log(`[AI MODEL CONFIG UPDATED] Tenant '${tenantId}' Task '${task}' is now mapped to provider '${updated.provider}' with model '${updated.modelName}'`);
    if (opts?.persist === false) return updated;
    // Single update (PATCH /:task): fire-and-forget sinkronisasi ke DB (SaaS-ready).
    this.saveConfigsToDb(tenantId).catch((e) =>
      console.warn('[AI MODEL CONFIG] update DB sync failed:', (e as Error).message)
    );
    return updated;
  }

  /**
   * Terapkan preset 1-klik ke tenant: set active provider + model CHAT_REPLY/CHAT_REPLY_DEEP.
   * Tenant-aware — hanya mengubah registry tenant yang bersangkutan.
   */
  static applyPresetProfile(presetId: string, tenantId: string = DEFAULT_TENANT_ID): { presetId: AiPresetId; configs: AiTaskModelConfig[] } {
    const preset = (AI_PRESET_PROFILES as any)[presetId];
    if (!preset) {
      throw new Error(`INVALID_PRESET: Preset '${presetId}' tidak dikenal. Pilihan: ${Object.keys(AI_PRESET_PROFILES).join(', ')}.`);
    }
    const providerLabel = preset.provider === 'SUMOPOD' ? 'SumoPod' : 'Kenari';
    this.activeLlmProvider.set(tenantId, preset.provider as 'KENARI' | 'SUMOPOD');
    // Update task utama — CHAT_REPLY dan CHAT_REPLY_DEEP disinkronkan ke model preset.
    // persist:false — pemanggil batch/reset wajib await saveConfigsToDb() sekali di akhir.
    this.updateTaskConfig('CHAT_REPLY', { provider: providerLabel, modelName: preset.chatModel }, tenantId, { persist: false });
    this.updateTaskConfig('CHAT_REPLY_DEEP', { provider: providerLabel, modelName: preset.deepModel || preset.chatModel }, tenantId, { persist: false });
    // Task non-kritis (summarization) ikut disamakan agar tone konsisten, tapi tidak memaksa jika sudah kustom
    try {
      this.updateTaskConfig('SUMMARIZATION', { provider: providerLabel, modelName: preset.chatModel }, tenantId, { persist: false });
    } catch {}
    return { presetId: preset.id as AiPresetId, configs: this.getAllTaskConfigs(tenantId) };
  }

  /**
   * Kembalikan seluruh konfigurasi tenant ke setelan emas klinik (golden defaults).
   * Mereset active provider ke SUMOPOD (server utama) dan mengkloning defaultTaskModelRegistry.
   */
  static async resetToGoldenDefaults(tenantId: string = DEFAULT_TENANT_ID): Promise<AiTaskModelConfig[]> {
    this.activeLlmProvider.set(tenantId, 'SUMOPOD');
    const fresh = new Map<AiTaskType, AiTaskModelConfig>(
      Array.from(defaultTaskModelRegistry.entries()).map(([task, cfg]) => [task, { ...cfg }])
    );
    tenantRegistries.set(tenantId, fresh);
    // Golden deterministik (anti-env-drift): paksa task utama ke preset FAST_ECONOMICAL
    // (glm-5.3-flash SumoPod) agar reset selalu kembali ke rekomendasi emas,
    // bukan snapshot env lokal (mis. .env dev yang masih KENARI).
    try {
      this.updateTaskConfig('CHAT_REPLY', { provider: 'SumoPod', modelName: 'glm-5.3-flash' }, tenantId, { persist: false });
      this.updateTaskConfig('CHAT_REPLY_DEEP', { provider: 'SumoPod', modelName: 'deepseek-v4-flash-0731:netra' }, tenantId, { persist: false });
      this.updateTaskConfig('SUMMARIZATION', { provider: 'SumoPod', modelName: 'deepseek-v4-flash-0731:netra' }, tenantId, { persist: false });
    } catch {}
    // Persist reset ke DB sekali (saveConfigsToDbInner sudah upsert ACTIVE_LLM_PROVIDER).
    await this.saveConfigsToDb(tenantId);
    // Persist active provider SUMOPOD (server utama)
    try {
      const { prisma } = await import('../db/client');
      await prisma.tenantAiConfig.upsert({
        where: { tenant_id_task: { tenant_id: tenantId, task: 'ACTIVE_LLM_PROVIDER' } },
        create: { tenant_id: tenantId, task: 'ACTIVE_LLM_PROVIDER', provider: 'SYSTEM', model_name: 'SUMOPOD', max_tokens: 0, temperature: 0 },
        update: { model_name: 'SUMOPOD' },
      });
    } catch (e: any) {
      console.warn('[AI MODEL CONFIG] reset provider persist failed:', e.message);
    }
    return this.getAllTaskConfigs(tenantId);
  }
}
