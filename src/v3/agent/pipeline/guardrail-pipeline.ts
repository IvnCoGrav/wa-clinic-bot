import { OutputSanitizer } from '../../guardrails/sanitizer';
import { validateNumericFacts } from '../../guardrails/numeric-fact-validator';
import { normalizeWhatsAppFormat } from '../../../utils/whatsapp-format';
import { GoalTracker, CustomerGoalSession } from '../../state/goal-tracker';
import { maskPhoneNumber } from '../../../utils/pii-masker';
import { GenerationStage } from './generation-stage';
import { SAME_DAY_DISCLAIMER } from './generation-stage';
import type { V3RetrievedChunk } from '../agent-runner';

export interface NumericRepromptDeps {
  tenantId: string;
  phone: string;
  conversationId: string;
  baseUrl: string;
  apiKey: string;
  selectedModel: string;
  /** Basis payload LLM (model + temperature); messages dilengkapi nota koreksi. */
  basePayload: any;
  messages: any[];
  violations: string[];
  expectedTotals: number[];
  /**
   * Draf balasan asisten turn saat ini yang mengandung angka salah (sesi
   * 188034: TANPA draf, LLM menulis ulang pesan asisten turn sebelumnya
   * → kaset rusak). Opsional demi kompatibilitas pemanggil lama.
   */
  currentDraft?: string;
  addUsage: (usage: any) => void;
  auditUsage: (usage: any, startedAt: number) => Promise<void> | void;
  /** Executor LLM (default: transport generation-stage; diinjeksikan saat pipeline). */
  executeChat?: (params: {
    payload: any;
    tenantId: string;
    phone: string;
    conversationId: string;
    baseUrl: string;
    apiKey: string;
    selectedModel: string;
  }) => Promise<any>;
}

export interface CallRecordMeta {
  reply: string;
  status: 'SUCCESS' | 'FALLBACK' | 'ERROR';
  durationMs: number;
  promptPayload?: any;
  callReasoning?: string | null;
  toolsCalled?: Array<{ name: string; args: any }>;
  promptTokens?: number;
  completionTokens?: number;
  callSequence?: number;
}

export interface GuardrailInput {
  draftReply: string;
  incomingText: string;
  isFollowUp: boolean;
  executedTools: Array<{ name: string; args: any; result: any }>;
  retrievedChunks: V3RetrievedChunk[];
  session: CustomerGoalSession;
  tenantId: string;
  phone: string;
  conversationId: string;
  selectedModel: string;
  baseUrl: string;
  apiKey: string;
  shouldSendReply: boolean;
  isEscalated: boolean;
  emptyKnowledgeResult: boolean;
  executeChat: (params: {
    payload: any;
    tenantId: string;
    phone: string;
    conversationId: string;
    baseUrl: string;
    apiKey: string;
    selectedModel: string;
  }) => Promise<any>;
  recordCall: (callMeta: CallRecordMeta) => Promise<void>;
  addUsage: (usage: any) => void;
  auditUsage: (usage: any, startedAt: number) => Promise<void> | void;
}

export interface GuardrailOutput {
  finalReply: string;
  shouldSendReply: boolean;
  isEscalated: boolean;
  emptyKnowledgeResult: boolean;
  repromptCount: number;
  violationsDetected: string[];
}

/**
 * Isolated Single-Turn Reprompt Engine (pure, testable — sesi 310843):
 * payload reprompt HANYA berisi draf teks saat ini + instruksi koreksi,
 * TANPA riwayat chat masa lalu. Bukti log: reprompt history+draft+correction
 * tetap collapse (PRONOUN_REPROMPT_FIXED mengadopsi salinan Turn 1) karena
 * model menyalin pesan asisten salient di riwayat, bukan merevisi draf.
 * Tanpa riwayat, pencontekan lintas-turn mustahil secara konstruksi.
 * System editor menjaga suara hangat Bidan Yusi + melarang penambahan
 * di luar draf. Guard: draf kosong → koreksi saja (anti HTTP 400).
 */
const REPROMPT_EDITOR_SYSTEM =
  'Kamu adalah editor bahasa dan konsistensi teks untuk layanan homecare "Kala Moms and Baby Spa". Tugasmu HANYA merevisi draf teks balasan WhatsApp asisten yang diberikan agar 100% mematuhi instruksi koreksi, dengan tetap mempertahankan nada hangat Bidan Yusi. DILARANG menyalin pesan dari percakapan lama (tidak ada konteks lain yang diberikan), DILARANG menambah penjelasan di luar draf, DILARANG mengubah fakta/angka/nama layanan selain yang diperintahkan koreksi, dan keluarkan HANYA teks balasan yang sudah direvisi secara utuh dan alami.';

