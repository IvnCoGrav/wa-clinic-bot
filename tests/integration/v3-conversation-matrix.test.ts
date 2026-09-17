import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Agenda 2 (Fase 5) — Automated Conversation Matrix: 20 skenario multi-turn
 * via jalur produksi nyata (machine → V3 runner → composer → masker → tools →
 * guardrail → session), LLM disimulasikan deterministik lewat seam resmi
 * GenerationStage.executeChatCompletion (pola Golden Corpus).
 *
 * BATAS KEJUJURAN (anti-tautologi): stub HANYA memerankan peran LLM sebagai
 * pemilih tool + argumen dari kata kunci eksplisit. Seluruh yang di-assert
 * adalah kontribusi deterministik pipeline: state sesi GoalTracker, tool yang
 * terpanggil/terblokir, fakta tool yang menggema di balasan, invarian format,
 * dan verdict tool-masker langsung. Kualitas prosa (empati/nada) tetap ranah
 * persona-quality-harness (LLM riil), bukan file ini.
 */

vi.mock('../../src/services/reservation-core.service', () => ({
  reservationCoreService: {
    saveReservation: vi.fn(async (params: any) => ({
      reservation: { id: `res-matrix-${Date.now()}` },
      isNew: true,
      isUpdate: false,
      __captured: params,
    })),
  },
  ReservationConflictError: class ReservationConflictError extends Error {},
}));

import { GenerationStage } from '../../src/v3/agent/pipeline/generation-stage';
import * as toolRegistry from '../../src/v3/tools/tool-registry';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { ConversationState } from '@prisma/client';
import { TypingService } from '../../src/services/typing.service';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { GoalTracker } from '../../src/v3/state/goal-tracker';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { PatientProfileExtractor } from '../../src/v3/state/patient-extractor';
import { evaluateToolMasking } from '../../src/v3/tools/tool-masker';
import { ALL_V3_TOOLS } from '../../src/v3/tools/tool-registry';
import { reservationCoreService } from '../../src/services/reservation-core.service';
import {
  setupOfflineEnv,
  CapturingWAHAClient,
} from './helpers/chat-harness';
import type { WhatsAppIncomingMessage } from '../../src/integrations/whatsapp/types';

setupOfflineEnv();

// ---------------------------------------------------------------------------
// Perekam deterministik: tool yang dipanggil + hasil tool per turn.
// ---------------------------------------------------------------------------
interface CallRecord {
  scenario: string;
  turn: number;
  tool: string;
  args: any;
}
let activeScenario = '';
let activeTurn = 0;
const callLog: CallRecord[] = [];
/** Hasil eksekusi tool nyata (seam executeToolByName) — fakta deterministik. */
interface ExecRecord {
  scenario: string;
  turn: number;
  tool: string;
  args: any;
  result: any;
}
const execLog: ExecRecord[] = [];

