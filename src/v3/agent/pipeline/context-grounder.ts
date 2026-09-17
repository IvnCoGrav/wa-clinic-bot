/**
 * Stage 1 — ContextGrounder: deteksi sinyal percakapan, derivasi fase,
 * pelabelan internal jadwal, dan pra-pengambilan pengetahuan (Hybrid RAG).
 * Bebas dari panggilan LLM router.
 *
 * Fase 2 (dekomposisi god module): logika domain tinggal di modul terfokus —
 * fast-response-gate.ts, medical-signal-detector.ts, booking-commit-gate.ts,
 * phase-resolver.ts. Berkas ini adalah lean coordinator (prepareSession,
 * applySessionLatches, buildContextSummary, ground) + fasad kompatibilitas:
 * seluruh impor lama (`ContextGrounder.X`, `FastResponseGate`, tipe, konstanta)
 * tetap berfungsi 100% tanpa perubahan (zero breaking changes).
 */
import { CustomerGoalSession, GoalTracker } from '../../state/goal-tracker';
import { V3ConversationSummarizer } from '../../state/conversation-summarizer';
import { ConversationState } from '@prisma/client';
import type { AgentRunnerOutput, V3RetrievedChunk } from '../agent-runner';
import {
  deriveConversationPhase,
  buildPhaseDirective,
  deriveConversationState,
} from './phase-resolver';
import type { ConversationPhase } from './phase-resolver';
import {
  isBookingCommitReady,
  detectAgreedTreatment,
} from './booking-commit-gate';
import {
  hasScheduleSignal,
  assignInternalScheduleLabel,
  hasFallInjurySignal,
  extractTimeHint,
  hasVaccineSignal,
  isSubstantiveForPreGrounding,
} from './medical-signal-detector';
import {
  FastResponseGate,
  isShortAcknowledgement,
  resolvePostReservationAck,
  POST_RESERVATION_CLOSING,
  POST_SCHEDULE_CHECK_CLOSING,
} from './fast-response-gate';
import type { FastGateArgs, FastGateResult } from './fast-response-gate';

// Re-export total: pemanggil lama & unit test tak perlu mengubah impor.
export type { ConversationPhase };
export type { FastGateArgs, FastGateResult };
export {
  deriveConversationPhase,
  buildPhaseDirective,
  deriveConversationState,
  isBookingCommitReady,
  detectAgreedTreatment,
  hasScheduleSignal,
  assignInternalScheduleLabel,
  hasFallInjurySignal,
  extractTimeHint,
  hasVaccineSignal,
  isSubstantiveForPreGrounding,
  FastResponseGate,
  isShortAcknowledgement,
  resolvePostReservationAck,
  POST_RESERVATION_CLOSING,
  POST_SCHEDULE_CHECK_CLOSING,
};

export interface GroundingInput {
  incomingText: string;
  cleanIncomingText: string;
  session: CustomerGoalSession;
  tenantId: string;
  phone: string;
  conversationId: string;
  isFollowUp: boolean;
  /** Kumpulan kunci chunk yang sudah tercatat turn ini (dedup lintas pre-grounding + tool). */
  seenChunkKeys: Set<string>;
  /** Akumulator observability chunks (dimutasi in-place). */
  retrievedChunks: V3RetrievedChunk[];
}

export interface GroundingOutput {
  phase: ConversationPhase;
  phaseDirective: string;
  hasScheduleSignal: boolean;
  hasFallInjury: boolean;
  hasVaccineSignal: boolean;
  timeHint: string | null;
  retrievedChunks: V3RetrievedChunk[];
  emptyKnowledgeResult: boolean;
  /** Cadangan antarmuka (saat ini selalu null — belum ada logika komposisi di hulu). */
  bundleCompositionNote: string | null;
  preGroundingBlock: string;
}

export class ContextGrounder {
  public static deriveConversationPhase = deriveConversationPhase;
  public static buildPhaseDirective = buildPhaseDirective;
  public static deriveConversationState = deriveConversationState;
  public static isBookingCommitReady = isBookingCommitReady;
  public static detectAgreedTreatment = detectAgreedTreatment;
  public static hasScheduleSignal = hasScheduleSignal;
  public static assignInternalScheduleLabel = assignInternalScheduleLabel;
  public static hasFallInjurySignal = hasFallInjurySignal;
  public static extractTimeHint = extractTimeHint;
  public static hasVaccineSignal = hasVaccineSignal;
  public static isSubstantiveForPreGrounding = isSubstantiveForPreGrounding;

  /**
   * Ringkasan konteks deterministik (0 token): apa yang SUDAH dibahas, FOKUS saat ini,
   * dan apa yang DILARANG diulang — anti kaset-rusak & anti amnesia antar turn.
   */
  public static buildContextSummary(
    session: CustomerGoalSession,
    cleanIncomingText: string,
    conversationHistory: Array<{ role: string; content: string }>
  ): string {
    try {
      return V3ConversationSummarizer.summarize(session, cleanIncomingText, {
        history: conversationHistory.map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
        customerInput: cleanIncomingText,
      });
    } catch (e) {
      return '';
    }
  }

