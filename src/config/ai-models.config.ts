/**
 * Centralized AI Model Config Registry
 * Manages task-to-model mappings dynamically so models can be changed
 * without hunting through codebase, and exposed for UI management.
 */

export type AiTaskType = 'HARVESTING' | 'CHAT_REPLY' | 'MEDICAL_CHECK' | 'SUMMARIZATION' | 'PII_SCRUBBING';

export interface AiTaskModelConfig {
  task: AiTaskType;
  provider: string;
  modelName: string;
  description: string;
  maxTokens: number;
  temperature: number;
}

// In-Memory dynamic registry (can be persisted or updated via Admin API / UI)
const defaultTaskModelRegistry: Map<AiTaskType, AiTaskModelConfig> = new Map([
  [
    'HARVESTING',
    {
      task: 'HARVESTING',
      provider: process.env.AI_PROVIDER_HARVESTING || 'MiniMax',
      modelName: process.env.AI_MODEL_HARVESTING || 'MiniMax-M2.7-highspeed',
      description: 'Digunakan untuk mengekstrak Q&A dan data transaksi dari histori chat lama.',
      maxTokens: 2048,
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
]);

export const SUPPORTED_PROVIDERS = ['MiniMax', 'OpenAI', 'DeepSeek', 'Groq', 'Anthropic'];

export class AiModelConfigService {
  static globalBotActive = true;

  /**
   * Mengambil konfigurasi AI Model untuk task tertentu
   */
  static getModelConfig(task: AiTaskType): AiTaskModelConfig {

    const config = defaultTaskModelRegistry.get(task);
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
   * Mengambil seluruh daftar task dan model yang terdaftar (untuk UI Admin)
   */
  static getAllTaskConfigs(): AiTaskModelConfig[] {
    return Array.from(defaultTaskModelRegistry.values()).map(cfg => {
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
   * Memperbarui konfigurasi AI Model untuk task tertentu (dinamis via Admin API / UI)
   */
  static updateTaskConfig(task: AiTaskType, updates: Partial<AiTaskModelConfig>): AiTaskModelConfig {
    if (task === 'MEDICAL_CHECK') {
      throw new Error('MEDICAL_CHECK_LOCKED: Deteksi medis bersifat deterministik (Regex/Keywords) dan tidak dapat diubah ke model AI dinamis.');
    }

    if (updates.provider && !SUPPORTED_PROVIDERS.includes(updates.provider)) {
      throw new Error(`INVALID_PROVIDER: Provider '${updates.provider}' tidak didukung. Provider yang diizinkan: ${SUPPORTED_PROVIDERS.join(', ')}.`);
    }

    if (updates.modelName !== undefined && (!updates.modelName || typeof updates.modelName !== 'string' || !updates.modelName.trim())) {
      throw new Error('INVALID_MODEL_NAME: Nama model AI tidak boleh kosong.');
    }

    const existing = this.getModelConfig(task);
    const updated = {
      ...existing,
      ...updates,
      task, // Ensure task ID remains unchanged
    };
    defaultTaskModelRegistry.set(task, updated);
    console.log(`[AI MODEL CONFIG UPDATED] Task '${task}' is now mapped to provider '${updated.provider}' with model '${updated.modelName}'`);
    return updated;
  }
}
