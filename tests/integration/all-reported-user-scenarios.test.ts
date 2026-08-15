import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { TypingService } from '../../src/services/typing.service';
import { geocodingService } from '../../src/integrations/google-maps/geocoding';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { AiRouterConfigService } from '../../src/config/ai-router-config';
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

describe('All Reported User Scenarios Integration Test (Shadow Mode OFF)', () => {
  let mockWaha: MockWAHAClient;
  let machine: ConversationStateMachine;

  beforeEach(() => {
    mockWaha = new MockWAHAClient();
    const typingService = new TypingService(mockWaha);
    typingService.setSpeedFactor(100000);
    machine = new ConversationStateMachine(typingService);
  });

  it('Verifies Shadow Mode is OFF by default', () => {
    const isShadow = AiRouterConfigService.isShadowMode(DEFAULT_TENANT_ID);
    expect(isShadow).toBe(false);
  });

  it('Scenario 1: Geocoding anti-hijacking for "Bungurasih tengah sidoarjo"', async () => {
    const res = await geocodingService.geocodeText('Bungurasih tengah sidoarjo');
    expect(res.isPrecise).toBe(true);
    expect(res.kelurahan).toBe('Bungurasih');
    expect(res.kecamatan).toBe('Waru');
    expect(res.kota).toBe('Kabupaten Sidoarjo');
  });

  it('Scenario 2: Geocoding action prefix strip for "ganti ke Rumdis TNI al wonosari A132 mbak"', async () => {
    const res = await geocodingService.geocodeText('ganti ke Rumdis TNI al wonosari A132 mbak');
    expect(res.kelurahan).not.toBe('Ganting');
    expect(res.kecamatan).not.toBe('Gedangan');
    expect(res.matchedSpan).not.toBe('Ganting');
  });

  it('Scenario 3: Geocoding Sedati & Pabean resolution', async () => {
    const pabeanRes = await geocodingService.geocodeText('pabean kak');
    expect(pabeanRes.isPrecise).toBe(true);
    expect(pabeanRes.kelurahan).toBe('Pabean');
    expect(pabeanRes.kecamatan).toBe('Sedati');
  });

  it('Scenario 4: Symptom inquiry "Iya bu bid nafasnya agak grok2 tapi tidak kayak pilek" in AWAITING_INTEREST is NOT blocked by location prompt', async () => {
    const customer: any = {
      id: 'cust_symptom_test',
      phone: '6281234567890',
      name: 'Bunda Test',
      kelurahan: 'Pabean',
      kecamatan: 'Sedati',
      kota: 'Kabupaten Sidoarjo',
      lat: -7.368,
      lng: 112.755,
      tenant_id: DEFAULT_TENANT_ID,
    };

    const conversation: any = {
      id: 'conv_symptom_test',
      currentState: 'AWAITING_INTEREST',
      customer_id: customer.id,
      tenant_id: DEFAULT_TENANT_ID,
    };

    const incomingMessage: any = {
      id: 'msg_symptom_1',
      from: customer.phone,
      chatId: `${customer.phone}@c.us`,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: 'text',
      text: { body: 'Iya bu bid nafasnya agak grok2 tapi tidak kayak pilek' },
    };

    await machine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation,
      incomingMessage,
    });

    expect(mockWaha.sentMessages.length).toBeGreaterThan(0);
    const reply = mockWaha.sentMessages[mockWaha.sentMessages.length - 1].text;

    // Pastikan tidak pernah mengeluarkan template salah konteks "mengubah lokasi"
    expect(reply).not.toContain('Bunda ingin mengubah lokasi');
    expect(reply).not.toContain('sepertinya ada yang kurang tepat');
  });

  it('Scenario 5: Pause / Discussion "Oke sbntr sy coba tnykan ya" in AWAITING_LOCATION responds with patient waiting message without re-prompting location', async () => {
    const customer: any = {
      id: 'cust_need_time_sc5',
      phone: '6281234567891',
      name: 'Bunda Test',
      tenant_id: DEFAULT_TENANT_ID,
    };

    const conversation: any = {
      id: 'conv_need_time_sc5',
      current_state: 'AWAITING_LOCATION',
      customer_id: customer.id,
      tenant_id: DEFAULT_TENANT_ID,
    };

    const incomingMessage: any = {
      id: 'msg_need_time_sc5',
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
    const reply = mockWaha.sentMessages[mockWaha.sentMessages.length - 1].text;

    expect(reply).toMatch(/tunggu kabarnya|santai saja|kabari kami/i);
    expect(reply).not.toContain('kelurahan mana');
    expect(reply).not.toContain('antimeminjamkan');
  });

  it('Scenario 6: Clinic location inquiry "Saya dari surabaya timur kak. Kalo boleh tau kakaknya darimana kak?" answers clinic location and homecare system without generic reservation template', async () => {
    const customer: any = {
      id: 'cust_clinic_loc_sc6',
      phone: '6281234567892',
      name: 'Bunda Test',
      tenant_id: DEFAULT_TENANT_ID,
    };

    const conversation: any = {
      id: 'conv_clinic_loc_sc6',
      current_state: 'AWAITING_LOCATION',
      customer_id: customer.id,
      tenant_id: DEFAULT_TENANT_ID,
    };

    const incomingMessage: any = {
      id: 'msg_clinic_loc_sc6',
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

    expect(reply).toMatch(/Waru|Sidoarjo|Homecare/i);
    expect(reply).not.toContain('Apakah Bunda tertarik untuk lanjut mengisi list reservasi');
  });
});
