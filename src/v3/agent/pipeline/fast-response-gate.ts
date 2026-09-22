/**
 * fast-response-gate.ts (Fase 2 — dekomposisi context-grounder).
 *
 * Fast Response Gate (0 token): sapaan pembuka murni (Turn-0) dan
 * acknowledgement pasca-reservasi ditangani deterministik tanpa LLM.
 * Anti infinite reassurance loop "oke/siap" 100x (sesi 462651).
 * Diekstrak verbatim dari context-grounder.ts; context-grounder.ts kini
 * mendelegasikan ke sini.
 */
import { CustomerGoalSession, GoalTracker } from '../../state/goal-tracker';
import { ConversationState } from '@prisma/client';
import { isPureLeadGreeting } from '../../../utils/lead-greeting-detector';
import { TEMPLATES } from '../../../config/persona';
import { extractFastIntents } from '../persona';
import type { AgentRunnerOutput } from '../agent-runner';
import { deriveConversationState } from './phase-resolver';

/** Balasan closing deterministik pasca-reservasi (0 token, tanpa janji jadwal). */
export const POST_RESERVATION_CLOSING =
  'Sama-sama Bunda 🌸 Mohon ditunggu ya, tim Bidan kami sedang mengecek jadwal dan akan segera mengabari Bunda 🤗';

/** Balasan closing deterministik saat pengecekan ketersediaan jadwal slot (Plan 7). */
export const POST_SCHEDULE_CHECK_CLOSING =
  'Baik Bunda, ketersediaan jadwalnya akan segera kami konfirmasikan yaa. Mohon ditunggu sebentar ya Bunda 🤗';

/**
 * Penanda acknowledgement pendek pasca-reservasi / cek jadwal (sesi 462651 & Plan 7, pure):
 * "oke kak", "siap", "baik", "makasih", "saya tunggu", "kabari ya", "👍" — BUKAN pertanyaan baru.
 * Daftar kata setingkat bahasa sapaan (seperti DAY_EVIDENCE_WORDS), HANYA
 * bermakna di dalam state gated (reservasi/jadwal menunggu verifikasi staf) —
 * bukan gatekeeper intent umum.
 */
const POST_RESERVATION_ACK_TOKENS = new Set([
  'oke', 'ok', 'okay', 'okey', 'siap', 'baik', 'makasih', 'terimakasih',
  'terima', 'kasih', 'sip', 'ya', 'tunggu', 'kabari', 'nanti', 'ditunggu',
]);
const POST_RESERVATION_ACK_IGNORABLES = new Set([
  'kak', 'kakak', 'bun', 'bunda', 'bund', 'min', 'admin', 'mba', 'mbak',
  'saya', 'aku',
]);

/**
 * Deteksi pertanyaan rekrutmen / lowongan kerja (profesional, 0 token):
 * variasi natural "loker", "lowongan", "lamaran", "melamar", "rekrutmen",
 * "recruitment", "oprec", "pekerjaan", "posisi kosong", "cv", "resume",
 * "job *". Dipakai FastResponseGate untuk eskalasi senyap ke staf HR —
 * bot diam total, tanpa LLM, tanpa janji.
 */
export function isRecruitmentInquiry(text: string): boolean {
  const lower = (text || '').toLowerCase();
  if (!lower.trim()) return false;
  const tokens = lower.replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t.length > 0);
  const has = (w: string) => lower.includes(w);
  if (
    has('loker') || has('lowongan') || has('lamaran') || has('melamar')
    || has('rekrutmen') || has('recruitment') || has('oprec') || has('pekerjaan')
  ) {
    return true;
  }
  if (tokens.includes('cv') || tokens.includes('resume')) return true;
  if (has('posisi kosong') || has('jabatan kosong')) return true;
  if (tokens.some((t) => t.startsWith('job'))) return true;
  return false;
}

/**
 * Deteksi apakah pesan adalah foto/media murni (tanpa caption bermakna).
 * Menangani '[IMAGE]', '[IMAGE:]', '[IMAGE: IMG_...jpg]' (nama file kamera).
 */
export function isPureImageMessage(text: string): boolean {
  const trimmed = (text || '').trim();
  if (trimmed === '[IMAGE]' || trimmed === '[IMAGE:]') return true;
  const match = trimmed.match(/^\[IMAGE:\s*([^\]]+)\]$/i);
  if (match) {
    const caption = match[1].trim();
    if (!caption) return true;
    if (/^(IMG[-_]|PHOTO[-_]|WP[-_]|PXL[-_]|\d{8}[-_]|\w+\.(jpe?g|png|webp|heic))/i.test(caption)) {
      return true;
    }
  }
  return false;
}

