import { IWahaClient, wahaClient } from '../integrations/waha/client';
import { MessageTransport } from '../integrations/whatsapp/transport';
import { measure } from '../utils/timer';
import { stageLog, isSimpleLogMode } from '../utils/stage-logger';
import {
  getHumanizerBubbleConfig,
  type HumanizerBubbleConfig,
} from '../config/humanizer-bubble.config';
import dotenv from 'dotenv';
dotenv.config();

export interface HumanReplyParams {
  chatId: string;
  incomingMessageId?: string;
  incomingText?: string;   // untuk hitung reading delay
  replyText: string;      // teks balasan yang akan di-bubble-split
  tenantId?: string;
  shouldAbort?: () => Promise<boolean> | boolean; // guard pembatalan real-time jika CS takeover
  singleBubble?: boolean; // Jika true: kirim sebagai 1 bubble utuh tanpa dipecah (misal follow-up/broadcast)
  /** Stage 5 Fase 3: id turn durable (untuk outbound ledger per-bubble). */
  turnId?: string;
  /** Stage 5 Fase 3: provider asal (WAHA/WABA) untuk ledger. */
  provider?: string;
}

export interface HumanReplyResult {
  success: boolean;
  bubblesSent: number;
  error?: string;
  /** ID WhatsApp resmi bubble terakhir (untuk ACK delivered/read & reaksi). */
  messageId?: string;
}

/** Pemisah label↔nilai yang selalu aktif; tambahan per tenant via DB settings. */
const DEFAULT_FIELD_SEPARATORS = [':'];

/**
 * W-010: apakah satu baris berbentuk field form (`Label : nilai`)?
 * Murni struktural — tidak mengenal nama label bisnis apa pun.
 */
export function isFormFieldLine(line: string, config?: HumanizerBubbleConfig): boolean {
  const text = line.trim();
  if (!text || text.length > 200) return false;

  for (const separator of [...DEFAULT_FIELD_SEPARATORS, ...(config?.extraSeparators ?? [])]) {
    if (!separator) continue;
    const idx = text.indexOf(separator);
    if (idx < 2 || idx > 80) continue;
    const label = text.slice(0, idx).trim();
    if (!label || label.length > 60) continue;
    if (/[.!?,;]$/.test(label)) continue; // kalimat, bukan label
    if (label.split(/\s+/).length > 6) continue;
    if (/^\d{1,2}$/.test(label)) continue; // "09:00" bukan field
    if (/^https?$/i.test(label)) continue; // URL bukan field
    return true;
  }
  return false;
}

interface FormSection {
  start: number;
  end: number;
}

/**
 * Cari blok form secara struktural: kumpulan paragraf berisi baris `Label : nilai`
 * (minimal 3 field), boleh diselingi satu paragraf judul bagian. Judul form
 * pendek tepat di atas blok (mis. "<header form>") ikut dimasukkan ke bubble form.
 */
export function findFormSection(
  paragraphs: string[],
  config?: HumanizerBubbleConfig
): FormSection | null {
  const fieldParagraphs = paragraphs
    .map((paragraph, idx) => ({
      idx,
      count: paragraph
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => isFormFieldLine(line, config)).length,
    }))
    .filter((entry) => entry.count > 0);

  const totalFields = fieldParagraphs.reduce((sum, entry) => sum + entry.count, 0);
  if (totalFields < 3) return null;

  let start = fieldParagraphs[0].idx;
  let end = fieldParagraphs[0].idx;
  for (const entry of fieldParagraphs.slice(1)) {
    // Jeda maksimal 1 paragraf: judul bagian seperti "Pilihan treatment ..." 
    // boleh berada di antara dua blok field.
    if (entry.idx - end <= 2) end = entry.idx;
    else break;
  }

  const headerCandidate = paragraphs[start - 1];
  if (headerCandidate) {
    const headerTrimmed = headerCandidate.trim();
    const headerHasField = headerTrimmed
      .split('\n')
      .some((line) => isFormFieldLine(line, config));
    const looksLikeHeader =
      headerTrimmed.length > 0 &&
      headerTrimmed.length <= 80 &&
      !/[.!?]\s*$/.test(headerTrimmed);
    if (!headerHasField && looksLikeHeader) start -= 1;
  }

  return { start, end };
}

