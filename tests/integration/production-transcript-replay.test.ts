import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ConversationState } from '@prisma/client';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { GenerationStage } from '../../src/v3/agent/pipeline/generation-stage';
import { TypingService } from '../../src/services/typing.service';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { reservationCoreService } from '../../src/services/reservation-core.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { CapturingWAHAClient, setupOfflineEnv } from './helpers/chat-harness';
import type { WhatsAppIncomingMessage } from '../../src/integrations/whatsapp/types';

/**
 * Fase C4 (Rencana Perbaikan Opsi C) — Replay transkrip produksi di jalur V3.
 *
 * Transkrip nyata diambil dari DB produksi (Fase 4b audit, disanitasi): 4 percakapan
 * yang berakhir takeover admin. Sebelumnya `scripts/replay-real-customer-cases.ts`
 * memutar ke `src/slot-engine` (mesin lama, sudah didekomisioning) sehingga replay
 * TIDAK menguji kode yang jalan di produksi. Test ini memakai jalur produksi asli:
 * ConversationStateMachine -> V3AgentRunner -> tool -> guardrail.
 *
 * SEAM: `GenerationStage.executeChatCompletion` di-stub deterministik (seam resmi
 * yang sama dipakai golden corpus). Karena LLM di-stub, kegagalan yang MURNI dari
 * putusan LLM (mis. "Boleh bun" dianggap COMMITTED) tidak terwakili di sini —
 * itu ranah suite LLM-eval terpisah. Yang diuji di sini adalah invarian pipeline
 * deterministik yang selama ini bocor ke produksi.
 */
setupOfflineEnv();

let msgCounter = 0;

/** Nama tool yang benar-benar dikirim ke LLM pada setiap call Routing — bukti masking fisik. */
const routingToolNames: string[][] = [];

function stubLlm() {
  return vi.spyOn(GenerationStage, 'executeChatCompletion').mockImplementation(async (params: any) => {
    const payload = params?.payload;
    const isRouting = Array.isArray(payload?.tools) && payload.tools.length > 0;
    if (isRouting) {
      routingToolNames.push(
        (payload.tools as any[])
          .map((t) => t?.function?.name || t?.name)
          .filter(Boolean)
      );
    }
    // Stub sengaja bodoh: routing tanpa tool call (mengandalkan gate deterministik),
    // generation menggemakan jawaban generik. Tidak mengarang harga/nama layanan.
    const content = isRouting
      ? JSON.stringify({ reply: 'Baik Bunda, kami bantu ya.' })
      : 'Baik Bunda, terima kasih informasinya. Ada lagi yang bisa kami bantu? 😊';
    return { choices: [{ message: { content } }], usage: {} };
  });
}

interface Scenario {
  customer: any;
  conversation: any;
  machine: ConversationStateMachine;
  client: CapturingWAHAClient;
}

async function buildScenario(phone: string, name: string): Promise<Scenario> {
  const customer: any = await customerService.getOrCreateCustomer(phone, name, DEFAULT_TENANT_ID);
  customer.status = 'active';
  const conversation: any = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
  conversation.current_state = ConversationState.INITIAL;
  conversation.is_human_handling = false;
  conversation.human_handling_since = null;
  conversation.last_message_at = new Date();
  const client = new CapturingWAHAClient();
  const typingSvc = new TypingService(client);
  const machine = new ConversationStateMachine(typingSvc);
  return { customer, conversation, machine, client };
}

async function runTurn(ctx: Scenario, text: string): Promise<void> {
  const { customer, conversation, machine, client } = ctx;
  conversation.is_human_handling = false;
  client.sentTexts = [];
  const incomingMessage: WhatsAppIncomingMessage = {
    id: `replay_${Date.now()}_${++msgCounter}`,
    from: customer.phone,
    chatId: `${customer.phone}@c.us`,
    timestamp: String(Date.now()),
    type: 'text',
    text: { body: text },
  };
  const result = await machine.processMessage({ tenantId: DEFAULT_TENANT_ID, customer, conversation, incomingMessage });
  if (result?.shouldSendReply && result?.replyText && client.sentTexts.length === 0) {
    client.sentTexts.push(result.replyText);
  }
}

