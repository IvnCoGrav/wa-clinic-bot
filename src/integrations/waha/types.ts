export interface WahaLocationPayload {
  latitude: number;
  longitude: number;
  description?: string;
}

export interface WahaMessagePayload {
  id: string;
  from: string; // Format WAHA: "628123456789@c.us"
  chatId?: string; // Alternatif field yang kadang dikirim WAHA di event outbound
  to?: string; // Present di outbound events
  fromMe: boolean;
  timestamp: number;
  body?: string;
  hasMedia?: boolean;
  location?: WahaLocationPayload;
  text?: { body: string }; // Structured text payload (dipakai message-rewrite attribution)
  message?: {
    imageMessage?: {
      caption?: string;
      mimetype?: string;
      url?: string;
    };
  };
  caption?: string;
  type?: string;
  _data?: {
    notifyName?: string;
  };
}

export interface WahaWebhookEvent {
  event: 'message' | 'message.any' | 'state.change';
  session: string;
  payload: WahaMessagePayload;
}
