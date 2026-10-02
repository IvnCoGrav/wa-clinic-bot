import { COPILOT_TOOLS, getCopilotTool, CopilotToolResult } from './copilot-tools';
import { getWibDayName, formatWibDateYYYYMMDD, wibDayBoundsUtc } from '../../utils/wib-time';
import { parsePositiveInt } from '../../utils/env-numeric';
import { requestHermesRouter, requestHermesSummarize, resolveHermesConfig } from './hermes-adapter';

/**
 * copilot.service.ts (Fase 6r + fixing plan) — AI Clinic Copilot in-system.
 *
 * Kontrak fondasional (anti-halusinasi):
 * - LLM memilih tool + args (JSON), lalu tool query DB. Jawaban WAJIB grounded pada hasil tool.
 * - Jika tool mengembalikan [] → paksa jawaban "tidak ditemukan" (template), BUKAN mengarang.
 * - Validator pasca-jawaban: nama customer yang disebut di jawaban WAJIB subset nama di hasil tool.
 * - Budget token & cap history.
 * - Jangkar waktu WIB disuntik ke prompt (date anchor) agar kata relatif ("besok") teresolusi.
 */

export interface CopilotChatParams {
  tenantId: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /**
   * Konteks pasien yang sedang dibuka admin di Live Chat. Dipakai agar pertanyaan
   * deiktik ("pasien ini siapa?", "riwayat dia apa?") ter-grounding tanpa admin
   * mengetik ulang nama/nomor. ID selalu divalidasi ulang tenant-scoped oleh tool.
   */
  activeContext?: { customerId?: string; conversationId?: string };
}

export interface CopilotChatResult {
  success: boolean;
  answer: string;
  toolsUsed: string[];
  grounded: boolean;
  /** Observabilitas: jumlah panggilan LLM (router + summarize) — untuk uji budget. */
  llmCalls?: number;
  /** Observabilitas/audit: jumlah baris per tool yang dieksekusi. */
  rowCounts?: Record<string, number>;
  error?: string;
  /**
   * Observabilitas engine (untuk uji Hermes): engine yang dikonfigurasi turn ini.
   * `hermesFallback=true` berarti engine=hermes tetapi ada panggilan Hermes yang
   * gagal sehingga LLM internal dipakai — jawaban tetap valid, namun BUKAN bukti
   * Hermes bekerja (lihat panduan uji).
   */
  engine: 'hermes' | 'internal';
  hermesFallback?: boolean;
}

const MAX_HISTORY_TURNS = 10;
/** Budget loop multi-step (gerbang kode, bukan imbauan): cegah biaya/latensi meledak. */
export const MAX_ITERATIONS = 3;
export const MAX_TOTAL_ROWS = 40;
/**
 * Budget wall-clock (ms) untuk SATU turn Copilot (semua router + summarize).
 *
 * Akar masalah "Gagal menghubungi Copilot": loop multi-step memanggil sampai 4 LLM
 * sekuensial; tiap attempt boleh berjalan `cfg.timeoutMs` (env `LLM_TIMEOUT_CHAT_MS`,
 * default 120 dtk). Tanpa anggaran global, total bisa > 120 dtk sementara POST
 * frontend abort di 15 dtk → admin melihat kegagalan walau backend masih bekerja.
 * Gerbang ini memastikan jawaban (atau degradasi jujur) kembali SEBELUM timeout
 * klien. Override via env `COPILOT_TOTAL_BUDGET_MS`.
 *
 * Nilai 120 dtk: otak Hermes (agent framework) menelan overhead prompt besar
 * (±16k token) sehingga loop 3 panggilan (2 router + 1 summarize) bisa 15–60 dtk.
 * Dengan 60 dtk, turn berat sering berakhir sebagai jawaban degradasi. Frontend
 * memakai timeout 125 dtk (margin di atas anggaran ini).
 */
export const DEFAULT_TOTAL_BUDGET_MS = 120_000;
/** Sisa anggaran minimum untuk memulai panggilan LLM berikutnya (hindari call 1 dtk). */
const MIN_CALL_BUDGET_MS = 1_500;

/** Pola UUID teknis internal (mis. customerId/reservationId) yang DILARANG bocor ke admin. */
const INTERNAL_UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Gerbang kode deterministik: buang field ID teknis internal dari baris SEBELUM
 * dikirim ke LLM. Prompt "jangan tampilkan UUID" saja tidak cukup — sumber kebocoran
 * ditutup di hulu (baris), bukan diserahkan pada kepatuhan teks LLM.
 */
