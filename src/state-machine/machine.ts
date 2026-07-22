import { ConversationState, Direction } from '@prisma/client';
import { StateHandlerContext, StateHandlerResult } from './types';
import { handleGreetingState } from './handlers/greeting';
import { handleLocationState } from './handlers/location';
import { handleInterestState } from './handlers/interest';
import { handleHumanHandlingState } from './handlers/human';
import { handleLocationConfirmationState } from './handlers/location-confirmation';
import { conversationService } from '../services/conversation.service';
import { messageService } from '../services/message.service';
import { customerService } from '../services/customer.service';
import { TypingService, typingService } from '../services/typing.service';

export class ConversationStateMachine {
  private typingSvc: TypingService;

  constructor(typingSvc?: TypingService) {
    this.typingSvc = typingSvc || typingService;
  }

  /**
   * Core State Machine Engine:
   * Memproses pesan masuk, mengarahkan ke handler state yang sesuai, 
   * dan mengirim balasan otomatis MENGGUNAKAN SIMULASI MENGETIK (typingService).
   */
  public async processMessage(ctx: StateHandlerContext): Promise<StateHandlerResult> {
    const { customer, conversation, incomingMessage } = ctx;

    // --- GATE KELAS 🔴: BLOCKED CUSTOMER ---
    if (customer.status === 'blocked') {
      console.warn(`[SECURITY WARNING] [BLOCKED CUSTOMER] Phone ${customer.phone} is blocked. Bypassing processing.`);
      return {
        nextState: conversation.current_state,
        shouldSendReply: false,
      };
    }

    // 1. Audit Log Pesan Inbound (Masuk)
    const inboundContent = incomingMessage.text?.body || (incomingMessage.location ? `[LOCATION SHARE: Lat ${incomingMessage.location.latitude}, Lng ${incomingMessage.location.longitude}]` : '[MEDIA/UNKNOWN]');
    await messageService.logMessage({
      conversationId: conversation.id,
      direction: Direction.INBOUND,
      content: inboundContent,
      waMessageId: incomingMessage.id,
      payloadRaw: incomingMessage,
    });

    // 2. Cek Auto-Release Timeout terlebih dahulu jika sedang Human Handling
    const autoRelease = conversationService.checkAndApplyAutoRelease(conversation);
    let activeConversation = autoRelease.updatedConversation;

    // --- PENGECEKAN IDLE TIMEOUT > 24 JAM ---
    const IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
    const isIdleTooLong = activeConversation.last_message_at &&
      (Date.now() - new Date(activeConversation.last_message_at).getTime() > IDLE_TIMEOUT_MS);

    if (isIdleTooLong && activeConversation.current_state !== ConversationState.INITIAL && !activeConversation.is_human_handling) {
      console.log(`[IDLE TIMEOUT] Resetting conversation ${activeConversation.id} from ${activeConversation.current_state} to INITIAL.`);
      
      // Clean up pending location jika di-reset dari LOCATION_CONFIRMED
      if (activeConversation.current_state === ConversationState.LOCATION_CONFIRMED) {
        await customerService.clearPendingLocation(customer.id);
        customer.pending_kelurahan = null;
        customer.pending_kecamatan = null;
        customer.pending_kota = null;
        customer.pending_lat = null;
        customer.pending_lng = null;
      }

      await conversationService.updateConversationState(activeConversation.id, {
        currentState: ConversationState.INITIAL,
        previousState: null,
        locationAttempts: 0,
      });
      activeConversation.current_state = ConversationState.INITIAL;
    }

    let result: StateHandlerResult;

    // 3. Routing ke State Handler yang sesuai
    if (activeConversation.is_human_handling) {
      result = await handleHumanHandlingState({ ...ctx, conversation: activeConversation });
    } else {
      switch (activeConversation.current_state) {
        case ConversationState.INITIAL:
          result = await handleGreetingState({ ...ctx, conversation: activeConversation });
          break;

        case ConversationState.AWAITING_LOCATION:
          result = await handleLocationState({ ...ctx, conversation: activeConversation });
          break;

        case ConversationState.LOCATION_CONFIRMED:
          result = await handleLocationConfirmationState({ ...ctx, conversation: activeConversation });
          break;

        case ConversationState.AWAITING_INTEREST:
          result = await handleInterestState({ ...ctx, conversation: activeConversation });
          break;

        case ConversationState.RESERVATION_SENT:
        case ConversationState.COMPLETED:
          result = await handleInterestState({ ...ctx, conversation: activeConversation });
          break;

        case ConversationState.HUMAN_HANDLING:
          result = await handleHumanHandlingState({ ...ctx, conversation: activeConversation });
          break;

        default:
          result = await handleGreetingState({ ...ctx, conversation: activeConversation });
          break;
      }
    }

    // 4. Update Conversation State di Database
    await conversationService.updateConversationState(activeConversation.id, {
      currentState: result.nextState,
      isHumanHandling: result.isHumanHandling,
    });

    // 5. Kirim Balasan Otomatis via Typing Simulation Service jika required
    if (result.shouldSendReply && result.replyText) {
      // Memulai alur simulasi ngetik manusia: sendSeen -> reading delay -> per bubble (startTyping -> typing delay -> stopTyping -> sendText)
      const chatId = incomingMessage.chatId || `${customer.phone}@c.us`;
      const resultHuman = await this.typingSvc.simulateHumanReply({
        chatId,
        incomingMessageId: incomingMessage.id,
        incomingText: incomingMessage.text?.body || '',
        replyText: result.replyText,
      });

      if (resultHuman.success) {
        // Audit Log Pesan Outbound (Keluar)
        await messageService.logMessage({
          conversationId: activeConversation.id,
          direction: Direction.OUTBOUND,
          content: result.replyText,
        });
      }
    }

    return result;
  }
}

export const stateMachine = new ConversationStateMachine();
