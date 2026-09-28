import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Direction } from '@prisma/client';
import { liveChatService, parseInternalNoteCommand } from '../../src/services/live-chat.service';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { messageService } from '../../src/services/message.service';
import { createTestGateway, resetGateway } from '../../src/integrations/whatsapp/factory';
import { computeFrustrationSignal, getFrustrationSlaMinutes, MAX_FRUSTRATION_AGE_MINUTES } from '../../src/services/frustration-signal.service';
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

describe('parseInternalNoteCommand — deteksi /notes deterministik', () => {
  it('mendeteksi perintah valid + mengekstrak isi', () => {
    expect(parseInternalNoteCommand('/notes')).toEqual({ isInternal: true, cleanNote: '' });
    expect(parseInternalNoteCommand('/notes Bawa perlak cadangan')).toEqual({
      isInternal: true,
      cleanNote: 'Bawa perlak cadangan',
    });
  });

  it('case-insensitive & toleran spasi depan', () => {
    expect(parseInternalNoteCommand('/NOTES  halo').isInternal).toBe(true);
    expect(parseInternalNoteCommand('   /Notes   halo  ').cleanNote).toBe('halo');
    expect(parseInternalNoteCommand('/notes\tisi').isInternal).toBe(true);
  });

  it('menolak /notesX (bukan perintah) — anti false-positive', () => {
    expect(parseInternalNoteCommand('/notesX halo').isInternal).toBe(false);
    expect(parseInternalNoteCommand('/notesku').isInternal).toBe(false);
    expect(parseInternalNoteCommand('catatan /notes').isInternal).toBe(false);
  });

  it('forceInternal (toggle gembok) memperlakukan seluruh teks sebagai catatan', () => {
    expect(parseInternalNoteCommand('tolong bidan bawa perlak', true)).toEqual({
      isInternal: true,
      cleanNote: 'tolong bidan bawa perlak',
    });
    // tanpa force → teks biasa
    expect(parseInternalNoteCommand('tolong bidan bawa perlak', false).isInternal).toBe(false);
  });
});

