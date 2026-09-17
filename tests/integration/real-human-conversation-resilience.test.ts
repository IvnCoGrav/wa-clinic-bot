import { describe, it, expect, vi } from 'vitest';

/**
 * Sesi 180166 — Real-Human Conversation Resilience (red-loop TDD).
 * Mereplikasi 5 turn pelanggan nyata; tiap turn mengunci satu failure mode:
 * T1 domisili Kutisari · T2 harga balita 2th · T3 hari relatif bertanya ·
 * T4 jam 10 pagi · T5 komitmen '??' + multi-item.
 *
 * BATAS KEJUJURAN (pola matrix): stub hanya memerankan pilihan-tool LLM;
 * yang diassert = state sesi, call/exec log, verdict masker, invarian format.
 * Prosa/empati/kalender-verbal tetap ranah harness LLM.
 */

vi.mock('../../src/services/reservation-core.service', () => ({
  reservationCoreService: {
    saveReservation: vi.fn(async (params: any) => ({
      reservation: { id: `res-180166-${Date.now()}` },
      isNew: true,
      isUpdate: false,
      __captured: params,
    })),
  },
  ReservationConflictError: class ReservationConflictError extends Error {},
}));

import { GenerationStage } from '../../src/v3/agent/pipeline/generation-stage';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { ConversationState } from '@prisma/client';
import { TypingService } from '../../src/services/typing.service';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { GoalTracker } from '../../src/v3/state/goal-tracker';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { ContextGrounder } from '../../src/v3/agent/pipeline/context-grounder';
import { evaluateToolMasking } from '../../src/v3/tools/tool-masker';
import { ALL_V3_TOOLS } from '../../src/v3/tools/tool-registry';
import * as toolRegistry from '../../src/v3/tools/tool-registry';
import { reservationCoreService } from '../../src/services/reservation-core.service';
import { setupOfflineEnv, CapturingWAHAClient } from './helpers/chat-harness';
import type { WhatsAppIncomingMessage } from '../../src/integrations/whatsapp/types';

setupOfflineEnv();

const callLog: Array<{ turn: number; tool: string }> = [];
const execLog: Array<{ turn: number; tool: string; result: any }> = [];
let activeTurn = 0;
let lastDayHint: string | undefined;
let lastTop: string | undefined;

