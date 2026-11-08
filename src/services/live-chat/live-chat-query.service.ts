import { prisma } from '../../db/client';
import { Direction } from '@prisma/client';
import { conversationService } from '../conversation.service';
import { customerService } from '../customer.service';
import { messageService } from '../message.service';
import { staffOwnershipService } from '../staff-ownership.service';
import { serializeConversationItem } from './live-chat-serializer';
import { LiveChatConversationItem } from './types';

export class LiveChatQueryService {
  /**
   * Monitor Live Chat: daftar percakapan terbaru + preview pesan (dengan sender_type/sender_name).
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
    const { items: conversations, hasMore, total } = await conversationService.listConversations(
      tenantId,
      take,
      offset,
      mode,
      search,
      label as any,
      filter,
      staffId
    );
    if (conversations.length === 0) {
      return { items: [], hasMore: false, total };
    }

    const conversationIds = conversations.map((c) => c.id);
    const customerIds = [...new Set(conversations.map((c) => c.customer_id))];
    const ownershipMap = await staffOwnershipService.getByCustomerIds(tenantId, customerIds);

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
      for (const id of customerIds) {
        const c = await customerService.getCustomerById(id, tenantId);
        if (c) customers.set(id, c);
      }
    }

    const { resolveTreatmentValue } = await import('../capi.service');
    const treatmentPriceCache = new Map<string, number>();
    const customerStats = new Map<string, { purchaseCount: number; ltv: number }>();
    for (const [id, cust] of customers.entries()) {
      let ltv = 0;
      const resList = cust.reservations || [];
      for (const r of resList) {
        const text = r.treatment_detail || r.raw_text;
        if (text) {
          if (!treatmentPriceCache.has(text)) {
            const val = (await resolveTreatmentValue(text)) || 0;
            treatmentPriceCache.set(text, val);
          }
          ltv += treatmentPriceCache.get(text) || 0;
        }
      }
      customerStats.set(id, { purchaseCount: resList.length, ltv });
    }

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
      for (const cid of conversationIds) {
        lastMessagesByConv.set(cid, await messageService.getRecentMessages(cid, 3, tenantId));
      }
    }

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

    const unreadMap = await messageService.getUnreadCountsBatch(conversationIds, tenantId);

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
      serializeConversationItem(
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

    return { items, hasMore, total };
  }

  /**
   * Mengambil detail satu percakapan berformat LiveChatConversationItem.
   */
  public async getConversationDetail(
    conversationId: string,
    tenantId: string
  ): Promise<LiveChatConversationItem | null> {
    const conv = await conversationService.getConversationById(conversationId, tenantId);
    if (!conv) return null;

    let cust = await customerService.getCustomerById(conv.customer_id, tenantId);
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

    const { resolveTreatmentValue } = await import('../capi.service');
    let ltv = 0;
    const resList = cust?.reservations || [];
    for (const r of resList) {
      const val = await resolveTreatmentValue(r.treatment_detail || r.raw_text);
      ltv += val || 0;
    }

    return serializeConversationItem(
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
   * Thread pesan paged (cursor-based): `before` = ISO timestamp / Date cursor.
   */
  public async getConversationMessagesPaged(
    conversationId: string,
    tenantId: string,
    limit = 50,
    before?: string | Date,
    focusMessageId?: string
  ): Promise<{ messages: any[]; hasMore: boolean; pinnedMessage?: any }> {
    return messageService.getRecentMessagesWithHasMore(conversationId, limit, tenantId, before, focusMessageId);
  }

  public async getLastInboundAt(conversationId: string, tenantId: string): Promise<Date | null> {
    try {
      const rows = await (prisma.message as any).groupBy({
        by: ['conversation_id'],
        where: { conversation_id: conversationId, tenant_id: tenantId, direction: Direction.INBOUND },
        _max: { created_at: true },
      });
      return rows?.[0]?._max?.created_at || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * AI Copilot: Menghasilkan draf saran balasan profesional dari sudut pandang Bidan/CS
   */
  public async generateAiSuggestion(conversationId: string, tenantId: string): Promise<string> {
    try {
      const { messageService: msgSvc } = await import('../message.service');
      const { getLlmEndpointConfig } = await import('../../integrations/llm/llm-gateway');
      const { callChatCompletionsWithFallback } = await import('../../integrations/llm/model-fallback');
      const { getBrandIdentityAsync } = await import('../../config/brand');
      const brand = await getBrandIdentityAsync(tenantId);
      const recent = await msgSvc.getRecentMessages(conversationId, 6, tenantId);
      const recentReal = recent.filter((m: any) => m?.sender_type !== 'INTERNAL_NOTE');
      const historyFormatted = recentReal
        .map((m) => `${m.direction === 'INBOUND' ? 'Customer' : 'Bidan'}: ${m.content}`)
        .join('\n');
      const cfg = getLlmEndpointConfig({ modelConfigKey: 'CHAT_REPLY' });

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
              content: `Kamu adalah ${brand.botDisplayName} dari ${brand.businessName}. Buatkan 1 saran balasan WhatsApp yang hangat, profesional, sopan, dan solutif untuk membantu tim CS/Bidan membalas chat customer.`,
            },
            {
              role: 'user',
              content: `Berikut riwayat percakapan:\n${historyFormatted}\n\nBuatkan draf balasan singkat (1 bubble WhatsApp) dari sudut pandang ${brand.botDisplayName}:`,
            },
          ],
          max_tokens: 250,
        },
      });
      const draft = resp.data?.choices?.[0]?.message?.content?.trim();
      if (!draft) {
        throw new Error('Model AI tidak mengembalikan isi draf.');
      }
      return draft;
    } catch (err: any) {
      console.warn('[AI SUGGESTION ERROR]:', err.message);
      throw new Error(`Gagal membuat draf balasan AI: ${err.message || 'layanan AI tidak tersedia'}`);
    }
  }
}

export const liveChatQueryService = new LiveChatQueryService();
