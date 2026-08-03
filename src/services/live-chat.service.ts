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
   */
  public async getConversationList(tenantId: string, limit = 50): Promise<LiveChatConversationItem[]> {
    const conversations = await conversationService.listConversations(tenantId, limit);
    const items: LiveChatConversationItem[] = [];
    for (const c of conversations) {
      const customer = await customerService.getCustomerById(c.customer_id, tenantId);
      const lastMessages = await messageService.getRecentMessages(c.id, 3, tenantId);
      items.push(this.serialize({ ...c, customer, messages: lastMessages }));
    }
    return items;
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
    text: string;
    tenantId: string;
    adminName?: string;
    acknowledgeOutsideWindow?: boolean;
  }): Promise<AdminReplyResult> {
    const { conversationId, text, tenantId, adminName, acknowledgeOutsideWindow } = params;

    if (!text || !text.trim()) {
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

    const gateway = await resolveGatewayForTenant(tenantId);

    // WABA 24h window: hanya tenant ber-provider WABA yang membatasi teks bebas
    if (gateway.providerType === 'WABA') {
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

    const sendResult = await gateway.sendTextMessage(customer.phone, text);
    if (!sendResult.success) {
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
      content: text,
      waMessageId: sendResult.messageId,
      senderType: 'ADMIN',
      senderName: adminName || 'Admin',
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

    return {
      success: true,
      conversationId,
      messageId: sendResult.messageId,
      provider: gateway.providerType,
      conversation: updated ? buildConversationUpdatedPayload(updated) : undefined,
    };
  }

  private serialize(c: any): LiveChatConversationItem {
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