export function stripInternalIds(rows: any[]): any[] {
  return rows.map((r) => {
    const clone = { ...r };
    delete clone.customerId;
    delete clone.id;
    return clone;
  });
}

/**
 * Normalizer output deterministik: buang sisa UUID yang mungkin lolos dari LLM dan
 * rapikan spasi. Prompt hanya lapis sekunder; ini gerbang kode.
 */
export function sanitizeCopilotAnswer(answer: string): string {
  return answer
    .replace(INTERNAL_UUID_RE, '')
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .trim();
}

/**
 * Normalizer deterministik tautan Live Chat (KNOWN_ISSUES #191e-a).
 *
 * Akar: otak Hermes (agent framework) kadang menyalin placeholder
 * `conversationId=` tanpa mengisi nilainya dari data tool. Prompt saja tidak
 * cukup (LLM probabilistik). Gerbang ini mengisi HANYA bila tidak ambigu:
 *  - link kosong + tepat SATU conversationId unik di baris → isi id itu;
 *  - else bila segmen teks sebelum link memuat tepat satu nama customer yang
 *    unik di baris → isi id baris tersebut;
 *  - else biarkan kosong (JANGAN mengarang) + warning.
 */
export function repairCopilotChatLinks(answer: string, rows: any[]): string {
  if (!answer || typeof answer !== 'string') return answer;
  const distinctConvIds = [
    ...new Set(
      (rows || [])
        .map((r) => r?.conversationId)
        .filter((v) => typeof v === 'string' && v.trim().length > 0)
    ),
  ] as string[];
  const nameToId = new Map<string, string>();
  const idCountByLowerName = new Map<string, number>();
  for (const r of rows || []) {
    const name = (r?.customerName || '').toString().toLowerCase().replace(/\b(bunda|ibu|mbak|bu|kak)\b/gi, ' ').trim();
    const id = r?.conversationId;
    if (name && typeof id === 'string' && id.trim()) {
      nameToId.set(name, id);
      idCountByLowerName.set(name, (idCountByLowerName.get(name) || 0) + 1);
    }
  }

  const linkRe = /\[([^\]]+)\]\(\/admin\/live-chat\?conversationId=([^)]*)\)/g;
  return answer.replace(linkRe, (full, label: string, convId: string, offset: number) => {
    if (convId && convId.trim()) return full; // sudah terisi — jangan sentuh
    // 1. Unik deterministik: tepat satu conversationId di data.
    if (distinctConvIds.length === 1) {
      return `[${label}](/admin/live-chat?conversationId=${distinctConvIds[0]})`;
    }
    // 2. Kaitkan nama unik TERDEKAT sebelum link (bukan yang pertama cocok —
    //    daftar bernomor: nama baris ini muncul paling dekat dengan link-nya).
    if (nameToId.size > 0) {
      const before = answer.slice(Math.max(0, offset - 200), offset).toLowerCase();
      let best: { name: string; id: string; pos: number } | null = null;
      for (const [name, id] of nameToId.entries()) {
        if (idCountByLowerName.get(name) !== 1) continue;
        const nameTokens = name.match(/[a-z]{3,}/g) || [];
        if (nameTokens.length === 0) continue;
        const positions = nameTokens.map((t) => before.lastIndexOf(t));
        if (positions.some((p) => p < 0)) continue;
        const pos = Math.min(...positions);
        if (!best || pos > best.pos) best = { name, id, pos };
      }
      if (best) {
        return `[${label}](/admin/live-chat?conversationId=${best.id})`;
      }
    }
    // 3. Ambigu → biarkan kosong, catat (jangan karang link menyesatkan).
    console.warn(JSON.stringify({ event: 'COPILOT_LINK_UNREPAIRABLE', label, candidates: distinctConvIds.length }));
    return full;
  });
}

export interface RouterPriorStep {
  tool: string;
  count: number;
  sample: any[];
}

