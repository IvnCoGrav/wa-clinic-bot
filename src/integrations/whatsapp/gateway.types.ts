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
  readonly supportsRevoke: boolean;
  readonly supportsEdit: boolean;

  sendTextMessage(to: string, text: string, options?: { replyToMessageId?: string }): Promise<SendResult>;

  sendTemplateMessage(
    to: string,
    templateName: string,
    languageCode: string,
    components: TemplateComponent[]
  ): Promise<SendResult>;

  sendImageMessage(to: string, imageUrl: string, caption?: string, options?: { replyToMessageId?: string }): Promise<SendResult>;

  sendTypingIndicator(to: string, incomingMessageId?: string, durationMs?: number): Promise<void>;

  markAsRead(chatId: string, messageId?: string): Promise<void>;

  deleteMessage(chatId: string, messageId: string, everyone?: boolean): Promise<{ success: boolean; error?: string }>;
  editMessage(chatId: string, messageId: string, newText: string): Promise<{ success: boolean; error?: string }>;
  getProfilePicture?(phone: string): Promise<string | null>;
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
  mediaId?: string;
  caption?: string;
  mimeType?: string;
  contactName?: string;
  phoneNumberId?: string;
  referral?: {
    ctwaClid?: string;
    sourceUrl?: string;
    sourceType?: string;
    headline?: string;
    body?: string;
  };
  rawPayload: unknown;
}
