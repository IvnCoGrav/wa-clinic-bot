import { describe, it, expect, beforeEach, vi } from 'vitest';
import { wahaHistorySyncService } from '../../src/services/waha-history-sync.service';
import { wahaClient } from '../../src/integrations/waha/client';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

// Override singleton WAHA client (mutasi langsung — metode di prototype, tidak di-spread).
const mockChats = vi.fn();
const mockMessages = vi.fn();
const mockPhoneFromLid = vi.fn();
const mockGetContact = vi.fn();
Object.assign(wahaClient, {
  getChats: mockChats,
  getMessages: mockMessages,
  getPhoneNumberFromLid: mockPhoneFromLid,
  getContact: mockGetContact,
});

function chat(id: string, name?: string) {
  return { id, name };
}
function msg(id: string, body: string, fromMe: boolean, timestamp: number) {
  return { id, body, fromMe, timestamp };
}

describe('WahaHistorySyncService — backfill history WAHA', () => {
  beforeEach(() => {
    mockChats.mockReset();
    mockMessages.mockReset();
    mockPhoneFromLid.mockReset();
    mockGetContact.mockReset();
  });

  it('sync batch 50: upsert customer + conversation + messages, dedupe by wa_message_id', async () => {
    mockChats.mockResolvedValue([
      chat('62812345678@c.us', 'Bunda Asli'),
      chat('628999999999@c.us', 'Bunda Dummy'), // sandbox → skip
      chat('62887654321@lid', 'Bunda Lid'),
      chat('62800000001@g.us', 'Grup Klinik'), // grup → skip
    ]);
    mockPhoneFromLid.mockResolvedValue('62887654321');
    mockMessages
      .mockResolvedValueOnce([
        msg('wa1', 'Halo dok', false, 1700000000),
        msg('wa2', 'Baik Bunda', true, 1700000060),
        msg('wa1', 'Halo dok (duplikat)', false, 1700000000), // id sama → dedupe
      ])
      .mockResolvedValueOnce([msg('wa3', 'Test', false, 1700000100)]);
    // Chat @lid ketiga (mockMessages ketiga) — tanpa pesan
    mockMessages.mockResolvedValue([]);

    const result = await wahaHistorySyncService.syncChats(50, 0, 100, DEFAULT_TENANT_ID);

    expect(result.success).toBe(true);
    expect(result.totalChats).toBe(4);
    // Chat asli + chat lid = 2 diproses; grup + sandbox = 2 skip
    expect(result.syncedChats).toBe(2);
    expect(result.skippedChats).toBe(2);
    // wa1 di-dedupe → pesan unik: wa1, wa2 (chat 1) + wa3 (chat 2)
    expect(result.syncedMessages).toBe(3);
    expect(result.nextOffset).toBe(4);
    expect(result.hasMore).toBe(false);

    // Verifikasi data tersimpan: customer asli ada, sandbox/grup tidak
    const cust = await customerService.getCustomerByPhone('62812345678', DEFAULT_TENANT_ID);
    expect(cust).toBeTruthy();
    expect(cust.is_sandbox_test).not.toBe(true);
    const conversations = await conversationService.listConversations(DEFAULT_TENANT_ID, 50, 0);
    expect(conversations.length).toBeGreaterThanOrEqual(2);
  });

  it('batch offset: hanya memproses slice offset..offset+limit dan hasMore benar', async () => {
    const allChats = Array.from({ length: 120 }, (_, i) => chat(`6281000000${String(i).padStart(3, '0')}@c.us`, `C ${i}`));
    mockChats.mockResolvedValue(allChats);
    mockMessages.mockResolvedValue([msg('m1', 'halo', false, 1700000000)]);

    const page1 = await wahaHistorySyncService.syncChats(50, 0, 100, DEFAULT_TENANT_ID);
    expect(page1.syncedChats).toBe(50);
    expect(page1.nextOffset).toBe(50);
    expect(page1.hasMore).toBe(true);

    const page3 = await wahaHistorySyncService.syncChats(50, 100, 100, DEFAULT_TENANT_ID);
    expect(page3.syncedChats).toBe(20);
    expect(page3.nextOffset).toBe(120);
    expect(page3.hasMore).toBe(false);
  });

  it('WAHA error → return success=false tanpa crash', async () => {
    mockChats.mockRejectedValue(new Error('WAHA down'));
    const result = await wahaHistorySyncService.syncChats(50, 0, 100, DEFAULT_TENANT_ID);
    expect(result.success).toBe(false);
    expect(result.error).toContain('WAHA down');
  });

  it('backfill nama customer dari pushname saat chat.name kosong (best-effort)', async () => {
    mockChats.mockResolvedValue([chat('62855500001@c.us')]); // tanpa name
    mockMessages.mockResolvedValue([msg('wa9', 'Halo', false, 1700000000)]);
    mockGetContact.mockResolvedValue({ id: '62855500001@c.us', pushname: 'Bunda Rina' });

    const result = await wahaHistorySyncService.syncChats(50, 0, 100, DEFAULT_TENANT_ID);
    expect(result.syncedChats).toBe(1);
    expect(mockGetContact).toHaveBeenCalledWith('62855500001');

    const cust = await customerService.getCustomerByPhone('62855500001', DEFAULT_TENANT_ID);
    expect(cust?.name).toBe('Bunda Rina');
  });
});
