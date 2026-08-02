import { prisma } from '../db/client';
import { ConversationState } from '@prisma/client';
import { clinicConfig } from '../config/clinic';

const memoryConversations = new Map<string, any>();

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

      // Remove label "hold" from WhatsApp/WAHA chat (dinonaktifkan di production sampai tervalidasi live)
      const enableHoldLabel = process.env.ENABLE_WAHA_HOLD_LABEL === 'true' || process.env.NODE_ENV !== 'production';
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
      }
      return conv;
    }
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

    // Tambahkan label "hold" secara otomatis ke chat WAHA (dinonaktifkan di production sampai tervalidasi live)
    const enableHoldLabel = process.env.ENABLE_WAHA_HOLD_LABEL === 'true' || process.env.NODE_ENV !== 'production';
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
