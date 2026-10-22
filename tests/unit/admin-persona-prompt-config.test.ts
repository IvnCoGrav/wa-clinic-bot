import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { auditService } from '../../src/services/audit.service';
import { TenantPromptConfigService } from '../../src/services/tenant-prompt-config.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

const ADMIN_KEY = 'test_admin_persona_key_456';

describe('Admin Persona Prompt Config Routes (Fase 2)', () => {
  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    TenantPromptConfigService.invalidateCache(DEFAULT_TENANT_ID);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. GET /api/admin/persona/prompt-config tanpa config kustom mengembalikan default sections', async () => {
    vi.mocked((prisma as any).tenantPromptConfig.findFirst).mockResolvedValueOnce(null);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/persona/prompt-config',
      headers: {
        'x-api-key': ADMIN_KEY,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.isCustom).toBe(false);
    expect(body.source).toBe('default');
    expect(body.config).toBeDefined();
    expect(body.config.personalityTone).toContain('[GAYA BICARA & KEPRIBADIAN');
    expect(body.config.answeringHierarchy).toContain('[HIERARKI & ALUR MENJAWAB');
    expect(body.config.negativeConstraints).toContain('[NEGATIVE CONSTRAINTS MUTLAK');
    expect(body.config.medicalOverclaimRules).toContain('[ATURAN ANTI-OVERCLAIM MEDIS');
  });

  it('1b. Tanpa 4-Section aktif tetapi TenantPersona ada → legacy, isCustom false', async () => {
    vi.mocked((prisma as any).tenantPromptConfig.findFirst).mockResolvedValueOnce(null);

    (prisma as any).tenantPersona = (prisma as any).tenantPersona || {};
    (prisma as any).tenantPersona.findUnique = vi.fn().mockResolvedValueOnce({
      tenant_id: DEFAULT_TENANT_ID,
      persona: 'Persona Legacy Bidan Senior',
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/persona/prompt-config',
      headers: { 'x-api-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.isCustom).toBe(false);
    expect(body.source).toBe('legacy');
    expect(body.config.personalityTone).toBe('Persona Legacy Bidan Senior');
  });

  it('2. GET /api/admin/persona/prompt-config dengan config aktif mengembalikan config kustom', async () => {
    vi.mocked((prisma as any).tenantPromptConfig.findFirst).mockResolvedValueOnce({
      tenant_id: DEFAULT_TENANT_ID,
      version: 3,
      is_active: true,
      personality_tone: 'Tone Khusus Versi 3',
      answering_hierarchy: 'Hierarchy Versi 3',
      negative_constraints: 'Constraints Versi 3',
      medical_overclaim_rules: 'Overclaim Versi 3',
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/persona/prompt-config',
      headers: {
        'x-api-key': ADMIN_KEY,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.isCustom).toBe(true);
    expect(body.source).toBe('active');
    expect(body.config.personalityTone).toBe('Tone Khusus Versi 3');
    expect(body.config.answeringHierarchy).toBe('Hierarchy Versi 3');
  });

  it('3. PUT /api/admin/persona/prompt-config validasi 4 field non-empty (400 bila ada yang kosong)', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/persona/prompt-config',
      headers: {
        'x-api-key': ADMIN_KEY,
      },
      payload: {
        personalityTone: 'Tone Ada',
        answeringHierarchy: ' ', // kosong
        negativeConstraints: 'Constraints Ada',
        medicalOverclaimRules: 'Rules Ada',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.error).toContain('answeringHierarchy is required');
  });

  it('4. PUT /api/admin/persona/prompt-config menyimpan versi baru dan mencatat audit log', async () => {
    const auditSpy = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined);
    const saveSpy = vi.spyOn(TenantPromptConfigService, 'saveNewVersion').mockResolvedValue(undefined);

    const app = buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/persona/prompt-config',
      headers: {
        'x-api-key': ADMIN_KEY,
      },
      payload: {
        personalityTone: 'Tone Bidan Senior Baru',
        answeringHierarchy: 'Hierarki Penjelasan Baru',
        negativeConstraints: 'Batasan 2-3 Kalimat Baru',
        medicalOverclaimRules: 'Klaim Suportif Baru',
        changeSummary: 'Uji update versi prompt lewat admin',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.message).toContain('berhasil disimpan');
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith(
      DEFAULT_TENANT_ID,
      {
        personalityTone: 'Tone Bidan Senior Baru',
        answeringHierarchy: 'Hierarki Penjelasan Baru',
        negativeConstraints: 'Batasan 2-3 Kalimat Baru',
        medicalOverclaimRules: 'Klaim Suportif Baru',
      },
      expect.any(String),
      'Uji update versi prompt lewat admin'
    );
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'BOT_PROMPT_CONFIG_CHANGE',
        targetId: DEFAULT_TENANT_ID,
      })
    );
  });
});