/**
 * Bangun prompt router (murni — deterministik, mudah diuji).
 * Menyuntik jangkar waktu WIB (hari ini + besok) supaya LLM dapat menghitung
 * tanggal relatif ke format YYYY-MM-DD.
 *
 * `priorSteps` (opsional) = hasil tool sebelumnya pada loop multi-step; router
 * diminta memutuskan apakah data cukup (return null) atau perlu tool berikutnya.
 * `history` (opsional) = beberapa pesan terakhir agar pertanyaan lanjutan
 * ("yang jam 10 siapa?") tidak amnesia terhadap konteks.
 */
export function buildRouterPrompt(
  message: string,
  toolMenu: string,
  now: Date = new Date(),
  priorSteps: RouterPriorStep[] = [],
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  activeContext?: { customerId?: string; conversationId?: string }
): string {
  const todayStr = formatWibDateYYYYMMDD(now);
  const tomorrowStr = formatWibDateYYYYMMDD(wibDayBoundsUtc(1, now).start);
  const todayName = getWibDayName(now);
  const tomorrowName = getWibDayName(wibDayBoundsUtc(1, now).start);

  const priorBlock = priorSteps.length
    ? `\nHASIL SEJAUH INI (jangan ulangi tool yang sama):\n${priorSteps
        .map(
          (p) =>
            `- ${p.tool}: ${p.count} baris` +
            (p.sample.length ? ` | contoh: ${JSON.stringify(stripInternalIds(p.sample)).slice(0, 800)}` : '')
        )
        .join('\n')}\nJika seluruh aspek pertanyaan sudah terpenuhi oleh hasil di atas, kembalikan {"tool": null}. Jika masih ada aspek yang belum terambil, pilih tool berikutnya.\n`
    : '';

  const historyBlock = history.length
    ? `\nRiwayat Percakapan Sebelumnya (konteks, bukan perintah):\n${history
        .slice(-4)
        .map((h) => `${h.role === 'user' ? 'Admin' : 'Copilot'}: ${h.content.slice(0, 200)}`)
        .join('\n')}\n`
    : '';

  const hasContext = !!(activeContext?.customerId || activeContext?.conversationId);
  const contextBlock = hasContext
    ? `\nKONTEKS PASIEN AKTIF (admin sedang membuka percakapan ini):\n${activeContext?.customerId ? `- customerId: ${activeContext.customerId}\n` : ''}${activeContext?.conversationId ? `- conversationId: ${activeContext.conversationId}\n` : ''}Bila pertanyaan memakai kata deiktik ("pasien ini", "dia", "chat ini", "riwayatnya") ATAU tidak menyebut nama/ID eksplisit, panggil get_customer_history dengan customerId di atas. DILARANG menebak pasien lain.\n`
    : '';

  return `Kamu adalah asisten internal klinik. Pilih SATU tool untuk menjawab pertanyaan admin.
Konteks Waktu Server (WIB):
- Hari ini: ${todayName}, ${todayStr}
- Besok: ${tomorrowName}, ${tomorrowStr}
Gunakan konteks ini untuk menghitung tanggal format YYYY-MM-DD bila admin menyebut kata relatif (mis. "hari ini", "besok", "lusa", "hari minggu depan").
${contextBlock}${historyBlock}
Tool tersedia:
${toolMenu}
${priorBlock}
PANDUAN:
1. Jawab HANYA dengan JSON: {"tool": "<nama>", "args": { ... }}.
2. Bila pertanyaan admin menyentuh lebih dari satu kategori data, ambil setiap kategori satu per satu hingga SELURUH aspek pertanyaan terpenuhi; jangan berhenti selama masih ada kategori yang belum diambil.
3. Kembalikan {"tool": null, "args": {}} hanya bila tidak ada tool yang cocok atau semua aspek pertanyaan sudah terpenuhi oleh hasil sejauh ini.
Pertanyaan admin: "${message}"`;
}

/**
 * Bangun jawaban degradasi jujur dari data yang SUDAH terkumpul — dipakai ketika
 * anggaran waktu habis sebelum summarize. Deterministik (tanpa LLM) sehingga TIDAK
 * bisa berhalusinasi: hanya menyalin nama + field dari baris tool nyata.
 */
