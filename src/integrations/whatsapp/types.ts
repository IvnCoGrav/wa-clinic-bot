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
  timestamp: string;
  type: 'text' | 'location' | 'interactive' | 'unknown';
  text?: WhatsAppTextPayload;
  location?: WhatsAppLocationPayload;
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
