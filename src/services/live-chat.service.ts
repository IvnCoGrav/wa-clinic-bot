import { prisma } from '../db/client';
import { Direction } from '@prisma/client';
import { conversationService, buildConversationUpdatedPayload } from './conversation.service';
import { customerService } from './customer.service';
import { messageService } from './message.service';
import { resolveGatewayForTenant } from '../integrations/whatsapp/factory';
import { alertService, AlertType, AlertSeverity } from './alert.service';

// WABA free-form text hanya diperbolehkan dalam 24 jam sejak pesan inbound terakhir customer
const WABA_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface LiveChatConversationItem {
  conversationId: string;
  customerId: string;
  customerName: string | null;
  customerPhone: string | null;
  currentState: string;
  isHumanHandling: boolean;
  humanHandlingSince: Date | null;
  escalationReason: string | null;
  lastMessageAt: Date;
  createdAt: Date;
  lastMessages: any[];
  isMql?: boolean;
  mqlBubbleCount?: number;
  mqlTriggeredAt?: Date | null;
  isSandboxTest?: boolean;
  trafficSource?: 'meta' | 'legacy' | null;
  purchaseCount?: number;
  ltv?: number;
  customerLabels?: { id: string; name: string; color: string }[];
  customerProfilePictureUrl?: string | null;
  unreadCount: number;
  isManualUnread: boolean;
  isPinned: boolean;
  pinnedAt: Date | null;
  isAwaitingReply: boolean;
}

/** Deteksi sumber traffic dari baris ad_clicks. */
function detectTrafficSource(adClick: any, isLegacy: boolean): 'meta' | 'legacy' | null {
  if (!adClick) {
    return isLegacy ? 'legacy' : null;
  }
  const utm = `${adClick.utmSource || ''} ${adClick.utmMedium || ''} ${adClick.utmCampaign || ''}`.toLowerCase();
  if (adClick.fbclid || adClick.fbc || /meta|facebook|instagram/i.test(utm)) {
    return 'meta';
  }
  return isLegacy ? 'legacy' : null;
}

export interface AdminReplyResult {
  success: boolean;
  conversationId?: string;
  messageId?: string;
  id?: string;
  provider?: string;
  conversation?: any;
  error?: { code: string; message?: string };
}

export class LiveChatService {
  // Local cache for idempotency check (to prevent double tap)
  private static recentReplies = new Map<string, number>();

