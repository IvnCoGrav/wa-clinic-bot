import axios from 'axios';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client';
import { AiModelConfigService } from '../config/ai-models.config';
import { BOT_PERSONA_PROMPT } from '../config/persona';

/**
 * LLM-as-Judge — Evaluasi kualitas balasan bot secara otomatis.
 *
 * Alur:
 * 1. sampleAndEvaluate(tenantId) mengambil sampel pesan OUTBOUND yang punya
 *    aiReasoning (balasan bot hasil LLM) — subset acak hari ini (default 10%).
 * 2. Untuk tiap sampel, kirim prompt evaluasi ke LLM agar menilai kualitas
 *    jawaban (score 1-5) + feedback singkat.
 * 3. Simpan hasil ke tabel ai_evaluations (idempoten per message_id).
 *
 * SLA: tabel evaluasi DIPISAH (AiEvaluation) dari ai_router_evaluations supaya
 * tidak mencemari metrik akurasi AI Router (check-router-accuracy.ts).
 * DB/LLM down → abort senyap (tidak pernah mengganggu produksi).
 */

export interface EvaluatedSample {
  messageId: string;
  tenantId: string;
  customerPhone: string;
  conversationId?: string | null;
  messageText: string;
  aiReasoning?: string | null;
}

export interface EvalResult {
  dispatchMessageId: string;
  score?: number;
  feedback?: string;
}

export class LlmEvaluatorService {
  private get apiKey(): string {
    return process.env.LLM_API_KEY || '';
  }
  private get baseUrl(): string {
    return (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  }

  /**
   * Ambil pesan OUTBOUND terbaru yang memiliki aiReasoning (balasan LLM),
   * lalu pilih subset acak (default 10%, minimal 1 bila ada data, maks AI_EVAL_MAX_PER_BATCH).
   *
   * Sampling ratio adalah PERSEN (10 => 10%); 0 => tanpa sampel (return []).
   */
  public async sampleMessages(
    tenantId: string,
    samplingPercent = 10
  ): Promise<EvaluatedSample[]> {
    try {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const rows = await prisma.message.findMany({
        where: {
          tenant_id: tenantId,
          direction: 'OUTBOUND',
          created_at: { gte: startOfToday },
          payload_raw: { path: ['aiReasoning'], not: Prisma.JsonNull },
        },
        orderBy: { created_at: 'desc' },
        take: 2000,
        include: { conversation: { include: { customer: { select: { phone: true } } } } },
      });

      if (!rows || rows.length === 0) return [];

      // Acak urutan lalu ambil ≤10% (min 1 bila ada, cap AI_MAX_SAMPLES)
      const shuffled = rows.map((r) => r).sort(() => Math.random() - 0.5);
      const maxSample = Math.max(1, Math.floor((rows.length * samplingPercent) / 100));
      const cap = Math.min(maxSample, parseInt(process.env.AI_MAX_SAMPLES || '50', 10));
      const selected = shuffled.slice(0, cap);

      return selected.map((r) => ({
        messageId: r.id,
        tenantId: r.tenant_id,
        customerPhone: r.conversation?.customer?.phone || '',
        conversationId: r.conversation_id,
        messageText: r.content,
        aiReasoning: (r.payload_raw as any)?.aiReasoning ?? null,
      }));
    } catch (err) {
      console.warn('[LLM EVALUATOR] sampler tidak tersedia (DB offline/silent):', (err as Error).message);
      return [];
    }
  }

  /**
   * Menilai kualitas satu pesan via LLM-as-Judge.
   * Return { score, feedback } atau null bila LLM gagal/tidak tersedia.
   */
  private async evaluateOne(sample: EvaluatedSample): Promise<{ score: number; feedback: string } | null> {
    if (!this.apiKey || this.apiKey.startsWith('mock')) return null;

    const config = AiModelConfigService.getModelConfig('CHAT_REPLY');

    const systemPrompt = `Kamu adalah evaluator kualitas balasan asisten (LLM-as-a-Judge) untuk chatbot klinik.
${BOT_PERSONA_PROMPT}

Nilailah kualitas JAWABAN bot berikut berdasarkan REASONING yang menyertai & jawabannya.
Skor 1-5: 1=sangat buruk/menyesatkan, 3=cukup, 5=sangat baik. Beri feedback singkat 1-2 kalimat (Indonesia).

FORMAT WAJIB JSON:
{
  "score": 1-5,
  "feedback": "ringkas"
}`;

    const userContent = `REASONING AI: ${sample.aiReasoning || '(tidak ada)'}\nJAWABAN BOT: ${sample.messageText}`;

    try {
      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: config.modelName,
          temperature: 0.2,
          max_tokens: config.maxTokens,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
        },
        {
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          timeout: parseInt(process.env.AI_EVAL_TIMEOUT_MS || '30000', 10),
        }
      );

      const raw = response.data?.choices?.[0]?.message?.content?.trim();
      if (!raw) return null;

      const parsed = JSON.parse(raw.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '').trim());
      const score = Number(parsed.score);
      if (!Number.isFinite(score) || score < 1 || score > 5) return null;

      return { score, feedback: String(parsed.feedback || '').slice(0, 2000) };
    } catch (err) {
      console.warn('[AI EVALUATOR] evaluasi LLM gagal (silent):', (err as Error).message);
      return null;
    }
  }

  /**
   * Jalankan evaluasi untuk satu tenant (idempotent per message_id via upsert-unique).
   * Kembalikan jumlah pesan yang berhasil dievaluasi.
   */
  async sampleAndEvaluate(tenantId: string, samplingPercent = 10): Promise<number> {
    const samples = await this.sampleMessages(tenantId, samplingPercent);
    if (samples.length === 0) return 0;

    let evaluated = 0;
    for (const s of samples) {
      try {
        const verdict = await this.evaluateOne(s);
        if (!verdict) continue;

        await prisma.aiEvaluation.upsert({
          where: { message_id: s.messageId },
          update: { score: verdict.score, feedback: verdict.feedback },
          create: {
            tenant_id: tenantId,
            message_id: s.messageId,
            customer_phone: s.customerPhone,
            conversation_id: s.conversationId,
            message_text: s.messageText,
            ai_reasoning: s.aiReasoning,
            score: verdict.score,
            feedback: verdict.feedback,
          },
        });
        evaluated++;
      } catch (err) {
        // DB error per pesan → lanjut ke sampel berikutnya (best-effort)
        console.warn('[LLM EVALUATOR] simpan eval gagal (silent):', (err as Error).message);
      }
    }
    return evaluated;
  }
}

export const llmEvaluatorService = new LlmEvaluatorService();