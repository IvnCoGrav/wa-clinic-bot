import { describe, it, expect } from 'vitest';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';
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

describe('General Age Inquiry Treatment Recommendation', () => {
  it('getServicesByAge with onlyGeneral=true returns only wellness/relaxation services', () => {
    const generalServices = treatmentCatalogService.getServicesByAge(17, true);
    const serviceNames = generalServices.map(s => s.name);

    // Harus mengandung Pijat Bayi Ceria (Rileksasi)
    expect(serviceNames.some(n => n.includes('Pijat Bayi Ceria'))).toBe(true);

    // TIDAK boleh mengandung terapi sakit / alat medis add-on
    expect(serviceNames.some(n => n.includes('Pulih Ceria') || n.includes('Terapi Bapil'))).toBe(false);
    expect(serviceNames.some(n => n.includes('Nebulizer'))).toBe(false);
    expect(serviceNames.some(n => n.includes('Moksa'))).toBe(false);
  });

  it('getServicesByAge with onlyGeneral=false returns all age-matching services including therapy', () => {
    const allServices = treatmentCatalogService.getServicesByAge(17, false);
    const serviceNames = allServices.map(s => s.name);

    expect(serviceNames.some(n => n.includes('Pijat Bayi Ceria'))).toBe(true);
    expect(serviceNames.some(n => n.includes('Pulih Ceria'))).toBe(true);
  });

  it('In AWAITING_INTEREST, general age question "okee Untuk anak umur 17 bulan yg mana yaa" recommends general wellness without pushing nebulizer/sinar moksa', async () => {
    const mockWaha = new MockWAHAClient();
    const typingService = new TypingService(mockWaha);
    typingService.setSpeedFactor(100000);
    const machine = new ConversationStateMachine(typingService);

    const customer: any = {
      id: 'cust_general_age_test',
      phone: '6281234567896',
      name: 'Bunda Test',
      tenant_id: DEFAULT_TENANT_ID,
    };

    const conversation: any = {
      id: 'conv_general_age_test',
      current_state: ConversationState.AWAITING_INTEREST,
      customer_id: customer.id,
      tenant_id: DEFAULT_TENANT_ID,
    };

    const incomingMessage: any = {
      id: 'msg_general_age_1',
      from: customer.phone,
      chatId: `${customer.phone}@c.us`,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: 'text',
      text: { body: 'okee Untuk anak umur 17 bulan yg mana yaa' },
    };

    await machine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation,
      incomingMessage,
    });

    expect(mockWaha.sentMessages.length).toBeGreaterThan(0);
    const reply = mockWaha.sentMessages[mockWaha.sentMessages.length - 1].text;

    // Pastikan respon merekomendasikan Pijat Bayi Ceria / relaksasi / umum
    expect(reply).toMatch(/Pijat Bayi Ceria|Ceria|Pijat/i);
    // TIDAK boleh mempromosikan Nebulizer atau Sinar Moksa tanpa ada keluhan
    expect(reply).not.toContain('Nebulizer');
    expect(reply).not.toContain('Sinar Moksa');
  });
});
