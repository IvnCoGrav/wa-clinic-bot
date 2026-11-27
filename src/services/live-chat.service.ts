import { prisma } from '../db/client';
import { Direction } from '@prisma/client';
import { conversationService, buildConversationUpdatedPayload } from './conversation.service';
import { customerService } from './customer.service';
import { messageService } from './message.service';
import { messageThreadService } from './message-thread.service';
import { resolveGatewayForTenant } from '../integrations/whatsapp/factory';
import { ClientIdempotencyStore } from '../utils/client-idempotency';
import { alertService, AlertType, AlertSeverity } from './alert.service';
import { staffOwnershipService } from './staff-ownership.service';
import type { LiveChatConversationItem, AdminReplyResult } from './live-chat.types';
import { serializeLiveChatConversation } from './live-chat.serializer';
import { isValidReplyToForProvider } from '../utils/whatsapp-message-id';

/**
 * Kontrak DTO LiveChat dipindah ke `live-chat.types.ts`; re-export menjaga
 * kompatibilitas impor lama dari `live-chat.service`.
 */
export type { LiveChatConversationItem, LiveChatReservationItem, AdminReplyResult } from './live-chat.types';

// WABA free-form text hanya diperbolehkan dalam 24 jam sejak pesan inbound terakhir customer
const WABA_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Deteksi perintah catatan internal `/notes` secara deterministik (bukan AI/regex hafalan).
 * Berlaku bila: teks persis `/notes`, atau `/notes` diikuti whitespace.
 * `/notesX` BUKAN perintah (dianggap teks biasa).
 */
export function parseInternalNoteCommand(
  text: string | undefined | null,
  forceInternal = false
): { isInternal: boolean; cleanNote: string } {
  const trimmed = (text || '').trim();
  const lower = trimmed.toLowerCase();
  const isNotesCmd =
    lower === '/notes' || (lower.startsWith('/notes') && /\s/.test(lower.charAt(6)));

  if (isNotesCmd) {
    // Buang token perintah `/notes` (7 karakter termasuk pemisah) → sisa teks = isi catatan.
    return { isInternal: true, cleanNote: trimmed.slice(6).trim() };
  }
  if (forceInternal) {
    return { isInternal: true, cleanNote: trimmed };
  }
  return { isInternal: false, cleanNote: '' };
}

export class LiveChatService {
  // Local cache for idempotency check (to prevent double tap).
  // AUDIT FASE 3 (LC-12): store ber-TTL + batas kapasitas (dulu Map tanpa prune
  // → tumbuh sepanjang umur proses).
  private static recentReplies = new ClientIdempotencyStore(2000, 500);
  // Fase 1.2: idempotensi berbasis `clientTempId` dari HP terapis (retry setelah
  // timeout sinyal 1-bar). Jendela lebih panjang dari double-tap (5 menit).
  // CATATAN: penyimpanan di memori proses; deploy saat ini single-instance app
  // (docker compose) sehingga retry dari HP yang sama selalu mendarat di proses
  // yang sama. Multi-instance butuh backing DB (lihat KNOWN_ISSUES).
  private static recentClientTemps = new ClientIdempotencyStore(5 * 60 * 1000, 500);

  /**
   * Monitor Live Chat: daftar percakapan terbaru + preview pesan (dengan sender_type/sender_name).
   * Paging offset-based untuk infinite scroll; hasMore=true bila masih ada halaman berikutnya.
   */
  public async getConversationList(
    tenantId: string,
    take = 50,
    offset = 0,
    mode: 'all' | 'real' | 'sandbox' = 'all',
    search?: string,
    label?: string,
    filter: 'all' | 'unread' | 'reservation' = 'all',
    staffId?: string
  ): Promise<{ items: LiveChatConversationItem[]; hasMore: boolean; total: number }> {
    const { items: conversations, hasMore, total } = await conversationService.listConversations(tenantId, take, offset, mode, search, label as any, filter, staffId);
    if (conversations.length === 0) {
      return { items: [], hasMore: false, total };
    }

    const conversationIds = conversations.map((c) => c.id);
    const customerIds = [...new Set(conversations.map((c) => c.customer_id))];
    const ownershipMap = await staffOwnershipService.getByCustomerIds(tenantId, customerIds);

    // Batch fetch semua customer (1 query, bukan N query).
    let customers = new Map<string, any>();
    try {
      const rows = await prisma.customer.findMany({
        where: { id: { in: customerIds }, tenant_id: tenantId },
        include: {
          adClick: true,
          children: true,
          reservations: {
            include: { assigned_staff: { select: { id: true, name: true } } },
            orderBy: { created_at: 'desc' },
          },
          labels: { include: { label: true } },
        },
      });
      customers = new Map(rows.map((c) => [c.id, c]));
    } catch (error) {
      // DB offline → fallback per-customer (memory store)
      for (const id of customerIds) {
        const c = await customerService.getCustomerById(id, tenantId);
        if (c) customers.set(id, c);
      }
    }

    const { resolveTreatmentValue } = await import('./capi.service');
    const treatmentPriceCache = new Map<string, number>();
    const customerStats = new Map<string, { purchaseCount: number; ltv: number }>();
    for (const [id, cust] of customers.entries()) {
      let ltv = 0;
      const resList = cust.reservations || [];
      for (const r of resList) {
        const text = r.treatment_detail || r.raw_text;
        if (text) {
          if (!treatmentPriceCache.has(text)) {
            const val = (await resolveTreatmentValue(text, tenantId)) || 0;
            treatmentPriceCache.set(text, val);
          }
          ltv += treatmentPriceCache.get(text) || 0;
        }
      }
      customerStats.set(id, { purchaseCount: resList.length, ltv });
    }

    // Batch fetch pesan terakhir per conversation (maksimal 3 pesan per percakapan langsung di SQL).
    let lastMessagesByConv = new Map<string, any[]>();
    try {
      const rows = await prisma.$queryRaw<any[]>`
        WITH ranked AS (
          SELECT id, tenant_id, conversation_id, direction, content, sender_type, sender_name, payload_raw, delivery_status, is_revoked, created_at,
                 ROW_NUMBER() OVER(PARTITION BY conversation_id ORDER BY created_at DESC) as rn
          FROM messages
          WHERE conversation_id = ANY(${conversationIds}::text[]) AND tenant_id = ${tenantId}
        )
        SELECT id, tenant_id, conversation_id, direction, content, sender_type, sender_name, payload_raw, delivery_status, is_revoked, created_at
        FROM ranked
        WHERE rn <= 3
        ORDER BY created_at ASC;
      `;
      for (const m of rows) {
        const arr = lastMessagesByConv.get(m.conversation_id) || [];
        arr.push(m);
        lastMessagesByConv.set(m.conversation_id, arr);
      }
    } catch (error) {
      // DB offline / raw query fallback → memory store
      for (const cid of conversationIds) {
        lastMessagesByConv.set(cid, await messageService.getRecentMessages(cid, 3, tenantId));
      }
    }

    // Batch fetch matchedMessage saat search aktif (snippet pencarian)
    let matchedMessageByConv = new Map<string, any>();
    if (search && search.trim()) {
      try {
        const q = search.trim();
        const matchedRows = await prisma.message.findMany({
          where: {
            conversation_id: { in: conversationIds },
            tenant_id: tenantId,
            content: { contains: q, mode: 'insensitive' },
          },
          orderBy: { created_at: 'desc' },
        });
        const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wordRegex = new RegExp(`(^|\\W)${escaped}($|\\W)`, 'i');
        for (const m of matchedRows) {
          if (!wordRegex.test(m.content || '')) continue;
          if (!matchedMessageByConv.has(m.conversation_id)) {
            matchedMessageByConv.set(m.conversation_id, {
              id: m.id,
              content: m.content,
              createdAt: m.created_at,
              direction: m.direction,
              senderName: m.sender_name,
            });
          }
        }
      } catch (_) {}
    }

    // Batch fetch unread counts
    const unreadMap = await messageService.getUnreadCountsBatch(conversationIds, tenantId);

    // Background sync foto profil secara hemat (maksimal 5 customer per batch dengan jeda bertahap agar tidak membebani WAHA)
    let syncQueueCount = 0;
    for (const cust of customers.values()) {
      if (cust && cust.phone && !cust.is_sandbox_test) {
        const isStale =
          !cust.profile_picture_updated_at ||
          Date.now() - new Date(cust.profile_picture_updated_at).getTime() > 3 * 24 * 60 * 60 * 1000;
        if (isStale && syncQueueCount < 5) {
          const delayMs = syncQueueCount * 300;
          setTimeout(() => {
            customerService.syncProfilePictureInBackground(cust.id, cust.phone, tenantId);
          }, delayMs);
          syncQueueCount++;
        }
      }
    }

    const items = conversations.map((c) =>
      serializeLiveChatConversation(
        {
          ...c,
          customer: customers.get(c.customer_id),
          messages: lastMessagesByConv.get(c.id) || [],
          matchedMessage: matchedMessageByConv.get(c.id) || null,
        },
        customerStats.get(c.customer_id),
        unreadMap.get(c.id) || 0,
        ownershipMap.get(c.customer_id) ?? null
      )
    );
    // Urutan sudah dijamin DB (pinned desc, lalu last_message_at desc absolut waktu) — stabil antar halaman.
    return { items, hasMore, total };
  }

