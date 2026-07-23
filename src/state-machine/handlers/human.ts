import { ConversationState } from '@prisma/client';
import { StateHandlerContext, StateHandlerResult } from '../types';
import { conversationService } from '../../services/conversation.service';
import { handleLocationState } from './location';
import { handleInterestState } from './interest';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

/**
 * Handler untuk state HUMAN_HANDLING:
 * Memeriksa auto-release timeout 6 jam. Jika masih dalam penganganan manusia (is_human_handling = true),
 * bot DIAM / TIDAK membalas otomatis. Jika sudah > 6 jam, kembalikan ke previous_state!
 */
export async function handleHumanHandlingState(ctx: StateHandlerContext): Promise<StateHandlerResult> {
  const { conversation, customer } = ctx;
  const tenantId = ctx.tenantId || customer?.tenant_id || DEFAULT_TENANT_ID;

  // 1. Periksa apakah timeout 6 jam sudah terlampaui (Auto-release evaluation)
  const autoRelease = conversationService.checkAndApplyAutoRelease(conversation, tenantId);

  // 2. Jika AUTO-RELEASE Terjadi:
  if (autoRelease.released) {
    const restoredState = autoRelease.updatedConversation.current_state as ConversationState;
    console.log(`[AUTO-RELEASE EXECUTED] Conversation ${conversation.id} restored to state: ${restoredState}`);

    // Update context dengan state baru
    ctx.conversation.current_state = restoredState;
    ctx.conversation.is_human_handling = false;

    // Rute pesan masuk ke handler state yang baru dipulihkan (misal AWAITING_LOCATION atau AWAITING_INTEREST)
    if (restoredState === ConversationState.AWAITING_LOCATION) {
      return await handleLocationState(ctx);
    } else {
      return await handleInterestState(ctx);
    }
  }

  // 3. Jika MASIH dalam Human Handling (< 6 jam):
  // BOT TIDAK BOLEH MEMBALAS OTOMATIS KE THREAD INI!
  console.log(`[HUMAN HANDLING ACTIVE] Conversation ${conversation.id} is managed by human agent. Bot stays silent.`);

  return {
    nextState: ConversationState.HUMAN_HANDLING,
    shouldSendReply: false, // TIDAK kirim balasan otomatis
    isHumanHandling: true,
  };
}
