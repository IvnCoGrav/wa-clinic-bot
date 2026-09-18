import { executeToolByName } from '../../tools/tool-registry';
import { validateToolArgs } from '../../tools/tool-schemas';
import { CustomerGoalSession, GoalTracker } from '../../state/goal-tracker';
import { maskPhoneNumber, maskToolArgsForLogging } from '../../../utils/pii-masker';
import type { GroundingOutput } from './context-grounder';
import type { V3RetrievedChunk } from '../agent-runner';

export interface ToolCallPayload {
  id?: string;
  function?: any;
}

export interface ExecutedToolResult {
  name: string;
  args: any;
  result: any;
}

export interface ToolExecutionInput {
  toolCalls: ToolCallPayload[];
  assistantMessage: any;
  session: CustomerGoalSession;
  tenantId: string;
  customerId?: string;
  phone: string;
  conversationId: string;
  chatId: string;
  conversationHistory: Array<{ role: string; content: string }>;
  cleanIncomingText: string;
  grounding: GroundingOutput;
  seenChunkKeys: Set<string>;
  retrievedChunks: V3RetrievedChunk[];
  /** Riwayat messages LLM turn ini (dimutasi: push assistant + hasil tool). */
  messages: any[];
}

export interface ToolExecutionOutput {
  executedTools: ExecutedToolResult[];
  updatedSession: CustomerGoalSession;
  isEscalated: boolean;
  escalateReason?: string;
  escalateSeverity?: string;
  selectedLocationText?: string;
  dayEvidenceViolation?: string;
  inquirePriceSignal: boolean;
  emptyKnowledgeResult: boolean;
}

/**
 * Bungkus promise dengan batas waktu aman (default 7 detik).
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    ),
  ]);
}

/**
 * Stage 2 & 3 — ToolExecutionPipeline: validasi argumen tool, pengayaan
 * kontekstual otomatis, eksekusi via registry, dan reduksi mutasi session
 * (state reducer terpusat — bukan mutasi tersebar).
 */
export class ToolExecutionPipeline {
  /**
   * Strict Tool Information Hiding (Rule 2) — gerbang payload LLM:
   * menyusun salinan hasil tool yang aman dikirim ke `messages` LLM. Field
   * internal ber-prefix `__internal` dan properti nominal yang sudah
   * disembunyikan DILARANG ikut. Ini lapisan pertahanan terakhir: meski tool
   * lupa menyembunyikan nominal, payload LLM tetap bersih bila `ongkirNormal`/
   * `ongkirPromo` bernilai undefined. State sesi memakai objek asli (lihat
   * applyToolEffectsToSession), bukan salinan ini.
   */
  public static buildLlmSafeToolPayload(fnName: string, toolResult: any): any {
    if (!toolResult || typeof toolResult !== 'object') return toolResult;
    const clone: any = { ...toolResult };
    for (const key of Object.keys(clone)) {
      if (key.startsWith('__internal')) delete clone[key];
    }
    return clone;
  }

