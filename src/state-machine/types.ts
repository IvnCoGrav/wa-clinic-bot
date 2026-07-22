import { ConversationState, Customer, Conversation } from '@prisma/client';
import { WhatsAppIncomingMessage } from '../integrations/whatsapp/types';

export interface StateHandlerContext {
  customer: Customer;
  conversation: Conversation;
  incomingMessage: WhatsAppIncomingMessage;
}

export interface StateHandlerResult {
  nextState: ConversationState;
  replyText?: string;
  shouldSendReply: boolean;
  isHumanHandling?: boolean;
}
