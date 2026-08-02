export type WhatsAppProvider = 'WAHA' | 'WABA';

export interface SendResult {
  success: boolean;
  messageId?: string;
  provider: WhatsAppProvider;
  rawResponse?: unknown;
  error?: { code: string; message: string; isRateLimit?: boolean };
}

export interface TemplateParam {
  type: 'text' | 'currency' | 'date_time';
  value: string;
}

export interface TemplateComponent {
  type: 'header' | 'body' | 'button';
  parameters: TemplateParam[];
}

export interface WhatsAppGateway {
  readonly providerType: WhatsAppProvider;

  sendTextMessage(to: string, text: string): Promise<SendResult>;

  sendTemplateMessage(
    to: string,
    templateName: string,
    languageCode: string,
    components: TemplateComponent[]
  ): Promise<SendResult>;

  sendImageMessage(to: string, imageUrl: string, caption?: string): Promise<SendResult>;

  sendTypingIndicator(to: string, incomingMessageId?: string, durationMs?: number): Promise<void>;

  markAsRead(chatId: string, messageId?: string): Promise<void>;
}

export interface NormalizedInboundMessage {
  tenantId: string;
  provider: WhatsAppProvider;
  messageId: string;
  fromNumber: string;
  timestamp: number;
  type: 'text' | 'location' | 'image' | 'unknown';
  text?: string;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  mediaUrl?: string;
  contactName?: string;
  rawPayload: unknown;
}