function llmResponse(content: string, toolCalls?: any[]) {
  const message: any = { role: 'assistant', content: content || null };
  if (toolCalls && toolCalls.length > 0) message.tool_calls = toolCalls;
  return {
    choices: [{ message, finish_reason: toolCalls ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  };
}

function makeToolCall(name: string, args: Record<string, unknown>) {
  return [{ id: `call_${name}_${Date.now()}_${Math.random()}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }];
}

const SYMPTOM_WORDS = ['batuk', 'pilek', 'bapil', 'grok', 'demam', 'kembung', 'kolik', 'rewel', 'gtm', 'diare', 'muntah', 'makan', 'lahap', 'jatuh', 'jatoh', 'terbentur', 'benjol', 'susah tidur', 'flu'];
const DAY_WORDS = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu', 'besok', 'lusa', 'hari ini', 'sekarang', 'sore ini', 'nanti sore'];
const TREATMENT_NAMES = [
  'Pijat Bayi Ceria (Rileksasi)',
  'Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)',
  'Pijat Kids Pulih Ceria (2 - 4 Tahun)',
  'Pijat Kids Ceria (Usia 2-4 th)',
  'Pijat Kids Ceria',
  'Pijat Lahap Juara (Nafsu Makan)',
  'Oksitosin Massage Fullbody',
  'Sinar Moksa',
];

function inferAgeMonths(text: string): number | undefined {
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(tahun|thn|th|bulan|bln)\b/);
  if (!m) {
    if (/baru lahir|newborn/i.test(text)) return 0;
    return undefined;
  }
  const val = parseFloat(m[1].replace(',', '.'));
  if (!Number.isFinite(val)) return undefined;
  const unit = m[2].toLowerCase();
  return (unit.startsWith('tahun') || unit.startsWith('thn') || unit === 'th') ? Math.round(val * 12) : Math.round(val);
}

function inferSymptoms(text: string): string[] {
  return SYMPTOM_WORDS.filter((w) => text.includes(w));
}

function inferCategory(text: string, age?: number): 'BABY' | 'KIDS' | 'MOMS' | undefined {
  if (age !== undefined) return PatientProfileExtractor.resolveChildAgeCategory(age);
  if (/nifas|hamil|bumil|menyusui|laktasi|oksitosin|untuk saya|bunda sendiri/i.test(text)) return 'MOMS';
  if (/balita|kakak|kids|anak pertama/i.test(text)) return 'KIDS';
  if (/bayi|baby|newborn|bulan|adik|si kecil/i.test(text)) return 'BABY';
  return undefined;
}

function inferTreatment(text: string, fallback?: string): string | undefined {
  const named = inferTreatmentNameOnly(text);
  if (named) return named;
  if (/relaksasi/i.test(text)) return 'Pijat Bayi Ceria (Rileksasi)';
  if (/lahap|gtm|nafsu makan/i.test(text)) return 'Pijat Lahap Juara (Nafsu Makan)';
  if (/oksitosin/i.test(text)) return 'Oksitosin Massage Fullbody';
  return fallback;
}

/** HANYA nama katalog eksplisit (tanpa tebakan kata kunci gejala). */
function inferTreatmentNameOnly(text: string): string | undefined {
  for (const name of TREATMENT_NAMES) {
    const key = name.toLowerCase().replace(/\(.*\)/, '').trim();
    if (key.length >= 6 && text.includes(key)) return name;
  }
  return undefined;
}

function inferDay(text: string): string | undefined {
  const m = text.match(/hari\s*ke-?\d+|senin|selasa|rabu|kamis|jumat|sabtu|minggu|besok|lusa|hari ini|sekarang|sore ini|nanti sore/i);
  return m ? m[0] : undefined;
}

function isSlotQuestion(text: string): boolean {
  // Sempit & eksplisit: '?' + kata slot/jadwal/jam. Bare "bisa" SENGAJA bukan
  // penanda slot (menelan pertanyaan coverage "bisa homecare ke Tuban?").
  return text.includes('?') && /slot|kosong|tersedia|jadwal|jam \d|jam berapa|pukul/i.test(text);
}

function isCommit(text: string, day?: string): boolean {
  if (!day || text.includes('?')) return false;
  return /(fix|jadi|ambil|deal|jadwalkan|oke|iya|mau|gak apa-?apa|nggak apa-?apa)\b/i.test(text);
}

function isDrugRequest(text: string): boolean {
  return /dosis|paracetamol|resep|antibiotik|\bobat\b|pereda nyeri|ml\b.*sirup/i.test(text);
}

function isLocationText(text: string): boolean {
  return /kelurahan|kecamatan|desa|alamat|rumah|tinggal|lokasi|di [a-z]{3,}|sedati|rungkut|waru|tuban|sidoarjo|surabaya|lamongan|gedangan|buduran|kutisari|kendangsari|rewwin|pondok|tropodo|pepelegi|pagerwojo|menanggal|deltasari/i.test(text);
}

/** Stub router Call-1: peta kata kunci eksplisit → tool + argumen waras. */
function routeStub(payload: any, lastTopTreatment?: string): any {
  const messages: any[] = payload?.messages ?? [];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const text = String(lastUser);
  const lower = text.toLowerCase();
  const toolChoice = payload?.tool_choice;
  // Hormati tool yang ditawarkan pipeline (mis. forcing calculate_delivery
  // tunggal saat lokasi terdeteksi) — JANGAN panggil tool di luar daftar.
  const offered = new Set(
    Array.isArray(payload?.tools) ? payload.tools.map((t: any) => t?.function?.name) : []
  );
  const allowed = (name: string) => offered.size === 0 || offered.has(name);

  if (toolChoice && typeof toolChoice === 'object' && toolChoice?.function?.name) {
    const name = toolChoice.function.name;
    const args: Record<string, unknown> = {};
    if (name === 'calculate_delivery') args.locationText = text;
    if (name === 'get_catalog_and_price') {
      const age = inferAgeMonths(lower);
      args.symptoms = inferSymptoms(lower);
      if (age !== undefined) args.childAgeMonths = age;
      const cat = inferCategory(lower, age);
      if (cat) args.category = cat;
    }
    if (name === 'search_knowledge_faq') args.query = text;
    if (name === 'get_clinic_policy_faq') {
      args.query = text;
      if (/vaksin|imunisasi|suntik|dpt|bcg|polio|kipi/i.test(lower)) args.topic = 'post_vaccine_rules';
      else if (/bayar|transfer|qris|cash|rekening/i.test(lower)) args.topic = 'payment_methods';
      else if (/bidan.*(str|sertifikat|kulifikasi)|kualifikasi|lulusan/i.test(lower)) args.topic = 'bidan_qualification';
      else if (/ongkir.*(anak|dua|2)|multi/i.test(lower)) args.topic = 'multi_child_ongkir';
      else args.topic = 'homebase_and_coverage';
    }
    if (name === 'save_reservation') {
      args.treatmentName = inferTreatment(lower, lastTopTreatment) || lastTopTreatment;
      const day = inferDay(lower);
      if (day) args.bookingDate = day;
    }
    if (name === 'escalate_to_human') {
      args.reason = text.slice(0, 200);
      args.severity = 'CRITICAL_MEDICAL';
    }
    return llmResponse('', makeToolCall(name, args));
  }

  if (isDrugRequest(lower)) {
    if (!allowed('escalate_to_human')) return llmResponse('Baik Bunda, kami bantu ya.');
    return llmResponse('', makeToolCall('escalate_to_human', { reason: text.slice(0, 200), severity: 'CRITICAL_MEDICAL' }));
  }
  // Pertanyaan slot bertanda tanya = BUKAN komitmen (anti premature booking).
  if (isSlotQuestion(text)) {
    return llmResponse('Baik Bunda, kami bantu cekkan ketersediaan jadwalnya dulu ya.');
  }
  const day = inferDay(lower);
  if (isCommit(lower, day)) {
    const tname = inferTreatment(lower, lastTopTreatment);
    if (tname && day && allowed('save_reservation')) {
      return llmResponse('', makeToolCall('save_reservation', { treatmentName: tname, bookingDate: day }));
    }
  }
  const calls: any[] = [];
  if (isLocationText(lower) && allowed('calculate_delivery')) {
    calls.push(...makeToolCall('calculate_delivery', { locationText: text }));
  }
  if (/harga|biaya|tarif|pricelist|total|berapa|rp |promo|ongkir|daftar harga/i.test(lower) && allowed('get_catalog_and_price')) {
    const age = inferAgeMonths(lower);
    const cargs: Record<string, unknown> = { inquirePrice: true };
    if (/menit|durasi|berapa lama/i.test(lower)) cargs.asksDuration = true;
    if (age !== undefined) cargs.childAgeMonths = age;
    const cat = inferCategory(lower, age);
    if (cat) cargs.category = cat;
    const syms = inferSymptoms(lower);
    if (syms.length > 0) cargs.symptoms = syms;
    const specific = inferTreatment(lower);
    if (specific) cargs.specificTreatmentName = specific;
    calls.push(...makeToolCall('get_catalog_and_price', cargs));
  } else if ((inferSymptoms(lower).length > 0 || inferTreatmentNameOnly(lower) || /vaksin|imunisasi|suntik|jatuh|terbentur|newborn|baru lahir|boleh dipijat|pijat apa|ada pijat|paket.*(ibu|nifas|bayi)|nifas|menyusui/i.test(lower)) && allowed('get_catalog_and_price')) {
    const age = inferAgeMonths(lower);
    // Spesifik HANYA bila nama katalog eksplisit disebut (bukan kata kunci
    // gejala seperti "gtm" — itu ranah symptoms, bukan specificTreatmentName).
    const named = inferTreatmentNameOnly(lower);
    const cargs: Record<string, unknown> = { inquirePrice: false, symptoms: inferSymptoms(lower) };
    if (age !== undefined) cargs.childAgeMonths = age;
    const cat = inferCategory(lower, age);
    if (cat) cargs.category = cat;
    if (named) cargs.specificTreatmentName = named;
    calls.push(...makeToolCall('get_catalog_and_price', cargs));
  }
  if (/klinik.*(di mana|dimana|mana)|asal.*klinik|homebase|bidang dari mana|dari mana.*(sus|bidan|klinik)/i.test(lower) && allowed('get_clinic_policy_faq')) {
    calls.push(...makeToolCall('get_clinic_policy_faq', { topic: 'homebase_and_coverage' }));
  }
  if (calls.length > 0) return llmResponse('', calls);
  return llmResponse('Baik Bunda, kami bantu ya.');
}

/** Stub generator Call-2: balasan generik higienis (fakta tool TIDAK mengalir
 *  lewat pesan role:tool — Call-2 menerima grounding via system prompt; fakta
 *  tool diassert langsung dari execLog, bukan dari gema stub).
 *  Realisme LLM: rekomendasi teratas DISEBUTKAN di balasan (bold *Nama*) —
 *  inilah yang dibaca resolveCandidateTreatment masker pada commit anaphoric.
 */
function generateStub(payload: any, lastTop?: string): any {
  const mention = lastTop ? ` Bisa dibantu dengan *${lastTop}* ya Bunda.` : '';
  return llmResponse(
    `Baik Bunda, berikut informasi yang bisa kami sampaikan.${mention}\n\nApakah ada yang ingin ditanyakan lagi ya Bunda?`
  );
}

function stubLlm(getLastTop: () => string | undefined) {
  return vi
    .spyOn(GenerationStage, 'executeChatCompletion')
    .mockImplementation(async (params: any) => {
      const payload = params?.payload;
      const isRouting = Array.isArray(payload?.tools) && payload.tools.length > 0;
      if (isRouting) {
        const res = routeStub(payload, getLastTop());
        for (const tc of res?.choices?.[0]?.message?.tool_calls || []) {
          callLog.push({ scenario: activeScenario, turn: activeTurn, tool: tc.function?.name, args: tc.function?.arguments });
        }
        return res;
      }
      return generateStub(payload, getLastTop());
    });
}

// ---------------------------------------------------------------------------
// Runner skenario.
// ---------------------------------------------------------------------------
interface ScenarioCtx {
  customer: any;
  conversation: any;
  machine: ConversationStateMachine;
  client: CapturingWAHAClient;
}
let phoneCounter = 628700000000;

async function buildScenario(name: string): Promise<ScenarioCtx> {
  const phone = String(phoneCounter++);
  const customer: any = await customerService.getOrCreateCustomer(phone, name, DEFAULT_TENANT_ID);
  customer.status = 'active';
  const conversation: any = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
  conversation.current_state = ConversationState.INITIAL;
  conversation.is_human_handling = false;
  conversation.human_handling_since = null;
  conversation.last_message_at = new Date();
  const client = new CapturingWAHAClient();
  const machine = new ConversationStateMachine(new TypingService(client));
  return { customer, conversation, machine, client };
}

async function runTurn(ctx: ScenarioCtx, question: string): Promise<string> {
  const { customer, conversation, machine, client } = ctx;
  conversation.is_human_handling = false;
  const incomingMessage: WhatsAppIncomingMessage = {
    id: `mx_msg_${Date.now()}_${Math.random()}`,
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

async function sessionOf(ctx: ScenarioCtx): Promise<any> {
  return GoalTracker.getGoalSession(ctx.conversation.id, DEFAULT_TENANT_ID);
}

function callsFor(scenario: string, turn: number, tool?: string): CallRecord[] {
  return callLog.filter((c) => c.scenario === scenario && c.turn === turn && (!tool || c.tool === tool));
}

/** Hasil tool nyata per turn (via spy executeToolByName). */
function execFor(scenario: string, turn: number, tool: string): ExecRecord[] {
  return execLog.filter((e) => e.scenario === scenario && e.turn === turn && e.tool === tool);
}

/** Masker verdict langsung (seam deterministik) untuk turn save-or-block. */
async function maskerAllows(ctx: ScenarioCtx, text: string): Promise<boolean> {
  const session = await sessionOf(ctx);
  const evalRes = evaluateToolMasking(ALL_V3_TOOLS, session, text, [{ role: 'user', content: text }]);
  return evalRes.isSaveReservationAllowed;
}

function expectNoSilentDrop(reply: string) {
  expect(reply.trim().length).toBeGreaterThan(0);
}

function expectHygienic(reply: string) {
  expect(reply).not.toContain('**');
  expect(reply.length).toBeLessThanOrEqual(1500);
}

// Top treatment terakhir per skenario (fallback argumen commit stub).
let lastTopTreatment: string | undefined;

describe('Matrix Percakapan Multi-Turn (jalur produksi, stub deterministik)', () => {
  let spy: ReturnType<typeof stubLlm>;
  let execSpy: any;

  beforeAll(() => {
    spy = stubLlm(() => lastTopTreatment);
    const original = toolRegistry.executeToolByName;
    execSpy = vi.spyOn(toolRegistry, 'executeToolByName').mockImplementation(
      async (name: string, args: any, ctx: any) => {
        const result = await original(name, args, ctx);
        execLog.push({ scenario: activeScenario, turn: activeTurn, tool: name, args, result });
        return result;
      }
    );
  });

  afterAll(() => {
    spy.mockRestore();
    execSpy.mockRestore();
  });

  beforeEach(() => {
    vi.mocked(reservationCoreService.saveReservation).mockClear();
    lastTopTreatment = undefined;
  });

  // =====================================================================
  // Arketipe A: Balita 2–4 tahun (Pediatrik / Kids)
  // =====================================================================
  it('CM-01: Bapil balita 3 tahun end-to-end booking', async () => {
    const id = 'CM-01';
    activeScenario = id;
    const ctx = await buildScenario('Matrix CM-01');

    activeTurn = 1;
    const r1 = await runTurn(ctx, 'Halo mbak anak saya batuk pilek usia 3 tahun');
    let s = await sessionOf(ctx);
    expect(s.childProfile?.ageMonths).toBe(36);
    expect(s.childProfile?.symptoms).toEqual(expect.arrayContaining(['batuk', 'pilek']));
    expect(callsFor(id, 1, 'get_catalog_and_price')).toHaveLength(1);
    const cat1 = execFor(id, 1, 'get_catalog_and_price');
    expect(cat1).toHaveLength(1);
    expect(cat1[0].result.success).toBe(true);
    // Snap taksonomi: usia 36 → pool KIDS/BOTH murni (bukan Baby).
    // Terapi bapil KIDS (kids-pulih-2-4th) kini hadir di katalog dan diprioritaskan:
    expect(cat1[0].result.treatments.length).toBeGreaterThan(0);
    expect(cat1[0].result.treatments.every((t: any) => t.category === 'KIDS' || t.category === 'BOTH')).toBe(true);
    expect(cat1[0].result.treatments[0]?.name).toBe('Pijat Kids Pulih Ceria (2 - 4 Tahun)');
    lastTopTreatment = cat1[0].result.treatments[0]?.name;
    // Sapaan resmi Turn-0 ditempel deterministik oleh generation-stage.
    expect(r1).toMatch(/^Halo Bunda!/);
    expectNoSilentDrop(r1);
    expectHygienic(r1);

    activeTurn = 2;
    const r2 = await runTurn(ctx, 'Saya di Deltasari Waru');
    s = await sessionOf(ctx);
    expect(s.location?.kecamatan).toBe('Waru');
    expect(s.location?.kelurahan).toBe('Kureksari');
    expect(callsFor(id, 2, 'calculate_delivery')).toHaveLength(1);
    const del2 = execFor(id, 2, 'calculate_delivery');
    expect(del2).toHaveLength(1);
    expect(del2[0].result.kecamatan).toBe('Waru');
    expectHygienic(r2);

    activeTurn = 3;
    const r3 = await runTurn(ctx, 'Pijat Kids Ceria (Usia 2-4 th) harganya berapa?');
    expect(callsFor(id, 3, 'get_catalog_and_price')).toHaveLength(1);
    const cat3 = execFor(id, 3, 'get_catalog_and_price');
    expect(cat3).toHaveLength(1);
    // Mode transaksional + ongkir sesi QUOTED → template total resmi.
    expect(String(cat3[0].result.suggestedPriceReply || '')).toMatch(/total keseluruhan/i);
    lastTopTreatment = 'Pijat Kids Ceria (Usia 2-4 th)';

    activeTurn = 4;
    const r4 = await runTurn(ctx, 'Oke fix Pijat Kids Ceria hari Sabtu ya mbak');
    expect(callsFor(id, 4, 'save_reservation')).toHaveLength(1);
    expect(vi.mocked(reservationCoreService.saveReservation)).toHaveBeenCalledTimes(1);
    const savedArgs = vi.mocked(reservationCoreService.saveReservation).mock.calls[0][0] as any;
    // Tool memetakan treatmentName → treatmentDetail + treatmentCategory.
    expect(String(savedArgs.treatmentDetail)).toMatch(/Kids Ceria/i);
    expect(String(savedArgs.bookingDate)).toBeTruthy();
    s = await sessionOf(ctx);
    expect(String(s.booking?.preferredDate)).toMatch(/sabtu/i);
    expectNoSilentDrop(r4);
  });

  it('CM-02: GTM 28 bulan — taksonomi KIDS + Lahap Juara', async () => {
    const id = 'CM-02';
    activeScenario = id;
    const ctx = await buildScenario('Matrix CM-02');

    activeTurn = 1;
    const r1 = await runTurn(ctx, 'Anak saya 28 bulan susah banget makan GTM parah');
    const s1 = await sessionOf(ctx);
    expect(s1.childProfile?.ageMonths).toBe(28);
    const cat1 = execFor(id, 1, 'get_catalog_and_price');
    expect(cat1).toHaveLength(1);
    // Trim konsultasi: 1 rekomendasi + 1 pelengkap, teratas = Lahap.
    expect(cat1[0].result.treatments.length).toBeLessThanOrEqual(2);
    expect(String(cat1[0].result.treatments[0]?.name)).toMatch(/Lahap/i);
    expect(cat1[0].result.treatments[0]?.isRecommendedForSymptoms).toBe(true);
    lastTopTreatment = cat1[0].result.treatments[0]?.name;

    activeTurn = 2;
    const r2 = await runTurn(ctx, 'Rumah saya di Rungkut Menanggal');
    const s2 = await sessionOf(ctx);
    expect(s2.location?.kelurahan).toBe('Rungkut Menanggal');
    expect(callsFor(id, 2, 'calculate_delivery')).toHaveLength(1);
    expectHygienic(r2);

    activeTurn = 3;
    const r3 = await runTurn(ctx, 'Berapa biayanya?');
    const cat3 = execFor(id, 3, 'get_catalog_and_price');
    expect(cat3).toHaveLength(1);
    expect(JSON.stringify(cat3[0].result)).toMatch(/Rp /);

    activeTurn = 4;
    const r4 = await runTurn(ctx, 'Oke jadwalkan besok lusa ya mbak');
    expect(callsFor(id, 4, 'save_reservation')).toHaveLength(1);
    expect(await maskerAllows(ctx, 'Oke jadwalkan besok lusa ya mbak')).toBe(true);
    expect(vi.mocked(reservationCoreService.saveReservation)).toHaveBeenCalledTimes(1);
    expectNoSilentDrop(r4);
  });

  it('CM-03: Pricelist balita + Kutisari Tier-0 + slot bertanya', async () => {
    const id = 'CM-03';
    activeScenario = id;
    const ctx = await buildScenario('Matrix CM-03');

    activeTurn = 1;
    const r1 = await runTurn(ctx, 'Minta daftar harga pijat anak balita dong');
    expect(callsFor(id, 1, 'get_catalog_and_price')).toHaveLength(1);
    const cat1 = execFor(id, 1, 'get_catalog_and_price');
    expect(cat1).toHaveLength(1);
    expect(cat1[0].result.success).toBe(true);
    expect(JSON.stringify(cat1[0].result)).toMatch(/Rp /);
    expectHygienic(r1);
    expectNoSilentDrop(r1);

    activeTurn = 2;
    const r2 = await runTurn(ctx, 'Ambil yang relaksasi aja, rumah saya di Kutisari Indah');
    const s2 = await sessionOf(ctx);
    expect(s2.location?.kelurahan).toBe('Kutisari');
    expect(s2.location?.kecamatan).toBe('Tenggilis Mejoyo');
    expect(callsFor(id, 2, 'save_reservation')).toHaveLength(0);
    expect(r2.toLowerCase()).not.toMatch(/\(atau[^)]*share location/);
    expectHygienic(r2);

    activeTurn = 3;
    const r3 = await runTurn(ctx, 'Bisa hari Minggu siang?');
    expect(callsFor(id, 3, 'save_reservation')).toHaveLength(0);
    expect(await maskerAllows(ctx, 'Bisa hari Minggu siang?')).toBe(false);
    expectNoSilentDrop(r3);
  });

  it('CM-04: Ambang 24 bulan snap KIDS + koridor Tropodo', async () => {
    const id = 'CM-04';
    activeScenario = id;
    const ctx = await buildScenario('Matrix CM-04');

    activeTurn = 1;
    const r1 = await runTurn(ctx, 'Anak saya genap 2 tahun (24 bulan), ada pijat apa ya?');
    const s1 = await sessionOf(ctx);
    expect(s1.childProfile?.ageMonths).toBe(24);
    const cat1 = execFor(id, 1, 'get_catalog_and_price');
    expect(cat1).toHaveLength(1);
    expect(cat1[0].result.treatments.length).toBeGreaterThan(0);
    expect(cat1[0].result.treatments.every((t: any) => t.category === 'KIDS' || t.category === 'BOTH')).toBe(true);
    expectNoSilentDrop(r1);

    activeTurn = 2;
    await runTurn(ctx, 'Di daerah Tropodo Waru');
    const s2 = await sessionOf(ctx);
    expect(s2.location?.kelurahan).toBe('Tropodo');
    expect(s2.location?.kecamatan).toBe('Waru');
  });

  // =====================================================================
  // Arketipe B: Bayi & newborn 0–6 bulan (safety red-flags)
  // =====================================================================
  it('CM-05: Newborn 15 hari + Sedati tanpa solicitation shareloc', async () => {
    const id = 'CM-05';
    activeScenario = id;
    const ctx = await buildScenario('Matrix CM-05');

    activeTurn = 1;
    const r1 = await runTurn(ctx, 'Mbak, bayi baru lahir usia 15 hari sudah boleh dipijat belum ya?');
    const s1 = await sessionOf(ctx);
    expect(s1.childProfile?.ageMonths).toBe(0);
    expect(callsFor(id, 1, 'get_catalog_and_price')).toHaveLength(1);
    expect(r1).toMatch(/^Halo Bunda!/);
    expectNoSilentDrop(r1);
    expectHygienic(r1);

    activeTurn = 2;
    const r2 = await runTurn(ctx, 'Alhamdulillah, kami di Sedati Sidoarjo');
    const s2 = await sessionOf(ctx);
    // Kecamatan luas: kelurahan BELUM boleh terkunci. Fakta tool (bukan gema
    // stub) wajib meminta kelurahan TANPA solicitation share location.
    expect(s2.location?.kelurahan || '').toBe('');
    const del2 = execFor(id, 2, 'calculate_delivery');
    expect(del2).toHaveLength(1);
    expect(del2[0].result.message).toMatch(/kelurahan/i);
    expect(del2[0].result.message).not.toMatch(/\(atau[^)]*share location/);
    expect(del2[0].result.message).not.toMatch(/tawarkan[^.]*share location/);
    expectHygienic(r2);

    activeTurn = 3;
    await runTurn(ctx, 'Kelurahan Sedati Gede dekat balai desa');
    const s3 = await sessionOf(ctx);
    expect(s3.location?.kelurahan).toBe('Sedati Gede');
    expect(s3.location?.kecamatan).toBe('Sedati');
    const del3 = execFor(id, 3, 'calculate_delivery');
    expect(del3).toHaveLength(1);
    expect(del3[0].result.isPrecise).toBe(true);
  });

  it('CM-06: Kolik kembung + Pondok Candra Tier-0 + slot sore bertanya', async () => {
    const id = 'CM-06';
    activeScenario = id;
    const ctx = await buildScenario('Matrix CM-06');

    activeTurn = 1;
    const r1 = await runTurn(ctx, 'Bayi saya 2 bulan kembung terus dan rewel tiap malam');
    const s1 = await sessionOf(ctx);
    expect(s1.childProfile?.ageMonths).toBe(2);
    expect(s1.childProfile?.symptoms).toEqual(expect.arrayContaining(['kembung', 'rewel']));
    const cat1 = execFor(id, 1, 'get_catalog_and_price');
    expect(cat1).toHaveLength(1);
    expect(cat1[0].result.treatments[0]?.isRecommendedForSymptoms).toBe(true);
    expect(String(cat1[0].result.treatments[0]?.name)).toMatch(/Pulih/i);
    lastTopTreatment = cat1[0].result.treatments[0]?.name;
    expectNoSilentDrop(r1);

    activeTurn = 2;
    const r2 = await runTurn(ctx, 'Lokasi di Pondok Candra');
    const s2 = await sessionOf(ctx);
    expect(s2.location?.kelurahan).toBe('Tambaksumur');
    expect(s2.location?.kecamatan).toBe('Waru');
    expect(r2).not.toMatch(/\(atau[^)]*share location/);
    expectHygienic(r2);

    activeTurn = 3;
    const r3 = await runTurn(ctx, 'Bisa nanti sore jam 4?');
    // Sesi 337880: interogatif (walau same-day) TANPA verba = slot inquiry.
    // Kontrak: tidak tersimpan, tidak terkonfirmasi, masker memblokir.
    expect(vi.mocked(reservationCoreService.saveReservation)).toHaveBeenCalledTimes(0);
    const s3 = await sessionOf(ctx);
    expect(s3.booking?.preferredDate || '').toBe('');
    expect(s3.booking?.reservationId || '').toBe('');
    expect(s3.booking?.isConfirmed || false).toBe(false);
    expect(await maskerAllows(ctx, 'Bisa nanti sore jam 4?')).toBe(false);
    expectNoSilentDrop(r3);
  });

  it('CM-07: Vaksin DPT kemarin — SOP tunda 48-72 jam + booking aman', async () => {
    const id = 'CM-07';
    activeScenario = id;
    const ctx = await buildScenario('Matrix CM-07');

    activeTurn = 1;
    const r1 = await runTurn(ctx, 'Bayi 4 bulan mau pijat, tapi baru kemarin siang suntik DPT');
    expect(callsFor(id, 1, 'get_clinic_policy_faq')).toHaveLength(1);
    const pol1 = execFor(id, 1, 'get_clinic_policy_faq');
    expect(pol1).toHaveLength(1);
    expect(String(pol1[0].result.factualSummary || '')).toMatch(/hari/i);
    expectNoSilentDrop(r1);

    activeTurn = 2;
    const r2 = await runTurn(ctx, 'Oke ambil Pijat Bayi Ceria hari ke-4 ya mbak');
    // Fail-closed homecare: sesi TANPA lokasi → commit DITOLAK tool (bukan
    // tersimpan). Ini kontrak keselamatan 03d0e69/Aturan 5a end-to-end.
    expect(vi.mocked(reservationCoreService.saveReservation)).toHaveBeenCalledTimes(0);
    const rej2 = execFor(id, 2, 'save_reservation');
    if (rej2.length > 0) {
      expect(rej2[0].result.success).toBe(false);
      expect(String(rej2[0].result.message || '')).toMatch(/lokasi|wilayah|daerah|kelurahan/i);
    }
    const s2a = await sessionOf(ctx);
    expect(s2a.booking?.reservationId || '').toBe('');
    expectNoSilentDrop(r2);

    activeTurn = 3;
    await runTurn(ctx, 'Rumah saya di Sedati Gede Sidoarjo');
    const s3 = await sessionOf(ctx);
    expect(s3.location?.kelurahan).toBe('Sedati Gede');

    activeTurn = 4;
    const r4 = await runTurn(ctx, 'Oke ambil Pijat Bayi Ceria hari ke-4 ya mbak');
    expect(vi.mocked(reservationCoreService.saveReservation)).toHaveBeenCalledTimes(1);
    const s4 = await sessionOf(ctx);
    expect(String(s4.booking?.preferredDate || '')).toBeTruthy();
    expectNoSilentDrop(r4);
  });

  it('CM-08: Trauma jatuh — search SOP red-flag + eskalasi obat', async () => {
    const id = 'CM-08';
    activeScenario = id;
    const ctx = await buildScenario('Matrix CM-08');

    activeTurn = 1;
    const r1 = await runTurn(
      ctx,
      'Tolong mbak bayi saya tadi jatuh dari kasur kepalanya kebentur mau dipijat biar gak rewel'
    );
    expect(callsFor(id, 1, 'search_knowledge_faq')).toHaveLength(1);
    const s1 = await sessionOf(ctx);
    expect([...(s1.childProfile?.symptoms || []), ...((s1.children || []).flatMap((c: any) => c?.symptoms || []))]).toEqual(
      expect.arrayContaining(['jatuh'])
    );
    expect(callsFor(id, 1, 'escalate_to_human')).toHaveLength(0);
    expectNoSilentDrop(r1);
    expectHygienic(r1);

    activeTurn = 2;
    const r2 = await runTurn(ctx, 'Tapi bisa dikasih obat pereda nyeri gak?');
    expect(callsFor(id, 2, 'escalate_to_human')).toHaveLength(1);
    const esc2 = execFor(id, 2, 'escalate_to_human');
    expect(esc2).toHaveLength(1);
    expect(esc2[0].result.success).toBe(true);
    expect(esc2[0].result.escalated).toBe(true);
    expectNoSilentDrop(r2);
  });

  // =====================================================================
  // Arketipe C: Same-day & penjadwalan dinamis
  // =====================================================================
  it('CM-09: Same-day Rewwin — hint hari-ini + commit pending', async () => {
    const id = 'CM-09';
    activeScenario = id;
    const ctx = await buildScenario('Matrix CM-09');

    activeTurn = 1;
    const r1 = await runTurn(ctx, 'Bisa pesan pijat bayi hari ini jam 2 siang di Rewwin Waru?');
    const s1 = await sessionOf(ctx);
    expect(s1.location?.kelurahan).toBe('Wedoro');
    expect(String(s1.booking?.requestedTimeHint || '')).toMatch(/hari ini/i);
    // Sesi 337880: interogatif '?' (walau same-day + lokasi) = slot inquiry,
    // BUKAN komitmen — masker memblokir, nihil persist.
    expect(await maskerAllows(ctx, 'Bisa pesan pijat bayi hari ini jam 2 siang di Rewwin Waru?')).toBe(false);
    expect(vi.mocked(reservationCoreService.saveReservation)).toHaveBeenCalledTimes(0);
    expectNoSilentDrop(r1);

    activeTurn = 2;
    const r2 = await runTurn(ctx, 'Oke fix Pijat Bayi Ceria hari ini ya');
    expect(vi.mocked(reservationCoreService.saveReservation)).toHaveBeenCalledTimes(1);
    const s2 = await sessionOf(ctx);
    expect(String(s2.booking?.preferredDate || '')).toMatch(/hari ini/i);
    expect(s2.booking?.isConfirmed).toBe(false);
    expectNoSilentDrop(r2);
  });

  it('CM-10: Same-day tanpa lokasi — fail-closed tanya domisili dulu', async () => {
    const id = 'CM-10';
    activeScenario = id;
    const ctx = await buildScenario('Matrix CM-10');

    activeTurn = 1;
    const r1 = await runTurn(ctx, 'Bisa pesan sekarang juga hari ini?');
    const s1 = await sessionOf(ctx);
    expect(s1.location?.kelurahan || '').toBe('');
    expect(callsFor(id, 1, 'calculate_delivery')).toHaveLength(0);
    expect(vi.mocked(reservationCoreService.saveReservation)).toHaveBeenCalledTimes(0);
    expectNoSilentDrop(r1);

    activeTurn = 2;
    await runTurn(ctx, 'Di Pagerwojo Buduran Sidoarjo');
    const s2 = await sessionOf(ctx);
    expect(s2.location?.kelurahan).toBe('Pagerwojo');
    expect(s2.location?.kecamatan).toBe('Buduran');
  });

  it('CM-11: Latch ganti hari Sabtu → Minggu tanpa amnesia', async () => {
    const id = 'CM-11';
    activeScenario = id;
    const ctx = await buildScenario('Matrix CM-11');

    activeTurn = 1;
    await runTurn(ctx, 'Saya mau booking untuk hari Sabtu ya di Pepelegi Waru');
    const s1 = await sessionOf(ctx);
    expect(s1.location?.kelurahan).toBe('Pepelegi');
    expect(String(s1.booking?.requestedTimeHint || '')).toMatch(/sabtu/i);
    expect(vi.mocked(reservationCoreService.saveReservation)).toHaveBeenCalledTimes(0);

    activeTurn = 2;
    // Catatan: ekstraktor hint memakai token hari PERTAMA; kalimat jelas
    // ("ganti hari Minggu") melatch bersih. Kalimat dua-hari ("Sabtu ...
    // ganti Minggu") adalah edge produk tercatat (KNOWN_ISSUES), bukan jalur ini.
    await runTurn(ctx, 'Eh maaf mbak, ganti hari Minggu ya');
    const s2 = await sessionOf(ctx);
    expect(String(s2.booking?.requestedTimeHint || '')).toMatch(/minggu/i);
    expect(String(s2.booking?.requestedTimeHint || '')).not.toMatch(/sabtu/i);
    expect(vi.mocked(reservationCoreService.saveReservation)).toHaveBeenCalledTimes(0);
  });

  it('CM-12: Slot bertanya diblokir, komitmen fix dieksekusi', async () => {
    const id = 'CM-12';
    activeScenario = id;
    const ctx = await buildScenario('Matrix CM-12');

    activeTurn = 1;
    await runTurn(ctx, 'Saya di Kureksari Waru, ambil Pijat Bayi Ceria');
    const s1 = await sessionOf(ctx);
    expect(s1.location?.kelurahan).toBe('Kureksari');
    expect(s1.location?.kecamatan).toBe('Waru');

    activeTurn = 2;
    const r2 = await runTurn(ctx, 'Kalau hari Minggu jam 9 pagi ada slot kosong gak?');
    expect(callsFor(id, 2, 'save_reservation')).toHaveLength(0);
    expect(await maskerAllows(ctx, 'Kalau hari Minggu jam 9 pagi ada slot kosong gak?')).toBe(false);
    expect(vi.mocked(reservationCoreService.saveReservation)).toHaveBeenCalledTimes(0);
    expectNoSilentDrop(r2);

    activeTurn = 3;
    const r3 = await runTurn(ctx, 'Oke fix Pijat Bayi Ceria hari Minggu jam 9 pagi itu ya mbak');
    expect(vi.mocked(reservationCoreService.saveReservation)).toHaveBeenCalledTimes(1);
    const s3 = await sessionOf(ctx);
    expect(String(s3.booking?.preferredDate || '')).toMatch(/minggu/i);
    expectNoSilentDrop(r3);
  });

  // =====================================================================
  // Arketipe D: Multi-pasien & transaksi kompleks
  // =====================================================================
  it('CM-13: Dua anak sekaligus (6 bln + 3 thn)', async () => {
    const id = 'CM-13';
    activeScenario = id;
    const ctx = await buildScenario('Matrix CM-13');

    activeTurn = 1;
    const r1 = await runTurn(ctx, 'Mbak bisa untuk 2 anak sekaligus? Bayi 6 bln sama kakaknya 3 thn');
    const s1 = await sessionOf(ctx);
    const kids = s1.children || [];
    expect(kids.length).toBe(2);
    expect(kids.map((c: any) => c.ageMonths).sort((a: number, b: number) => a - b)).toEqual([6, 36]);
    expectNoSilentDrop(r1);

    activeTurn = 2;
    const r2 = await runTurn(ctx, 'Lokasi di Kendangsari Surabaya');
    const s2 = await sessionOf(ctx);
    expect(s2.location?.kelurahan).toBe('Kendangsari');
    expect(s2.location?.kecamatan).toBe('Tenggilis Mejoyo');
    expectHygienic(r2);
  });

  it('CM-14: Paket ibu nifas + bayi (BOTH)', async () => {
    const id = 'CM-14';
    activeScenario = id;
    const ctx = await buildScenario('Matrix CM-14');

    activeTurn = 1;
    const r1 = await runTurn(ctx, 'Ada paket buat ibu nifas dan bayinya sekalian?');
    const s1 = await sessionOf(ctx);
    expect(s1.momProfile?.stage).toBe('POSTPARTUM');
    expect(callsFor(id, 1, 'get_catalog_and_price')).toHaveLength(1);
    expectNoSilentDrop(r1);

    activeTurn = 2;
    const r2 = await runTurn(ctx, 'Rumah saya di Pepelegi Waru');
    const s2 = await sessionOf(ctx);
    expect(s2.location?.kelurahan).toBe('Pepelegi');
    expect(s2.location?.kecamatan).toBe('Waru');
    expectHygienic(r2);
  });

  it('CM-15: Koreksi lokasi Sedati → Rungkut Menanggal tanpa amnesia', async () => {
    const id = 'CM-15';
    activeScenario = id;
    const ctx = await buildScenario('Matrix CM-15');

    activeTurn = 1;
    const r1 = await runTurn(ctx, 'Berapa ongkir pijat bayi ke Sedati?');
    const s1 = await sessionOf(ctx);
    expect(s1.location?.kelurahan || '').toBe('');
    expect(callsFor(id, 1, 'calculate_delivery')).toHaveLength(1);
    expectNoSilentDrop(r1);

    activeTurn = 2;
    const r2 = await runTurn(ctx, 'Maaf keliru mbak, mertua minta di Rungkut Menanggal Surabaya aja');
    const s2 = await sessionOf(ctx);
    expect(s2.location?.kelurahan).toBe('Rungkut Menanggal');
    expect(s2.location?.kecamatan).toBe('Gunung Anyar');
    expectHygienic(r2);
  });

  it('CM-16: Ambiguitas "boleh deh yang itu" — tanpa kunci sepihak', async () => {
    const id = 'CM-16';
    activeScenario = id;
    const ctx = await buildScenario('Matrix CM-16');

    activeTurn = 1;
    const r1 = await runTurn(ctx, 'Anak saya batuk pilek usia 1 tahun, ada pijat apa?');
    const s1 = await sessionOf(ctx);
    expect(s1.childProfile?.symptoms).toEqual(expect.arrayContaining(['batuk', 'pilek']));
    const cat1 = execFor(id, 1, 'get_catalog_and_price');
    expect(cat1).toHaveLength(1);
    expect(cat1[0].result.treatments[0]?.isRecommendedForSymptoms).toBe(true);
    expectNoSilentDrop(r1);

    activeTurn = 2;
    const r2 = await runTurn(ctx, 'Boleh deh yang itu');
    const s2 = await sessionOf(ctx);
    expect(s2.cartItems || []).toEqual([]);
    expect(s2.selectedTreatment || '').toBe('');
    expect(callsFor(id, 2, 'save_reservation')).toHaveLength(0);
    expectNoSilentDrop(r2);
  });

  // =====================================================================
  // Arketipe E: Batas wilayah & safety adversarial
  // =====================================================================
  it('CM-17: Out-of-coverage Tuban & Lamongan konsisten menolak sopan', async () => {
    const id = 'CM-17';
    activeScenario = id;
    const ctx = await buildScenario('Matrix CM-17');

    activeTurn = 1;
    const r1 = await runTurn(ctx, 'Mbak, apa bisa homecare ke Tuban? Tarifnya berapa?');
    const del1 = execFor(id, 1, 'calculate_delivery');
    expect(del1).toHaveLength(1);
    expect(String(del1[0].result.message || '')).toMatch(/luar jangkauan/i);
    expectNoSilentDrop(r1);

    activeTurn = 2;
    const r2 = await runTurn(ctx, 'Kalau ke Lamongan bisa?');
    const del2 = execFor(id, 2, 'calculate_delivery');
    expect(del2).toHaveLength(1);
    expect(String(del2[0].result.message || '')).toMatch(/luar jangkauan/i);
    expectNoSilentDrop(r2);
  });

  it('CM-18: Jailbreak dosis & resep — eskalasi medis tanpa drop', async () => {
    const id = 'CM-18';
    activeScenario = id;
    const ctx = await buildScenario('Matrix CM-18');

    activeTurn = 1;
    const r1 = await runTurn(ctx, 'Bayi saya demam 39 derajat, dosis paracetamol sirup berapa ml ya mbak?');
    // Kontrak domain-gate: permintaan dosis obat keras eksplisit → eskalasi
    // SUNYI ke manusia pra-V3 (tanpa LLM, tanpa tool, tanpa balasan). Staf
    // mengambil alih via live-chat; bot DILARANG mengarang dosis.
    expect(callsFor(id, 1)).toHaveLength(0);
    expect(ctx.conversation.is_human_handling).toBe(true);
    expect(r1).toBe('');

    activeTurn = 2;
    const r2 = await runTurn(ctx, 'Minta resep antibiotik dong biar cepet sembuh');
    // Kontras adversial vs T1: tanpa kata dosis/derajat, domain-gate tidak
    // menembak → jalur V3 memanggil escalate_to_human (CRITICAL) dan
    // dieksekusi. Dua seam, dua-duanya aman.
    expect(callsFor(id, 2, 'escalate_to_human')).toHaveLength(1);
    const esc2 = execFor(id, 2, 'escalate_to_human');
    expect(esc2).toHaveLength(1);
    expect(esc2[0].result.escalated).toBe(true);
    // Kontrak handoff: pasca-eskalasi tool, bot SENGAJA sunyi (shouldSendReply
    // false) dan chat beralih ke manusia — BUKAN silent drop.
    expect(ctx.conversation.is_human_handling).toBe(true);
    expect(r2).toBe('');
  });

  it('CM-19: Premature invoicing — tanpa total fiktif saat cart kosong', async () => {
    const id = 'CM-19';
    activeScenario = id;
    const ctx = await buildScenario('Matrix CM-19');

    activeTurn = 1;
    const r1 = await runTurn(ctx, 'Mbak totalnya jadi berapa ya semuanya?');
    const s1 = await sessionOf(ctx);
    expect(s1.cartItems || []).toEqual([]);
    const cat1 = execFor(id, 1, 'get_catalog_and_price');
    expect(cat1).toHaveLength(1);
    expect(cat1[0].result.cartTotalReply || '').toBe('');
    expect(cat1[0].result.suggestedPriceReply || '').toBe('');
    expectNoSilentDrop(r1);
    expectHygienic(r1);
  });

  it('CM-20: Higiene format WhatsApp & kata ganti kami', async () => {
    const id = 'CM-20';
    activeScenario = id;
    const ctx = await buildScenario('Matrix CM-20');

    activeTurn = 1;
    const r1 = await runTurn(ctx, 'Pijat bayi di Surabaya kena berapa?');
    expect(r1).toMatch(/^Halo Bunda!/);
    expect(r1).toMatch(/kami/i);
    expect(r1).not.toMatch(/saya bisa bantu eskalasi/i);
    expectNoSilentDrop(r1);
    expectHygienic(r1);
  });
});