export function buildDegradedAnswer(collected: Array<{ tool: string; rows: any[] }>): string {
  const sections: string[] = [];
  for (const c of collected) {
    if (!c.rows.length) continue;
    const shown = c.rows.slice(0, 10).map((r) => {
      const name = r.customerName || r.title || r.name || '—';
      const bits: string[] = [];
      if (r.bookingDate) bits.push(String(r.bookingDate));
      if (r.treatment) bits.push(String(r.treatment));
      if (r.status) bits.push(String(r.status));
      if (r.staff) bits.push(String(r.staff));
      if (r.requestedTime) bits.push(`minta ${r.requestedTime}`);
      if (r.offeredTime) bits.push(`ditawari ${r.offeredTime}`);
      if (typeof r.waitingMinutes === 'number') bits.push(formatWaitTime(r.waitingMinutes));
      if (r.lastMessage) bits.push(`"${String(r.lastMessage).slice(0, 60)}"`);
      return `- ${name}${bits.length ? ` — ${bits.join(' · ')}` : ''}`;
    });
    const more = c.rows.length > shown.length ? `\n- … (${c.rows.length - shown.length} baris lain)` : '';
    sections.push(`*${c.tool}*\n${shown.join('\n')}${more}`);
  }
  if (!sections.length) {
    return 'Permintaan terlalu lama diproses (batas waktu). Coba persempit pertanyaan (mis. sebutkan tanggal atau nama pasien).';
  }
  return `⏱️ Jawaban diambil sebagian karena batas waktu pemrosesan. Data mentah dari database:\n\n${sections.join('\n\n')}`;
}

/** Penanda error khusus batas waktu Copilot (bukan kegagalan LLM nyata). */
const COPILOT_DEADLINE_ERROR = 'COPILOT_DEADLINE_EXCEEDED';

/** Gaya ringkasan Copilot yang bersumber dari DB per-tenant (bukan hardcode). */
export interface CopilotStyleConfig {
  summarizeTone: string;
}

/**
 * Bangun prompt ringkasan (murni, deterministik, mudah diuji).
 *
 * Gaya bahasa (`styleTone`) DISUNTIK dari DB per-tenant bila tersedia; jika null,
 * dipakai default netral. Kontrak link Live Chat WAJIB kanonis
 * `/admin/live-chat?conversationId=` — BUKAN format hash lama `/#/livechat`
 * (renderer `AdminCopilotPanel` hanya mengaktifkan tautan kanonis).
 */
export function buildSummarizePrompt(
  message: string,
  labeledRows: string,
  styleTone: string | null
): string {
  const tone = styleTone && styleTone.trim() ? styleTone.trim() : 'ringkas, profesional, langsung ke inti, tanpa basa-basi.';
  return `Berikut data riil dari database (JSON) dari beberapa sumber untuk menjawab pertanyaan admin: "${message}".
Rangkum dalam bahasa Indonesia dengan gaya berikut (WAJIB dipatuhi): ${tone}
Ketentuan struktur:
1. Kelompokkan data secara terstruktur bila ada beberapa kategori berbeda (mis. sudah terjadwal vs belum masuk sistem / menunggu konfirmasi). Header kelompok WAJIB jelas.
2. DILARANG menambah nama, nomor HP, atau jadwal yang TIDAK ada di data.
3. DILARANG mencantumkan ID teknis internal (customerId/UUID).
4. Bila ada waktu tunggu (waitingMinutes), ubah menjadi bahasa manusiawi (mis. "menunggu 15 menit", "sekitar 2 jam").
5. Bila ada field "offeredTime", sebutkan "sudah ditawari <offeredTime>".
6. Jika (dan hanya jika) ada field "conversationId" pada data, sertakan tautan Live Chat dengan format markdown persis: [Buka Chat](/admin/live-chat?conversationId=CONVERSATION_ID).
7. Untuk pedoman medis/SOP/katalog, kutip HANYA dari baris berlabel sumber dan sebutkan judul sumbernya; JANGAN mengarang angka (harga, durasi, ketersediaan slot) yang tidak ada di data.
Data:
${labeledRows.slice(0, 8000)}`;
}

/** Ubah menit tunggu jadi frasa manusia (deterministik, tanpa LLM). */
export function formatWaitTime(minutes: number): string {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m < 0) return 'baru saja';
  if (m < 60) return `${Math.floor(m)} menit`;
  const hours = Math.floor(m / 60);
  if (hours < 24) return `${hours} jam`;
  const days = Math.floor(hours / 24);
  return `${days} hari`;
}

/**
 * Ambil nada ringkasan Copilot dari DB per-tenant. Sumber kebenaran:
 * `Tenant.settings.copilot.styleTone` (tanpa migrasi schema — `settings` sudah Json).
 * Gagal/DB offline → null senyap (prompt memakai default netral). Bukan hardcode bisnis.
 */