export class TypingService {
  private client: IWahaClient;
  private speedFactor: number = 1;
  private transportResolver?: (tenantId: string) => Promise<MessageTransport | undefined>;

  constructor(
    client?: IWahaClient,
    speedFactor: number = 1,
    transportResolver?: (tenantId: string) => Promise<MessageTransport | undefined>
  ) {
    this.client = client || wahaClient;
    this.speedFactor = speedFactor;
    this.transportResolver = transportResolver;
  }

  /**
   * AUDIT FASE 3 (K-03b): seam untuk memasang transport per-tenant saat boot.
   * Tanpa ini, humanizer (typing/sendSeen/sendText) memakai session WAHA env global.
   */
  public setTransportResolver(
    resolver?: (tenantId: string) => Promise<MessageTransport | undefined>
  ): void {
    this.transportResolver = resolver;
  }

  public setSpeedFactor(factor: number): void {
    this.speedFactor = Math.max(0.1, factor);
  }

  public getSpeedFactor(): number {
    return this.speedFactor;
  }

  /**
   * Mengaplikasikan random jitter (+/- variancePercent) pada delay baseMs.
   */
  public applyJitter(baseMs: number, variancePercent?: number): number {
    const percent = variancePercent ?? parseInt(process.env.HUMANIZER_JITTER_PERCENT || '20', 10);
    // Standard random range: [1 - percent/100, 1 + percent/100]
    const factor = 1 + ((Math.random() * 2 - 1) * percent) / 100;
    return Math.max(0, Math.round(baseMs * factor));
  }

  /**
   * Menghitung jeda "membaca" (Reading Delay) sebelum bot mulai mengetik balasan.
   * Formula: baseReadingMs (default 400) + panjang pesan MASUK x readingMsPerChar (default 15),
   * di-cap max readingDelayMaxMs (default 2500ms) dengan random jitter +/-20%.
   */
  public calculateReadingDelay(incomingText: string, skipJitter = false): number {
    const baseMs = parseInt(process.env.HUMANIZER_READING_BASE_MS || '400', 10);
    const msPerChar = parseInt(process.env.HUMANIZER_READING_MS_PER_CHAR || '15', 10);
    const maxMs = parseInt(process.env.HUMANIZER_READING_DELAY_MAX_MS || '2500', 10);

    const length = incomingText ? incomingText.trim().length : 0;
    const rawReading = baseMs + length * msPerChar;
    const clamped = Math.min(rawReading, maxMs);

    if (skipJitter) return clamped;

    const jittered = this.applyJitter(clamped);
    return Math.min(jittered, Math.round(maxMs * 1.2));
  }

