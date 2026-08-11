import { prisma } from '../db/client';
import { Direction } from '@prisma/client';
import { conversationService, buildConversationUpdatedPayload } from './conversation.service';
import { customerService } from './customer.service';
import { messageService } from './message.service';
import { resolveGatewayForTenant } from '../integrations/whatsapp/factory';

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
  provider?: string;
  conversation?: any;
  error?: { code: string; message?: string };
}

export class LiveChatService {
  /**
   * Monitor Live Chat: daftar percakapan terbaru + preview pesan (dengan sender_type/sender_name).
   * Paging offset-based untuk infinite scroll; hasMore=true bila masih ada halaman berikutnya.
   */
  public async getConversationList(
    tenantId: string,
    take = 50,
    offset = 0,
    mode: 'all' | 'real' | 'sandbox' = 'all'
  ): Promise<{ items: LiveChatConversationItem[]; hasMore: boolean }> {
    const conversations = await conversationService.listConversations(tenantId, take, offset, mode);
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
        include: { adClick: true, reservations: true },
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

    const items = conversations.map((c) =>
      this.serialize(
        {
          ...c,
          customer: customers.get(c.customer_id),
          messages: lastMessagesByConv.get(c.id) || [],
        },
        customerStats.get(c.customer_id)
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
  }): Promise<AdminReplyResult> {
    const { conversationId, text, imageB64, thumbB64, mimeType, fileName, tenantId, adminName, acknowledgeOutsideWindow } = params;

    const hasText = !!text && !!text.trim();
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

    let sendResult;
    let content = (hasText ? text!.trim() : '') || '';
    let mediaMeta: any;

    if (hasImage) {
      const { mediaService } = await import('./media.service');
      const saved = await mediaService.saveOutboundMedia({
        tenantId,
        imageB64: imageB64!,
        thumbB64,
        mimeType,
        fileName,
      });

      const sendTarget = mediaService.resolveOutboundForProvider(saved.hdUrl, gateway.providerType);
      if (!sendTarget) {
        return { success: false, error: { code: 'MEDIA_PUBLIC_URL_REQUIRED', message: 'Gagal me-resolve URL media untuk pengiriman.' }, provider: gateway.providerType };
      }

      // Jika image + text, text dipakai sebagai caption gambar.
      sendResult = await gateway.sendImageMessage(customer.phone, sendTarget, content || undefined);
      if (!hasText) content = '[IMAGE]';
      mediaMeta = {
        url: saved.thumbUrl || saved.hdUrl,
        hdUrl: saved.hdUrl,
        mimeType,
        caption: hasText ? text!.trim() : null,
        fileName,
      };
    } else {
      sendResult = await gateway.sendTextMessage(customer.phone, content);
    }

    if (!sendResult.success) {
      if (hasImage && mediaMeta?.hdUrl) {
        console.warn(`[LIVE CHAT MEDIA] Pengiriman gambar ke WhatsApp gagal, tetapi file tetap tersimpan di storage: ${mediaMeta.hdUrl}`);
      }
      return {
        success: false,
        error: sendResult.error || { code: 'SEND_FAILED', message: 'Gagal mengirim pesan ke WhatsApp.' },
        provider: gateway.providerType,
      };
    }

    // Audit Trail + Live Chat publish (message.created)
    await messageService.logMessage({
      tenantId,
      conversationId,
      direction: Direction.OUTBOUND,
      content,
      waMessageId: sendResult.messageId,
      senderType: 'ADMIN',
      senderName: adminName || 'Admin',
      payloadRaw: mediaMeta ? { media: mediaMeta } : undefined,
    });

    // Auto-escalation: balasan admin menandakan percakapan ditangani manusia
    let updated: any = conversation;
    if (conversation.is_human_handling) {
      updated = await conversationService.resetHumanHandlingTimer(conversationId, tenantId);
    } else if (await this.getManualReplyEscalates(tenantId)) {
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
      provider: gateway.providerType,
      conversation: updated ? buildConversationUpdatedPayload(updated) : undefined,
    };
  }

  private serialize(c: any, stats?: { purchaseCount: number; ltv: number }): LiveChatConversationItem {
    return {
      conversationId: c.id,
      customerId: c.customer_id,
      customerName: c.customer?.name || null,
      customerPhone: c.customer?.phone || null,
      currentState: c.current_state,
      isHumanHandling: !!c.is_human_handling,
      humanHandlingSince: c.human_handling_since || null,
      escalationReason: c.escalation_reason || null,
      lastMessageAt: c.last_message_at,
      createdAt: c.created_at,
      lastMessages: c.messages || [],
      isMql: !!c.customer?.is_mql,
      mqlBubbleCount: c.customer?.mql_bubble_count || 0,
      mqlTriggeredAt: c.customer?.mql_triggered_at || null,
      isSandboxTest: !!c.customer?.is_sandbox_test,
      trafficSource: detectTrafficSource(c.customer?.adClick, !!c.customer?.is_legacy_source),
      purchaseCount: stats?.purchaseCount ?? (c.customer?.reservations?.length || 0),
      ltv: stats?.ltv || 0,
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
