import axios from 'axios';
import { ALL_V3_TOOLS, executeToolByName, ToolExecutionContext } from '../tools/tool-registry';
import { CustomerGoalSession, GoalTracker } from '../state/goal-tracker';
import { PersonaPromptBuilder, DynamicPromptExemplar, extractFastIntents } from './persona';
import { V3ConversationSummarizer } from '../state/conversation-summarizer';
import { ConversationState } from '@prisma/client';
import { OutputSanitizer } from '../guardrails/sanitizer';
import { isPureLeadGreeting, stripAdTags } from '../../utils/lead-greeting-detector';
import { TEMPLATES } from '../../config/persona';
import { getLlmEndpointConfig } from '../../integrations/llm/llm-gateway';
import { AiModelConfigService } from '../../config/ai-models.config';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

import { prisma } from '../../db/client';
import { validateToolArgs } from '../tools/tool-schemas';
import { validateNumericFacts } from '../guardrails/numeric-fact-validator';
import { normalizeWhatsAppFormat } from '../../utils/whatsapp-format';
import { CircuitBreaker } from '../../utils/circuit-breaker';
import { maskPhoneNumber, maskToolArgsForLogging } from '../../utils/pii-masker';

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

export const v3LlmCircuitBreaker = new CircuitBreaker(
  async (url: string, payload: any, headers: any) => {
    const response = await axios.post(url, payload, { headers, timeout: 15000 });
    return response.data;
  },
  async (url: string, payload: any, headers: any) => {
    const fallbackApiKey = process.env.LLM_FALLBACK_API_KEY || '';
    const fallbackBaseUrl = (process.env.LLM_FALLBACK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
    const fallbackModel = process.env.AI_MODEL_FALLBACK || 'deepseek-chat';
    const fallbackPayload = { ...payload, model: fallbackModel };
    const fallbackHeaders = { Authorization: `Bearer ${fallbackApiKey}`, 'Content-Type': 'application/json' };
    console.warn(`[CIRCUIT BREAKER FALLBACK] Executing fallback to ${fallbackModel}...`);
    if (!fallbackApiKey) {
      throw new Error('LLM_FALLBACK_API_KEY not configured');
    }
    const fallbackResponse = await axios.post(`${fallbackBaseUrl}/chat/completions`, fallbackPayload, {
      headers: fallbackHeaders,
      timeout: 20000,
    });
    return fallbackResponse.data;
  },
  {
    name: 'V3 LLM Primary Gateway',
    failureThreshold: 0.5,
    slidingWindowSize: 6,
    cooldownPeriodMs: 45000,
  }
);

export interface AgentRunnerInput {
  tenantId?: string;
  customerId: string;
  conversationId: string;
  phone: string;
  chatId: string;
  incomingText: string;
  /**
   * Teks mentah asli customer (termasuk tag iklan Promo[...]) untuk DB audit
   * trail. Jika kosong, incomingText dipakai sebagai fallback.
   */
  originalText?: string;
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  forceModel?: string;
  skipDbLogging?: boolean;
  /**
   * Intents pra-ekstraksi dari state machine (EntityExtractor). Bila memuat
   * 'out_of_domain', runner berhenti sebelum LLM Call 1/2 (0 token) dan
   * mengembalikan eskalasi — kontrak anti-jawab-tanpa-domain di level tool.
   */
  preExtractedIntents?: string[];
}

export interface V3RetrievedChunk {
  id: string;
  title: string;
  content: string;
  similarity: number | null;
  score?: number | null;
}

export interface V3TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface AgentRunnerOutput {
  replyText: string;
  executedTools: Array<{ name: string; args: any; result: any }>;
  updatedSession: CustomerGoalSession;
  shouldSendReply: boolean;
  isEscalated: boolean;
  /**
   * Learning loop: true bila turn ini menjawab dengan grounding kosong
   * (search_knowledge_faq dipanggil tapi chunks[] kosong) — balasan tetap
   * terkirim, tapi machine mencatat reason 'unresolved_faq' agar admin kurasi.
   */
  unresolvedFaq?: boolean;
  /** Observability: RAG chunks yang diambil via tool search_knowledge_faq. */
  retrievedChunks: V3RetrievedChunk[];
  /** Observability: contoh chat dinamis yang disuntikkan ke system prompt. */
  fewShotExemplars: DynamicPromptExemplar[];
  /** Observability: teks utuh system prompt yang dikirim ke LLM. */
  systemPrompt: string;
  /** Observability: reasoning/chain-of-thought model (bila disediakan provider). */
  reasoning: string | null;
  /** Observability: agregat token kedua panggilan LLM. */
  tokens: V3TokenUsage;
  /** Observability: estimasi biaya Rupiah agregat. */
  costIdr: number;
  /** Sinkronisasi CRM: status state-machine turunan dari session (agar tidak beku di INITIAL). */
  nextState?: ConversationState;
  /** Observability: ringkasan konteks deterministik terakhir yang disuntik ke system prompt. */
  contextSummary?: string;
}

/** Fase percakapan deterministik (derivasi dari session state, bukan keyword). */
export type ConversationPhase =
  | 'GREETING'
  | 'LOCATION_KNOWN'
  | 'ONGKIR_QUOTED'
  | 'TREATMENT_DISCUSSED'
  | 'SCHEDULING'
  | 'GENERAL';

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
  addUsage: (usage: any) => void;
  auditUsage: (usage: any, startedAt: number) => Promise<void> | void;
}