  /**
   * Monitor Live Chat: daftar percakapan terbaru + preview pesan (dengan sender_type/sender_name).
   * Paging offset-based untuk infinite scroll; hasMore=true bila masih ada halaman berikutnya.
   */
  public async getConversationList(
    tenantId: string,
    take = 50,
    offset = 0,
    mode: 'all' | 'real' | 'sandbox' = 'all',
    search?: string
  ): Promise<{ items: LiveChatConversationItem[]; hasMore: boolean }> {
    const conversations = await conversationService.listConversations(tenantId, take, offset, mode, search);
    if (conversations.length === 0) {
      return { items: [], hasMore: false };
    }

    const conversationIds = conversations.map((c) => c.id);
    const customerIds = [...new Set(conversations.map((c) => c.customer_id))];

    // Batch fetch semua customer (1 query, bukan N query).
    let customers = new Map<string, any>();
    try {
      const rows = await prisma.customer.findMany({
        where: { id: { in: customerIds }, tenant_id: tenantId },
        include: { adClick: true, reservations: true, labels: { include: { label: true } } },
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
    const customerStats = new Map<string, { purchaseCount: number; ltv: number }>();
    for (const [id, cust] of customers.entries()) {
      let ltv = 0;
      const resList = cust.reservations || [];
      for (const r of resList) {
        const val = await resolveTreatmentValue(r.treatment_detail || r.raw_text);
        ltv += val || 0;
      }
      customerStats.set(id, { purchaseCount: resList.length, ltv });
    }

    // Batch fetch pesan terakhir per conversation (1 query, bukan N query).
    let lastMessagesByConv = new Map<string, any[]>();
    try {
      const rows = await prisma.message.findMany({
        where: { conversation_id: { in: conversationIds }, tenant_id: tenantId },
        orderBy: { created_at: 'desc' },
      });
      const grouped = new Map<string, any[]>();
      for (const m of rows) {
        const arr = grouped.get(m.conversation_id) || [];
        if (arr.length < 3) arr.push(m);
        grouped.set(m.conversation_id, arr);
      }
      for (const [cid, arr] of grouped.entries()) {
        lastMessagesByConv.set(cid, arr.reverse()); // kembalikan ke kronologis (lama -> baru)
      }
    } catch (error) {
      // DB offline → fallback per-conversation (memory store)
      for (const cid of conversationIds) {
        lastMessagesByConv.set(cid, await messageService.getRecentMessages(cid, 3, tenantId));
      }
    }

    // Batch fetch unread counts
    const unreadMap = await messageService.getUnreadCountsBatch(conversationIds, tenantId);

    // Background sync foto profil untuk customer yang belum ada / sudah kedaluwarsa (> 3 hari)
    for (const cust of customers.values()) {
      if (cust && cust.phone && !cust.is_sandbox_test) {
        const isStale =
          !cust.profile_picture_updated_at ||
          Date.now() - new Date(cust.profile_picture_updated_at).getTime() > 3 * 24 * 60 * 60 * 1000;
        if (isStale) {
          customerService.syncProfilePictureInBackground(cust.id, cust.phone, tenantId);
        }
      }
    }

    const items = conversations.map((c) =>
      this.serialize(
        {
          ...c,
          customer: customers.get(c.customer_id),
          messages: lastMessagesByConv.get(c.id) || [],
        },
        customerStats.get(c.customer_id),
        unreadMap.get(c.id) || 0
      )
    );
    // Urutan sudah dijamin DB (human handling di atas, lalu last_message_at desc) — stabil antar halaman.
    return { items, hasMore: conversations.length === take };
  }

  /**
   * Thread pesan sebuah percakapan (kronologis).
   */
  public async getConversationMessages(conversationId: string, tenantId: string, limit = 50): Promise<any[]> {
    return messageService.getRecentMessages(conversationId, limit, tenantId);
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
  }): Promise<AdminReplyResult> {
    const { conversationId, text, imageB64, thumbB64, mimeType, fileName, tenantId, adminName, acknowledgeOutsideWindow, forceEscalate } = params;

    const hasText = !!text && !!text.trim();
    
    // Idempotency Check: cegah pengiriman ganda dalam 2 detik
    const hash = `${conversationId}:${hasText ? text!.trim() : ''}:${!!imageB64}`;
    const now = Date.now();
    const lastSent = LiveChatService.recentReplies.get(hash);
    if (lastSent && now - lastSent < 2000) {
      return { success: false, error: { code: 'DUPLICATE_REPLY', message: 'Pesan yang sama sedang diproses/sudah dikirim dalam 2 detik terakhir.' } };
    }
    LiveChatService.recentReplies.set(hash, now);
    const hasImage = !!imageB64;
    if (!hasText && !hasImage) {
      return { success: false, error: { code: 'EMPTY_REPLY', message: 'Isi balasan tidak boleh kosong.' } };
    }

    const conversation = await conversationService.getConversationById(conversationId, tenantId);
    if (!conversation) {
      return { success: false, error: { code: 'CONVERSATION_NOT_FOUND', message: `Conversation ${conversationId} tidak ditemukan.` } };
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

    const gateway = await resolveGatewayForTenant(tenantId);

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
      const saved = await mediaService.saveOutboundMedia({
        tenantId,
        imageB64: imageB64!,
        thumbB64,
        mimeType,
        fileName,
      });

      const resolved = mediaService.resolveOutboundForProvider(saved.hdUrl, gateway.providerType);
      if (!resolved) {
        return { success: false, error: { code: 'MEDIA_PUBLIC_URL_REQUIRED', message: 'Gagal me-resolve URL media untuk pengiriman.' }, provider: gateway.providerType };
      }
      sendTarget = resolved;
      
      mediaMeta = {
        url: saved.thumbUrl || saved.hdUrl,
        hdUrl: saved.hdUrl,
        mimeType,
        caption: hasText ? text!.trim() : null,
        fileName,
      };
    }

    // Tandai pesan terbaca (sendSeen / centang biru) saat admin mengirim balasan
    if (typeof gateway.markAsRead === 'function') {
      await gateway.markAsRead(customer.phone).catch(() => {});
    }

    // Skema Retry Lokal (Maksimal 2 Percobaan)
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      attempts++;
      if (hasImage) {
        sendResult = await gateway.sendImageMessage(customer.phone, sendTarget, content || undefined);
      } else {
        sendResult = await gateway.sendTextMessage(customer.phone, content);
      }

      if (sendResult.success) {
        break; // Berhasil, keluar dari loop
      } else if (attempts < maxAttempts) {
        console.warn(`[Live Chat] Percobaan ${attempts} gagal kirim ke ${customer.phone}, retry dalam 2s...`);
        await new Promise(r => setTimeout(r, 2000));
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

    // Audit Trail + Live Chat publish (message.created)
    const logged = await messageService.logMessage({
      tenantId,
      conversationId,
      direction: Direction.OUTBOUND,
      content,
      waMessageId: sendResult.messageId,
      senderType: 'ADMIN',
      senderName: adminName || 'Admin',
      payloadRaw: mediaMeta ? { media: mediaMeta } : undefined,
    });

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

    return {
      success: true,
      conversationId,
      messageId: sendResult.messageId,
      id: logged?.id,
      provider: gateway.providerType,
      conversation: updated ? buildConversationUpdatedPayload(updated) : undefined,
    };
  }

  /**
   * Mengambil kapabilitas gateway WhatsApp tenant aktif (misal: kemampuan tarik pesan / revoke).
   */
  public async getGatewayCapability(tenantId: string): Promise<{
    provider: string;
    supportsRevoke: boolean;
  }> {
    const gateway = await resolveGatewayForTenant(tenantId);
    return {
      provider: gateway.providerType,
      supportsRevoke: !!gateway.supportsRevoke,
    };
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

    // Cari pesan di DB / memory
    let msg: any = null;
    try {
      msg = await prisma.message.findFirst({
        where: { id: messageId, conversation_id: conversationId, tenant_id: tenantId },
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

    if (msg.direction !== Direction.OUTBOUND && msg.direction !== 'OUTBOUND') {
      return { success: false, error: 'Hanya pesan keluar (outbound) yang dapat ditarik.' };
    }

    // Panggil gateway deleteMessage
    const targetWaId = msg.wa_message_id || msg.id;
    const deleteResult = await gateway.deleteMessage(customer.phone, targetWaId, true);
    if (!deleteResult.success) {
      const rawError = deleteResult.error || '';
      const friendlyError = rawError.includes('404')
        ? 'Pesan tidak ditemukan di server WhatsApp (kemungkinan sudah ditarik atau sesi WhatsApp telah ter-reset).'
        : rawError || 'Gagal menarik pesan dari WhatsApp.';
      return { success: false, error: friendlyError };
    }

    // Update pesan di DB & broadcast SSE
    await messageService.markMessageDeleted(msg.id, tenantId);

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

    // Cari pesan di DB / memory
    let msg: any = null;
    try {
      msg = await prisma.message.findFirst({
        where: { id: messageId, conversation_id: conversationId, tenant_id: tenantId },
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

    // Panggil gateway editMessage
    const targetWaId = msg.wa_message_id || msg.id;
    const editResult = await gateway.editMessage(customer.phone, targetWaId, newContent.trim());
    if (!editResult.success) {
      const rawError = editResult.error || '';
      const friendlyError = rawError.includes('404')
        ? 'Pesan tidak ditemukan di server WhatsApp atau sudah melewati batas waktu pengeditan (15 menit).'
        : rawError || 'Gagal mengedit pesan di WhatsApp.';
      return { success: false, error: friendlyError };
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

  private serialize(c: any, stats?: { purchaseCount: number; ltv: number }, unreadCount = 0): LiveChatConversationItem {
    const lastMsg = c.messages && c.messages.length > 0 ? c.messages[c.messages.length - 1] : null;
    const effectiveLastMsgAt = lastMsg?.created_at || c.last_message_at || c.updated_at;

    const isManualUnread = !!c.is_manual_unread;
    const effectiveUnreadCount = isManualUnread ? Math.max(1, unreadCount) : unreadCount;

    // Awaiting reply: unread = 0 (sudah dibaca), pesan terakhir dari customer (INBOUND), dan usia pesan <= 24 jam (86.400.000 ms)
    let isAwaitingReply = false;
    if (effectiveUnreadCount === 0 && !isManualUnread && lastMsg) {
      const isLastInbound = lastMsg.direction === Direction.INBOUND || lastMsg.direction === 'INBOUND';
      if (isLastInbound) {
        const msgAgeMs = Date.now() - new Date(lastMsg.created_at).getTime();
        if (msgAgeMs <= 24 * 60 * 60 * 1000) {
          isAwaitingReply = true;
        }
      }
    }

    return {
      conversationId: c.id,
      customerId: c.customer_id,
      customerName: c.customer?.name || null,
      customerPhone: c.customer?.phone || null,
      currentState: c.current_state,
      isHumanHandling: !!c.is_human_handling,
      humanHandlingSince: c.human_handling_since || null,
      escalationReason: c.escalation_reason || null,
      lastMessageAt: effectiveLastMsgAt,
      createdAt: c.created_at,
      lastMessages: c.messages || [],
      isMql: !!c.customer?.is_mql,
      mqlBubbleCount: c.customer?.mql_bubble_count || 0,
      mqlTriggeredAt: c.customer?.mql_triggered_at || null,
      isSandboxTest: !!c.customer?.is_sandbox_test,
      trafficSource: detectTrafficSource(c.customer?.adClick, !!c.customer?.is_legacy_source),
      purchaseCount: stats?.purchaseCount ?? (c.customer?.reservations?.length || 0),
      ltv: stats?.ltv || 0,
      customerLabels: c.customer?.labels?.map((cl: any) => cl.label || cl) || [],
      customerProfilePictureUrl: c.customer?.profile_picture_url || null,
      unreadCount: effectiveUnreadCount,
      isManualUnread,
      isPinned: !!c.is_pinned,
      pinnedAt: c.pinned_at || null,
      isAwaitingReply,
    };
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
   * berdasarkan riwayat pesan terakhir, konteks anak/reservasi, dan persona klinik.
   */
  public async generateAiSuggestion(conversationId: string, tenantId: string): Promise<string> {
    try {
      const conv = await prisma.conversation.findFirst({
        where: { id: conversationId, tenant_id: tenantId },
        include: {
          customer: {
            include: {
              children: true,
              reservations: { take: 5, orderBy: { created_at: 'desc' } },
              labels: { include: { label: true } },
            },
          },
          messages: {
            take: 10,
            orderBy: { created_at: 'desc' },
          },
        },
      });

      if (!conv) {
        throw new Error('Percakapan tidak ditemukan');
      }

      const customer = conv.customer;
      const customerName = customer?.name || 'Bunda';
      const childrenList = (customer?.children || []).map((c: any) => `${c.name || 'Anak'}${c.age_months ? ` (${c.age_months} bln)` : ''}`).join(', ') || '-';
      const reservationsList = (customer?.reservations || []).map((r: any) => `${r.treatment_detail || r.raw_text || 'Treatment'} [${r.status}]`).join(', ') || '-';
      const messagesAsc = (conv.messages || []).slice().reverse();

      const { getLlmEndpointConfig, callChatWithRetry } = await import('../integrations/llm/llm-gateway');
      const endpoint = getLlmEndpointConfig({ modelConfigKey: 'CHAT_REPLY' });

      if (!endpoint.apiKey) {
        return `Halo Bunda ${customerName}, terima kasih sudah menghubungi kami. Bidan kami siap membantu Bunda dan si kecil. Ada keluhan atau kebutuhan yang bisa kami bantu? 🙏🥰`;
      }

      const systemPrompt = `Kamu adalah Asisten Bidan & Customer Service di klinik homecare ibu dan anak "Kala Homecare".
Tugasmu adalah membantu Bidan menulis 1 draf balasan WhatsApp yang:
- Ramah, sopan, empatik, dan menenangkan (selalu sapa dengan "Bunda").
- Ringkas, to-the-point, dan solutif (jangan bertele-tele).
- Menggunakan bahasa Indonesia yang luwes dan hangat (boleh gunakan 1-2 emoji seperti 🙏🥰✨).
- HANYA kembalikan teks balasan yang siap dikirim langsung ke WhatsApp. JANGAN sertakan kalimat pembuka meta seperti "Berikut draf balasan:" atau tanda kutip.`;

      const userPrompt = `[DATA PASIEN]
Nama: ${customerName}
Anak: ${childrenList}
Riwayat Reservasi: ${reservationsList}

[RIWAYAT PERCAKAPAN TERAKHIR]
${messagesAsc.map((m: any) => `${m.direction === 'INBOUND' ? 'Bunda' : 'Bidan'}: ${m.content}`).join('\n')}

Buatkan draf balasan profesional dari Bidan untuk merespons pesan terakhir Bunda:`;

      const startTime = Date.now();
      const callResult = await callChatWithRetry({
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey,
        model: endpoint.model,
        fallbackModel: endpoint.fallbackModel,
        timeoutMs: 25000,
        payload: {
          temperature: 0.3,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        },
      });
      const latencyMs = Date.now() - startTime;

      // Telemetry: Catat LLM Usage & Biaya ke Buffer Audit
      try {
        const usage = callResult.data?.usage;
        const promptTokens = usage?.prompt_tokens || 0;
        const completionTokens = usage?.completion_tokens || 0;
        const cachedTokens = usage?.prompt_tokens_details?.cached_tokens || usage?.cached_prompt_tokens || 0;

        const { recordLlmUsage } = await import('../utils/llm-audit-buffer');
        const { deriveProvider } = await import('../utils/cost-calculator');

        recordLlmUsage({
          tenant_id: tenantId,
          customer_phone: customer?.phone || 'unknown',
          conversation_id: conversationId,
          provider: deriveProvider(callResult.baseUrl || endpoint.baseUrl),
          model_name: callResult.model || endpoint.model,
          task_type: 'AI_COPILOT_SUGGESTION',
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          cached_prompt_tokens: cachedTokens,
          latency_ms: latencyMs,
        });
      } catch (logErr: any) {
        console.warn('[AI SUGGESTION TELEMETRY ERROR]:', logErr.message);
      }

      const draft = callResult.data?.choices?.[0]?.message?.content?.trim() || '';
      return draft.replace(/^["']|["']$/g, '');
    } catch (err: any) {
      console.warn('[AI SUGGESTION ERROR]:', err.message);
      return `Halo Bunda, terima kasih atas pesannya. Terkait pertanyaan Bunda, ada yang bisa Bidan bantu lebih lanjut hari ini? 🙏✨`;
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