describe('LiveChatService — /notes anti-bocor ke WhatsApp (Fase 3)', () => {
  beforeEach(() => {
    resetGateway();
  });

  it('catatan /notes TIDAK memanggil gateway WhatsApp + tersimpan sebagai INTERNAL_NOTE', async () => {
    const fake = makeFakeGateway('WAHA');
    createTestGateway(fake, DEFAULT_TENANT_ID);

    const phone = `628300${Date.now().toString().slice(-7)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Note', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const result = await liveChatService.sendAdminReply({
      conversationId: conversation.id,
      text: '/notes Tolong bidan bawa perlak cadangan',
      tenantId: DEFAULT_TENANT_ID,
      adminName: 'CS Rina',
    });

    expect(result.success).toBe(true);
    expect(result.isInternal).toBe(true);
    // KUNCI: gateway HARAM dipanggil
    expect(fake.sendTextMessage).not.toHaveBeenCalled();

    const messages = await liveChatService.getConversationMessages(conversation.id, DEFAULT_TENANT_ID);
    const note = messages.find((m) => m.sender_type === 'INTERNAL_NOTE');
    expect(note).toBeDefined();
    expect(note?.content).toBe('Tolong bidan bawa perlak cadangan');
    expect(note?.sender_name).toBe('CS Rina');
  });

  it('/notes kosong → EMPTY_NOTE, tidak tersimpan, tidak kirim', async () => {
    const fake = makeFakeGateway('WAHA');
    createTestGateway(fake, DEFAULT_TENANT_ID);

    const phone = `628301${Date.now().toString().slice(-7)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Empty', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const result = await liveChatService.sendAdminReply({
      conversationId: conversation.id,
      text: '/notes   ',
      tenantId: DEFAULT_TENANT_ID,
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('EMPTY_NOTE');
    expect(fake.sendTextMessage).not.toHaveBeenCalled();
  });

  it('isInternalNote=true (toggle gembok) menyimpan teks apa pun sebagai catatan', async () => {
    const fake = makeFakeGateway('WAHA');
    createTestGateway(fake, DEFAULT_TENANT_ID);

    const phone = `628302${Date.now().toString().slice(-7)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Lock', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const result = await liveChatService.sendAdminReply({
      conversationId: conversation.id,
      text: 'rumah pagar hitam bel di kanan',
      tenantId: DEFAULT_TENANT_ID,
      isInternalNote: true,
    });

    expect(result.success).toBe(true);
    expect(result.isInternal).toBe(true);
    expect(fake.sendTextMessage).not.toHaveBeenCalled();
  });

  it('teks biasa (bukan /notes) TETAP terkirim ke WhatsApp', async () => {
    const fake = makeFakeGateway('WAHA');
    createTestGateway(fake, DEFAULT_TENANT_ID);

    const phone = `628303${Date.now().toString().slice(-7)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Normal', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const result = await liveChatService.sendAdminReply({
      conversationId: conversation.id,
      text: 'Baik Bunda, kami siapkan ya',
      tenantId: DEFAULT_TENANT_ID,
    });

    expect(result.success).toBe(true);
    expect(result.isInternal).toBeUndefined();
    expect(fake.sendTextMessage).toHaveBeenCalledTimes(1);
  });

  it('catatan internal TIDAK mengubah status "menunggu dibalas"', async () => {
    const phone = `628304${Date.now().toString().slice(-7)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Await', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    // Customer kirim pesan terakhir (inbound), belum dibalas.
    await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conversation.id,
      direction: Direction.INBOUND,
      content: 'Halo masih ada?',
    });
    // Staf tulis catatan internal.
    await liveChatService.sendAdminReply({
      conversationId: conversation.id,
      text: '/notes follow up besok pagi',
      tenantId: DEFAULT_TENANT_ID,
    });

    // Tandai sudah dibaca (isAwaitingReply hanya berlaku saat unread=0).
    await messageService.markConversationMessagesAsRead(conversation.id, DEFAULT_TENANT_ID);

    const { items } = await liveChatService.getConversationList(DEFAULT_TENANT_ID);
    const item = items.find((c) => c.conversationId === conversation.id);
    expect(item).toBeTruthy();
    // Pesan nyata terakhir tetap INBOUND → masih menunggu dibalas (catatan internal diabaikan).
    expect(item!.isAwaitingReply).toBe(true);
  });
});

describe('computeFrustrationSignal — state/SLA-based (bukan keyword)', () => {
  const now = new Date('2026-09-27T12:00:00Z');

  it('INBOUND melewati SLA → true', () => {
    const lastAt = new Date(now.getTime() - 20 * 60 * 1000); // 20 menit lalu
    expect(computeFrustrationSignal({ lastDirection: 'INBOUND', lastMessageAt: lastAt, now, slaMinutes: 15 })).toBe(true);
  });

  it('INBOUND belum melewati SLA → false', () => {
    const lastAt = new Date(now.getTime() - 5 * 60 * 1000); // 5 menit lalu
    expect(computeFrustrationSignal({ lastDirection: 'INBOUND', lastMessageAt: lastAt, now, slaMinutes: 15 })).toBe(false);
  });

  it('balasan terakhir OUTBOUND (sudah dibalas) → false walau lama', () => {
    const lastAt = new Date(now.getTime() - 120 * 60 * 1000);
    expect(computeFrustrationSignal({ lastDirection: 'OUTBOUND', lastMessageAt: lastAt, now, slaMinutes: 15 })).toBe(false);
  });

  it('tanpa pesan → false', () => {
    expect(computeFrustrationSignal({ lastDirection: null, lastMessageAt: null, now })).toBe(false);
  });

  it('tidak terpengaruh isi teks (bukan keyword matching)', () => {
    // Kalimat "santai" pun tetap dinilai dari SLA, bukan kata.
    const lastAt = new Date(now.getTime() - 30 * 60 * 1000);
    expect(computeFrustrationSignal({ lastDirection: 'INBOUND', lastMessageAt: lastAt, now, slaMinutes: 15 })).toBe(true);
  });
});

describe('computeFrustrationSignal — SLA 60 menit & max-age 24 jam', () => {
  const now = new Date('2026-09-28T12:00:00Z');

  it('default SLA adalah 60 menit', () => {
    expect(getFrustrationSlaMinutes()).toBe(60);
    expect(MAX_FRUSTRATION_AGE_MINUTES).toBe(24 * 60);
  });

  it('menunggu 50 menit (belum SLA 60) → false', () => {
    const lastAt = new Date(now.getTime() - 50 * 60 * 1000);
    expect(computeFrustrationSignal({ lastDirection: 'INBOUND', lastMessageAt: lastAt, now })).toBe(false);
  });

  it('menunggu 65 menit (> SLA 60) → true', () => {
    const lastAt = new Date(now.getTime() - 65 * 60 * 1000);
    expect(computeFrustrationSignal({ lastDirection: 'INBOUND', lastMessageAt: lastAt, now })).toBe(true);
  });

  it('menunggu 25 jam (> max-age 24 jam) → false (chat kuno tidak ditandai)', () => {
    const lastAt = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    expect(computeFrustrationSignal({ lastDirection: 'INBOUND', lastMessageAt: lastAt, now })).toBe(false);
  });

  it('menunggu 23 jam (dalam jendela aktif) → true', () => {
    const lastAt = new Date(now.getTime() - 23 * 60 * 60 * 1000);
    expect(computeFrustrationSignal({ lastDirection: 'INBOUND', lastMessageAt: lastAt, now })).toBe(true);
  });

  it('max-age dapat dioverride (misal 2 jam)', () => {
    const lastAt = new Date(now.getTime() - 3 * 60 * 60 * 1000); // 3 jam lalu
    expect(computeFrustrationSignal({ lastDirection: 'INBOUND', lastMessageAt: lastAt, now, slaMinutes: 60, maxAgeMinutes: 120 })).toBe(false);
    expect(computeFrustrationSignal({ lastDirection: 'INBOUND', lastMessageAt: lastAt, now, slaMinutes: 60, maxAgeMinutes: 240 })).toBe(true);
  });

  it('balasan OUTBOUND tetap false walau dalam rentang', () => {
    const lastAt = new Date(now.getTime() - 5 * 60 * 60 * 1000);
    expect(computeFrustrationSignal({ lastDirection: 'OUTBOUND', lastMessageAt: lastAt, now })).toBe(false);
  });
});

describe('dismissFrustration — pemadaman manual (Fase 7)', () => {
  it('idempoten: padamkan dua kali tetap sukses & isFrustrated=false', async () => {
    const { conversationService } = await import('../../src/services/conversation.service');
    const { customerService } = await import('../../src/services/customer.service');
    const phone = `62877${Date.now()}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda SLA', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const first = await conversationService.dismissFrustration(conversation.id, DEFAULT_TENANT_ID);
    const second = await conversationService.dismissFrustration(conversation.id, DEFAULT_TENANT_ID);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first.is_frustrated).toBe(false);
    expect(second.is_frustrated).toBe(false);
  });

  it('conversation tidak ditemukan → null (tanpa throw)', async () => {
    const { conversationService } = await import('../../src/services/conversation.service');
    const res = await conversationService.dismissFrustration('conv-tidak-ada-xyz', DEFAULT_TENANT_ID);
    expect(res).toBeNull();
  });
});
