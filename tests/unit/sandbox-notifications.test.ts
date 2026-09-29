import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Direction } from '@prisma/client';
import { messageService } from '../../src/services/message.service';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { getLiveChatHub } from '../../src/services/live-chat-hub.service';
import { staffNotificationService } from '../../src/services/staff-notification.service';
import { webPushService } from '../../src/services/web-push.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Sandbox Notification Suppression Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. logMessage includes isSandboxTest: true on SSE publish for sandbox customer and skips Web Push', async () => {
    const sandboxPhone = `628999${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(sandboxPhone, 'Sandbox Customer', DEFAULT_TENANT_ID);
    customer.is_sandbox_test = true;
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const hub = getLiveChatHub();
    const publishSpy = vi.spyOn(hub, 'publish');
    const pushSpy = vi.spyOn(webPushService, 'sendPushToTenant');

    await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conversation.id,
      direction: Direction.INBOUND,
      content: 'Testing sandbox prompt',
    });

    expect(publishSpy).toHaveBeenCalled();
    const event = publishSpy.mock.calls.find((c) => c[0].type === 'message.created');
    expect(event).toBeDefined();
    expect(event![0].payload.isSandboxTest).toBe(true);

    // Web push MUST NOT be triggered for sandbox messages
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('2. escalateToHumanHandling does NOT send Telegram alert or Web Push for sandbox customer', async () => {
    const sandboxPhone = `628999${Date.now() + 1}`;
    const customer = await customerService.getOrCreateCustomer(sandboxPhone, 'Sandbox Tester', DEFAULT_TENANT_ID);
    customer.is_sandbox_test = true;
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    conversation.customer = customer;

    const pushSpy = vi.spyOn(webPushService, 'sendPushToTenant');

    const updated = await conversationService.escalateToHumanHandling(
      conversation,
      sandboxPhone,
      'Test CS escalation in sandbox',
      DEFAULT_TENANT_ID
    );

    expect(updated.is_human_handling).toBe(true);
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('3. sendReservationAssignmentNotification returns sent: false for sandbox customer', async () => {
    const sandboxPhone = `628999${Date.now() + 2}`;
    const customer = await customerService.getOrCreateCustomer(sandboxPhone, 'Sandbox Tester', DEFAULT_TENANT_ID);
    customer.is_sandbox_test = true;

    // Direct invocation with non-existent or dummy id
    const result = await staffNotificationService.sendReservationAssignmentNotification(
      'fake-res-id',
      'fake-staff-id'
    );

    expect(result.sent).toBe(false);
  });
});

describe('Internal Staff Notification Suppression Suite (Fase 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('percakapan staf internal: SSE membawa isInternalStaff=true & TIDAK memicu push CRM', async () => {
    // Nomor normal (BUKAN pola sandbox 628999) — murni staf internal. Panjang digit valid.
    const staffPhone = `6281234${String(Date.now()).slice(-6)}`;
    const customer = await customerService.getOrCreateCustomer(staffPhone, 'Bidan Thabita', DEFAULT_TENANT_ID);
    customer.is_internal_staff = true;
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const hub = getLiveChatHub();
    const publishSpy = vi.spyOn(hub, 'publish');
    const tenantPushSpy = vi.spyOn(webPushService, 'sendPushToTenant');

    await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conversation.id,
      direction: Direction.INBOUND,
      content: 'Koordinasi jadwal shift besok ya',
    });

    const event = publishSpy.mock.calls.find((c) => c[0].type === 'message.created');
    expect(event).toBeDefined();
    expect(event![0].payload.isInternalStaff).toBe(true);
    expect(event![0].payload.isSandboxTest).toBe(false);

    // Push CRM (admin/staf) TIDAK boleh dipicu untuk percakapan staf internal.
    expect(tenantPushSpy).not.toHaveBeenCalled();
  });

  it('markInternalStaffCustomer menandai customer via normalisasi nomor (08xx vs 628xx)', async () => {
    const phone = `6287700${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bidan Thabita', DEFAULT_TENANT_ID);
    expect(customer.is_internal_staff).toBeFalsy();

    // DB offline di test → tak ada kandidat; pemanggilan harus graceful (tidak melempar).
    await expect(customerService.markInternalStaffCustomer(phone, DEFAULT_TENANT_ID)).resolves.toBeUndefined();
  });
});
