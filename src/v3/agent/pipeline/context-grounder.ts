import { CustomerGoalSession, GoalTracker } from '../../state/goal-tracker';
import { V3ConversationSummarizer } from '../../state/conversation-summarizer';
import { ConversationState } from '@prisma/client';
import { isPureLeadGreeting } from '../../../utils/lead-greeting-detector';
import { TEMPLATES } from '../../../config/persona';
import { extractFastIntents } from '../persona';
import type { AgentRunnerOutput, V3RetrievedChunk } from '../agent-runner';

/** Fase percakapan deterministik (derivasi dari session state, bukan keyword). */
export type ConversationPhase =
  | 'GREETING'
  | 'LOCATION_KNOWN'
  | 'ONGKIR_QUOTED'
  | 'TREATMENT_DISCUSSED'
  | 'SCHEDULING'
  | 'GENERAL';

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

/** Balasan closing deterministik pasca-reservasi (0 token, tanpa janji jadwal). */
export const POST_RESERVATION_CLOSING =
  'Sama-sama Bunda 🌸 Mohon ditunggu ya, tim Bidan kami sedang mengecek jadwal dan akan segera mengabari Bunda 🤗';

/**
 * Penanda acknowledgement pendek pasca-reservasi (sesi 462651, pure):
 * "oke kak", "siap", "baik", "makasih", "👍" — BUKAN pertanyaan baru.
 * Daftar kata setingkat bahasa sapaan (seperti DAY_EVIDENCE_WORDS), HANYA
 * bermakna di dalam state gated (reservasi menunggu verifikasi staf) —
 * bukan gatekeeper intent umum.
 */
const POST_RESERVATION_ACK_TOKENS = new Set([
  'oke', 'ok', 'okay', 'siap', 'baik', 'makasih', 'terimakasih',
  'terima', 'kasih', 'sip', 'ya',
]);
const POST_RESERVATION_ACK_IGNORABLES = new Set(['kak', 'bun', 'bunda', 'bund']);

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
 * Resolusi acknowledgement pasca-reservasi (pure, sesi 462651):
 * - null → bukan kondisi handoff (lanjut alur normal),
 * - 'closing' → ack pertama: kirim 1x closing lalu handoff,
 * - 'silent' → closing sudah dikirim: senyap total.
 */
