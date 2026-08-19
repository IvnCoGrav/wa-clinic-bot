import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Direction } from '@prisma/client';
import { liveChatService } from '../../src/services/live-chat.service';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { messageService } from '../../src/services/message.service';
import { createTestGateway, resetGateway } from '../../src/integrations/whatsapp/factory';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

function makeFakeGateway(provider: 'WAHA' | 'WABA' = 'WAHA') {
  return {
    providerType: provider,
    sendTextMessage: vi.fn().mockResolvedValue({ success: true, messageId: `waid_${Math.random().toString(36).slice(2)}`, provider }),
    sendTemplateMessage: vi.fn().mockResolvedValue({ success: true, provider }),
    sendImageMessage: vi.fn().mockResolvedValue({ success: true, provider }),
    sendTypingIndicator: vi.fn().mockResolvedValue(undefined),
    markAsRead: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe('LiveChatService — monitor & balas admin', () => {
  beforeEach(() => {
    // CATATAN: JANGAN pakai vi.restoreAllMocks() — akan me-reset mock Prisma global (setup.ts)
    resetGateway();
  });

  it('getConversationList offline: menampilkan percakapan + preview pesan dengan sender_type', async () => {
    const phone = `628100${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Test', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conversation.id,
      direction: Direction.INBOUND,
      content: 'Halo',
    });
    await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conversation.id,
      direction: Direction.OUTBOUND,
      content: 'Balasan admin',
      senderType: 'ADMIN',
      senderName: 'Admin Klinik',
    });

    const { items: list, hasMore } = await liveChatService.getConversationList(DEFAULT_TENANT_ID);
    const item = list.find((c) => c.conversationId === conversation.id);
    expect(item).toBeTruthy();
    expect(item!.customerPhone).toBe(phone);
    expect(item!.lastMessages.length).toBe(2);
    expect(item!.lastMessages[1].sender_type).toBe('ADMIN');
    expect(item!.lastMessages[1].sender_name).toBe('Admin Klinik');
  });

  it('getConversationList: paging offset tidak mengembalikan item halaman sebelumnya', async () => {
    // Buat 2 percakapan dengan timestamp berbeda untuk memastikan urutan stable
    const phoneA = `628700${Date.now()}`;
    const phoneB = `628710${Date.now()}`;
    const customerA = await customerService.getOrCreateCustomer(phoneA, 'Bunda A', DEFAULT_TENANT_ID);
    const convA = await conversationService.getOrCreateConversation(customerA.id, DEFAULT_TENANT_ID);
    const customerB = await customerService.getOrCreateCustomer(phoneB, 'Bunda B', DEFAULT_TENANT_ID);
    const convB = await conversationService.getOrCreateConversation(customerB.id, DEFAULT_TENANT_ID);

    await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: convA.id,
      direction: Direction.INBOUND,
      content: 'Halo A',
    });
    await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: convB.id,
      direction: Direction.INBOUND,
      content: 'Halo B',
    });

    const page1 = await liveChatService.getConversationList(DEFAULT_TENANT_ID, 1, 0);
    expect(page1.items.length).toBe(1);
    const page2 = await liveChatService.getConversationList(DEFAULT_TENANT_ID, 1, 1);
    expect(page2.items.length).toBe(1);
    // Halaman 1 dan 2 tidak boleh tumpang tindih
    expect(page1.items[0].conversationId).not.toBe(page2.items[0].conversationId);
  });

  it('sendAdminReply: kirim via gateway + auto-escalation ke HUMAN_HANDLING + log sender ADMIN', async () => {
    const fake = makeFakeGateway('WAHA');
    createTestGateway(fake, DEFAULT_TENANT_ID);

    const phone = `628200${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Auto', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const result = await liveChatService.sendAdminReply({
      conversationId: conversation.id,
      text: 'Baik Bunda, kami proses ya',
      tenantId: DEFAULT_TENANT_ID,
      adminName: 'Admin Klinik',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    expect(fake.sendTextMessage).toHaveBeenCalledWith(phone, 'Baik Bunda, kami proses ya');

    const updated = await conversationService.getConversationById(conversation.id, DEFAULT_TENANT_ID);
    expect(updated.is_human_handling).toBe(true);
    expect(updated.escalation_reason).toBe('manual_reply');

    const messages = await liveChatService.getConversationMessages(conversation.id, DEFAULT_TENANT_ID);
    expect(messages.some((m) => m.sender_type === 'ADMIN' && m.content === 'Baik Bunda, kami proses ya')).toBe(true);
  });

  it('getConversationList: mode memisahkan sandbox/test vs WhatsApp asli', async () => {
    const phoneReal = `628800${Date.now()}`;
    const phoneSand = `628900${Date.now()}`;
    const customerReal = await customerService.getOrCreateCustomer(phoneReal, 'Bunda Real', DEFAULT_TENANT_ID);
    const convReal = await conversationService.getOrCreateConversation(customerReal.id, DEFAULT_TENANT_ID);
    const customerSand = await customerService.getOrCreateCustomer(phoneSand, 'Bunda Sandbox', DEFAULT_TENANT_ID);
    customerSand.is_sandbox_test = true; // memory store fallback (DB offline di test)
    const convSand = await conversationService.getOrCreateConversation(customerSand.id, DEFAULT_TENANT_ID);

    await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: convReal.id,
      direction: Direction.INBOUND,
      content: 'Halo asli',
    });
    await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: convSand.id,
      direction: Direction.INBOUND,
      content: 'Halo test',
    });

    const all = await liveChatService.getConversationList(DEFAULT_TENANT_ID, 50, 0, 'all');
    expect(all.items.some((c) => c.conversationId === convReal.id)).toBe(true);
    expect(all.items.some((c) => c.conversationId === convSand.id)).toBe(true);

    const real = await liveChatService.getConversationList(DEFAULT_TENANT_ID, 50, 0, 'real');
    expect(real.items.some((c) => c.conversationId === convReal.id)).toBe(true);
    expect(real.items.some((c) => c.conversationId === convSand.id)).toBe(false);

    const sandbox = await liveChatService.getConversationList(DEFAULT_TENANT_ID, 50, 0, 'sandbox');
    expect(sandbox.items.some((c) => c.conversationId === convSand.id)).toBe(true);
    expect(sandbox.items.some((c) => c.conversationId === convReal.id)).toBe(false);
    expect(sandbox.items.find((c) => c.conversationId === convSand.id)?.isSandboxTest).toBe(true);
  });

  it('sendAdminReply: chat sandbox/test → SANDBOX_REPLY_BLOCKED tanpa memanggil gateway', async () => {
    const fake = makeFakeGateway('WAHA');
    createTestGateway(fake, DEFAULT_TENANT_ID);

    const customer = await customerService.getOrCreateCustomer(`628910${Date.now()}`, 'Bunda Sandbox Reply', DEFAULT_TENANT_ID);
    customer.is_sandbox_test = true;
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const result = await liveChatService.sendAdminReply({
      conversationId: conversation.id,
      text: 'Halo test',
      tenantId: DEFAULT_TENANT_ID,
      adminName: 'Admin',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SANDBOX_REPLY_BLOCKED');
    expect(fake.sendTextMessage).not.toHaveBeenCalled();
  });

  it('sendAdminReply: text kosong → EMPTY_REPLY tanpa memanggil gateway', async () => {
    const fake = makeFakeGateway('WAHA');
    createTestGateway(fake, DEFAULT_TENANT_ID);

    const customer = await customerService.getOrCreateCustomer(`628300${Date.now()}`, 'Bunda Empty', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const result = await liveChatService.sendAdminReply({
      conversationId: conversation.id,
      text: '   ',
      tenantId: DEFAULT_TENANT_ID,
    });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('EMPTY_REPLY');
    expect(fake.sendTextMessage).not.toHaveBeenCalled();
  });

  it('sendAdminReply WABA: di luar 24h window → WABA_OUTSIDE_WINDOW; dengan acknowledge → terkirim', async () => {
    const fake = makeFakeGateway('WABA');
    createTestGateway(fake, DEFAULT_TENANT_ID);

    const customer = await customerService.getOrCreateCustomer(`628400${Date.now()}`, 'Bunda Waba', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const spied = vi
      .spyOn(liveChatService as any, 'getLastInboundAt')
      .mockResolvedValue(new Date(Date.now() - 25 * 60 * 60 * 1000));

    const blocked = await liveChatService.sendAdminReply({
      conversationId: conversation.id,
      text: 'Test',
      tenantId: DEFAULT_TENANT_ID,
    });
    expect(blocked.success).toBe(false);
    expect(blocked.error?.code).toBe('WABA_OUTSIDE_WINDOW');
    expect(fake.sendTextMessage).not.toHaveBeenCalled();

    const ack = await liveChatService.sendAdminReply({
      conversationId: conversation.id,
      text: 'Test Ack',
      tenantId: DEFAULT_TENANT_ID,
      acknowledgeOutsideWindow: true,
    });
    expect(ack.success).toBe(true);
    expect(fake.sendTextMessage).toHaveBeenCalled();

    spied.mockRestore();
  });

  it('sendAdminReply: conversation tidak ditemukan → CONVERSATION_NOT_FOUND', async () => {
    const result = await liveChatService.sendAdminReply({
      conversationId: 'conv_tidak_ada_xyz',
      text: 'Halo',
      tenantId: DEFAULT_TENANT_ID,
    });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CONVERSATION_NOT_FOUND');
  });

  it('sendAdminReply gambar (WAHA): menyimpan file & memanggil sendImageMessage dengan path lokal', async () => {
    const fake = makeFakeGateway('WAHA');
    createTestGateway(fake, DEFAULT_TENANT_ID);

    const customer = await customerService.getOrCreateCustomer(`628500${Date.now()}`, 'Bunda Image', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    // PNG 1x1 transparan base64 valid
    const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    const result = await liveChatService.sendAdminReply({
      conversationId: conversation.id,
      text: 'Ini gambar pricelist',
      imageB64: pngB64,
      thumbB64: pngB64,
      mimeType: 'image/png',
      tenantId: DEFAULT_TENANT_ID,
      adminName: 'Admin Klinik',
    });

    expect(result.success).toBe(true);
    expect(fake.sendImageMessage).toHaveBeenCalledTimes(1);
    const [sentPhone, sentTarget, sentCaption] = fake.sendImageMessage.mock.calls[0];
    expect(sentPhone).toBe(customer.phone);
    expect(sentCaption).toBe('Ini gambar pricelist');
    // WAHA → target berupa absolute path file lokal di storage/media/outbound
    expect(String(sentTarget)).toMatch(/storage[\\/]media[\\/]outbound/);

    const messages = await liveChatService.getConversationMessages(conversation.id, DEFAULT_TENANT_ID);
    const logged = messages.find((m) => m.sender_type === 'ADMIN' && m.content === 'Ini gambar pricelist');
    expect(logged).toBeTruthy();
    expect(logged.payload_raw?.media?.hdUrl).toContain('/media/outbound/');
    expect(logged.payload_raw?.media?.caption).toBe('Ini gambar pricelist');
  });

  it('sendAdminReply gambar (WABA): tanpa PUBLIC_BASE_URL → MEDIA_PUBLIC_URL_REQUIRED', async () => {
    delete process.env.PUBLIC_BASE_URL;
    const fake = makeFakeGateway('WABA');
    createTestGateway(fake, DEFAULT_TENANT_ID);

    const customer = await customerService.getOrCreateCustomer(`628510${Date.now()}`, 'Bunda WabaImg', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const result = await liveChatService.sendAdminReply({
      conversationId: conversation.id,
      imageB64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      tenantId: DEFAULT_TENANT_ID,
    });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('MEDIA_PUBLIC_URL_REQUIRED');
    expect(fake.sendImageMessage).not.toHaveBeenCalled();
  });

  it('sendAdminReply gambar (WABA): dengan PUBLIC_BASE_URL → kirim lewat URL publik', async () => {
    const prev = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = 'https://bot.example.com';
    const fake = makeFakeGateway('WABA');
    createTestGateway(fake, DEFAULT_TENANT_ID);

    const customer = await customerService.getOrCreateCustomer(`628520${Date.now()}`, 'Bunda WabaImg2', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const result = await liveChatService.sendAdminReply({
      conversationId: conversation.id,
      text: 'Foto bukti',
      imageB64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      mimeType: 'image/png',
      tenantId: DEFAULT_TENANT_ID,
    });

    expect(result.success).toBe(true);
    expect(fake.sendImageMessage).toHaveBeenCalledTimes(1);
    const [sentPhone, sentTarget, sentCaption] = fake.sendImageMessage.mock.calls[0];
    expect(sentPhone).toBe(customer.phone);
    expect(String(sentTarget)).toMatch(/^https:\/\/bot\.example\.com\/media\/outbound\/default-tenant\/.+\.png$/);
    expect(sentCaption).toBe('Foto bukti');

    if (prev === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = prev;
  });

  it('editMessage: berhasil mengedit pesan outbound dalam rentang 15 menit', async () => {
    const fake = {
      ...makeFakeGateway('WAHA'),
      supportsEdit: true,
      editMessage: vi.fn().mockResolvedValue({ success: true }),
    };
    createTestGateway(fake, DEFAULT_TENANT_ID);

    const customer = await customerService.getOrCreateCustomer(`628600${Date.now()}`, 'Bunda Edit', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const loggedMsg = await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conversation.id,
      direction: Direction.OUTBOUND,
      content: 'Teks awal sebelum diedit',
      senderType: 'ADMIN',
      senderName: 'Admin Klinik',
    });

    const editRes = await liveChatService.editMessage({
      conversationId: conversation.id,
      messageId: loggedMsg.id,
      newContent: 'Teks perbaikan setelah diedit',
      tenantId: DEFAULT_TENANT_ID,
      adminName: 'Admin Klinik',
    });

    expect(editRes.success).toBe(true);
    expect(fake.editMessage).toHaveBeenCalledTimes(1);
    expect(fake.editMessage).toHaveBeenCalledWith(customer.phone, loggedMsg.id, 'Teks perbaikan setelah diedit');

    const messages = await liveChatService.getConversationMessages(conversation.id, DEFAULT_TENANT_ID);
    const target = messages.find((m) => m.id === loggedMsg.id);
    expect(target).toBeTruthy();
    expect(target.content).toBe('Teks perbaikan setelah diedit');
    expect(target.payload_raw?.is_edited).toBe(true);
  });

  it('editMessage: menolak pengeditan pesan yang sudah lebih dari 15 menit', async () => {
    const fake = {
      ...makeFakeGateway('WAHA'),
      supportsEdit: true,
      editMessage: vi.fn().mockResolvedValue({ success: true }),
    };
    createTestGateway(fake, DEFAULT_TENANT_ID);

    const customer = await customerService.getOrCreateCustomer(`628610${Date.now()}`, 'Bunda ExpiredEdit', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const loggedMsg = await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conversation.id,
      direction: Direction.OUTBOUND,
      content: 'Pesan sudah 20 menit lalu',
      senderType: 'ADMIN',
    });

    // Manipulasi created_at menjadi 20 menit lalu
    loggedMsg.created_at = new Date(Date.now() - 20 * 60 * 1000);

    const editRes = await liveChatService.editMessage({
      conversationId: conversation.id,
      messageId: loggedMsg.id,
      newContent: 'Coba edit pesan lama',
      tenantId: DEFAULT_TENANT_ID,
    });

    expect(editRes.success).toBe(false);
    expect(editRes.error).toContain('15 menit');
    expect(fake.editMessage).not.toHaveBeenCalled();
  });

  it('editMessage: menolak pengeditan pesan masuk (inbound) dari customer', async () => {
    const fake = {
      ...makeFakeGateway('WAHA'),
      supportsEdit: true,
      editMessage: vi.fn().mockResolvedValue({ success: true }),
    };
    createTestGateway(fake, DEFAULT_TENANT_ID);

    const customer = await customerService.getOrCreateCustomer(`628620${Date.now()}`, 'Bunda CustomerMsg', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const loggedMsg = await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conversation.id,
      direction: Direction.INBOUND,
      content: 'Pesan dari customer',
    });

    const editRes = await liveChatService.editMessage({
      conversationId: conversation.id,
      messageId: loggedMsg.id,
      newContent: 'Coba edit pesan customer',
      tenantId: DEFAULT_TENANT_ID,
    });

    expect(editRes.success).toBe(false);
    expect(editRes.error).toContain('Hanya pesan keluar');
    expect(fake.editMessage).not.toHaveBeenCalled();
  });

  it('editMessage: gagal bila provider gateway tidak mendukung edit (misal WABA)', async () => {
    const fake = {
      ...makeFakeGateway('WABA'),
      supportsEdit: false,
    };
    createTestGateway(fake, DEFAULT_TENANT_ID);

    const customer = await customerService.getOrCreateCustomer(`628630${Date.now()}`, 'Bunda WabaEdit', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const loggedMsg = await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conversation.id,
      direction: Direction.OUTBOUND,
      content: 'Pesan WABA',
    });

    const editRes = await liveChatService.editMessage({
      conversationId: conversation.id,
      messageId: loggedMsg.id,
      newContent: 'Edit pesan WABA',
      tenantId: DEFAULT_TENANT_ID,
    });

    expect(editRes.success).toBe(false);
    expect(editRes.error).toContain('tidak mendukung fitur edit pesan');
  });
});
