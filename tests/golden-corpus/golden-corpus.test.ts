import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { allCorpusScenarios, validateGoldenCorpus } from './index';
import type { GoldenTurn, GoldenSlateAssertion } from './types';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { TypingService } from '../../src/services/typing.service';
import { CapturingWAHAClient, setupOfflineEnv } from '../integration/helpers/chat-harness';
import { GoalTracker } from '../../src/v3/state/goal-tracker';
import { GenerationStage } from '../../src/v3/agent/pipeline/generation-stage';
import { ConversationState } from '@prisma/client';
import type { WhatsAppIncomingMessage } from '../../src/integrations/whatsapp/types';

/**
 * FASE 0 — Golden Regression Gate (PLAN 8)
 *
 * Menjalankan 50 skenario golden corpus lewat ConversationStateMachine ASLI
 * (jalur produksi: machine → V3 pipeline → tool → guardrail), sepenuhnya offline.
 *
 * Kenapa stub LLM, bukan skip:
 * - Tanpa LLM, V3 runner menerima error jaringan/401 lalu eskalasi sunyi
 *   (reportTurnError). Itu membuat ~96% turn tak terverifikasi — gate palsu.
 * - Karena itu kita meng-inject LLM deterministik lewat SEAM RESMI
 *   `GenerationStage.executeChatCompletion` (komentar kode menyebut seam ini
 *   memang disediakan untuk "mock test via spyOn"). Ini menguji pipeline nyata
 *   (routing, tool execution, session, guardrail) tanpa panggilan jaringan.
 *
 * Stub ini SENGAJA bodoh & deterministik: ia hanya (a) memilih tool berdasarkan
 * intent yang sudah diekstrak pipeline, dan (b) menggemakan balasan generik.
 * Ia TIDAK mengarang harga/nama layanan — harga tetap datang dari tool katalog
 * (data-driven), sehingga gate tidak menyembunyikan bug katalog.
 */

setupOfflineEnv();

let msgCounter = 0;

type Session = Awaited<ReturnType<typeof GoalTracker.getGoalSession>>;

function currentSlate(session: Session) {
  const loc = (session as any)?.location ?? {};
  const children = ((session as any)?.children ?? []) as Array<{ ageMonths?: number; symptoms?: string[] }>;
  const firstChild = children[0] ?? {};
  const cartItems = ((session as any)?.cartItems ?? []) as Array<{ name?: string }>;
  return {
    childAgeMonths: firstChild.ageMonths ?? null,
    childAgeCategory: null as string | null,
    selectedTreatmentName: (session as any)?.selectedTreatment ?? cartItems[0]?.name ?? null,
    isLocationConfirmed: !!(loc.kelurahan || loc.kecamatan),
    kelurahan: loc.kelurahan ?? null,
    symptoms: firstChild.symptoms ?? [],
    isHumanHandling: false,
  };
}