// Transkrip produksi (disanitasi). id -> daftar pesan customer berurutan.
const TRANSCRIPTS: Record<string, string[]> = {
  'conv-2b943cc6 (lokasi lalu bot tarik balasan)': [
    'Hallo Bu Bidan, Saya mau booking home service. Bagaimana Caranya ?',
    'Terapi bicara apa bisa',
    'Surabaya dekat masjid al akbar',
  ],
  'conv-8dfb9f76 (balasan ganda)': [
    'Hallo Bu Bidan, Saya mau booking home service. Bagaimana Caranya ?',
    'sidoarjo,sedati',
    'cemandi bu',
    'maaf untuk pulih ceria itu gmna ya',
    'yg nb sperti tidur GK nyenyak itu masuk yg mana',
  ],
  'conv-57fb7f07 (tanda tanya jam)': ['Bu bisa nya di jam berapa aja ya?'],
  'conv-246d63ab (pertanyaan lokasi)': ['Lokasi dimana ya kak'],
};

describe('Fase C4 — replay transkrip produksi di jalur V3 (offline)', () => {
  let spy: ReturnType<typeof stubLlm>;

  beforeAll(() => {
    spy = stubLlm();
  });
  afterAll(() => {
    spy.mockRestore();
  });

  for (const [label, turns] of Object.entries(TRANSCRIPTS)) {
    it(`${label}: tidak silent-drop & tidak menarik balasan`, async () => {
      const phone = `62897${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const ctx = await buildScenario(phone, 'Replay Bunda');
      for (const t of turns) {
        await runTurn(ctx, t);
        const reply = ctx.client.sentTexts.join('\n');
        // Invariant 1: tiap giliran customer TIDAK boleh dibalas kosong (silent drop).
        expect(reply.trim().length, `balasan kosong untuk: "${t}"`).toBeGreaterThan(0);
        // Invariant 2: bot tidak boleh memakai teks placeholder penarikan pesan
        // (indikasi balasan salah yang harus dicabut admin).
        expect(reply).not.toContain('Pesan ini telah ditarik');
      }
    });
  }

  it('save_reservation TIDAK PERNAH dipanggil tanpa treatment + tanggal (no loosening)', async () => {
    const saveSpy = vi.spyOn(reservationCoreService, 'saveReservation');
    const phone = `62896${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const ctx = await buildScenario(phone, 'Replay Guard');
    // Coba pancing panggilan booking dini dari transkrip nyata.
    for (const t of TRANSCRIPTS['conv-57fb7f07 (tanda tanya jam)']) {
      await runTurn(ctx, t);
    }
    for (const call of saveSpy.mock.calls) {
      const params: any = call[0] || {};
      const hasTreatment = Boolean(params.treatmentDetail || params.treatmentName);
      const hasDate = Boolean(params.bookingDate || params.slot);
      expect(hasTreatment && hasDate, 'save_reservation tanpa treatment/tanggal').toBe(true);
    }
    saveSpy.mockRestore();
  });

  it('masking fisik: save_reservation TIDAK ada di daftar tools saat belum ada treatment/lokasi/tanggal', async () => {
    routingToolNames.length = 0;
    const phone = `62899${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const ctx = await buildScenario(phone, 'Replay Mask');
    // Lewati giliran sapaan (ditangani greeting statis di luar router), masuk ke
    // giliran yang benar-benar memicu Call 1 Routing: menyebut layanan + lokasi.
    await runTurn(ctx, 'Hallo Bu Bidan, Saya mau booking home service. Bagaimana Caranya ?');
    await runTurn(ctx, 'saya mau pijat pulih ceria untuk bayi saya');
    const lastRoutingTools = routingToolNames[routingToolNames.length - 1] || [];
    expect(lastRoutingTools.length, 'tidak ada call Routing terekam').toBeGreaterThan(0);
    // Invarian deterministik: tanpa lokasi/tanggal, alat booking belum boleh disodorkan.
    expect(lastRoutingTools).not.toContain('save_reservation');
  });
});
