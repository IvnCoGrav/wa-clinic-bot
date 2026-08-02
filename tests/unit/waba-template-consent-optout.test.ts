import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { wabaTemplateService } from '../../src/services/waba-template.service';
import { wabaConsentService } from '../../src/services/waba-consent.service';
import { wabaOptOutService } from '../../src/services/waba-optout.service';
import { prisma } from '../../src/db/client';

vi.mock('../../src/db/client', () => ({
  prisma: {
    wabaTemplate: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    customer: {
      update: vi.fn(),
    },
    followUp: {
      updateMany: vi.fn(),
    },
  },
}));

describe('WABA Template Service (Fase 4)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('getTemplateMapping returns DB row when present', async () => {
    vi.mocked(prisma.wabaTemplate.findUnique).mockResolvedValueOnce({
      id: 't1',
      tenant_id: 'tenant_x',
      type: 'NO_PURCHASE_1',
      variant: 1,
      template_name: 'kala_followup_no_purchase_v1',
      category: 'MARKETING',
      language_code: 'id',
      status: 'APPROVED',
      is_active: true,
    } as any);

    const mapping = await wabaTemplateService.getTemplateMapping('tenant_x', 'NO_PURCHASE_1', 1);
    expect(mapping.templateName).toBe('kala_followup_no_purchase_v1');
    expect(mapping.category).toBe('MARKETING');
    expect(mapping.status).toBe('APPROVED');
    expect(mapping.isActive).toBe(true);
  });

  it('getTemplateMapping falls back to default when DB has no row', async () => {
    vi.mocked(prisma.wabaTemplate.findUnique).mockResolvedValueOnce(null);

    const mapping = await wabaTemplateService.getTemplateMapping('tenant_x', 'NO_PURCHASE_2', 2);
    expect(mapping.templateName).toBe('followup_no_purchase_2');
    expect(mapping.category).toBe('MARKETING');
  });

  it('getTemplateMapping falls back safely when DB throws', async () => {
    vi.mocked(prisma.wabaTemplate.findUnique).mockRejectedValueOnce(new Error('DB offline'));

    const mapping = await wabaTemplateService.getTemplateMapping('tenant_x', 'REMINDER_H0', 1);
    expect(mapping.templateName).toBe('reminder_treatment');
    expect(mapping.category).toBe('UTILITY');
  });

  it('saveTemplateMapping upserts per tenant', async () => {
    vi.mocked(prisma.wabaTemplate.upsert).mockResolvedValueOnce({} as any);
    await wabaTemplateService.saveTemplateMapping('tenant_x', 'NO_PURCHASE_1', 1, {
      templateName: 'kala_followup_1',
      category: 'MARKETING',
    });
    expect(prisma.wabaTemplate.upsert).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(prisma.wabaTemplate.upsert).mock.calls[0][0] as any;
    expect(arg.where.tenant_id_type_variant).toEqual({ tenant_id: 'tenant_x', type: 'NO_PURCHASE_1', variant: 1 });
  });

  it('isUsable only allows APPROVED + active', () => {
    expect(wabaTemplateService.isUsable({ templateName: 'x', category: 'MARKETING', languageCode: 'id', status: 'APPROVED', isActive: true })).toBe(true);
    expect(wabaTemplateService.isUsable({ templateName: 'x', category: 'MARKETING', languageCode: 'id', status: 'PENDING', isActive: true })).toBe(false);
    expect(wabaTemplateService.isUsable({ templateName: 'x', category: 'MARKETING', languageCode: 'id', status: 'REJECTED', isActive: true })).toBe(false);
    expect(wabaTemplateService.isUsable({ templateName: 'x', category: 'MARKETING', languageCode: 'id', status: 'APPROVED', isActive: false })).toBe(false);
  });

  it('buildBodyComponents maps params in order name, time, treatment, baby', () => {
    const components = wabaTemplateService.buildBodyComponents({
      name: 'Sari',
      time: '10:00',
      treatmentName: 'Pijat Bayi',
      babyName: 'Alya',
    });
    expect(components).toHaveLength(1);
    expect(components[0].type).toBe('body');
    expect(components[0].parameters.map((p) => p.value)).toEqual(['Sari', '10:00', 'Pijat Bayi', 'Alya']);
  });

  it('buildBodyComponents returns empty when no params', () => {
    expect(wabaTemplateService.buildBodyComponents({})).toEqual([]);
  });
});