export function buildIsolatedRepromptMessages(
  currentDraft: string | undefined,
  correctionNote: string
): any[] {
  const draftText = (currentDraft || '').trim();
  return [
    { role: 'system', content: REPROMPT_EDITOR_SYSTEM },
    {
      role: 'user',
      content: `Berikut adalah draf balasan asisten saat ini:\n"""\n${draftText}\n"""\n\nINSTRUKSI KOREKSI:\n${correctionNote}\n\nTuliskan hasil revisi balasan di atas:`,
    },
  ];
}

/**
 * Re-prompt koreksi angka 1x, sesi 214956 (diekspos untuk testing).
 * Mengirim ulang konteks + nota koreksi (angka resmi dari validator) dan
 * mengembalikan teks balasan mentah, atau null bila kosong/gagal.
 * TANPA penggantian string di tengah kalimat — LLM menyusun ulang utuh.
 */
export async function attemptNumericReprompt(deps: NumericRepromptDeps): Promise<string | null> {
  const runChat = deps.executeChat || GenerationStage.executeChatCompletion;
  const expected = (deps.expectedTotals || [])
    .map((n) => `Rp ${n.toLocaleString('id-ID')}`)
    .join(' / ');
  const correctionNote = `[KOREKSI FAKTA ANGKA — WAJIB DIPATUHI]\nDraf balasan Anda mengandung nominal yang SALAH dan DITOLAK sistem:\n${deps.violations.map((v) => `- ${v}`).join('\n')}\n${expected ? `Angka total resmi yang WAJIB Anda tulis: ${expected}.\n` : ''}Tugas: tulis ULANG seluruh balasan dari awal dengan kata-kata Anda sendiri yang hangat dan natural (Bidan Yusi), dengan SATU syarat mutlak: setiap nominal rupiah HARUS persis sama dengan angka resmi di atas. DILARANG mengubah, membulatkan, atau menebak nominal. JANGAN menjelaskan koreksi ini ke customer.`;
  const retryPayload: any = {
    ...deps.basePayload,
    messages: buildIsolatedRepromptMessages(deps.currentDraft, correctionNote),
  };
  const retryStartedAt = Date.now();
  const retryData = await runChat({
    payload: retryPayload,
    tenantId: deps.tenantId,
    phone: deps.phone,
    conversationId: deps.conversationId,
    baseUrl: deps.baseUrl,
    apiKey: deps.apiKey,
    selectedModel: deps.selectedModel,
  }).then(async (data: any) => {
    deps.addUsage((data as any)?.usage);
    await deps.auditUsage((data as any)?.usage, retryStartedAt);
    return data;
  });
  const content: unknown = retryData?.choices?.[0]?.message?.content;
  return typeof content === 'string' && content.trim().length > 0 ? content : null;
}

/**
 * Penegak disclaimer same-day deterministik (pure, sesi 462651): bila
 * balasan tidak mengandung indikasi jadwal-penuh, sisipkan disclaimer
 * resmi. Tanpa angka/pronoun bermasalah — aman pasca-validator.
 */
export function ensureSameDayDisclaimer(replyText: string): string {
  if (!replyText || !replyText.trim()) return replyText;
  if (/penuh/i.test(replyText)) return replyText;
  return `${replyText}\n\n${SAME_DAY_DISCLAIMER}`;
}

/**
 * Stage 5 — GuardrailPipeline: sanitasi, 3 loop reprompt terisolasi
 * (numerik, faktual, pronoun), safety-net same-day, dan fallback sanitizer.
 */
