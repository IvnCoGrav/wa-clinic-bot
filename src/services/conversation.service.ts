import { prisma } from '../db/client';
import { ConversationState } from '@prisma/client';
import { clinicConfig } from '../config/clinic';

const memoryConversations = new Map<string, any>();

export class ConversationService {
  /**
   * Cari conversation aktif milik customer, atau buat baru dengan state INITIAL jika belum ada.
   */
  public async getOrCreateConversation(customerId: string): Promise<any> {
    try {
      let conversation = await prisma.conversation.findFirst({
        where: { customer_id: customerId },
        orderBy: { updated_at: 'desc' },
      });

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
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
      let conv = Array.from(memoryConversations.values()).find((c) => c.customer_id === customerId);
      if (!conv) {
        conv = {
          id: `conv_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          customer_id: customerId,
          current_state: ConversationState.INITIAL,
          previous_state: null,
          location_attempts: 0,
          is_human_handling: false,
          human_handling_since: null,
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
  public checkAndApplyAutoRelease(conversation: any): { released: boolean; updatedConversation: any } {
    if (!conversation.is_human_handling || !conversation.human_handling_since) {
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
      this.updateConversationState(conversation.id, {
        currentState: restoredState,
        isHumanHandling: false,
        humanHandlingSince: null,
      }).catch((err) => console.error('Failed to sync auto-release to DB:', err));

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
    }
  ): Promise<any> {
    const dataToUpdate: any = {
      last_message_at: new Date(),
    };

    if (updates.currentState !== undefined) dataToUpdate.current_state = updates.currentState;
    if (updates.previousState !== undefined) dataToUpdate.previous_state = updates.previousState;
    if (updates.locationAttempts !== undefined) dataToUpdate.location_attempts = updates.locationAttempts;
    if (updates.isHumanHandling !== undefined) dataToUpdate.is_human_handling = updates.isHumanHandling;
    if (updates.humanHandlingSince !== undefined) dataToUpdate.human_handling_since = updates.humanHandlingSince;

    try {
      const updated = await prisma.conversation.update({
        where: { id: conversationId },
        data: dataToUpdate,
      });
      memoryConversations.set(conversationId, updated);
      return updated;
    } catch (error) {
      // Memory fallback update
      const conv = memoryConversations.get(conversationId);
      if (conv) {
        if (updates.currentState !== undefined) conv.current_state = updates.currentState;
        if (updates.previousState !== undefined) conv.previous_state = updates.previousState;
        if (updates.locationAttempts !== undefined) conv.location_attempts = updates.locationAttempts;
        if (updates.isHumanHandling !== undefined) conv.is_human_handling = updates.isHumanHandling;
        if (updates.humanHandlingSince !== undefined) conv.human_handling_since = updates.humanHandlingSince;
        conv.updated_at = new Date();
      }
      return conv;
    }
  }

  /**
   * Transisi ke HUMAN_HANDLING: Otomatis menyimpan state saat ini ke previous_state
   */
  public async escalateToHumanHandling(conversation: any, reason: string): Promise<any> {
    console.log(`[HUMAN HANDOFF] Conversation ${conversation.id} escalated to human handling. Reason: ${reason}`);

    const currentStateBeforeEscalation = conversation.current_state;

    return await this.updateConversationState(conversation.id, {
      currentState: ConversationState.HUMAN_HANDLING,
      previousState: currentStateBeforeEscalation,
      isHumanHandling: true,
      humanHandlingSince: new Date(),
    });
  }
}

export const conversationService = new ConversationService();
