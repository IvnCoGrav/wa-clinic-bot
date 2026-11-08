import { prisma } from '../../db/client';
import { Direction } from '@prisma/client';

// In-Memory store fallback untuk idempotency check jika DB belum terkoneksi saat dev local.
// Batas FIFO agar tidak tumbuh tanpa batas (memory leak) pada proses long-running.
export const memoryWaMessageIds = new Set<string>();
export const MAX_MEMORY_WA_IDS = 5000;

// AUDIT FASE 3 (K-03): seluruh mutasi pesan/percakapan WAJIB tenant-scoped.
// `updateMany` dipakai karena `where` unik Prisma tidak menerima kolom non-unik.
// Tidak melempar saat count=0: baris yang hilang/berbeda tenant = no-op (fail-closed),
// bukan memicu fallback yang bisa menulis ke memori tenant lain.
export async function updateScopedMessage(id: string, tenantId: string, data: Record<string, any>) {
  return prisma.message.updateMany({ where: { id, tenant_id: tenantId }, data });
}

export async function updateScopedConversation(id: string, tenantId: string, data: Record<string, any>) {
  return prisma.conversation.updateMany({ where: { id, tenant_id: tenantId }, data });
}

export function addMemoryWaMessageId(key: string): void {
  if (!key) return;
  memoryWaMessageIds.add(key);
  while (memoryWaMessageIds.size > MAX_MEMORY_WA_IDS) {
    const oldest = memoryWaMessageIds.values().next().value as string | undefined;
    if (oldest === undefined) break;
    memoryWaMessageIds.delete(oldest);
  }
}

// In-Memory store fallback untuk record pesan (agar Live Chat panel tetap jalan saat DB offline).
// Batas FIFO (ring buffer) agar RAM tidak membengkak seiring bertambahnya percakapan.
export const memoryMessages: any[] = [];
export const MAX_MEMORY_MESSAGES = 500;

// In-Memory registry untuk bot outbound yang sedang dalam proses simulasi mengetik/kirim (in-flight)
export interface InFlightBotOutbound {
  chatId: string;
  phone: string;
  content: string;
  tenantId: string;
  expiresAt: number;
}
export const inFlightBotOutbounds: InFlightBotOutbound[] = [];

// F5: ledger wa_message_id pesan yang PASTI dikirim bot. Penentu utama bot-vs-admin
// (lebih andal daripada cocok-awalan konten yang bisa salah kategorikan balasan
// admin sebagai gema bot). In-memory per proses; bila multi-instance, DB/durable
// ledger tetap jalur utama via `isDuplicateMessage`.
export interface KnownBotMessageId {
  waMessageId: string;
  tenantId: string;
  expiresAt: number;
}
export const knownBotMessageIds: KnownBotMessageId[] = [];

// Sender default untuk payload Live Chat: outbound tanpa penanda = bot, inbound = customer
export function resolveSenderType(data: { direction: Direction; senderType?: string }): string {
  if (data.senderType) return data.senderType;
  return data.direction === Direction.OUTBOUND ? 'BOT' : 'CUSTOMER';
}

// Ambil metadata media (gambar, audio, dokumen, video) dari payload_raw untuk di-render dashboard.
export function extractMediaFromPayload(payloadRaw: any): any {
  const media = payloadRaw?.media;
  if (media && (media.url || media.hdUrl || media.mimeType || media.fileName || media.caption)) return media;
  return undefined;
}

// Ambil koordinat lokasi dari payload_raw untuk disiarkan ke Live Chat real-time.
export function extractLocationFromPayload(payloadRaw: any): any {
  if (!payloadRaw) return null;
  if (payloadRaw.location && typeof payloadRaw.location.latitude === 'number' && payloadRaw.location.latitude !== 0) {
    return payloadRaw.location;
  }
  if (typeof payloadRaw.latitude === 'number' && payloadRaw.latitude !== 0) {
    return { latitude: payloadRaw.latitude, longitude: payloadRaw.longitude };
  }
  const locMsg =
    payloadRaw._data?.message?.locationMessage ||
    payloadRaw.message?.locationMessage ||
    payloadRaw._data?.message?.liveLocationMessage ||
    payloadRaw.message?.liveLocationMessage;
  if (locMsg) {
    const lat = locMsg.degreesLatitude ?? locMsg.latitude;
    const lng = locMsg.degreesLongitude ?? locMsg.longitude;
    if (typeof lat === 'number' && lat !== 0) {
      return {
        latitude: lat,
        longitude: lng,
        address: locMsg.address,
        name: locMsg.name,
      };
    }
  }
  return null;
}

// Sanitasi payloadRaw untuk SSE agar tidak membawa data biner/base64 raksasa
export function sanitizePayloadForSse(payloadRaw: any): any {
  if (!payloadRaw || typeof payloadRaw !== 'object') return payloadRaw;
  const clone = { ...payloadRaw };
  if (clone._data?.jpegThumbnail) delete clone._data.jpegThumbnail;
  if (clone._data?.mediaData) delete clone._data.mediaData;
  if (clone.message?.imageMessage?.jpegThumbnail) delete clone.message.imageMessage.jpegThumbnail;
  if (clone.buffer) delete clone.buffer;
  return clone;
}

export function extractShortMessageId(waMessageId: string): string {
  if (!waMessageId) return '';
  const parts = waMessageId.split('_');
  if (parts.length >= 3 && (parts[0] === 'true' || parts[0] === 'false') && parts[1].includes('@')) {
    return parts[2];
  }
  const match = waMessageId.match(/(?:true|false)_[^@]+@[^_]+_([A-Za-z0-9_\-]+)$/);
  if (match) return match[1];
  return waMessageId;
}
