import { MockWAHAClient } from '../../../src/cli/mock-waha-client';
import { TypingService } from '../../../src/services/typing.service';
import { ConversationStateMachine } from '../../../src/state-machine/machine';
import { Direction, ConversationState } from '@prisma/client';
import { customerService } from '../../../src/services/customer.service';
import { conversationService } from '../../../src/services/conversation.service';
import { messageService } from '../../../src/services/message.service';
import { DEFAULT_TENANT_ID } from '../../../src/config/tenant';
import type { WhatsAppIncomingMessage } from '../../../src/integrations/whatsapp/types';

/**
 * Test harness: menjalankan skenario anaphora harga lewat ConversationStateMachine
 * yang ASLI (jalur sama dengan `npm run chat` & webhook produksi), sepenuhnya offline
 * (db/client di-mock reject → semua service pakai in-memory fallback, LLM key kosong →
 * rule-based intent). 20 simulasi = 20 customer unik.
 */

/** Matikan humanizer delay & bubble-split supaya 20 skenario jalan cepat & deterministik. */
export function setupOfflineEnv(): void {
  process.env.HUMANIZER_ENABLED = 'false';
  process.env.HUMANIZER_BUBBLE_SPLIT_ENABLED = 'false';
  process.env.CLINIC_PRICELIST_IMAGE_URL = 'assets/pricelist_spa.jpg';
}

/** WAHA mock yang merekam semua teks yang dikirim bot (untuk assertion). */
export class CapturingWAHAClient extends MockWAHAClient {
  public sentTexts: string[] = [];

  public override async sendText(chatId: string, text: string): Promise<boolean> {
    this.sentTexts.push(text);
    return true;
  }
}

export interface AnaphoraScenario {
  customer: any;
  conversation: any;
  machine: ConversationStateMachine;
  client: CapturingWAHAClient;
}

let msgCounter = 0;

/**
 * Siapkan 1 customer unik + conversation state AWAITING_INTEREST + lokasi terkunci,
 * lengkap dengan machine + capturing client sendiri.
 */
export async function createAnaphoraScenario(phone: string, name: string): Promise<AnaphoraScenario> {
  const customer: any = await customerService.getOrCreateCustomer(phone, name, DEFAULT_TENANT_ID);
  customer.status = 'active';
  customer.kelurahan = 'Waru';
  customer.kecamatan = 'Waru';
  customer.kota = 'Sidoarjo';
  customer.lat = -7.45;
  customer.lng = 112.75;

  const conversation: any = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
  conversation.current_state = ConversationState.AWAITING_INTEREST;
  conversation.is_human_handling = false;
  conversation.human_handling_since = null;
  conversation.last_message_at = new Date();

  const client = new CapturingWAHAClient();
  const typingSvc = new TypingService(client);
  const machine = new ConversationStateMachine(typingSvc);

  return { customer, conversation, machine, client };
}

/** Seed riwayat pesan assistant (rekomendasi bot) — masuk ke historyFormatted via messageService fallback. */
export async function seedAssistantMessage(conversationId: string, content: string): Promise<void> {
  await messageService.logMessage({
    tenantId: DEFAULT_TENANT_ID,
    conversationId,
    direction: Direction.OUTBOUND,
    content,
  });
}

/** Kirim 1 turn customer ke state machine (jalur produksi) dan tunggu balasan terkirim. */
export async function runTurn(
  scenario: AnaphoraScenario,
  question: string
): Promise<void> {
  const { customer, conversation, machine } = scenario;
  const incomingMessage: WhatsAppIncomingMessage = {
    id: `it_msg_${Date.now()}_${++msgCounter}`,
    from: customer.phone,
    chatId: `${customer.phone}@c.us`,
    timestamp: String(Date.now()),
    type: 'text',
    text: { body: question },
  };
  await machine.processMessage({
    tenantId: DEFAULT_TENANT_ID,
    customer,
    conversation,
    incomingMessage,
  });
}

/** Gabungkan semua bubble balasan bot jadi satu string untuk assertion. */
export function joinedReply(client: CapturingWAHAClient): string {
  return client.sentTexts.join('\n');
}