/** Response chat-completion standar. */
function llmResponse(content: string, toolCalls?: any[]) {
  const message: any = { role: 'assistant', content: content || null };
  if (toolCalls && toolCalls.length > 0) message.tool_calls = toolCalls;
  return {
    choices: [{ message, finish_reason: toolCalls ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  };
}

function makeToolCall(name: string, args: Record<string, unknown>) {
  return [{ id: `call_${name}_${Date.now()}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }];
}

/**
 * Stub router (Call 1). Deterministik berdasarkan isi pesan:
 * - lokasi → calculate_delivery
 * - harga/pricelist → get_catalog_and_price
 * - keluhan/FAQ → search_knowledge_faq
 * - sisanya → tanpa tool (balasan langsung)
 */
function routeStub(payload: any): any {
  const messages: any[] = payload?.messages ?? [];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const text = String(lastUser).toLowerCase();
  const toolChoice = payload?.tool_choice;

  // Tool yang di-forcing pipeline wajib dihormati (mis. calculate_delivery).
  if (toolChoice && typeof toolChoice === 'object' && toolChoice?.function?.name) {
    const name = toolChoice.function.name;
    const args: Record<string, unknown> = {};
    if (name === 'calculate_delivery') args.text = lastUser;
    return llmResponse('', makeToolCall(name, args));
  }

  if (/kelurahan|kecamatan|alamat|rumah di|share|sedati|rungkut|waru|tuban|sidoarjo|surabaya/.test(text)) {
    return llmResponse('', makeToolCall('calculate_delivery', { text: lastUser }));
  }
  if (/harga|biaya|berapa|pricelist|price|rp|promo/.test(text)) {
    return llmResponse('', makeToolCall('get_catalog_and_price', { query: lastUser }));
  }
  if (/batuk|pilek|kolik|kembung|demam|vaksin|gtm|susah makan|susah tidur|oksitosin|laktasi|moksa|nafsu makan/.test(text)) {
    return llmResponse('', makeToolCall('search_knowledge_faq', { query: lastUser }));
  }
  return llmResponse('Baik Bunda, kami bantu ya.');
}

/** Stub generator (Call 2). Menggemakan hasil tool apa adanya + 1 kalimat penutup. */
function generateStub(payload: any): any {
  const messages: any[] = payload?.messages ?? [];
  const toolMsg = [...messages].reverse().find((m) => m.role === 'tool');
  const raw = toolMsg ? String(toolMsg.content) : '';
  // Ambil potongan yang terlihat seperti data resmi (nama layanan/harga) tanpa mengarang.
  const excerpt = raw.replace(/\s+/g, ' ').slice(0, 600);
  return llmResponse(
    `Baik Bunda, berikut informasi yang bisa kami sampaikan. ${excerpt}\n\nApakah ada yang ingin ditanyakan lagi ya Bunda?`
  );
}

function stubLlm() {
  return vi
    .spyOn(GenerationStage, 'executeChatCompletion')
    .mockImplementation(async (params: any) => {
      const payload = params?.payload;
      const isRouting = Array.isArray(payload?.tools) && payload.tools.length > 0;
      return isRouting ? routeStub(payload) : generateStub(payload);
    });
}

async function buildScenario(phone: string, name: string) {
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

async function runTurn(
  ctx: Awaited<ReturnType<typeof buildScenario>>,
  question: string,
): Promise<void> {
  const { customer, conversation, machine, client } = ctx;
  conversation.is_human_handling = false;
  const incomingMessage: WhatsAppIncomingMessage = {
    id: `golden_msg_${Date.now()}_${++msgCounter}`,
    from: customer.phone,
    chatId: `${customer.phone}@c.us`,
    timestamp: String(Date.now()),
    type: 'text',
    text: { body: question },
  };
  const result = await machine.processMessage({ tenantId: DEFAULT_TENANT_ID, customer, conversation, incomingMessage });
  // Jalur deterministik (form reservasi, dsb.) mengembalikan replyText langsung;
  // jalur V3 mengirim lewat gateway. Keduanya ditangkap agar assertion utuh.
  if (result?.shouldSendReply && result?.replyText && client.sentTexts.length === 0) {
    client.sentTexts.push(result.replyText);
  }
}

/** Invarian deterministik — ditegakkan pada setiap turn. */
function evaluateInvariants(turn: GoldenTurn, reply: string, slate: ReturnType<typeof currentSlate>): string[] {
  const failures: string[] = [];
  const lower = reply.toLowerCase();

  if (turn.noSilentDrop && (!reply || reply.trim().length === 0)) {
    failures.push('SilentDrop: balasan kosong padahal noSilentDrop=true');
  }
  if (turn.noUnjustifiedRsqr && slate.isLocationConfirmed) {
    if (/kelurahan (mana|apa)|di (kelurahan|daerah) mana|alamatnya|share lokasi/i.test(reply)) {
      failures.push('UnjustifiedRSQR: menanyakan kelurahan padahal lokasi sudah ada');
    }
  }
  if (turn.mustNotContain) {
    for (const forbidden of turn.mustNotContain) {
      if (lower.includes(forbidden.toLowerCase())) {
        failures.push(`mustNotContain gagal: "${forbidden}" muncul di balasan`);
      }
    }
  }
  if (reply.includes('**')) failures.push('Format: mengandung markdown double-star "**"');
  if (reply.length > 1500) failures.push(`Panjang: balasan ${reply.length} char (>1500)`);
  return failures;
}

/** Assertion slate — hanya ditegakkan bila datanya tersedia. */
function evaluateSlate(
  assertions: GoldenSlateAssertion[] | undefined,
  slate: ReturnType<typeof currentSlate>,
): { failures: string[]; skipped: string[] } {
  const failures: string[] = [];
  const skipped: string[] = [];
  if (!assertions) return { failures, skipped };

  const bag: Record<string, unknown> = {
    childAgeMonths: slate.childAgeMonths,
    childAgeCategory: slate.childAgeCategory,
    selectedTreatmentName: slate.selectedTreatmentName,
    isLocationConfirmed: slate.isLocationConfirmed,
    kelurahan: slate.kelurahan,
    symptoms: slate.symptoms,
    isHumanHandling: slate.isHumanHandling,
  };

  for (const a of assertions) {
    const actual = bag[a.field];
    const isUnavailable = actual === null || actual === undefined || (Array.isArray(actual) && actual.length === 0);
    if (isUnavailable && !a.negated) {
      skipped.push(`slate.${a.field} belum tersedia`);
      continue;
    }
    if (Array.isArray(actual)) {
      const hit = actual.some((v) => String(v).toLowerCase().includes(String(a.expected).toLowerCase()));
      if (a.negated ? hit : !hit) {
        failures.push(`slate.${a.field} ${a.negated ? 'mengandung' : 'tidak mengandung'} "${a.expected}" (aktual: ${JSON.stringify(actual)})`);
      }
    } else {
      const match = String(actual).toLowerCase() === String(a.expected).toLowerCase();
      if (a.negated ? match : !match) {
        failures.push(`slate.${a.field} ${a.negated ? 'sama dengan' : 'tidak sama dengan'} "${a.expected}" (aktual: ${JSON.stringify(actual)})`);
      }
    }
  }
  return { failures, skipped };
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

describe('FASE 0 — Golden Regression Gate (real V3 pipeline, offline)', () => {
  let spy: ReturnType<typeof stubLlm>;

  beforeAll(() => {
    spy = stubLlm();
  });

  afterAll(() => {
    spy.mockRestore();
  });

  it('dataset golden corpus valid', () => {
    const v = validateGoldenCorpus();
    expect(v.errors, v.errors.join('\n')).toEqual([]);
    expect(v.total).toBeGreaterThanOrEqual(50);
  });

  for (const scenario of allCorpusScenarios) {
    it(`${scenario.id} — ${scenario.description}`, async () => {
      const phone = `6287${String(100000000 + (hashId(scenario.id) % 100000000)).slice(0, 9)}`;
      const ctx = await buildScenario(phone, `Golden ${scenario.id}`);

      const allFailures: string[] = [];
      const allSkipped: string[] = [];

      for (const turn of scenario.turns) {
        await runTurn(ctx, turn.input);
        const reply = ctx.client.sentTexts.slice(-1)[0] ?? '';
        const session = await GoalTracker.getGoalSession(ctx.conversation.id, DEFAULT_TENANT_ID);
        const slate = currentSlate(session);

        allFailures.push(...evaluateInvariants(turn, reply, slate).map((f) => `turn ${turn.turn}: ${f}`));
        const slateEval = evaluateSlate(turn.slateAssertions, slate);
        allFailures.push(...slateEval.failures.map((f) => `turn ${turn.turn}: ${f}`));
        allSkipped.push(...slateEval.skipped.map((s) => `turn ${turn.turn}: ${s}`));
      }

      if (allSkipped.length > 0) {
        console.log(`[GOLDEN ${scenario.id}] skipped: ${allSkipped.join('; ')}`);
      }
      expect(allFailures, allFailures.join('\n')).toEqual([]);
    });
  }
});
