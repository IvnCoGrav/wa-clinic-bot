import { describe, it, expect } from 'vitest';
import { AiModelConfigService } from '../../src/config/ai-models.config';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Fase 4 — Tenant-Aware Model Registry.
 * Registry per-tenant: load tenant A dan B tidak saling menimpa;
 * update config tenant A tidak mengubah tenant B; bot active per-tenant.
 */
describe('AiModelConfigService — tenant-aware registry', () => {
  it('loadConfigsFromDb tenant A tidak menimpa tenant B (registry terpisah)', async () => {
    // Tanpa DB (offline) → loadConfigsFromDb jatuh ke fallback in-memory (clone default).
    await AiModelConfigService.loadConfigsFromDb('tenant-A');
    await AiModelConfigService.loadConfigsFromDb('tenant-B');

    // Update tenant A
    const updated = AiModelConfigService.updateTaskConfig(
      'CHAT_REPLY',
      { modelName: 'deepseek-v4-flash', provider: 'DeepSeek' },
      'tenant-A'
    );
    expect(updated.modelName).toBe('deepseek-v4-flash');

    // Tenant B TIDAK berubah
    const tenantB = AiModelConfigService.getModelConfig('CHAT_REPLY', 'tenant-B');
    expect(tenantB.modelName).toBe(process.env.AI_MODEL_CHAT || 'MiniMax-M2.7-highspeed');

    // Tenant default TIDAK berubah
    const def = AiModelConfigService.getModelConfig('CHAT_REPLY', DEFAULT_TENANT_ID);
    expect(def.modelName).toBe(process.env.AI_MODEL_CHAT || 'MiniMax-M2.7-highspeed');
  });

  it('getAllTaskConfigs per-tenant mengembalikan daftar terpisah', async () => {
    await AiModelConfigService.loadConfigsFromDb('tenant-C');
    AiModelConfigService.updateTaskConfig('SUMMARIZATION', { modelName: 'qwen3.7-flash-2026-07-15' }, 'tenant-C');

    const c = AiModelConfigService.getAllTaskConfigs('tenant-C');
    const def = AiModelConfigService.getAllTaskConfigs(DEFAULT_TENANT_ID);
    const cSum = c.find((x) => x.task === 'SUMMARIZATION')!;
    const defSum = def.find((x) => x.task === 'SUMMARIZATION')!;
    expect(cSum.modelName).toBe('qwen3.7-flash-2026-07-15');
    expect(defSum.modelName).toBe(process.env.AI_MODEL_SUMMARIZATION || 'MiniMax-M2.7-highspeed');
  });

  it('globalBotActive per-tenant: disable tenant A tidak memengaruhi tenant B', () => {
    AiModelConfigService.setBotActive('tenant-X', false);
    expect(AiModelConfigService.isBotActive('tenant-X')).toBe(false);
    expect(AiModelConfigService.isBotActive('tenant-Y')).toBe(true);
    expect(AiModelConfigService.isBotActive(DEFAULT_TENANT_ID)).toBe(true);
  });

  it('MEDICAL_CHECK tetap terkunci (deterministik) untuk semua tenant', () => {
    const cfg = AiModelConfigService.getModelConfig('MEDICAL_CHECK', 'tenant-D');
    expect(cfg.provider).toBe('Internal Engine');
    expect(() => AiModelConfigService.updateTaskConfig('MEDICAL_CHECK', { modelName: 'x' }, 'tenant-D')).toThrow('MEDICAL_CHECK_LOCKED');
  });
});
