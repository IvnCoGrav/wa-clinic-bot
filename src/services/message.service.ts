import { prisma } from '../db/client';
import { Direction, Prisma } from '@prisma/client';
import { getLiveChatHub } from './live-chat-hub.service';
import { isDummyOrTestContact } from '../utils/dummy-filter';
import { responseCacheService } from './response-cache.service';

// In-Memory store fallback untuk idempotency check jika DB belum terkoneksi saat dev local.
// Batas FIFO agar tidak tumbuh tanpa batas (memory leak) pada proses long-running.
const memoryWaMessageIds = new Set<string>();
const MAX_MEMORY_WA_IDS = 5000;

function addMemoryWaMessageId(key: string): void {
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
const memoryMessages: any[] = [];
const MAX_MEMORY_MESSAGES = 500;

// In-Memory registry untuk bot outbound yang sedang dalam proses simulasi mengetik/kirim (in-flight)
interface InFlightBotOutbound {
  chatId: string;
  phone: string;
  content: string;
  tenantId: string;
  expiresAt: number;
}
const inFlightBotOutbounds: InFlightBotOutbound[] = [];

// F5: ledger wa_message_id pesan yang PASTI dikirim bot. Penentu utama bot-vs-admin
// (lebih andal daripada cocok-awalan konten yang bisa salah kategorikan balasan
// admin sebagai gema bot). In-memory per proses; bila multi-instance, DB/durable
// ledger tetap jalur utama via `isDuplicateMessage`.
interface KnownBotMessageId {
  waMessageId: string;
  tenantId: string;
  expiresAt: number;
}
const knownBotMessageIds: KnownBotMessageId[] = [];

// Sender default untuk payload Live Chat: outbound tanpa penanda = bot, inbound = customer
function resolveSenderType(data: { direction: Direction; senderType?: string }): string {
  if (data.senderType) return data.senderType;
  return data.direction === Direction.OUTBOUND ? 'BOT' : 'CUSTOMER';
}

// Ambil metadata media (gambar, audio, dokumen, video) dari payload_raw untuk di-render dashboard.
function extractMediaFromPayload(payloadRaw: any): any {
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

export class MessageService {
  /**
   * Daftarkan konten outbound bot sebelum atau saat sedang proses pengiriman bubble (in-flight).
   * Mencegah webhook echo dari WAHA salah mendeteksi bubble bot sebagai balasan manual admin.
   */
  public registerInFlightBotOutbound(chatId: string, content: string, tenantId: string, ttlMs = 45000): void {
    if (!chatId || !content) return;
    const cleanPhone = chatId.replace(/@.*$/, '').replace(/[^\d]/g, '');
    const cleanContent = content.trim();
    if (!cleanContent) return;

    const expiresAt = Date.now() + ttlMs;
    inFlightBotOutbounds.push({
      chatId,
      phone: cleanPhone,
      content: cleanContent,
      tenantId,
      expiresAt,
    });
  }

  /**
   * Hapus registrasi in-flight bot outbound setelah pengiriman selesai/dibatalkan.
   */
  public clearInFlightBotOutbound(chatId: string, tenantId?: string): void {
    const cleanPhone = chatId ? chatId.replace(/@.*$/, '').replace(/[^\d]/g, '') : '';
    const now = Date.now();
    for (let i = inFlightBotOutbounds.length - 1; i >= 0; i--) {
      const entry = inFlightBotOutbounds[i];
      if (entry.expiresAt <= now || (cleanPhone && entry.phone === cleanPhone && (!tenantId || entry.tenantId === tenantId))) {
        inFlightBotOutbounds.splice(i, 1);
      }
    }
  }

  /**
   * Pengecekan apakah pesan outbound yang diterima di webhook merupakan bubble bot yang sedang in-flight.
   */
  public isInFlightBotOutbound(
    chatIdOrPhone: string,
    content: string,
    tenantId: string,
    customWindowMs = 60000
  ): boolean {
    if (!chatIdOrPhone || !content) return false;
    const cleanPhone = chatIdOrPhone.replace(/@.*$/, '').replace(/[^\d]/g, '');
    const normalizedContent = content.trim().toLowerCase().replace(/\s+/g, ' ');
    const now = Date.now();

    // Cleanup expired
    for (let i = inFlightBotOutbounds.length - 1; i >= 0; i--) {
      if (inFlightBotOutbounds[i].expiresAt <= now) {
        inFlightBotOutbounds.splice(i, 1);
      }
    }

    const matched = inFlightBotOutbounds.find((entry) => {
      if (tenantId && entry.tenantId !== tenantId) return false;
      const phoneMatch = !cleanPhone || !entry.phone || entry.phone === cleanPhone || entry.chatId.includes(cleanPhone);
      if (!phoneMatch) return false;

      // Custom window check jika ditentukan
      if (customWindowMs && now - (entry.expiresAt - 60000) > customWindowMs) {
        return false;
      }

      const entryNorm = entry.content.toLowerCase().trim().replace(/\s+/g, ' ');
      if (entryNorm === normalizedContent) return true;

      // Substring / prefix match (antisipasi WAHA memotong/trimming teks)
      const checkLen = Math.min(entryNorm.length, normalizedContent.length, 60);
      if (checkLen >= 15 && entryNorm.slice(0, checkLen) === normalizedContent.slice(0, checkLen)) {
        return true;
      }
      return false;
    });

    if (matched) {
      console.log(`[IN-FLIGHT BOT MATCH] Outbound echo matched in-flight bot bubble for ${chatIdOrPhone}: "${content.slice(0, 40)}..."`);
      return true;
    }

    return false;
  }
  /**
   * F5: daftarkan wa_message_id yang PASTI dikirim bot (dari hasil send).
   * Dipakai sebagai penentu utama bot-vs-admin (anti salah-kategorikan gema).
   */
  public registerKnownBotMessageId(waMessageId: string, tenantId: string, ttlMs = 6 * 60 * 60 * 1000): void {
    if (!waMessageId) return;
    const now = Date.now();
    for (let i = knownBotMessageIds.length - 1; i >= 0; i--) {
      if (knownBotMessageIds[i].expiresAt <= now) knownBotMessageIds.splice(i, 1);
    }
    knownBotMessageIds.push({ waMessageId, tenantId, expiresAt: now + ttlMs });
  }

  /** F5: cek apakah wa_message_id ini diketahui pesan bot (penentu utama). */
  public isKnownBotMessageId(waMessageId: string, tenantId?: string): boolean {
    if (!waMessageId) return false;
    const now = Date.now();
    for (let i = knownBotMessageIds.length - 1; i >= 0; i--) {
      if (knownBotMessageIds[i].expiresAt <= now) knownBotMessageIds.splice(i, 1);
    }
    return knownBotMessageIds.some(
      (e) => e.waMessageId === waMessageId && (!tenantId || e.tenantId === tenantId)
    );
  }

  /**
   * Pengecekan Idempotensi: Memeriksa apakah wa_message_id dari Meta sudah pernah diproses.
   * Mengembalikan true jika pesan SUDAH PERNAH diproses sebelumnya (duplicate/retry).
   */
  public async isDuplicateMessage(waMessageId: string, tenantId: string): Promise<boolean> {
    if (!waMessageId) return false;

    const shortId = extractShortMessageId(waMessageId);
    const keysToCheck = [
      `${tenantId}:${waMessageId}`,
      shortId !== waMessageId ? `${tenantId}:${shortId}` : null,
    ].filter(Boolean) as string[];

    try {
      // 1. Cek DB dulu — otoritas lintas-instance (bukan Set memori).
      const { getMessageRepository } = await import('../repositories/message.repository');
      const exists = await getMessageRepository().existsByWaId(waMessageId, shortId, tenantId);
      if (exists) {
        // sinkronkan ke memori untuk dedup in-flight berikutnya
        for (const key of keysToCheck) addMemoryWaMessageId(key);
        return true;
      }
    } catch (error) {
      // DB offline → fallback ke memori
      for (const key of keysToCheck) {
        if (memoryWaMessageIds.has(key)) return true;
      }
      return false;
    }

    // 2. Belum ada di DB → kunci in-flight di memori untuk request paralel di proses yang sama
    for (const key of keysToCheck) addMemoryWaMessageId(key);
    return false;
  }

  /**
   * Pengecekan deduplikasi outbound: memeriksa apakah pesan outbound dengan konten serupa
   * baru saja dicatat (misal via Live Chat / Staff Dashboard) dalam window detik tertentu.
   * Jika ada, tautkan wa_message_id pesan tersebut agar tidak membuat baris baru ganda di database.
   */
  public async checkAndAttachOutboundDuplicate(
    conversationId: string,
    content: string,
    waMessageId: string,
    tenantId: string,
    windowSeconds = 60,
    isMediaOrImage = false
  ): Promise<boolean> {
    const cutoff = new Date(Date.now() - windowSeconds * 1000);
    const normalizedContent = (content || '').trim();
    const isMediaPlaceholder =
      isMediaOrImage ||
      !normalizedContent ||
      /^\[(IMAGE|MEDIA|GAMBAR|VOICE_NOTE|AUDIO|DOCUMENT|VIDEO|DOKUMEN)/i.test(normalizedContent);
    const strippedCaption = normalizedContent.replace(
      /^\[(IMAGE|MEDIA|GAMBAR|VOICE_NOTE|AUDIO|DOCUMENT|VIDEO|DOKUMEN)(?::\s*([^\]]+))?\]/i,
      '$2'
    ).trim();
    const shortId = extractShortMessageId(waMessageId);

    // 1. Cek memoryMessages fallback
    const memMsg = memoryMessages.find(
      (m) =>
        m.conversation_id === conversationId &&
        m.tenant_id === tenantId &&
        m.direction === 'OUTBOUND' &&
        new Date(m.created_at) >= cutoff &&
        (
          (isMediaPlaceholder && (
            !m.content ||
            /^\[(IMAGE|MEDIA|GAMBAR|VOICE_NOTE|AUDIO|DOCUMENT|VIDEO|DOKUMEN)/i.test((m.content || '').trim()) ||
            !!(m.payload_raw as any)?.media ||
            (m.content || '').toLowerCase().startsWith('pricelist') ||
            (strippedCaption && (m.content || '').trim().toLowerCase() === strippedCaption.toLowerCase())
          )) ||
          (!isMediaPlaceholder && (
            (m.content || '').trim().toLowerCase() === normalizedContent.toLowerCase() ||
            (normalizedContent.length >= 20 && (m.content || '').toLowerCase().includes(normalizedContent.toLowerCase()))
          ))
        )
    );
    if (memMsg) {
      if (!memMsg.wa_message_id && waMessageId) {
        memMsg.wa_message_id = waMessageId;
        addMemoryWaMessageId(`${tenantId}:${waMessageId}`);
        if (shortId && shortId !== waMessageId) {
          addMemoryWaMessageId(`${tenantId}:${shortId}`);
        }
      }
      return true;
    }

    // 2. Cek DB Prisma
    try {
      let whereClause: any = {
        conversation_id: conversationId,
        tenant_id: tenantId,
        direction: 'OUTBOUND',
        created_at: { gte: cutoff },
      };

      if (isMediaPlaceholder) {
        whereClause.OR = [
          { content: { startsWith: '[IMAGE' } },
          { content: { startsWith: '[MEDIA' } },
          { content: { startsWith: '[GAMBAR' } },
          { content: { startsWith: '[VOICE_NOTE' } },
          { content: { startsWith: '[AUDIO' } },
          { content: { startsWith: '[DOCUMENT' } },
          { content: { startsWith: '[VIDEO' } },
          { content: { startsWith: '[DOKUMEN' } },
          { content: '[IMAGE]' },
          { content: '[MEDIA]' },
          { content: '[VOICE_NOTE]' },
          { content: '[AUDIO]' },
          { content: '[DOCUMENT]' },
          { content: '[VIDEO]' },
          { content: { startsWith: 'Pricelist', mode: 'insensitive' } },
          ...(strippedCaption ? [
            { content: { equals: strippedCaption, mode: 'insensitive' } },
            { content: { contains: strippedCaption, mode: 'insensitive' } },
          ] : []),
          ...(normalizedContent ? [
            { content: { equals: normalizedContent, mode: 'insensitive' } },
            { content: { contains: normalizedContent, mode: 'insensitive' } },
          ] : []),
        ];
      } else if (normalizedContent.length >= 20) {
        whereClause.OR = [
          { content: { equals: normalizedContent, mode: 'insensitive' } },
          { content: { contains: normalizedContent, mode: 'insensitive' } },
        ];
      } else {
        whereClause.content = {
          equals: normalizedContent,
          mode: 'insensitive',
        };
      }

      const existing = await prisma.message.findFirst({
        where: whereClause,
        orderBy: { created_at: 'desc' },
      });

      if (existing) {
        if (!existing.wa_message_id && waMessageId) {
          await prisma.message.update({
            where: { id: existing.id },
            data: { wa_message_id: waMessageId },
          });
        }
        addMemoryWaMessageId(`${tenantId}:${waMessageId}`);
        if (shortId && shortId !== waMessageId) {
          addMemoryWaMessageId(`${tenantId}:${shortId}`);
        }
        return true;
      }
    } catch (_) {}

    return false;
  }

  /**
   * Menyimpan record pesan (Audit Trail) ke tabel messages dan menambahkan wa_message_id ke idempotency store.
   */
  public async logMessage(data: {
    conversationId: string;
    direction: Direction;
    content: string;
    waMessageId?: string;
    payloadRaw?: any;
    tenantId: string;
    senderType?: string;
    senderName?: string;
    deliveryStatus?: 'sent' | 'delivered' | 'read' | 'failed';
    metaErrorCode?: string;
    metaErrorDesc?: string;
    skipMqlEvaluation?: boolean;
    createdAt?: Date;
    readAt?: Date | null;
    isHistorical?: boolean;
  }) {
    if (data.waMessageId) {
      addMemoryWaMessageId(`${data.tenantId}:${data.waMessageId}`);
      const shortId = extractShortMessageId(data.waMessageId);
      if (shortId && shortId !== data.waMessageId) {
        addMemoryWaMessageId(`${data.tenantId}:${shortId}`);
      }
    }

    const effectiveMsgDate = data.createdAt || new Date();
    const effectiveReadAt = data.readAt !== undefined
      ? data.readAt
      : data.isHistorical
        ? effectiveMsgDate
        : undefined;

    let saved: any = null;
    // PLAN 8 FASE 5c: tulis via Repository seam (fail-closed di produksi).
    // DB error → THROW (pemanggil/queue menangani via retry), BUKAN objek fiktif.
    const repo = (await import('../repositories/message.repository')).getMessageRepository();
    const [savedMsg] = await Promise.all([
      repo.create({
        tenant_id: data.tenantId,
        conversation_id: data.conversationId,
        direction: data.direction,
        content: data.content,
        wa_message_id: data.waMessageId || null,
        payload_raw: data.payloadRaw ? JSON.parse(JSON.stringify(data.payloadRaw)) : undefined,
        sender_type: data.senderType ?? (data.direction === 'INBOUND' || (data.direction as any) === Direction.INBOUND ? 'CUSTOMER' : 'BOT'),
        sender_name: data.senderName ?? undefined,
        delivery_status: data.deliveryStatus ?? undefined,
        meta_error_code: data.metaErrorCode ?? undefined,
        meta_error_desc: data.metaErrorDesc ?? undefined,
        created_at: data.createdAt || undefined,
        read_at: effectiveReadAt ?? undefined,
      }),
      prisma.conversation?.update
        ? prisma.conversation
            .update({
              where: { id: data.conversationId },
              data: {
                last_message_at: effectiveMsgDate,
                updated_at: new Date(),
              },
            })
            ?.catch?.((convErr: any) => {
              console.warn('[MESSAGE LOG CONV UPDATE WARN]', convErr.message);
            })
        : Promise.resolve(),
    ]);
    saved = savedMsg;
    if (!saved) {
      throw new Error('Prisma create returned null/undefined (DB offline)');
    }
    memoryMessages.push(saved);
    // FIFO ring buffer: buang record tertua agar RAM tidak tumbuh tanpa batas.
    if (memoryMessages.length > MAX_MEMORY_MESSAGES) {
      memoryMessages.splice(0, memoryMessages.length - MAX_MEMORY_MESSAGES);
    }

    // Efek samping pasca-simpan (dulu blok finally): resolusi sandbox, MQL,
    // reschedule follow-up, publish livechat, web push. Semua best-effort dengan
    // try/catch sendiri — kegagalannya tidak membatalkan penyimpanan yang sukses.
    {
      // Resolusi info customer & deteksi apakah berasal dari percakapan Sandbox/QA Test
      let isSandboxCustomer = false;
      // Staf internal (CS/Bidan via nomor resmi klinik) — diperlakukan seperti non-pelanggan:
      // tidak memicu MQL, follow-up, push CRM, atau CAPI.
      let isInternalStaff = false;
      let resolvedCustomer: any = null;
      let conversationForSse: any = null;
      try {
        const { conversationService } = await import('./conversation.service');
        const { customerService } = await import('./customer.service');
        const conv = await conversationService.getConversationById(data.conversationId, data.tenantId);
        conversationForSse = conv;
        if (conv?.customer_id) {
          resolvedCustomer = await customerService.getCustomerById(conv.customer_id, data.tenantId);
          if (resolvedCustomer) {
            isInternalStaff = Boolean(resolvedCustomer.is_internal_staff);
            isSandboxCustomer = Boolean(
              resolvedCustomer.is_sandbox_test ||
              isDummyOrTestContact(resolvedCustomer.phone, resolvedCustomer.name, resolvedCustomer.is_sandbox_test)
            );
          }
        }
      } catch {}

      // Non-pelanggan = sandbox/QA test ATAU staf internal → tidak ada otomasi CRM.
      const isNonCustomer = isSandboxCustomer || isInternalStaff;

      // Jika pesan INBOUND (dari customer) dan bukan sinkronisasi riwayat masa lalu (skipMqlEvaluation), increment bubble count & evaluasi status MQL (hanya customer riil)
      if (!data.skipMqlEvaluation && (data.direction === Direction.INBOUND || (data.direction as string) === 'INBOUND')) {
        try {
          const { customerService } = await import('./customer.service');
          if (resolvedCustomer?.id && !isNonCustomer) {
            customerService.incrementCustomerMessageCount(resolvedCustomer.id, data.tenantId).catch(() => {});
          }
        } catch (mqlErr: any) {
          console.warn('[MQL] Failed to increment bubble count:', mqlErr.message);
        }
      }

      // Event-Driven Last-Chat Sliding Window: pesan masuk riil customer menggeser
      // jadwal NO_PURCHASE aktif agar selalu relatif ke chat terakhir (bukan chat pertama).
      // Fire-and-forget: tidak memblokir alur webhook/state-machine; riwayat/sandbox/staf internal dikecualikan.
      if (
        !data.skipMqlEvaluation &&
        !data.isHistorical &&
        (data.direction === Direction.INBOUND || (data.direction as string) === 'INBOUND') &&
        resolvedCustomer?.id &&
        !isNonCustomer
      ) {
        void (async () => {
          try {
            const { followUpService } = await import('./follow-up.service');
            await followUpService.rescheduleNoPurchaseOnInboundChat(
              resolvedCustomer.id,
              data.tenantId,
              effectiveMsgDate
            );
          } catch (_) {}
        })();
      }

      // Live Chat publish: fire-and-forget, tidak memblokir alur webhook/state-machine.
      getLiveChatHub()
        .publish({
          type: 'message.created',
          tenantId: data.tenantId,
          payload: {
            conversationId: data.conversationId,
            direction: data.direction,
            content: data.content,
            senderType: resolveSenderType(data),
            senderName: data.senderName || resolvedCustomer?.name || null,
            messageId: saved?.id || null,
            waMessageId: data.waMessageId || null,
            createdAt: saved?.created_at || new Date(),
            media: extractMediaFromPayload(data.payloadRaw),
            location: extractLocationFromPayload(data.payloadRaw),
            contact: data.payloadRaw?.contact || undefined,
            payloadRaw: sanitizePayloadForSse(data.payloadRaw),
            isHistorical: !!data.isHistorical,
            isSandboxTest: isSandboxCustomer,
            isInternalStaff: isInternalStaff,
            // State kendali percakapan (AI Bot vs Manusia) — dipakai PWA terapis untuk
            // memutuskan apakah pesan ini layak memicu suara/banner (hanya saat eskalasi manusia).
            isHumanHandling: Boolean(
              conversationForSse?.is_human_handling ||
                (conversationForSse as any)?.current_state === 'HUMAN_HANDLING'
            ),
          },
        })
        .catch(() => {});

      // Invalidate live chat cached lists & unread badge for instant update
      responseCacheService.invalidatePrefix('livechat:');

      // Web Push Background Notification: delegasikan ke InboundNotificationRouter untuk isolasi peran dan routing terarah
      // Staf internal dikecualikan (percakapan koordinasi CS/Bidan bukan tiket CRM pelanggan).
      if ((data.direction === 'INBOUND' || (data.direction as any) === Direction.INBOUND) && !data.isHistorical && !isNonCustomer) {
        void (async () => {
          try {
            const { inboundNotificationRouter } = await import('./inbound-notification-router.service');
            await inboundNotificationRouter.routeInboundMessage({
              tenantId: data.tenantId,
              conversationId: data.conversationId,
              customerId: resolvedCustomer?.id || '',
              senderName: resolvedCustomer?.name || data.senderName || 'Pelanggan',
              content: data.content,
              payloadRaw: data.payloadRaw,
            });
          } catch {}
        })();
      }
    }

    return saved;
  }

  /**
   * Hapus pesan milik percakapan tertentu dari memory fallback store (dipakai saat
   * hard wipe /reset supaya tidak menyisakan pesan stale di memori / live chat).
   */
  public clearMessageMemory(conversationId: string): void {
    for (let i = memoryMessages.length - 1; i >= 0; i--) {
      if (memoryMessages[i].conversation_id === conversationId) {
        memoryMessages.splice(i, 1);
      }
    }
  }

  /**
   * Mengambil pesan inbound (masuk) terakhir dari customer untuk thread percakapan tertentu.
   */
  public async getLastInboundMessage(conversationId: string, tenantId: string): Promise<any> {
    try {
      return await prisma.message.findFirst({
        where: { conversation_id: conversationId, tenant_id: tenantId, direction: Direction.INBOUND },
        orderBy: { created_at: 'desc' },
      });
    } catch (error) {
      return null;
    }
  }

  /**
   * Mengambil satu pesan berdasarkan ID internal atau wa_message_id (DB dengan in-memory fallback).
   */
  public async getMessageById(messageId: string, tenantId: string): Promise<any | null> {
    if (!messageId) return null;
    try {
      const message = await prisma.message.findFirst({
        where: {
          OR: [
            { id: messageId },
            { wa_message_id: messageId },
          ],
          tenant_id: tenantId,
        },
      });
      if (message) return message;
    } catch (_) {}

    // Fallback memory store
    const found = memoryMessages.find(
      (m) =>
        (m.id === messageId || m.wa_message_id === messageId) &&
        m.tenant_id === tenantId
    );
    return found || null;
  }

  /**
   * Melampirkan metadata media ke record pesan yang sudah tersimpan (dipakai jalur
   * unduhan BACKGROUND media berat: video/audio/dokumen). Meng-update payload_raw.media
   * di DB + memory fallback, lalu menyiarkan `message.updated` agar bubble yang sudah
   * tampil di Live Chat langsung memperoleh player audio / tautan unduhan tanpa refresh.
   *
   * Idempoten & best-effort: tidak pernah melempar ke pemanggil fire-and-forget.
   */
  public async attachMediaToMessage(
    conversationId: string,
    waMessageId: string,
    tenantId: string,
    media: any
  ): Promise<boolean> {
    if (!waMessageId || !media) return false;
    let resolvedId: string | null = null;

    // 1. Update DB (tenant-scoped, dual-ID).
    try {
      const existing = await prisma.message.findFirst({
        where: {
          conversation_id: conversationId,
          tenant_id: tenantId,
          wa_message_id: waMessageId,
        },
      });
      if (existing) {
        resolvedId = existing.id;
        await prisma.message.update({
          where: { id: existing.id },
          data: {
            payload_raw: {
              ...(typeof existing.payload_raw === 'object' && existing.payload_raw ? existing.payload_raw : {}),
              media: {
                ...(typeof (existing.payload_raw as any)?.media === 'object' && (existing.payload_raw as any)?.media
                  ? (existing.payload_raw as any).media
                  : {}),
                ...media,
              },
            },
          },
        });
      }
    } catch (error) {
      console.warn('DB attachMediaToMessage error (using memory fallback):', (error as Error).message);
    }

    // 2. Update memory fallback.
    const inMem = memoryMessages.find(
      (m) => m.wa_message_id === waMessageId && m.conversation_id === conversationId && m.tenant_id === tenantId
    );
    if (inMem) {
      inMem.payload_raw = {
        ...(typeof inMem.payload_raw === 'object' && inMem.payload_raw ? inMem.payload_raw : {}),
        media: {
          ...(typeof (inMem.payload_raw as any)?.media === 'object' && (inMem.payload_raw as any)?.media
            ? (inMem.payload_raw as any).media
            : {}),
          ...media,
        },
      };
      if (!resolvedId) resolvedId = inMem.id || null;
    }

    if (!resolvedId && !inMem) return false;

    // 3. Broadcast ke seluruh dashboard.
    try {
      await getLiveChatHub().publish({
        type: 'message.updated',
        tenantId,
        payload: {
          conversationId,
          messageId: resolvedId,
          waMessageId,
          media,
        },
      });
    } catch (hubErr: any) {
      console.warn('[HUB] Failed to publish message.updated (attachMedia):', hubErr.message);
    }

    return true;
  }

  /**
   * Mengambil pesan-pesan terakhir untuk percakapan tertentu (terurut kronologis).
   * Param opsional `before`: cursor ISO timestamp / Date — hanya pesan dengan
   * created_at < before yang diambil (untuk infinite scroll up).
   */
  public async getRecentMessages(conversationId: string, limit: number, tenantId: string, before?: string | Date): Promise<any[]> {
    const beforeDate = before ? new Date(before) : null;
    const validBefore = beforeDate && !isNaN(beforeDate.getTime()) ? beforeDate : null;
    try {
      const messages = await prisma.message.findMany({
        where: {
          conversation_id: conversationId,
          tenant_id: tenantId,
          ...(validBefore ? { created_at: { lt: validBefore } } : {}),
        },
        orderBy: { created_at: 'desc' },
        take: limit,
      });
      return messages.reverse(); // Kembalikan ke urutan kronologis (lama -> baru)
    } catch (error) {
      // Memory fallback: ambil pesan terakhir (kronologis) untuk percakapan tsb
      return memoryMessages
        .filter((m) => m.conversation_id === conversationId && m.tenant_id === tenantId && (!validBefore || new Date(m.created_at) < validBefore))
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .slice(-limit);
    }
  }

  /**
   * Varian paged: mengambil `limit` pesan + flag hasMore (take limit+1).
   * Backward-compatible: tanpa `before` hasilnya identik dengan getRecentMessages.
   * Dilengkapi enrich metadata pin/hide bubble chat dan ringkasan pinnedMessage.
   */
  public async getRecentMessagesWithHasMore(
    conversationId: string,
    limit: number,
    tenantId: string,
    before?: string | Date,
    focusMessageId?: string
  ): Promise<{ messages: any[]; hasMore: boolean; pinnedMessage?: any }> {
    const enrichMessage = (m: any) => ({
      ...m,
      is_message_pinned: !!(m.is_message_pinned || m.payload_raw?.is_pinned),
      is_message_hidden: !!(m.is_message_hidden || m.payload_raw?.is_hidden),
      pinned_by: m.pinned_by || m.payload_raw?.pinned_by || null,
      pinned_at: m.pinned_at || m.payload_raw?.pinned_at || null,
      hidden_by: m.hidden_by || m.payload_raw?.hidden_by || null,
      hidden_at: m.hidden_at || m.payload_raw?.hidden_at || null,
    });

    const beforeDate = before ? new Date(before) : null;
    const validBefore = beforeDate && !isNaN(beforeDate.getTime()) ? beforeDate : null;
    // Focus-window: kembalikan batch yang pasti memuat pesan target (search-to-message direct jump).
    // Tenant-aware via conversation_id + tenant_id; tanpa hardcode bisnis.
    if (focusMessageId && !validBefore) {
      try {
        const target = await prisma.message.findFirst({
          where: {
            conversation_id: conversationId,
            tenant_id: tenantId,
            OR: [{ id: focusMessageId }, { wa_message_id: focusMessageId }],
          },
        });
        if (target) {
          const half = Math.max(10, Math.floor(limit / 2));
          const beforeRows = await prisma.message.findMany({
            where: {
              conversation_id: conversationId,
              tenant_id: tenantId,
              created_at: { lte: (target as any).created_at },
            },
            orderBy: { created_at: 'desc' },
            take: half + 1,
          });
          const afterRows = await prisma.message.findMany({
            where: {
              conversation_id: conversationId,
              tenant_id: tenantId,
              created_at: { gt: (target as any).created_at },
            },
            orderBy: { created_at: 'asc' },
            take: half,
          });
          const combined = [...beforeRows.reverse(), ...afterRows];
          // Pastikan target ada di hasil (guard idempoten bila created_at kembar)
          const hasTarget = combined.some(
            (m: any) => m.id === (target as any).id || ((m as any).wa_message_id && (m as any).wa_message_id === (target as any).wa_message_id)
          );
          const messages = hasTarget ? combined : [...combined, target].sort(
            (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
          const oldest = messages.length > 0 ? new Date((messages[0] as any).created_at) : null;
          let hasMore = false;
          if (oldest) {
            const olderCount = await prisma.message.count({
              where: { conversation_id: conversationId, tenant_id: tenantId, created_at: { lt: oldest } },
            });
            hasMore = olderCount > 0;
          }
          const pinnedMessage = await this.getPinnedMessage(conversationId, tenantId);
          return { messages: messages.map(enrichMessage), hasMore, pinnedMessage };
        }
      } catch (_) {
        // Fallback memory di bawah bila DB offline
      }
      // Memory fallback untuk focus-window (DB offline / target hanya di memori)
      const memAll = memoryMessages
        .filter((m) => m.conversation_id === conversationId && m.tenant_id === tenantId)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const targetIdx = memAll.findIndex((m) => m.id === focusMessageId || m.wa_message_id === focusMessageId);
      if (targetIdx >= 0) {
        const half = Math.max(10, Math.floor(limit / 2));
        const start = Math.max(0, targetIdx - half);
        const end = Math.min(memAll.length, targetIdx + half + 1);
        const pinnedMessage = await this.getPinnedMessage(conversationId, tenantId);
        return { messages: memAll.slice(start, end).map(enrichMessage), hasMore: start > 0, pinnedMessage };
      }
      // Target tak ditemukan → lanjut ke path normal di bawah
    }
    try {
      const rows = await prisma.message.findMany({
        where: {
          conversation_id: conversationId,
          tenant_id: tenantId,
          ...(validBefore ? { created_at: { lt: validBefore } } : {}),
        },
        orderBy: { created_at: 'desc' },
        take: limit + 1,
      });
      const hasMore = rows.length > limit;
      const pinnedMessage = await this.getPinnedMessage(conversationId, tenantId);
      return { messages: rows.slice(0, limit).reverse().map(enrichMessage), hasMore, pinnedMessage };
    } catch (error) {
      const all = memoryMessages
        .filter((m) => m.conversation_id === conversationId && m.tenant_id === tenantId && (!validBefore || new Date(m.created_at) < validBefore))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const pinnedMessage = await this.getPinnedMessage(conversationId, tenantId);
      return { messages: all.slice(0, limit).reverse().map(enrichMessage), hasMore: all.length > limit, pinnedMessage };
    }
  }

  /**
   * Update status delivery pesan dari webhook status Meta (sent/delivered/read/failed).
   * Idempoten: updateMany by wa_message_id + tenant_id. DB offline → silent.
   */
  public async updateDeliveryStatus(
    waMessageId: string,
    tenantId: string,
    status: 'sent' | 'delivered' | 'read' | 'failed',
    timestamp?: number,
    metaErrorCode?: string | null,
    metaErrorDesc?: string | null,
    metaPricingCategory?: string | null
  ): Promise<{ matched: boolean }> {
    if (!waMessageId) return { matched: false };

    const data: any = { delivery_status: status };
    const ts = timestamp ? new Date(timestamp * 1000) : new Date();
    if (status === 'delivered') data.delivered_at = ts;
    if (status === 'read') data.read_at = ts;
    if (metaErrorCode !== undefined) data.meta_error_code = metaErrorCode;
    if (metaErrorDesc !== undefined) data.meta_error_desc = metaErrorDesc;
    if (metaPricingCategory !== undefined) data.meta_pricing_category = metaPricingCategory;

    const suffix = waMessageId.includes('_') ? waMessageId.split('_').pop() : waMessageId;

    let matchedMessageId: string | null = null;
    let matchedConversationId: string | null = null;

    // 1. Update memory store fallback
    for (const mem of memoryMessages) {
      if (
        mem.wa_message_id === waMessageId ||
        mem.id === waMessageId ||
        (suffix && mem.wa_message_id && (mem.wa_message_id.endsWith(suffix) || waMessageId.endsWith(mem.wa_message_id)))
      ) {
        mem.delivery_status = status;
        if (status === 'delivered') mem.delivered_at = ts;
        if (status === 'read') mem.read_at = ts;
        matchedMessageId = mem.id;
        matchedConversationId = mem.conversation_id;
      }
    }

    let isMatched = false;
    try {
      let whereClause: any = { wa_message_id: waMessageId, tenant_id: tenantId };
      if (suffix && suffix !== waMessageId) {
        whereClause = {
          OR: [
            { wa_message_id: waMessageId, tenant_id: tenantId },
            { wa_message_id: suffix, tenant_id: tenantId },
            { id: waMessageId, tenant_id: tenantId },
          ],
        };
      }

      try {
        const existing = await (prisma.message as any).findFirst?.({
          where: whereClause,
          select: { id: true, conversation_id: true },
        });
        if (existing) {
          matchedMessageId = existing.id;
          matchedConversationId = existing.conversation_id;
        }
      } catch (_) {}

      const result = await (prisma.message as any).updateMany({
        where: whereClause,
        data,
      });
      isMatched = result.count > 0;
    } catch (error) {
      console.warn('DB updateDeliveryStatus error (using fallback):', (error as Error).message);
    }

    // 3. Publish real-time SSE event ke Live Chat Monitor
    try {
      getLiveChatHub()
        .publish({
          type: 'message.status_updated',
          tenantId,
          payload: {
            messageId: matchedMessageId,
            waMessageId,
            conversationId: matchedConversationId,
            status,
            deliveredAt: data.delivered_at || null,
            readAt: data.read_at || null,
          },
        })
        .catch(() => {});
    } catch {}

    return { matched: isMatched || !!matchedMessageId };
  }

  /**
   * Mengambil pesan-pesan outbound terakhir yang memiliki aiReasoning pada payload_raw.
   */
  public async getRecentMessagesWithReasoning(tenantId: string, limit: number = 50): Promise<any[]> {
    try {
      const res = await prisma.message.findMany({
        where: {
          tenant_id: tenantId,
          direction: Direction.OUTBOUND,
          payload_raw: {
            path: ['aiReasoning'],
            not: Prisma.JsonNull,
          },
        },
        orderBy: { created_at: 'desc' },
        take: limit,
      });
      if (Array.isArray(res)) return res;
    } catch (error) {
      // DB offline / fallback
    }
    // Memory fallback untuk offline / unit test
    return memoryMessages
      .filter(m => m.tenant_id === tenantId && (m.direction === Direction.OUTBOUND || (m.direction as string) === 'OUTBOUND') && (m.payload_raw?.aiReasoning || m.payloadRaw?.aiReasoning))
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      .slice(0, limit);
  }

  /**
   * Menandai pesan telah ditarik / dihapus untuk semua orang.
   * Memperbarui konten pesan menjadi teks penanda ditarik, membersihkan status pin bila sedang disematkan,
   * dan mem-broadcast update via SSE.
   */
  public async markMessageDeleted(messageId: string, tenantId: string): Promise<boolean> {
    const revokedContent = '🚫 Pesan ini telah ditarik';
    let conversationId: string | null = null;
    let wasPinned = false;

    // ID kanonik untuk SSE (lihat updateMessageContent): frontend match via id internal.
    let resolvedMessageId = messageId;
    let resolvedWaMessageId: string | null = null;

    try {
      const msg = await prisma.message.findFirst({
        where: {
          id: messageId,
          tenant_id: tenantId,
        },
      });

      if (!msg) {
        // Cek via wa_message_id
        const msgWa = await prisma.message.findFirst({
          where: { wa_message_id: messageId, tenant_id: tenantId },
        });
        if (msgWa) {
          conversationId = msgWa.conversation_id;
          resolvedMessageId = msgWa.id;
          resolvedWaMessageId = msgWa.wa_message_id ?? null;
          wasPinned = !!(msgWa.payload_raw as any)?.is_pinned;
          const updatedPayload = {
            ...(typeof msgWa.payload_raw === 'object' && msgWa.payload_raw ? (msgWa.payload_raw as any) : {}),
            is_revoked: true,
            revoked_at: new Date().toISOString(),
            is_pinned: false,
          };
          delete updatedPayload.pinned_by;
          delete updatedPayload.pinned_at;

          await prisma.message.update({
            where: { id: msgWa.id },
            data: {
              content: revokedContent,
              payload_raw: updatedPayload,
            },
          });
        }
      } else {
        conversationId = msg.conversation_id;
        resolvedMessageId = msg.id;
        resolvedWaMessageId = msg.wa_message_id ?? null;
        wasPinned = !!(msg.payload_raw as any)?.is_pinned;
        const updatedPayload = {
          ...(typeof msg.payload_raw === 'object' && msg.payload_raw ? (msg.payload_raw as any) : {}),
          is_revoked: true,
          revoked_at: new Date().toISOString(),
          is_pinned: false,
        };
        delete updatedPayload.pinned_by;
        delete updatedPayload.pinned_at;

        await prisma.message.update({
          where: { id: msg.id },
          data: {
            content: revokedContent,
            payload_raw: updatedPayload,
          },
        });
      }

      // Bersihkan pointer session_data.pinned_message_id bila merujuk ke pesan ini atau pesan sedang di-pin
      if (conversationId) {
        try {
          const conv = await prisma.conversation.findFirst({
            where: { id: conversationId, tenant_id: tenantId },
            select: { id: true, session_data: true },
          });
          const session = conv?.session_data && typeof conv.session_data === 'object' ? { ...(conv.session_data as any) } : {};
          if (session.pinned_message_id === resolvedMessageId || session.pinned_message_id === resolvedWaMessageId || wasPinned) {
            delete session.pinned_message_id;
            await prisma.conversation.update({
              where: { id: conv!.id },
              data: { session_data: session },
            });
          }
        } catch (_) {}
      }
    } catch (error) {
      console.warn('DB markMessageDeleted error (using memory fallback):', (error as Error).message);
      // Fallback in-memory
      const inMem = memoryMessages.find(
        (m) => (m.id === messageId || m.wa_message_id === messageId) && m.tenant_id === tenantId
      );
      if (inMem) {
        if (inMem.payload_raw?.is_pinned) wasPinned = true;
        inMem.content = revokedContent;
        inMem.payload_raw = {
          ...inMem.payload_raw,
          is_revoked: true,
          is_pinned: false,
        };
        delete inMem.payload_raw.pinned_by;
        delete inMem.payload_raw.pinned_at;
        conversationId = inMem.conversation_id;
        resolvedMessageId = inMem.id;
        resolvedWaMessageId = inMem.wa_message_id ?? null;

        if (conversationId) {
          try {
            const { conversationService } = await import('./conversation.service');
            const inMemConv = await conversationService.getConversationById(conversationId, tenantId);
            if (inMemConv && inMemConv.session_data && typeof inMemConv.session_data === 'object') {
              if (
                inMemConv.session_data.pinned_message_id === resolvedMessageId ||
                inMemConv.session_data.pinned_message_id === resolvedWaMessageId ||
                wasPinned
              ) {
                delete inMemConv.session_data.pinned_message_id;
              }
            }
          } catch (_) {}
        }
      }
    }

    // Invalidate response cache
    try {
      await responseCacheService.invalidatePrefix('livechat:');
    } catch (_) {}

    // Broadcast update via LiveChatHub
    try {
      const hub = getLiveChatHub();
      await hub.publish({
        type: 'message.updated',
        tenantId,
        payload: {
          conversationId,
          messageId: resolvedMessageId,
          waMessageId: resolvedWaMessageId,
          content: revokedContent,
          isRevoked: true,
          isMessagePinned: false,
        },
      });
    } catch (hubErr: any) {
      console.warn('[HUB] Failed to publish message.updated event:', hubErr.message);
    }

    return true;
  }

  /**
   * Menyematkan / melepas sematan bubble chat (Single Pin per Percakapan).
   * Menerapkan transaksi DB atomik, merge aman session_data (anti-data loss booking),
   * unpin pesan lama secara otomatis, cache invalidation, dan broadcast SSE kanonis.
   */
  public async toggleMessagePin(
    conversationId: string,
    messageId: string,
    tenantId: string,
    pinnedBy: string = 'Admin',
    isPinned?: boolean
  ): Promise<{ success: boolean; isPinned: boolean; messageId: string; pinnedMessage?: any; message?: any; error?: string }> {
    try {
      // 1. Cari pesan dengan verifikasi kepemilikan tenant & conversation (anti-IDOR)
      let msg: any = null;
      try {
        msg = await prisma.message.findFirst({
          where: {
            OR: [
              { id: messageId, conversation_id: conversationId, tenant_id: tenantId },
              { wa_message_id: messageId, conversation_id: conversationId, tenant_id: tenantId },
            ],
          },
        });
      } catch (err: any) {
        console.warn('DB findFirst error in toggleMessagePin (using memory fallback):', err.message);
      }

      if (!msg) {
        msg = memoryMessages.find(
          (m) =>
            (m.id === messageId || m.wa_message_id === messageId) &&
            m.conversation_id === conversationId &&
            m.tenant_id === tenantId
        );
      }

      if (!msg) {
        return { success: false, error: 'Pesan tidak ditemukan dalam percakapan ini.', isPinned: false, messageId };
      }

      const isRevoked = msg.content === '🚫 Pesan ini telah ditarik' || !!(msg.payload_raw as any)?.is_revoked;
      if (isRevoked) {
        return { success: false, error: 'Pesan yang telah ditarik tidak dapat disematkan.', isPinned: false, messageId: msg.id };
      }

      const currentPinned = !!(msg.payload_raw as any)?.is_pinned;
      const nextPinned = typeof isPinned === 'boolean' ? isPinned : !currentPinned;
      const nowIso = new Date().toISOString();

      let targetDbId = msg.id;
      let targetWaId = msg.wa_message_id ?? null;

      // 2. Persistensi: Transaksi DB atau Fallback Memori
      try {
        await prisma.$transaction(async (tx) => {
          const conv = await tx.conversation.findFirst({
            where: { id: conversationId, tenant_id: tenantId },
          });
          if (!conv) {
            throw new Error('Percakapan tidak ditemukan.');
          }

          const existingSession =
            conv.session_data && typeof conv.session_data === 'object'
              ? { ...(conv.session_data as any) }
              : {};

          if (nextPinned) {
            // Single-pin atomik: jika ada pesan lama yang sedang disematkan, unpin pesan lama
            const prevPinnedId = existingSession.pinned_message_id;
            if (prevPinnedId && prevPinnedId !== msg.id) {
              const oldMsg = await tx.message.findFirst({
                where: {
                  OR: [
                    { id: prevPinnedId, conversation_id: conversationId, tenant_id: tenantId },
                    { wa_message_id: prevPinnedId, conversation_id: conversationId, tenant_id: tenantId },
                  ],
                },
              });
              if (oldMsg) {
                const oldPayload =
                  oldMsg.payload_raw && typeof oldMsg.payload_raw === 'object'
                    ? { ...(oldMsg.payload_raw as any) }
                    : {};
                delete oldPayload.pinned_by;
                delete oldPayload.pinned_at;
                oldPayload.is_pinned = false;
                await tx.message.update({
                  where: { id: oldMsg.id },
                  data: { payload_raw: oldPayload },
                });
              }
            }

            // Tulis flag pin pada pesan target
            const targetPayload =
              msg.payload_raw && typeof msg.payload_raw === 'object'
                ? { ...(msg.payload_raw as any) }
                : {};
            targetPayload.is_pinned = true;
            targetPayload.pinned_by = pinnedBy;
            targetPayload.pinned_at = nowIso;

            await tx.message.update({
              where: { id: msg.id },
              data: { payload_raw: targetPayload },
            });

            // Merge aman session_data (jangan menimpa data booking/cart)
            existingSession.pinned_message_id = msg.id;
            await tx.conversation.update({
              where: { id: conv.id },
              data: { session_data: existingSession },
            });
          } else {
            // Unpin pesan target
            const targetPayload =
              msg.payload_raw && typeof msg.payload_raw === 'object'
                ? { ...(msg.payload_raw as any) }
                : {};
            targetPayload.is_pinned = false;
            delete targetPayload.pinned_by;
            delete targetPayload.pinned_at;

            await tx.message.update({
              where: { id: msg.id },
              data: { payload_raw: targetPayload },
            });

            // Hapus pointer jika merujuk ke pesan ini
            if (
              existingSession.pinned_message_id === msg.id ||
              existingSession.pinned_message_id === msg.wa_message_id
            ) {
              delete existingSession.pinned_message_id;
              await tx.conversation.update({
                where: { id: conv.id },
                data: { session_data: existingSession },
              });
            }
          }
        });
      } catch (dbErr: any) {
        console.warn('DB transaction error in toggleMessagePin (using memory fallback):', dbErr.message);
        // Fallback in-memory
        if (nextPinned) {
          // Unpin pesan lama di memori
          for (const m of memoryMessages) {
            if (m.conversation_id === conversationId && m.tenant_id === tenantId && m.id !== msg.id) {
              if (m.payload_raw) {
                m.payload_raw.is_pinned = false;
                delete m.payload_raw.pinned_by;
                delete m.payload_raw.pinned_at;
              }
            }
          }
          if (msg.payload_raw) {
            msg.payload_raw.is_pinned = true;
            msg.payload_raw.pinned_by = pinnedBy;
            msg.payload_raw.pinned_at = nowIso;
          } else {
            msg.payload_raw = { is_pinned: true, pinned_by: pinnedBy, pinned_at: nowIso };
          }
        } else {
          if (msg.payload_raw) {
            msg.payload_raw.is_pinned = false;
            delete msg.payload_raw.pinned_by;
            delete msg.payload_raw.pinned_at;
          }
        }

        // Sinkronkan pointer session_data pada memori
        try {
          const { conversationService } = await import('./conversation.service');
          const inMemConv = await conversationService.getConversationById(conversationId, tenantId);
          if (inMemConv) {
            const sess = inMemConv.session_data && typeof inMemConv.session_data === 'object'
              ? { ...inMemConv.session_data }
              : {};
            if (nextPinned) {
              sess.pinned_message_id = msg.id;
            } else if (sess.pinned_message_id === msg.id || sess.pinned_message_id === msg.wa_message_id) {
              delete sess.pinned_message_id;
            }
            inMemConv.session_data = sess;
          }
        } catch (_) {}
      }

      // Sinkronkan cache memori lokal bila ada
      const inMem = memoryMessages.find(
        (m) => (m.id === msg.id || m.wa_message_id === msg.id) && m.tenant_id === tenantId
      );
      if (inMem) {
        inMem.payload_raw = {
          ...(inMem.payload_raw || {}),
          is_pinned: nextPinned,
          ...(nextPinned ? { pinned_by: pinnedBy, pinned_at: nowIso } : {}),
        };
        if (!nextPinned) {
          delete inMem.payload_raw.pinned_by;
          delete inMem.payload_raw.pinned_at;
        }
        if (nextPinned) {
          for (const other of memoryMessages) {
            if (other.conversation_id === conversationId && other.tenant_id === tenantId && other.id !== inMem.id) {
              if (other.payload_raw) {
                other.payload_raw.is_pinned = false;
                delete other.payload_raw.pinned_by;
                delete other.payload_raw.pinned_at;
              }
            }
          }
        }
      }

      // 3. Invalidate response cache livechat
      try {
        await responseCacheService.invalidatePrefix('livechat:');
      } catch (_) {}

      // 4. Siarkan event SSE 'message.updated'
      try {
        const hub = getLiveChatHub();
        await hub.publish({
          type: 'message.updated',
          tenantId,
          payload: {
            conversationId,
            messageId: targetDbId,
            waMessageId: targetWaId,
            content: msg.content,
            sender_name: msg.sender_name,
            sender_type: msg.sender_type,
            created_at: msg.created_at,
            isMessagePinned: nextPinned,
            pinnedBy: nextPinned ? pinnedBy : undefined,
            pinnedAt: nextPinned ? nowIso : undefined,
            payload_raw: { is_pinned: nextPinned },
          },
        });
      } catch (hubErr: any) {
        console.warn('[HUB] Failed to publish message.updated event for pin:', hubErr.message);
      }

      const pinnedMessageData = nextPinned
        ? {
            id: targetDbId,
            wa_message_id: targetWaId,
            content: msg.content,
            sender_name: msg.sender_name,
            sender_type: msg.sender_type,
            created_at: msg.created_at,
            is_message_pinned: true,
            pinned_by: pinnedBy,
            pinned_at: nowIso,
          }
        : null;

      const messageObj = {
        id: targetDbId,
        wa_message_id: targetWaId,
        content: msg.content,
        sender_name: msg.sender_name,
        sender_type: msg.sender_type,
        created_at: msg.created_at,
        is_message_pinned: nextPinned,
        pinned_by: nextPinned ? pinnedBy : null,
        pinned_at: nextPinned ? nowIso : null,
      };

      return {
        success: true,
        isPinned: nextPinned,
        messageId: targetDbId,
        pinnedMessage: pinnedMessageData,
        message: messageObj,
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'Gagal mengubah status sematan pesan.', isPinned: false, messageId };
    }
  }

  /**
   * Menyembunyikan / menampilkan kembali bubble chat internal (UI only).
   * Data percakapan, database WhatsApp pasien, CRM, dan audit tetap utuh (zero side effect ke gateway WA).
   */
  public async toggleMessageHide(
    conversationId: string,
    messageId: string,
    tenantId: string,
    hiddenBy: string = 'Admin',
    isHidden?: boolean
  ): Promise<{ success: boolean; isHidden: boolean; messageId: string; message?: any; error?: string }> {
    try {
      // 1. Cari pesan dengan verifikasi tenant & conversation (anti-IDOR)
      let msg: any = null;
      try {
        msg = await prisma.message.findFirst({
          where: {
            OR: [
              { id: messageId, conversation_id: conversationId, tenant_id: tenantId },
              { wa_message_id: messageId, conversation_id: conversationId, tenant_id: tenantId },
            ],
          },
        });
      } catch (err: any) {
        console.warn('DB findFirst error in toggleMessageHide (using memory fallback):', err.message);
      }

      if (!msg) {
        msg = memoryMessages.find(
          (m) =>
            (m.id === messageId || m.wa_message_id === messageId) &&
            m.conversation_id === conversationId &&
            m.tenant_id === tenantId
        );
      }

      if (!msg) {
        return { success: false, error: 'Pesan tidak ditemukan dalam percakapan ini.', isHidden: false, messageId };
      }

      // Validasi kontrak HIDE: catatan internal & pesan revoked tidak boleh di-hide
      const senderUpper = (msg.sender_type || '').toUpperCase();
      if (senderUpper === 'INTERNAL_NOTE') {
        return { success: false, error: 'Catatan internal tidak dapat disembunyikan.', isHidden: false, messageId: msg.id };
      }
      const isRevoked = msg.content === '🚫 Pesan ini telah ditarik' || !!(msg.payload_raw as any)?.is_revoked;
      if (isRevoked) {
        return { success: false, error: 'Pesan yang telah ditarik tidak dapat disembunyikan.', isHidden: false, messageId: msg.id };
      }

      const currentHidden = !!(msg.payload_raw as any)?.is_hidden;
      const nextHidden = typeof isHidden === 'boolean' ? isHidden : !currentHidden;
      const nowIso = new Date().toISOString();

      let targetDbId = msg.id;
      let targetWaId = msg.wa_message_id ?? null;

      // 2. Persistensi: DB atau Fallback Memori
      try {
        const payload =
          msg.payload_raw && typeof msg.payload_raw === 'object'
            ? { ...(msg.payload_raw as any) }
            : {};
        payload.is_hidden = nextHidden;
        if (nextHidden) {
          payload.hidden_by = hiddenBy;
          payload.hidden_at = nowIso;
        } else {
          delete payload.hidden_by;
          delete payload.hidden_at;
        }

        await prisma.message.update({
          where: { id: msg.id },
          data: { payload_raw: payload },
        });
      } catch (dbErr: any) {
        console.warn('DB update error in toggleMessageHide (using memory fallback):', dbErr.message);
        if (msg.payload_raw) {
          msg.payload_raw.is_hidden = nextHidden;
          if (nextHidden) {
            msg.payload_raw.hidden_by = hiddenBy;
            msg.payload_raw.hidden_at = nowIso;
          } else {
            delete msg.payload_raw.hidden_by;
            delete msg.payload_raw.hidden_at;
          }
        } else {
          msg.payload_raw = nextHidden ? { is_hidden: true, hidden_by: hiddenBy, hidden_at: nowIso } : { is_hidden: false };
        }
      }

      // Sinkronkan memory fallback
      const inMem = memoryMessages.find(
        (m) => (m.id === msg.id || m.wa_message_id === msg.id) && m.tenant_id === tenantId
      );
      if (inMem) {
        inMem.payload_raw = {
          ...(inMem.payload_raw || {}),
          is_hidden: nextHidden,
          ...(nextHidden ? { hidden_by: hiddenBy, hidden_at: nowIso } : {}),
        };
        if (!nextHidden) {
          delete inMem.payload_raw.hidden_by;
          delete inMem.payload_raw.hidden_at;
        }
      }

      // 3. Invalidate cache
      try {
        await responseCacheService.invalidatePrefix('livechat:');
      } catch (_) {}

      // 4. Siarkan event SSE
      try {
        const hub = getLiveChatHub();
        await hub.publish({
          type: 'message.updated',
          tenantId,
          payload: {
            conversationId,
            messageId: targetDbId,
            waMessageId: targetWaId,
            content: msg.content,
            isMessageHidden: nextHidden,
            hiddenBy: nextHidden ? hiddenBy : undefined,
            hiddenAt: nextHidden ? nowIso : undefined,
            payload_raw: { is_hidden: nextHidden },
          },
        });
      } catch (hubErr: any) {
        console.warn('[HUB] Failed to publish message.updated event for hide:', hubErr.message);
      }

      const messageObj = {
        id: targetDbId,
        wa_message_id: targetWaId,
        content: msg.content,
        sender_name: msg.sender_name,
        sender_type: msg.sender_type,
        created_at: msg.created_at,
        is_message_hidden: nextHidden,
        hidden_by: nextHidden ? hiddenBy : null,
        hidden_at: nextHidden ? nowIso : null,
      };

      return {
        success: true,
        isHidden: nextHidden,
        messageId: targetDbId,
        message: messageObj,
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'Gagal mengubah status sembunyi pesan.', isHidden: false, messageId };
    }
  }

  /**
   * Mengambil pesan yang sedang disematkan dalam percakapan.
   * Sumber primer: Conversation.session_data.pinned_message_id (O(1)).
   * Fallback: query message.payload_raw.is_pinned (O(N)).
   * Membersihkan pointer basi otomatis jika pesan telah ditarik / tidak ditemukan.
   */
  public async getPinnedMessage(conversationId: string, tenantId: string): Promise<any | null> {
    try {
      let pinnedId: string | null = null;
      try {
        const conv = await prisma.conversation.findFirst({
          where: { id: conversationId, tenant_id: tenantId },
          select: { session_data: true },
        });
        pinnedId = (conv?.session_data as any)?.pinned_message_id || null;
      } catch (_) {}

      if (!pinnedId) {
        try {
          const { conversationService } = await import('./conversation.service');
          const inMemConv = await conversationService.getConversationById(conversationId, tenantId);
          pinnedId = (inMemConv?.session_data as any)?.pinned_message_id || null;
        } catch (_) {}
      }

      if (pinnedId) {
        let msg: any = null;
        try {
          msg = await prisma.message.findFirst({
            where: {
              OR: [
                { id: pinnedId, conversation_id: conversationId, tenant_id: tenantId },
                { wa_message_id: pinnedId, conversation_id: conversationId, tenant_id: tenantId },
              ],
            },
          });
        } catch (_) {}

        if (!msg) {
          msg = memoryMessages.find(
            (m) =>
              (m.id === pinnedId || m.wa_message_id === pinnedId) &&
              m.conversation_id === conversationId &&
              m.tenant_id === tenantId
          );
        }

        if (msg) {
          const isRevoked = msg.content === '🚫 Pesan ini telah ditarik' || !!(msg.payload_raw as any)?.is_revoked;
          if (isRevoked) {
            // Pointer basi: pesan telah ditarik. Bersihkan pointer secara proaktif.
            try {
              const conv = await prisma.conversation.findFirst({
                where: { id: conversationId, tenant_id: tenantId },
                select: { id: true, session_data: true },
              });
              if (conv) {
                const session = conv.session_data && typeof conv.session_data === 'object' ? { ...(conv.session_data as any) } : {};
                delete session.pinned_message_id;
                await prisma.conversation.update({
                  where: { id: conv.id },
                  data: { session_data: session },
                });
              }
            } catch (_) {}
            try {
              const { conversationService } = await import('./conversation.service');
              const inMemConv = await conversationService.getConversationById(conversationId, tenantId);
              if (inMemConv && inMemConv.session_data) {
                delete (inMemConv.session_data as any).pinned_message_id;
              }
            } catch (_) {}
            return null;
          }

          return {
            id: msg.id,
            wa_message_id: msg.wa_message_id ?? null,
            content: msg.content,
            sender_name: msg.sender_name ?? null,
            sender_type: msg.sender_type ?? null,
            created_at: msg.created_at,
            is_message_pinned: true,
            pinned_by: (msg.payload_raw as any)?.pinned_by ?? null,
            pinned_at: (msg.payload_raw as any)?.pinned_at ?? null,
          };
        }
      }

      // Fallback: cari di memoryMessages bila DB offline atau belum ada session_data pointer
      const memPinned = memoryMessages.find(
        (m) =>
          m.conversation_id === conversationId &&
          m.tenant_id === tenantId &&
          m.payload_raw?.is_pinned &&
          !m.payload_raw?.is_revoked &&
          m.content !== '🚫 Pesan ini telah ditarik'
      );
      if (memPinned) {
        return {
          id: memPinned.id,
          wa_message_id: memPinned.wa_message_id ?? null,
          content: memPinned.content,
          sender_name: memPinned.sender_name ?? null,
          sender_type: memPinned.sender_type ?? null,
          created_at: memPinned.created_at,
          is_message_pinned: true,
          pinned_by: memPinned.payload_raw?.pinned_by ?? null,
          pinned_at: memPinned.payload_raw?.pinned_at ?? null,
        };
      }

      return null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Update konten pesan yang diedit (Edit Message).
   * Memperbarui tabel messages (payload_raw.is_edited = true, edited_at), memory fallback, dan broadcast event SSE 'message.updated'.
   */
  public async updateMessageContent(
    messageId: string,
    newContent: string,
    tenantId: string
  ): Promise<boolean> {
    let conversationId = '';

    // WAHA mengirim id pesan target dalam berbagai bentuk: serialized
    // `true_{chatId}_{key}`, raw key `{key}`, atau id aksi edit. Cocokkan
    // terhadap id internal, wa_message_id persis, maupun suffix key — pola
    // yang sama dengan addOrUpdateReaction/updateDeliveryStatus.
    const cleanId = extractShortMessageId(messageId);
    const orConds: any[] = [
      { id: messageId, tenant_id: tenantId },
      { wa_message_id: messageId, tenant_id: tenantId },
    ];
    if (cleanId) {
      if (cleanId !== messageId) {
        orConds.push({ wa_message_id: cleanId, tenant_id: tenantId });
      }
      orConds.push({ wa_message_id: { endsWith: `_${cleanId}` }, tenant_id: tenantId });
    }

    // ID kanonik untuk SSE: frontend mencocokkan bubble via `m.id` internal.
    // Kalau input berupa raw key/serialized WAHA, resolve ke id internal agar
    // event tidak terbuang (sebelumnya payload memakai raw key → tidak match).
    let resolvedMessageId = messageId;
    let resolvedWaMessageId: string | null = null;

    try {
      const msg = await prisma.message.findFirst({
        where: { OR: orConds },
      });

      if (msg) {
        conversationId = msg.conversation_id;
        resolvedMessageId = msg.id;
        resolvedWaMessageId = msg.wa_message_id ?? null;
        await prisma.message.update({
          where: { id: msg.id },
          data: {
            content: newContent,
            payload_raw: {
              ...(typeof msg.payload_raw === 'object' && msg.payload_raw ? msg.payload_raw : {}),
              is_edited: true,
              edited_at: new Date().toISOString(),
            },
          },
        });
      }
    } catch (error) {
      console.warn('DB updateMessageContent error (using memory fallback):', (error as Error).message);
      const inMem = memoryMessages.find(
        (m) => (m.id === messageId || m.wa_message_id === messageId || (cleanId && m.wa_message_id && m.wa_message_id.endsWith(`_${cleanId}`))) && m.tenant_id === tenantId
      );
      if (inMem) {
        inMem.content = newContent;
        inMem.payload_raw = { ...inMem.payload_raw, is_edited: true, edited_at: new Date().toISOString() };
        conversationId = inMem.conversation_id;
        resolvedMessageId = inMem.id;
        resolvedWaMessageId = inMem.wa_message_id ?? null;
      }
    }

    // Broadcast update via LiveChatHub
    try {
      const hub = getLiveChatHub();
      await hub.publish({
        type: 'message.updated',
        tenantId,
        payload: {
          conversationId,
          messageId: resolvedMessageId,
          waMessageId: resolvedWaMessageId,
          content: newContent,
          isEdited: true,
          editedAt: new Date().toISOString(),
        },
      });
    } catch (hubErr: any) {
      console.warn('[HUB] Failed to publish message.updated event:', hubErr.message);
    }

    return true;
  }

  /**
   * Menambahkan, mengubah, atau menghapus reaksi emotikon pada pesan WhatsApp.
   * Format payload_raw.reactions: Array<{ emoji: string; fromMe: boolean; senderName?: string; actorId?: string; createdAt: string }>
   */
  public async addOrUpdateReaction(
    messageId: string,
    tenantId: string,
    reaction: {
      emoji: string;
      fromMe: boolean;
      senderName?: string;
      actorId?: string;
    }
  ): Promise<{ success: boolean; messageId?: string; conversationId?: string; reactions?: any[] }> {
    let conversationId = '';
    let targetMessageId = messageId;
    let reactions: any[] = [];

    const actorKey = reaction.fromMe ? 'ME' : (reaction.actorId || reaction.senderName || 'CUSTOMER');

    const cleanId = extractShortMessageId(messageId);
    const orConds: any[] = [
      { id: messageId, tenant_id: tenantId },
      { wa_message_id: messageId, tenant_id: tenantId },
    ];
    if (cleanId) {
      if (cleanId !== messageId) {
        orConds.push({ wa_message_id: cleanId, tenant_id: tenantId });
      }
      orConds.push({ wa_message_id: { endsWith: `_${cleanId}` }, tenant_id: tenantId });
    }
    try {
      let msg = await prisma.message.findFirst({
        where: { OR: orConds },
      });

      if (msg) {
        conversationId = msg.conversation_id;
        targetMessageId = msg.id;
        const currentPayload = (typeof msg.payload_raw === 'object' && msg.payload_raw ? msg.payload_raw : {}) as any;
        const existingReactions = Array.isArray(currentPayload.reactions) ? [...currentPayload.reactions] : [];

        if (!reaction.emoji) {
          // Hapus reaksi dari actor ini
          reactions = existingReactions.filter((r: any) => (r.fromMe ? 'ME' : (r.actorId || r.senderName || 'CUSTOMER')) !== actorKey);
        } else {
          // Hapus reaksi lama dari actor ini, lalu tambahkan yang baru
          reactions = existingReactions.filter((r: any) => (r.fromMe ? 'ME' : (r.actorId || r.senderName || 'CUSTOMER')) !== actorKey);
          reactions.push({
            emoji: reaction.emoji,
            fromMe: reaction.fromMe,
            senderName: reaction.senderName,
            actorId: reaction.actorId,
            createdAt: new Date().toISOString(),
          });
        }

        await prisma.message.update({
          where: { id: msg.id },
          data: {
            payload_raw: {
              ...currentPayload,
              reactions,
            },
          },
        });
      }
    } catch (error) {
      console.warn('DB addOrUpdateReaction error (using memory fallback):', (error as Error).message);
    }

    // Memory store fallback sync — dukung short/long WA ID (pakai cleanId konsisten dengan DB)
    const inMem = memoryMessages.find(
      (m) =>
        (m.id === messageId ||
          m.wa_message_id === messageId ||
          (cleanId && (m.wa_message_id === cleanId || (m.wa_message_id && String(m.wa_message_id).endsWith(`_${cleanId}`))))) &&
        m.tenant_id === tenantId
    );
    if (inMem) {
      conversationId = inMem.conversation_id;
      targetMessageId = inMem.id;
      const currentPayload = inMem.payload_raw || {};
      const existingReactions = Array.isArray(currentPayload.reactions) ? [...currentPayload.reactions] : [];

      if (!reaction.emoji) {
        reactions = existingReactions.filter((r: any) => (r.fromMe ? 'ME' : (r.actorId || r.senderName || 'CUSTOMER')) !== actorKey);
      } else {
        reactions = existingReactions.filter((r: any) => (r.fromMe ? 'ME' : (r.actorId || r.senderName || 'CUSTOMER')) !== actorKey);
        reactions.push({
          emoji: reaction.emoji,
          fromMe: reaction.fromMe,
          senderName: reaction.senderName,
          actorId: reaction.actorId,
          createdAt: new Date().toISOString(),
        });
      }
      inMem.payload_raw = { ...currentPayload, reactions };
    }

    // Broadcast update via LiveChatHub — ganda untuk kompatibilitas listener SSE (colon + dot)
    try {
      const hub = getLiveChatHub();
      if (hub && conversationId) {
        const payload = { conversationId, messageId: targetMessageId, waMessageId: messageId, reactions };
        await hub.publish({ type: 'message:reaction' as any, tenantId, payload } as any);
        await hub.publish({ type: 'message.reaction' as any, tenantId, payload } as any);
      }
    } catch (hubErr: any) {
      console.warn('[HUB] Failed to publish message:reaction event:', hubErr.message);
    }

    return { success: true, messageId: targetMessageId, conversationId, reactions };
  }

  /**
   * Menandai semua pesan inbound pada sebuah percakapan sebagai telah dibaca (read_at = now).
   * Menyetel is_manual_unread = false.
   */
  public async markConversationMessagesAsRead(conversationId: string, tenantId: string): Promise<void> {
    const now = new Date();

    // 1. Update di DB Prisma
    try {
      await prisma.message.updateMany({
        where: {
          conversation_id: conversationId,
          tenant_id: tenantId,
          direction: Direction.INBOUND,
          read_at: null,
        },
        data: {
          read_at: now,
        },
      });

      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          is_manual_unread: false,
        },
      }).catch(() => {});
    } catch (error) {
      // Memory fallback
    }

    // 2. Update memory store fallback
    for (const m of memoryMessages) {
      if (m.conversation_id === conversationId && m.tenant_id === tenantId && m.direction === 'INBOUND' && !m.read_at) {
        m.read_at = now;
      }
    }

    try {
      const { conversationService } = await import('./conversation.service');
      await conversationService.setManualUnread(conversationId, tenantId, false);
    } catch {}

    // Broadcast ke seluruh dashboard agar badge unread admin lain padam real-time
    // (bukan hanya klien yang memicu mark-as-read).
    try {
      const hub = getLiveChatHub();
      await hub.publish({
        type: 'conversation.updated',
        tenantId,
        payload: {
          conversationId,
          unreadCount: 0,
          isManualUnread: false,
        },
      });
    } catch (hubErr: any) {
      console.warn('[HUB] Failed to publish conversation.updated (mark-as-read):', hubErr.message);
    }

    responseCacheService.invalidatePrefix('livechat:');
  }

  /**
   * Menandai percakapan sebagai belum dibaca (manual mark as unread).
   * Mengosongkan read_at pada pesan inbound terakhir dan menyetel is_manual_unread = true.
   */
  public async markConversationAsUnread(conversationId: string, tenantId: string): Promise<void> {
    // 1. Update di DB Prisma
    try {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          is_manual_unread: true,
        },
      });

      // Cari pesan inbound terakhir dan set read_at = null
      const lastInbound = await prisma.message.findFirst({
        where: {
          conversation_id: conversationId,
          tenant_id: tenantId,
          direction: Direction.INBOUND,
        },
        orderBy: { created_at: 'desc' },
      });

      if (lastInbound) {
        await prisma.message.update({
          where: { id: lastInbound.id },
          data: { read_at: null },
        });
      }
    } catch (error) {
      // Memory fallback
    }

    // 2. Update memory store fallback
    const memInbounds = memoryMessages
      .filter((m) => m.conversation_id === conversationId && m.tenant_id === tenantId && m.direction === 'INBOUND')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    if (memInbounds.length > 0) {
      memInbounds[0].read_at = null;
    }

    try {
      const { conversationService } = await import('./conversation.service');
      await conversationService.setManualUnread(conversationId, tenantId, true);
    } catch {}
    responseCacheService.invalidatePrefix('livechat:');
  }

  /**
   * Mengambil jumlah pesan unread secara batch per conversation_id.
   */
  public async getUnreadCountsBatch(conversationIds: string[], tenantId: string): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (!conversationIds.length) return result;

    try {
      const rows = await prisma.message.groupBy({
        by: ['conversation_id'],
        where: {
          conversation_id: { in: conversationIds },
          tenant_id: tenantId,
          direction: Direction.INBOUND,
          read_at: null,
        },
        _count: { id: true },
      });

      for (const r of rows) {
        result.set(r.conversation_id, r._count.id);
      }
    } catch {
      // Fallback ke memory store
      for (const cid of conversationIds) {
        const unreadMem = memoryMessages.filter(
          (m) => m.conversation_id === cid && m.tenant_id === tenantId && m.direction === 'INBOUND' && !m.read_at
        ).length;
        if (unreadMem > 0) {
          result.set(cid, unreadMem);
        }
      }
    }

    return result;
  }

  /**
   * Mengambil total unread count seluruh percakapan pada tenant secara instan (agregat cepat).
   */
  public async getTotalUnreadCount(tenantId: string): Promise<number> {
    try {
      const inboundUnread = await prisma.message.count({
        where: {
          tenant_id: tenantId,
          direction: Direction.INBOUND,
          read_at: null,
          conversation: {
            customer: {
              is_sandbox_test: false,
            },
          },
        },
      });

      const manualUnread = await prisma.conversation.count({
        where: {
          tenant_id: tenantId,
          is_manual_unread: true,
          customer: {
            is_sandbox_test: false,
          },
          messages: {
            none: {
              direction: Direction.INBOUND,
              read_at: null,
            },
          },
        },
      });

      return inboundUnread + manualUnread;
    } catch {
      // Memory store fallback
      const unreadMemMessages = memoryMessages.filter(
        (m) => m.tenant_id === tenantId && m.direction === 'INBOUND' && !m.read_at
      ).length;
      return unreadMemMessages;
    }
  }

  /**
   * Menandai SEMUA pesan pada semua percakapan dalam sebuah tenant sebagai telah dibaca (read_at = now).
   * Menyetel is_manual_unread = false pada semua percakapan.
   */
  public async markAllMessagesAsRead(tenantId: string): Promise<number> {
    const now = new Date();
    let updatedCount = 0;

    // 1. Update di database PostgreSQL
    try {
      const res = await prisma.message.updateMany({
        where: {
          tenant_id: tenantId,
          direction: Direction.INBOUND,
          read_at: null,
        },
        data: {
          read_at: now,
        },
      });
      updatedCount = res.count;

      await prisma.conversation.updateMany({
        where: {
          tenant_id: tenantId,
          is_manual_unread: true,
        },
        data: {
          is_manual_unread: false,
        },
      });
    } catch (error) {
      // Memory fallback
    }

    // 2. Update memory store fallback
    for (const m of memoryMessages) {
      if (m.tenant_id === tenantId && m.direction === 'INBOUND' && !m.read_at) {
        m.read_at = now;
        updatedCount++;
      }
    }

    try {
      const { conversationService } = await import('./conversation.service');
      const convResult = await conversationService.listConversations(tenantId, 1000, 0, 'all');
      const convs = Array.isArray(convResult) ? convResult : convResult.items;
      for (const c of convs) {
        if (c.is_manual_unread) {
          await conversationService.setManualUnread(c.id, tenantId, false);
        }
      }
    } catch {}

    responseCacheService.invalidatePrefix('livechat:');
    return updatedCount;
  }

  public getMemoryMessages(): any[] {
    return memoryMessages;
  }
}

export const messageService = new MessageService();