  /**
   * Menghitung durasi delay mengetik (Typing Delay) berdasarkan simulasi kecepatan mengetik HP manusia (WPM).
   * 
   * PENJELASAN FORMULA & KALKULASI MATEMATIS REALISTIS:
   * --------------------------------------------------
   * Formula: rawTypingMs = (words / averageWPM) * 60000 + reactionMs (300ms).
   * 
   * Dengan WPM = 48 (realistis mengetik HP: 25-55 WPM) dan maxMs = 6500ms:
   * - Bubble 2 kata  : (2 / 48) * 60000 + 300 = 2800ms
   * - Bubble 3 kata  : (3 / 48) * 60000 + 300 = 4050ms
   * - Bubble 4 kata  : (4 / 48) * 60000 + 300 = 5300ms (~81.5% dari cap 6500ms - mendarat di rentang 75-90% cap)
   * - Bubble 5+ kata : (5 / 48) * 60000 + 300 = 6550ms -> di-cap ke 6500ms max safety net.
   * 
   * Kombinasi WPM=48, maxChars=130, dan maxMs=6500ms memastikan balasan panjang dipecah
   * secara lebih agresif menjadi 3-4 potongan bubble pendek (~130 karakter), sehingga
   * delay terasa manusiawi, proporsional, dan tidak menggunakan WPM tidak realistis (>55).
   */
  public calculateTypingDelay(replyText: string, skipJitter = false): number {
    const wpm = parseInt(process.env.HUMANIZER_TYPING_AVERAGE_WPM || '48', 10);

    // Guard rail: WPM tidak boleh di atas 55 demi menjaga realisme mengetik manusia di HP
    if (wpm > 55) {
      console.warn(`[TYPING WARNING] HUMANIZER_TYPING_AVERAGE_WPM (${wpm}) exceeds realistic limit 55 WPM.`);
    }

    const reactionMs = parseInt(process.env.HUMANIZER_TYPING_REACTION_MS || '300', 10);
    const minMs = 700;
    const maxMs = parseInt(process.env.HUMANIZER_MAX_TYPING_DELAY_MS || '6500', 10);

    const words = replyText ? replyText.trim().split(/\s+/).filter(Boolean).length : 0;
    const rawTypingMs = (words / Math.max(1, wpm)) * 60000;
    const baseMs = rawTypingMs + reactionMs;

    const clamped = Math.max(minMs, Math.min(baseMs, maxMs));

    if (skipJitter) return clamped;

    const jittered = this.applyJitter(clamped);

    // Pastikan cap maksimum tetap terhormat meski jitter aktif
    return Math.max(minMs, Math.min(jittered, maxMs));
  }

  /**
   * Memotong teks balasan panjang menjadi beberapa bubble (maksimal HUMANIZER_BUBBLE_MAX_COUNT = 4).
   *
   * W-010: pemisahan form reservasi kini STRUKTURAL (blok baris `Label : nilai`,
   * minimal 3 field, dengan judul pendek di atasnya) — TIDAK ada daftar frasa
   * bisnis hardcode. Template form tiap tenant bisa berubah tanpa deploy kode;
   * pemisah non-standar ditambah lewat `Tenant.settings.humanizerBubble`.
   * Teks non-form tetap dipecah per paragraf/kalimat tanpa memotong kalimat.
   */
  public splitIntoBubbles(text: string, config?: HumanizerBubbleConfig): string[] {
    const isEnabled = (process.env.HUMANIZER_BUBBLE_SPLIT_ENABLED ?? 'true') !== 'false';
    if (!isEnabled || !text || !text.trim()) {
      return [text ? text.trim() : ''];
    }

    const trimmed = text.trim();
    const singleThreshold = parseInt(process.env.HUMANIZER_BUBBLE_SINGLE_THRESHOLD_CHARS || '350', 10);
    const maxCount = parseInt(process.env.HUMANIZER_BUBBLE_MAX_COUNT || '2', 10);
    const maxChars = parseInt(process.env.HUMANIZER_BUBBLE_MAX_CHARS || '250', 10);
    const paragraphs = trimmed
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);

    // 0. FORM (struktural): Intro | Blok form | Footer SOP → maksimal 3 bubble.
    //    Batas antar-bubble ditentukan oleh struktur baris, bukan kata kunci bisnis.
    const form = findFormSection(paragraphs, config);
    if (form) {
      const bubbles: string[] = [];
      const intro = paragraphs.slice(0, form.start).join('\n\n');
      const formBody = paragraphs.slice(form.start, form.end + 1).join('\n\n');
      const footer = paragraphs.slice(form.end + 1).join('\n\n');
      if (intro) bubbles.push(intro);
      if (formBody) bubbles.push(formBody);
      if (footer) bubbles.push(footer);
      if (bubbles.length >= 2) return bubbles;
    }

    // 1. JIKA singleThreshold > 0 DAN panjang teks di bawah threshold: Kirim sebagai 1 bubble tunggal!
    if (singleThreshold > 0 && trimmed.length <= singleThreshold) {
      return [trimmed];
    }

    // 2. JIKA singleThreshold > 0: Gunakan pembagian bubble seimbang (target 2 bubble)
    if (singleThreshold > 0) {
      const paragraphs = trimmed
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean);

