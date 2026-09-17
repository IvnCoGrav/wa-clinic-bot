import { describe, it, expect, vi } from 'vitest';

/**
 * Sesi 337880 — Deterministic Guardrails Replay (red-loop TDD).
 * Bukti log produksi 2026-09-17 (sandbox 6289999337880, gpt-4o-mini):
 * - "Waru Kepuh" (potongan "Kiriman") → 18 ambiguitas, 2 turn terbuang.
 * - "Mau tanya hari ini masih ada kuota?" → calculate_delivery me-recycle
 *   "Waru Kepuh" (redundan, tanpa entitas baru).
 * - "Kak kalo hari ini jam 3 sore ada jadwal kosong?" → save_reservation
 *   DIPANGGIL (masker ALLOWED same-day) dengan paket sepihak
 *   (Relaksasi Ibu tak pernah disebut user) + usia 0 fiktif.
 *
 * Stub di sini MEMAINKAN LLM agresif persis seperti di log (recycle lokasi,
 * panggil save saat ditawarkan pada kata-hari). Hijau/h merah ditentukan
 * 100% oleh gate produk (masking fisik + cart role-gate), BUKAN oleh stub.
 */

vi.mock('../../src/services/reservation-core.service', () => ({
  reservationCoreService: {
    saveReservation: vi.fn(async (params: any) => ({
      reservation: { id: `res-337880-${Date.now()}` },
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
import { evaluateToolMasking } from '../../src/v3/tools/tool-masker';
import { ALL_V3_TOOLS } from '../../src/v3/tools/tool-registry';
import * as toolRegistry from '../../src/v3/tools/tool-registry';
import { reservationCoreService } from '../../src/services/reservation-core.service';
import { setupOfflineEnv, CapturingWAHAClient } from './helpers/chat-harness';
import type { WhatsAppIncomingMessage } from '../../src/integrations/whatsapp/types';

setupOfflineEnv();

const callLog: Array<{ turn: number; tool: string }> = [];
let activeTurn = 0;
let lastTop: string | undefined;
let lastLocText: string | undefined;

function llmResponse(content: string, toolCalls?: any[]) {
  const message: any = { role: 'assistant', content: content || null };
  if (toolCalls?.length) message.tool_calls = toolCalls;
  return { choices: [{ message, finish_reason: toolCalls ? 'tool_calls' : 'stop' }], usage: {} };
}
function tc(name: string, args: Record<string, unknown>) {
  return [{ id: `c_${name}_${Date.now()}_${Math.random()}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }];
}
const DAY_RE = /senin|selasa|rabu|kamis|jumat|sabtu|minggu|besok|lusa|hari ini|sekarang|tgl\s*\d{1,2}|jam \d/i;
const LOC_RE = /kutisari|kendangsari|sedati|rungkut|waru|ke[pl]uh|kiriman|sidoarjo|surabaya|tropodo|pepelegi|pagerwojo|menanggal|deltasari|kelurahan|kecamatan|desa|jalan|jl |gang|perum/i;

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
    if (name === 'save_reservation' && lastTop) {
      args.treatmentName = lastTop;
      const d = lower.match(DAY_RE);
      if (d) args.bookingDate = d[0];
    }
    return llmResponse('', tc(name, args));
  }
  // LLM agresif ala log 337880: panggil save kapan pun ada kata-hari DAN
  // tool ditawarkan (allowed = tidak di-mask). Gate produk yang menentukan.
  const day = lower.match(DAY_RE);
  if (day && allowed('save_reservation') && lastTop) {
    return llmResponse('', tc('save_reservation', { treatmentName: lastTop, bookingDate: day[0] }));
  }
  const calls: any[] = [];
  if (LOC_RE.test(lower) && allowed('calculate_delivery')) {
    lastLocText = text;
    calls.push(...tc('calculate_delivery', { locationText: text }));
  } else if (allowed('calculate_delivery') && lastLocText) {
    // Recycle lokasi riwayat persis seperti bug log (uji masking fisik).
    calls.push(...tc('calculate_delivery', { locationText: lastLocText }));
  }
  if (/harga|biaya|tarif|berapa|kembung|pegel|capek|kolik/i.test(lower) && allowed('get_catalog_and_price')) {
    calls.push(...tc('get_catalog_and_price', { inquirePrice: /harga|biaya|tarif|berapa/i.test(lower), symptoms: ['kembung'] }));
  }
  if (calls.length > 0) return llmResponse('', calls);
  return llmResponse('Baik Bunda, kami bantu ya.');
}

describe('Sesi 337880 — Deterministic Guardrails Replay', () => {
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
    lastTop = undefined;
    lastLocText = undefined;
  });

  async function buildScenario() {
    const phone = `628337880${String(Math.floor(Math.random() * 900) + 100)}`;
    const customer: any = await customerService.getOrCreateCustomer(phone, 'Sesi 337880', DEFAULT_TENANT_ID);
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
      id: `s337880_${Date.now()}_${Math.random()}`,
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

  const sessionOf = (ctx: any) => GoalTracker.getGoalSession(ctx.conversation.id, DEFAULT_TENANT_ID);
  const callsFor = (turn: number, tool: string) =>
    callLog.filter((c) => c.turn === turn && c.tool === tool);

  it('replay 337880: masking fisik + cart role-gate menutup 3 anomali log', async () => {
    const ctx = await buildScenario();

    // T1: tanya slot besok tanpa lokasi/treatment — save WAJIB tak tersentuh.
    activeTurn = 1;
    const r1 = await runTurn(ctx, 'saya besok bisa reservasi untuk pijat baby?');
    expect(callsFor(1, 'save_reservation')).toHaveLength(0);
    expect(vi.mocked(reservationCoreService.saveReservation)).toHaveBeenCalledTimes(0);
    expect(r1.trim().length).toBeGreaterThan(0);

    // T2: kembung — katalog konsultasi, gejala tercatat.
    activeTurn = 2;
    await runTurn(ctx, 'yg untuk kembung perutnya kenceng banget');
    const s2: any = await sessionOf(ctx);
    expect(s2.childProfile?.symptoms ?? []).toEqual(expect.arrayContaining(['kembung']));

    // T3: rekomendasi manual + T4: lokasi full — siapkan konteks.
    activeTurn = 3;
    await runTurn(ctx, 'maaf kak mw nanyak, kl untuk pegel2 kecapean ambil yg mana?');
    activeTurn = 4;
    await runTurn(ctx, 'Di waru kepuh kiriman');
    const s4: any = await sessionOf(ctx);
    expect(s4.location?.kelurahan).toBe('Kepuhkiriman');

    // T5 (issue 2+3): kuota tanpa entitas baru — delivery TIDAK dipanggil
    // redundan (masking fisik), save TIDAK tersentuh, cart TANPA paket sepihak.
    activeTurn = 5;
    const r5 = await runTurn(ctx, 'Mau tanya hari ini masih ada kuota?');
    expect(callsFor(5, 'calculate_delivery')).toHaveLength(0);
    expect(callsFor(5, 'save_reservation')).toHaveLength(0);
    expect(vi.mocked(reservationCoreService.saveReservation)).toHaveBeenCalledTimes(0);
    const s5: any = await sessionOf(ctx);
    const cartNames5 = ((s5.cartItems || []) as any[]).map((c: any) => String(c.name).toLowerCase());
    expect(cartNames5.some((n: string) => n.includes('relaksasi ibu'))).toBe(false);
    expect(r5.trim().length).toBeGreaterThan(0);

    // T6 (issue 1): slot inquiry same-day — save DIPOTONG FISIK, tanpa persist.
    activeTurn = 6;
    const r6 = await runTurn(ctx, 'Kak kalo hari ini jam 3 sore ada jadwal kosong?');
    expect(callsFor(6, 'save_reservation')).toHaveLength(0);
    expect(vi.mocked(reservationCoreService.saveReservation)).toHaveBeenCalledTimes(0);
    const s6: any = await sessionOf(ctx);
    expect(s6.booking?.reservationId || '').toBe('');
    expect(r6.trim().length).toBeGreaterThan(0);
    expect(r6).not.toContain('**');
  });
});
