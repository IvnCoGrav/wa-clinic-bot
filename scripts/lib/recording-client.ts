/**
 * RecordingWahaClient — IWahaClient injected ke TypingService/StateMachine agar
 * balasan bot (termasuk SPLIT BUBBLE) bisa dicapture dalam-memory untuk test harness.
 * Murni untuk testing; tidak dipakai production. Tidak menyentuh file apa pun di src/.
 */
import { IWahaClient } from '../../src/integrations/waha/client';

export class RecordingWahaClient implements IWahaClient {
  /** Semua bubble teks yang dikirim bot (sendText), diurutkan. */
  public sentTexts: string[] = [];
  public seenCount = 0;
  public typingStarts = 0;
  public typingStops = 0;
  public sentMessages: Array<{ text: string; time: number }> = [];
  public readonly mockLabels: Map<string, string[]> = new Map();

  public reset(): void {
    this.sentTexts = [];
    this.sentMessages = [];
    this.typingStarts = 0;
    this.typingStops = 0;
  }

  public async sendSeen(chatId: string): Promise<boolean> { this.seenCount++; return true; }
  public async startTyping(chatId: string): Promise<boolean> { this.typingStarts++; return true; }
  public async stopTyping(chatId: string): Promise<boolean> { this.typingStops++; return true; }

  public async sendText(chatId: string, text: string): Promise<boolean> {
    this.sentTexts.push(text);
    this.sentMessages.push({ text, time: Date.now() });
    return true;
  }

  public async sendImage(chatId: string, url: string, caption?: string): Promise<boolean> {
    this.sentMessages.push({ text: `[IMAGE] ${caption || url}`, time: Date.now() });
    return true;
  }

  public async addLabel(chatId: string, labelName: string): Promise<boolean> {
    const cur = this.mockLabels.get(chatId) || [];
    if (!cur.includes(labelName)) cur.push(labelName);
    this.mockLabels.set(chatId, cur);
    return true;
  }

  public async removeLabel(chatId: string, labelName: string): Promise<boolean> {
    const cur = this.mockLabels.get(chatId) || [];
    this.mockLabels.set(chatId, cur.filter((l) => l !== labelName));
    return true;
  }

  public async getChatLabels(chatId: string): Promise<string[]> {
    return this.mockLabels.get(chatId) || [];
  }

  public async getSessionStatus(): Promise<string> { return 'WORKING'; }
  public async startSession(): Promise<string> { return 'WORKING'; }
  public async stopSession(): Promise<boolean> { return true; }
  public async getAuthQr(): Promise<import('../../src/integrations/waha/client').WahaQr | null> {
    return null;
  }
  public async getSession(): Promise<any | null> { return { name: 'default', status: 'WORKING', config: {} }; }
  public async deleteSession(): Promise<boolean> { return true; }
  public async createSession(): Promise<string> { return 'CREATED'; }
  public async getChats(): Promise<import('../../src/integrations/waha/client').WahaChat[]> { return []; }
  public async getMessages(chatId: string, limit?: number): Promise<import('../../src/integrations/waha/client').WahaMessage[]> { return []; }
}