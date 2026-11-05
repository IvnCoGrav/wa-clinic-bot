/**
 * Fase 4 — Follow-up sadar tahap ibu.
 *
 * Kontrak:
 *  1. MOMS tidak pernah menerima narasi bayi / placeholder {babyName}.
 *  2. Narasi mengikuti tahap: hamil / nifas / menyusui.
 *  3. Prospek IBU yang belum reservasi memakai keluarga NO_PURCHASE_MOMS_*.
 *  4. Anti-regresi: kategori anak tetap memakai keluarga NO_PURCHASE_*.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { followUpService } from '../../src/services/follow-up.service';
import { getRollingFollowUpMessage } from '../../src/config/followup-templates';
import { isMomsFollowUpTemplateType, findForbiddenPlaceholders } from '../../src/utils/followup-placeholder';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

const makeFu = (overrides: any = {}): any => ({
  id: 'fu-mom-stage-1',
  tenant_id: DEFAULT_TENANT_ID,
  customer_id: 'cust-mom-stage-1',
  type: 'NO_PURCHASE',
  stage: 1,
  scheduled_at: new Date(Date.now() - 1000),
  status: 'QUEUED',
  customer: {
    id: 'cust-mom-stage-1',
    name: 'Rina',
    phone: '6281252901109',
    children: [],
    labels: [],
    conversations: [],
  },
  ...overrides,
});

async function runAndCapture(fu: any): Promise<{ text: string; templateLookupTypes: string[] }> {
  const { whatsappProviderService } = await import('../../src/services/whatsapp-provider.service');
  vi.spyOn(whatsappProviderService, 'isOutboundCutOff').mockResolvedValue(false as any);
  vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null as any);
  vi.spyOn(prisma.followUp, 'updateMany').mockResolvedValue({ count: 1 } as any);
  vi.spyOn(prisma.followUp, 'findUnique').mockResolvedValue({ status: 'QUEUED', scheduled_at: new Date() } as any);
  vi.spyOn(prisma.followUp, 'update').mockResolvedValue({} as any);
  const tplSpy = vi.spyOn(prisma.followUpTemplate, 'findFirst').mockResolvedValue(null as any);

  const { typingService } = await import('../../src/services/typing.service');
  const sendSpy = vi.spyOn(typingService, 'simulateHumanReply').mockResolvedValue({ success: true } as any);

  const ok = await followUpService.executeFollowUp(fu, DEFAULT_TENANT_ID);
  expect(ok).toBe(true);
  expect(sendSpy).toHaveBeenCalledTimes(1);

  return {
    text: String((sendSpy.mock.calls[0][0] as any).replyText || ''),
    templateLookupTypes: tplSpy.mock.calls.map((c: any) => String(c[0]?.where?.type || '')),
  };
}

describe('Fase 4 — follow-up maternal stage', () => {
  beforeEach(() => {
    process.env.HUMANIZER_ENABLED = 'false';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env.HUMANIZER_ENABLED;
  });

  it('template NEXT_TREATMENT_MOMS memakai narasi kehamilan, tanpa narasi bayi', () => {
    const { text } = getRollingFollowUpMessage('NEXT_TREATMENT_MOMS_1', {
      name: 'Rina',
      momStage: 'PREGNANT',
      index: 0,
    });
    expect(text).toContain('kehamilan');
    expect(text).not.toMatch(/si kecil/i);
    expect(text).not.toMatch(/tumbuh kembang/i);
    expect(findForbiddenPlaceholders('NEXT_TREATMENT_MOMS_1', text)).toEqual([]);
  });

  it('template MOMS memakai narasi nifas untuk POSTPARTUM', () => {
    const { text } = getRollingFollowUpMessage('NEXT_TREATMENT_MOMS_2', {
      name: 'Rina',
      momStage: 'POSTPARTUM',
      index: 0,
    });
    expect(text).toContain('nifas');
  });

  it('keluarga NO_PURCHASE_MOMS diakui sebagai MOMS dan bebas placeholder bayi', () => {
    const type = 'NO_PURCHASE_MOMS_1';
    expect(isMomsFollowUpTemplateType(type)).toBe(true);
    const { text } = getRollingFollowUpMessage(type, { name: 'Rina', momStage: 'LACTATING', index: 0 });
    expect(text).toContain('menyusui');
    expect(findForbiddenPlaceholders(type, text)).toEqual([]);
  });

  it('prospek MOMS tanpa reservasi → NO_PURCHASE_MOMS_1 (bukan NO_PURCHASE_1)', async () => {
    const { text, templateLookupTypes } = await runAndCapture(
      makeFu({ treatment_category: 'MOMS', mom_stage: 'PREGNANT' })
    );
    expect(templateLookupTypes).toContain('NO_PURCHASE_MOMS_1');
    expect(templateLookupTypes).not.toContain('NO_PURCHASE_1');
    expect(text).not.toMatch(/si kecil/i);
  });

  it('anti-regresi: prospek anak → NO_PURCHASE_1', async () => {
    const { templateLookupTypes } = await runAndCapture(
      makeFu({ treatment_category: 'BABY' })
    );
    expect(templateLookupTypes).toContain('NO_PURCHASE_1');
    expect(templateLookupTypes).not.toContain('NO_PURCHASE_MOMS_1');
  });
});
