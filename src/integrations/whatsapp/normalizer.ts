import { NormalizedInboundMessage } from './gateway.types';
import type { WhatsAppWebhookPayload } from './types';

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

      for (const msg of value.messages) {
        const fromNumber = msg.from;
        const timestamp = parseInt(msg.timestamp, 10) || Math.floor(Date.now() / 1000);

        let type: NormalizedInboundMessage['type'] = 'unknown';
        let text: string | undefined;
        let location: NormalizedInboundMessage['location'] | undefined;
        let mediaUrl: string | undefined;

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
        } else if ((msg as any).type === 'image') {
          type = 'image';
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
          mediaUrl,
          contactName,
          rawPayload: msg,
        });
      }
    }
  }

  return results;
}
