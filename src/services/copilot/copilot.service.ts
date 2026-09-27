import { COPILOT_TOOLS, getCopilotTool, CopilotToolResult } from './copilot-tools';

/**
 * copilot.service.ts (Fase 6r) — AI Clinic Copilot in-system.
 *
 * Kontrak fondasional (anti-halusinasi):
 * - LLM memilih tool + args (JSON), lalu tool query DB. Jawaban WAJIB grounded pada hasil tool.
 * - Jika tool mengembalikan [] → paksa jawaban "tidak ditemukan" (template), BUKAN mengarang.
 * - Validator pasca-jawaban: nama customer yang disebut di jawaban WAJIB subset nama di hasil tool.
 * - Budget token & cap history.
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
  error?: string;
}

const MAX_HISTORY_TURNS = 10;

export class CopilotService {
  public async chat(params: CopilotChatParams): Promise<CopilotChatResult> {
    const { tenantId, message } = params;
    const history = (params.history || []).slice(-MAX_HISTORY_TURNS);

    try {
      const { getLlmEndpointConfig } = await import('../../integrations/llm/llm-gateway');
      const { callChatCompletionsWithFallback } = await import('../../integrations/llm/model-fallback');
      const { extractBalancedJson } = await import('../../utils/json-extract');

      const cfg = getLlmEndpointConfig({ modelConfigKey: 'CHAT_REPLY', tenantId });

      // Langkah 1: LLM memilih tool + args.
      const toolMenu = COPILOT_TOOLS.map(
        (t) => `- ${t.name}: ${t.description}\n  args: ${JSON.stringify(t.parameters)}`
      ).join('\n');
      const routerPrompt = `Kamu adalah asisten internal klinik. Pilih SATU tool untuk menjawab pertanyaan admin.
Tool tersedia:
${toolMenu}

Jawab HANYA dengan JSON: {"tool": "<nama>", "args": { ... }}.
Jika tidak ada tool yang cocok, jawab {"tool": null, "args": {}}.
Pertanyaan admin: "${message}"`;

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

      const rawRouter = routerResp.data?.choices?.[0]?.message?.content || '';
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

      if (!toolName) {
        return {
          success: true,
          answer: 'Maaf, saya tidak menemukan data yang cocok untuk pertanyaan itu. Coba sebutkan tanggal atau nama pasien secara spesifik ya.',
          toolsUsed: [],
          grounded: true,
        };
      }

      const tool = getCopilotTool(toolName);
      if (!tool) {
        return { success: false, answer: 'Tool tidak dikenali.', toolsUsed: [], grounded: false, error: 'UNKNOWN_TOOL' };
      }

      // Langkah 2: eksekusi tool (grounding DB).
      const toolResult: CopilotToolResult = await tool.run(tenantId, toolArgs);

      // Gerbang grounding: tool kosong → jawab jujur, jangan biarkan LLM mengarang.
      if (!toolResult.rows || toolResult.rows.length === 0) {
        return {
          success: true,
          answer: 'Tidak ditemukan data untuk kriteria tersebut.',
          toolsUsed: [tool.name],
          grounded: true,
        };
      }

      // Langkah 3: LLM merangkum HASIL TOOL saja.
      const summarizePrompt = `Berikut data riil dari database (JSON). Rangkum dalam bahasa Indonesia singkat untuk admin.
DILARANG menambah nama, nomor, atau jadwal yang TIDAK ada di data. Bila perlu, sertakan tautan Live Chat bila ada conversationId.
Data:
${JSON.stringify(toolResult.rows).slice(0, 6000)}`;

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

      const answer = summaryResp.data?.choices?.[0]?.message?.content?.trim() || 'Tidak ada ringkasan.';

      // Validator grounding: nama customer di jawaban WAJIB subset nama di hasil tool.
      const grounded = this.validateGrounding(answer, toolResult.rows);

      return { success: true, answer, toolsUsed: [tool.name], grounded };
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
   * Validator grounding deterministik: setiap nama customer yang muncul di jawaban
   * harus berasal dari hasil tool (anti-halusinasi nama).
   * Heuristik aman: cek apakah token nama "Bunda X" di jawaban ada di set nama tool.
   */
  public validateGrounding(answer: string, rows: any[]): boolean {
    const names = new Set<string>();
    for (const r of rows) {
      const n = (r.customerName || '').toString().trim().toLowerCase();
      if (n) names.add(n);
    }
    // Deteksi pola "Bunda <Nama>" atau "Ibu <Nama>" di jawaban.
    const matches = answer.match(/(?:Bunda|Ibu|Mbak|Bu)\s+([A-Z][a-zA-Z]+)/g) || [];
    for (const m of matches) {
      const token = m.trim().toLowerCase();
      if (!names.has(token)) {
        return false; // nama tak ada di data → halusinasi
      }
    }
    return true;
  }
}

export const copilotService = new CopilotService();
