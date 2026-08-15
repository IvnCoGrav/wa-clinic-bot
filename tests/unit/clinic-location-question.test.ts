import { describe, it, expect, beforeEach } from 'vitest';
import { isAskingClinicLocation } from '../../src/state-machine/utils/clinic-location-checker';
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

describe('Clinic Location / Midwife Origin Inquiries', () => {
  it('isAskingClinicLocation correctly identifies various phrasing', () => {
    expect(isAskingClinicLocation('Saya dari surabaya timur kak. Kalo boleh tau kakaknya darimana kak?')).toBe(true);
    expect(isAskingClinicLocation('kakaknya darimana kak?')).toBe(true);
    expect(isAskingClinicLocation('kakaknya dari mana ya bund?')).toBe(true);
    expect(isAskingClinicLocation('lokasi kliniknya dimana?')).toBe(true);
    expect(isAskingClinicLocation('homebase nya dimana kak?')).toBe(true);
    expect(isAskingClinicLocation('bidan yusi dari mana?')).toBe(true);
    expect(isAskingClinicLocation('posisi klinik di daerah mana?')).toBe(true);

    // Negative cases
    expect(isAskingClinicLocation('rumah saya di sedati')).toBe(false);
    expect(isAskingClinicLocation('anak saya 3 bulan')).toBe(false);
    expect(isAskingClinicLocation('mau booking besok')).toBe(false);
  });

  it('Customer asking "Saya dari surabaya timur kak. Kalo boleh tau kakaknya darimana kak?" in AWAITING_LOCATION does NOT return generic reservation template', async () => {
    const mockWaha = new MockWAHAClient();
    const typingService = new TypingService(mockWaha);
    typingService.setSpeedFactor(100000);
    const machine = new ConversationStateMachine(typingService);

    const customer: any = {
      id: 'cust_clinic_loc_test',
      phone: '6281234567890',
      name: 'Bunda Test',
      tenant_id: DEFAULT_TENANT_ID,
    };

    const conversation: any = {
      id: 'conv_clinic_loc_test',
      current_state: ConversationState.AWAITING_LOCATION,
      customer_id: customer.id,
      tenant_id: DEFAULT_TENANT_ID,
    };

    const incomingMessage: any = {
      id: 'msg_clinic_loc_1',
      from: customer.phone,
      chatId: `${customer.phone}@c.us`,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: 'text',
      text: { body: 'Saya dari surabaya timur kak. Kalo boleh tau kakaknya darimana kak?' },
    };

    await machine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation,
      incomingMessage,
    });

    expect(mockWaha.sentMessages.length).toBeGreaterThan(0);
    const reply = mockWaha.sentMessages[mockWaha.sentMessages.length - 1].text;

    // Pastikan BUKAN template generic unrelated follow up
    expect(reply).not.toContain('Apakah Bunda tertarik untuk lanjut mengisi list reservasi');
  });
});
