import { describe, it, expect, beforeEach } from 'vitest';
import { isNeedTimeOrDiscussionMessage } from '../../src/state-machine/utils/need-time-checker';
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

describe('Need-Time & Discussion Intent Handling', () => {
  it('isNeedTimeOrDiscussionMessage correctly detects various pause/discussion phrases', () => {
    expect(isNeedTimeOrDiscussionMessage('Oke sbntr sy coba tnykan ya')).toBe(true);
    expect(isNeedTimeOrDiscussionMessage('sebentar ya tanya suami dulu')).toBe(true);
    expect(isNeedTimeOrDiscussionMessage('nanti saya kabari lagi ya mbak')).toBe(true);
    expect(isNeedTimeOrDiscussionMessage('rembukan dulu sama keluarga')).toBe(true);
    expect(isNeedTimeOrDiscussionMessage('pikir2 dulu ya bund')).toBe(true);
    expect(isNeedTimeOrDiscussionMessage('sbntr ya')).toBe(true);
    expect(isNeedTimeOrDiscussionMessage('cek jadwal dulu ya')).toBe(true);

    // Negative cases
    expect(isNeedTimeOrDiscussionMessage('alamat saya di sedati')).toBe(false);
    expect(isNeedTimeOrDiscussionMessage('mau ambil paket selapan')).toBe(false);
    expect(isNeedTimeOrDiscussionMessage('iya')).toBe(false);
  });

  it('In AWAITING_LOCATION state, "Oke sbntr sy coba tnykan ya" responds with patient waiting message without demanding location again', async () => {
    const mockWaha = new MockWAHAClient();
    const typingService = new TypingService(mockWaha);
    typingService.setSpeedFactor(100000);
    const machine = new ConversationStateMachine(typingService);

    const customer: any = {
      id: 'cust_need_time_test',
      phone: '6281234567890',
      name: 'Bunda Test',
      tenant_id: DEFAULT_TENANT_ID,
    };

    const conversation: any = {
      id: 'conv_need_time_test',
      current_state: ConversationState.AWAITING_LOCATION,
      customer_id: customer.id,
      tenant_id: DEFAULT_TENANT_ID,
    };

    const incomingMessage: any = {
      id: 'msg_need_time_1',
      from: customer.phone,
      chatId: `${customer.phone}@c.us`,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: 'text',
      text: { body: 'Oke sbntr sy coba tnykan ya' },
    };

    await machine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation,
      incomingMessage,
    });

    expect(mockWaha.sentMessages.length).toBeGreaterThan(0);
    const reply = mockWaha.sentMessages[0].text;

    // Pastikan respon mengandung nada sabar menunggu kabar
    expect(reply).toMatch(/tunggu kabarnya|santai saja|kabari kami/i);
    // Pastikan TIDAK menodong/mengulang kata tanya kelurahan/ongkir lagi
    expect(reply).not.toContain('kelurahan mana');
    expect(reply).not.toContain('antimeminjamkan');
  });
});
