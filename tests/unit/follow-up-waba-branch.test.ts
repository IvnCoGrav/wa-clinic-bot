import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { followUpService } from '../../src/services/follow-up.service';
import { resolveGatewayForTenant, resetGateway, createTestGateway } from '../../src/integrations/whatsapp/factory';
import { prisma } from '../../src/db/client';
import { WabaGatewayDriver } from '../../src/integrations/whatsapp/waba.driver';

vi.mock('../../src/db/client', () => ({
  prisma: {
    followUp: {
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    followUpTemplate: {
      findFirst: vi.fn(),
    },
    reservation: {
      update: vi.fn(),
      findFirst: vi.fn(),
    },
    customer: {
      update: vi.fn(),
    },
    wabaTemplate: {
      findUnique: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../src/services/typing.service', () => ({
  typingService: {
    simulateHumanReply: vi.fn().mockResolvedValue({ success: true, bubblesSent: 1 }),
  },
}));

function makeWabaGateway(mockSendTemplate: ReturnType<typeof vi.fn>) {
  return {
    providerType: 'WABA',
    sendTemplateMessage: mockSendTemplate,
    sendTextMessage: vi.fn().mockResolvedValue({ success: true, provider: 'WABA' }),
    sendImageMessage: vi.fn(),
    sendTypingIndicator: vi.fn(),
    markAsRead: vi.fn(),
  } as any;
}

function makeFollowUp(overrides: any = {}) {
  return {
    id: 'fu_1',
    tenant_id: 'tenant_waba',
    customer_id: 'cust_1',
    type: 'NO_PURCHASE',
    stage: 1,
    status: 'PENDING',
    customer: {
      id: 'cust_1',
      phone: '6287751148065',
      name: 'Sari',
      marketing_opt_in: true,
      status: 'active',
      tenant_id: 'tenant_waba',
    },
    ...overrides,
  };
}

describe('Follow-Up WABA Branch (Fase 4)', () => {
  beforeEach(() => {
    resetGateway();
    process.env.NODE_ENV = 'test';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetGateway();
    vi.clearAllMocks();
  });

  it('sends HSM template via WABA when opted-in', async () => {
    const sendTemplate = vi.fn().mockResolvedValue({ success: true, provider: 'WABA', messageId: 'waba_msg' });
    createTestGateway(makeWabaGateway(sendTemplate), 'tenant_waba');

    vi.mocked(prisma.wabaTemplate.findUnique).mockResolvedValueOnce({
      id: 't1', tenant_id: 'tenant_waba', type: 'NO_PURCHASE_1', variant: 1,
      template_name: 'kala_followup_no_purchase_1', category: 'MARKETING',
      language_code: 'id', status: 'APPROVED', is_active: true,
    } as any);
    vi.mocked(prisma.followUp.update).mockResolvedValueOnce({} as any);

    const ok = await followUpService.executeFollowUp(makeFollowUp(), 'tenant_waba');
    expect(ok).toBe(true);
    expect(sendTemplate).toHaveBeenCalledTimes(1);
    const [to, templateName, lang, components] = sendTemplate.mock.calls[0];
    expect(to).toBe('6287751148065');
    expect(templateName).toBe('kala_followup_no_purchase_1');
    expect(lang).toBe('id');
    expect(components[0].parameters[0].value).toBe('Sari');
  });

  it('skips MARKETING HSM when customer not opted-in (SKIPPED / NO_OPT_IN)', async () => {
    const sendTemplate = vi.fn();
    createTestGateway(makeWabaGateway(sendTemplate), 'tenant_waba');

    vi.mocked(prisma.wabaTemplate.findUnique).mockResolvedValueOnce({
      id: 't1', tenant_id: 'tenant_waba', type: 'NO_PURCHASE_1', variant: 1,
      template_name: 'kala_followup_no_purchase_1', category: 'MARKETING',
      language_code: 'id', status: 'APPROVED', is_active: true,
    } as any);
    vi.mocked(prisma.followUp.update).mockResolvedValueOnce({} as any);

    const fu = makeFollowUp({ customer: { id: 'cust_1', phone: '6287751148065', name: 'Sari', marketing_opt_in: false, status: 'active', tenant_id: 'tenant_waba' } });
    const ok = await followUpService.executeFollowUp(fu, 'tenant_waba');

    expect(ok).toBe(false);
    expect(sendTemplate).not.toHaveBeenCalled();
    const updateArg = vi.mocked(prisma.followUp.update).mock.calls[0][0] as any;
    expect(updateArg.data.status).toBe('SKIPPED');
  });

  it('skips when template status is not APPROVED (SKIPPED / NOT_APPROVED)', async () => {
    const sendTemplate = vi.fn();
    createTestGateway(makeWabaGateway(sendTemplate), 'tenant_waba');

    vi.mocked(prisma.wabaTemplate.findUnique).mockResolvedValueOnce({
      id: 't1', tenant_id: 'tenant_waba', type: 'NO_PURCHASE_1', variant: 1,
      template_name: 'kala_followup_no_purchase_1', category: 'MARKETING',
      language_code: 'id', status: 'PENDING', is_active: true,
    } as any);
    vi.mocked(prisma.followUp.update).mockResolvedValueOnce({} as any);

    const ok = await followUpService.executeFollowUp(makeFollowUp(), 'tenant_waba');
    expect(ok).toBe(false);
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('marks FAILED when HSM send fails', async () => {
    const sendTemplate = vi.fn().mockResolvedValue({ success: false, provider: 'WABA', error: { code: '131026', message: 'outside window' } });
    createTestGateway(makeWabaGateway(sendTemplate), 'tenant_waba');

    vi.mocked(prisma.wabaTemplate.findUnique).mockResolvedValueOnce({
      id: 't1', tenant_id: 'tenant_waba', type: 'NO_PURCHASE_1', variant: 1,
      template_name: 'kala_followup_no_purchase_1', category: 'MARKETING',
      language_code: 'id', status: 'APPROVED', is_active: true,
    } as any);
    vi.mocked(prisma.followUp.update).mockResolvedValueOnce({} as any);

    const ok = await followUpService.executeFollowUp(makeFollowUp(), 'tenant_waba');
    expect(ok).toBe(false);
    const updateArg = vi.mocked(prisma.followUp.update).mock.calls[0][0] as any;
    expect(updateArg.data.status).toBe('FAILED');
  });

  it('UTILITY-category template sends without opt-in requirement', async () => {
    const sendTemplate = vi.fn().mockResolvedValue({ success: true, provider: 'WABA', messageId: 'waba_msg' });
    createTestGateway(makeWabaGateway(sendTemplate), 'tenant_waba');

    // Realistic: follow-up type NO_PURCHASE_1, but tenant maps it to a UTILITY template
    vi.mocked(prisma.wabaTemplate.findUnique).mockResolvedValueOnce({
      id: 't2', tenant_id: 'tenant_waba', type: 'NO_PURCHASE_1', variant: 1,
      template_name: 'reminder_treatment', category: 'UTILITY',
      language_code: 'id', status: 'APPROVED', is_active: true,
    } as any);
    vi.mocked(prisma.followUp.update).mockResolvedValueOnce({} as any);

    const fu = makeFollowUp({
      type: 'NO_PURCHASE',
      stage: 1,
      customer: { id: 'cust_1', phone: '6287751148065', name: 'Sari', marketing_opt_in: false, status: 'active', tenant_id: 'tenant_waba' },
    });
    const ok = await followUpService.executeFollowUp(fu, 'tenant_waba');
    expect(ok).toBe(true);
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });
});