export async function loadCopilotStyle(tenantId: string): Promise<CopilotStyleConfig | null> {
  try {
    const { prisma } = await import('../../db/client');
    const tenant = await (prisma as any).tenant?.findUnique?.({
      where: { id: tenantId },
      select: { settings: true },
    });
    const tone = tenant?.settings?.copilot?.styleTone;
    if (typeof tone === 'string' && tone.trim()) return { summarizeTone: tone.trim() };
    return null;
  } catch {
    return null;
  }
}

/**
 * Jalankan promise LLM dengan batas waktu keras (wall-clock). Berbeda dari
 * `timeoutMs` per-attempt (yang bisa diakumulasi retry + fallback lintas-provider),
 * gerbang ini menjamin total tunggu TIDAK melewati deadline turn — sehingga respons
 * selalu kembali sebelum timeout klien. Promise yang kalah tetap "dibuang" aman
 * (catch diattach) agar tidak memicu unhandled rejection.
 */
export function withDeadline<T>(factory: () => Promise<T>, ms: number): Promise<T> {
  const p = factory();
  p.catch(() => {
    /* hasil yang datang setelah deadline dibuang; jangan unhandled-reject */
  });
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(COPILOT_DEADLINE_ERROR)), Math.max(1, ms));
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export function isCopilotDeadlineError(err: any): boolean {
  return err?.message === COPILOT_DEADLINE_ERROR;
}

