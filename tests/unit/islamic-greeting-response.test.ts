import { describe, it, expect } from 'vitest';
import { hasIslamicGreeting, formatIslamicReply } from '../../src/state-machine/utils/islamic-greeting-helper';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { TypingService } from '../../src/services/typing.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { ConversationState } from '@prisma/client';
import type { IWahaClient } from '../../src/integrations/waha/client';

class MockWAHAClient implements IWahaClient {
  public sentMessages: Array<{ type: 'text' | 'image'; text: string; fileUrl?: string }> = [];

  public async sendSeen(): Promise<boolean> { return true; }
  public async startTyping(): Promise<boolean> { return true; }
  public async stopTyping(): Promise<boolean> { return true; }
  public async sendText(chatId: string, text: string): Promise<boolean> {
    this.sentMessages.push({ type: 'text', text });
    return true;
  }
  public async sendImage(chatId: string, fileUrl: string, caption?: string): Promise<boolean> {
    this.sentMessages.push({ type: 'image', text: caption || '', fileUrl });
    return true;
  }
  public async addLabel(): Promise<boolean> { return true; }
  public async removeLabel(): Promise<boolean> { return true; }
  public async getChatLabels(): Promise<string[]> { return []; }
  public async getChatLabelsOrNull(): Promise<string[] | null> { return []; }
  public async getSessionStatus(): Promise<string> { return 'WORKING'; }
  public async startSession(): Promise<string> { return 'WORKING'; }
  public async stopSession(): Promise<boolean> { return true; }
  public async getSession(): Promise<any | null> { return null; }
  public async deleteSession(): Promise<boolean> { return true; }
  public async createSession(): Promise<string> { return 'CREATED'; }
  public async getAuthQr(): Promise<any | null> { return null; }
  public async getChats(): Promise<any[]> { return []; }
  public async getMessages(): Promise<any[]> { return []; }
  public async getContact(): Promise<any | null> { return null; }
  public async getPhoneNumberFromLid(): Promise<string | null> { return '6281234567890'; }
  public async downloadMedia(): Promise<Buffer | null> { return null; }
}

describe('Islamic Greeting Helper & Waalaikumsalam Mandatory Prefix', () => {
  it('correctly identifies Islamic greetings variations', () => {
    expect(hasIslamicGreeting('assalamualaikum')).toBe(true);
    expect(hasIslamicGreeting("assalamu'alaikum")).toBe(true);
    expect(hasIslamicGreeting('assalamu alaikum wr wb')).toBe(true);
    expect(hasIslamicGreeting("assalamu'alaikum kak mau tanya")).toBe(true);
    expect(hasIslamicGreeting('ass wr wb')).toBe(true);
    expect(hasIslamicGreeting('aslm')).toBe(true);
    expect(hasIslamicGreeting('mikum min')).toBe(true);

    expect(hasIslamicGreeting('halo kak')).toBe(false);
    expect(hasIslamicGreeting('selamat pagi')).toBe(false);
    expect(hasIslamicGreeting('mau tanya ongkir ke waru')).toBe(false);
  });

  it('formatIslamicReply replaces Halo Bunda with Waalaikumsalam Bunda when user sends assalamualaikum', () => {
    const originalGreeting = 'Halo Bunda ! ✨\nTerima kasih sudah menghubungi kami.';
    const result = formatIslamicReply(originalGreeting, 'assalamualaikum');

    expect(result).toMatch(/^Waalaikumsalam Bunda/i);
    expect(result).toContain('Terima kasih sudah menghubungi kami.');
  });

  it('formatIslamicReply does not change response if user did not send Islamic greeting', () => {
    const originalGreeting = 'Halo Bunda ! ✨\nTerima kasih sudah menghubungi kami.';
    const result = formatIslamicReply(originalGreeting, 'halo min mau tanya');

    expect(result).toBe(originalGreeting);
  });

  it('End-to-End State Machine: "assalamualaikum" in INITIAL greeting state replies with Waalaikumsalam', async () => {
    const mockWaha = new MockWAHAClient();
    const typingService = new TypingService(mockWaha);
    typingService.setSpeedFactor(100000);
    const machine = new ConversationStateMachine(typingService);

    const customer: any = {
      id: 'cust_islamic_test_1',
      phone: '6281234567897',
      name: 'Bunda Aisyah',
      tenant_id: DEFAULT_TENANT_ID,
    };

    const conversation: any = {
      id: 'conv_islamic_test_1',
      current_state: ConversationState.INITIAL,
      customer_id: customer.id,
      tenant_id: DEFAULT_TENANT_ID,
    };

    const incomingMessage: any = {
      id: 'msg_islamic_1',
      from: customer.phone,
      chatId: `${customer.phone}@c.us`,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: 'text',
      text: { body: 'assalamualaikum' },
    };

    await machine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation,
      incomingMessage,
    });

    expect(mockWaha.sentMessages.length).toBeGreaterThan(0);
    const firstReply = mockWaha.sentMessages[0].text;
    expect(firstReply).toMatch(/^Waalaikumsalam Bunda/i);
  });

  it('End-to-End State Machine: "assalamu\'alaikum untuk anak 17 bulan yg mana yaa" replies with Waalaikumsalam AND general treatment', async () => {
    const mockWaha = new MockWAHAClient();
    const typingService = new TypingService(mockWaha);
    typingService.setSpeedFactor(100000);
    const machine = new ConversationStateMachine(typingService);

    const customer: any = {
      id: 'cust_islamic_test_2',
      phone: '6281234567898',
      name: 'Bunda Fatimah',
      tenant_id: DEFAULT_TENANT_ID,
    };

    const conversation: any = {
      id: 'conv_islamic_test_2',
      current_state: ConversationState.INITIAL,
      customer_id: customer.id,
      tenant_id: DEFAULT_TENANT_ID,
    };

    const incomingMessage: any = {
      id: 'msg_islamic_2',
      from: customer.phone,
      chatId: `${customer.phone}@c.us`,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: 'text',
      text: { body: "assalamu'alaikum untuk anak 17 bulan yg mana yaa" },
    };

    await machine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation,
      incomingMessage,
    });

    expect(mockWaha.sentMessages.length).toBeGreaterThan(0);
    const fullText = mockWaha.sentMessages.map(m => m.text).join(' ');

    // WAJIB menjawab Waalaikumsalam
    expect(fullText).toMatch(/Waalaikumsalam/i);
    // WAJIB merekomendasikan treatment general/pijat bayi ceria
    expect(fullText).toMatch(/Pijat Bayi Ceria|Ceria|Pijat/i);
    // TIDAK boleh mempromosikan Nebulizer
    expect(fullText).not.toContain('Nebulizer');
  });
});