/**
 * Re-prompt koreksi angka 1x, sesi 214956 (diekspos untuk testing).
 * Mengirim ulang konteks + nota koreksi (angka resmi dari validator) dan
 * mengembalikan teks balasan mentah, atau null bila kosong/gagal.
 * TANPA penggantian string di tengah kalimat — LLM menyusun ulang utuh.
 */
export async function attemptNumericReprompt(deps: NumericRepromptDeps): Promise<string | null> {
  const expected = (deps.expectedTotals || [])
    .map((n) => `Rp ${n.toLocaleString('id-ID')}`)
    .join(' / ');
  const correctionNote = `[KOREKSI FAKTA ANGKA — WAJIB DIPATUHI]\nDraf balasan Anda mengandung nominal yang SALAH dan DITOLAK sistem:\n${deps.violations.map((v) => `- ${v}`).join('\n')}\n${expected ? `Angka total resmi yang WAJIB Anda tulis: ${expected}.\n` : ''}Tugas: tulis ULANG seluruh balasan dari awal dengan kata-kata Anda sendiri yang hangat dan natural (Bidan Yusi), dengan SATU syarat mutlak: setiap nominal rupiah HARUS persis sama dengan angka resmi di atas. DILARANG mengubah, membulatkan, atau menebak nominal. JANGAN menjelaskan koreksi ini ke customer.`;
  const retryPayload: any = {
    ...deps.basePayload,
    messages: [...deps.messages, { role: 'user', content: correctionNote }],
  };
  const retryStartedAt = Date.now();
  const retryData = await V3AgentRunner.executeChatCompletion({
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

export class V3AgentRunner {
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
      const { prisma } = await import('../../db/client');
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

  /** Publik agar helper re-prompt koreksi angka (terekspos untuk testing) bisa memakainya. */
  public static async executeChatCompletion(params: {
    payload: any;
    tenantId: string;
    phone: string;
    conversationId: string;
    baseUrl: string;
    apiKey: string;
    selectedModel: string;
  }): Promise<any> {
    const url = `${params.baseUrl}/chat/completions`;
    const headers = { Authorization: `Bearer ${params.apiKey}`, 'Content-Type': 'application/json' };
    return await v3LlmCircuitBreaker.execute(url, params.payload, headers);
  }

  /**
   * Menjalankan agentic execution loop dengan native tool-calling & context grounding.
   */
  public static async processMessage(input: AgentRunnerInput): Promise<AgentRunnerOutput> {
    const {
      tenantId = DEFAULT_TENANT_ID,
      customerId,
      conversationId,
      phone,
      chatId,
      incomingText,
      history = [],
      forceModel,
    } = input;

    // 1. Ambil session state saat ini
    let session = await GoalTracker.getGoalSession(conversationId, tenantId);

    // Kontrak domain: out_of_domain pra-ekstraksi (dari state machine atau
    // pemanggil lain) dihentikan di sini sebelum LLM berjalan — eskalasi sunyi.
    if (input.preExtractedIntents?.includes('out_of_domain')) {
      console.log(`[V3 DOMAIN GATE] out_of_domain pra-ekstraksi untuk ${phone} — eskalasi sunyi tanpa LLM.`);
      return {
        replyText: '',
        executedTools: [],
        updatedSession: session,
        shouldSendReply: false,
        isEscalated: true,
        retrievedChunks: [],
        fewShotExemplars: [],
        systemPrompt: '',
        reasoning: null,
        tokens: { prompt: 0, completion: 0, total: 0 },
        costIdr: 0,
        nextState: ConversationState.HUMAN_HANDLING,
      };
    }

    const toolContext: ToolExecutionContext = {
      tenantId,
      customerId,
      conversationId,
      phone,
      chatId,
      selectedTreatment: session.selectedTreatment,
    };

    // 2. Siapkan LLM endpoint & API keys
    const modelConfig = AiModelConfigService.getModelConfig('CHAT_REPLY', tenantId);
    const endpointConfig = getLlmEndpointConfig({ modelConfigKey: 'CHAT_REPLY' });
    const selectedModel = forceModel || modelConfig?.modelName || 'gpt-4o-mini';
    const baseUrl = endpointConfig.baseUrl;
    const apiKey = endpointConfig.apiKey;

    // 3. Susun percakapan dengan auto-rehydrate dari DB jika history kosong.
    // Gunakan messageService.getRecentMessages (punya in-memory fallback) agar
    // isFollowUp tidak false-negative saat DB offline / pengujian lokal.
    // Teks bersih (tanpa tag iklan Promo[...]) khusus lapisan inferensi LLM.
    const cleanIncomingText = stripAdTags(incomingText) || incomingText;
    let conversationHistory = [...history];
    if (conversationHistory.length === 0 && conversationId) {
      try {
        const { messageService } = await import('../../services/message.service');
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
        const { treatmentCatalogService } = await import('../../services/treatment-catalog.service');
        const agreed = V3AgentRunner.detectAgreedTreatment(
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
        const { treatmentCatalogService } = await import('../../services/treatment-catalog.service');
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

    // Ringkasan konteks deterministik (0 token): apa yang SUDAH dibahas, FOKUS saat ini,
    // dan apa yang DILARANG diulang — anti kaset-rusak & anti amnesia antar turn.
    // Closure agar bisa dihitung ulang dari session terbaru sebelum Call 2 (refresh prompt
    // menimpa messages[0], sehingga summary harus ditempel ulang).
    const buildContextSummary = (): string => {
      try {
        return V3ConversationSummarizer.summarize(session, cleanIncomingText, {
          history: conversationHistory.map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
          customerInput: cleanIncomingText,
        });
      } catch (e) {
        return '';
      }
    };
    const contextSummary = buildContextSummary();
    let lastContextSummary = contextSummary;
    // Fondational Akar 2: konteks fase percakapan eksplisit untuk Call 1 —
    // tool selection tidak lagi buta (tahu ongkir sudah QUOTED, treatment
    // sudah dibahas). Guidance via prompt, semua tool tetap dikirim.
    const buildPhaseDirective = (): string => {
      try {
        return V3AgentRunner.buildPhaseDirective(
          V3AgentRunner.deriveConversationPhase(session, isFollowUp),
          session
        );
      } catch (e) {
        return '';
      }
    };
    let lastPhaseDirective = buildPhaseDirective();

    // Call 1 Router: prompt ringkas khusus tool routing (~800-1.200 token)
    const routerPrompt = PersonaPromptBuilder.buildRouterPrompt(session, isFollowUp, {
      contextSummary,
      phaseDirective: lastPhaseDirective,
    });
    let currentSystemPrompt = routerPrompt;
    let fewShotExemplars: any[] = [];
    let preGroundingBlock = '';

    // Jendela 8 pesan terakhir (4 turn) — data sesi penting sudah tercatat di GoalSession
    const recentHistory = conversationHistory.slice(-8).map((h) => ({ role: h.role, content: h.content }));
    const userMessage = {
      role: 'user',
      content: `<customer_message>\n${cleanIncomingText}\n</customer_message>`,
    };

    const messages: any[] = [
      { role: 'system', content: routerPrompt },
      ...recentHistory,
      userMessage,
    ];

    const emptyTokens: V3TokenUsage = { prompt: 0, completion: 0, total: 0 };
    const turnStartedAt = Date.now();

    // GATE DETERMINISTIK: sapaan pembuka murni (Turn-0) langsung dibalas template
    // resmi tanpa LLM (0 token). Hanya bila asisten belum pernah membalas.
    if (!isFollowUp) {
      const leadCheck = isPureLeadGreeting(cleanIncomingText);
      if (leadCheck.isLeadGreeting) {
        const staticReply = TEMPLATES.greeting({ isIslamic: leadCheck.isIslamic });
        if (conversationId && !input.skipDbLogging) {
          try {
            const { messageService } = await import('../../services/message.service');
            const { Direction } = await import('@prisma/client');
            await messageService.logMessage({
              tenantId,
              conversationId,
              direction: Direction.INBOUND,
              content: input.originalText || incomingText,
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
          replyText: staticReply,
          executedTools: [],
          updatedSession: session,
          shouldSendReply: true,
          isEscalated: false,
          retrievedChunks: [],
          fewShotExemplars,
          systemPrompt: currentSystemPrompt,
          reasoning: null,
          tokens: emptyTokens,
          costIdr: 0,
          nextState: V3AgentRunner.deriveConversationState(session, extractFastIntents(cleanIncomingText)),
        };
      }
    }

    const executedTools: Array<{ name: string; args: any; result: any }> = [];
    let isEscalated = false;
    let shouldSendReply = true;
    let finalReply = '';

    // Observability turn-level: chunks RAG, reasoning model, agregat token.
    const retrievedChunks: V3RetrievedChunk[] = [];
    const retrievedChunkIds = new Set<string>();
    // Penanda grounding kosong (Fase A): search_knowledge_faq → chunks[].
    let emptyKnowledgeResult = false;
    let reasoning: string | null = null;
    const totalTokens: V3TokenUsage = { prompt: 0, completion: 0, total: 0 };
    const addUsage = (usage: any): void => {
      const p = Number(usage?.prompt_tokens) || 0;
      const c = Number(usage?.completion_tokens) || 0;
      totalTokens.prompt += p;
      totalTokens.completion += c;
      totalTokens.total += p + c;
    };
    const auditUsage = async (usage: any, startedAt: number, error?: any): Promise<void> => {
      try {
        const { auditLlmCall } = await import('../../utils/llm-audit-buffer');
        auditLlmCall({
          customer_phone: phone,
          tenant_id: tenantId,
          conversation_id: conversationId,
          task_type: 'V3_AGENT',
          model_name: selectedModel,
          baseUrl,
          startedAt,
          error: error ?? null,
          usage: usage ?? null,
        });
      } catch {}
    };
    const finishCost = async (): Promise<number> => {
      try {
        const { calculateLlmCost } = await import('../../utils/cost-calculator');
        return calculateLlmCost(selectedModel, totalTokens.prompt, totalTokens.completion, 0).totalCostIdr || 0;
      } catch {
        return 0;
      }
    };
    const traceExecution = async (params: {
      reply: string;
      status: 'SUCCESS' | 'FALLBACK' | 'ERROR';
      tools: Array<{ name: string; args: any; result: any }>;
    }): Promise<void> => {
      try {
        const { recordLlmExecution } = await import('../../utils/llm-execution-logger');
        recordLlmExecution({
          flowType: 'V3_AGENT' as any,
          customerPhone: phone,
          customerInput: incomingText,
          bubbleCorrelationId: chatId,
          promptPayload: { model: selectedModel, systemPrompt: currentSystemPrompt, messageCount: messages.length },
          reasoning,
          groundTruthUsed: {
            retrievedChunks,
            fewShotExemplars: fewShotExemplars.map((e) => ({ id: e.id, scenario: e.scenario })),
            executedTools: params.tools.map((t) => t.name),
          },
          finalReply: params.reply,
          modelUsed: selectedModel,
          durationMs: Date.now() - turnStartedAt,
          status: params.status,
        });
      } catch {}
    };

    // ── Hybrid RAG: Deterministic Semantic Pre-Retrieval (Pre-Call 1 Grounding) ──
    // Pertanyaan konsultatif (keluhan, perbedaan treatment, syarat usia, SOP klinik,
    // kehamilan/induksi) otomatis dicarikan artikel resmi knowledge_chunks SEBELUM Call 1.
    // LLM dijamin memegang SOP resmi klinik tanpa bergantung pada insting tool-calling.
    try {
      if (V3AgentRunner.isSubstantiveForPreGrounding(cleanIncomingText)) {
        const { knowledgeBaseService } = await import('../../services/knowledge.service');
        // Audit 315036: limit 3 agar pertanyaan multi-topik ("cukur + pijat
        // terapi") tidak memotong artikel definisi terapi.
        const preChunks = await knowledgeBaseService.searchRelevantChunks(cleanIncomingText, 3, tenantId);
        if (preChunks && preChunks.length > 0) {
          preGroundingBlock = `[PANDUAN & KNOWLEDGE BASE RESMI KLINIK - WAJIB DIPATUHI]\n`
            + `Berikut panduan resmi klinik yang RELEVAN dengan pertanyaan customer saat ini. Jadikan sebagai acuan utama jawaban (grounded), jangan mengarang di luar panduan ini:\n`
            + preChunks.map((c: any, i: number) => `Artikel ${i + 1} — ${c.title}:\n${c.content}`).join('\n\n');
          messages[0].content = `${messages[0].content}\n\n${preGroundingBlock}`;
          currentSystemPrompt = messages[0].content;
          for (const c of preChunks as any[]) {
            const key = String((c as any)?.id || (c as any)?.title || '');
            if (key && !retrievedChunkIds.has(key)) {
              retrievedChunkIds.add(key);
              const realScore = typeof (c as any)?.similarity === 'number' ? (c as any).similarity
                : (typeof (c as any)?.score === 'number' ? (c as any).score
                : (typeof (c as any)?.rank === 'number' ? (c as any).rank : 0.9));
              retrievedChunks.push({
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

    // Phase 3 — pelabelan internal "Tanya Jadwal" (DB only, zero WAHA):
    // customer menanyakan hari/jadwal → catat ke customer_labels agar tampil
    // di dashboard admin LiveChatMonitor. Fire-and-forget aman (try/catch di
    // dalam, tak pernah menggagalkan turn). DILARANG memanggil WAHA label API.
    if (conversationId && V3AgentRunner.hasScheduleSignal(cleanIncomingText)) {
      await V3AgentRunner.assignInternalScheduleLabel(conversationId, tenantId);
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
    if (conversationId && V3AgentRunner.hasScheduleSignal(cleanIncomingText)
      && !session.booking?.preferredDate && !session.booking?.requestedTimeHint
      && !session.booking?.reservationId) {
      const hint = V3AgentRunner.extractTimeHint(cleanIncomingText);
      if (hint) {
        try {
          session = await GoalTracker.updateGoalSession(conversationId, {
            booking: { ...(session.booking || {}), requestedTimeHint: hint, isConfirmed: false },
          }, tenantId);
        } catch (e) {}
      }
    }

    try {
      // 4. Panggilan Pertama: Model mengevaluasi apakah perlu memanggil Tools
      const detectedIntents = extractFastIntents(cleanIncomingText);

      // Autonomous tool routing: hanya lokasi yang di-forcing deterministik
      // (ongkir wajib hitung via calculate_delivery). Pertanyaan harga/konsultasi/FAQ
      // dibiarkan 'auto' agar Call 1 bebas memilih get_catalog_and_price ATAU
      // search_knowledge_faq sesuai kebutuhan — forcing katalog berbasis substring
      // "berapa" sebelumnya memblokir pemanggilan FAQ (mis. "berapa minggu ... induksi?").
      let dynamicToolChoice: any = 'auto';

      // Prioritaskan lokasi (ongkir) bila gazetteer match, karena kalimat "berapa ongkir ke X"
      // mengandung dua sinyal (ask_price + provide_location) namun intent utamanya adalah cek ongkir
      if (detectedIntents.includes('provide_location')) {
        dynamicToolChoice = { type: 'function', function: { name: 'calculate_delivery' } };
      } else if (V3AgentRunner.hasFallInjurySignal(cleanIncomingText)) {
        // Audit 337101 (pediatric safety): trauma jatuh WAJIB grounding SOP
        // skrining — setara prioritas forcing lokasi/vaksin. Mencegah LLM
        // mencatut artikel mandi/relaksasi untuk kasus trauma fisik.
        dynamicToolChoice = { type: 'function', function: { name: 'search_knowledge_faq' } };
      } else if (V3AgentRunner.hasVaccineSignal(cleanIncomingText)) {
        // Audit 222655 (fatal medical error): pertanyaan imunisasi/vaksinasi
        // WAJIB di-grounding SOP pasca-vaksin deterministik (clinical safety —
        // setara prioritasnya dengan forcing lokasi). Mencegah LLM mencatut
        // artikel mandi untuk menjawab soal vaksin.
        dynamicToolChoice = { type: 'function', function: { name: 'get_clinic_policy_faq' } };
      }

      // Tool Schema Filtering untuk Call 1:
      // Jika di-forcing ke 1 tool spesifik, kirim HANYA tool tersebut (hemat ~1.500 token).
      // Jika 'auto', kirim seluruh ALL_V3_TOOLS agar router bebas memilih.
      let toolsForCall1: any[] = ALL_V3_TOOLS;
      if (typeof dynamicToolChoice === 'object' && dynamicToolChoice?.function?.name) {
        const forcedName = dynamicToolChoice.function.name;
        const matchingTool = ALL_V3_TOOLS.find((t: any) => t.function?.name === forcedName);
        if (matchingTool) {
          toolsForCall1 = [matchingTool];
        }
      }

      const firstPayload: any = {
        model: selectedModel,
        messages,
        tools: toolsForCall1,
        tool_choice: dynamicToolChoice,
        temperature: 0.2,
      };

      const firstStartedAt = Date.now();
      const firstData = await V3AgentRunner.executeChatCompletion({
        payload: firstPayload,
        tenantId,
        phone,
        conversationId,
        baseUrl,
        apiKey,
        selectedModel,
      }).then(async (data) => {
        addUsage((data as any)?.usage);
        await auditUsage((data as any)?.usage, firstStartedAt);
        return data;
      });

      const choice = firstData?.choices?.[0];
      const assistantMessage = choice?.message;
      const toolCalls = assistantMessage?.tool_calls;
      if (!reasoning && typeof (assistantMessage as any)?.reasoning_content === 'string') {
        reasoning = (assistantMessage as any).reasoning_content;
      }

      // 5. Jika Model Memanggil Tools
      if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
        messages.push(assistantMessage);

        for (const tc of toolCalls) {
          const fnName = tc.function?.name;
          let fnArgs: any = {};
          try {
            fnArgs = typeof tc.function?.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : tc.function?.arguments || {};
          } catch (_) {}

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
              toolContext.locationSnapshot = session.location
                ? {
                    kelurahan: session.location.kelurahan,
                    ongkirPromo: session.location.ongkirPromo,
                    ongkirNormal: session.location.ongkirNormal,
                    ongkirStatus: session.ongkirStatus,
                  }
                : undefined;
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
              if (key && !retrievedChunkIds.has(key)) {
                retrievedChunkIds.add(key);
                const realScore = typeof c?.similarity === 'number' ? c.similarity : (typeof c?.score === 'number' ? c.score : (typeof (c as any)?.rank === 'number' ? (c as any).rank : null));
                retrievedChunks.push({
                  id: String(c?.id || key),
                  title: String(c?.title || ''),
                  content: String(c?.content || ''),
                  similarity: realScore !== null ? realScore : 0.90,
                  score: realScore !== null ? realScore : 0.90,
                } as any);
              }
            }
          }

          // Perbarui session state berdasarkan hasil tool
          if (fnName === 'calculate_delivery' && toolResult.success) {
            session = await GoalTracker.updateGoalSession(conversationId, {
              location: {
                rawText: fnArgs.locationText,
                kelurahan: toolResult.kelurahan,
                kecamatan: toolResult.kecamatan,
                kota: toolResult.kota,
                distanceKm: toolResult.distanceKm,
                ongkirNormal: toolResult.ongkirNormal,
                ongkirPromo: toolResult.ongkirPromo,
                isOutOfCoverage: toolResult.isOutOfCoverage,
              },
            }, tenantId);
            // Lifecycle ongkir: hasil kalkulasi akan disampaikan ke customer → QUOTED.
            if (!toolResult.isOutOfCoverage) {
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
                  if (key && !retrievedChunkIds.has(key)) {
                    retrievedChunkIds.add(key);
                    retrievedChunks.push({
                      id: key,
                      title: `[Katalog Layanan] ${String(t?.name || '')}`,
                      content: `${String(t?.description || '')}\nKategori: ${String(t?.category || '')}, Durasi: ${Number(t?.durationMinutes || 0)} menit, Promo: Rp ${Number(t?.promoPrice || 0).toLocaleString('id-ID')}`,
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
            session = await GoalTracker.updateGoalSession(conversationId, {
              selectedTreatment: fnArgs.treatmentName,
              booking: {
                preferredDate: fnArgs.bookingDate,
                preferredTime: fnArgs.bookingTime,
                reservationId: toolResult.reservationId,
                isConfirmed: false,
              },
            }, tenantId);
          } else if (fnName === 'escalate_to_human') {
            isEscalated = true;
            shouldSendReply = false;
          }

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: fnName,
            content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
          });
        }

        // Jika tereskalasi, hentikan langsung agar bot tidak mengirim balasan
        if (isEscalated) {
          await traceExecution({ reply: '', status: 'SUCCESS', tools: executedTools });
          return {
            replyText: '',
            executedTools,
            updatedSession: session,
            shouldSendReply: false,
            isEscalated: true,
            retrievedChunks,
            fewShotExemplars,
            systemPrompt: currentSystemPrompt,
            reasoning,
            tokens: { ...totalTokens },
            costIdr: await finishCost(),
            nextState: ConversationState.HUMAN_HANDLING,
          };
        }

        // 6. Panggilan Kedua: Menyusun teks balasan ramah Bidan Yusi menggunakan fakta tool
        // Perbarui system prompt di messages[0] dengan session terbaru yang telah di-grounding hasil tools
        // (async agar blok contoh dinamis bank tetap dipakai, bukan revert ke statis).
        const refreshedPrompt = await PersonaPromptBuilder.buildSystemPromptAsync(session, isFollowUp, {
          tenantId,
          incomingText: cleanIncomingText,
        });
        fewShotExemplars = refreshedPrompt.exemplars;

        // Tempel ulang ringkasan + phase directive dari session terbaru
        const refreshedSummary = buildContextSummary();
        if (refreshedSummary) lastContextSummary = refreshedSummary;
        const refreshedPhase = buildPhaseDirective();
        if (refreshedPhase) lastPhaseDirective = refreshedPhase;

        const fullSystemPrompt = [
          refreshedPrompt.systemPrompt,
          refreshedSummary,
          refreshedPhase,
          preGroundingBlock,
        ].filter(Boolean).join('\n\n');

        messages[0].content = fullSystemPrompt;
        currentSystemPrompt = fullSystemPrompt;

        const secondPayload: any = {
          model: selectedModel,
          messages,
          temperature: 0.65,
        };

        const secondStartedAt = Date.now();
        const secondData = await V3AgentRunner.executeChatCompletion({
          payload: secondPayload,
          tenantId,
          phone,
          conversationId,
          baseUrl,
          apiKey,
          selectedModel,
        }).then(async (data) => {
          addUsage((data as any)?.usage);
          await auditUsage((data as any)?.usage, secondStartedAt);
          return data;
        });

        finalReply = secondData?.choices?.[0]?.message?.content || '';
        if (!reasoning && typeof (secondData?.choices?.[0]?.message as any)?.reasoning_content === 'string') {
          reasoning = (secondData.choices[0].message as any).reasoning_content;
        }
      } else {
        // Jika tidak ada tool calls, gunakan langsung konten balasan
        finalReply = assistantMessage?.content || '';
      }

      // 7. Sanitasi Balasan
      finalReply = OutputSanitizer.cleanOutboundReply(finalReply, incomingText, isFollowUp);

      const numCheck = validateNumericFacts(finalReply, executedTools, { tenantId, session });
      // Audit 854065 (celah bypass): validasi WAJIB aktif pula saat keranjang
      // memiliki item walau turn ini tanpa tool call (tanya total langsung).
      const hasActiveCart = (session?.cartItems || []).length > 0;
      if (!numCheck.isValid && (executedTools.length > 0 || hasActiveCart)) {
        console.warn(JSON.stringify({ event: 'NUMERIC_HALLUCINATION_DETECTED', tenantId, conversationId, phone: maskPhoneNumber(phone), violations: numCheck.violations, timestamp: new Date().toISOString() }));
        // Re-prompt bersih 1x, sesi 214956 (TANPA mutilasi regex tengah kalimat):
        // minta LLM susun ulang SELURUH balasan dengan angka resmi. Gagal lagi
        // (atau error) → fallback ke template tool yang ter-grounding.
        let repromptOk = false;
        try {
          const retryReply = await attemptNumericReprompt({
            tenantId,
            phone,
            conversationId,
            baseUrl,
            apiKey,
            selectedModel,
            basePayload: { model: selectedModel, temperature: 0.65 },
            messages,
            violations: numCheck.violations,
            expectedTotals: numCheck.expectedTotals || [],
            addUsage,
            auditUsage,
          });
          const trimmedRetry = (retryReply || '').trim();
          if (trimmedRetry) {
            const cleanedRetry = OutputSanitizer.cleanOutboundReply(trimmedRetry, incomingText, isFollowUp);
            const recheck = validateNumericFacts(cleanedRetry, executedTools, { tenantId, session });
            if (recheck.isValid) {
              finalReply = cleanedRetry;
              repromptOk = true;
              console.log(JSON.stringify({ event: 'NUMERIC_REPROMPT_FIXED', tenantId, conversationId, timestamp: new Date().toISOString() }));
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
              const who = it.recipientScope === 'MOMS' ? 'Bunda'
                : it.recipientScope === 'CHILD_2' ? 'Kakak'
                : it.recipientScope === 'CHILD_1' ? 'Adik' : null;
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
      const { validateFactualClaims } = await import('../guardrails/factual-claim-validator');
      const locationKnown = !!(session?.location?.kelurahan || (session?.location as any)?.kecamatan);
      const factCheck = validateFactualClaims(finalReply, executedTools, retrievedChunks, { locationKnown });
      if (!factCheck.isValid && shouldSendReply && !isEscalated && finalReply.trim()) {
        console.warn(JSON.stringify({ event: 'FACTUAL_HALLUCINATION_DETECTED', tenantId, conversationId, phone: maskPhoneNumber(phone), violations: factCheck.violations, timestamp: new Date().toISOString() }));
        let factRepromptOk = false;
        try {
          const correctionNote = `KOREKSI FAKTUAL — tulis ulang SELURUH balasan HANYA dari data tool resmi turn ini (katalog, knowledge, kebijakan). LARANGAN:\n- ${factCheck.violations.join('\n- ')}\nJika data tidak ada, JANGAN mengarang — jawab jujur bahwa info pastinya akan dicek tim kami.`;
          const factRetryData = await V3AgentRunner.executeChatCompletion({
            payload: { model: selectedModel, messages: [...messages, { role: 'user', content: correctionNote }], temperature: 0.3 },
            tenantId,
            phone,
            conversationId,
            baseUrl,
            apiKey,
            selectedModel,
          });
          addUsage((factRetryData as any)?.usage);
          const factRetryText = (factRetryData?.choices?.[0]?.message?.content || '').trim();
          if (factRetryText) {
            const factCleaned = OutputSanitizer.cleanOutboundReply(factRetryText, incomingText, isFollowUp);
            const factRecheck = validateFactualClaims(factCleaned, executedTools, retrievedChunks, { locationKnown });
            if (factRecheck.isValid) {
              finalReply = factCleaned;
              factRepromptOk = true;
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
            const { TEMPLATES } = await import('../../config/persona');
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

      // Post-processor deterministik: konversi Markdown ganda (**tebal**) ke
      // format WhatsApp tunggal (*tebal*) untuk SEMUA output agent — berlaku di
      // simulator, dashboard, log LLM, maupun WAHA (sebelum validasi & logging).
      finalReply = normalizeWhatsAppFormat(finalReply);

      if (!OutputSanitizer.isValidReply(finalReply)) {
        console.warn(JSON.stringify({ event: 'V3_AGENT_SANITIZER_REJECTED', tenantId, conversationId, phone: maskPhoneNumber(phone), reply: finalReply.slice(0, 100), timestamp: new Date().toISOString() }));
        finalReply = `Halo ${session.genderGreeting} 😊\n\nTerima kasih sudah menghubungi kami di Kala Moms & Baby Spa. Ada yang bisa Bidan Yusi bantu untuk perawatan Bunda atau si kecil hari ini? ✨`;
      }

      if (conversationId && !input.skipDbLogging) {
        try {
          const { messageService } = await import('../../services/message.service');
          const { Direction } = await import('@prisma/client');
          await messageService.logMessage({
            tenantId,
            conversationId,
            direction: Direction.INBOUND,
            content: input.originalText || incomingText,
          });
          if (finalReply && !isEscalated) {
            await messageService.logMessage({
              tenantId,
              conversationId,
              direction: Direction.OUTBOUND,
              content: finalReply,
            });
          }
        } catch (e) {}
      }

      await traceExecution({ reply: finalReply, status: 'SUCCESS', tools: executedTools });
      return {
        replyText: finalReply,
        executedTools,
        updatedSession: session,
        shouldSendReply: shouldSendReply && !isEscalated,
        isEscalated,
        unresolvedFaq: emptyKnowledgeResult && !isEscalated,
        retrievedChunks,
        fewShotExemplars,
        systemPrompt: currentSystemPrompt,
        reasoning,
        tokens: { ...totalTokens },
        costIdr: await finishCost(),
        nextState: isEscalated
          ? ConversationState.HUMAN_HANDLING
          : V3AgentRunner.deriveConversationState(session, extractFastIntents(cleanIncomingText)),
        contextSummary: lastContextSummary || undefined,
      };
    } catch (err: any) {
      console.error(JSON.stringify({ event: 'V3_AGENT_RUNNER_ERROR', tenantId, conversationId, phone: maskPhoneNumber(phone), error: err.response?.data || err.message, timestamp: new Date().toISOString() }));

      try {
        const { auditLlmCall } = await import('../../utils/llm-audit-buffer');
        auditLlmCall({
          customer_phone: phone,
          tenant_id: tenantId,
          conversation_id: conversationId,
          task_type: 'V3_AGENT',
          model_name: selectedModel,
          baseUrl,
          startedAt: turnStartedAt,
          error: { message: err?.message || 'V3_AGENT_ERROR' },
          usage: null,
        });
      } catch {}

      // Outage LLM total (Fase B): TANPA balasan generik. Jawaban "tanya alamat"
      // yang lama menyesatkan (termasuk untuk konteks medis/eskalasi).
      // Kembalikan eskalasi sunyi — machine mencatat reason & memberi tahu CS.

      try {
        const { recordLlmExecution } = await import('../../utils/llm-execution-logger');
        recordLlmExecution({
          flowType: 'V3_AGENT' as any,
          customerPhone: phone,
          customerInput: incomingText,
          bubbleCorrelationId: chatId,
          promptPayload: { model: selectedModel },
          reasoning,
          finalReply: '',
          modelUsed: selectedModel,
          durationMs: Date.now() - turnStartedAt,
          status: 'ERROR',
        });
      } catch {}

      return {
        replyText: '',
        executedTools: [],
        updatedSession: session,
        shouldSendReply: false,
        isEscalated: true,
        retrievedChunks,
        fewShotExemplars,
        systemPrompt: currentSystemPrompt,
        reasoning,
        tokens: { ...totalTokens },
        costIdr: 0,
        nextState: ConversationState.HUMAN_HANDLING,
      };
    }
  }
}
