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
  error?: string;
}

const MAX_HISTORY_TURNS = 10;
/** Budget loop multi-step (gerbang kode, bukan imbauan): cegah biaya/latensi meledak. */
export const MAX_ITERATIONS = 3;
export const MAX_TOTAL_ROWS = 40;

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
 */
export function buildRouterPrompt(
  message: string,
  toolMenu: string,
  now: Date = new Date(),
  priorSteps: RouterPriorStep[] = []
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
            (p.sample.length ? ` | contoh: ${JSON.stringify(p.sample).slice(0, 800)}` : '')
        )
        .join('\n')}\nJika data sudah cukup untuk menjawab, kembalikan {"tool": null}. Jika masih kurang, pilih tool berikutnya.\n`
    : '';

  return `Kamu adalah asisten internal klinik. Pilih SATU tool untuk menjawab pertanyaan admin.
Konteks Waktu Server (WIB):
- Hari ini: ${todayName}, ${todayStr}
- Besok: ${tomorrowName}, ${tomorrowStr}
Gunakan konteks ini untuk menghitung tanggal format YYYY-MM-DD bila admin menyebut kata relatif (mis. "hari ini", "besok", "lusa", "hari minggu depan").
Tool tersedia:
${toolMenu}
${priorBlock}
Jawab HANYA dengan JSON: {"tool": "<nama>", "args": { ... }}.
Jika tidak ada tool yang cocok atau data sudah cukup, jawab {"tool": null, "args": {}}.
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
        const routerPrompt = buildRouterPrompt(message, toolMenu, new Date(), priorSteps);

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
            return { success: false, answer: 'Tool tidak dikenali.', toolsUsed: [], grounded: false, error: 'UNKNOWN_TOOL' };
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
        };
      }

      // Langkah 3: LLM merangkum gabungan hasil tool (berlabel sumber).
      const labeled = collected
        .map((c) => `[${c.tool}] ${JSON.stringify(c.rows).slice(0, 3000)}`)
        .join('\n');
      const summarizePrompt = `Berikut data riil dari database (JSON) dari beberapa sumber. Rangkum dalam bahasa Indonesia singkat untuk admin.
DILARANG menambah nama, nomor, atau jadwal yang TIDAK ada di data. Bila menyintesis lintas sumber, sebutkan sumbernya secara ringkas.
Jika (dan hanya jika) ada field "conversationId" pada data, sertakan tautan ke Live Chat dengan format markdown persis: [Buka Chat](/admin/live-chat?conversationId=CONVERSATION_ID).
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

      const answer = summaryResp?.data?.choices?.[0]?.message?.content?.trim() || 'Tidak ada ringkasan.';

      // Validator grounding atas UNION semua hasil tool (halusinasi silang-sumber).
      const grounded = this.validateGrounding(answer, unionRows);

      return { success: true, answer, toolsUsed, grounded, llmCalls };
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

    // Sebutan pasien di jawaban, mis. "Bunda Risma", "Ibu Dara".
    const matches = answer.match(/(?:Bunda|Ibu|Mbak|Bu|Kak)\s+([A-Za-z]+)/gi) || [];
    for (const m of matches) {
      const namePart = m.replace(/^(?:Bunda|Ibu|Mbak|Bu|Kak)\s+/i, '').trim().toLowerCase();
      if (namePart.length >= 3 && !knownTokens.has(namePart)) {
        return false; // nama yang disebut tak ada satupun token-nya di data tool
      }
    }
    return true;
  }
}

export const copilotService = new CopilotService();