  /**
   * Latch session pra-routing (fire-and-forget aman, tak pernah menggagalkan turn):
   * pelabelan internal jadwal, pembuka eksposur transaksional, dan petunjuk waktu.
   * Mengembalikan session terbaru (identity sama bila tak ada perubahan).
   */
  public static async applySessionLatches(
    session: CustomerGoalSession,
    cleanIncomingText: string,
    conversationId: string,
    tenantId: string
  ): Promise<CustomerGoalSession> {
    // Phase 3 — pelabelan internal "Tanya Jadwal" (DB only, zero WAHA).
    if (conversationId && hasScheduleSignal(cleanIncomingText)) {
      await assignInternalScheduleLabel(conversationId, tenantId);
    }

    // Audit 854065 (MODE TRANSASIONAL): pertanyaan harga membuka eksposur
    // total resmi di grounding (sekali dibuka, berlaku sisa sesi).
    const { extractFastIntents } = await import('../persona');
    if (conversationId && !session.priceDiscussed
      && extractFastIntents(cleanIncomingText).includes('ask_price')) {
      try {
        session = await GoalTracker.updateGoalSession(conversationId, { priceDiscussed: true }, tenantId);
      } catch (e) {}
    }

    // Audit 337101 & Plan 7 (anti CTA-looping, latch resilience & pendingScheduleCheck):
    // petunjuk waktu yang diminta ("sekarang", nama hari, "hari biasa") dicatat ke
    // booking.requestedTimeHint walau reservasi BELUM dibuat — agar turn ongkir
    // berikutnya tidak menodong hari lagi, dan diperbarui bila customer mengganti hari.
    // Jika lokasi atau treatment sudah diketahui, tandai pendingScheduleCheck agar ack
    // penegasan ("oke/baik/tunggu") dapat dieskalasi ke antrean staf tanpa loop.
    if (conversationId && hasScheduleSignal(cleanIncomingText)
      && !session.booking?.preferredDate
      && !session.booking?.reservationId) {
      const hint = extractTimeHint(cleanIncomingText);
      const hasLocationOrTreatment = Boolean(
        session.location?.kelurahan ||
        session.location?.distanceKm != null ||
        session.selectedTreatment ||
        (session.cartItems && session.cartItems.length > 0)
      );

      let bookingChanged = false;
      const nextBooking = { ...(session.booking || {}), isConfirmed: false };

      if (hint && hint !== session.booking?.requestedTimeHint) {
        nextBooking.requestedTimeHint = hint;
        bookingChanged = true;
      }
      if (hasLocationOrTreatment && !session.booking?.pendingScheduleCheck) {
        nextBooking.pendingScheduleCheck = true;
        bookingChanged = true;
      }

      if (bookingChanged) {
        session.booking = nextBooking;
        try {
          session = await GoalTracker.updateGoalSession(conversationId, {
            ...session,
            booking: nextBooking,
          }, tenantId);
        } catch (e) {}
      }
    }
    return session;
  }

