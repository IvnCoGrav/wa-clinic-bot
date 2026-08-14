/**
 * Centralized AI Model Config Registry
 * Manages task-to-model mappings dynamically so models can be changed
 * without hunting through codebase, and exposed for UI management.
 *
 * Tenant-aware (SaaS): registry disimpan per-tenant (`Map<tenantId, Map<task, config>>`)
 * agar konfigurasi tenant A tidak tertimpa saat tenant B di-load dari DB.
 */
import { DEFAULT_TENANT_ID } from './tenant';

export type AiTaskType = 'HARVESTING' | 'CHAT_REPLY' | 'MEDICAL_CHECK' | 'SUMMARIZATION' | 'PII_SCRUBBING' | 'INTENT_CLASSIFICATION';

export interface AiTaskModelConfig {
  task: AiTaskType;
  provider: string;
  modelName: string;
  description: string;
  maxTokens: number;
  temperature: number;
  confidenceThreshold?: number;
}

// In-Memory dynamic registry (can be persisted or updated via Admin API / UI)
// Basis default (env-driven) untuk tiap tenant — di-clone ke per-tenant registry saat dipakai.
const defaultTaskModelRegistry: Map<AiTaskType, AiTaskModelConfig> = new Map([
  [
    'HARVESTING',
    {
      task: 'HARVESTING',
      provider: process.env.AI_PROVIDER_HARVESTING || 'DeepSeek',
      modelName: process.env.AI_MODEL_HARVESTING || 'deepseek-chat',
      description: 'Digunakan untuk mengekstrak Q&A dan data transaksi dari konsolidasi berkas histori chat.',
      maxTokens: 4096,
      temperature: 0.2,
    },
  ],
  [
    'CHAT_REPLY',
    {
      task: 'CHAT_REPLY',
      provider: process.env.AI_PROVIDER_CHAT || 'MiniMax',
      modelName: process.env.AI_MODEL_CHAT || 'MiniMax-M2.7-highspeed',
      description: 'Digunakan untuk menghasilkan respon percakapan otomatis kepada customer.',
      maxTokens: 1024,
      temperature: 0.7,
    },
  ],
  [
    'MEDICAL_CHECK',
    {
      task: 'MEDICAL_CHECK',
      provider: process.env.AI_PROVIDER_MEDICAL || 'MiniMax',
      modelName: process.env.AI_MODEL_MEDICAL || 'MiniMax-M2.7-highspeed',
      description: 'Digunakan untuk memverifikasi dan mengevaluasi konteks medis.',
      maxTokens: 512,
      temperature: 0.1,
    },
  ],
  [
    'SUMMARIZATION',
    {
      task: 'SUMMARIZATION',
      provider: process.env.AI_PROVIDER_SUMMARIZATION || 'MiniMax',
      modelName: process.env.AI_MODEL_SUMMARIZATION || 'MiniMax-M2.7-highspeed',
      description: 'Digunakan untuk merangkum riwayat percakapan panjang.',
      maxTokens: 1024,
      temperature: 0.3,
    },
  ],
  [
    'PII_SCRUBBING',
    {
      task: 'PII_SCRUBBING',
      provider: process.env.AI_PROVIDER_PII || 'MiniMax',
      modelName: process.env.AI_MODEL_PII || 'MiniMax-M2.7-highspeed',
      description: 'Digunakan untuk membantu pembersihan nama dan data sensitif dari teks.',
      maxTokens: 512,
      temperature: 0.0,
    },
  ],
  [
    'INTENT_CLASSIFICATION',
    {
      task: 'INTENT_CLASSIFICATION',
      provider: process.env.AI_PROVIDER_NLU || 'MiniMax',
      modelName: process.env.AI_MODEL_NLU || 'MiniMax-M2.7-highspeed',
      description: 'Digunakan untuk klasifikasi terstruktur intent & entitas NLU customer.',
      maxTokens: 1024,
      temperature: 0.1,
      confidenceThreshold: parseFloat(process.env.NLU_CONFIDENCE_THRESHOLD || '0.60'),
    },
  ],
]);

export const SUPPORTED_PROVIDERS = ['MiniMax', 'OpenAI', 'DeepSeek', 'Groq', 'Anthropic'];

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

  static isBotActive(tenantId: string = DEFAULT_TENANT_ID): boolean {
    return this.globalBotActive.get(tenantId) ?? true;
  }

  static setBotActive(tenantId: string, active: boolean): void {
    this.globalBotActive.set(tenantId, active);
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

  /**
   * Simpan seluruh task model config ke database per tenant.
   */
  static async saveConfigsToDb(tenantId: string): Promise<boolean> {
    try {
      const { prisma } = await import('../db/client');
      await prisma.tenantAiConfig.deleteMany({ where: { tenant_id: tenantId } });
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
      if (entries.length > 0) {
        await prisma.tenantAiConfig.createMany({ data: entries });
      }
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
        provider: 'MiniMax',
        modelName: 'MiniMax-M2.7-highspeed',
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

    return config;
  }

  /**
   * Mengambil seluruh daftar task dan model yang terdaftar (untuk UI Admin).
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
      return cfg;
    });
  }

  /**
   * Memperbarui konfigurasi AI Model untuk task tertentu (dinamis via Admin API / UI).
   * Tenant-aware: tenantId diteruskan (bukan hardcode 'default-tenant').
   */
  static updateTaskConfig(task: AiTaskType, updates: Partial<AiTaskModelConfig>, tenantId: string = DEFAULT_TENANT_ID): AiTaskModelConfig {
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
    // Fire-and-forget sinkronisasi ke DB (SaaS-ready) — pakai tenantId asli.
    this.saveConfigsToDb(tenantId).catch((e) =>
      console.warn('[AI MODEL CONFIG] update DB sync failed:', (e as Error).message)
    );
    return updated;
  }
}