export class GuardrailPipeline {
  public static async verifyAndReprompt(input: GuardrailInput): Promise<GuardrailOutput> {
    const {
      incomingText, isFollowUp, executedTools, retrievedChunks, session,
      tenantId, phone, conversationId, selectedModel, baseUrl, apiKey,
    } = input;
    let { shouldSendReply, isEscalated, emptyKnowledgeResult } = input;
    let finalReply = OutputSanitizer.cleanOutboundReply(input.draftReply, incomingText, isFollowUp);
    let repromptCount = 0;
    const violationsDetected: string[] = [];

    // 7a. Validator numerik komposit.
    const numCheck = validateNumericFacts(finalReply, executedTools, { tenantId, session });
    // Audit 854065 (celah bypass): validasi WAJIB aktif pula saat keranjang
    // memiliki item walau turn ini tanpa tool call (tanya total langsung).
    const hasActiveCart = (session?.cartItems || []).length > 0;
    if (!numCheck.isValid && (executedTools.length > 0 || hasActiveCart)) {
      console.warn(JSON.stringify({ event: 'NUMERIC_HALLUCINATION_DETECTED', tenantId, conversationId, phone: maskPhoneNumber(phone), violations: numCheck.violations, timestamp: new Date().toISOString() }));
      violationsDetected.push(...numCheck.violations);
      // Re-prompt bersih 1x, sesi 214956 (TANPA mutilasi regex tengah kalimat):
      // minta LLM susun ulang SELURUH balasan dengan angka resmi. Gagal lagi
      // (atau error) → fallback ke template tool yang ter-grounding.
      let repromptOk = false;
      const numericRepromptStartedAt = Date.now();
      try {
        const retryReply = await attemptNumericReprompt({
          tenantId,
          phone,
          conversationId,
          baseUrl,
          apiKey,
          selectedModel,
          basePayload: { model: selectedModel, temperature: 0.65 },
          messages: [],
          currentDraft: finalReply,
          violations: numCheck.violations,
          expectedTotals: numCheck.expectedTotals || [],
          addUsage: input.addUsage,
          auditUsage: input.auditUsage,
          executeChat: input.executeChat,
        });
        repromptCount++;
        const trimmedRetry = (retryReply || '').trim();
        if (trimmedRetry) {
          const cleanedRetry = OutputSanitizer.cleanOutboundReply(trimmedRetry, incomingText, isFollowUp);
          const recheck = validateNumericFacts(cleanedRetry, executedTools, { tenantId, session });
          if (recheck.isValid) {
            finalReply = cleanedRetry;
            repromptOk = true;
            console.log(JSON.stringify({ event: 'NUMERIC_REPROMPT_FIXED', tenantId, conversationId, timestamp: new Date().toISOString() }));
            await input.recordCall({
              reply: finalReply,
              status: 'SUCCESS',
              durationMs: Date.now() - numericRepromptStartedAt,
              promptPayload: { model: selectedModel, correction: numCheck.violations },
              callReasoning: `Koreksi numerik: ${numCheck.violations.join('; ')}`,
              callSequence: 3,
            });
          } else {
            console.warn(JSON.stringify({ event: 'NUMERIC_REPROMPT_STILL_INVALID', tenantId, conversationId, phone: maskPhoneNumber(phone), violations: recheck.violations, timestamp: new Date().toISOString() }));
          }
        }
      } catch (repromptErr: any) {
        console.warn(JSON.stringify({ event: 'NUMERIC_REPROMPT_ERROR', tenantId, conversationId, error: repromptErr?.message || String(repromptErr), timestamp: new Date().toISOString() }));
      }
      if (!repromptOk) {
        // Gunakan template tool ter-grounding jika ada (prioritas: total
        // resmi keranjang multi-item, lalu template harga, lalu template umum)
        const cartTotalFallback = executedTools
          .map((t) => (t as any)?.result?.cartTotalReply)
          .find((s): s is string => typeof s === 'string' && s.trim().length > 0);
        // Audit 854065: turn tanpa tool TAK PUNYA template tool — bangun
        // fallback deterministik dari keranjang sesi (MESIN, bukan LLM):
        // seluruh item + grand total resmi, anti layanan hilang.
        let sessionCartFallback: string | undefined = undefined;
        if ((session.cartItems || []).length > 0) {
          const fmtRp = (n: number): string => `Rp ${Number(n).toLocaleString('id-ID')}`;
          const rows = (session.cartItems || []).map((it) => {
            const p = typeof it.promoPrice === 'number' ? it.promoPrice : it.price;
            // Label kinship hanya bermakna bila ≥2 anak di keranjang (sesi
            // 138207: anak tunggal DILARANG ditempeli [Adik] fiktif).
            const childCount = (session.cartItems || []).filter((c) => (c.recipientScope || 'GENERAL') !== 'MOMS').length;
            const who = it.recipientScope === 'MOMS' ? 'Bunda'
              : it.recipientScope === 'CHILD_2' ? 'Kakak'
              : it.recipientScope === 'CHILD_1' && childCount > 1 ? 'Adik' : null;
            return `- ${who ? `[${who}] ` : ''}${it.name}: ${fmtRp(p)}`;
          });
          const grand = GoalTracker.calcCartTotal(session);
          sessionCartFallback = `Berikut rincian resmi keranjang Bunda ya 😊\n${rows.join('\n')}\nTotal keseluruhan: *${fmtRp(grand)}*\n\nRencana mau kami bantu jadwalkan di hari apa ya Bunda? 🙏😊`;
        }
        const fallbackToolReply = cartTotalFallback || sessionCartFallback || executedTools[0]?.result?.suggestedPriceReply || executedTools[0]?.result?.suggestedTemplateReply;
        if (fallbackToolReply) {
          finalReply = fallbackToolReply;
        }
      }
    }

    // 7b. Validator klaim faktual non-angka (Fase D + D6): silang draf balasan
    // vs output tool turn ini. Gagal → re-prompt bersih 1x → masih gagal →
    // SUNYI TOTAL + eskalasi, KECUALI murni D6 (halu domisili) → template
    // netral tanya domisili (keputusan) + tandai unresolvedFaq untuk kurasi.
    const { validateFactualClaims } = await import('../../guardrails/factual-claim-validator');
    const locationKnown = !!(session?.location?.kelurahan || (session?.location as any)?.kecamatan);
    const factCheck = validateFactualClaims(finalReply, executedTools, retrievedChunks, { locationKnown });
    if (!factCheck.isValid && shouldSendReply && !isEscalated && finalReply.trim()) {
      console.warn(JSON.stringify({ event: 'FACTUAL_HALLUCINATION_DETECTED', tenantId, conversationId, phone: maskPhoneNumber(phone), violations: factCheck.violations, timestamp: new Date().toISOString() }));
      violationsDetected.push(...factCheck.violations);
      let factRepromptOk = false;
      const factRepromptStartedAt = Date.now();
      try {
        const correctionNote = `KOREKSI FAKTUAL — tulis ulang SELURUH balasan HANYA dari data tool resmi turn ini (katalog, knowledge, kebijakan). LARANGAN:\n- ${factCheck.violations.join('\n- ')}\nJika data tidak ada, JANGAN mengarang — jawab jujur bahwa info pastinya akan dicek tim kami.`;
        const factRetryData = await input.executeChat({
          payload: { model: selectedModel, messages: buildIsolatedRepromptMessages(finalReply, correctionNote), temperature: 0.3 },
          tenantId,
          phone,
          conversationId,
          baseUrl,
          apiKey,
          selectedModel,
        });
        repromptCount++;
        input.addUsage((factRetryData as any)?.usage);
        const factRetryText = (factRetryData?.choices?.[0]?.message?.content || '').trim();
        if (factRetryText) {
          const factCleaned = OutputSanitizer.cleanOutboundReply(factRetryText, incomingText, isFollowUp);
          const factRecheck = validateFactualClaims(factCleaned, executedTools, retrievedChunks, { locationKnown });
          if (factRecheck.isValid) {
            finalReply = factCleaned;
            factRepromptOk = true;
            await input.recordCall({
              reply: finalReply,
              status: 'SUCCESS',
              durationMs: Date.now() - factRepromptStartedAt,
              promptPayload: { model: selectedModel, correction: factCheck.violations },
              callReasoning: `Koreksi faktual: ${factCheck.violations.join('; ')}`,
              promptTokens: Number((factRetryData as any)?.usage?.prompt_tokens) || undefined,
              completionTokens: Number((factRetryData as any)?.usage?.completion_tokens) || undefined,
              callSequence: 3,
            });
          } else {
            console.warn(JSON.stringify({ event: 'FACTUAL_REPROMPT_STILL_INVALID', tenantId, conversationId, phone: maskPhoneNumber(phone), violations: factRecheck.violations, timestamp: new Date().toISOString() }));
          }
        }
      } catch (repromptErr: any) {
        console.warn(JSON.stringify({ event: 'FACTUAL_REPROMPT_ERROR', tenantId, conversationId, error: repromptErr?.message || String(repromptErr), timestamp: new Date().toISOString() }));
      }
      if (!factRepromptOk) {
        const onlyDomicile = factCheck.violations.length > 0
          && factCheck.violations.every((v) => v.startsWith('Domicile'));
        if (onlyDomicile) {
          // D6 murni: ganti template netral (tanpa nama kecamatan), tetap
          // terkirim + masuk kurasi admin via unresolvedFaq.
          const { TEMPLATES } = await import('../../../config/persona');
          finalReply = TEMPLATES.askDomicileNeutral();
          shouldSendReply = true;
          emptyKnowledgeResult = true;
        } else {
          isEscalated = true;
          shouldSendReply = false;
          finalReply = '';
        }
      }
    }

    // 7c. Validator kata ganti klinik (aturan emas 7, sesi 834128):
    // deteksi "saya/aku" di luar perkenalan Turn-0 → re-prompt bersih 1x.
    // TANPA mutilasi regex tengah kalimat (Mandat Minimal-Regex): LLM
    // menulis ulang SELURUH balasan; gagal lagi → balasan asli tetap
    // dikirim (pelanggaran gaya, bukan halusinasi faktual — sunyi total
    // tidak proporsional) + tercatat untuk kurasi prompt.
    const { detectFirstPersonSlip } = await import('../../guardrails/pronoun-validator');
    const pronounCheck = detectFirstPersonSlip(finalReply, { isFollowUp });
    if (!pronounCheck.isValid && shouldSendReply && !isEscalated && finalReply.trim()) {
      console.warn(JSON.stringify({ event: 'PRONOUN_SLIP_DETECTED', tenantId, conversationId, phone: maskPhoneNumber(phone), violations: pronounCheck.violations, timestamp: new Date().toISOString() }));
      violationsDetected.push(...pronounCheck.violations);
      const pronounRepromptStartedAt = Date.now();
      try {
        const correctionNote = `KOREKSI KATA GANTI — tulis ulang SELURUH balasan dengan makna, harga, dan fakta yang SAMA PERSIS, tetapi GANTI setiap "saya/aku" menjadi "kami"/"Bidan kami" (aturan emas 7). Pengecualian HANYA kalimat perkenalan resmi Turn-0 ("Perkenalkan, saya Bidan Yusi..."). DILARANG mengubah nominal, nama layanan, atau menambah/mengurangi informasi.`;
        const pronounRetryData = await input.executeChat({
          payload: { model: selectedModel, messages: buildIsolatedRepromptMessages(finalReply, correctionNote), temperature: 0.3 },
          tenantId,
          phone,
          conversationId,
          baseUrl,
          apiKey,
          selectedModel,
        });
        repromptCount++;
        input.addUsage((pronounRetryData as any)?.usage);
        const pronounRetryText = (pronounRetryData?.choices?.[0]?.message?.content || '').trim();
        if (pronounRetryText) {
          const pronounCleaned = OutputSanitizer.cleanOutboundReply(pronounRetryText, incomingText, isFollowUp);
          const pronounRecheck = detectFirstPersonSlip(pronounCleaned, { isFollowUp });
          if (pronounRecheck.isValid) {
            finalReply = pronounCleaned;
            console.log(JSON.stringify({ event: 'PRONOUN_REPROMPT_FIXED', tenantId, conversationId, timestamp: new Date().toISOString() }));
            await input.recordCall({
              reply: finalReply,
              status: 'SUCCESS',
              durationMs: Date.now() - pronounRepromptStartedAt,
              promptPayload: { model: selectedModel, correction: pronounCheck.violations },
              callReasoning: `Koreksi pronoun: ${pronounCheck.violations.join('; ')}`,
              promptTokens: Number((pronounRetryData as any)?.usage?.prompt_tokens) || undefined,
              completionTokens: Number((pronounRetryData as any)?.usage?.completion_tokens) || undefined,
              callSequence: 3,
            });
          } else {
            console.warn(JSON.stringify({ event: 'PRONOUN_REPROMPT_STILL_INVALID', tenantId, conversationId, phone: maskPhoneNumber(phone), violations: pronounRecheck.violations, timestamp: new Date().toISOString() }));
          }
        }
      } catch (repromptErr: any) {
        console.warn(JSON.stringify({ event: 'PRONOUN_REPROMPT_ERROR', tenantId, conversationId, error: repromptErr?.message || String(repromptErr), timestamp: new Date().toISOString() }));
      }
    }

    // Safety-net deterministik same-day (sesi 462651): bila turn ini
    // mencatat reservasi HARI INI tetapi balasan tidak menurunkan
    // ekspektasi (tanpa indikasi penuh), sisipkan disclaimer resmi.
    // Teks tetap tanpa angka/pronoun terlarang — aman pasca-validator.
    const saveReservationSameDay = executedTools.find(
      (t) => t?.name === 'save_reservation' && (t as any)?.result?.success === true
        && (t as any)?.result?.isSameDay === true
    );
    if (
      saveReservationSameDay
      && shouldSendReply && !isEscalated && finalReply.trim()
    ) {
      const withDisclaimer = ensureSameDayDisclaimer(finalReply);
      if (withDisclaimer !== finalReply) {
        finalReply = withDisclaimer;
        console.warn(JSON.stringify({ event: 'SAME_DAY_DISCLAIMER_APPENDED', tenantId, conversationId, timestamp: new Date().toISOString() }));
      }
    }

    // Post-processor deterministik: konversi Markdown ganda (**tebal**) ke
    // format WhatsApp tunggal (*tebal*) untuk SEMUA output agent — berlaku di
    // simulator, dashboard, log LLM, maupun WAHA (sebelum validasi & logging).
    finalReply = normalizeWhatsAppFormat(finalReply);

    // Sanitizer fallback HANYA boleh berjalan jika pesan BUKAN hasil eskalasi senyap.
    if (!isEscalated && shouldSendReply && !OutputSanitizer.isValidReply(finalReply)) {
      console.warn(JSON.stringify({ event: 'V3_AGENT_SANITIZER_REJECTED', tenantId, conversationId, phone: maskPhoneNumber(phone), reply: finalReply.slice(0, 100), timestamp: new Date().toISOString() }));
      const { getBrandIdentity } = await import('../../../config/brand');
      const brand = getBrandIdentity();
      finalReply = `Halo ${session.genderGreeting} 😊\n\nTerima kasih sudah menghubungi kami di ${brand.businessName}. Ada yang bisa Bidan kami bantu untuk perawatan Bunda atau si kecil hari ini? ✨`;
    }

    return {
      finalReply,
      shouldSendReply,
      isEscalated,
      emptyKnowledgeResult,
      repromptCount,
      violationsDetected,
    };
  }