export function isShortAcknowledgement(text: string): boolean {
  const lower = (text || '').toLowerCase();
  if (!lower.trim()) return false;
  if (lower.includes('?')) return false; // pertanyaan → bukan ack
  if (lower.trim().length > 30) return false;
  let norm = '';
  for (const ch of lower) {
    norm += ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9' ? ch : ' ';
  }
  const toks = norm.split(' ').filter(Boolean).filter((t) => !POST_RESERVATION_ACK_IGNORABLES.has(t));
  if (toks.length === 0) return true; // emoji-only / sapaan-only dalam state gated
  if (toks.length > 4) return false;
  return toks.every((t) => POST_RESERVATION_ACK_TOKENS.has(t));
}

/**
 * Resolusi acknowledgement pasca-reservasi atau pengecekan ketersediaan jadwal (pure, sesi 462651 & Plan 7):
 * - null → bukan kondisi handoff (lanjut alur normal),
 * - 'closing' → ack pertama: kirim 1x closing lalu handoff,
 * - 'silent' → closing sudah dikirim: senyap total.
 */
export function resolvePostReservationAck(
  session: CustomerGoalSession,
  incomingText: string
): 'closing' | 'silent' | null {
  const isPostReservation = Boolean(session?.booking?.reservationId && session?.booking?.needsStaffVerification);
  const isScheduleCheckWait = Boolean(session?.booking?.pendingScheduleCheck);

  if (!isPostReservation && !isScheduleCheckWait) return null;
  if (!isShortAcknowledgement(incomingText)) return null;
  return session.booking?.handoffClosingSent ? 'silent' : 'closing';
}

export interface FastGateArgs {
  tenantId: string;
  conversationId: string;
  phone: string;
  incomingText: string;
  originalText?: string;
  cleanIncomingText: string;
  skipDbLogging?: boolean;
  isFollowUp: boolean;
  session: CustomerGoalSession;
  currentSystemPrompt: string;
  fewShotExemplars: any[];
}

export type FastGateResult =
  | { handled: true; output: AgentRunnerOutput; session: CustomerGoalSession }
  | { handled: false; session: CustomerGoalSession };

/**
 * Fast Response Gate (0 token): sapaan pembuka murni (Turn-0) dan
 * acknowledgement pasca-reservasi ditangani deterministik tanpa LLM.
 * Anti infinite reassurance loop "oke/siap" 100x (sesi 462651).
 */