export function resolvePostReservationAck(
  session: CustomerGoalSession,
  incomingText: string
): 'closing' | 'silent' | null {
  if (!session?.booking?.reservationId || !session?.booking?.needsStaffVerification) return null;
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
            nextState: ContextGrounder.deriveConversationState(session, extractFastIntents(cleanIncomingText)),
          },
        };
      }
    }

    // GATE DETERMINISTIK: acknowledgement pasca-reservasi (sesi 462651) —
    // 1x graceful closing + handoff ke staf, TANPA LLM. Machine meneruskan
    // isEscalated ke escalateToHumanHandling (notifikasi staf + antrean live-chat).
    const postReservationAck = resolvePostReservationAck(session, cleanIncomingText);
    if (conversationId && postReservationAck) {
      if (postReservationAck === 'closing') {
        try {
          session = await GoalTracker.updateGoalSession(conversationId, {
            booking: { isConfirmed: session.booking?.isConfirmed ?? false, handoffClosingSent: true },
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
              content: POST_RESERVATION_CLOSING,
            });
          } catch (e) {}
        }
        console.log(JSON.stringify({ event: 'POST_RESERVATION_HANDOFF_CLOSING', tenantId, conversationId, timestamp: new Date().toISOString() }));
        return {
          handled: true,
          session,
          output: {
            replyText: POST_RESERVATION_CLOSING,
            executedTools: [],
            updatedSession: session,
            shouldSendReply: true,
            isEscalated: true,
            escalationReason: 'pending_reservation_check',
            escalationNote: 'Menunggu konfirmasi jadwal reservasi oleh tim Bidan',
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
      console.log(JSON.stringify({ event: 'POST_RESERVATION_SILENT_SKIP', tenantId, conversationId, timestamp: new Date().toISOString() }));
      return {
        handled: true,
        session,
        output: {
          replyText: '',
          executedTools: [],
          updatedSession: session,
          shouldSendReply: false,
          isEscalated: true,
          escalationReason: 'pending_reservation_check',
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

/**
 * Stage 1 — ContextGrounder: deteksi sinyal percakapan, derivasi fase,
 * pelabelan internal jadwal, dan pra-pengambilan pengetahuan (Hybrid RAG).
 * Bebas dari panggilan LLM router.
 */
export class ContextGrounder {
  /**
   * Derivasi fase percakapan dari session state (deterministik, 0 token).
   * Prioritas: SCHEDULING > TREATMENT_DISCUSSED > ONGKIR_QUOTED > LOCATION_KNOWN > GREETING > GENERAL.
   * Fase paling maju menang agar guidance Call 1 context-aware berdasar state,
   * bukan per-keyword — fix fondational Akar 2.
   */
  public static deriveConversationPhase(session: CustomerGoalSession, isFollowUp = false): ConversationPhase {
    if (session.booking?.preferredDate != null || session.booking?.reservationId != null) {
      return 'SCHEDULING';
    }
    if (session.selectedTreatment != null || (session.cartItems && session.cartItems.length > 0)) {
      return 'TREATMENT_DISCUSSED';
    }
    if (session.ongkirStatus === 'QUOTED' || session.ongkirStatus === 'CONFIRMED') {
      return 'ONGKIR_QUOTED';
    }
    if (session.location?.kelurahan || session.location?.distanceKm != null) {
      return 'LOCATION_KNOWN';
    }
    if (!isFollowUp) {
      return 'GREETING';
    }
    return 'GENERAL';
  }

  /**
   * Template directive per fase — disisipkan ke system prompt sebelum Call 1.
   * Semua tool tetap dikirim di tools[] (tidak disembunyikan); LLM diarahkan
   * via instruksi eksplisit — lebih robust untuk model kecil daripada
   * dynamic tool filtering yang rapuh bila ada case tak terduga.
   * Directive tambahan di-stack berdasar session (mis. ongkir quoted +
   * treatment discussed sekaligus) agar tidak kehilangan guard fase lampau.
   */
  public static buildPhaseDirective(phase: ConversationPhase, session: CustomerGoalSession): string {
    const lines: string[] = [`[FASE PERCAKAPAN: ${phase}]`];
    const kelurahan = session.location?.kelurahan || session.location?.kecamatan || '';
    const distanceKm = session.location?.distanceKm;
    const ongkirQuoted = session.ongkirStatus === 'QUOTED' || session.ongkirStatus === 'CONFIRMED';
    const hasTreatment = session.selectedTreatment != null || (session.cartItems && session.cartItems.length > 0);
    const hasBooking = session.booking?.preferredDate != null || session.booking?.reservationId != null;

    switch (phase) {
      case 'GREETING':
        lines.push('• Percakapan baru. Semua tool tersedia sesuai kebutuhan customer.');
        break;
      case 'LOCATION_KNOWN':
        lines.push('• Lokasi customer sudah diketahui. calculate_delivery masih boleh dipakai untuk menghitung ongkir alamat tersebut.');
        break;
      case 'ONGKIR_QUOTED':
        lines.push(
          `• Ongkir ke ${kelurahan || 'lokasi customer'}${distanceKm != null ? ` (${distanceKm} km)` : ''} sudah dihitung & disampaikan. JANGAN panggil calculate_delivery kecuali customer mengirim alamat BARU yang berbeda.`,
          '• Fokus: jawab pertanyaan customer saat ini. Jangan mengulang hitungan jarak/ongkir.'
        );
        break;
      case 'TREATMENT_DISCUSSED':
        lines.push(
          `• Treatment sudah dibahas${session.selectedTreatment ? `: ${session.selectedTreatment}` : ''}. get_catalog_and_price hanya untuk treatment BARU/berbeda yang ditanyakan customer.`,
          '• Jangan menanyakan ulang "rencana mau treatment apa" dari awal.'
        );
        break;
      case 'SCHEDULING':
        lines.push(
          `• Jadwal sudah dibahas${session.booking?.preferredDate ? `: ${session.booking.preferredDate} ${session.booking.preferredTime || ''}`.trimEnd() : ''}. save_reservation tersedia bila data reservasi lengkap.`,
          '• Jangan menanyakan ulang hari jadwal yang sudah disepakati.'
        );
        break;
      case 'GENERAL':
      default:
        lines.push('• Jawab pertanyaan customer saat ini berdasar konteks yang sudah diketahui.');
        lines.push('• Bila pertanyaan soal jadwal dan lokasi customer belum diketahui: dahulukan tanya domisili netral (aturan persona 5a) di atas pola "cekkan/infokan".');
        break;
    }

    // Stacked guards: fase lampau yang tetap berlaku di fase maju.
    if (phase !== 'ONGKIR_QUOTED' && ongkirQuoted) {
      lines.push(
        `• (Konteks fase lampau) Ongkir ke ${kelurahan || 'lokasi customer'} sudah disampaikan. JANGAN panggil calculate_delivery kecuali ada alamat BARU.`
      );
    }
    if ((phase === 'SCHEDULING' || phase === 'ONGKIR_QUOTED' || phase === 'GENERAL') && hasTreatment) {
      lines.push(
        `• (Konteks fase lampau) Treatment sudah dibahas${session.selectedTreatment ? `: ${session.selectedTreatment}` : ''} — jangan tanya ulang dari awal.`
      );
    }
    if (phase !== 'SCHEDULING' && hasBooking) {
      lines.push('• (Konteks fase lampau) Jadwal sudah tercatat — jangan tawarkan ulang hari yang sudah final.');
    }
    return lines.join('\n');
  }

  /**
   * Turunan status state-machine dari session (reuse enum existing — tanpa migrasi):
   * lokasi terkonfirmasi → LOCATION_CONFIRMED; cart/treatment terisi → AWAITING_INTEREST;
   * jadwal ditanyakan → RESERVATION_SENT; reservasi tersimpan → COMPLETED.
   */
  public static deriveConversationState(session: CustomerGoalSession, currentIntents: string[] = []): ConversationState {
    if (session.booking?.isConfirmed || session.booking?.reservationId) {
      return ConversationState.COMPLETED;
    }
    if (session.booking?.preferredDate || currentIntents.includes('ask_schedule')) {
      return ConversationState.RESERVATION_SENT;
    }
    if ((session.cartItems && session.cartItems.length > 0) || session.selectedTreatment) {
      return ConversationState.AWAITING_INTEREST;
    }
    if (session.location?.kelurahan || session.location?.distanceKm != null) {
      return ConversationState.LOCATION_CONFIRMED;
    }
    return ConversationState.INITIAL;
  }

  /**
   * Deteksi layanan katalog yang disepakati dari riwayat obrolan (data-driven:
   * pencocokan substring nama layanan katalog aktif, tanpa regex/daftar hardcode).
   * Dipindai dari pesan terbaru; nama terpanjang menang (paling spesifik).
   */
  public static detectAgreedTreatment(
    history: Array<{ role: string; content: string }>,
    catalogNames: string[]
  ): string | null {
    if (!history || history.length === 0 || !catalogNames || catalogNames.length === 0) return null;
    const names = [...catalogNames]
      .filter((n) => n && n.trim().length >= 4)
      .sort((a, b) => b.length - a.length);
    for (let i = history.length - 1; i >= 0; i--) {
      // Fondasional sesi 973126: HANYA pesan customer (role === 'user') yang boleh
      // mengklaim persetujuan paket. Pesan asisten yang menyebut nama treatment
      // (rekomendasi/brosur) DILARANG dihitung sebagai customer setuju.
      if (history[i]?.role !== 'user') continue;
      const text = (history[i]?.content || '').toLowerCase();
      if (!text) continue;
      for (const name of names) {
        if (text.includes(name.toLowerCase())) return name;
      }
    }
    return null;
  }

  /**
   * Sinyal jadwal untuk pelabelan internal "Tanya Jadwal" (deterministik,
   * aturan sendiri — tidak downstream dari extractFastIntents).
   * Tokenisasi sederhana (tanpa regex semantik): "3 minggu" (usia bayi,
   * angka + minggu) DILARANG dihitung sebagai hari Minggu.
   */
  public static hasScheduleSignal(text: string): boolean {
    // Aturan deterministik sendiri (data-driven includes) — SENGAJA tidak
    // downstream dari extractFastIntents agar presisi label imun terhadap
    // drift classifier. Audit 315036: "sekarang"/"hari ini" adalah tanya slot
    // hanya bila didampingi kata ketersediaan; bare "batuknya kambuh
    // sekarang" adalah keluhan (DILARANG dilabeli jadwal).
    const lower = (text || '').toLowerCase();
    if (!lower) return false;
    const hasAny = (words: string[]): boolean => words.some((w) => lower.includes(w));
    // Sinyal jadwal kuat (mandiri, tanpa verifikasi tambahan).
    if (hasAny(['jadwal', 'kapan', 'tanggal', 'slot', 'besok', 'lusa', 'minggu depan',
      'bisa hari apa', 'hari apa', 'masih kosong', 'bisa sekarang',
      'jam berapa', 'ready jam', 'bisa jam'])) {
      return true;
    }
    // Sinyal waktu-sekarang: valid hanya bila didampingi kata ketersediaan.
    if (hasAny(['sekarang', 'hari ini'])) {
      return hasAny(['bisa', 'apakah', 'ready', 'kosong', 'datang', 'jadwal', 'slot']);
    }
    const DAY_WORDS = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu', 'weekend'];
    // Digit WAJIB dipertahankan agar guard "3 minggu" (usia) tetap bekerja —
    // hanya huruf non-alnum yang dijadikan pemisah token.
    let normalized = '';
    for (let i = 0; i < lower.length; i++) {
      const ch = lower[i];
      normalized += ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) ? ch : ' ';
    }
    const tokens = normalized.split(' ').filter((t) => t.length > 0);
    const isDigitStart = (t: string): boolean => {
      if (!t) return false;
      const c = t.charCodeAt(0);
      return c >= 48 && c <= 57;
    };
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!DAY_WORDS.includes(tok)) continue;
      if (tok === 'minggu' && i > 0 && isDigitStart(tokens[i - 1])) continue;
      return true;
    }
    return false;
  }

  /**
   * Pelabelan internal "Tanya Jadwal" — 100% DATABASE (tabel labels &
   * customer_labels via Prisma), ZERO API call ke WAHA (Mandat Larangan
   * Menyentuh Label WAHA). Idempoten via upsert; gagal DB (offline/testing)
   * hanya warn, tidak pernah menggagalkan turn percakapan.
   */
  public static async assignInternalScheduleLabel(
    conversationId: string,
    tenantId: string
  ): Promise<void> {
    try {
      const { prisma } = await import('../../../db/client');
      const conv = await prisma.conversation.findFirst({
        where: { id: conversationId, tenant_id: tenantId },
      });
      const custId = (conv as any)?.customer_id as string | undefined;
      if (!custId) return;
      const NAME = 'Tanya Jadwal';
      let label = await prisma.label.findFirst({ where: { tenant_id: tenantId, name: NAME } });
      if (!label) {
        label = await prisma.label.create({ data: { tenant_id: tenantId, name: NAME, color: '#10B981' } });
      }
      await prisma.customerLabel.upsert({
        where: { customer_id_label_id: { customer_id: custId, label_id: label.id } },
        create: { customer_id: custId, label_id: label.id },
        update: {},
      });
      console.log(JSON.stringify({ event: 'V3_INTERNAL_LABEL_ASSIGNED', tenantId, conversationId, label: NAME, timestamp: new Date().toISOString() }));
    } catch (e: any) {
      console.warn(JSON.stringify({ event: 'V3_INTERNAL_LABEL_SKIP', tenantId, conversationId, error: e?.message || 'db offline', timestamp: new Date().toISOString() }));
    }
  }

  /**
   * Sinyal trauma jatuh/terbentur bayi (deterministik, data-driven includes)
   * untuk clinical-safety routing Call 1 (audit 337101). 'bentur' generik
   * hanya dihitung bila berkonteks bayi/jatuh (menghindari "kebentur meja
   * kantor" dewasa yang tak terkait pasien anak — tetap butuh kata bayi).
   */
  public static hasFallInjurySignal(text: string): boolean {
    const lower = (text || '').toLowerCase();
    if (!lower) return false;
    const hasAny = (words: string[]): boolean => words.some((w) => lower.includes(w));
    if (hasAny(['jatuh', 'jatoh', 'terbentur', 'kebentur', 'kejedot', 'habis jatuh', 'baru jatuh'])) return true;
    return lower.includes('bentur')
      && hasAny(['bayi', 'baby', 'newborn', 'anak', 'si kecil', 'adik']);
  }

  /**
   * Ekstrak petunjuk waktu yang diminta customer (audit 337101): token
   * waktu deterministik (sekarang/hari ini/besok/lusa/nama hari) untuk
   * dicatat sebagai booking.requestedTimeHint — anti pengulangan tanya hari.
   * Kembalikan null bila tidak ada; token pertama yang muncul menang.
   */
  public static extractTimeHint(text: string): string | null {
    const lower = (text || '').toLowerCase();
    if (!lower) return null;
    if (lower.includes('minggu depan')) return 'minggu depan';
    if (lower.includes('hari ini')) return 'hari ini';
    let norm = '';
    for (let i = 0; i < lower.length; i++) {
      const ch = lower[i];
      norm += ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) ? ch : ' ';
    }
    const tokens = norm.split(' ').filter((t) => t.length > 0);
    const HINTS = ['sekarang', 'besok', 'lusa', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu', 'weekend'];
    for (const t of tokens) {
      if (HINTS.includes(t)) {
        if (t === 'minggu') {
          const idx = tokens.indexOf(t);
          if (idx > 0) {
            const c = tokens[idx - 1].charCodeAt(0);
            if (c >= 48 && c <= 57) continue; // "3 minggu" = usia, bukan hari
          }
        }
        return t;
      }
    }
    return null;
  }

  /**
   * Sinyal imunisasi/vaksinasi (deterministik, data-driven includes) untuk
   * clinical-safety routing Call 1. 'suntik' generik hanya dihitung bila
   * berkonteks bayi/vaksin (menghindari "suntik KB" dewasa memicu SOP bayi).
   */
  public static hasVaccineSignal(text: string): boolean {
    const lower = (text || '').toLowerCase();
    if (!lower) return false;
    const hasAny = (words: string[]): boolean => words.some((w) => lower.includes(w));
    if (hasAny(['vaksin', 'vaksinasi', 'imunisasi', 'kipi', 'bcg', 'polio', 'dpt'])) return true;
    return lower.includes('suntik')
      && hasAny(['bayi', 'baby', 'newborn', 'anak', 'imunisasi', 'vaksin']);
  }

  /**
   * Penentu pesan substantif untuk Hybrid RAG pre-retrieval (deterministik, 0 token).
   * Data-driven includes (tanpa regex intent gatekeeper): keluhan, perbedaan layanan,
   * syarat usia/SOP, kehamilan/induksi. Sapaan/harga murni/ongkir/jadwal dikecualikan
   * agar tidak membebani FTS.
   */
  public static isSubstantiveForPreGrounding(text: string): boolean {
    const lower = (text || '').toLowerCase();
    if (!lower || lower.trim().length < 8) return false;
    // Sapaan murni tidak perlu grounding
    const greetingOnly = ['halo', 'hallo', 'hai', 'pagi', 'siang', 'sore', 'malam', 'assalamualaikum', 'permisi', 'tes', 'test', 'oke', 'ok', 'siap', 'makasih', 'terima kasih'];
    const tokens = lower.split(' ').filter((t) => t.length > 0);
    if (tokens.length <= 3 && greetingOnly.some((g) => lower.includes(g))) return false;
    const substantiveSignals = [
      // Keluhan fisik ibu & anak
      'sakit', 'nyeri', 'pegal', 'capek', 'lelah', 'bengkak', 'kembung', 'kolik', 'batuk', 'pilek', 'bapil',
      'flu', 'demam', 'rewel', 'grok', 'diare', 'gtm', 'susah makan', 'susah tidur', 'kontraksi', 'mual',
      'pusing', 'asi', 'laktasi', 'menyusui',
      // Perbedaan / pemilihan layanan
      'beda', 'perbedaan', 'pilih', 'rekomendasi', 'cocok', 'bagus', 'mending', 'sebaiknya',
      // Syarat usia / SOP klinik
      'usia', 'umur', 'bulan', 'tahun', 'minggu', 'week', 'boleh', 'aman', 'syarat', 'minimal',
      'mandi', 'susu', 'minyak', 'telon', 'balsem', 'cukur', 'gundul', 'tumbuh gigi', 'vaksin',
      // Audit 222655: varian slang imunisasi WAJIB memicu pre-grounding
      // ("habis imunisasi apa sebelum e" tidak mengandung kata "vaksin").
      'vaksinasi', 'imunisasi', 'suntik', 'kipi', 'bcg', 'polio', 'dpt',
      // Audit 337101: trauma jatuh WAJIB pre-grounding SOP skrining
      // (mencegah tercatutnya artikel mandi/relaksasi untuk kasus trauma).
      'jatuh', 'jatoh', 'terbentur', 'kebentur', 'kejedot', 'bentur', 'benjol', 'memar',
      'fisioterapi', 'newborn', 'hamil', 'kehamilan', 'nifas', 'induksi', 'oksitosin', 'prenatal',
      'perineum', 'kontraksi', 'pembukaan', 'hpl',
      // Penjelasan terapi / khasiat
      'fungsi', 'manfaat', 'khasiat', 'cara kerja', 'gimana', 'bagaimana', 'maksudnya', 'seperti apa',
      'treatment', 'terapi', 'moksa', 'inframerah', 'laktasi', 'pijat',
    ];
    return substantiveSignals.some((s) => lower.includes(s));
  }

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
    if (conversationId && ContextGrounder.hasScheduleSignal(cleanIncomingText)) {
      await ContextGrounder.assignInternalScheduleLabel(conversationId, tenantId);
    }

    // Audit 854065 (MODE TRANSASIONAL): pertanyaan harga membuka eksposur
    // total resmi di grounding (sekali dibuka, berlaku sisa sesi).
    if (conversationId && !session.priceDiscussed
      && extractFastIntents(cleanIncomingText).includes('ask_price')) {
      try {
        session = await GoalTracker.updateGoalSession(conversationId, { priceDiscussed: true }, tenantId);
      } catch (e) {}
    }

    // Audit 337101 (anti CTA-looping): petunjuk waktu yang diminta ("sekarang",
    // nama hari) dicatat ke booking.requestedTimeHint walau reservasi BELUM
    // dibuat — agar turn ongkir berikutnya tidak menodong hari lagi.
    if (conversationId && ContextGrounder.hasScheduleSignal(cleanIncomingText)
      && !session.booking?.preferredDate && !session.booking?.requestedTimeHint
      && !session.booking?.reservationId) {
      const hint = ContextGrounder.extractTimeHint(cleanIncomingText);
      if (hint) {
        try {
          session = await GoalTracker.updateGoalSession(conversationId, {
            booking: { ...(session.booking || {}), requestedTimeHint: hint, isConfirmed: false },
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
        const agreed = ContextGrounder.detectAgreedTreatment(
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
    const phase = ContextGrounder.deriveConversationPhase(session, isFollowUp);
    const phaseDirective = ContextGrounder.buildPhaseDirective(phase, session);
    const hasScheduleSignal = ContextGrounder.hasScheduleSignal(cleanIncomingText);
    const hasFallInjury = ContextGrounder.hasFallInjurySignal(cleanIncomingText);
    const hasVaccineSignal = ContextGrounder.hasVaccineSignal(cleanIncomingText);
    const timeHint = ContextGrounder.extractTimeHint(cleanIncomingText);

    let preGroundingBlock = '';
    try {
      if (ContextGrounder.isSubstantiveForPreGrounding(cleanIncomingText)) {
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
      hasScheduleSignal,
      hasFallInjury,
      hasVaccineSignal,
      timeHint,
      retrievedChunks: input.retrievedChunks,
      emptyKnowledgeResult: false,
      bundleCompositionNote: null,
      preGroundingBlock,
    };
  }
}