export class CopilotService {
  public async chat(params: CopilotChatParams): Promise<CopilotChatResult> {
    const { tenantId, message } = params;
    const history = (params.history || []).slice(-MAX_HISTORY_TURNS);
    const totalBudgetMs = parsePositiveInt(process.env.COPILOT_TOTAL_BUDGET_MS, DEFAULT_TOTAL_BUDGET_MS);
    const deadline = Date.now() + totalBudgetMs;
    const remainingMs = () => deadline - Date.now();
    // Ambang minimal proporsional: pada anggaran normal = MIN_CALL_BUDGET_MS; pada
    // anggaran sangat kecil (uji/adversarial) diperkecil agar loop tetap bisa mulai.
    const minCallBudget = Math.min(MIN_CALL_BUDGET_MS, Math.max(1, Math.floor(totalBudgetMs / 3)));
    /** Batasi timeout LLM ke sisa anggaran (agar attempt tak melewati deadline). */
    const callTimeout = (cfgTimeout: number) => Math.max(minCallBudget, Math.min(cfgTimeout, remainingMs()));
    let timedOut = false;
    // Jejak fallback Hermes → internal (observabilitas uji; lihat interface).
    let hermesFallback = false;
    // resolveHermesConfig murni baca env (tanpa throw) → aman sebelum try.
    const hermesCfg = resolveHermesConfig();
    const useHermes = hermesCfg.engine === 'hermes';
    const engineTag = (): Pick<CopilotChatResult, 'engine' | 'hermesFallback'> => ({
      engine: hermesCfg.engine,
      hermesFallback,
    });

    try {
      const { getLlmEndpointConfig } = await import('../../integrations/llm/llm-gateway');
      const { callChatCompletionsWithFallback } = await import('../../integrations/llm/model-fallback');
      const { extractBalancedJson } = await import('../../utils/json-extract');

      const cfg = getLlmEndpointConfig({ modelConfigKey: 'CHAT_REPLY', tenantId });
      // Gaya ringkasan tenant-aware dari DB (settings) — null = default netral.
      const styleConfig = await loadCopilotStyle(tenantId);
      // Fase 4 (tanpa-MCP): Hermes sebagai otak (router + summarize). Default
      // `internal` → perilaku identik pra-Fase 4; fallback per-panggilan bila
      // Hermes gagal. Tangan (tool) + satpam (grounding/budget/audit) SELALU di sini.
      // (hermesCfg/useHermes/engineTag didefinisikan sebelum try agar semua
      // return termasuk catch memakai jejak engine yang sama.)
      const hermesOpts = {
        baseUrl: hermesCfg.baseUrl,
        secret: hermesCfg.secret,
        mode: hermesCfg.mode,
        openaiUrl: hermesCfg.openaiUrl,
        openaiKey: hermesCfg.openaiKey,
        openaiModel: hermesCfg.openaiModel,
      };

      const toolMenu = COPILOT_TOOLS.map(
        (t) => `- ${t.name}: ${t.description}\n  args: ${JSON.stringify(t.parameters)}`
      ).join('\n');

      // Langkah 1–2 (loop multi-step, budget ketat): router memilih tool → eksekusi →
      // umpan balik hasil ke router berikutnya. Berhenti bila tool:null / iterasi habis /
      // router mengulang tool+args identik. Semua hasil diakumulasi untuk summarize + grounding.
      const collected: Array<{ tool: string; args: Record<string, any>; rows: any[] }> = [];
      const seenSignatures = new Set<string>();
      let llmCalls = 0;
      let totalRows = 0;

      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        // Gerbang anggaran: hentikan loop bila waktu tersisa terlalu tipis untuk
        // satu panggilan LLM lagi (cegah request melewati deadline klien).
        if (remainingMs() < minCallBudget) break;

        const priorSteps: RouterPriorStep[] = collected.map((c) => ({
          tool: c.tool,
          count: c.rows.length,
          sample: c.rows.slice(0, 3),
        }));
        const routerPrompt = buildRouterPrompt(message, toolMenu, new Date(), priorSteps, history, params.activeContext);

        // Fase 6 (#191e-b): observabilitas biaya prompt — ukur bagian yang KITA
        // kendalikan (menu tool + histori + prior) vs overhead framework Hermes
        // (±16k token di sisi :8642, di luar kendali repo). Estimasi ~4 char/token.
        try {
          console.log(JSON.stringify({
            event: 'COPILOT_PROMPT_SIZE',
            kind: 'router',
            iteration,
            chars: routerPrompt.length,
            estTokens: Math.ceil(routerPrompt.length / 4),
            toolMenuChars: toolMenu.length,
            historyTurns: history.length,
            priorSteps: priorSteps.length,
          }));
        } catch {}

        llmCalls++;
        let toolName: string | null = null;
        let toolArgs: Record<string, any> = {};
        let hermesRouted = false;
        // Jalur Hermes dulu (bila aktif); gagal → jatuh ke router internal di bawah.
        if (useHermes) {
          try {
            const d = await requestHermesRouter(routerPrompt, {
              ...hermesOpts,
              timeoutMs: callTimeout(cfg.timeoutMs),
            });
            if (d) {
              toolName = d.tool;
              toolArgs = d.args;
              hermesRouted = true;
            }
          } catch {
            hermesRouted = false;
          }
        }
        if (!hermesRouted) {
          // Jejak uji: engine=hermes tetapi router jatuh ke internal.
          if (useHermes) hermesFallback = true;
          let routerResp: any;
          try {
            routerResp = await withDeadline(
              () =>
                callChatCompletionsWithFallback({
                  model: cfg.model,
                  fallbackModel: cfg.fallbackModel,
                  baseUrl: cfg.baseUrl,
                  apiKey: cfg.apiKey,
                  timeoutMs: callTimeout(cfg.timeoutMs),
                  payload: {
                    messages: [{ role: 'user', content: routerPrompt }],
                    temperature: 0,
                    max_tokens: 200,
                  },
                }),
              remainingMs()
            );
          } catch (e: any) {
            if (isCopilotDeadlineError(e)) {
              timedOut = true;
              break; // anggaran habis → keluar loop, degradasi di bawah
            }
            throw e;
          }

          const rawRouter = routerResp?.data?.choices?.[0]?.message?.content || '';
          const parsed = extractBalancedJson(rawRouter, 'tool');
          if (parsed) {
            try {
              const obj = JSON.parse(parsed);
              toolName = obj.tool || null;
              toolArgs = obj.args || {};
            } catch {
              toolName = null;
            }
          }
        }

        if (!toolName) break; // data cukup / tak ada tool cocok → keluar loop

        const tool = getCopilotTool(toolName);
        if (!tool) {
          // Tool tak dikenal (halusinasi nama tool) → hentikan loop, jangan lempar.
          if (collected.length === 0) {
            return { success: false, answer: 'Tool tidak dikenali.', toolsUsed: [], grounded: false, error: 'UNKNOWN_TOOL', llmCalls, ...engineTag() };
          }
          break;
        }

        const signature = `${tool.name}:${JSON.stringify(toolArgs)}`;
        if (seenSignatures.has(signature)) break; // anti-loop: tool+args identik
        seenSignatures.add(signature);

        const toolResult: CopilotToolResult = await tool.run(tenantId, toolArgs);
        collected.push({ tool: tool.name, args: toolArgs, rows: toolResult.rows || [] });
        totalRows += (toolResult.rows || []).length;

        // Budget baris: hentikan loop bila kuota konteks habis.
        if (totalRows >= MAX_TOTAL_ROWS) break;
      }

      const toolsUsed = collected.map((c) => c.tool);
      const unionRows = collected.flatMap((c) => c.rows);
      // Observabilitas audit: jumlah baris per tool (dipakai payload AuditLog).
      const rowCounts: Record<string, number> = {};
      for (const c of collected) rowCounts[c.tool] = c.rows.length;

      // Gerbang anggaran (prioritas tertinggi): bila deadline tersentuh, kembalikan
      // jawaban degradasi deterministik dari baris yang sudah dikumpulkan — jangan
      // menembak LLM yang pasti melewati deadline klien.
      if (timedOut) {
        if (collected.length === 0) {
          return {
            success: false,
            answer: 'Copilot melebihi batas waktu sebelum sempat mengambil data. Coba lagi atau persempit pertanyaan.',
            toolsUsed: [],
            grounded: false,
            error: COPILOT_DEADLINE_ERROR,
            llmCalls,
            rowCounts,
            ...engineTag(),
          };
        }
        return {
          success: true,
          answer: buildDegradedAnswer(collected),
          toolsUsed,
          grounded: true,
          llmCalls,
          rowCounts,
          ...engineTag(),
        };
      }

      // Tak ada data terkumpul → jawab jujur (anti-halusinasi), jangan panggil summarize.
      if (unionRows.length === 0) {
        return {
          success: true,
          answer:
            toolsUsed.length > 0
              ? 'Tidak ditemukan data untuk kriteria tersebut.'
              : 'Maaf, saya tidak menemukan data yang cocok untuk pertanyaan itu. Coba sebutkan tanggal atau nama pasien secara spesifik ya.',
          toolsUsed,
          grounded: true,
          llmCalls,
          rowCounts,
          ...engineTag(),
        };
      }

      // Gerbang anggaran: bila sisa waktu tak cukup untuk summarize, sajikan data
      // mentah (degradasi jujur) daripada menembak LLM yang melewati deadline.
      if (remainingMs() < minCallBudget) {
        return {
          success: true,
          answer: buildDegradedAnswer(collected),
          toolsUsed,
          grounded: true,
          llmCalls,
          rowCounts,
          ...engineTag(),
        };
      }

      // Langkah 3: LLM merangkum gabungan hasil tool (berlabel sumber).
      // Baris dibersihkan dari ID internal (UUID) SEBELUM ke LLM — gerbang kode, bukan imbauan prompt.
      const labeled = collected
        .map((c) => `[${c.tool}] ${JSON.stringify(stripInternalIds(c.rows)).slice(0, 3000)}`)
        .join('\n');
      const summarizePrompt = buildSummarizePrompt(message, labeled, styleConfig?.summarizeTone ?? null);

      // Fase 6 (#191e-b): ukur ukuran prompt summarize (data rows + gaya).
      try {
        console.log(JSON.stringify({
          event: 'COPILOT_PROMPT_SIZE',
          kind: 'summarize',
          chars: summarizePrompt.length,
          estTokens: Math.ceil(summarizePrompt.length / 4),
          labeledRowsChars: labeled.length,
          toolsUsed: collected.map((c) => c.tool),
        }));
      } catch {}

      llmCalls++;
      // Jalur Hermes dulu (bila aktif); gagal → jatuh ke summarize internal di bawah.
      let hermesSummary: string | null = null;
      if (useHermes) {
        try {
          hermesSummary = await requestHermesSummarize(summarizePrompt, {
            ...hermesOpts,
            timeoutMs: callTimeout(cfg.timeoutMs),
          });
        } catch {
          hermesSummary = null;
        }
      }
      let rawAnswer: string;
      if (hermesSummary) {
        rawAnswer = hermesSummary.trim() || 'Tidak ada ringkasan.';
      } else {
        // Jejak uji: engine=hermes tetapi summarize jatuh ke internal.
        if (useHermes) hermesFallback = true;
        let summaryResp: any;
        try {
          summaryResp = await withDeadline(
            () =>
              callChatCompletionsWithFallback({
                model: cfg.model,
                fallbackModel: cfg.fallbackModel,
                baseUrl: cfg.baseUrl,
                apiKey: cfg.apiKey,
                timeoutMs: callTimeout(cfg.timeoutMs),
                payload: {
                  messages: [
                    ...history.map((h) => ({ role: h.role, content: h.content })),
                    { role: 'user', content: summarizePrompt },
                  ],
                  temperature: 0.2,
                  max_tokens: 400,
                },
              }),
            remainingMs()
          );
        } catch (e: any) {
          // Batas waktu pada tahap ringkasan → tetap sajikan data mentah (degradasi jujur),
          // bukan pesan "layanan AI gangguan" yang menyesatkan.
          if (isCopilotDeadlineError(e)) {
            return {
              success: true,
              answer: buildDegradedAnswer(collected),
              toolsUsed,
              grounded: true,
              llmCalls,
              rowCounts,
              ...engineTag(),
            };
          }
          throw e;
        }

        rawAnswer = summaryResp?.data?.choices?.[0]?.message?.content?.trim() || 'Tidak ada ringkasan.';
      }
      // Normalizer deterministik: buang sisa UUID yang lolos dari LLM, lalu
      // perbaiki tautan Live Chat kosong dari data tool (anti link menyesatkan).
      const answer = repairCopilotChatLinks(sanitizeCopilotAnswer(rawAnswer), unionRows);

      // Validator grounding atas UNION semua hasil tool (halusinasi silang-sumber).
      const grounded = this.validateGrounding(answer, unionRows);

      return { success: true, answer, toolsUsed, grounded, llmCalls, rowCounts, ...engineTag() };
    } catch (err: any) {
      return {
        success: false,
        answer: 'Copilot sedang tidak tersedia (gangguan layanan AI). Silakan coba lagi.',
        toolsUsed: [],
        ...engineTag(),
        grounded: false,
        error: err?.message || String(err),
      };
    }
  }

  /**
   * Validator grounding deterministik: nama customer yang muncul di jawaban
   * harus berasal dari hasil tool (anti-halusinasi nama).
   *
   * Normalisasi: buang honorifik (Bunda/Ibu/Mbak/Bu/Kak/…) lalu cocokkan
   * per-token (≥3 huruf) — toleran beda honorifik & kapitalisasi.
   * Catatan: `chat()` sudah short-circuit saat rows kosong, jadi cabang
   * `rows.length === 0` di sini tidak pernah tercapai dari jalur utama.
   */
  public validateGrounding(answer: string, rows: any[]): boolean {
    if (!rows || rows.length === 0) return true;

    const knownTokens = new Set<string>();
    for (const r of rows) {
      const raw = (r.customerName || '').toString().toLowerCase();
      const cleaned = raw.replace(/\b(bunda|ibu|mbak|bu|kak|ny|tante)\b/gi, ' ');
      const parts = cleaned.match(/[a-z]{3,}/g) || [];
      for (const p of parts) knownTokens.add(p);
    }
    if (knownTokens.size === 0) return true;

    const unknown = (namePart: string) => {
      const n = namePart.trim().toLowerCase();
      return n.length >= 3 && !knownTokens.has(n);
    };

    // 1. Sebutan pasien dengan honorifik, mis. "Bunda Risma", "Ibu Dara".
    const honorificMatches = answer.match(/(?:Bunda|Ibu|Mbak|Bu|Kak)\s+([A-Za-z]+)/gi) || [];
    for (const m of honorificMatches) {
      const namePart = m.replace(/^(?:Bunda|Ibu|Mbak|Bu|Kak)\s+/i, '');
      if (unknown(namePart)) return false;
    }

    // 2. Label nama eksplisit, mis. "**Nama Pelanggan**: Dinda", "Nama Pasien: Siti".
    //    Ketat: hanya label "Nama Pelanggan"/"Nama Pasien" + token kapital (bukan kata umum).
    const labelRe = /(?:Nama\s+Pelanggan|Nama\s+Pasien)\s*[:*]+\s*\**\s*([A-Z][a-zA-Z]+)/g;
    let lm: RegExpExecArray | null;
    while ((lm = labelRe.exec(answer)) !== null) {
      if (unknown(lm[1])) return false;
    }

    return true;
  }
}

export const copilotService = new CopilotService();