  private static async attemptNumericReprompt(
    deps: NumericRepromptDeps & { executeChat: NonNullable<NumericRepromptDeps['executeChat']> }
  ): Promise<string | null> {
    return attemptNumericReprompt(deps);
  }

  private static async attemptFactualReprompt(
    draft: string,
    violations: string[],
    executeChat: GuardrailInput['executeChat'],
    ctx: { tenantId: string; phone: string; conversationId: string; baseUrl: string; apiKey: string; selectedModel: string }
  ): Promise<string | null> {
    const correctionNote = `KOREKSI FAKTUAL — tulis ulang SELURUH balasan HANYA dari data tool resmi turn ini (katalog, knowledge, kebijakan). LARANGAN:\n- ${violations.join('\n- ')}\nJika data tidak ada, JANGAN mengarang — jawab jujur bahwa info pastinya akan dicek tim kami.`;
    const data = await executeChat({
      payload: { model: ctx.selectedModel, messages: buildIsolatedRepromptMessages(draft, correctionNote), temperature: 0.3 },
      ...ctx,
    });
    const text = (data?.choices?.[0]?.message?.content || '').trim();
    return text ? text : null;
  }

  private static async attemptPronounReprompt(
    draft: string,
    executeChat: GuardrailInput['executeChat'],
    ctx: { tenantId: string; phone: string; conversationId: string; baseUrl: string; apiKey: string; selectedModel: string }
  ): Promise<string | null> {
    const correctionNote = `KOREKSI KATA GANTI — tulis ulang SELURUH balasan dengan makna, harga, dan fakta yang SAMA PERSIS, tetapi GANTI setiap "saya/aku" menjadi "kami"/"Bidan kami" (aturan emas 7). Pengecualian HANYA kalimat perkenalan resmi Turn-0 ("Perkenalkan, saya Bidan Yusi..."). DILARANG mengubah nominal, nama layanan, atau menambah/mengurangi informasi.`;
    const data = await executeChat({
      payload: { model: ctx.selectedModel, messages: buildIsolatedRepromptMessages(draft, correctionNote), temperature: 0.3 },
      ...ctx,
    });
    const text = (data?.choices?.[0]?.message?.content || '').trim();
    return text ? text : null;
  }
}