  /**
   * Penyiapan session pra-gate (rehidrasi riwayat + sinkronisasi profil):
   * auto-capture treatment disepakati, sinkronisasi keranjang, profil anak,
   * dan profil ibu — deterministik, fail-safe per blok. Urutan dipertahankan
   * persis seperti orkestrator monolitik (pra-gate sapaan).
   */
  public static async prepareSession(args: {
    session: CustomerGoalSession;
    conversationId: string;
    tenantId: string;
    incomingText: string;
    history: Array<{ role: string; content: string }>;
  }): Promise<{
    session: CustomerGoalSession;
    conversationHistory: Array<{ role: string; content: string }>;
    cleanIncomingText: string;
    isFollowUp: boolean;
  }> {
    const { conversationId, tenantId, incomingText } = args;
    let { session } = args;
    // Teks bersih (tanpa tag iklan Promo[...]) khusus lapisan inferensi LLM.
    const { stripAdTags } = await import('../../../utils/lead-greeting-detector');
    const cleanIncomingText = stripAdTags(incomingText) || incomingText;
    let conversationHistory = [...args.history];
    if (conversationHistory.length === 0 && conversationId) {
      try {
        const { messageService } = await import('../../../services/message.service');
        const recentMsgs = await messageService.getRecentMessages(conversationId, 20, tenantId);
        conversationHistory = (recentMsgs || []).map((m: any) => ({
          role: (m.direction === 'INBOUND' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: m.content,
        }));
      } catch (e) {}
    }

    // Auto-capture ringan: jika riwayat obrolan aktif menyebut layanan katalog yang
    // disepakati (misal Pulih Ceria, Cukur) sementara session belum mencatatnya,
    // sinkronkan selectedTreatment agar header status tidak amnesia pada turn berikut.
    // Data-driven dari katalog aktif (tanpa regex/daftar hardcode).
    if (!session.selectedTreatment && conversationId) {
      try {
        const { treatmentCatalogService } = await import('../../../services/treatment-catalog.service');
        const agreed = detectAgreedTreatment(
          conversationHistory,
          treatmentCatalogService.getAllServices(true, tenantId).map((s) => s.name)
        );
        if (agreed) {
          session = await GoalTracker.updateGoalSession(conversationId, {
            selectedTreatment: agreed,
          }, tenantId);
        }
      } catch (e) {}
    }

    const isFollowUp = conversationHistory.some((m) => m.role === 'assistant');

    // Sinkronisasi keranjang layanan dari riwayat + pesan masuk (deterministik),
    // agar penambahan add-on (Sinar Moksa, Cukur) tidak amnesia antar turn.
    if (conversationId) {
      try {
        const { treatmentCatalogService } = await import('../../../services/treatment-catalog.service');
        const catalogMapped = treatmentCatalogService.getAllServices(true, tenantId).map((s) => ({
          id: (s as any).id,
          name: s.name,
          promoPrice: s.promoPrice,
          originalPrice: s.originalPrice,
          category: s.category,
          // Audit 887216: metadata rentang usia mengalir ke cart-manager agar
          // collision multi-tier usia dapat diputus deterministik dari DB.
          ageTier: (s as any).ageTier,
          // Phase 2 (audit 315036): metadata komposisi bundle untuk
          // rekonsiliasi bundle vs parsial di syncCartItems (data-driven).
          bundleItemIds: (s as any).bundleItemIds || [],
          isAddon: (treatmentCatalogService as any).isAddonService
            ? (treatmentCatalogService as any).isAddonService(s)
            : false,
        }));
        const cartHistory = [...conversationHistory, { role: 'user', content: cleanIncomingText }];
        const syncedCart = GoalTracker.syncCartItems(session, cartHistory, catalogMapped);
        if (JSON.stringify(syncedCart) !== JSON.stringify(session.cartItems || [])) {
          // Audit 854065 (swap): afirmasi tukar → selectedTreatment ikut ke
          // layanan baru agar grounding & template tidak tertinggal di lama.
          const swap = GoalTracker.resolveAffirmativeSwap(
            { ...session, cartItems: session.cartItems } as any, cartHistory, catalogMapped
          );
          const swappedNow = swap && syncedCart.some(
            (c) => c.name.toLowerCase() === swap.newName.toLowerCase()
          );
          session = await GoalTracker.updateGoalSession(conversationId, {
            cartItems: syncedCart,
            totalPrice: GoalTracker.calcCartTotal({ ...session, cartItems: syncedCart }),
            ...(swappedNow ? { selectedTreatment: swap.newName } : {}),
          }, tenantId);
        }
      } catch (e) {}
    }

    // Ekstraksi profil anak otomatis dari pesan masuk (usia, gejala, peran Adik/Kakak),
    // sinkron ke session.children (+ mirror childProfile) sebelum pemanggilan LLM.
    // Guard maternal-only di dalam syncChildrenProfiles mencegah "38 weeks" bocor ke usia anak.
    if (conversationId && cleanIncomingText) {
      try {
        const nextChildren = GoalTracker.syncChildrenProfiles(session, cleanIncomingText);
        // Gerbang disambiguasi multi-anak (sesi 214956): latch naik saat usia
        // kedua muncul tanpa sinyal eksplisit; turun HANYA saat sinyal jumlah
        // eksplisit tiba (bukan tiap turn netral — anti hilang sebelum jawab).
        const unconfirmedNow = GoalTracker.detectUnconfirmedMultiChild(session.children, cleanIncomingText);
        let multiLatch: boolean | undefined;
        if (unconfirmedNow) multiLatch = true;
        else if (GoalTracker.isExplicitChildCountSignal(cleanIncomingText)) multiLatch = false;
        const latchChanged = multiLatch !== undefined && multiLatch !== (session.isMultiChildUnconfirmed || false);
        if (JSON.stringify(nextChildren) !== JSON.stringify(session.children || []) || latchChanged) {
          const firstChild = nextChildren[0];
          session = await GoalTracker.updateGoalSession(conversationId, {
            children: nextChildren,
            childProfile: firstChild
              ? { name: firstChild.name, roleLabel: firstChild.roleLabel, ageMonths: firstChild.ageMonths, symptoms: [...(firstChild.symptoms || [])] }
              : session.childProfile,
            ...(multiLatch !== undefined ? { isMultiChildUnconfirmed: multiLatch } : {}),
          }, tenantId);
        }
      } catch (e) {}
    }

    // Ekstraksi profil ibu multi-audience (kehamilan/nifas/keluhan Bunda) + subjek perawatan.
    // First-class MomProfileState — terpisah 100% dari data anak (anti kontaminasi silang).
    if (conversationId && cleanIncomingText) {
      try {
        const nextMom = GoalTracker.syncMomProfile(session, cleanIncomingText);
        const nextAudience = GoalTracker.detectTargetAudience(cleanIncomingText);
        const momChanged = JSON.stringify(nextMom || null) !== JSON.stringify(session.momProfile || null);
        // Naikkan ke BOTH bila kedua sinyal hadir di turn berbeda (misal turn 1 MOMS, turn 2 anak)
        let resolvedAudience = nextAudience || session.targetAudience;
        if (session.targetAudience && nextAudience && session.targetAudience !== nextAudience) {
          const oneMom = session.targetAudience === 'MOMS' || nextAudience === 'MOMS';
          const oneChild = session.targetAudience === 'BABY' || session.targetAudience === 'KIDS' || nextAudience === 'BABY' || nextAudience === 'KIDS';
          if (oneMom && oneChild) resolvedAudience = 'BOTH';
          else resolvedAudience = nextAudience;
        }
        if (momChanged || (resolvedAudience && resolvedAudience !== session.targetAudience)) {
          session = await GoalTracker.updateGoalSession(conversationId, {
            ...(momChanged ? { momProfile: nextMom } : {}),
            ...(resolvedAudience ? { targetAudience: resolvedAudience } : {}),
          }, tenantId);
        }
      } catch (e) {}
    }

    return { session, conversationHistory, cleanIncomingText, isFollowUp };
  }

  /**
   * Grounding komposit Stage 1: fase + direktif + sinyal + Hybrid RAG
   * pre-retrieval. Panggilan RAG knowledgeService terbungkus di sini;
   * chunks diakumulasikan ke retrievedChunks (milik pemanggil) dengan
   * dedup via seenChunkKeys. Tanpa mutasi messages (pemanggil menempel
   * preGroundingBlock ke system prompt).
   */
  public static async ground(input: GroundingInput): Promise<GroundingOutput> {
    const { cleanIncomingText, session, tenantId, isFollowUp } = input;
    const phase = deriveConversationPhase(session, isFollowUp);
    const phaseDirective = buildPhaseDirective(phase, session);
    const scheduleSignal = hasScheduleSignal(cleanIncomingText);
    const fallInjury = hasFallInjurySignal(cleanIncomingText);
    const vaccineSignal = hasVaccineSignal(cleanIncomingText);
    const timeHint = extractTimeHint(cleanIncomingText);

    let preGroundingBlock = '';
    try {
      if (isSubstantiveForPreGrounding(cleanIncomingText)) {
        const { knowledgeBaseService } = await import('../../../services/knowledge.service');
        // Audit 315036: limit 3 agar pertanyaan multi-topik ("cukur + pijat
        // terapi") tidak memotong artikel definisi terapi.
        const preChunks = await knowledgeBaseService.searchRelevantChunks(cleanIncomingText, 3, tenantId);
        if (preChunks && preChunks.length > 0) {
          preGroundingBlock = `[PANDUAN & KNOWLEDGE BASE RESMI KLINIK - WAJIB DIPATUHI]\n`
            + `Berikut panduan resmi klinik yang RELEVAN dengan pertanyaan customer saat ini. Jadikan sebagai acuan utama jawaban (grounded), jangan mengarang di luar panduan ini:\n`
            + preChunks.map((c: any, i: number) => `Artikel ${i + 1} — ${c.title}:\n${c.content}`).join('\n\n');
          for (const c of preChunks as any[]) {
            const key = String((c as any)?.id || (c as any)?.title || '');
            if (key && !input.seenChunkKeys.has(key)) {
              input.seenChunkKeys.add(key);
              const realScore = typeof (c as any)?.similarity === 'number' ? (c as any).similarity
                : (typeof (c as any)?.score === 'number' ? (c as any).score
                : (typeof (c as any)?.rank === 'number' ? (c as any).rank : 0.9));
              input.retrievedChunks.push({
                id: String((c as any)?.id || key),
                title: String((c as any)?.title || ''),
                content: String((c as any)?.content || ''),
                similarity: realScore,
                score: realScore,
              } as any);
            }
          }
        }
      }
    } catch (e) {}

    return {
      phase,
      phaseDirective,
      hasScheduleSignal: scheduleSignal,
      hasFallInjury: fallInjury,
      hasVaccineSignal: vaccineSignal,
      timeHint,
      retrievedChunks: input.retrievedChunks,
      emptyKnowledgeResult: false,
      bundleCompositionNote: null,
      preGroundingBlock,
    };
  }
}
