import { ConversationState } from '@prisma/client';
import { StateHandlerContext, StateHandlerResult } from '../types';
import { TEMPLATES } from '../../config/persona';

/**
 * Handler untuk state INITIAL:
 * Ketika pesan pertama kali masuk dari nomor baru / percakapan baru.
 */
export async function handleGreetingState(ctx: StateHandlerContext): Promise<StateHandlerResult> {
  const greetingText = TEMPLATES.greeting();

  return {
    nextState: ConversationState.AWAITING_LOCATION,
    replyText: greetingText,
    shouldSendReply: true,
  };
}