  /**
   * Fase 1 — deteksi deterministik intent harga/ongkir/durasi dari teks nyata,
   * BUKAN dari boolean yang diisi LLM. Memakai `extractFastIntents` (kamus
   * terpusat, data-driven) sebagai sumber kebenaran. Murni & murah.
   */
  public static async detectPriceIntent(
    cleanIncomingText: string
  ): Promise<{ asksPrice: boolean; asksDuration: boolean; mentionsNominal: boolean }> {
    const text = cleanIncomingText || '';
    if (!text.trim()) return { asksPrice: false, asksDuration: false, mentionsNominal: false };
    try {
      const raw = text.toLowerCase();
      const intents = (await import('../persona')).extractFastIntents(text);
      // Deteksi nominal eksplisit (angka + satuan rupiah) — cermin hasNominalToken.
      const toks = raw.split(/\s+/).map((t) => t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')).filter(Boolean);
      const mentionsNominal = toks.some((t) => {
        if (t === 'rp' || t === 'ribu' || t === 'rb' || t === 'juta' || t === 'jt') return true;
        const c = t.charCodeAt(0);
        if (!(c >= 48 && c <= 57)) return false;
        return t.includes('rb') || t.includes('ribu') || t.includes('juta') || t.includes('jt') || t.includes('rp') || t.includes('k');
      });
      return {
        asksPrice: intents.includes('ask_price'),
        asksDuration: intents.includes('ask_duration'),
        mentionsNominal,
      };
    } catch {
      return { asksPrice: false, asksDuration: false, mentionsNominal: false };
    }
  }

  public static async execute(input: ToolExecutionInput): Promise<ToolExecutionOutput> {
    const {
      toolCalls, assistantMessage, tenantId, phone, conversationId,
      chatId, conversationHistory, cleanIncomingText,
    } = input;
    let { session } = input;

    const toolContext: any = {
      tenantId,
      customerId: input.customerId,
      conversationId,
      phone,
      chatId,
      selectedTreatment: session.selectedTreatment,
    };

    const executedTools: ExecutedToolResult[] = [];
    let isEscalated = false;
    let inquirePriceSignal = false;
    let emptyKnowledgeResult = false;

    input.messages.push(assistantMessage);

    let reservationCommitted = false;
    for (const tc of toolCalls) {
      const tcName = tc.function?.name;
      if (reservationCommitted) {
        console.warn(JSON.stringify({ event: 'V3_TOOL_POST_COMMIT_IGNORED', tool: tcName, tenantId, conversationId, timestamp: new Date().toISOString() }));
        continue;
      }
      const fnName = tc.function?.name;
      let fnArgs: any = {};
      try {
        fnArgs = typeof tc.function?.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : tc.function?.arguments || {};
      } catch (_) {}

      // ── Fase 1: Deterministic Tool-Arg Gate (anti-halusinasi router) ──
      // Aturan bisnis mutlak DILARANG diserahkan ke parameter boolean LLM
      // probabilistik. Log bukti (Kasus #9 T3): LLM mengisi
      // `asksDeliveryFee: true` pada pesan MURNI LOKASI → nominal ongkir bocor.
      // Seam ini menimpa argumen LLM deterministik dari teks customer via
      // `extractFastIntents` (satu sumber kebenaran intent ask_price/ongkir).
      const priceIntent = await ToolExecutionPipeline.detectPriceIntent(cleanIncomingText);
      if (fnName === 'calculate_delivery') {
        // Ongkir hanya boleh nominal bila customer eksplisit menanyakan harga/ongkir.
        fnArgs.asksDeliveryFee = priceIntent.asksPrice;
      }
      if (fnName === 'get_catalog_and_price') {
        // Mode konsultasi: tanpa pertanyaan harga eksplisit → harga disembunyikan.
        // Efek samping: state-reducer hanya men-set `priceDiscussed` bila arg ini
        // true, sehingga sinyal `inquirePrice` liar dari LLM tak lagi membuka
        // mode transaksional (gate gabungan deterministik + tool signal).
        fnArgs.inquirePrice = priceIntent.asksPrice;
        // Anti-halusinasi nominal: `targetPrice` (pemicu showPrices) HANYA sah
        // bila customer benar-benar menyebut nominal angka. LLM sempat mengisi
        // targetPrice:60000 pada pesan "1 jam" → membuka seluruh harga katalog.
        if (!priceIntent.mentionsNominal) {
          delete fnArgs.targetPrice;
        }
        // Catatan: `asksDuration` TIDAK dipaksa di sini — durasi sering berupa
        // jawaban lintas-turn ("1 jam") yang wajar; kebocoran utamanya adalah
        // harga via targetPrice, yang sudah ditutup di atas.
      }

      // Pengayaan deterministik: bila LLM memanggil save_reservation tanpa
      // data ibu padahal session.momProfile sudah diketahui dari turn
      // sebelumnya, suntikkan agar usia kehamilan tidak hilang saat booking.
      if (fnName === 'save_reservation' && session.momProfile) {
        if (fnArgs.gestationalWeeks == null && session.momProfile.gestationalWeeks != null) {
          fnArgs.gestationalWeeks = session.momProfile.gestationalWeeks;
        }
        if (fnArgs.momStage == null && session.momProfile.stage != null) {
          fnArgs.momStage = session.momProfile.stage;
        }
        if ((fnArgs.momNotes == null || fnArgs.momNotes === '') && (session.momProfile.complaints || []).length > 0) {
          fnArgs.momNotes = session.momProfile.complaints.join(', ');
        }
      }

      // Fase 4' (Turn 4: presisi usia & durasi): bila LLM memanggil
      // get_catalog_and_price tanpa usia anak padahal profil sesi sudah tahu
      // (mis. balita 2 tahun), suntikkan agar filter tier usia + peringkat
      // katalog tepat — cermin pola pengayaan momProfile di atas.
      if (fnName === 'get_catalog_and_price') {
        if (fnArgs.childAgeMonths == null) {
          const sessionChildAge = (session as any).childProfile?.ageMonths
            ?? (session as any).children?.[0]?.ageMonths ?? null;
          if (typeof sessionChildAge === 'number') fnArgs.childAgeMonths = sessionChildAge;
        }
      }

      console.log(`[V3 AGENT TOOL EXECUTE] Tool: "${fnName}", Args:`, JSON.stringify(maskToolArgsForLogging(fnName, fnArgs)));

      const validation = validateToolArgs(fnName, fnArgs);
      let toolResult: any;
      if (!validation.success) {
        console.warn(JSON.stringify({ event: 'V3_TOOL_SCHEMA_REJECTED', tenantId, conversationId, phone: maskPhoneNumber(phone), tool: fnName, error: validation.error, timestamp: new Date().toISOString() }));
        toolResult = { error: validation.error };
      } else {
        const TOOL_TIMEOUT_MS = fnName === 'calculate_delivery' ? 12000 : 7000;
        try {
          // Phase 2 (audit 315036): snapshot keranjang terbaru disuntik ke
          // konteks tool agar calculate_delivery bisa mengagregasikan
          // subtotal + ongkir + grand total di outputnya (anti total hilang).
          toolContext.cartSnapshot = (session.cartItems || []).map((it) => ({
            name: it.name,
            price: it.price,
            promoPrice: it.promoPrice,
          }));
          // Audit 337101: snapshot waktu yang diminta (kesepakatan menang
          // atas petunjuk inquiry) agar CTA ongkir context-aware.
          toolContext.preferredDateSnapshot =
            session.booking?.preferredDate || session.booking?.requestedTimeHint || undefined;
          // Audit 694493: gate mode konsultasi vs transaksional untuk calculate_delivery.
          toolContext.priceDiscussedSnapshot = Boolean(session.priceDiscussed);
          // Audit 833178: jejak pesan user untuk Day Evidence Gate
          // save_reservation (anti "Besok" karangan — tanpa bukti = tolak).
          toolContext.recentUserTexts = [
            ...conversationHistory
              .filter((h) => h.role === 'user')
              .map((h) => h.content),
            cleanIncomingText,
          ];
          // Phase 4 (audit 222655): snapshot ongkir sesi agar
          // get_catalog_and_price menyusun template total otomatis.
          // Fase 4' (anti-kaset rusak): sertakan keluhan yang SUDAH diketahui
          // sesi (agregat deterministik cermin formatGoalSessionForPrompt) agar
          // tool tak menanyakan ulang keluhan yang sudah disampaikan customer.
          const pipeChildSymptoms: string[] = [
            ...((session as any).childProfile?.symptoms || []),
            ...(((session as any).children || []).flatMap((c: any) => c?.symptoms || [])),
          ];
          const pipeMomComplaints: string[] = [...(((session as any).momProfile?.complaints || []) as string[])];
          const pipeIsMomSubject = (session as any).targetAudience === 'MOMS'
            || (session as any).targetAudience === 'BOTH'
            || Boolean((session as any).momProfile?.gestationalWeeks != null || (session as any).momProfile?.stage);
          const pipeKnownSymptoms: string[] = (pipeIsMomSubject && pipeMomComplaints.length > 0 && pipeChildSymptoms.length === 0
            ? pipeMomComplaints
            : [...pipeChildSymptoms, ...((session as any).targetAudience === 'BOTH' ? pipeMomComplaints : [])]
          ).filter((s, i, arr) => arr.indexOf(s) === i);
          toolContext.locationSnapshot = session.location
            ? {
                kelurahan: session.location.kelurahan,
                ongkirPromo: session.location.ongkirPromo,
                ongkirNormal: session.location.ongkirNormal,
                ongkirStatus: session.ongkirStatus,
                knownSymptoms: pipeKnownSymptoms,
              }
            : (pipeKnownSymptoms.length > 0 ? { knownSymptoms: pipeKnownSymptoms } : undefined);
          toolResult = await withTimeout(
            executeToolByName(fnName, validation.data, toolContext),
            TOOL_TIMEOUT_MS,
            `Tool "${fnName}" timeout setelah ${TOOL_TIMEOUT_MS}ms`
          );
        } catch (toolErr: any) {
          console.warn(JSON.stringify({ event: 'V3_TOOL_TIMEOUT_ERROR', tenantId, conversationId, phone: maskPhoneNumber(phone), tool: fnName, error: toolErr.message, timestamp: new Date().toISOString() }));
          toolResult = { error: toolErr.message };
        }
      }

      executedTools.push({ name: fnName, args: fnArgs, result: toolResult });

      // Grounding kosong: tool dipanggil tapi knowledge base tak punya jawaban.
      if (fnName === 'search_knowledge_faq' && Array.isArray(toolResult?.chunks) && toolResult.chunks.length === 0) {
        emptyKnowledgeResult = true;
      }

      // Observability: tampung RAG chunks — pakai skor riil (similarity/score/rank) jika ada, fallback 0.90 hanya bila tidak ada.
      if (fnName === 'search_knowledge_faq' && Array.isArray(toolResult?.chunks)) {
        for (const c of toolResult.chunks) {
          const key = String(c?.id || c?.title || '');
          if (key && !input.seenChunkKeys.has(key)) {
            input.seenChunkKeys.add(key);
            const realScore = typeof c?.similarity === 'number' ? c.similarity : (typeof c?.score === 'number' ? c.score : (typeof (c as any)?.rank === 'number' ? (c as any).rank : null));
            input.retrievedChunks.push({
              id: String(c?.id || key),
              title: String(c?.title || ''),
              content: String(c?.content || ''),
              similarity: realScore !== null ? realScore : 0.90,
              score: realScore !== null ? realScore : 0.90,
            } as any);
          }
        }
      }

      // State reducer: perbarui session state berdasarkan hasil tool.
      const reduced = await ToolExecutionPipeline.applyToolEffectsToSession({
        fnName,
        fnArgs,
        toolResult,
        session,
        tenantId,
        conversationId,
        phone,
        cleanIncomingText,
        seenChunkKeys: input.seenChunkKeys,
        retrievedChunks: input.retrievedChunks,
      });
      session = reduced.session;
      if (fnName === 'escalate_to_human') isEscalated = true;
      if (fnName === 'get_catalog_and_price' && fnArgs.inquirePrice === true) inquirePriceSignal = true;

      input.messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        name: fnName,
        content: typeof toolResult === 'string' ? toolResult : JSON.stringify(
          ToolExecutionPipeline.buildLlmSafeToolPayload(fnName, toolResult)
        ),
      });

      if (fnName === 'save_reservation' && toolResult?.success === true) {
        reservationCommitted = true;
      }
    }

