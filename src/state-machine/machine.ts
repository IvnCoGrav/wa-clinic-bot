import { ConversationState, Direction } from '@prisma/client';
import { StateHandlerContext, StateHandlerResult } from './types';
import { handleGreetingState } from './handlers/greeting';
import { handleLocationState } from './handlers/location';
import { handleInterestState } from './handlers/interest';
import { handleHumanHandlingState } from './handlers/human';
import { conversationService } from '../services/conversation.service';
import { messageService } from '../services/message.service';
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
