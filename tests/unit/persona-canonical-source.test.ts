import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import { prisma } from '../../src/db/client';
import { TenantPromptConfigService } from '../../src/services/tenant-prompt-config.service';
import { savePersonaToDb } from '../../src/config/persona';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Persona Canonical Source (TenantPromptConfigService bridge)', () => {
  beforeEach(() => {
    TenantPromptConfigService.invalidateCache(DEFAULT_TENANT_ID);
    TenantPromptConfigService.invalidateCache('tenant-a');
    TenantPromptConfigService.invalidateCache('tenant-b');
    TenantPromptConfigService.invalidateCache('tenant-offline');
    vi.restoreAllMocks();

    if (!(prisma as any).tenantPersona) {
      (prisma as any).tenantPersona = {
        findUnique: vi.fn().mockRejectedValue(new Error('Database offline')),
        upsert: vi.fn().mockRejectedValue(new Error('Database offline')),
      };
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Config aktif menang atas TenantPersona', async () => {
    vi.mocked((prisma as any).tenantPromptConfig.findFirst).mockResolvedValueOnce({
      tenant_id: 'tenant-a',
      version: 2,
      is_active: true,
      personality_tone: 'Tone dari Config Aktif',
      answering_hierarchy: 'Hierarchy Aktif',
      negative_constraints: 'Constraints Aktif',
      medical_overclaim_rules: 'Rules Aktif',
    });

    const personaSpy = vi.fn().mockResolvedValue({
      tenant_id: 'tenant-a',
      persona: 'Tone dari TenantPersona Lama',
    });
    (prisma as any).tenantPersona.findUnique = personaSpy;

    const result = await TenantPromptConfigService.getActivePromptConfig('tenant-a');

    expect(result).not.toBeNull();
    expect(result?.personalityTone).toBe('Tone dari Config Aktif');
    expect(result?.answeringHierarchy).toBe('Hierarchy Aktif');
    expect(personaSpy).not.toHaveBeenCalled();
  });

  it('2. Jika config aktif kosong, TenantPersona.persona menjadi personalityTone', async () => {
    vi.mocked((prisma as any).tenantPromptConfig.findFirst).mockResolvedValueOnce(null);

    (prisma as any).tenantPersona.findUnique = vi.fn().mockResolvedValueOnce({
      tenant_id: 'tenant-a',
      persona: 'Tone khusus Bidan Senior Tenant A',
    });

    const result = await TenantPromptConfigService.getActivePromptConfig('tenant-a');

    expect(result).not.toBeNull();
    expect(result?.personalityTone).toBe('Tone khusus Bidan Senior Tenant A');
    expect(result?.negativeConstraints).toBe(TenantPromptConfigService.getDefaultConfig().negativeConstraints);
  });

  it('3. Jika keduanya tidak ada/DB offline, return null', async () => {
    vi.mocked((prisma as any).tenantPromptConfig.findFirst).mockRejectedValueOnce(new Error('Database offline'));
    (prisma as any).tenantPersona.findUnique = vi.fn().mockRejectedValueOnce(new Error('Database offline'));

    const result = await TenantPromptConfigService.getActivePromptConfig('tenant-offline');

    expect(result).toBeNull();
  });

  it('4. savePersonaToDb memanggil invalidateCache dan cache berikutnya berisi persona baru', async () => {
    const writeFileSyncSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

    // State awal: persona lama
    (prisma as any).tenantPersona.findUnique = vi.fn().mockResolvedValue({
      tenant_id: 'tenant-a',
      persona: 'Persona Versi 1',
    });
    vi.mocked((prisma as any).tenantPromptConfig.findFirst).mockResolvedValue(null);

    const first = await TenantPromptConfigService.getActivePromptConfig('tenant-a');
    expect(first?.personalityTone).toBe('Persona Versi 1');

    // Mock upsert berhasil
    (prisma as any).tenantPersona.upsert = vi.fn().mockResolvedValue({
      tenant_id: 'tenant-a',
      persona: 'Persona Versi 2 Baru',
    });

    // Mock findUnique selanjutnya mengembalikan persona baru
    (prisma as any).tenantPersona.findUnique = vi.fn().mockResolvedValue({
      tenant_id: 'tenant-a',
      persona: 'Persona Versi 2 Baru',
    });

    // Simpan persona baru
    const saved = await savePersonaToDb('Persona Versi 2 Baru', 'tenant-a');
    expect(saved).toBe(true);

    // Ambil lagi tanpa restart -> harus mengembalikan persona versi 2 karena cache sudah diinvalidasi
    const second = await TenantPromptConfigService.getActivePromptConfig('tenant-a');
    expect(second?.personalityTone).toBe('Persona Versi 2 Baru');

    writeFileSyncSpy.mockRestore();
  });

  it('5. Cache lama tidak bocor antar-tenant', async () => {
    vi.mocked((prisma as any).tenantPromptConfig.findFirst).mockResolvedValue(null);

    (prisma as any).tenantPersona.findUnique = vi.fn().mockImplementation(async ({ where }: any) => {
      if (where.tenant_id === 'tenant-a') {
        return { tenant_id: 'tenant-a', persona: 'Persona Tenant A' };
      }
      if (where.tenant_id === 'tenant-b') {
        return { tenant_id: 'tenant-b', persona: 'Persona Tenant B' };
      }
      return null;
    });

    const resA = await TenantPromptConfigService.getActivePromptConfig('tenant-a');
    const resB = await TenantPromptConfigService.getActivePromptConfig('tenant-b');

    expect(resA?.personalityTone).toBe('Persona Tenant A');
    expect(resB?.personalityTone).toBe('Persona Tenant B');
  });

  it('6. getPromptConfigMeta membedakan source: active, legacy, dan default secara akurat', async () => {
    // 6a. Active
    vi.mocked((prisma as any).tenantPromptConfig.findFirst).mockResolvedValueOnce({
      tenant_id: 'tenant-src-active',
      version: 1,
      is_active: true,
      personality_tone: 'Tone Active',
      answering_hierarchy: 'Hierarchy Active',
      negative_constraints: 'Constraints Active',
      medical_overclaim_rules: 'Rules Active',
    });
    const metaActive = await TenantPromptConfigService.getPromptConfigMeta('tenant-src-active');
    expect(metaActive.source).toBe('active');
    expect(metaActive.config?.personalityTone).toBe('Tone Active');

    // 6b. Legacy
    vi.mocked((prisma as any).tenantPromptConfig.findFirst).mockResolvedValueOnce(null);
    (prisma as any).tenantPersona.findUnique = vi.fn().mockResolvedValueOnce({
      tenant_id: 'tenant-src-legacy',
      persona: 'Tone Legacy',
    });
    const metaLegacy = await TenantPromptConfigService.getPromptConfigMeta('tenant-src-legacy');
    expect(metaLegacy.source).toBe('legacy');
    expect(metaLegacy.config?.personalityTone).toBe('Tone Legacy');

    // 6c. Default
    vi.mocked((prisma as any).tenantPromptConfig.findFirst).mockResolvedValueOnce(null);
    (prisma as any).tenantPersona.findUnique = vi.fn().mockResolvedValueOnce(null);
    const metaDefault = await TenantPromptConfigService.getPromptConfigMeta('tenant-src-default');
    expect(metaDefault.source).toBe('default');
    expect(metaDefault.config).toBeNull();
  });
});
