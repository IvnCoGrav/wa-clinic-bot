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
 * Fallback balasan tak-valid deterministik (pure): greeting pembuka HANYA untuk
 * Turn-0 (bukan follow-up). Di tengah obrolan, recovery kontekstual TANPA
 * sapaan pembuka agar tak terjadi greeting-reset.
 */
export function buildInvalidReplyFallback(
  isFollowUp: boolean,
  genderGreeting: string,
  businessName: string
): string {
  const greet = genderGreeting || 'Bunda';
  if (!isFollowUp) {
    return `Halo ${greet} 😊\n\nTerima kasih sudah menghubungi kami di ${businessName}. Ada yang bisa Bidan kami bantu untuk perawatan Bunda atau si kecil hari ini? ✨`;
  }
  return `Baik ${greet} 😊 Kami pastikan informasinya terlebih dahulu yaa. Ada hal lain terkait si kecil atau perawatan yang ingin kami bantu cekkan? 🤗`;
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
    // Audit R7 (ST6-CLM): validator numerik WAJIB aktif juga pada DIRECT REPLY
    // tanpa tool/cart (sebelumnya di-gate `executedTools.length>0 || hasActiveCart`,
    // sehingga harga non-katalog pada direct reply lolos tanpa koreksi).
    // `validateNumericFacts` sudah return isValid lebih awal bila tidak ada token
    // "Rp", sehingga gate ini hanya menyala saat balasan benar-benar menyebut nominal.
    if (!numCheck.isValid) {
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
        // Re-prompt numerik gagal total → jangan kirim angka halusinasi ke
        // customer. Prioritas: total resmi keranjang multi-item dari tool,
        // lalu rekap keranjang sesi (MESIN, bukan LLM).
        //
        // Fase 4 (revisi fondasional 2026-09-18): DILARANG overwrite membabi
        // buta dengan template harga generik tool (`suggestedPriceReply`/
        // `suggestedTemplateReply`) — itu membuang narasi natural model dan
        // pernah menyuntik CTA "hari apa" hardcoded. Hanya rekap resmi
        // deterministik yang BOLEH menggantikan (koreksi angka, bukan gaya).
        const cartTotalFallback = executedTools
          .map((t) => (t as any)?.result?.cartTotalReply)
          .find((s): s is string => typeof s === 'string' && s.trim().length > 0);
        // Audit 854065 + Aturan Emas 20: rekap deterministik dari keranjang sesi.
        // CTA WAJIB state-aware (bukan "hari apa" hardcoded) — pakai jumlah item
        // keranjang & tanggal terpilih untuk memilih cabang CTA yang benar.
        const hasCartItems = (session.cartItems || []).length > 0;
        let sessionCartFallback: string | undefined = undefined;
        if (hasCartItems) {
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
          const preferredDate = (session.booking as any)?.preferredDate;
          const ctaLine = preferredDate
            ? `Untuk ketersediaan jadwal ${preferredDate}nya, akan kami bantu cekkan ketersediaan jadwal terlebih dahulu ya Bunda 🙏😊`
            : `Untuk layanannya, rencana mau kami bantu jadwalkan di hari apa ya Bunda? 🙏😊`;
          sessionCartFallback = `Berikut rincian resmi keranjang Bunda ya 😊\n${rows.join('\n')}\nTotal keseluruhan: *${fmtRp(grand)}*\n\n${ctaLine}`;
        }
        const deterministicFallback = cartTotalFallback || sessionCartFallback;
        if (deterministicFallback) {
          finalReply = deterministicFallback;
        }
        // Tanpa rekap resmi: JANGAN overwrite — biarkan guardrail hilir
        // (validator klaim faktual / silent-drop) yang menangani, agar narasi
        // natural model tetap utuh bila memungkinkan.
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
    // Plan regresi Fase 1 (Sesi 580976): teruskan pesan customer agar D6
    // mengenali kecamatan yang disebut customer sebagai grounding sah.
    // Fixing D1 (sesi 767713): sertakan nama SELURUH katalog tenant (termasuk
    // add-on seperti Sinar Moksa) agar add-on sah tak dituduh halusinasi.
    let extraCatalogNames: string[] | undefined;
    try {
      const { treatmentCatalogService } = await import('../../../services/treatment-catalog.service');
      extraCatalogNames = (treatmentCatalogService.getAllServices(true, tenantId) || [])
        .map((s: any) => (typeof s?.name === 'string' ? s.name : ''))
        .filter((n: string) => n.length > 0);
    } catch { extraCatalogNames = undefined; }
    const factCheck = validateFactualClaims(finalReply, executedTools, retrievedChunks, { locationKnown, isRefusalOrEscalation, customerInput: incomingText, extraCatalogNames });
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
          const factRecheck = validateFactualClaims(factCleaned, executedTools, retrievedChunks, { locationKnown, customerInput: incomingText, extraCatalogNames });
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
        const hasD9 = factCheck.violations.some((v) => v.includes('D9_LOCATION_AMNESIA'));
        if (hasD9) {
          finalReply = `Baik Bunda, untuk ketersediaan jadwalnya kami bantu cekkan terlebih dahulu ya Bunda 😊 Nanti segera kami infokan ya bund 🤗`;
          shouldSendReply = true;
          emptyKnowledgeResult = false;
          violationsDetected.push('D9_LOCATION_AMNESIA_FALLBACK: amnesia diganti konfirmasi jadwal deterministik');
        } else {
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
          // P4 — surgical salvage TINGKAT KALIMAT (bukan buang seluruh balasan):
          // kalimat valid dipertahankan verbatim, yang melanggar dibuang +
          // catatan handoff deterministik. Tanpa edit isi kalimat (anti-mutilasi).
          let salvaged = false;
          try {
            const { salvageValidSentences } = await import('../../guardrails/sentence-salvage');
            const salvage = salvageValidSentences(finalReply, executedTools, retrievedChunks, { locationKnown });
            if (salvage.kept.length > 0 && salvage.dropped.length > 0) {
              finalReply = `${salvage.kept.join(' ')} Untuk detail pastinya, tim Bidan kami akan segera membantu mengecek dan melengkapinya ya Bunda 🙏`;
              violationsDetected.push(...salvage.droppedViolations);
              violationsDetected.push(`SENTENCE_SALVAGE_APPLIED: ${salvage.kept.length} kalimat valid dipertahankan, ${salvage.dropped.length} dibuang`);
              salvaged = true;
            }
          } catch {}
          if (!salvaged) {
            const greeting = session.genderGreeting || 'Bunda';
            finalReply = `Mohon maaf ${greeting}, untuk pertanyaan ini kami teruskan langsung ke tim Bidan kami ya agar dapat dibantu lebih lanjut 🙏😊`;
            violationsDetected.push('SILENT_DROP_PREVENTED: balasan kosong diubah ke fallback eskalasi');
          }
        }
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

    // 7d. Validator usia (T0.2 — anti-mutilasi, sesi 552209 / 476427):
    // Pertanyaan usia DILARANG jika menodong di luar konteks (jadwal/ongkir).
    // TETAPI jika tool katalog menyatakan needsAgeClarification (multi-tier,
    // usia belum diketahui), pertanyaan usia netral adalah SOP klinis DISETUJUI.
    const isAgeClarificationAuthorized = executedTools.some(
      (t) => t?.name === 'get_catalog_and_price' && (t as any)?.result?.needsAgeClarification === true
    );
    const hasAgeQuestion = (text: string): boolean =>
      /usia\s+(si\s+kecil|anak|baby|balita|bunda)|berapa\s+(bulan|tahun|usia)/i.test(text);
    // Lapis kode DETERMINISTIK (sesi 783810 — anti-tambal-sulam: kontrol gaya
    // berkuota HANYA diizinkan lewat gerbang kode, bukan kepatuhan prompt).
    // Tanpa otorisasi klinis, menodong usia NOMINAL ("usia si kecil 3 bulan")
    // dikeluarkan dengan menggugurkan bilangan+satuan, KONTEKS kalimat lestari.
    // Dasar pola: kata 'usia' lalu bilangan lalu satuan; kalimat bertanda
    // '?'/berdaftar mode/satuan tanggung → gagal aman (tanpa strip).
    const NOMINAL_AGE_RE =
      /\busia\s+[^\n.?!]*?\b(\d+(?:[.,]\d+)?)\s*(tahun|tahunan|thn|th|bln|bulan|hari)\b/gi;
    const NOMINAL_AGE_MODES = ['bulan', 'hari', 'minggu', 'tahun'] as const;
    const stripNominalAges = (text: string): string => {
      if (!text) return text;
      if (isAgeClarificationAuthorized) return text;
      // PLAN 12 Fase 4 — state-gated: bila usia sudah tercatat di sesi, JANGAN mutilasi afirmasi katalog
      const hasChildAgeKnown = Boolean(
        (session as any)?.childProfile?.ageMonths != null ||
        (Array.isArray((session as any)?.children) && (session as any).children.length > 0 && (session as any).children.some((c: any) => c?.ageMonths != null))
      );
      if (hasChildAgeKnown) return text;
      const anyMode = NOMINAL_AGE_MODES.some(
        (m) => new RegExp(`(?:^|[^a-z0-9])${m}(?:[^a-z0-9]|$)`).test(text.toLowerCase())
      );
      if (!anyMode) return text;
      let updated = text;
      let hits = 0;
      updated = updated.replace(NOMINAL_AGE_RE, (m) => { hits++; return m; });
      if (hits === 0) return text;
      updated = text.replace(NOMINAL_AGE_RE, (span) => {
        const num = /(\d+(?:[.,]\d+)?)\s*(tahun|tahunan|thn|th|bln|bulan|hari)\b/i.exec(span);
        if (!num) return span;
        const at = span.search(num[0]);
        return span.slice(0, at).trimEnd();
      });
      const normal = updated.replace(/\s{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
      if (!normal) return text;
      // Sisa satuan/tahun → perbaikan mencurigakan (bukan sekedar strip) →
      // anti-mutilasi: pulihkan teks asli daripada memotong tengah kalimat.
      if (/\btahun\b|\bbulan\b/.test(normal)) return text;
      return normal;
    };
    if (!isEscalated && shouldSendReply && finalReply.trim()) {
      const strippedReply = stripNominalAges(finalReply);
      if (strippedReply !== finalReply) {
        finalReply = strippedReply;
        violationsDetected.push('nominal_age_solicitation_stripped');
        console.warn(JSON.stringify({ event: 'NOMINAL_AGE_SOLICITATION_STRIPPED', tenantId, conversationId, timestamp: new Date().toISOString() }));
        await input.recordCall({
          reply: finalReply, status: 'SUCCESS', durationMs: 0,
          promptPayload: { model: selectedModel, correction: 'nominal_age_strip' },
          callReasoning: 'Strip deterministik nominal usia (otorisasi klinis tak ada)', callSequence: 3,
        });
      }
    }
    if (!isAgeClarificationAuthorized && hasAgeQuestion(finalReply) && shouldSendReply && !isEscalated && finalReply.trim()) {
      violationsDetected.push('age_solicitation_detected');
      const ageRepromptStartedAt = Date.now();
      let ageRepromptOk = false;
      try {
        const ageCorrectionNote = `KOREKSI USIA — tulis ulang SELURUH balasan dengan MAKNA yang SAMA, tetapi HAPUS pertanyaan tentang usia si kecil/anak/baby. DILARANG menodong usia customer. DILARANG memotong atau mutilasi kalimat di tengah.`;
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

    // 7f. Validator anti-solicitation SHARE LOCATION (Sesi 662917 / Issue #77,
    // Aturan Emas 21): DILARANG mengajak customer mengirim share location —
    // cukup tanya nama kelurahan/desa/perumahan/patokan. Template persona telah
    // dibersihkan (Fase 1), TAPI riwayat terhapusnya status menjadi bukti celah
    // gaya tetap bisa bocor via generasi Call 2 — kendali kuota WAJIB gerbang
    // kode deterministik, bukan patuh prompt semata (anti-makeup).
    // State-gated: SENGGAJA di-bypass di jalur pasca-booking (machine.ts legacy,
    // isHumanHandling + isEscalated=true → guard di bawah tidak terpenuhi).
    // Pola netral: kata 'kirim*' berdekatan dengan share-location/shareloc/
    // sharelock (dua arah). Negasi penjaga ("tanpa menanyakan ... share
    // location") di jendela konteks → bukan solicitation (eksklusi defensif).
    const hasShareLocationSolicitation = (text: string): boolean => {
      const lower = (text || '').toLowerCase();
      if (!lower) return false;
      const patterns: RegExp[] = [
        /\bkirim\w*\s+[^\n.!?]{0,50}?\b(share\s*location|shareloc|sharelock)\b/i,
        /\b(share\s*location|shareloc|sharelock)\b[^\n.!?]{0,40}?\bkirim\w*\b/i,
      ];
      for (const re of patterns) {
        let m: RegExpExecArray | null;
        re.lastIndex = 0;
        while ((m = re.exec(lower)) !== null) {
          const around = lower.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60);
          if (/dilarang menanyakan|tanpa menanyakan|tanpa meminta|jangan menanyakan|jangan meminta|tidak meminta/i.test(around)) {
            re.lastIndex = m.index + 1;
            continue;
          }
          return true;
        }
      }
      return false;
    };
    if (hasShareLocationSolicitation(finalReply) && shouldSendReply && !isEscalated && finalReply.trim()) {
      violationsDetected.push('shareloc_solicitation_detected');
      const locRepromptStartedAt = Date.now();
      let locRepromptOk = false;
      try {
        const locCorrectionNote = `KOREKSI LOKASI — tulis ulang SELURUH balasan dengan MAKNA yang SAMA, tetapi HAPUS anjuran/permintaan customer untuk mengirim share location (shareloc). Aturan klinik (Aturan Emas 21): DILARANG menodong alamat/shareloc. Cukup tanyakan nama kelurahan, desa, perumahan, atau patokan terdekat secara ramah. DILARANG memotong atau mutilasi kalimat di tengah.`;
        const locRetryData = await input.executeChat({
          payload: { model: selectedModel, messages: buildIsolatedRepromptMessages(finalReply, locCorrectionNote), temperature: 0.3 },
          tenantId, phone, conversationId, baseUrl, apiKey, selectedModel,
        });
        repromptCount++;
        const locRetryText = (locRetryData?.choices?.[0]?.message?.content || '').trim();
        if (locRetryText) {
          const locCleaned = OutputSanitizer.cleanOutboundReply(locRetryText, incomingText, isFollowUp, sanitizeOpts);
          if (!hasShareLocationSolicitation(locCleaned)) {
            finalReply = locCleaned;
            locRepromptOk = true;
            console.log(JSON.stringify({ event: 'SHARELOC_SOLICITATION_REPROMPT_FIXED', tenantId, conversationId, timestamp: new Date().toISOString() }));
            await input.recordCall({
              reply: finalReply, status: 'SUCCESS', durationMs: Date.now() - locRepromptStartedAt,
              promptPayload: { model: selectedModel, correction: 'shareloc_solicitation' },
              callReasoning: 'Hapus anjuran share location dari balasan', callSequence: 3,
            });
          }
        }
      } catch (repromptErr: any) {
        console.warn(JSON.stringify({ event: 'SHARELOC_SOLICITATION_REPROMPT_ERROR', tenantId, conversationId, error: repromptErr?.message, timestamp: new Date().toISOString() }));
      }
      if (!locRepromptOk) {
        // Anti-mutilasi: kirim balasan asli (pelanggaran gaya, bukan
        // halusinasi), catat untuk kurasi prompt — DILARANG memotong kalimat.
        violationsDetected.push('shareloc_solicitation_unresolved');
        console.warn(JSON.stringify({ event: 'SHARELOC_SOLICITATION_UNRESOLVED_KEEP_ORIGINAL', tenantId, conversationId, timestamp: new Date().toISOString() }));
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
    // Recovery grounded: bila DSML tag terlucuti jadi "" tapi katalog ada, pakai top service (bukan canned buntu).
    if (!isEscalated && shouldSendReply && !OutputSanitizer.isValidReply(finalReply)) {
      console.warn(JSON.stringify({ event: 'V3_AGENT_SANITIZER_REJECTED', tenantId, conversationId, phone: maskPhoneNumber(phone), reply: finalReply.slice(0, 100), timestamp: new Date().toISOString() }));
      const catalogTool = executedTools.find((t: any) => t.name === 'get_catalog_and_price' && (t as any).result?.treatments?.length > 0);
      const deliveryTool = executedTools.find((t: any) => t.name === 'calculate_delivery' && (t as any).result?.suggestedTemplateReply);
      // Plan Fase 4.2 (sesi 89-turn): recovery berbasis KONTEKS SESI — bila
      // customer sedang membahas treatment tertentu (selectedTreatment atau
      // riwayat cart), pulihkan dengan ringkasan katalog layanan itu, bukan
      // template kaleng buntu.
      const discussedName: string | undefined =
        session.selectedTreatment
        || (Array.isArray(session.cartItems) && session.cartItems.length > 0 ? session.cartItems[session.cartItems.length - 1]?.name : undefined)
        || undefined;
      const discussedService = discussedName
        ? (await import('../../../services/treatment-catalog.service')).treatmentCatalogService.searchCatalogItems(discussedName)[0]
        : undefined;
      if (catalogTool && (catalogTool as any).result?.treatments?.[0]) {
        const top: any = (catalogTool as any).result.treatments[0];
        const isMoms = top.category === 'MOMS';
        const { isFunnelCommitted } = await import('./phase-resolver');
        const committed = isFunnelCommitted(session);
        if (committed) {
          finalReply = `Untuk ${isMoms ? 'Bunda' : 'si kecil'}, kami sarankan *${top.name}* ya Bunda 😊\n\n${top.description}\n\nKira-kira rencana mau kami bantu jadwalkan di hari apa ya? 🤗`;
        } else {
          finalReply = `Untuk ${isMoms ? 'Bunda' : 'si kecil'}, kami sarankan *${top.name}* ya Bunda 😊\n\n${top.description}\n\nApakah Bunda tertarik untuk mencoba perawatan ini untuk si kecil? 🤗`;
        }
        console.warn(JSON.stringify({ event: 'CATALOG_RECOVERY_APPLIED', topService: top.name, funnelCommitted: committed, timestamp: new Date().toISOString() }));
      } else if (discussedService) {
        const { isFunnelCommitted } = await import('./phase-resolver');
        const committed = isFunnelCommitted(session);
        if (committed) {
          finalReply = `Untuk *${discussedService.name}* ya Bunda 😊\n\n${discussedService.description}\n\nKira-kira rencana mau kami bantu jadwalkan di hari apa ya? 🤗`;
        } else {
          finalReply = `Untuk *${discussedService.name}* ya Bunda 😊\n\n${discussedService.description}\n\nApakah Bunda tertarik untuk mencoba perawatan ini? 🤗`;
        }
        console.warn(JSON.stringify({ event: 'DISCUSSED_SERVICE_RECOVERY_APPLIED', service: discussedService.name, funnelCommitted: committed, timestamp: new Date().toISOString() }));
      } else if (deliveryTool && (deliveryTool as any).result?.suggestedTemplateReply) {
        // Grounded delivery recovery (sesi 648324): saat draf kosong akibat DSML
        // yang terlucuti tetapi data delivery resmi tersedia, gunakan template
        // resmi delivery — bukan kaleng buntu generik.
        let deliveryReply = String((deliveryTool as any).result.suggestedTemplateReply);
        const candName = (deliveryTool as any).args?.candidateTreatmentName;
        if (candName && typeof candName === 'string' && candName.trim()) {
          deliveryReply = `Untuk ${candName.trim()} — ${deliveryReply}`;
        }
        finalReply = deliveryReply;
        console.warn(JSON.stringify({ event: 'DELIVERY_RECOVERY_APPLIED', timestamp: new Date().toISOString() }));
      } else {
        const { getBrandIdentity } = await import('../../../config/brand');
        const brand = getBrandIdentity();
        finalReply = buildInvalidReplyFallback(isFollowUp, session.genderGreeting, brand.businessName);
      }
    }

    // PLAN 11 Fase 3.2 — funnel pacing reprompt: draf menanyakan hari padahal belum committed.
    // Detektor di OUTPUT level (bukan user intent), koreksi via tulis-ulang penuh (bukan mutilasi/potong kalimat).
    if (shouldSendReply && !isEscalated && finalReply && finalReply.trim()) {
      try {
        const { isFunnelCommitted } = await import('./phase-resolver');
        if (!isFunnelCommitted(session)) {
          const lower = finalReply.toLowerCase();
          const hasScheduleAsk = lower.includes('jadwalkan di hari apa') || lower.includes('hari apa ya') || lower.includes('jadwalkan untuk treatment');
          if (hasScheduleAsk && input.executeChat) {
            const correctionNote = `KOREKSI PACING — Customer BELUM menyetujui paket treatment (funnel EXPLORING/CONSIDERING). Draf Anda keliru menanyakan hari/jadwal kunjungan secara prematur. Tulis ulang SELURUH balasan TANPA menanyakan hari/jadwal/tanggal kunjungan; tutup HANYA dengan konfirmasi minat santun atau pertanyaan medis/usia yang relevan. DILARANG menambah contoh kalimat baru.`;
            const repromptData = await input.executeChat({
              payload: { model: selectedModel, messages: buildIsolatedRepromptMessages(finalReply, correctionNote), temperature: 0.3 },
              tenantId,
              phone,
              conversationId,
              baseUrl,
              apiKey,
              selectedModel,
            });
            const repromptText = (repromptData?.choices?.[0]?.message?.content || '').trim();
            if (repromptText) {
              const stillAsks = repromptText.toLowerCase().includes('jadwalkan di hari apa') || repromptText.toLowerCase().includes('hari apa ya');
              if (!stillAsks) {
                console.warn(JSON.stringify({ event: 'FUNNEL_REPROMPT_APPLIED', tenantId, conversationId, timestamp: new Date().toISOString() }));
                finalReply = repromptText;
                repromptCount++;
              } else {
                // Masih todong → jatuh ke fallback generik (tanpa tanya hari)
                const { getBrandIdentity } = await import('../../../config/brand');
                const brand = getBrandIdentity();
                finalReply = buildInvalidReplyFallback(isFollowUp, session.genderGreeting, brand.businessName);
                console.warn(JSON.stringify({ event: 'FUNNEL_REPROMPT_STILL_TODONG_FALLBACK', tenantId, conversationId, timestamp: new Date().toISOString() }));
              }
            }
          } else if (hasScheduleAsk && !input.executeChat) {
            // Tanpa executeChat (test/sim off) → tanpa mutilasi: biarkan, event saja (reprompt butuh LLM)
            console.warn(JSON.stringify({ event: 'FUNNEL_TODONG_DETECTED_NO_REPROMPT', tenantId, conversationId, timestamp: new Date().toISOString() }));
          }
        }
      } catch {}
    }

    // Deterministic Output Normalizer (Rule 1) di gate akhir: trimmer
    // 3-kalimat untuk balasan PROSA (termasuk multi-paragraf sapaan), TETAPI
    // senarai katalog/formulir terstruktur DILARANG dipotong. Nada pra-lokasi
    // ("bantu cekkan jangkauan") didelegasikan seutuhnya ke layer prompt
    // (location-rules.phase.ts) — tanpa manipulasi string pembuka di sini
    // (anti double-emoji & anti mid-sentence mutilation, plan regresi Fase 1).
    if (shouldSendReply && !isEscalated && finalReply && finalReply.trim()) {
      if (!OutputSanitizer.hasStructuredContent(finalReply)) {
        finalReply = OutputSanitizer.trimToMaxSentencesPreservingGreetingHeader(finalReply, 3);
      }
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
