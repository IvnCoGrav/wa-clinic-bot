import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPersonaPrompt, savePersonaToDb, loadPersonaFromDb, TEMPLATES } from '../../src/config/persona';
import { prisma } from '../../src/db/client';

describe('CFG-03 & CFG-08: Persona Multi-Tenant Isolation & Template Hygiene', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('CFG-03: saves and retrieves different personas for different tenants', async () => {
    vi.mocked(prisma.tenantPersona.upsert).mockResolvedValue({} as any);

    await savePersonaToDb('Persona Klinik Alpha (Surabaya)', 'tenant_alpha');
    await savePersonaToDb('Persona Klinik Beta (Sidoarjo)', 'tenant_beta');

    expect(getPersonaPrompt('tenant_alpha')).toBe('Persona Klinik Alpha (Surabaya)');
    expect(getPersonaPrompt('tenant_beta')).toBe('Persona Klinik Beta (Sidoarjo)');
  });

  it('CFG-03: loads persona from DB for specified tenant without bleeding into other tenants', async () => {
    vi.mocked(prisma.tenantPersona.findUnique).mockImplementation(async ({ where }: any) => {
      if (where.tenant_id === 'tenant_gammaspa') {
        return {
          id: 'tp_1',
          tenant_id: 'tenant_gammaspa',
          persona: 'Klinik Gamma Persona Khusus',
          max_chars_per_reply: 250,
          created_at: new Date(),
          updated_at: new Date(),
        } as any;
      }
      return null;
    });

    const gammaPersona = await loadPersonaFromDb('tenant_gammaspa');
    expect(gammaPersona).toBe('Klinik Gamma Persona Khusus');
    expect(getPersonaPrompt('tenant_gammaspa')).toBe('Klinik Gamma Persona Khusus');

    // Tenant yang berbeda tidak terpengaruh oleh load tenant_gammaspa
    expect(getPersonaPrompt('tenant_other_unloaded')).not.toBe('Klinik Gamma Persona Khusus');
  });

  it('CFG-08: active operational templates exist and work properly', () => {
    expect(typeof TEMPLATES.askDomicileNeutral).toBe('function');
    expect(typeof TEMPLATES.greeting).toBe('function');
    expect(typeof TEMPLATES.ongkirInfo).toBe('function');
    expect(typeof TEMPLATES.inCoverageNoFee).toBe('function');
    expect(typeof TEMPLATES.outOfCoverage).toBe('function');
    expect(typeof TEMPLATES.priceInfo).toBe('function');
    expect(typeof TEMPLATES.askShareLocation).toBe('function');
    expect(typeof TEMPLATES.reservationConfirmed).toBe('function');

    // Verifikasi bahwa deprecated templates telah dibersihkan
    expect((TEMPLATES as any).morningReminder).toBeUndefined();
    expect((TEMPLATES as any).followUpReviewBaby).toBeUndefined();
    expect((TEMPLATES as any).followUpNoPurchaseDay3).toBeUndefined();
  });
});
