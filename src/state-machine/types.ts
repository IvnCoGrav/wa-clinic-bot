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
  /** Teks lokasi spesifik yang diekstrak oleh handler sebelumnya untuk geocoding. */
  extractedLocationForGeocode?: string;
  /** Teks konteks tambahan (misal info ongkir) yang wajib disampaikan LLM saat merespons FAQ. */
  additionalContextText?: string;
  /** Correlation ID untuk tracing eksekusi LLM per-bubble pesan masuk. */
  bubbleCorrelationId?: string;
  /**
   * INTERNAL guard: kedalaman hop antar-handler (intercept FAQ ↔ redirect lokasi).
   * Dipakai mencegah mutual recursion tak terbatas — caller eksternal JANGAN mengisi.
   */
  _interceptDepth?: number;
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
  /** Reasoning dari LLM generator jika balasan dihasilkan oleh AI. */
  aiReasoning?: string | null;
}