      if (paragraphs.length >= 2) {
        if (maxCount === 2) {
          let bestIndex = 0;
          let minDiff = Infinity;
          let totalLen = trimmed.length;
          let leftLen = 0;

          for (let i = 0; i < paragraphs.length - 1; i++) {
            leftLen += paragraphs[i].length + 2;
            const rightLen = totalLen - leftLen;
            const diff = Math.abs(leftLen - rightLen);
            if (diff < minDiff) {
              minDiff = diff;
              bestIndex = i;
            }
          }

          const firstBubble = paragraphs.slice(0, bestIndex + 1).join('\n\n');
          const secondBubble = paragraphs.slice(bestIndex + 1).join('\n\n');
          return [firstBubble, secondBubble];
        } else {
          const head = paragraphs.slice(0, maxCount - 1);
          const tail = paragraphs.slice(maxCount - 1).join('\n\n');
          return [...head, tail];
        }
      }

      // Jika hanya ada 1 paragraf tetapi panjang, bagi berdasarkan kalimat
      const sentences = trimmed.split(/(?<=[.!?])(?!\d)\s+/).map(s => s.trim()).filter(Boolean);
      if (sentences.length >= 2) {
        if (maxCount === 2) {
          let bestIndex = 0;
          let minDiff = Infinity;
          let totalLen = trimmed.length;
          let leftLen = 0;

          for (let i = 0; i < sentences.length - 1; i++) {
            leftLen += sentences[i].length + 1;
            const rightLen = totalLen - leftLen;
            const diff = Math.abs(leftLen - rightLen);
            if (diff < minDiff) {
              minDiff = diff;
              bestIndex = i;
            }
          }

          const firstBubble = sentences.slice(0, bestIndex + 1).join(' ');
          const secondBubble = sentences.slice(bestIndex + 1).join(' ');
          return [firstBubble, secondBubble];
        } else {
          const head = sentences.slice(0, maxCount - 1);
          const tail = sentences.slice(maxCount - 1).join(' ');
          return [...head, tail];
        }
      }

