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
  /** Riwayat percakapan terbaru (role user/assistant) — dipakai handler untuk resolusi anaphora (mis. "berapa itu?"). */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface StateHandlerResult {
  nextState: ConversationState;
  replyText?: string;
  shouldSendReply: boolean;
  isHumanHandling?: boolean;
  sendPricelistImage?: boolean;
  /** Caption custom utk gambar pricelist (default: "Pricelist {brand} 🌸"). */
  pricelistCaption?: string;
  /** Kirim ulang pricelist walau sudah pernah terkirim (dipakai saat customer minta ulang). */
  forcePricelistResend?: boolean;
}
