import { ConversationState, Customer, Conversation } from '@prisma/client';
import { WhatsAppIncomingMessage } from '../integrations/whatsapp/types';
import { NluClassificationResult } from '../services/nlu-classifier.service';

export interface StateHandlerContext {
  tenantId?: string;
  customer: Customer;
  conversation: Conversation;
  incomingMessage: WhatsAppIncomingMessage;
  nluResult?: NluClassificationResult;
}

export interface StateHandlerResult {
  nextState: ConversationState;
  replyText?: string;
  shouldSendReply: boolean;
  isHumanHandling?: boolean;
  sendPricelistImage?: boolean;
}
