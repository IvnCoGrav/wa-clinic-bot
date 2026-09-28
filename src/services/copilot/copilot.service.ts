import { COPILOT_TOOLS, getCopilotTool, CopilotToolResult } from './copilot-tools';
import { getWibDayName, formatWibDateYYYYMMDD, wibDayBoundsUtc } from '../../utils/wib-time';

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
}

const MAX_HISTORY_TURNS = 10;
/** Budget loop multi-step (gerbang kode, bukan imbauan): cegah biaya/latensi meledak. */
export const MAX_ITERATIONS = 3;
export const MAX_TOTAL_ROWS = 40;

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
  history: Array<{ role: 'user' | 'assistant'; content: string }> = []
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

  return `Kamu adalah asisten internal klinik. Pilih SATU tool untuk menjawab pertanyaan admin.
Konteks Waktu Server (WIB):
- Hari ini: ${todayName}, ${todayStr}
- Besok: ${tomorrowName}, ${tomorrowStr}
Gunakan konteks ini untuk menghitung tanggal format YYYY-MM-DD bila admin menyebut kata relatif (mis. "hari ini", "besok", "lusa", "hari minggu depan").
${historyBlock}
Tool tersedia:
${toolMenu}
${priorBlock}
PANDUAN:
1. Jawab HANYA dengan JSON: {"tool": "<nama>", "args": { ... }}.
2. Bila pertanyaan admin menyentuh lebih dari satu kategori data, ambil setiap kategori satu per satu hingga SELURUH aspek pertanyaan terpenuhi; jangan berhenti selama masih ada kategori yang belum diambil.
3. Kembalikan {"tool": null, "args": {}} hanya bila tidak ada tool yang cocok atau semua aspek pertanyaan sudah terpenuhi oleh hasil sejauh ini.
Pertanyaan admin: "${message}"`;
}

export class CopilotService {
  public async chat(params: CopilotChatParams): Promise<CopilotChatResult> {
    const { tenantId, message } = params;
    const history = (params.history || []).slice(-MAX_HISTORY_TURNS);

    try {
      const { getLlmEndpointConfig } = await import('../../integrations/llm/llm-gateway');
      const { callChatCompletionsWithFallback } = await import('../../integrations/llm/model-fallback');
      const { extractBalancedJson } = await import('../../utils/json-extract');

      const cfg = getLlmEndpointConfig({ modelConfigKey: 'CHAT_REPLY', tenantId });

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
        const priorSteps: RouterPriorStep[] = collected.map((c) => ({
          tool: c.tool,
          count: c.rows.length,
          sample: c.rows.slice(0, 3),
        }));
        const routerPrompt = buildRouterPrompt(message, toolMenu, new Date(), priorSteps, history);

        llmCalls++;
        const routerResp = await callChatCompletionsWithFallback({
          model: cfg.model,
          fallbackModel: cfg.fallbackModel,
          baseUrl: cfg.baseUrl,
          apiKey: cfg.apiKey,
          timeoutMs: cfg.timeoutMs,
          payload: {
            messages: [{ role: 'user', content: routerPrompt }],
            temperature: 0,
            max_tokens: 200,
          },
        });

        const rawRouter = routerResp?.data?.choices?.[0]?.message?.content || '';
        const parsed = extractBalancedJson(rawRouter, 'tool');
        let toolName: string | null = null;
        let toolArgs: Record<string, any> = {};
        if (parsed) {
          try {
            const obj = JSON.parse(parsed);
            toolName = obj.tool || null;
            toolArgs = obj.args || {};
          } catch {
            toolName = null;
          }
        }

        if (!toolName) break; // data cukup / tak ada tool cocok → keluar loop

        const tool = getCopilotTool(toolName);
        if (!tool) {
          // Tool tak dikenal (halusinasi nama tool) → hentikan loop, jangan lempar.
          if (collected.length === 0) {
            return { success: false, answer: 'Tool tidak dikenali.', toolsUsed: [], grounded: false, error: 'UNKNOWN_TOOL', llmCalls };
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
        };
      }

      // Langkah 3: LLM merangkum gabungan hasil tool (berlabel sumber).
      // Baris dibersihkan dari ID internal (UUID) SEBELUM ke LLM — gerbang kode, bukan imbauan prompt.
      const labeled = collected
        .map((c) => `[${c.tool}] ${JSON.stringify(stripInternalIds(c.rows)).slice(0, 3000)}`)
        .join('\n');
      const summarizePrompt = `Berikut data riil dari database (JSON) dari beberapa sumber untuk menjawab pertanyaan admin: "${message}".
Rangkum dalam bahasa Indonesia yang rapi, profesional, dan mudah dibaca oleh tim admin klinik:
1. Kelompokkan data secara terstruktur bila ada beberapa kategori berbeda (mis. sudah terjadwal vs belum terjadwal / menunggu konfirmasi).
2. DILARANG menambah nama, nomor HP, atau jadwal yang TIDAK ada di data.
3. DILARANG mencantumkan ID teknis internal (customerId/UUID).
4. Bila ada waktu tunggu (waitingMinutes), ubah menjadi bahasa manusiawi (mis. "menunggu 15 menit", "sekitar 2 jam").
5. Jika (dan hanya jika) ada field "conversationId" pada data, sertakan tautan Live Chat dengan format markdown persis: [Buka Chat](/admin/live-chat?conversationId=CONVERSATION_ID).
6. Untuk pedoman medis/SOP/katalog, kutip HANYA dari baris berlabel sumber dan sebutkan judul sumbernya; JANGAN mengarang angka (harga, durasi, ketersediaan slot) yang tidak ada di data.
Data:
${labeled.slice(0, 8000)}`;

      llmCalls++;
      const summaryResp = await callChatCompletionsWithFallback({
        model: cfg.model,
        fallbackModel: cfg.fallbackModel,
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        timeoutMs: cfg.timeoutMs,
        payload: {
          messages: [
            ...history.map((h) => ({ role: h.role, content: h.content })),
            { role: 'user', content: summarizePrompt },
          ],
          temperature: 0.2,
          max_tokens: 400,
        },
      });

      const rawAnswer = summaryResp?.data?.choices?.[0]?.message?.content?.trim() || 'Tidak ada ringkasan.';
      // Normalizer deterministik: buang sisa UUID yang lolos dari LLM.
      const answer = sanitizeCopilotAnswer(rawAnswer);

      // Validator grounding atas UNION semua hasil tool (halusinasi silang-sumber).
      const grounded = this.validateGrounding(answer, unionRows);

      return { success: true, answer, toolsUsed, grounded, llmCalls, rowCounts };
    } catch (err: any) {
      return {
        success: false,
        answer: 'Copilot sedang tidak tersedia (gangguan layanan AI). Silakan coba lagi.',
        toolsUsed: [],
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
