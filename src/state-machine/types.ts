import { ConversationState, Customer, Conversation } from '@prisma/client';
import { WhatsAppIncomingMessage } from '../integrations/whatsapp/types';

export interface StateHandlerContext {
  tenantId?: string;
  customer: Customer;
  conversation: Conversation;
  incomingMessage: WhatsAppIncomingMessage;
  /** Riwayat percakapan terbaru (role user/assistant) — dipakai handler untuk resolusi anaphora (mis. "berapa itu?"). */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Correlation ID untuk tracing eksekusi LLM per-bubble pesan masuk. */
  bubbleCorrelationId?: string;
}

export interface StateHandlerResult {
  nextState: ConversationState;
  replyText?: string;
  shouldSendReply: boolean;
  isHumanHandling?: boolean;
  /** Reasoning dari LLM generator jika balasan dihasilkan oleh AI. */
  aiReasoning?: string | null;
  /** Metadata eksekusi V3 Agent untuk observability baseline (Phase 0.5). */
  metadata?: {
    engine: string;
    tokens: { prompt: number; completion: number; total: number };
    costIdr: number;
    executedTools: Array<{ name: string; args: any }>;
    toolCount: number;
    reasoning: string | null;
    retrievedChunksCount: number;
  };
}
