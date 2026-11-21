import { wahaClient, IWahaClient } from '../waha/client';
import {
  WhatsAppGateway,
  SendResult,
  TemplateComponent,
  TemplateParam,
} from './gateway.types';
import { isReplyIdFormatError } from '../../utils/whatsapp-message-id';

export class WahaGatewayDriver implements WhatsAppGateway {
  readonly providerType = 'WAHA' as const;
  readonly supportsRevoke = true;
  readonly supportsEdit = true;
  readonly supportsReaction = true;
  private client: IWahaClient;
  private tenantId: string;

  constructor(client?: IWahaClient, tenantId: string = 'default-tenant') {
    this.client = client || wahaClient;
    this.tenantId = tenantId;
  }

  /**
   * Helper pengiriman aman dengan reply-to fallback.
   * Bila WAHA menolak karena format reply_to message ID tidak valid,
   * otomatis kirim ulang 1x tanpa reply_to agar pesan utama customer tetap terkirim.
   */
  private async sendWithReplyFallback<T extends { success: boolean; messageId?: string; error?: string }>(
    send: (replyTo?: string) => Promise<T>,
    replyTo?: string
  ): Promise<T & { replyToDropped?: boolean }> {
    if (!replyTo) return send();
    const first = await send(replyTo);
    if (first.success) return first;
    if (!isReplyIdFormatError(first.error)) return first;

    console.warn(
      `[WAHA DRIVER] replyToMessageId=${replyTo} ditolak (${first.error}). ` +
        'Fallback mengirim pesan tanpa quote agar pesan utama tetap terkirim.'
    );
    const fallback = await send();
    return { ...fallback, replyToDropped: fallback.success };
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
        const res = await this.sendWithReplyFallback(
          (replyTo) => this.client.sendTextDetailed!(chatId, text, replyTo),
          options?.replyToMessageId
        );
        return {
          success: res.success,
          messageId: res.messageId,
          provider: 'WAHA',
          replyToDropped: res.replyToDropped,
          error: res.success ? undefined : { code: 'WAHA_SEND_TEXT', message: res.error || 'sendText failed' },
        };
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
    const { whatsappProviderService } = await import('../../services/whatsapp-provider.service');
    const isCutOff = await whatsappProviderService.isOutboundCutOff(this.tenantId);
    if (isCutOff) {
      return { success: false, error: 'Koneksi internal bot ke WAHA sedang diputus oleh Administrator (Cut-Off Darurat aktif).' };
    }

    const targetChatId = this.toChatId(chatId);
    try {
      const ok = await this.client.deleteMessage(targetChatId, messageId, everyone);
      return { success: ok };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Gagal menghapus pesan' };
    }
  }

  async editMessage(chatId: string, messageId: string, newText: string): Promise<{ success: boolean; error?: string }> {
    const { whatsappProviderService } = await import('../../services/whatsapp-provider.service');
    const isCutOff = await whatsappProviderService.isOutboundCutOff(this.tenantId);
    if (isCutOff) {
      return { success: false, error: 'Koneksi internal bot ke WAHA sedang diputus oleh Administrator (Cut-Off Darurat aktif).' };
    }

    const targetChatId = this.toChatId(chatId);
    try {
      const ok = await this.client.editMessage(targetChatId, messageId, newText);
      return { success: ok };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Gagal mengedit pesan' };
    }
  }

  async sendReactionMessage(to: string, messageId: string, emoji: string): Promise<SendResult> {
    const { whatsappProviderService } = await import('../../services/whatsapp-provider.service');
    const isCutOff = await whatsappProviderService.isOutboundCutOff(this.tenantId);
    if (isCutOff) {
      console.warn(`[WAHA CUT-OFF ACTIVE] Outbound reaction message to ${to} blocked by internal safety cut-off.`);
      return {
        success: false,
        provider: 'WAHA',
        error: { code: 'WAHA_INTERNAL_CUTOFF', message: 'Koneksi internal bot ke WAHA sedang diputus oleh Administrator (Cut-Off Darurat aktif).' },
      };
    }

    const targetChatId = this.toChatId(to);
    try {
      const ok = await this.client.sendReaction(targetChatId, messageId, emoji);
      return { success: ok, provider: 'WAHA' };
    } catch (err: any) {
      return {
        success: false,
        provider: 'WAHA',
        error: { code: 'WAHA_SEND_REACTION', message: err?.message || 'sendReaction failed' },
      };
    }
  }

  async sendTemplateMessage(
    _to: string,
    _templateName: string,
    _languageCode: string,
    _components: TemplateComponent[]
  ): Promise<SendResult> {
    // W-011: WAHA tidak punya API template Meta. Jangan mengirim teks palsu
    // `Template[...]` ke customer — beri kegagalan eksplisit agar pemanggil
    // memakai jalur teks biasa.
    return {
      success: false,
      provider: 'WAHA',
      error: {
        code: 'WAHA_TEMPLATE_UNSUPPORTED',
        message: 'WAHA tidak mendukung template Meta; gunakan pesan teks biasa.',
      },
    };
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
        const res = await this.sendWithReplyFallback(
          (replyTo) => this.client.sendImageDetailed!(chatId, imageUrl, caption, replyTo),
          options?.replyToMessageId
        );
        return {
          success: res.success,
          messageId: res.messageId,
          provider: 'WAHA',
          replyToDropped: res.replyToDropped,
          error: res.success ? undefined : { code: 'WAHA_SEND_IMAGE', message: res.error || 'sendImage failed' },
        };
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
    const { whatsappProviderService } = await import('../../services/whatsapp-provider.service');
    const isCutOff = await whatsappProviderService.isOutboundCutOff(this.tenantId);
    if (isCutOff) return;

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



  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
