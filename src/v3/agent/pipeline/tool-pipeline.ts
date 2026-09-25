import { executeToolByName } from '../../tools/tool-registry';
import { validateToolArgs } from '../../tools/tool-schemas';
import { CustomerGoalSession, GoalTracker } from '../../state/goal-tracker';
import { treatmentCatalogService, resolveServiceAudience } from '../../../services/treatment-catalog.service';
import { maskPhoneNumber, maskToolArgsForLogging } from '../../../utils/pii-masker';
import { TEMPLATES } from '../../../config/persona';
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
    // Dekomposisi Arsitektur Tool (Fase 2 — Pure Structured Data):
    // Hapus seluruh template prosa customer-facing siap-saji dari context LLM.
    // Tool bertugas mengembalikan fakta logistik/katalog terstruktur, BUKAN
    // mendiktekan salinan kalimat percakapan ke LLM (anti parrot-effect).
    delete clone.suggestedTemplateReply;
    delete clone.suggestedPriceReply;
    delete clone.suggestedConsultationReply;
    // Jika message memuat blok "Format penyampaian yang disarankan: ...",
    // pangkas hanya fakta inti teknisnya saja.
    if (typeof clone.message === 'string' && clone.message.includes('Format penyampaian yang disarankan:')) {
      const parts = clone.message.split('Format penyampaian yang disarankan:');
      clone.message = parts[0].trim();
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

  /**
   * Carry-over intent ongkir berbasis STATE (bukan pola kalimat). Bila customer
   * sudah pernah masuk mode transaksional (`priceDiscussed`) dan sesi sudah
   * memiliki lokasi, nominal ongkir tetap sah pada giliran lanjutan (mis.
   * customer membandingkan lokasi). Pure function — testable tanpa pipeline penuh.
   */
  public static shouldCarryOverDeliveryFee(
    session: Pick<CustomerGoalSession, 'priceDiscussed' | 'location'> | undefined
  ): boolean {
    const hasLocationState = !!(session?.location?.kelurahan || session?.location?.kecamatan);
    return session?.priceDiscussed === true && hasLocationState;
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
        // Verbatim Gate (wdoro→Wonodoro): tolak halusinasi elongasi LLM.
        // Jika locationText LLM tak punya irisan token dengan cleanIncomingText,
        // cari entitas gazetteer verbatim di teks asli customer dan pakai itu.
        // WAJIB sebelum stale-strip agar prefiks basi tidak mengaburkan cek overlap.
        if (typeof fnArgs.locationText === 'string' && typeof cleanIncomingText === 'string') {
          const origLower = cleanIncomingText.toLowerCase();
          const origToks = new Set(origLower.split(/[^a-z0-9]+/).filter((w: string) => w.length >= 2));
          const locToks = (fnArgs.locationText || '').toLowerCase().split(/[^a-z0-9]+/).filter((w: string) => w.length >= 2);
          // P1-5: hasOverlap hanya untuk token entitas (bukan token generik kak/berapa)
          // + toleransi typo 1-huruf, agar "wdoro" vs "wedoro" dianggap overlap
          const genericChat = new Set(['berapa','berapaan','harga','tarif','ongkir','kak','bunda','bund','min','mas','mbak','gan','sis','kakak','ya','kok','sih','dong','aja','saja']);
          const plausibleOrigToks = Array.from(origToks).filter((t) => t.length >= 4 && !genericChat.has(t));
          let hasOverlap = false;
          try {
            const { isTypoAtMostOne } = require('../../../utils/typo-match');
            for (const lt of locToks) {
              for (const ot of plausibleOrigToks) {
                if (lt === ot) { hasOverlap = true; break; }
                if (lt.length >= 5 && ot.length >= 5 && isTypoAtMostOne(lt, ot)) { hasOverlap = true; break; }
              }
              if (hasOverlap) break;
            }
          } catch {
            hasOverlap = locToks.some((t: string) => (plausibleOrigToks as any).includes(t));
          }
          if (!hasOverlap && locToks.length > 0) {
            try {
              const { getGazetteerData } = await import('../../../utils/gazetteer');
              const { isTypoAtMostOne } = await import('../../../utils/typo-match');
              const data = getGazetteerData();
              const cleanLower = cleanIncomingText.toLowerCase();
              const cleanToks = cleanLower.split(/[^a-z0-9]+/).filter((t: string) => t.length >= 3);
              let verbatim: string | null = null;
              for (const d of data) {
                const kel = (d.Kelurahan_Desa || '').toLowerCase();
                if (!kel || kel.length < 4) continue;
                if (cleanLower.includes(kel)) { verbatim = d.Kelurahan_Desa; break; }
                for (const ct of cleanToks) {
                  if (ct.length >= 5 && (kel.length >= 5) && isTypoAtMostOne(ct, kel)) { verbatim = d.Kelurahan_Desa; break; }
                }
                if (verbatim) break;
              }
              if (!verbatim) {
                for (const d of data) {
                  const kec = (d.Kecamatan || '').toLowerCase();
                  if (!kec || kec.length < 4) continue;
                  if (cleanLower.includes(kec)) { verbatim = d.Kecamatan; break; }
                  for (const ct of cleanToks) {
                    if (ct.length >= 5 && kec.length >= 5 && isTypoAtMostOne(ct, kec)) { verbatim = d.Kecamatan; break; }
                  }
                  if (verbatim) break;
                }
              }
              if (verbatim) fnArgs.locationText = verbatim;
            } catch {}
          }
        }
        // RC-4 (sesi 535222): router Call 1 dapat menggabungkan wilayah BASI
        // (kecamatan yang sudah dikenal sesi) dengan entitas BARU ("Buduran
        // Bungurasih"). Guard deterministik membuang prefiks basi agar hanya
        // entitas baru yang di-geocode. Fail-open bila tak ada wilayah basi.
        if (typeof fnArgs.locationText === 'string') {
          const { stripStaleRegionPrefix } = await import('../../tools/entity-concatenation-guard');
          fnArgs.locationText = stripStaleRegionPrefix(fnArgs.locationText, session.location);
          // Integritas entitas: LLM memotong "kelurahan jambangan" → "Jambangan"
          // padahal gazetteer butuh kata penjelas untuk bedakan kelurahan vs
          // kecamatan luas (dual-admin Jambangan). Guard deterministik: bila
          // teks asli mengandung "kelurahan"/"desa" tapi locationText tidak,
          // kembalikan prefix administratif.
          const lowerOriginal = (cleanIncomingText || '').toLowerCase();
          const lowerLoc = (fnArgs.locationText || '').toLowerCase();
          if (lowerOriginal.includes('kelurahan') && !lowerLoc.includes('kelurahan')) {
            fnArgs.locationText = `kelurahan ${fnArgs.locationText}`.trim();
          } else if (lowerOriginal.includes('desa') && !lowerLoc.includes('desa') && !lowerLoc.includes('kelurahan')) {
            fnArgs.locationText = `desa ${fnArgs.locationText}`.trim();
          }
        }
        // Ongkir hanya boleh nominal bila customer eksplisit menanyakan harga/ongkir.
        // Carry-over berbasis STATE (bukan pola kalimat): bila customer sudah pernah
        // masuk mode transaksional (`session.priceDiscussed`) dan giliran ini menyebut
        // lokasi baru, nominal ongkir tetap sah disampaikan — mencegah intent hilang
        // saat customer membandingkan lokasi ("kalau ke X?").
        const carryOver = ToolExecutionPipeline.shouldCarryOverDeliveryFee(session);
        fnArgs.asksDeliveryFee = priceIntent.asksPrice || carryOver;
      }
      if (fnName === 'get_catalog_and_price') {
        // P1-3: gate specificTreatmentName — hanya teruskan bila muncul di pesan user turn ini
        if (typeof fnArgs.specificTreatmentName === 'string' && fnArgs.specificTreatmentName.trim()) {
          const needle = fnArgs.specificTreatmentName.toLowerCase().trim();
          const hay = (cleanIncomingText || '').toLowerCase();
          // normalisasi: hilangkan tanda baca, spasi ganda
          const normHay = hay.replace(/[^a-z0-9]+/g, ' ').trim();
          const normNeedle = needle.replace(/[^a-z0-9]+/g, ' ').trim();
          const appears = normHay.includes(normNeedle) || normNeedle.split(' ').some((tok: string) => tok.length >= 4 && normHay.includes(tok));
          if (!appears) {
            delete fnArgs.specificTreatmentName;
          }
        }
        fnArgs.inquirePrice = priceIntent.asksPrice;
        if (!priceIntent.mentionsNominal) {
          delete fnArgs.targetPrice;
        }
        fnArgs.asksDuration = priceIntent.asksDuration;
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
          // Plan regresi Fase 3+5: teruskan riwayat konsultasi & audiens sesi
          // agar tool katalog audience-aware (anti skrining ulang).
          const pipeDiscussed: string[] = Array.isArray((session as any).discussedTreatments)
            ? (session as any).discussedTreatments.filter((n: any) => typeof n === 'string' && n.length > 0)
            : [];
          const pipeTargetAudience: string | undefined =
            typeof (session as any).targetAudience === 'string' ? (session as any).targetAudience : undefined;
          const pipeAudienceCtx = {
            ...(pipeDiscussed.length > 0 ? { discussedTreatments: pipeDiscussed } : {}),
            ...(pipeTargetAudience ? { targetAudience: pipeTargetAudience } : {}),
          };
          toolContext.locationSnapshot = session.location
            ? {
                kelurahan: session.location.kelurahan,
                ongkirPromo: session.location.ongkirPromo,
                ongkirNormal: session.location.ongkirNormal,
                ongkirStatus: session.ongkirStatus,
                knownSymptoms: pipeKnownSymptoms,
                incomingText: cleanIncomingText,
                ...pipeAudienceCtx,
              }
            : (pipeKnownSymptoms.length > 0 || pipeDiscussed.length > 0 || pipeTargetAudience
              ? { knownSymptoms: pipeKnownSymptoms, incomingText: cleanIncomingText, ...pipeAudienceCtx }
              : { incomingText: cleanIncomingText } as any);
          toolResult = await withTimeout(
            executeToolByName(fnName, validation.data, toolContext),
            TOOL_TIMEOUT_MS,
            `Tool "${fnName}" timeout setelah ${TOOL_TIMEOUT_MS}ms`
          );
        } catch (toolErr: any) {
          console.warn(JSON.stringify({ event: 'V3_TOOL_TIMEOUT_ERROR', tenantId, conversationId, phone: maskPhoneNumber(phone), tool: fnName, error: toolErr.message, timestamp: new Date().toISOString() }));
          if (fnName === 'calculate_delivery') {
            // Kontrak pemulihan fondasional: Call 2 menerima jangkar terstruktur
            // (bukan error mentah) — konfirmasi jangkauan + minta kelurahan,
            // TANPA nominal. Template via TEMPLATES terpusat (tenant-aware).
            toolResult = {
              success: false,
              isPrecise: false,
              isOutOfCoverage: false,
              error: toolErr.message,
              suggestedTemplateReply: TEMPLATES.askKelurahanRetry({
                textLocation: String((fnArgs as any)?.locationText || 'area tersebut'),
                currentAttempts: 1,
              }),
              message: `Perhitungan jarak otomatis terkendala teknis (${toolErr.message}). Sampaikan bahwa area tersebut masuk jangkauan layanan homecare kami, lalu tanyakan nama kelurahan atau perumahan spesifik agar Bidan kami dapat memastikan jarak dan rutenya. DILARANG menyebut nominal jarak maupun ongkir.`,
            };
          } else {
            toolResult = { error: toolErr.message };
          }
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
      // Auto-sync Google Contacts saat kelurahan/kecamatan baru terverifikasi di chat.
      // Jalur chat V3 persist via mirror GoalTracker (bukan customerService) sehingga
      // hook updateCustomerLocation tidak terpicu — sinkronisasi eksplisit non-blocking.
      // customerId di-resolve via conversation (CustomerGoalSession tidak membawa customerId).
      if (toolResult.kelurahan || toolResult.kecamatan) {
        void (async () => {
          try {
            const { prisma } = await import('../../../db/client');
            const conv = await prisma.conversation.findUnique({
              where: { id: conversationId },
              select: { customer_id: true },
            });
            const resolvedId = (conv as any)?.customer_id as string | undefined;
            if (!resolvedId) return;
            const { googleContactsService } = await import('../../../services/google-contacts.service');
            await googleContactsService.syncCustomer(tenantId, resolvedId, { trigger: 'chat' }).catch(() => {});
          } catch {}
        })();
      }
      // Lifecycle ongkir (RC-3, sesi 535222; diperluas sesi 779408): QUOTED sah
      // bila nominal ongkir BENAR-BENAR diekspos ke LLM/customer. Kontrak baru:
      // ekspos terjadi bila customer menanya biaya (asksDeliveryFee) ATAU lokasi
      // terverifikasi presisi (ongkirPromo tersedia & bukan centroid). Estimasi
      // sentroid kecamatan BUKAN kutipan pasti → tetap jangan tandai QUOTED.
      const ongkirExposed =
        !toolResult.isOutOfCoverage &&
        !toolResult.isEstimatedCentroid &&
        (fnArgs.asksDeliveryFee === true || typeof toolResult.ongkirPromo === 'number');
      if (ongkirExposed) {
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
      // Fondasional BOTH: partisi gejala data-driven (bukan broadcast ke dua profil)
      const partitionBothSymptoms = (syms: string[]): { mom: string[]; child: string[] } => {
        if (!syms || syms.length === 0) return { mom: [], child: [] };
        try {
          const all = treatmentCatalogService.getAllServices(true, tenantId) || [];
          const byId = new Map(all.map((s: any) => [(s?.id || '').toLowerCase(), s]));
          const isMomService = (s: any): boolean => {
            if (s.category === 'MOMS') return true;
            if (s.category === 'BUNDLE') {
              try { return resolveServiceAudience(s as any, (id: string) => byId.get(id.toLowerCase())) === 'MOMS'; } catch { return false; }
            }
            return false;
          };
          const isChildService = (s: any): boolean => {
            if (s.category === 'BABY' || s.category === 'KIDS') return true;
            if (s.category === 'BUNDLE') {
              try { return resolveServiceAudience(s as any, (id: string) => byId.get(id.toLowerCase())) !== 'MOMS'; } catch { return true; }
            }
            return false;
          };
          const momPool = all.filter(isMomService);
          const childPool = all.filter(isChildService);
          const scoreAgainst = (symLower: string, pool: any[]): number => {
            let best = 0;
            for (const svc of pool) {
              const hay = `${svc.name || ''} ${svc.description || ''}`.toLowerCase();
              if (hay.includes(symLower)) {
                const inName = (svc.name || '').toLowerCase().includes(symLower) ? 4 : 0;
                best = Math.max(best, inName || 2);
              } else {
                for (const tok of symLower.split(/[^a-z0-9]+/).filter((w: string) => w.length > 2)) {
                  if ((svc.name || '').toLowerCase().includes(tok)) { best = Math.max(best, 4); break; }
                  if ((svc.description || '').toLowerCase().includes(tok)) best = Math.max(best, 2);
                }
              }
            }
            return best;
          };
          const mom: string[] = [];
          const child: string[] = [];
          for (const raw of syms) {
            const lower = String(raw || '').toLowerCase().trim();
            if (!lower) continue;
            const momScore = scoreAgainst(lower, momPool);
            const childScore = scoreAgainst(lower, childPool);
            if (momScore > childScore) mom.push(raw);
            else if (childScore > momScore) child.push(raw);
            else {
              // Tie: maternal keywords eksplisit → mom, selain itu child (data-driven fallback)
              const maternalTie = ['hamil','nifas','menyusui','laktasi','oksitosin','payudara','perineum','prenatal','postpartum','pegal','relaksasi'].some((k) => lower.includes(k));
              if (maternalTie) mom.push(raw); else child.push(raw);
            }
          }
          // Jika partisi kosong salah satu sisi (gejala ambigu) → jangan hilangkan: biarkan sisi yang ada
          return { mom, child };
        } catch {
          return { mom: [], child: [...syms] };
        }
      };
      if (isMomArgs) {
        const prevMom = session.momProfile || { complaints: [] as string[] };
        const mergedComplaints = [...(prevMom.complaints || [])];
        const momSymptoms = fnArgs.category === 'BOTH' ? partitionBothSymptoms(fnArgs.symptoms || []).mom : (fnArgs.symptoms || []);
        for (const s of momSymptoms) {
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
          const childSymptoms = fnArgs.category === 'BOTH' ? partitionBothSymptoms(fnArgs.symptoms || []).child : (fnArgs.category === 'MOMS' ? [] : (fnArgs.symptoms || []));
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
      // Reset bookingCommitConfirmed agar turn berikutnya tidak otomatis membuka save_reservation.
      session = await GoalTracker.updateGoalSession(conversationId, {
        selectedTreatment: fnArgs.treatmentName,
        bookingCommitConfirmed: false,
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
