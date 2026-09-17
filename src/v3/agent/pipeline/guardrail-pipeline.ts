import { OutputSanitizer } from '../../guardrails/sanitizer';
import { validateNumericFacts } from '../../guardrails/numeric-fact-validator';
import { ContextGrounder } from './context-grounder';
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
 * Detektor pertanyaan JAM kunjungan spesifik (pure, sesi 614425 — Aturan Emas):
 * pertanyaan "jam berapa", "mau jam berapa", "pukul berapa", "jam kunjungan
 * yang diinginkan". Jam kunjungan diatur tim Bidan sesuai rute harian, jadi
 * pertanyaan ini DILARANG. Token-match terarah (bukan regex semantik).
 */
export function detectVisitTimeQuestion(replyText: string): boolean {
  if (!replyText || !replyText.trim()) return false;
  const lower = replyText.toLowerCase();
  const phrases = [
    'jam berapa',
    'mau jam',
    'pukul berapa',
    'jam kunjungan yang',
    'jam kunjungan yang diinginkan',
    'konfirmasi jam',
    'pilih jam',
    'jam kedatangan',
    'jam berapa ya',
  ];
  return phrases.some((p) => lower.includes(p));
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
    // Sesi 381894: plafon konteks-sadar tenant-aware (katalog/keranjang 1500, umum 1200;
    // kolom TenantPersona.max_chars_per_reply menang bila di-set admin).
    const isCatalogContext =
      executedTools.some((t) => t?.name === 'get_catalog_and_price') ||
      (session?.cartItems || []).length > 0;
    const sanitizeOpts = { tenantId, isCatalogContext };
    let finalReply = OutputSanitizer.cleanOutboundReply(input.draftReply, incomingText, isFollowUp, sanitizeOpts);
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
          const cleanedRetry = OutputSanitizer.cleanOutboundReply(trimmedRetry, incomingText, isFollowUp, sanitizeOpts);
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
    // Fase 6 K2 (Issue #74) — tag struktural penolakan/eskalasi (primer;
    // regex fallback di validator): eskalasi tool tereksekusi ATAU sinyal
    // deterministik trauma-jatuh/vaksin pada pesan masuk. Dihitung dari
    // artefak pipeline, BUKAN dari frasa balasan.
    const isRefusalOrEscalation =
      executedTools.some((t) => t?.name === 'escalate_to_human') ||
      ContextGrounder.hasFallInjurySignal(incomingText) ||
      ContextGrounder.hasVaccineSignal(incomingText);
    const factCheck = validateFactualClaims(finalReply, executedTools, retrievedChunks, { locationKnown, isRefusalOrEscalation });
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
          const factCleaned = OutputSanitizer.cleanOutboundReply(factRetryText, incomingText, isFollowUp, sanitizeOpts);
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
          shouldSendReply = true;
          const greeting = session.genderGreeting || 'Bunda';
          finalReply = `Mohon maaf ${greeting}, untuk pertanyaan ini kami teruskan langsung ke tim Bidan kami ya agar dapat dibantu lebih lanjut 🙏😊`;
          violationsDetected.push('SILENT_DROP_PREVENTED: balasan kosong diubah ke fallback eskalasi');
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
          const pronounCleaned = OutputSanitizer.cleanOutboundReply(pronounRetryText, incomingText, isFollowUp, sanitizeOpts);
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

    // 7d. Validator usia (T0.2 — anti-mutilasi, sesi 552209): deteksi
    // pertanyaan usia di balasan. Bila terdeteksi, re-prompt 1x untuk
    // menghapus pertanyaan usia tanpa memotong kalimat. Gagal → kirim
    // balasan asli + catat pelanggaran (bukan sunyi total).
    const hasAgeQuestion = (text: string): boolean =>
      /usia\s+(si\s+kecil|anak|baby|balita|bunda)|berapa\s+(bulan|tahun|usia)/i.test(text);
    if (hasAgeQuestion(finalReply) && shouldSendReply && !isEscalated && finalReply.trim()) {
      violationsDetected.push('age_solicitation_detected');
      const ageRepromptStartedAt = Date.now();
      let ageRepromptOk = false;
      try {
        const ageCorrectionNote = `KOREKSI USIA — tulis ulang SELURUH balasan dengan MAKNA yang SAMA, tetapi HAPUS pertanyaan tentang usia si kecil/anak/baby. DILARANG menodong usia customer. Jika informasi usia diperlukan untuk rekomendasi, sampaikan bahwa tim kami akan menanyakan saat koordinasi jadwal. DILARANG memotong atau mutilasi kalimat di tengah.`;
        const ageRetryData = await input.executeChat({
          payload: { model: selectedModel, messages: buildIsolatedRepromptMessages(finalReply, ageCorrectionNote), temperature: 0.3 },
          tenantId, phone, conversationId, baseUrl, apiKey, selectedModel,
        });
        repromptCount++;
        const ageRetryText = (ageRetryData?.choices?.[0]?.message?.content || '').trim();
        if (ageRetryText) {
          const ageCleaned = OutputSanitizer.cleanOutboundReply(ageRetryText, incomingText, isFollowUp, sanitizeOpts);
          if (!hasAgeQuestion(ageCleaned)) {
            finalReply = ageCleaned;
            ageRepromptOk = true;
            console.log(JSON.stringify({ event: 'AGE_SOLICITATION_REPROMPT_FIXED', tenantId, conversationId, timestamp: new Date().toISOString() }));
            await input.recordCall({
              reply: finalReply, status: 'SUCCESS', durationMs: Date.now() - ageRepromptStartedAt,
              promptPayload: { model: selectedModel, correction: 'age_solicitation' },
              callReasoning: 'Hapus pertanyaan usia dari balasan', callSequence: 3,
            });
          }
        }
      } catch (repromptErr: any) {
        console.warn(JSON.stringify({ event: 'AGE_SOLICITATION_REPROMPT_ERROR', tenantId, conversationId, error: repromptErr?.message, timestamp: new Date().toISOString() }));
      }
      if (!ageRepromptOk) {
        // Anti-mutilasi: kirim balasan asli (pelanggaran gaya, bukan halusinasi),
        // catat untuk kurasi prompt. DILARANG memotong kalimat.
        violationsDetected.push('age_solicitation_unresolved');
        console.warn(JSON.stringify({ event: 'AGE_SOLICITATION_UNRESOLVED_KEEP_ORIGINAL', tenantId, conversationId, timestamp: new Date().toISOString() }));
      }
    }

    // 7e. Validator jam kunjungan (sesi 614425 — Aturan Emas): balasan
    // DILARANG menanyakan JAM spesifik. Deteksi → re-prompt bersih 1x untuk
    // ganti menjadi pertanyaan hari / pernyataan jam diatur tim Bidan. Gagal →
    // kirim balasan asli + catat (pelanggaran gaya, bukan halusinasi).
    if (detectVisitTimeQuestion(finalReply) && shouldSendReply && !isEscalated && finalReply.trim()) {
      violationsDetected.push('visit_time_solicitation_detected');
      const timeRepromptStartedAt = Date.now();
      let timeRepromptOk = false;
      try {
        const timeCorrectionNote = `KOREKSI JADWAL — tulis ulang SELURUH balasan dengan MAKNA yang SAMA, tetapi HAPUS pertanyaan tentang JAM kunjungan spesifik ("jam berapa", "mau jam berapa", "pukul berapa"). Aturan klinik: jam kunjungan diatur tim Bidan sesuai rute operasional harian (jam operasional 08.00-17.00 WIB). Jika perlu memajukan jadwal, tanyakan HANYA preferensi HARI, atau sampaikan bahwa jam akan dikonfirmasi tim Bidan. DILARANG memotong atau mutilasi kalimat di tengah.`;
        const timeRetryData = await input.executeChat({
          payload: { model: selectedModel, messages: buildIsolatedRepromptMessages(finalReply, timeCorrectionNote), temperature: 0.3 },
          tenantId, phone, conversationId, baseUrl, apiKey, selectedModel,
        });
        repromptCount++;
        const timeRetryText = (timeRetryData?.choices?.[0]?.message?.content || '').trim();
        if (timeRetryText) {
          const timeCleaned = OutputSanitizer.cleanOutboundReply(timeRetryText, incomingText, isFollowUp, sanitizeOpts);
          if (!detectVisitTimeQuestion(timeCleaned)) {
            finalReply = timeCleaned;
            timeRepromptOk = true;
            console.log(JSON.stringify({ event: 'VISIT_TIME_REPROMPT_FIXED', tenantId, conversationId, timestamp: new Date().toISOString() }));
            await input.recordCall({
              reply: finalReply, status: 'SUCCESS', durationMs: Date.now() - timeRepromptStartedAt,
              promptPayload: { model: selectedModel, correction: 'visit_time_solicitation' },
              callReasoning: 'Hapus pertanyaan jam kunjungan dari balasan', callSequence: 3,
            });
          }
        }
      } catch (repromptErr: any) {
        console.warn(JSON.stringify({ event: 'VISIT_TIME_REPROMPT_ERROR', tenantId, conversationId, error: repromptErr?.message, timestamp: new Date().toISOString() }));
      }
      if (!timeRepromptOk) {
        violationsDetected.push('visit_time_solicitation_unresolved');
        console.warn(JSON.stringify({ event: 'VISIT_TIME_UNRESOLVED_KEEP_ORIGINAL', tenantId, conversationId, timestamp: new Date().toISOString() }));
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

    // HARD INVARIANT: Bot TIDAK BOLEH PERNAH mengirim balasan kosong ke customer apa pun alasannya.
    if (!finalReply || !finalReply.trim()) {
      const greeting = session.genderGreeting || 'Bunda';
      finalReply = `Mohon maaf ${greeting}, untuk pertanyaan ini kami teruskan langsung ke tim Bidan kami ya agar dapat dibantu lebih lanjut 🙏😊`;
      shouldSendReply = true;
      isEscalated = true;
      violationsDetected.push('TERMINAL_SILENT_DROP_GUARD: finalReply kosong diganti fallback');
      console.warn(JSON.stringify({ event: 'SILENT_DROP_PREVENTED', tenantId, conversationId, phone: maskPhoneNumber(phone), timestamp: new Date().toISOString() }));
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
