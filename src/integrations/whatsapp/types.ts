export interface WebhookVerificationQuery {
  'hub.mode'?: string;
  'hub.verify_token'?: string;
  'hub.challenge'?: string;
}

export interface WhatsAppLocationPayload {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface WhatsAppTextPayload {
  body: string;
}

export interface WhatsAppIncomingMessage {
  id: string;
  from: string; // Nomor HP pengirim (format internasional tanpa +, misal: 628123456789)
  chatId?: string; // JID chat WAHA asli (misal phone@c.us / phone@lid) — dipakai utk label lifecycle
  timestamp: string;
  type: 'text' | 'location' | 'image' | 'interactive' | 'reaction' | 'audio' | 'document' | 'video' | 'sticker' | 'contacts' | 'unknown';
  text?: WhatsAppTextPayload;
  location?: WhatsAppLocationPayload;
  image?: {
    id: string;
    mime_type?: string;
    sha256?: string;
    caption?: string;
  };
  audio?: {
    id: string;
    mime_type?: string;
    voice?: boolean;
  };
  document?: {
    id: string;
    mime_type?: string;
    filename?: string;
    caption?: string;
  };
  video?: {
    id: string;
    mime_type?: string;
    caption?: string;
  };
  sticker?: {
    id: string;
    mime_type?: string;
  };
  contacts?: Array<{
    name: {
      formatted_name: string;
      first_name?: string;
    };
    phones?: Array<{
      phone: string;
      wa_id?: string;
      type?: string;
    }>;
  }>;
  /** Payload reaksi emoji (Meta Cloud / WABA) */
  reaction?: {
    message_id: string;
    emoji: string;
  };
  /** Metadata media (gambar Live Chat): url/hdUrl relatif ke /media + mimeType + caption. */
  media?: {
    url?: string;
    hdUrl?: string;
    mimeType?: string;
    caption?: string | null;
  };
  /** Native Meta Click-to-WhatsApp (CTWA) referral payload */
  referral?: {
    source_url?: string;
    source_type?: string;
    source_id?: string;
    headline?: string;
    body?: string;
    ctwa_clid?: string;
  };
  originalText?: string;
  _rawBody?: string;
}

export interface WhatsAppStatus {
  id: string; // wamid pesan
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }>;
}

export interface WhatsAppWebhookValue {
  messaging_product: string;
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: Array<{
    profile: { name: string };
    wa_id: string;
  }>;
  messages?: WhatsAppIncomingMessage[];
  statuses?: WhatsAppStatus[];
}

export interface WhatsAppWebhookChange {
  value: WhatsAppWebhookValue;
  field: string;
}

export interface WhatsAppWebhookEntry {
  id: string;
  changes: WhatsAppWebhookChange[];
}

export interface WhatsAppWebhookPayload {
  object: string;
  entry: WhatsAppWebhookEntry[];
}
