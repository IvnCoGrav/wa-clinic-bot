import { wahaClient, IWahaClient } from '../waha/client';
import {
  WhatsAppGateway,
  SendResult,
  TemplateComponent,
  TemplateParam,
} from './gateway.types';

export class WahaGatewayDriver implements WhatsAppGateway {
  readonly providerType = 'WAHA' as const;
  private client: IWahaClient;

  constructor(client?: IWahaClient) {
    this.client = client || wahaClient;
  }

  async sendTextMessage(to: string, text: string): Promise<SendResult> {
    const chatId = this.toChatId(to);
    try {
      const ok = await this.client.sendText(chatId, text);
      return { success: ok, provider: 'WAHA' };
    } catch (err: any) {
      return {
        success: false,
        provider: 'WAHA',
        error: { code: 'WAHA_SEND_TEXT', message: err?.message || 'sendText failed' },
      };
    }
  }

  async sendTemplateMessage(
    to: string,
    _templateName: string,
    _languageCode: string,
    components: TemplateComponent[]
  ): Promise<SendResult> {
    const text = this.interpolateTemplate(components);
    return this.sendTextMessage(to, text);
  }

  async sendImageMessage(to: string, imageUrl: string, caption?: string): Promise<SendResult> {
    const chatId = this.toChatId(to);
    try {
      const ok = await this.client.sendImage(chatId, imageUrl, caption);
      return { success: ok, provider: 'WAHA' };
    } catch (err: any) {
      return {
        success: false,
        provider: 'WAHA',
        error: { code: 'WAHA_SEND_IMAGE', message: err?.message || 'sendImage failed' },
      };
    }
  }

  async sendTypingIndicator(to: string, _incomingMessageId?: string, durationMs?: number): Promise<void> {
    const chatId = this.toChatId(to);
    const delay = Math.max(0, durationMs ?? 3000);
    try {
      await this.client.startTyping(chatId);
      await this.sleep(delay);
      await this.client.stopTyping(chatId);
    } catch {
      try { await this.client.stopTyping(chatId); } catch { /* best-effort */ }
    }
  }

  async markAsRead(chatId: string, messageId?: string): Promise<void> {
    try {
      await this.client.sendSeen(chatId, messageId);
    } catch { /* best-effort */ }
  }

  private toChatId(phone: string): string {
    if (phone.includes('@c.us') || phone.includes('@lid')) {
      return phone;
    }
    return `${phone}@c.us`;
  }

  private interpolateTemplate(components: TemplateComponent[]): string {
    const body = components.find(c => c.type === 'body');
    if (!body) return '';

    return body.parameters.reduce<string>((text, param, i) => {
      return text.replace(`{{${i + 1}}}`, param.value);
    }, `Template[${body.parameters.map(p => p.value).join(', ')}]`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