describe('WABA Consent Service (Fase 4)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('classifies NO_PURCHASE / NEXT_TREATMENT as MARKETING', () => {
    expect(wabaConsentService.getTemplateCategory('NO_PURCHASE_1')).toBe('MARKETING');
    expect(wabaConsentService.getTemplateCategory('NO_PURCHASE_3')).toBe('MARKETING');
    expect(wabaConsentService.getTemplateCategory('NEXT_TREATMENT_2')).toBe('MARKETING');
  });

  it('classifies REMINDER / REVIEW as UTILITY', () => {
    expect(wabaConsentService.getTemplateCategory('REMINDER_H0')).toBe('UTILITY');
    expect(wabaConsentService.getTemplateCategory('REVIEW_H1_BABY')).toBe('UTILITY');
    expect(wabaConsentService.getTemplateCategory('REVIEW_H1_MOMS')).toBe('UTILITY');
  });

  it('canSendMarketing allows when opted in', async () => {
    const result = await wabaConsentService.canSendMarketing({ id: 'c1', marketing_opt_in: true });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('OPTED_IN');
  });

  it('canSendMarketing blocks when not opted in', async () => {
    const result = await wabaConsentService.canSendMarketing({ id: 'c1', marketing_opt_in: false });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('NO_OPT_IN');
  });

  it('recordOptIn writes opt-in trail', async () => {
    vi.mocked(prisma.customer.update).mockResolvedValueOnce({} as any);
    await wabaConsentService.recordOptIn('c1', 'CHAT_PROMPT', 'tenant_x');
    const arg = vi.mocked(prisma.customer.update).mock.calls[0][0] as any;
    expect(arg.data.marketing_opt_in).toBe(true);
    expect(arg.data.marketing_opt_in_source).toBe('CHAT_PROMPT');
  });
});

describe('WABA Opt-Out Service (Fase 4)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('detects STOP keyword', () => {
    expect(wabaOptOutService.isOptOutMessage('STOP')).toEqual({ matched: true, keyword: 'STOP' });
  });

  it('detects UNSUBSCRIBE / BERHENTI / BATAL PROMO', () => {
    expect(wabaOptOutService.isOptOutMessage('UNSUBSCRIBE').matched).toBe(true);
    expect(wabaOptOutService.isOptOutMessage('BERHENTI').matched).toBe(true);
    expect(wabaOptOutService.isOptOutMessage('BATAL PROMO').matched).toBe(true);
  });

  it('detects prefix keywords like STOP PROMO / BERHENTI SEMUA', () => {
    expect(wabaOptOutService.isOptOutMessage('STOP PROMO').matched).toBe(true);
    expect(wabaOptOutService.isOptOutMessage('berhenti semua promo').matched).toBe(true);
    expect(wabaOptOutService.isOptOutMessage('BATAL PROMO sekarang').matched).toBe(true);
  });

  it('does not match normal conversation text', () => {
    expect(wabaOptOutService.isOptOutMessage('Halo, berapa harga pijat?').matched).toBe(false);
    expect(wabaOptOutService.isOptOutMessage('STOOP').matched).toBe(false);
    expect(wabaOptOutService.isOptOutMessage('Berhenti dulu ya bund').matched).toBe(false);
    expect(wabaOptOutService.isOptOutMessage('').matched).toBe(false);
    expect(wabaOptOutService.isOptOutMessage(null).matched).toBe(false);
  });

  it('handleOptOut sets opt-in false and cancels scheduled follow-ups', async () => {
    vi.mocked(prisma.customer.update).mockResolvedValueOnce({} as any);
    vi.mocked(prisma.followUp.updateMany).mockResolvedValueOnce({ count: 3 } as any);

    const result = await wabaOptOutService.handleOptOut('c1', 'tenant_x');
    expect(result.cancelledFollowUps).toBe(3);

    const customerArg = vi.mocked(prisma.customer.update).mock.calls[0][0] as any;
    expect(customerArg.data.marketing_opt_in).toBe(false);

    const followUpArg = vi.mocked(prisma.followUp.updateMany).mock.calls[0][0] as any;
    expect(followUpArg.where.customer_id).toBe('c1');
    expect(followUpArg.where.tenant_id).toBe('tenant_x');
    expect(followUpArg.where.status).toEqual({ in: ['PENDING', 'QUEUED'] });
    expect(followUpArg.data.status).toBe('CANCELLED');
  });

  it('getAckMessage returns non-empty confirmation', () => {
    expect(wabaOptOutService.getAckMessage().length).toBeGreaterThan(10);
  });
});
