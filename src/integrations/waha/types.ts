export interface WahaLocationPayload {
  latitude: number;
  longitude: number;
  description?: string;
}

export interface WahaMessagePayload {
  id: string;
  from: string; // Format WAHA: "628123456789@c.us"
  fromMe: boolean;
  timestamp: number;
  body?: string;
  hasMedia?: boolean;
  location?: WahaLocationPayload;
  _data?: {
    notifyName?: string;
  };
}

export interface WahaWebhookEvent {
  event: 'message' | 'message.any' | 'state.change';
  session: string;
  payload: WahaMessagePayload;
}
