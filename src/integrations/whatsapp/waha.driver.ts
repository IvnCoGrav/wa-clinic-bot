import { wahaClient, IWahaClient } from '../waha/client';
import {
  WhatsAppGateway,
  SendResult,
  TemplateComponent,
  TemplateParam,
} from './gateway.types';

export class WahaGatewayDriver implements WhatsAppGateway {
  readonly providerType = 'WAHA' as const;
  readonly supportsRevoke = true;
  readonly supportsEdit = true;
  private client: IWahaClient;
  private tenantId: string;

  constructor(client?: IWahaClient, tenantId: string = 'default-tenant') {
    this.client = client || wahaClient;
    this.tenantId = tenantId;
  }

  async sendTextMessage(to: string, text: string, options?: { replyToMessageId?: string }): Promise<SendResult> {
    const { whatsappProviderService } = await import('../../services/whatsapp-provider.service');
    const isCutOff = await whatsappProviderService.isOutboundCutOff(this.tenantId);
    if (isCutOff) {
      console.warn(`[WAHA CUT-OFF ACTIVE] Outbound text message to ${to} blocked by internal safety cut-off. Real WAHA session remains active.`);
      return {
        success: false,
        provider: 'WAHA',
        error: { code: 'WAHA_INTERNAL_CUTOFF', message: 'Koneksi internal bot ke WAHA sedang diputus oleh Administrator (Cut-Off Darurat aktif).' },
      };
    }

    const chatId = this.toChatId(to);
    try {
      if (typeof this.client.sendTextDetailed === 'function') {
        const res = options?.replyToMessageId
          ? await this.client.sendTextDetailed(chatId, text, options.replyToMessageId)
          : await this.client.sendTextDetailed(chatId, text);
        return { success: res.success, messageId: res.messageId, provider: 'WAHA' };
      }
      const ok = options?.replyToMessageId
        ? await this.client.sendText(chatId, text, options.replyToMessageId)
        : await this.client.sendText(chatId, text);
      return { success: ok, provider: 'WAHA' };
    } catch (err: any) {
      return {
        success: false,
        provider: 'WAHA',
        error: { code: 'WAHA_SEND_TEXT', message: err?.message || 'sendText failed' },
      };
    }
  }

  async deleteMessage(chatId: string, messageId: string, everyone = true): Promise<{ success: boolean; error?: string }> {
    const targetChatId = this.toChatId(chatId);
    try {
      const ok = await this.client.deleteMessage(targetChatId, messageId, everyone);
      return { success: ok };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Gagal menghapus pesan' };
    }
  }

  async editMessage(chatId: string, messageId: string, newText: string): Promise<{ success: boolean; error?: string }> {
    const targetChatId = this.toChatId(chatId);
    try {
      const ok = await this.client.editMessage(targetChatId, messageId, newText);
      return { success: ok };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Gagal mengedit pesan' };
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

  async sendImageMessage(to: string, imageUrl: string, caption?: string, options?: { replyToMessageId?: string }): Promise<SendResult> {
    const { whatsappProviderService } = await import('../../services/whatsapp-provider.service');
    const isCutOff = await whatsappProviderService.isOutboundCutOff(this.tenantId);
    if (isCutOff) {
      console.warn(`[WAHA CUT-OFF ACTIVE] Outbound image message to ${to} blocked by internal safety cut-off.`);
      return {
        success: false,
        provider: 'WAHA',
        error: { code: 'WAHA_INTERNAL_CUTOFF', message: 'Koneksi internal bot ke WAHA sedang diputus oleh Administrator (Cut-Off Darurat aktif).' },
      };
    }

    const chatId = this.toChatId(to);
    try {
      if (typeof this.client.sendImageDetailed === 'function') {
        const res = options?.replyToMessageId
          ? await this.client.sendImageDetailed(chatId, imageUrl, caption, options.replyToMessageId)
          : await this.client.sendImageDetailed(chatId, imageUrl, caption);
        return { success: res.success, messageId: res.messageId, provider: 'WAHA' };
      }
      const ok = options?.replyToMessageId
        ? await this.client.sendImage(chatId, imageUrl, caption, options.replyToMessageId)
        : await this.client.sendImage(chatId, imageUrl, caption);
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
    const { whatsappProviderService } = await import('../../services/whatsapp-provider.service');
    const isCutOff = await whatsappProviderService.isOutboundCutOff(this.tenantId);
    if (isCutOff) return;

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

  async getProfilePicture(phone: string): Promise<string | null> {
    try {
      if (typeof this.client.getProfilePicture === 'function') {
        return await this.client.getProfilePicture(phone);
      }
      return null;
    } catch {
      return null;
    }
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