  /**
   * Mengambil detail satu percakapan berformat LiveChatConversationItem.
   */
  public async getConversationDetail(conversationId: string, tenantId: string): Promise<LiveChatConversationItem | null> {
    const conv = await conversationService.getConversationById(conversationId, tenantId);
    if (!conv) return null;

    let cust = await customerService.getCustomerById(conv.customer_id, tenantId);
    // Repository `findById` mengembalikan baris bare (tanpa relasi). Untuk detail
    // percakapan, badge HOLD/Terjadwal & banner butuh `reservations`+`children`
    // — hidrasi relasi bila belum ada (anti banner padam saat buka 1 chat).
    if (cust && !Array.isArray((cust as any).reservations)) {
      try {
        const hydrated = await prisma.customer.findUnique({
          where: { id: conv.customer_id },
          include: {
            children: true,
            reservations: {
              include: { assigned_staff: { select: { id: true, name: true } } },
              orderBy: { created_at: 'desc' },
            },
          },
        });
        if (hydrated) cust = hydrated;
      } catch {}
    }
    const lastMessages = await messageService.getRecentMessages(conversationId, 3, tenantId);
    const unreadMap = await messageService.getUnreadCountsBatch([conversationId], tenantId);
    const ownershipMap = await staffOwnershipService.getByCustomerIds(tenantId, [conv.customer_id]);

    const { resolveTreatmentValue } = await import('./capi.service');
    let ltv = 0;
    const resList = cust?.reservations || [];
    for (const r of resList) {
      const val = await resolveTreatmentValue(r.treatment_detail || r.raw_text, tenantId);
      ltv += val || 0;
    }

    return serializeLiveChatConversation(
      {
        ...conv,
        customer: cust,
        messages: lastMessages,
      },
      { purchaseCount: resList.length, ltv },
      unreadMap.get(conversationId) || 0,
      ownershipMap.get(conv.customer_id) ?? null
    );
  }

  /**
   * Thread pesan sebuah percakapan (kronologis).
   */
  public async getConversationMessages(conversationId: string, tenantId: string, limit = 50): Promise<any[]> {
    const { messages } = await this.getConversationMessagesPaged(conversationId, tenantId, limit);
    return messages;
  }

  /**
   * Thread pesan paged (cursor-based): `before`/`after` + `focusMessageId`.
   * Mengembalikan pesan kronologis (lama -> baru) + flag hasMore/hasNewer.
   */
  public async getConversationMessagesPaged(
    conversationId: string,
    tenantId: string,
    limit = 50,
    before?: string | Date,
    focusMessageId?: string,
    after?: string | Date
  ): Promise<{
    messages: any[];
    hasMore: boolean;
    hasNewer: boolean;
    newestCursor: string | null;
    pinnedMessage?: any;
  }> {
    const page = await messageThreadService.getRecentMessagesWithHasMore(
      conversationId,
      limit,
      tenantId,
      before,
      focusMessageId,
      after
    );
    // Pin diambil di lapisan pemanggil agar modul thread tidak bergantung pada
    // message-pin.service (mencegah siklus import baru).
    const pinnedMessage = await messageService.getPinnedMessage(conversationId, tenantId);
    return { ...page, pinnedMessage };
  }