    return {
      executedTools,
      updatedSession: session,
      isEscalated,
      inquirePriceSignal,
      emptyKnowledgeResult,
    };
  }

  private static async applyToolEffectsToSession(args: {
    fnName: string;
    fnArgs: any;
    toolResult: any;
    session: CustomerGoalSession;
    tenantId: string;
    conversationId: string;
    phone: string;
    cleanIncomingText: string;
    seenChunkKeys: Set<string>;
    retrievedChunks: V3RetrievedChunk[];
  }): Promise<{ session: CustomerGoalSession }> {
    const { fnName, fnArgs, toolResult, tenantId, conversationId, cleanIncomingText } = args;
    let { session } = args;

    if (fnName === 'calculate_delivery' && toolResult.success) {
      session = await GoalTracker.updateGoalSession(conversationId, {
        location: {
          rawText: fnArgs.locationText,
          kelurahan: toolResult.kelurahan,
          kecamatan: toolResult.kecamatan,
          kota: toolResult.kota,
          distanceKm: toolResult.distanceKm ?? toolResult.__internalDistanceKm,
          // Rule 2: nilai nominal asli disimpan dari field internal saat
          // disembunyikan dari payload LLM (ongkirNormal/Promo = undefined).
          ongkirNormal: toolResult.ongkirNormal ?? toolResult.__internalOngkirNormal,
          ongkirPromo: toolResult.ongkirPromo ?? toolResult.__internalOngkirPromo,
          isOutOfCoverage: toolResult.isOutOfCoverage,
        },
      }, tenantId);
      // Lifecycle ongkir: hasil kalkulasi akan disampaikan ke customer → QUOTED.
      // Estimasi sentroid kecamatan BUKAN kutipan pasti → jangan tandai QUOTED.
      if (!toolResult.isOutOfCoverage && !toolResult.isEstimatedCentroid) {
        session = await GoalTracker.markOngkirQuoted(conversationId, tenantId);
      }
    } else if (fnName === 'get_catalog_and_price' && toolResult.success) {
      // Audit 854065: inquirePrice eksplisit dari LLM = sinyal transaksional.
      if (fnArgs.inquirePrice === true && !session.priceDiscussed) {
        try {
          session = await GoalTracker.updateGoalSession(conversationId, { priceDiscussed: true }, tenantId);
        } catch (e) {}
      }
      // Unified Knowledge Observability: daftarkan spesifikasi katalog resmi
      // ke trace retrievedChunks agar Inspector menampilkan seluruh ground truth
      // (artikel SOP + katalog layanan) yang dipakai LLM di Call 2.
      try {
        if (Array.isArray(toolResult.treatments)) {
          for (const t of toolResult.treatments.slice(0, 5)) {
            const key = `catalog-${String(t?.id || t?.name || '')}`;
            if (key && !args.seenChunkKeys.has(key)) {
              args.seenChunkKeys.add(key);
              args.retrievedChunks.push({
                id: key,
                title: `[Katalog Layanan] ${String(t?.name || '')}`,
                content: `${String(t?.description || '')}\nKategori: ${String(t?.category || '')}${typeof t?.durationMinutes === 'number' ? `, Durasi: ${Number(t.durationMinutes)} menit` : ''}, Promo: Rp ${Number(t?.promoPrice || 0).toLocaleString('id-ID')}`,
                similarity: 1.0,
                score: 1.0,
              } as any);
            }
          }
        }
      } catch (_) {}
      // Fondasional sesi 973126: get_catalog_and_price adalah tool READ-ONLY.
      // Tanya katalog/harga/konsultasi gejala DILARANG mengunci
      // session.selectedTreatment. Status paket HANYA diset via
      // persetujuan eksplisit customer (GoalTracker.detectAgreedTreatment
      // khusus pesan user, afirmasi swap, atau save_reservation).
      // Blok auto-locking warisan (treatments[0] fallback) dihapus total.
      void fnArgs;
      void toolResult;
      // Audience-aware routing (anti cross-contamination 100% di tingkat tool):
      // MOMS/gestationalWeeks/momStage -> momProfile; BABY/KIDS/childAgeMonths -> children.
      const isMomArgs = fnArgs.category === 'MOMS' || fnArgs.category === 'BOTH'
        || fnArgs.gestationalWeeks != null || fnArgs.momStage != null;
      const isChildArgs = fnArgs.category === 'BABY' || fnArgs.category === 'KIDS' || fnArgs.category === 'BOTH'
        || fnArgs.childAgeMonths != null;
      if (isMomArgs) {
        const prevMom = session.momProfile || { complaints: [] as string[] };
        const mergedComplaints = [...(prevMom.complaints || [])];
        for (const s of (fnArgs.symptoms || [])) {
          if (s && !mergedComplaints.includes(s)) mergedComplaints.push(s);
        }
        const patch: any = { complaints: mergedComplaints };
        if (fnArgs.gestationalWeeks != null) patch.gestationalWeeks = fnArgs.gestationalWeeks;
        if (fnArgs.momStage != null) patch.stage = fnArgs.momStage;
        else if (!prevMom.stage && fnArgs.category === 'MOMS') patch.stage = 'GENERAL';
        session = await GoalTracker.updateGoalSession(conversationId, {
          momProfile: { ...prevMom, ...patch },
          ...(fnArgs.category ? { targetAudience: fnArgs.category as any } : {}),
        }, tenantId);
      }
      if (isChildArgs && (fnArgs.childAgeMonths != null || (fnArgs.symptoms && fnArgs.symptoms.length > 0))) {
        // BOTH: gejala anak tetap dicatat ke anak; MOMS-only: JANGAN timpa anak.
        const shouldWriteChild = fnArgs.category !== 'MOMS' || fnArgs.childAgeMonths != null;
        if (shouldWriteChild) {
          const childSymptoms = fnArgs.category === 'BOTH' ? (fnArgs.symptoms || []) : (fnArgs.category === 'MOMS' ? [] : (fnArgs.symptoms || []));
          if (fnArgs.childAgeMonths != null || childSymptoms.length > 0) {
            const prevChild = session.childProfile || { symptoms: [] as string[] };
            const merged = [...(prevChild.symptoms || [])];
            for (const s of childSymptoms) {
              if (s && !merged.includes(s)) merged.push(s);
            }
            session = await GoalTracker.updateGoalSession(conversationId, {
              childProfile: {
                ageMonths: fnArgs.childAgeMonths ?? (prevChild as any).ageMonths,
                symptoms: merged,
              } as any,
            }, tenantId);
          }
        }
      } else if (!isMomArgs && !isChildArgs && fnArgs.symptoms && fnArgs.symptoms.length > 0) {
        // Fallback lama: tanpa kategori eksplisit, perlakukan sebagai gejala anak
        // KECUALI pesan murni maternal (sudah ditangani momProfile via syncMomProfile).
        if (!GoalTracker.isMaternalOnlyMessage(cleanIncomingText)) {
          session = await GoalTracker.updateGoalSession(conversationId, {
            childProfile: {
              ageMonths: fnArgs.childAgeMonths,
              symptoms: fnArgs.symptoms || [],
            },
          }, tenantId);
        }
      }
    } else if (fnName === 'save_reservation' && toolResult.success) {
      // Reservasi tercatat sebagai pending (ketersediaan dicekkan tim Bidan);
      // isConfirmed tetap false agar state = RESERVATION_SENT, bukan COMPLETED.
      // Skema 462651: tandai butuh verifikasi staf agar acknowledgement
      // berikutnya (oke/siap) memicu 1x closing + handoff, bukan loop LLM.
      session = await GoalTracker.updateGoalSession(conversationId, {
        selectedTreatment: fnArgs.treatmentName,
        booking: {
          preferredDate: fnArgs.bookingDate,
          preferredTime: fnArgs.bookingTime,
          reservationId: toolResult.reservationId,
          isConfirmed: false,
          needsStaffVerification: true,
          handoffClosingSent: false,
        },
      }, tenantId);
    }
    // escalate_to_human: tanpa mutasi session (flag isEscalated di level execute).

    return { session };
  }
}
