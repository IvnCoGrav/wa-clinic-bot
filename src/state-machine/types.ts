import { ConversationState, Customer, Conversation } from '@prisma/client';
import { WhatsAppIncomingMessage } from '../integrations/whatsapp/types';
import { NluClassificationResult } from '../services/nlu-classifier.service';
import { AIRouterDecision } from '../integrations/llm/ai-router';

export interface StateHandlerContext {
  tenantId?: string;
  customer: Customer;
  conversation: Conversation;
  incomingMessage: WhatsAppIncomingMessage;
  nluResult?: NluClassificationResult;
  routerDecision?: AIRouterDecision;
}

export interface StateHandlerResult {
  nextState: ConversationState;
  replyText?: string;
  shouldSendReply: boolean;
  isHumanHandling?: boolean;
  sendPricelistImage?: boolean;
}
