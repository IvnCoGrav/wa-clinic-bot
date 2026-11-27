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
        let buttonPayload: NormalizedInboundMessage['buttonPayload'] | undefined;

        if (msg.referral) {
          referral = {
            ctwaClid: msg.referral.ctwa_clid,
            sourceId: msg.referral.source_id,
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
        } else if (msg.type === 'reaction' && msg.reaction) {
          type = 'reaction';
          text = msg.reaction.emoji;
        } else if (msg.type === 'audio' && msg.audio) {
          type = msg.audio.voice ? 'voice_note' : 'audio';
          mediaId = msg.audio.id;
          mimeType = msg.audio.mime_type || (msg.audio.voice ? 'audio/ogg; codecs=opus' : 'audio/mp3');
        } else if (msg.type === 'document' && msg.document) {
          type = 'document';
          mediaId = msg.document.id;
          caption = msg.document.filename || msg.document.caption || 'Dokumen';
          mimeType = msg.document.mime_type || 'application/pdf';
        } else if (msg.type === 'video' && msg.video) {
          type = 'video';
          mediaId = msg.video.id;
          caption = msg.video.caption;
          mimeType = msg.video.mime_type || 'video/mp4';
        } else if (msg.type === 'sticker' && msg.sticker) {
          type = 'sticker';
          mediaId = msg.sticker.id;
          mimeType = msg.sticker.mime_type || 'image/webp';
        } else if (msg.type === 'contacts' && (msg as any).contacts) {
          type = 'contact';
          const c = (msg as any).contacts?.[0];
          text = c?.name?.formatted_name || c?.name?.first_name || 'Kontak';
        } else if (msg.type === 'interactive' && (msg as any).interactive) {
          const inter = (msg as any).interactive;
          type = 'interactive_button';
          if (inter.type === 'button_reply' && inter.button_reply) {
            text = inter.button_reply.title || inter.button_reply.id;
          } else if (inter.type === 'list_reply' && inter.list_reply) {
            text = inter.list_reply.title || inter.list_reply.id;
          }
        } else if (msg.type === 'button' && (msg as any).button) {
          // M02-13: balasan tombol template (quick reply) bukan `unknown`.
          // Judul tombol adalah pilihan customer → diteruskan sebagai teks.
          const button = (msg as any).button;
          type = 'interactive_button';
          text = button.text || button.payload || 'Pilihan';
          buttonPayload = { id: button.payload || '', title: button.text || '' };
        } else if (msg.type === 'order' && (msg as any).order) {
          // Order katalog WhatsApp: detail produk ada di `order`, bukan teks bebas.
          const order = (msg as any).order;
          const itemCount = Array.isArray(order.product_items) ? order.product_items.length : 0;
          type = 'order';
          text = itemCount > 0 ? `Pesanan katalog (${itemCount} item)` : 'Pesanan katalog';
        } else if (msg.type === 'system' && (msg as any).system) {
          // Notifikasi sistem (mis. customer mengganti nomor) — bukan pesan customer.
          type = 'system';
          text = (msg as any).system?.body || 'Pesan sistem WhatsApp';
        } else if (msg.type === 'unsupported') {
          type = 'unsupported';
          text = 'Pesan tidak didukung oleh gateway';
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
          buttonPayload,
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

/**
 * Konten kanonis untuk audit trail / Live Chat saat pesan WABA tidak punya teks.
 * M02-13: tipe yang dikenal HARUS punya label eksplisit — jangan jatuh ke `[IMAGE]`
 * (order/system/unsupported sebelumnya tampil seolah-olah customer mengirim gambar).
 */
export function buildWabaCanonicalContent(msg: NormalizedInboundMessage & { originalText?: string }): string {
  const anyMsg = msg as any;
  return (
    anyMsg.originalText ||
    // Tipe non-teks dipetakan eksplisit SEBELUM `msg.text` sintetis agar audit
    // trail tidak menyamarkan order/notifikasi sistem sebagai pesan biasa.
    (msg.type === 'order' ? `[ORDER: ${msg.text || 'Pesanan katalog'}]` : undefined) ||
    (msg.type === 'system' ? `[SYSTEM: ${msg.text || 'Pesan sistem'}]` : undefined) ||
    (msg.type === 'unsupported' ? '[UNSUPPORTED]' : undefined) ||
    msg.text ||
    (msg.location
      ? `[LOCATION: Lat ${msg.location.latitude}, Lng ${msg.location.longitude}${msg.location.address ? ` | ${msg.location.address}` : ''}]`
      : undefined) ||
    (msg.type === 'voice_note' ? '[VOICE_NOTE]' : undefined) ||
    (msg.type === 'audio' ? '[AUDIO]' : undefined) ||
    (msg.type === 'document' ? `[DOCUMENT: ${msg.caption || 'Dokumen'}]` : undefined) ||
    (msg.type === 'video' ? (msg.caption ? `[VIDEO: ${msg.caption}]` : '[VIDEO]') : undefined) ||
    (msg.type === 'sticker' ? '[STICKER]' : undefined) ||
    (msg.type === 'contact' ? `[CONTACT: ${msg.text || 'Kontak'}]` : undefined) ||
    (msg.caption ? `[IMAGE: ${msg.caption}]` : '[IMAGE]')
  );
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