      return [trimmed];
    }

    // 3. BACKWARD COMPATIBLE FALLBACK (Jika singleThreshold === 0): Gunakan cara lama (maxChars greedy split)
    const rawCandidates: string[] = [];

    for (const para of paragraphs) {
      if (para.length <= maxChars) {
        rawCandidates.push(para);
      } else {
        const sentences = para.split(/(?<=[.!?])(?!\d)\s+/);
        let currentGroup = '';

        for (const sentence of sentences) {
          const trimmedSent = sentence.trim();
          if (!trimmedSent) continue;

          if ((currentGroup + ' ' + trimmedSent).trim().length <= maxChars) {
            currentGroup = currentGroup ? `${currentGroup} ${trimmedSent}` : trimmedSent;
          } else {
            if (currentGroup) rawCandidates.push(currentGroup.trim());
            currentGroup = trimmedSent;
          }
        }
        if (currentGroup.trim()) {
          rawCandidates.push(currentGroup.trim());
        }
      }
    }

    if (rawCandidates.length === 0) return [trimmed];

    if (rawCandidates.length > maxCount) {
      const head = rawCandidates.slice(0, maxCount - 1);
      const tail = rawCandidates.slice(maxCount - 1).join('\n\n');
      return [...head, tail];
    }

    return rawCandidates;
  }

  /**
   * Menghitung jeda antar-bubble (Inter-Bubble Delay).
   */
  public calculateInterBubbleDelay(): number {
    const minMs = parseInt(process.env.HUMANIZER_INTER_BUBBLE_DELAY_MIN_MS || '900', 10);
    const maxMs = parseInt(process.env.HUMANIZER_INTER_BUBBLE_DELAY_MAX_MS || '1800', 10);

    const range = maxMs - minMs;
    const baseMs = minMs + Math.random() * range;
    return this.applyJitter(baseMs);
  }

  /**
   * Mengirim pesan outbound ke customer dengan alur simulasi balasan manusia (humanizer):
   * 1. POST /api/sendSeen
   * 2. Reading Delay (Jeda membaca pesan masuk)
   * 3. Loop Bubble:
   *    - POST /api/startTyping
   *    - Typing Delay (Berdasarkan WPM kata)
   *    - POST /api/stopTyping
   *    - POST /api/sendText
   *    - Inter-Bubble Delay
   * 4. SAFETY NET (try/finally): Hanya panggil stopTyping di blok finally jika typing belum di-stop (mencegah redundant calls)!
   */
  public async simulateHumanReply(params: HumanReplyParams): Promise<HumanReplyResult> {
    const { chatId, incomingMessageId, incomingText, replyText, shouldAbort, tenantId, turnId, provider } = params;
    const effectiveTenantId = tenantId || 'default-tenant';

    // Transport per-tenant (WAHA/WABA): bila resolver tersedia, resolved transport
    // menggantikan client default untuk seluruh operasi send/typing pada turn ini.
    let resolvedTransport: MessageTransport | undefined;
    if (this.transportResolver) {
      try {
        resolvedTransport = await this.transportResolver(effectiveTenantId);
      } catch {
        resolvedTransport = undefined;
      }
    }
    const doSendSeen = async (chat: string, msgId: string) => {
      if (resolvedTransport) { await resolvedTransport.sendSeen(chat, msgId); }
      else { await this.client.sendSeen(chat, msgId); }
    };
    const doStartTyping = async (chat: string) => {
      if (resolvedTransport) { await resolvedTransport.startTyping(chat); }
      else { await this.client.startTyping(chat); }
    };
    const doStopTyping = async (chat: string) => {
      if (resolvedTransport) { await resolvedTransport.stopTyping(chat); }
      else { await this.client.stopTyping(chat); }
    };

    const { whatsappProviderService } = await import('./whatsapp-provider.service');
    const isCutOff = await whatsappProviderService.isOutboundCutOff(effectiveTenantId);
    if (isCutOff) {
      console.warn(`[TYPING CUT-OFF ACTIVE] Outbound human reply simulation to ${chatId} blocked by internal safety cut-off.`);
      return { success: false, bubblesSent: 0, error: 'WAHA_INTERNAL_CUTOFF: Outbound cut-off is active.' };
    }

    const isEnabled = (process.env.HUMANIZER_ENABLED ?? 'true') !== 'false' && this.speedFactor >= 0.01;

    let bubblesSent = 0;
    let lastMessageId: string | undefined = undefined;
    let typingStopped = true; // Status awal typing mati/stop
    // W-010: konfigurasi pemisah form per tenant (default kosong = struktural murni).
    const bubbleConfig = params.singleBubble
      ? undefined
      : await getHumanizerBubbleConfig(effectiveTenantId);
    const bubbles = params.singleBubble
      ? [replyText]
      : this.splitIntoBubbles(replyText, bubbleConfig);

    // Daftarkan semua bubble ke in-flight registry sebelum mulai pengiriman
    // agar echo webhook dari WAHA tidak memicu false positive human takeover
    try {
      const { messageService } = await import('./message.service');
      for (const bubbleContent of bubbles) {
        messageService.registerInFlightBotOutbound(chatId, bubbleContent, effectiveTenantId);
      }
    } catch (_) {}

    try {
      // Step 1: Send Seen & Reading Delay
      if (shouldAbort && (await shouldAbort())) {
        console.log(`[TYPING ABORT] Human takeover detected for ${chatId} before reading delay. Aborting reply.`);
        return { success: false, bubblesSent: 0, error: 'ABORTED_BY_HUMAN_HANDLING' };
      }

      if (isEnabled) {
        if (incomingMessageId) {
          await doSendSeen(chatId, incomingMessageId).catch(() => {});
        }

        if (incomingText) {
          const readingDelayMs = this.calculateReadingDelay(incomingText);
          const adjustedReading = Math.round(readingDelayMs / this.speedFactor);
          await this.sleep(adjustedReading);
        }

        if (shouldAbort && (await shouldAbort())) {
          console.log(`[TYPING ABORT] Human takeover detected for ${chatId} after reading delay. Aborting reply.`);
          return { success: false, bubblesSent: 0, error: 'ABORTED_BY_HUMAN_HANDLING' };
        }
      }

      // Step 2: Loop sending bubbles dengan indikator mengetik per bubble
      for (let i = 0; i < bubbles.length; i++) {
        const bubbleContent = bubbles[i];

        if (shouldAbort && (await shouldAbort())) {
          console.log(`[TYPING ABORT] Human takeover detected for ${chatId} before bubble ${i + 1}. Aborting reply.`);
          if (!typingStopped) {
            doStopTyping(chatId).catch(() => {});
            typingStopped = true;
          }
          return { success: false, bubblesSent, error: 'ABORTED_BY_HUMAN_HANDLING' };
        }

        if (isEnabled) {
          typingStopped = false; // Tandai status typing aktif sebelum startTyping
          await doStartTyping(chatId);

          const typingDelayMs = this.calculateTypingDelay(bubbleContent);
          const adjustedMs = Math.round(typingDelayMs / this.speedFactor);
          if (!isSimpleLogMode()) {
            console.log(`[TYPING DELAY] Bubble ${i + 1}: original=${typingDelayMs}ms, speedFactor=${this.speedFactor}, adjusted=${adjustedMs}ms`);
          } else {
            stageLog('TYPING', `Simulasi pengetikan bubble ${i + 1}/${bubbles.length} (${(adjustedMs / 1000).toFixed(1)}s)`, chatId.replace(/@.*$/, ''));
          }
          
          await measure(`TYPING_DELAY_BUBBLE_${i + 1}`, () => this.sleep(adjustedMs));

          // Stop typing secara non-blocking (fire-and-forget) agar tidak menunda pengiriman sendText
          doStopTyping(chatId).catch(() => {});
          typingStopped = true; // Status typing di-stop secara normal
        }

        // RE-CHECK GUARD SEBELUM SEND: Pastikan admin tidak takeover saat bot sedang typing!
        if (shouldAbort && (await shouldAbort())) {
          console.log(`[TYPING ABORT] Human takeover detected for ${chatId} right after typing delay of bubble ${i + 1}. Aborting sendText.`);
          if (!typingStopped) {
            doStopTyping(chatId).catch(() => {});
            typingStopped = true;
          }
          return { success: false, bubblesSent, error: 'ABORTED_BY_HUMAN_HANDLING' };
        }

        // Fondasional: pakai sendTextDetailed agar wa_message_id resmi tersimpan
        // untuk ACK delivered/read & reaksi emoji. Fallback ke sendText bila driver
        // belum mendukung detailed (kontrak IWahaClient opsional).
        // Jalur resolved transport (WABA) hanya menyediakan sendText tanpa messageId.
        // Stage 5 Fase 3: catat attempt SENDING sebelum kirim (best-effort).
        let outboundAttemptId: string | undefined;
        if (turnId) {
          try {
            const { outboundLedger } = await import('./outbound-ledger.service');
            outboundAttemptId = await outboundLedger.begin({
              tenantId: effectiveTenantId, turnId, bubbleIndex: i, content: bubbleContent, provider,
            });
          } catch {}
        }

        let sentSuccess = false;
        let sentMessageId: string | undefined = undefined;
        if (resolvedTransport) {
          const transportRes: any = await resolvedTransport.sendText(chatId, bubbleContent);
          sentSuccess = typeof transportRes === 'boolean' ? transportRes : !!transportRes?.success;
          sentMessageId = transportRes?.messageId;
        } else if (typeof (this.client as any).sendTextDetailed === 'function') {
          const detailed = await (this.client as any).sendTextDetailed(chatId, bubbleContent);
          sentSuccess = !!detailed?.success;
          sentMessageId = detailed?.messageId;
        } else {
          sentSuccess = await this.client.sendText(chatId, bubbleContent);
        }

        if (sentSuccess && sentMessageId) {
          try {
            const { messageService } = await import('./message.service');
            messageService.registerKnownBotMessageId(sentMessageId, effectiveTenantId);
          } catch {}
        }

        if (!sentSuccess) {
          // Stage 5: tandai FAILED (best-effort) lalu lempar seperti semula.
          if (outboundAttemptId) {
            try {
              const { outboundLedger } = await import('./outbound-ledger.service');
              await outboundLedger.markFailed(outboundAttemptId, `sendText failed bubble ${i + 1}`);
            } catch {}
          }
          throw new Error(`WAHA sendText failed on bubble ${i + 1} of ${bubbles.length}`);
        }
        if (sentMessageId) {
          lastMessageId = sentMessageId;
          // F5: catat wa_message_id pesan bot sebagai penentu utama (anti salah
          // kategorikan gema bot sebagai balasan admin).
          try {
            const { messageService } = await import('./message.service');
            messageService.registerKnownBotMessageId(sentMessageId, effectiveTenantId);
          } catch {}
        }
        // Stage 5: tandai SENT + provider message id.
        if (outboundAttemptId) {
          try {
            const { outboundLedger } = await import('./outbound-ledger.service');
            await outboundLedger.markSent(outboundAttemptId, sentMessageId);
          } catch {}
        }

        const previewText = bubbleContent.slice(0, 45).replace(/\n/g, ' ');
        stageLog('OUTBOUND', `Outbound terkirim (${i + 1}/${bubbles.length}): "${previewText}${bubbleContent.length > 45 ? '...' : ''}"`, chatId.replace(/@.*$/, ''));

        bubblesSent++;

        // Inter-bubble delay jika masih ada bubble berikutnya
        if (isEnabled && i < bubbles.length - 1) {
          const interBubbleDelayMs = this.calculateInterBubbleDelay();
          const adjustedInter = Math.round(interBubbleDelayMs / this.speedFactor);
          if (!isSimpleLogMode()) {
            console.log(`[INTER-BUBBLE DELAY] Between bubble ${i + 1} and ${i + 2}: original=${interBubbleDelayMs}ms, speedFactor=${this.speedFactor}, adjusted=${adjustedInter}ms`);
          }
          
          await measure(`INTER_BUBBLE_DELAY_${i + 1}_TO_${i + 2}`, () => this.sleep(adjustedInter));
        }
      }

      return { success: true, bubblesSent, messageId: lastMessageId };
    } catch (error: any) {
      const errMsg = error?.message || 'Unknown error during human reply simulation';
      return { success: false, bubblesSent, error: errMsg, messageId: lastMessageId };
    } finally {
      // Catatan: inFlightBotOutbounds dibiarkan kedaluwarsa secara otomatis sesuai TTL (default 45 detik)
      // di messageService. Ini mencegah race condition di mana webhook echo WAHA untuk bubble terakhir
      // tiba sesaat setelah fungsi ini return dan disalahartikan sebagai balasan baru dari admin HP.

      // SAFETY NET: HANYA panggil stopTyping di blok finally jika typing belum di-stop (menghindari redundant call)!
      if (isEnabled) {
        if (!typingStopped) {
          await doStopTyping(chatId).catch((err) => {
            console.warn(`[HUMANIZER FINALLY WARN] stopTyping fallback error:`, err?.message);
          });
          typingStopped = true;
        }
      }
    }
  }

  /**
   * Wrapper kompatibilitas lama
   */
  public async sendWithTypingSimulation(
    chatId: string,
    replyText: string,
    incomingMessageId?: string
  ): Promise<boolean> {
    const result = await this.simulateHumanReply({
      chatId,
      incomingMessageId: incomingMessageId || '',
      incomingText: '',
      replyText,
    });
    return result.success;
  }

  private sleep(ms: number): Promise<void> {
    const adjustedMs = Math.round(ms / this.speedFactor);
    return new Promise((resolve) => setTimeout(resolve, adjustedMs));
  }
}

export const typingService = new TypingService();
