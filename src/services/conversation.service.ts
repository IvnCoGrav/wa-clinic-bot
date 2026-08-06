import { prisma } from '../db/client';
import { ConversationState } from '@prisma/client';
import { clinicConfig } from '../config/clinic';
import { getLiveChatHub } from './live-chat-hub.service';
import { AI_ELIGIBILITY_ESCALATION_REASON } from './ai-eligibility.service';

const memoryConversations = new Map<string, any>();

export function buildConversationUpdatedPayload(conversation: any) {
  return {
    conversationId: conversation.id,
    currentState: conversation.current_state,
    previousState: conversation.previous_state ?? null,
    isHumanHandling: !!conversation.is_human_handling,
    humanHandlingSince: conversation.human_handling_since ?? null,
    escalationReason: conversation.escalation_reason ?? null,
    lastMessageAt: conversation.last_message_at ?? null,
    customerId: conversation.customer_id,
  };
}

export class ConversationService {
  /**
   * Cari conversation aktif milik customer, atau buat baru dengan state INITIAL jika belum ada.
   */
  public async getOrCreateConversation(customerId: string, tenantId: string): Promise<any> {
    try {
      let conversation = await prisma.conversation.findFirst({
        where: { customer_id: customerId, tenant_id: tenantId },
        orderBy: { updated_at: 'desc' },
      });

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            tenant_id: tenantId,
            customer_id: customerId,
            current_state: ConversationState.INITIAL,
            is_human_handling: false,
          },
        });
      }

      memoryConversations.set(conversation.id, conversation);
      return conversation;
    } catch (error) {
      // Memory store fallback
      let conv = Array.from(memoryConversations.values()).find((c) => c.customer_id === customerId && c.tenant_id === tenantId);
      if (!conv) {
        conv = {
          id: `conv_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          tenant_id: tenantId,
          customer_id: customerId,
          current_state: ConversationState.INITIAL,
          previous_state: null,
          location_attempts: 0,
          is_human_handling: false,
          human_handling_since: null,
          consecutive_unknown_count: 0,
          last_message_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        };
        memoryConversations.set(conv.id, conv);
      }
      return conv;
    }
  }

  /**
   * Hapus snapshot conversation milik customer dari memory fallback store (dipakai saat
   * hard wipe /reset supaya tidak menyisakan snapshot stale di memori).
   */
  public clearConversationMemory(customerId: string): void {
    for (const [id, conv] of Array.from(memoryConversations.entries())) {
      if (conv.customer_id === customerId) {
        memoryConversations.delete(id);
      }
    }
  }

  /**
   * Cari conversation by id (dengan memory store fallback saat DB offline).
   */
  public async getConversationById(id: string, tenantId: string): Promise<any> {
    try {
      const conv = await prisma.conversation.findUnique({ where: { id } });
      return conv || memoryConversations.get(id) || null;
    } catch (error) {
      return memoryConversations.get(id) || null;
    }
  }

  /**
   * Daftar percakapan per tenant dengan paging offset (dengan memory store fallback saat DB offline).
   * Urutan: human-handling di atas (yang butuh aksi admin), lalu sisanya by last_message_at desc —
   * dipindah ke DB supaya stabil antar halaman (infinite scroll).
   */
  public async listConversations(tenantId: string, take = 50, offset = 0): Promise<any[]> {
    try {
      const convs = await prisma.conversation.findMany({
        where: { tenant_id: tenantId },
        orderBy: [
          { is_human_handling: 'desc' },
          { last_message_at: 'desc' },
        ],
        skip: offset,
        take,
      });
      convs.forEach((c) => memoryConversations.set(c.id, c));
      return convs;
    } catch (error) {
      return Array.from(memoryConversations.values())
        .filter((c) => c.tenant_id === tenantId)
        .sort((a, b) => {
          if (!!a.is_human_handling !== !!b.is_human_handling) return a.is_human_handling ? -1 : 1;
          return new Date(b.updated_at || b.last_message_at).getTime() - new Date(a.updated_at || a.last_message_at).getTime();
        })
        .slice(offset, offset + take);
    }
  }

  /**
   * Evaluasi Auto-Release Timeout pada conversation:
   * Jika flag is_human_handling aktif lebih dari HUMAN_HANDLING_TIMEOUT_HOURS (default 6 jam)
   * tanpa balasan dari human agent, otomatis kembalikan ke bot dan pulihkan previous_state!
   */
  public checkAndApplyAutoRelease(conversation: any, tenantId: string): { released: boolean; updatedConversation: any } {
    if (!conversation.is_human_handling || !conversation.human_handling_since) {
      return { released: false, updatedConversation: conversation };
    }

    // EXPLICIT GUARD: 6-hour auto-release is DISABLED for medical_concern escalation to protect customer safety
    if (conversation.escalation_reason === 'medical_concern') {
      console.log(`[AUTO-RELEASE EXEMPTION] Conversation ${conversation.id} is in HUMAN_HANDLING due to medical_concern. 6-hour auto-release is DISABLED.`);
      return { released: false, updatedConversation: conversation };
    }

    // EXPLICIT GUARD: Legacy customer non-AI (AI Rollout Scope) TIDAK boleh auto-release
    // kembali ke bot — customer ini memang diarahkan ke human handling permanen.
    if (conversation.escalation_reason === AI_ELIGIBILITY_ESCALATION_REASON) {
      console.log(`[AUTO-RELEASE EXEMPTION] Conversation ${conversation.id} is in HUMAN_HANDLING due to ${AI_ELIGIBILITY_ESCALATION_REASON}. 6-hour auto-release is DISABLED.`);
      return { released: false, updatedConversation: conversation };
    }

    const since = new Date(conversation.human_handling_since).getTime();

    const now = new Date().getTime();
    const hoursElapsed = (now - since) / (1000 * 60 * 60);

    const timeoutLimitHours = clinicConfig.humanHandlingTimeoutHours;

    if (hoursElapsed >= timeoutLimitHours) {
      console.log(
        `[AUTO-RELEASE TRIGGERED] Conversation ${conversation.id} human handling timed out (${hoursElapsed.toFixed(2)} hrs > ${timeoutLimitHours} hrs). Restoring previous_state: ${conversation.previous_state}`
      );

      // Kembalikan ke state sebelumnya (restored from previous_state)
      const restoredState = conversation.previous_state || ConversationState.INITIAL;

      conversation.is_human_handling = false;
      conversation.human_handling_since = null;
      conversation.current_state = restoredState;

      // Async sync ke DB
      this.updateConversationState(
        conversation.id,
        {
          currentState: restoredState,
          isHumanHandling: false,
          humanHandlingSince: null,
        },
        tenantId
      ).catch((err) => console.error('Failed to sync auto-release to DB:', err));

      // Remove label "hold" from WhatsApp/WAHA chat (default ON, matikan dengan ENABLE_WAHA_HOLD_LABEL=false)
      const enableHoldLabel = process.env.ENABLE_WAHA_HOLD_LABEL !== 'false';
      if (enableHoldLabel) {
        try {
          const { wahaClient } = require('../integrations/waha/client');
          prisma.customer.findUnique({ where: { id: conversation.customer_id } })
            .then((customer: any) => {
              if (customer) {
                wahaClient.removeLabel(`${customer.phone}@c.us`, 'hold')
                  .catch((err: any) => console.error('[LABEL ERROR] Failed to remove hold label on auto-release:', err.message));
              }
            });
        } catch (err: any) {
          console.error('[LABEL ERROR] Failed to initiate hold label removal on auto-release:', err.message);
        }
      }

      return { released: true, updatedConversation: conversation };
    }

    return { released: false, updatedConversation: conversation };
  }

  /**
   * Update state percakapan, previous_state, dan attempt counter.
   */
  public async updateConversationState(
    conversationId: string,
    updates: {
      currentState?: ConversationState;
      previousState?: ConversationState | null;
      locationAttempts?: number;
      isHumanHandling?: boolean;
      humanHandlingSince?: Date | null;
      escalationReason?: string | null;
      consecutiveUnknownCount?: number;
    },
    tenantId: string
  ): Promise<any> {
    const dataToUpdate: any = {
      last_message_at: new Date(),
    };

    if (updates.currentState !== undefined) dataToUpdate.current_state = updates.currentState;
    if (updates.previousState !== undefined) dataToUpdate.previous_state = updates.previousState;
    if (updates.locationAttempts !== undefined) dataToUpdate.location_attempts = updates.locationAttempts;
    if (updates.isHumanHandling !== undefined) dataToUpdate.is_human_handling = updates.isHumanHandling;
    if (updates.humanHandlingSince !== undefined) dataToUpdate.human_handling_since = updates.humanHandlingSince;
    if (updates.escalationReason !== undefined) dataToUpdate.escalation_reason = updates.escalationReason;
    if (updates.consecutiveUnknownCount !== undefined) dataToUpdate.consecutive_unknown_count = updates.consecutiveUnknownCount;

    try {
      const existing = await prisma.conversation.findFirst({
        where: { id: conversationId, tenant_id: tenantId },
      });
      if (!existing) {
        throw new Error(`Conversation ${conversationId} not found for tenant ${tenantId}`);
      }

      const updated = await prisma.conversation.update({
        where: { id: conversationId },
        data: dataToUpdate,
      });
      memoryConversations.set(conversationId, updated);
      this.publishConversationUpdated(updated, tenantId);
      return updated;
    } catch (error) {
      // Memory fallback update
      const conv = memoryConversations.get(conversationId);
      if (conv && conv.tenant_id === tenantId) {
        if (updates.currentState !== undefined) conv.current_state = updates.currentState;
        if (updates.previousState !== undefined) conv.previous_state = updates.previousState;
        if (updates.locationAttempts !== undefined) conv.location_attempts = updates.locationAttempts;
        if (updates.isHumanHandling !== undefined) conv.is_human_handling = updates.isHumanHandling;
        if (updates.humanHandlingSince !== undefined) conv.human_handling_since = updates.humanHandlingSince;
        if (updates.escalationReason !== undefined) conv.escalation_reason = updates.escalationReason;
        if (updates.consecutiveUnknownCount !== undefined) conv.consecutive_unknown_count = updates.consecutiveUnknownCount;
        conv.updated_at = new Date();
        this.publishConversationUpdated(conv, tenantId);
      }
      return conv;
    }
  }

  /**
   * Reset timer auto-release (human_handling_since) saat admin membalas percakapan
   * yang sedang dalam HUMAN_HANDLING (dari dashboard atau dari HP asli via WAHA fromMe).
   * Tidak menonaktifkan human handling — hanya menggeser jendela 6 jam.
   */
  public async resetHumanHandlingTimer(conversationId: string, tenantId: string): Promise<any> {
    return this.updateConversationState(conversationId, { humanHandlingSince: new Date() }, tenantId);
  }

  /**
   * Broadcast state percakapan ke Live Chat hub (fire-and-forget).
   */
  private publishConversationUpdated(conversation: any, tenantId: string): void {
    getLiveChatHub()
      .publish({
        type: 'conversation.updated',
        tenantId,
        payload: buildConversationUpdatedPayload(conversation),
      })
      .catch(() => {});
  }

  /**
   * Transisi ke HUMAN_HANDLING: Otomatis menyimpan state saat ini ke previous_state
   */
  public async escalateToHumanHandling(
    conversation: any,
    phone: string,
    reason: string,
    tenantId: string,
    escalationReason?: string
  ): Promise<any> {
    console.log(`[HUMAN HANDOFF] Conversation ${conversation.id} escalated to human handling. Reason: ${reason}`);

    const currentStateBeforeEscalation = conversation.current_state;

    // Tambahkan label "hold" secara otomatis ke chat WAHA (default ON, matikan dengan ENABLE_WAHA_HOLD_LABEL=false)
    const enableHoldLabel = process.env.ENABLE_WAHA_HOLD_LABEL !== 'false';
    if (enableHoldLabel) {
      try {
        const { wahaClient } = await import('../integrations/waha/client');
        await wahaClient.addLabel(`${phone}@c.us`, 'hold');
      } catch (err: any) {
        console.warn(`[LABEL ERROR] Failed to auto-add hold label during escalation:`, err.message);
      }
    } else {
      console.log(`[LABEL SKIP] Skipping hold label addition in production (feature flag disabled).`);
    }

    return await this.updateConversationState(
      conversation.id,
      {
        currentState: ConversationState.HUMAN_HANDLING,
        previousState: currentStateBeforeEscalation,
        isHumanHandling: true,
        humanHandlingSince: new Date(),
        escalationReason: escalationReason || undefined,
      },
      tenantId
    );
  }
}

export const conversationService = new ConversationService();