export class FastResponseGate {
  public static async check(args: FastGateArgs): Promise<FastGateResult> {
    const {
      tenantId, conversationId, phone, incomingText, originalText,
      cleanIncomingText, skipDbLogging, isFollowUp,
    } = args;
    let { session } = args;
    const emptyTokens = { prompt: 0, completion: 0, total: 0 };

    // GATE DETERMINISTIK: rekrutmen/lowongan kerja (sesi 983902) — eskalasi
    // senyap ke tim HR/staf via HUMAN_HANDLING, TANPA LLM (0 token), tanpa
    // respon teks dan tanpa pemanggilan tool apa pun.
    if (isRecruitmentInquiry(cleanIncomingText)) {
      console.log(JSON.stringify({ event: 'RECRUITMENT_INQUIRY_ESCALATED', tenantId, conversationId, timestamp: new Date().toISOString() }));
      return {
        handled: true,
        session,
        output: {
          replyText: '',
          executedTools: [],
          updatedSession: session,
          shouldSendReply: false,
          isEscalated: true,
          escalationReason: 'recruitment_inquiry',
          escalationNote: 'Pertanyaan rekrutmen/lowongan kerja — dialihkan ke tim staf',
          retrievedChunks: [],
          fewShotExemplars: args.fewShotExemplars,
          systemPrompt: args.currentSystemPrompt,
          reasoning: null,
          tokens: emptyTokens,
          costIdr: 0,
          nextState: ConversationState.HUMAN_HANDLING,
        },
      };
    }

    // GATE DETERMINISTIK: foto/media murni tanpa caption bermakna (inbound image)
    if (isPureImageMessage(cleanIncomingText)) {
      const staticPhotoReply = 'Terima kasih fotonya ya Bunda \u{1F3E0}\u2728 Sudah kami terima dan simpan untuk panduan tim Bidan kami saat kunjungan nanti. Ada yang ingin Bunda tanyakan atau konsultasikan lagi? \u{1F917}';
      if (conversationId && !skipDbLogging) {
        try {
          const { messageService } = await import('../../../services/message.service');
          const { Direction } = await import('@prisma/client');
          await messageService.logMessage({
            tenantId,
            conversationId,
            direction: Direction.INBOUND,
            content: originalText || incomingText,
          });
          await messageService.logMessage({
            tenantId,
            conversationId,
            direction: Direction.OUTBOUND,
            content: staticPhotoReply,
          });
        } catch (e) {}
      }
      return {
        handled: true,
        session,
        output: {
          replyText: staticPhotoReply,
          executedTools: [],
          updatedSession: session,
          shouldSendReply: true,
          isEscalated: false,
          retrievedChunks: [],
          fewShotExemplars: args.fewShotExemplars,
          systemPrompt: args.currentSystemPrompt,
          reasoning: null,
          tokens: emptyTokens,
          costIdr: 0,
          nextState: deriveConversationState(session, extractFastIntents(cleanIncomingText)),
        },
      };
    }

    // GATE DETERMINISTIK: sapaan pembuka murni (Turn-0) langsung dibalas template
    // resmi tanpa LLM (0 token). Hanya bila asisten belum pernah membalas.
    if (!isFollowUp) {
      const leadCheck = isPureLeadGreeting(cleanIncomingText);
      if (leadCheck.isLeadGreeting) {
        const staticReply = TEMPLATES.greeting({ isIslamic: leadCheck.isIslamic });
        if (conversationId && !skipDbLogging) {
          try {
            const { messageService } = await import('../../../services/message.service');
            const { Direction } = await import('@prisma/client');
            await messageService.logMessage({
              tenantId,
              conversationId,
              direction: Direction.INBOUND,
              content: originalText || incomingText,
            });
            await messageService.logMessage({
              tenantId,
              conversationId,
              direction: Direction.OUTBOUND,
              content: staticReply,
            });
          } catch (e) {}
        }
        return {
          handled: true,
          session,
          output: {
            replyText: staticReply,
            executedTools: [],
            updatedSession: session,
            shouldSendReply: true,
            isEscalated: false,
            retrievedChunks: [],
            fewShotExemplars: args.fewShotExemplars,
            systemPrompt: args.currentSystemPrompt,
            reasoning: null,
            tokens: emptyTokens,
            costIdr: 0,
            nextState: deriveConversationState(session, extractFastIntents(cleanIncomingText)),
          },
        };
      }
    }

    // GATE DETERMINISTIK: acknowledgement pasca-reservasi atau cek jadwal (sesi 462651 & Plan 7) —
    // 1x graceful closing + handoff ke staf, TANPA LLM. Machine meneruskan
    // isEscalated ke escalateToHumanHandling (notifikasi staf + antrean live-chat).
    const postReservationAck = resolvePostReservationAck(session, cleanIncomingText);
    if (conversationId && postReservationAck) {
      const isScheduleCheck = Boolean(!session.booking?.reservationId && session.booking?.pendingScheduleCheck);
      const replyMessage = isScheduleCheck ? POST_SCHEDULE_CHECK_CLOSING : POST_RESERVATION_CLOSING;
      const escalationReason = isScheduleCheck ? 'pending_schedule_check' : 'pending_reservation_check';
      const escalationNote = isScheduleCheck
        ? 'Menunggu konfirmasi ketersediaan jadwal slot Bidan'
        : 'Menunggu konfirmasi jadwal reservasi oleh tim Bidan';

      if (postReservationAck === 'closing') {
        try {
          session = await GoalTracker.updateGoalSession(conversationId, {
            booking: { ...(session.booking || {}), isConfirmed: session.booking?.isConfirmed ?? false, handoffClosingSent: true },
          }, tenantId);
        } catch (e) {}
        if (!skipDbLogging) {
          try {
            const { messageService } = await import('../../../services/message.service');
            const { Direction } = await import('@prisma/client');
            await messageService.logMessage({
              tenantId,
              conversationId,
              direction: Direction.OUTBOUND,
              content: replyMessage,
            });
          } catch (e) {}
        }
        console.log(JSON.stringify({ event: isScheduleCheck ? 'SCHEDULE_CHECK_HANDOFF_CLOSING' : 'POST_RESERVATION_HANDOFF_CLOSING', tenantId, conversationId, timestamp: new Date().toISOString() }));
        return {
          handled: true,
          session,
          output: {
            replyText: replyMessage,
            executedTools: [],
            updatedSession: session,
            shouldSendReply: true,
            isEscalated: true,
            escalationReason,
            escalationNote,
            retrievedChunks: [],
            fewShotExemplars: args.fewShotExemplars,
            systemPrompt: args.currentSystemPrompt,
            reasoning: null,
            tokens: emptyTokens,
            costIdr: 0,
            nextState: ConversationState.HUMAN_HANDLING,
          },
        };
      }
      console.log(JSON.stringify({ event: isScheduleCheck ? 'SCHEDULE_CHECK_SILENT_SKIP' : 'POST_RESERVATION_SILENT_SKIP', tenantId, conversationId, timestamp: new Date().toISOString() }));
      return {
        handled: true,
        session,
        output: {
          replyText: '',
          executedTools: [],
          updatedSession: session,
          shouldSendReply: false,
          isEscalated: true,
          escalationReason,
          escalationNote,
          retrievedChunks: [],
          fewShotExemplars: args.fewShotExemplars,
          systemPrompt: args.currentSystemPrompt,
          reasoning: null,
          tokens: emptyTokens,
          costIdr: 0,
          nextState: ConversationState.HUMAN_HANDLING,
        },
      };
    }

    return { handled: false, session };
  }
}
