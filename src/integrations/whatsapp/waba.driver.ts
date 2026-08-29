import axios from 'axios';
import {
  WhatsAppGateway,
  SendResult,
  TemplateComponent,
} from './gateway.types';
import { GRAPH_API_VERSION, GRAPH_API_BASE_URL } from './graph.constants';
import { normalizeWhatsAppFormat } from '../../utils/whatsapp-format';

const TYPING_INDICATOR_MAX_MS = 25000;

export interface WabaGatewayDriverConfig {
  phoneNumberId: string;
  accessToken: string;
  baseUrl?: string;
  businessAccountId?: string;
}

export class WabaGatewayDriver implements WhatsAppGateway {
  readonly providerType = 'WABA' as const;
  readonly supportsRevoke = false;
  readonly supportsEdit = false;
  readonly supportsReaction = true;
  private phoneNumberId: string;
  private accessToken: string;
  private baseUrl: string;
  private recentTypingMessages = new Map<string, number>();

  constructor(config: WabaGatewayDriverConfig) {
    this.phoneNumberId = config.phoneNumberId;
    this.accessToken = config.accessToken;
    this.baseUrl = config.baseUrl || GRAPH_API_BASE_URL;
  }

  async deleteMessage(): Promise<{ success: boolean; error?: string }> {
    return {
      success: false,
      error: 'Meta Cloud API (WABA) tidak mendukung penghapusan pesan yang sudah terkirim (Revoke/Delete for Everyone).',
    };
  }

  async editMessage(): Promise<{ success: boolean; error?: string }> {
    return {
      success: false,
      error: 'Meta Cloud API (WABA) belum mendukung pengeditan pesan yang sudah terkirim via API.',
    };
  }

  async sendReactionMessage(to: string, messageId: string, emoji: string): Promise<SendResult> {
    try {
      const payload: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'reaction',
        reaction: {
          message_id: messageId,
          emoji: emoji || '',
        },
      };

      const response = await axios.post(
        this.messagesUrl,
        payload,
        { headers: this.headers, timeout: 10000 }
      );
      const msgId = response.data?.messages?.[0]?.id;
      return { success: true, messageId: msgId, provider: 'WABA', rawResponse: response.data };
    } catch (err: any) {
      const code = err?.response?.data?.error?.code?.toString() || 'WABA_SEND_REACTION';
      const message = err?.response?.data?.error?.message || err?.message || 'sendReaction failed';
      return { success: false, provider: 'WABA', error: { code, message } };
    }
  }

  async getProfilePicture(): Promise<string | null> {
    // Meta Cloud API for WhatsApp tidak menyediakan akses foto profil customer demi privasi Meta
    return null;
  }

  private get messagesUrl(): string {
    return `${this.baseUrl}/${GRAPH_API_VERSION}/${this.phoneNumberId}/messages`;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  async sendTextMessage(to: string, text: string, options?: { replyToMessageId?: string }): Promise<SendResult> {
    try {
      const payload: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        // Normalisasi markdown ganda (mis. **bold**) → formatting WhatsApp SATU tanda (*bold*)
        text: { preview_url: false, body: normalizeWhatsAppFormat(text) },
      };
      if (options?.replyToMessageId) {
        payload.context = { message_id: options.replyToMessageId };
      }

      const response = await axios.post(
        this.messagesUrl,
        payload,
        { headers: this.headers, timeout: 10000 }
      );
      const msgId = response.data?.messages?.[0]?.id;
      return { success: true, messageId: msgId, provider: 'WABA', rawResponse: response.data };
    } catch (err: any) {
      const code = err?.response?.data?.error?.code?.toString() || 'WABA_SEND_TEXT';
      const message = err?.response?.data?.error?.message || err?.message || 'sendText failed';
      const isRateLimit = code === '130429' || code === '131026';
      return { success: false, provider: 'WABA', error: { code, message, isRateLimit } };
    }
  }

  async sendTemplateMessage(
    to: string,
    templateName: string,
    languageCode: string,
    components: TemplateComponent[]
  ): Promise<SendResult> {
    const waComponents = components.map(c => ({
      type: c.type,
      parameters: c.parameters.map(p => ({
        type: p.type,
        [p.type === 'text' ? 'text' : 'payload']: p.value,
      })),
    }));

    try {
      const response = await axios.post(
        this.messagesUrl,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'template',
          template: {
            name: templateName,
            language: { code: languageCode },
            components: waComponents.length > 0 ? waComponents : undefined,
          },
        },
        { headers: this.headers, timeout: 10000 }
      );
      const msgId = response.data?.messages?.[0]?.id;
      return { success: true, messageId: msgId, provider: 'WABA', rawResponse: response.data };
    } catch (err: any) {
      const code = err?.response?.data?.error?.code?.toString() || 'WABA_SEND_TEMPLATE';
      const message = err?.response?.data?.error?.message || err?.message || 'sendTemplate failed';
      const isRateLimit = code === '130429' || code === '131026' || code === '131047';
      return { success: false, provider: 'WABA', error: { code, message, isRateLimit } };
    }
  }

  async sendImageMessage(to: string, imageUrl: string, caption?: string, options?: { replyToMessageId?: string }): Promise<SendResult> {
    try {
      const imagePayload: Record<string, unknown> = { link: imageUrl };
      const payload: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'image',
        image: { ...imagePayload, caption: caption || undefined },
      };
      if (options?.replyToMessageId) {
        payload.context = { message_id: options.replyToMessageId };
      }

      const response = await axios.post(
        this.messagesUrl,
        payload,
        { headers: this.headers, timeout: 15000 }
      );
      const msgId = response.data?.messages?.[0]?.id;
      return { success: true, messageId: msgId, provider: 'WABA', rawResponse: response.data };
    } catch (err: any) {
      const code = err?.response?.data?.error?.code?.toString() || 'WABA_SEND_IMAGE';
      const message = err?.response?.data?.error?.message || err?.message || 'sendImage failed';
      return { success: false, provider: 'WABA', error: { code, message } };
    }
  }

  async sendTypingIndicator(to: string, incomingMessageId?: string, durationMs?: number): Promise<void> {
    if (!incomingMessageId) return;

    const cappedDuration = Math.min(Math.max(0, durationMs ?? 3000), TYPING_INDICATOR_MAX_MS);
    this.recentTypingMessages.set(incomingMessageId, Date.now());

    try {
      await axios.post(
        this.messagesUrl,
        {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: incomingMessageId,
          typing_indicator: { type: 'text' },
        },
        { headers: this.headers, timeout: 5000 }
      );
      await this.sleep(cappedDuration);
    } catch {
      /* best-effort */
    }
  }

  async markAsRead(chatId: string, messageId?: string): Promise<void> {
    if (!messageId) return;
    if (this.recentTypingMessages.has(messageId)) {
      this.recentTypingMessages.delete(messageId);
      return;
    }
    try {
      await axios.post(
        this.messagesUrl,
        {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        },
        { headers: this.headers, timeout: 5000 }
      );
    } catch {
      /* best-effort */
    }
  }

  async verifyHubChallenge(query: Record<string, string | undefined>, verifyToken: string): Promise<string | null> {
    if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === verifyToken) {
      return query['hub.challenge'] || null;
    }
    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
