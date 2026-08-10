import { NormalizedInboundMessage } from './gateway.types';
import type { WhatsAppStatus, WhatsAppWebhookPayload } from './types';

export function normalizeWabaPayload(
  payload: WhatsAppWebhookPayload,
  tenantId: string
): NormalizedInboundMessage[] {
  const results: NormalizedInboundMessage[] = [];

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value?.messages) continue;

      const contactName = value.contacts?.[0]?.profile?.name;
      const phoneNumberId = value.metadata?.phone_number_id;

      for (const msg of value.messages) {
        const fromNumber = msg.from;
        const timestamp = parseInt(msg.timestamp, 10) || Math.floor(Date.now() / 1000);

        let type: NormalizedInboundMessage['type'] = 'unknown';
        let text: string | undefined;
        let location: NormalizedInboundMessage['location'] | undefined;
        let mediaId: string | undefined;
        let caption: string | undefined;
        let mimeType: string | undefined;
        let referral: NormalizedInboundMessage['referral'] | undefined;

        if (msg.referral) {
          referral = {
            ctwaClid: msg.referral.ctwa_clid,
            sourceUrl: msg.referral.source_url,
            sourceType: msg.referral.source_type,
            headline: msg.referral.headline,
            body: msg.referral.body,
          };
        }

        if (msg.type === 'text' && msg.text) {
          type = 'text';
          text = msg.text.body;
        } else if (msg.type === 'location' && msg.location) {
          type = 'location';
          location = {
            latitude: msg.location.latitude,
            longitude: msg.location.longitude,
            name: msg.location.name,
            address: msg.location.address,
          };
        } else if (msg.type === 'image' && msg.image) {
          type = 'image';
          mediaId = msg.image.id;
          caption = msg.image.caption;
          mimeType = msg.image.mime_type;
        }

        results.push({
          tenantId,
          provider: 'WABA',
          messageId: msg.id,
          fromNumber,
          timestamp,
          type,
          text,
          location,
          mediaId,
          caption,
          mimeType,
          contactName,
          phoneNumberId,
          referral,
          rawPayload: msg,
        });
      }
    }
  }

  return results;
}

export interface NormalizedWabaStatus {
  messageId: string;
  status: WhatsAppStatus['status'];
  timestamp: number;
  errors?: WhatsAppStatus['errors'];
  phoneNumberId?: string;
}

export function normalizeWabaStatuses(payload: WhatsAppWebhookPayload): NormalizedWabaStatus[] {
  const results: NormalizedWabaStatus[] = [];

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value?.statuses) continue;

      const phoneNumberId = value.metadata?.phone_number_id;

      for (const status of value.statuses) {
        results.push({
          messageId: status.id,
          status: status.status,
          timestamp: parseInt(status.timestamp, 10) || Math.floor(Date.now() / 1000),
          errors: status.errors,
          phoneNumberId,
        });
      }
    }
  }

  return results;
}