function llmResponse(content: string, toolCalls?: any[]) {
  const message: any = { role: 'assistant', content: content || null };
  if (toolCalls?.length) message.tool_calls = toolCalls;
  return { choices: [{ message, finish_reason: toolCalls ? 'tool_calls' : 'stop' }], usage: {} };
}
function tc(name: string, args: Record<string, unknown>) {
  return [{ id: `c_${name}_${Date.now()}_${Math.random()}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }];
}
const COMMIT_VERBS = /(jadwalkan|ambil|deal|fix|pesan|booking|mau yang itu|boleh yang itu)\b/i;
function inferDay(t: string): string | undefined {
  const m = t.match(/hari\s*ke-?\s*\d+|senin|selasa|rabu|kamis|jumat|sabtu|minggu|besok|lusa|hari ini|sekarang|tgl\s*\d{1,2}/i);
  return m ? m[0] : undefined;
}

function routeStub(payload: any): any {
  const lastUser = [...(payload?.messages || [])].reverse().find((m: any) => m.role === 'user')?.content ?? '';
  const text = String(lastUser);
  const lower = text.toLowerCase();
  const choice = payload?.tool_choice;
  const offered = new Set(((payload?.tools || []) as any[]).map((t: any) => t?.function?.name));
  const allowed = (n: string) => offered.size === 0 || offered.has(n);

  if (choice && typeof choice === 'object' && choice?.function?.name) {
    const name = choice.function.name as string;
    const args: Record<string, unknown> = {};
    if (name === 'calculate_delivery') args.locationText = text;
    if (name === 'get_catalog_and_price') args.inquirePrice = true;
    if (name === 'save_reservation') {
      if (lastTop) args.treatmentName = lastTop;
      const d = inferDay(lower) || lastDayHint;
      if (d) args.bookingDate = d;
    }
    return llmResponse('', tc(name, args));
  }
  const day = inferDay(lower);
  if (day) lastDayHint = day;
  // Kontrak stub = kontrak produk BARU (verb-commit menoleransi '?' sopan):
  // stub mengusulkan save; hijau/tidaknya ditentukan gate produk (masker+tool).
  if (COMMIT_VERBS.test(lower) && day && allowed('save_reservation')) {
    const names = ['Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)', 'Pijat Bayi Ceria (Rileksasi)', 'Sinar Moksa (Add-on)'];
    const named = names.find((n) => lower.includes(n.toLowerCase().replace(/\(.*\)/, '').trim()));
    return llmResponse('', tc('save_reservation', { treatmentName: named || lastTop, bookingDate: day }));
  }
  const calls: any[] = [];
  if (/kutisari|kendangsari|sedati|rungkut|waru|surabaya|sidoarjo|tropodo|pepelegi/i.test(lower) && allowed('calculate_delivery')) {
    calls.push(...tc('calculate_delivery', { locationText: text }));
  }
  if (/harga|biaya|tarif|berapa|rp |total/i.test(lower) && allowed('get_catalog_and_price')) {
    const age = /2\s*tahun|24\s*bulan/i.test(lower) ? 24 : undefined;
    const cargs: Record<string, unknown> = { inquirePrice: true };
    if (age !== undefined) { cargs.childAgeMonths = age; cargs.category = 'KIDS'; }
    calls.push(...tc('get_catalog_and_price', cargs));
  }
  if (calls.length > 0) return llmResponse('', calls);
  return llmResponse('Baik Bunda, kami bantu ya.');
}

describe('Sesi 180166 — Real-Human Resilience', () => {
  let spy: any;
  let execSpy: any;

  beforeAll(() => {
    spy = vi.spyOn(GenerationStage, 'executeChatCompletion').mockImplementation(async (params: any) => {
      const payload = params?.payload;
      if (Array.isArray(payload?.tools) && payload.tools.length > 0) {
        const res = routeStub(payload);
        for (const c of res?.choices?.[0]?.message?.tool_calls || []) {
          callLog.push({ turn: activeTurn, tool: c.function?.name });
        }
        return res;
      }
      return llmResponse('Baik Bunda, berikut informasi yang bisa kami sampaikan.');
    });
    const original = toolRegistry.executeToolByName;
    execSpy = vi.spyOn(toolRegistry, 'executeToolByName').mockImplementation(async (name: string, args: any, ctx: any) => {
      const result = await original(name, args, ctx);
      execLog.push({ turn: activeTurn, tool: name, result });
      if (name === 'get_catalog_and_price' && result?.treatments?.[0]?.name) lastTop = result.treatments[0].name;
      return result;
    });
  });

  afterAll(() => {
    spy.mockRestore();
    execSpy.mockRestore();
  });

  beforeEach(() => {
    vi.mocked(reservationCoreService.saveReservation).mockClear();
    callLog.length = 0;
    execLog.length = 0;
    lastDayHint = undefined;
    lastTop = undefined;
  });

  async function buildScenario() {
    const phone = `628180166${String(Math.floor(Math.random() * 900) + 100)}`;
    const customer: any = await customerService.getOrCreateCustomer(phone, 'Sesi 180166', DEFAULT_TENANT_ID);
    customer.status = 'active';
    const conversation: any = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    conversation.current_state = ConversationState.INITIAL;
    conversation.is_human_handling = false;
    conversation.last_message_at = new Date();
    const client = new CapturingWAHAClient();
    const machine = new ConversationStateMachine(new TypingService(client));
    return { customer, conversation, machine, client };
  }

  async function runTurn(ctx: any, question: string): Promise<string> {
    const { customer, conversation, machine, client } = ctx;
    conversation.is_human_handling = false;
    const incomingMessage: WhatsAppIncomingMessage = {
      id: `s180166_${Date.now()}_${Math.random()}`,
      from: customer.phone,
      chatId: `${customer.phone}@c.us`,
      timestamp: String(Date.now()),
      type: 'text',
      text: { body: question },
    };
    const result = await machine.processMessage({ tenantId: DEFAULT_TENANT_ID, customer, conversation, incomingMessage });
    if (result?.shouldSendReply && result?.replyText && client.sentTexts.length === 0) {
      client.sentTexts.push(result.replyText);
    }
    return client.sentTexts.slice(-1)[0] ?? '';
  }

  it('FM1+FM5: komitmen "??" multi-item tereksekusi (anti-deadlock)', async () => {
    const ctx = await buildScenario();
    const sessionOf = () => GoalTracker.getGoalSession(ctx.conversation.id, DEFAULT_TENANT_ID);

    activeTurn = 1;
    await runTurn(ctx, 'Di kutisari indah surabaya');
    expect((await sessionOf()).location?.kelurahan).toBe('Kutisari');

    activeTurn = 2;
    await runTurn(ctx, 'Harganya berapa ya untuk balita 2 tahun? Jaraknya jauh tidak?');
    const s2: any = await sessionOf();
    expect(s2.childProfile?.ageMonths).toBe(24);
    expect(s2.priceDiscussed).toBe(true);

    activeTurn = 3;
    const r3 = await runTurn(ctx, 'Bisa hari selasa depan? Tgl 18 agustus?');
    const s3: any = await sessionOf();
    expect(String(s3.booking?.requestedTimeHint || '')).toMatch(/selasa/i);
    expect(vi.mocked(reservationCoreService.saveReservation)).toHaveBeenCalledTimes(0);
    expect(r3.trim().length).toBeGreaterThan(0);

    activeTurn = 4;
    const r4 = await runTurn(ctx, 'Sktr jam 10 pagi kalau bisa');
    expect(ContextGrounder.hasScheduleSignal('Sktr jam 10 pagi kalau bisa')).toBe(true);
    const s4: any = await sessionOf();
    expect(String(s4.booking?.preferredTime || '')).toMatch(/jam 10 pagi/i);
    expect(r4.trim().length).toBeGreaterThan(0);

    activeTurn = 5;
    const r5 = await runTurn(ctx, 'Ambil yang pijat pulih ceria sinar moksa itu ya??');
    expect(vi.mocked(reservationCoreService.saveReservation)).toHaveBeenCalledTimes(1);
    const s5: any = await sessionOf();
    expect(String(s5.booking?.preferredDate || '')).toBeTruthy();
    const cartNames = ((s5.cartItems || []) as any[]).map((c: any) => String(c.name).toLowerCase());
    expect(cartNames.some((n: string) => n.includes('pulih ceria'))).toBe(true);
    expect(cartNames.some((n: string) => n.includes('moksa'))).toBe(true);
    expect(r5.trim().length).toBeGreaterThan(0);
    expect(r5).not.toContain('**');
  });
});