  /**
   * Admin membalas percakapan dari dashboard Live Chat.
   * - Kirim via gateway tenant (WAHA/WABA)
   * - WABA: blokir 409 WABA_OUTSIDE_WINDOW bila lewat 24h window (kecuali acknowledgeOutsideWindow)
   * - Log sebagai sender_type='ADMIN' (Live Chat publish message.created via messageService)
   * - Auto-escalation ke HUMAN_HANDLING bila tenant.manual_reply_escalates aktif
   */
  public async sendAdminReply(params: {
    conversationId: string;
    text?: string;
    imageB64?: string;
    mediaUrl?: string;
    thumbB64?: string;
    mimeType?: string;
    fileName?: string;
    tenantId: string;
    adminName?: string;
    acknowledgeOutsideWindow?: boolean;
    /**
     * Paksa eskalasi ke HUMAN_HANDLING (bot diam) walaupun
     * tenant.manual_reply_escalates nonaktif. Dipakai saat balasan
     * berasal dari Staff/Bidan (bukan admin bot) — balasan terapis WAJIB
     * menonaktifkan bot agar tidak membalas menyela percakapan.
     */
    forceEscalate?: boolean;
    /**
     * ID pesan yang dibalas (Reply/Quote). Bisa berupa UUID pesan lokal atau wa_message_id.
     */
    replyToMessageId?: string;
    /**
     * Paksa simpan sebagai CATATAN INTERNAL (hanya terlihat tim klinik), tanpa
     * memanggil gateway WhatsApp. Dipakai tombol gembok di composer. Bila true,
     * seluruh teks diperlakukan sebagai isi catatan (tanpa perlu prefix /notes).
     */
    isInternalNote?: boolean;
    /**
     * Idempotency key dari HP terapis (Fase 1.2). Dikirim ulang apa adanya saat
     * tombol "Coba Kirim Lagi" ditekan setelah timeout sinyal. Bila kunci sama
     * masih dalam TTL 5 menit → balikan hasil pengiriman pertama (tanpa kirim dobel).
     */
    clientTempId?: string;
    /**
     * Penanda bahwa pengiriman dipicu dari aksi widget/drawer dispatch lapangan.
     */
    dispatchOrigin?: boolean;
  }): Promise<AdminReplyResult> {
    const { conversationId, text, imageB64, mediaUrl, thumbB64, mimeType, fileName, tenantId, adminName, acknowledgeOutsideWindow, forceEscalate, replyToMessageId, clientTempId, dispatchOrigin } = params;

    // Fase 1.2: idempotensi retry berbasis clientTempId (retry timeout sinyal 1-bar).
    const prevClientTemp = await LiveChatService.recentClientTemps.getAsync(clientTempId);
    if (prevClientTemp) {
      return {
        success: true,
        conversationId,
        messageId: prevClientTemp.messageId,
        id: prevClientTemp.id,
      };
    }

    const hasText = !!text && !!text.trim();
    
    // Idempotency Check: cegah pengiriman ganda dalam 2 detik
    const hash = `${conversationId}:${hasText ? text!.trim() : ''}:${!!imageB64 || !!mediaUrl}:${replyToMessageId || ''}:${clientTempId || ''}`;
    // Store ber-TTL: `get` hanya mengembalikan entri yang belum kedaluwarsa.
    const lastSent = await LiveChatService.recentReplies.getAsync(hash);
    if (lastSent) {

      return { success: false, error: { code: 'DUPLICATE_REPLY', message: 'Pesan yang sama sedang diproses/sudah dikirim dalam 2 detik terakhir.' } };
    }
    const hasImage = !!imageB64 || !!mediaUrl;
    if (!hasText && !hasImage) {
      return { success: false, error: { code: 'EMPTY_REPLY', message: 'Isi balasan tidak boleh kosong.' } };
    }

    const conversation = await conversationService.getConversationById(conversationId, tenantId);
    if (!conversation) {
      return { success: false, error: { code: 'CONVERSATION_NOT_FOUND', message: `Conversation ${conversationId} tidak ditemukan.` } };
    }

    // ------------------------------------------------------------------
    // GERBANG KODE DETERMINISTIK: Catatan Internal (/notes).
    // DILARANG bergantung pada prompt AI untuk membedakan /notes.
    // Pencegatan WAJIB di sini (sebelum resolusi customer/gateway): bila
    // terdeteksi, gateway WhatsApp HARAM dipanggil. Hanya `/notes` persis atau
    // `/notes <isi>` (bukan `/notesX`). Tidak butuh nomor HP customer.
    // ------------------------------------------------------------------
    const noteCmd = parseInternalNoteCommand(text, params.isInternalNote);
    if (noteCmd.isInternal) {
      if (!noteCmd.cleanNote) {
        return { success: false, error: { code: 'EMPTY_NOTE', message: 'Catatan internal tidak boleh kosong.' } };
      }
      const savedNote = await messageService.logMessage({
        tenantId,
        conversationId,
        direction: Direction.OUTBOUND,
        content: noteCmd.cleanNote,
        senderType: 'INTERNAL_NOTE',
        senderName: adminName || 'Staff',
        // Catatan internal BUKAN percakapan customer → jangan evaluasi MQL/follow-up.
        skipMqlEvaluation: true,
      });
      // PENTING: langsung return TANPA memanggil gateway WhatsApp.
      return { success: true, isInternal: true, messageId: savedNote?.id, id: savedNote?.id };
    }

    const customer = await customerService.getCustomerById(conversation.customer_id, tenantId);
    if (!customer || !customer.phone) {
      return { success: false, error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer dari conversation tidak ditemukan.' } };
    }

    // QA TEST guard: jangan pernah kirim balasan admin ke nomor dummy chat test/simulasi
    // lewat gateway WhatsApp asli (WAHA/WABA). Chat sandbox hanya boleh dilihat/dianalisis.
    if (customer.is_sandbox_test) {
      return {
        success: false,
        error: {
          code: 'SANDBOX_REPLY_BLOCKED',
          message: 'Balasan admin ke chat test/simulasi (sandbox) diblokir untuk melindungi WhatsApp asli. Gunakan hanya untuk pemantauan.',
        },
      };
    }

    // MT-2.1: Deteksi palang pintu kunjungan lapangan tanpa reservasi aktif (state, bukan regex teks obrolan)
    let dispatchWarning: string | undefined = undefined;
    try {
      const isSharelocSend = /\[LOCATION[:\s]*Lat/i.test(text || '') || Boolean((params as any).location);
      const isDispatchMediaSend = (!!imageB64 || !!mediaUrl) && (params.dispatchOrigin === true || params.forceEscalate === true);
      if (isSharelocSend || isDispatchMediaSend) {
        const { wibDayBoundsUtc } = await import('../utils/wib-time');
        const { start, end } = wibDayBoundsUtc(0);

        const todayRes = await prisma.reservation.findFirst({
          where: {
            tenant_id: tenantId,
            customer_id: conversation.customer_id,
            booking_date: { gte: start, lte: end },
            status: { in: ['confirmed', 'en_route'] },
          },
        });

        const completedTodayRes = await prisma.reservation.findFirst({
          where: {
            tenant_id: tenantId,
            customer_id: conversation.customer_id,
            booking_date: { gte: start, lte: end },
            status: 'completed',
          },
        });

        const { staffTripTrackingService } = await import('./staff-trip-tracking.service');
        const activeTrip = todayRes?.id ? staffTripTrackingService.getTrip(tenantId, todayRes.id) : null;
        const otwActive = Boolean((todayRes as any)?.otw_sent_at && !(todayRes as any)?.arrived_at);

        if (!todayRes && !completedTodayRes && !activeTrip && !otwActive) {
          dispatchWarning = 'NO_ACTIVE_RESERVATION_TODAY';
          const { auditService } = await import('./audit.service');
          await auditService.logAdminAction({
            apiKey: 'internal',
            tenantId,
            action: 'UNREGISTERED_VISIT_DISPATCH_DETECTED',
            adminIdentity: adminName || 'Staff',
            payload: {
              conversationId,
              customerId: conversation.customer_id,
              isSharelocSend,
              isDispatchMediaSend,
            },
          }).catch(() => {});
        }
      }
    } catch (_) {}

    const gateway = await resolveGatewayForTenant(tenantId);

    const { whatsappProviderService } = await import('./whatsapp-provider.service');
    const isCutOff = await whatsappProviderService.isOutboundCutOff(tenantId);
    if (isCutOff) {
      return {
        success: false,
        error: {
          code: 'OUTBOUND_CUTOFF_ACTIVE',
          message: 'Koneksi outbound WhatsApp sedang diputus oleh Administrator (Cut-Off Darurat aktif). Mohon aktifkan kembali koneksi di menu Pengaturan Provider WhatsApp atau toggle Bot di atas.',
        },
        provider: gateway.providerType,
      };
    }

    // Resolusi quoted message / wa_message_id jika ada replyToMessageId
    let replyToWaMessageId: string | undefined = undefined;
    let quotedMeta: any = undefined;

    if (replyToMessageId) {
      try {
        const quotedMsg = await messageService.getMessageById(replyToMessageId, tenantId);
        if (!quotedMsg) {
          console.warn(`[Live Chat] Pesan kutipan tidak ditemukan: ${replyToMessageId} — quote dilewati.`);
        } else if (quotedMsg.conversation_id && quotedMsg.conversation_id !== conversationId) {
          console.warn(`[Live Chat] Tolak quote lintas percakapan: ${replyToMessageId} — quote dilewati.`);
        } else {
          quotedMeta = {
            id: quotedMsg.id,
            wa_message_id: quotedMsg.wa_message_id,
            direction: quotedMsg.direction,
            sender_name:
              quotedMsg.sender_name ||
              (quotedMsg.direction === 'INBOUND' ? customer.name || 'Customer' : 'Admin'),
            sender_type: quotedMsg.sender_type,
            content: quotedMsg.content,
            media: (quotedMsg as any).payload_raw?.media || undefined,
          };
          if (isValidReplyToForProvider(gateway.providerType, quotedMsg.wa_message_id)) {
            replyToWaMessageId = quotedMsg.wa_message_id;
          } else {
            console.warn(
              `[Live Chat] wa_message_id tidak valid untuk ${gateway.providerType}: ` +
                `${quotedMsg.wa_message_id ?? '(null)'} — quote dilewati, teks tetap dikirim.`
            );
          }
        }
      } catch (err: any) {
        console.warn('[Live Chat] Gagal mengambil detail quoted message:', err.message);
        // JANGAN fallback ke replyToMessageId
      }
    }

    // WABA 24h window: hanya tenant ber-provider WABA yang membatasi teks bebas
    // (berlaku juga untuk gambar + caption, karena termasuk free-form content)
    if (gateway.providerType === 'WABA' && hasImage && !process.env.PUBLIC_BASE_URL) {
      // Gambar WABA butuh URL publik; tanpanya Meta tak bisa mengambil media.
      return {
        success: false,
        error: {
          code: 'MEDIA_PUBLIC_URL_REQUIRED',
          message: 'Konfigurasi PUBLIC_BASE_URL diperlukan untuk mengirim gambar via WABA. Set variabel lingkungan PUBLIC_BASE_URL ke domain publik bot.',
        },
        provider: gateway.providerType,
      };
    }

    if (!hasImage && gateway.providerType === 'WABA') {
      const lastInboundAt = await this.getLastInboundAt(conversationId, tenantId);
      if (lastInboundAt && Date.now() - new Date(lastInboundAt).getTime() > WABA_WINDOW_MS && !acknowledgeOutsideWindow) {
        return {
          success: false,
          error: {
            code: 'WABA_OUTSIDE_WINDOW',
            message: `Balasan admin melewati 24h window percakapan WABA (last_inbound ${lastInboundAt.toISOString()}). Gunakan template HSM atau set acknowledgeOutsideWindow=true.`,
          },
        };
      }
    }

    let sendResult: any = { success: false };
    let content = (hasText ? text!.trim() : '') || '';
    let mediaMeta: any;
    let sendTarget = '';

    // Hanya proses media satu kali, jangan dilakukan berulang kali dalam loop
    if (hasImage) {
      const { mediaService } = await import('./media.service');
      let hdUrl = '';
      let thumbUrl: string | null = null;

      if (mediaUrl) {
        // Reuse existing saved media URL without creating duplicate files on disk
        hdUrl = mediaUrl;
        // PENTING: resolveThumbRelativeUrl mengembalikan URL publik relatif
        // (/media/...). resolveThumbFallback mengembalikan PATH ABSOLUT dan akan
        // merusak <img src> di browser (dashboard jatuh ke HD + flash "Memuat...").
        thumbUrl = mediaService.resolveThumbRelativeUrl(mediaUrl);
      } else {
        const saved = await mediaService.saveOutboundMedia({
          tenantId,
          imageB64: imageB64!,
          thumbB64,
          mimeType,
          fileName,
        });
        hdUrl = saved.hdUrl;
        thumbUrl = saved.thumbUrl;
      }

      const resolved = mediaService.resolveOutboundForProvider(hdUrl, gateway.providerType);
      if (!resolved) {
        return { success: false, error: { code: 'MEDIA_PUBLIC_URL_REQUIRED', message: 'Gagal me-resolve URL media untuk pengiriman.' }, provider: gateway.providerType };
      }
      sendTarget = resolved;
      
      mediaMeta = {
        url: thumbUrl || hdUrl,
        hdUrl: hdUrl,
        thumbUrl: thumbUrl ?? undefined,
        mimeType,
        caption: hasText ? text!.trim() : null,
        fileName,
      };
    }

    // Tandai pesan terbaca (sendSeen / centang biru) saat admin mengirim balasan
    if (typeof gateway.markAsRead === 'function') {
      await gateway.markAsRead(customer.phone).catch(() => {});
    }

    // Smart Caption Splitter: WhatsApp membatasi caption gambar maks 1024 karakter
    let imageCaption = content || undefined;
    let followUpTexts: string[] = [];
    if (hasImage && content) {
      const { splitImageCaption } = await import('./caption-splitter');
      const splitResult = splitImageCaption(content, 1000);
      imageCaption = splitResult.imageCaption;
      followUpTexts = splitResult.followUpTexts;
    }

    // Catat idempotency HANYA setelah seluruh validasi lolos — kegagalan validasi
    // (kosong/sandbox/cut-off/window) tidak boleh memblokir percobaan berikutnya.
    LiveChatService.recentReplies.set(hash, {});
    // UTL-15: hash duplikat 2 detik juga dibagikan lintas proses.
    void LiveChatService.recentReplies.setAsync(hash, {});

    // Skema Retry Lokal (Maksimal 2 Percobaan)
    let attempts = 0;
    const maxAttempts = 2;

    const sendOptions = replyToWaMessageId ? { replyToMessageId: replyToWaMessageId } : undefined;

    while (attempts < maxAttempts) {
      attempts++;
      if (hasImage) {
        sendResult = sendOptions
          ? await gateway.sendImageMessage(customer.phone, sendTarget, imageCaption, sendOptions)
          : await gateway.sendImageMessage(customer.phone, sendTarget, imageCaption);
      } else {
        sendResult = sendOptions
          ? await gateway.sendTextMessage(customer.phone, content, sendOptions)
          : await gateway.sendTextMessage(customer.phone, content);
      }

      if (sendResult.success) {
        break; // Berhasil, keluar dari loop
      } else if (attempts < maxAttempts) {
        console.warn(`[Live Chat] Percobaan ${attempts} gagal kirim ke ${customer.phone}, retry dalam 2s...`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // Jika pesan gambar utama berhasil terkirim dan ada followUpTexts, kirim teks lanjutan secara sekuensial
    if (hasImage && sendResult?.success && followUpTexts.length > 0) {
      for (const followUp of followUpTexts) {
        try {
          await gateway.sendTextMessage(customer.phone, followUp);
        } catch (fErr: any) {
          console.error(`[Live Chat] Gagal mengirim pesan teks lanjutan setelah gambar ke ${customer.phone}:`, fErr?.message || fErr);
        }
      }
    }

    if (hasImage && !hasText) {
      content = '[IMAGE]';
    }

    if (!sendResult.success) {
      if (hasImage && mediaMeta?.hdUrl) {
        console.warn(`[LIVE CHAT MEDIA] Pengiriman gambar ke WhatsApp gagal, tetapi file tetap tersimpan di storage: ${mediaMeta.hdUrl}`);
      }
      
      // Kirim Notifikasi Darurat ke Telegram agar Admin Tahu Gateway Bermasalah
      alertService.notifyAlert({
        type: AlertType.THIRD_PARTY_OUTAGE,
        severity: AlertSeverity.CRITICAL,
        provider: gateway.providerType,
        message: `Admin/Terapis (${adminName || 'Admin'}) gagal membalas chat ke ${customer.phone} setelah ${maxAttempts}x percobaan. Pesan: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}". Harap periksa status WAHA/WABA.`,
        metadata: {
          error: sendResult.error,
          conversationId,
        }
      });

      return {
        success: false,
        error: sendResult.error || { code: 'SEND_FAILED', message: 'Gagal mengirim pesan ke WhatsApp setelah percobaan ulang.' },
        provider: gateway.providerType,
      };
    }

    // Bangun payload_raw
    const payloadRaw: Record<string, any> = {};
    if (mediaMeta) payloadRaw.media = mediaMeta;
    if (quotedMeta) payloadRaw.quoted_message = quotedMeta;
    if (replyToWaMessageId && !sendResult.replyToDropped) {
      payloadRaw.reply_to = replyToWaMessageId;
    }
    if (quotedMeta && !replyToWaMessageId) {
      // Quote ditemukan di DB tetapi ID-nya tidak sah untuk provider ini:
      // pesan tetap dikirim, quote dibatalkan sebelum menyentuh gateway.
      payloadRaw.reply_to_status = 'dropped_before_send';
    }
    if (sendResult.replyToDropped) {
      payloadRaw.reply_to_status = 'dropped_after_provider_reject';
    }
    if (params.dispatchOrigin === true) payloadRaw.dispatchOrigin = true;
    if (params.forceEscalate === true) payloadRaw.forceEscalate = true;

    // Audit Trail + Live Chat publish (message.created)
    //
    // GERBANG KODE (audit Fase 0): pesan SUDAH diterima gateway WhatsApp di titik ini.
    // Kegagalan pencatatan DB TIDAK boleh mengubah hasil menjadi HTTP 500, karena
    // dashboard akan menandai bubble "gagal" dan admin mengirim ulang → pasien
    // menerima pesan dobel. Catat sebagai warning eksplisit, balikan tetap sukses.
    let logged: any = null;
    let persistenceWarning: string | undefined;
    try {
      logged = await messageService.logMessage({
        tenantId,
        conversationId,
        direction: Direction.OUTBOUND,
        content,
        waMessageId: sendResult.messageId,
        senderType: 'ADMIN',
        senderName: adminName || 'Admin',
        payloadRaw: Object.keys(payloadRaw).length > 0 ? payloadRaw : undefined,
      });
    } catch (persistErr: any) {
      console.error(
        '[LIVE CHAT] Pesan sudah terkirim ke WhatsApp tetapi gagal dicatat ke DB:',
        persistErr?.message || persistErr
      );
      persistenceWarning = 'MESSAGE_SENT_NOT_PERSISTED';
    }

    // Sync unread: balasan admin dashboard juga langsung tandai sudah dibaca (paritas dengan WA HP)
    try {
      await messageService.markConversationMessagesAsRead(conversationId, tenantId);
      await conversationService.setManualUnread(conversationId, tenantId, false);
    } catch (_) {}

    // Pulse alert (Fase 4): PADAMKAN status frustrasi HANYA bila balasan nyata
    // (sender_type=ADMIN) benar-benar terkirim ke WhatsApp. Catatan internal /notes
    // sudah return lebih awal (tidak sampai sini), dan kegagalan kirim sudah return
    // di atas → jadi di sini cukup pastikan tipe pengirim adalah ADMIN.
    if (logged?.sender_type === 'ADMIN') {
      try {
        // AUDIT FASE 3: tenant_id masuk WHERE (anti cross-tenant write).
        const clearRes = await prisma.conversation.updateMany({
          where: { id: conversationId, tenant_id: tenantId },
          data: { is_frustrated: false, frustrated_at: null, frustrated_reason: null },
        });
        const cleared = clearRes.count > 0
          ? await prisma.conversation.findFirst({ where: { id: conversationId, tenant_id: tenantId } })
          : null;
        if (!cleared) throw new Error('Conversation not found for tenant');
        // Multi-viewer sync: siarkan pemadaman ke SEMUA dashboard admin
        // (bukan hanya tab pengirim) via SSE conversation.updated.
        try {
          const { getLiveChatHub } = await import('./live-chat-hub.service');
          await getLiveChatHub().publish({
            type: 'conversation.updated',
            tenantId,
            payload: buildConversationUpdatedPayload(cleared),
          });
        } catch (_) {}
      } catch (_) {}
    }

    // Background enrichment jika pesan admin mengandung jarak / ongkir / info lokasi
    try {
      const { humanBackgroundEnrichmentService } = await import('./human-background-enrichment.service');
      humanBackgroundEnrichmentService.enrichFromAdminOutboundAsync(content, customer.id, tenantId);
    } catch (_) {}

    // Auto-capture reservasi & alamat jika pesan admin adalah rincian invoice/reservasi
    try {
      const { isReservationFormMessage, parseReservationText } = await import('../utils/reservation-text-parser');
      if (isReservationFormMessage(content, { tenantId })) {
        const parseResult = parseReservationText(content);
        if (parseResult.success && parseResult.reservation) {
          const parsed = parseResult.reservation;
          const { upsertReservationForm } = await import('./reservation-lifecycle.service');
          await upsertReservationForm({
            tenantId,
            customerId: customer.id,
            chatId: `${customer.phone}@c.us`,
            treatmentCategory: parsed.treatmentCategory,
            treatmentDetail: parsed.treatmentDetail,
            bookingDate: parsed.bookingDate,
            rawText: content,
            purchaseValue: parsed.payment?.totalPrice || parsed.payment?.treatmentPrice || undefined,
            babies: parsed.babies || [],
            customerName: parsed.name,
            kecamatan: parsed.kec,
            kota: parsed.kota,
            kelurahan: undefined,
            address: parsed.address?.trim() || undefined,
            source: 'ADMIN_OUTBOUND_AUTO_CAPTURE',
          }).catch((err) => console.warn('[LIVE CHAT OUTBOUND AUTO-CAPTURE UPSERT WARN]', err?.message || err));

          if (parsed.address?.trim()) {
            const { customerService } = await import('./customer.service');
            await customerService.updateCustomer(customer.id, {
              address: parsed.address.trim(),
              kecamatan: parsed.kec?.trim() || undefined,
              kota: parsed.kota?.trim() || undefined,
            }, tenantId).catch(() => {});
          }
        }
      }
    } catch (adminCaptureErr: any) {
      console.warn('[LIVE CHAT OUTBOUND AUTO-CAPTURE ERROR]', adminCaptureErr?.message || adminCaptureErr);
    }

    // Auto-escalation: balasan admin menandakan percakapan ditangani manusia.
    // forceEscalate=true (balasan Staff/Bidan) selalu mengaktifkan mode human,
    // sehingga bot tidak ikut membalas di tengah percakapan terapis.
    let updated: any = conversation;
    if (conversation.is_human_handling) {
      updated = await conversationService.resetHumanHandlingTimer(conversationId, tenantId);
    } else if (forceEscalate || (await this.getManualReplyEscalates(tenantId))) {
      updated = await conversationService.escalateToHumanHandling(
        conversation,
        customer.phone,
        'Balasan manual admin (auto-escalation via Live Chat)',
        tenantId,
        'manual_reply'
      );
    }

    // CAPI InitiateCheckout: jika pesan admin adalah form reservasi (teks mengandung
    // format_checkout tenant), anggap user memulai checkout → fire event (fire-and-forget).
    try {
      const { getTenantCapiFormats, fireCapiEvent } = await import('./capi.service');
      const formats = await getTenantCapiFormats(tenantId);
      const checkoutKeyword = formats.formatCheckout.toLowerCase().replace(/\s+/g, ' ').trim();
      const replyLower = (text || '').toLowerCase();
      if (checkoutKeyword.length > 0 && hasText && replyLower.includes(checkoutKeyword)) {
        let adClick: any;
        try {
          adClick = await prisma.adClick.findUnique({ where: { customerId: customer.id } });
        } catch (_) {
          adClick = undefined;
        }
        fireCapiEvent({
          eventName: 'InitiateCheckout',
          customer,
          adClick: adClick || undefined,
          tenantId,
          customData: { source: 'ADMIN_FORM_SENT' },
        });
      }
    } catch (capiErr) {
      console.warn('[CAPI] InitiateCheckout (admin form) skipped:', (capiErr as Error).message);
    }

    // Fase 1.2: catat clientTempId SUKSES → retry berikutnya (timeout sinyal) mengembalikan
    // hasil yang sama tanpa mengirim ulang bubble ke pasien.
    LiveChatService.recentClientTemps.set(clientTempId, {
      messageId: sendResult.messageId,
      id: logged?.id,
    });
    // UTL-15: sebarkan hasil ke KV bersama agar retry dari proses lain juga
    // mengembalikan hasil yang sama (tanpa menunggu cache lokal).
    void LiveChatService.recentClientTemps.setAsync(clientTempId, {
      messageId: sendResult.messageId,
      id: logged?.id,
    });

    const replyToWarning = sendResult.replyToDropped ? 'REPLY_TO_DROPPED' : undefined;

    return {
      success: true,
      conversationId,
      messageId: sendResult.messageId,
      id: logged?.id,
      provider: gateway.providerType,
      conversation: updated ? buildConversationUpdatedPayload(updated) : undefined,
      warning: persistenceWarning || dispatchWarning || replyToWarning,
    };
  }

  /**
   * Mengambil kapabilitas gateway WhatsApp tenant aktif (misal: kemampuan tarik pesan / revoke, edit, reaction).
   */
  public async getGatewayCapability(tenantId: string): Promise<{
    provider: string;
    supportsRevoke: boolean;
    supportsEdit: boolean;
    supportsReaction: boolean;
  }> {
    const gateway = await resolveGatewayForTenant(tenantId);
    return {
      provider: gateway.providerType,
      supportsRevoke: !!gateway.supportsRevoke,
      supportsEdit: !!gateway.supportsEdit,
      supportsReaction: (gateway as any).supportsReaction ?? true,
    };
  }

  /**
   * Mengirim reaksi emotikon ke pesan WhatsApp (Outbound Reaction dari admin/petugas).
   */
  public async sendReaction(params: {
    conversationId: string;
    messageId: string;
    emoji: string;
    tenantId: string;
    adminName?: string;
  }): Promise<{ success: boolean; reactions?: any[]; error?: string }> {
    const { conversationId, messageId, emoji, tenantId, adminName = 'Admin' } = params;

    const conversation = await conversationService.getConversationById(conversationId, tenantId);
    if (!conversation) {
      return { success: false, error: 'Percakapan tidak ditemukan.' };
    }

    const customer = await customerService.getCustomerById(conversation.customer_id, tenantId);
    if (!customer?.phone) {
      return { success: false, error: 'Data nomor WhatsApp customer tidak ditemukan.' };
    }

    const { whatsappProviderService } = await import('./whatsapp-provider.service');
    const isCutOff = await whatsappProviderService.isOutboundCutOff(tenantId);
    if (isCutOff) {
      return { success: false, error: 'Koneksi outbound WhatsApp sedang diputus oleh Administrator (Cut-Off Darurat aktif).' };
    }

    // Cari pesan di DB / memory
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
    } catch {
      msg = null;
    }
    if (!msg) {
      const memoryMsgs = messageService.getMemoryMessages();
      msg = memoryMsgs.find(
        (m) => (m.id === messageId || m.wa_message_id === messageId) && m.conversation_id === conversationId
      );
    }

    if (!msg) {
      return { success: false, error: 'Pesan tidak ditemukan.' };
    }

    if (String(msg.sender_type || '').toUpperCase() === 'INTERNAL_NOTE') {
      return { success: false, error: 'Catatan internal tidak dapat diberi reaksi WhatsApp.' };
    }

    if (msg.is_revoked || (msg.payload_raw as any)?.is_revoked || msg.content === '🚫 Pesan ini telah ditarik') {
      return { success: false, error: 'Pesan yang sudah ditarik tidak dapat diberi reaksi.' };
    }

    // Panggil gateway sendReactionMessage jika bukan sandbox test chat (V-05: jujur gagal bila WAHA gagal)
    if (!customer.is_sandbox_test) {
      if (!msg.wa_message_id) {
        return { success: false, error: 'Pesan ini tidak memiliki ID WhatsApp sehingga reaksi tidak dapat dikirim.' };
      }
      const gateway = await resolveGatewayForTenant(tenantId);
      if (typeof gateway.sendReactionMessage === 'function') {
        try {
          const reactionRes = await gateway.sendReactionMessage(customer.phone, msg.wa_message_id, emoji);
          if (!reactionRes.success) {
            console.warn(`[REACTION WARNING] Failed to send reaction to WhatsApp:`, reactionRes.error?.message);
            return {
              success: false,
              error: reactionRes.error?.message || 'Gagal mengirim reaksi ke WhatsApp.',
            };
          }
        } catch (gwErr: any) {
          console.warn(`[REACTION ERROR] Gateway sendReaction error:`, gwErr.message);
          return {
            success: false,
            error: gwErr?.message || 'Gagal mengirim reaksi ke WhatsApp.',
          };
        }
      }
    }

    // Simpan reaksi di DB/memory dan broadcast via LiveChatHub
    const updateRes = await messageService.addOrUpdateReaction(msg.id, tenantId, {
      emoji,
      fromMe: true,
      senderName: adminName,
    });

    // Audit log
    const { auditService } = await import('./audit.service');
    await auditService.logAdminAction({
      apiKey: 'LIVE_CHAT',
      adminIdentity: adminName,
      action: 'SEND_REACTION',
      targetId: msg.id,
      payload: {
        conversationId,
        messageId: msg.id,
        waMessageId: msg.wa_message_id,
        emoji,
        customerPhone: customer.phone,
      },
      tenantId,
    });

    return { success: true, reactions: updateRes.reactions };
  }

  /**
   * Menarik / menghapus pesan WhatsApp untuk semua orang (Revoke / Delete for Everyone).
   * Hanya diizinkan untuk pesan OUTBOUND dan jika provider gateway mendukung revoke (WAHA).
   */
  public async revokeMessage(params: {
    conversationId: string;
    messageId: string;
    tenantId: string;
    adminName?: string;
  }): Promise<{ success: boolean; error?: string }> {
    const { conversationId, messageId, tenantId, adminName = 'Admin' } = params;

    const gateway = await resolveGatewayForTenant(tenantId);
    if (!gateway.supportsRevoke) {
      return {
        success: false,
        error: `Provider WhatsApp tenant (${gateway.providerType}) tidak mendukung fitur tarik pesan untuk semua orang (Delete for Everyone).`,
      };
    }

    const conversation = await conversationService.getConversationById(conversationId, tenantId);
    if (!conversation) {
      return { success: false, error: 'Percakapan tidak ditemukan.' };
    }

    const customer = await customerService.getCustomerById(conversation.customer_id, tenantId);
    if (!customer?.phone) {
      return { success: false, error: 'Data nomor WhatsApp customer tidak ditemukan.' };
    }

    const { whatsappProviderService } = await import('./whatsapp-provider.service');
    const isCutOff = await whatsappProviderService.isOutboundCutOff(tenantId);
    if (isCutOff) {
      return { success: false, error: 'Koneksi outbound WhatsApp sedang diputus oleh Administrator (Cut-Off Darurat aktif).' };
    }

    // Cari pesan di DB / memory — dual-ID (internal UUID ATAU wa_message_id),
    // konsisten dengan sendReaction/addOrUpdateReaction.
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
    } catch {
      msg = null;
    }
    if (!msg) {
      const memoryMsgs = messageService.getMemoryMessages();
      msg = memoryMsgs.find(
        (m) => (m.id === messageId || m.wa_message_id === messageId) && m.conversation_id === conversationId
      );
    }

    if (!msg) {
      return { success: false, error: 'Pesan tidak ditemukan.' };
    }

    if (String(msg.sender_type || '').toUpperCase() === 'INTERNAL_NOTE') {
      return { success: false, error: 'Catatan internal tidak dapat ditarik ke WhatsApp.' };
    }

    if (msg.direction !== Direction.OUTBOUND && msg.direction !== 'OUTBOUND') {
      return { success: false, error: 'Hanya pesan keluar (outbound) yang dapat ditarik.' };
    }

    // Panggil gateway deleteMessage untuk chat non-sandbox (CD-06: sandbox bypass WAHA; V-03: wajib wa_message_id)
    if (!customer.is_sandbox_test) {
      if (!msg.wa_message_id) {
        return {
          success: false,
          error: 'Pesan historis ini tidak memiliki ID WhatsApp sehingga tidak dapat ditarik.',
        };
      }
      const deleteResult = await gateway.deleteMessage(customer.phone, msg.wa_message_id, true);
      if (!deleteResult.success) {
        const rawError = deleteResult.error || '';
        const friendlyError = rawError.includes('404')
          ? 'Pesan tidak ditemukan di server WhatsApp (kemungkinan sudah ditarik atau sesi WhatsApp telah ter-reset).'
          : rawError || 'Gagal menarik pesan dari WhatsApp.';
        return { success: false, error: friendlyError };
      }
    }

    // Update pesan di DB (dual-write kolom + payload_raw) & broadcast SSE
    await messageService.markMessageDeleted(msg.id, tenantId, 'ADMIN');

    // Audit log
    const { auditService } = await import('./audit.service');
    await auditService.logAdminAction({
      apiKey: 'LIVE_CHAT',
      adminIdentity: adminName,
      action: 'REVOKE_MESSAGE',
      targetId: msg.id,
      payload: {
        conversationId,
        messageId: msg.id,
        waMessageId: msg.wa_message_id,
        customerPhone: customer.phone,
      },
      tenantId,
    });

    return { success: true };
  }

  /**
   * Mengedit pesan outbound (hanya bisa dalam 15 menit pertama sesuai batas WhatsApp).
   */
  async editMessage(params: {
    conversationId: string;
    messageId: string;
    newContent: string;
    tenantId: string;
    adminName?: string;
  }): Promise<{ success: boolean; error?: string }> {
    const { conversationId, messageId, newContent, tenantId, adminName } = params;

    if (!newContent || !newContent.trim()) {
      return { success: false, error: 'Isi pesan baru tidak boleh kosong.' };
    }

    const gateway = await resolveGatewayForTenant(tenantId);
    if (!gateway.supportsEdit) {
      return {
        success: false,
        error: `Provider WhatsApp (${gateway.providerType}) tidak mendukung fitur edit pesan.`,
      };
    }

    // Ambil conversation untuk cek customer
    const conversation = await conversationService.getConversationById(conversationId, tenantId);
    if (!conversation) {
      return { success: false, error: 'Percakapan tidak ditemukan.' };
    }

    const customer = await customerService.getCustomerById(conversation.customer_id, tenantId);
    if (!customer?.phone) {
      return { success: false, error: 'Data nomor WhatsApp customer tidak ditemukan.' };
    }

    const { whatsappProviderService } = await import('./whatsapp-provider.service');
    const isCutOff = await whatsappProviderService.isOutboundCutOff(tenantId);
    if (isCutOff) {
      return { success: false, error: 'Koneksi outbound WhatsApp sedang diputus oleh Administrator (Cut-Off Darurat aktif).' };
    }

    // Cari pesan di DB / memory — dual-ID (internal UUID ATAU wa_message_id),
    // konsisten dengan sendReaction/addOrUpdateReaction.
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
    } catch {
      msg = null;
    }
    if (!msg) {
      const memoryMsgs = messageService.getMemoryMessages();
      msg = memoryMsgs.find(
        (m) => (m.id === messageId || m.wa_message_id === messageId) && m.conversation_id === conversationId
      );
    }

    if (!msg) {
      return { success: false, error: 'Pesan tidak ditemukan.' };
    }

    if (String(msg.sender_type || '').toUpperCase() === 'INTERNAL_NOTE') {
      return { success: false, error: 'Catatan internal tidak dapat diedit ke WhatsApp.' };
    }

    if (msg.is_revoked || (msg.payload_raw as any)?.is_revoked || msg.content === '🚫 Pesan ini telah ditarik') {
      return { success: false, error: 'Pesan yang telah ditarik tidak dapat diedit.' };
    }

    if (msg.direction !== Direction.OUTBOUND && msg.direction !== 'OUTBOUND') {
      return { success: false, error: 'Hanya pesan keluar (outbound) yang dapat diedit.' };
    }

    // Cek batas waktu 15 menit (15 * 60 * 1000 = 900.000 ms)
    const msgCreatedAt = new Date(msg.created_at || Date.now()).getTime();
    const ageMs = Date.now() - msgCreatedAt;
    if (ageMs > 15 * 60 * 1000) {
      return {
        success: false,
        error: 'WhatsApp hanya mengizinkan pengeditan pesan dalam 15 menit pertama setelah terkirim.',
      };
    }

    // Panggil gateway editMessage untuk chat non-sandbox (CD-06: sandbox bypass WAHA; V-03: wajib wa_message_id)
    if (!customer.is_sandbox_test) {
      if (!msg.wa_message_id) {
        return {
          success: false,
          error: 'Pesan historis ini tidak memiliki ID WhatsApp sehingga tidak dapat diedit.',
        };
      }
      const editResult = await gateway.editMessage(customer.phone, msg.wa_message_id, newContent.trim());
      if (!editResult.success) {
        const rawError = editResult.error || '';
        const friendlyError = rawError.includes('404')
          ? 'Pesan tidak ditemukan di server WhatsApp atau sudah melewati batas waktu pengeditan (15 menit).'
          : rawError || 'Gagal mengedit pesan di WhatsApp.';
        return { success: false, error: friendlyError };
      }
    }

    // Update pesan di DB & broadcast SSE
    await messageService.updateMessageContent(msg.id, newContent.trim(), tenantId);

    // Audit log
    const { auditService } = await import('./audit.service');
    await auditService.logAdminAction({
      apiKey: 'LIVE_CHAT',
      adminIdentity: adminName,
      action: 'EDIT_MESSAGE',
      targetId: msg.id,
      payload: {
        conversationId,
        messageId: msg.id,
        waMessageId: msg.wa_message_id,
        customerPhone: customer.phone,
        newContent: newContent.trim(),
      },
      tenantId,
    });

    return { success: true };
  }

  private async getLastInboundAt(conversationId: string, tenantId: string): Promise<Date | null> {
    try {
      const rows = await (prisma.message as any).groupBy({
        by: ['conversation_id'],
        where: { conversation_id: conversationId, tenant_id: tenantId, direction: Direction.INBOUND },
        _max: { created_at: true },
      });
      return rows?.[0]?._max?.created_at || null;
    } catch (error) {
      // DB offline / groupBy tak tersedia → tidak bisa verifikasi window (jangan blokir balasan)
      return null;
    }
  }

  /**
   * AI Copilot: Menghasilkan draf saran balasan profesional dari sudut pandang Bidan/CS
   * sejalan dengan alur LLM utama (Ground Truth, Katalog/SOP RAG, CoT reasoning & Logger).
   */
  public async generateAiSuggestion(conversationId: string, tenantId: string): Promise<string> {
    try {
      const { messageService } = await import('./message.service');
      const { getLlmEndpointConfig } = await import('../integrations/llm/llm-gateway');
      const { callChatCompletionsWithFallback } = await import('../integrations/llm/model-fallback');
      // Identitas klinik WAJIB tenant-aware (mandat non-hardcode). Sebelumnya
      // prompt menulis literal "Bidan Yusi dari Kala Moms & Baby Spa" untuk
      // SEMUA tenant sehingga draf tenant lain bisa menyebut brand asing.
      const { getBrandIdentityAsync } = await import('../config/brand');
      const brand = await getBrandIdentityAsync(tenantId);
      const recent = await messageService.getRecentMessages(conversationId, 6, tenantId);
      // Catatan internal (INTERNAL_NOTE) DIKECUALIKAN dari konteks AI — bukan bagian
      // percakapan customer; mencegah koordinasi staf bocor ke draf balasan.
      const recentReal = recent.filter((m: any) => m?.sender_type !== 'INTERNAL_NOTE');
      const historyFormatted = recentReal.map((m) => `${m.direction === 'INBOUND' ? 'Customer' : 'Bidan'}: ${m.content}`).join('\n');
      const cfg = getLlmEndpointConfig({ modelConfigKey: 'CHAT_REPLY', tenantId });

      const resp = await callChatCompletionsWithFallback({
        model: cfg.model,
        fallbackModel: cfg.fallbackModel,
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        timeoutMs: cfg.timeoutMs,
        payload: {
          messages: [
            {
              role: 'system',
              content: `Kamu adalah ${brand.botDisplayName} dari ${brand.businessName}. Buatkan 1 saran balasan WhatsApp yang hangat, profesional, sopan, dan solutif untuk membantu tim CS/Bidan membalas chat customer.`
            },
            {
              role: 'user',
              content: `Berikut riwayat percakapan:\n${historyFormatted}\n\nBuatkan draf balasan singkat (1 bubble WhatsApp) dari sudut pandang ${brand.botDisplayName}:`
            }
          ],
          max_tokens: 250,
        }
      });
      const draft = resp.data?.choices?.[0]?.message?.content?.trim();
      if (!draft) {
        // Jangan menyerahkan kalimat template sebagai "draf AI" — itu ghost success.
        throw new Error('Model AI tidak mengembalikan isi draf.');
      }
      return draft;
    } catch (err: any) {
      console.warn('[AI SUGGESTION ERROR]:', err.message);
      // Naikkan error ke route (HTTP 500) agar UI menampilkan kegagalan nyata,
      // bukan toast "Draf jawaban AI berhasil dibuat" untuk kalimat cadangan.
      throw new Error(`Gagal membuat draf balasan AI: ${err.message || 'layanan AI tidak tersedia'}`);
    }
  }

  private async getManualReplyEscalates(tenantId: string): Promise<boolean> {
    try {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      return tenant ? !!tenant.manual_reply_escalates : true;
    } catch (error) {
      return true; // default aman
    }
  }
}

export const liveChatService = new LiveChatService();

