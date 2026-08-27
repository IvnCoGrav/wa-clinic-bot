import { IWahaClient, wahaClient } from '../integrations/waha/client';
import { measure } from '../utils/timer';
import { stageLog, isSimpleLogMode } from '../utils/stage-logger';
import dotenv from 'dotenv';
dotenv.config();

export interface HumanReplyParams {
  chatId: string;
  incomingMessageId?: string;
  incomingText?: string;   // untuk hitung reading delay
  replyText: string;      // teks balasan yang akan di-bubble-split
  tenantId?: string;
  shouldAbort?: () => Promise<boolean> | boolean; // guard pembatalan real-time jika CS takeover
}

export interface HumanReplyResult {
  success: boolean;
  bubblesSent: number;
  error?: string;
}

export class TypingService {
  private client: IWahaClient;
  private speedFactor: number = 1;

  constructor(client?: IWahaClient, speedFactor: number = 1) {
    this.client = client || wahaClient;
    this.speedFactor = speedFactor;
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
   * Melakukan split berdasarkan paragraf dan/atau kalimat tanpa memotong di tengah kalimat (maxChars = 130).
   */
  public splitIntoBubbles(text: string): string[] {
    const isEnabled = (process.env.HUMANIZER_BUBBLE_SPLIT_ENABLED ?? 'true') !== 'false';
    if (!isEnabled || !text || !text.trim()) {
      return [text ? text.trim() : ''];
    }

    const trimmed = text.trim();
    const singleThreshold = parseInt(process.env.HUMANIZER_BUBBLE_SINGLE_THRESHOLD_CHARS || '350', 10);
    const maxCount = parseInt(process.env.HUMANIZER_BUBBLE_MAX_COUNT || '2', 10);
    const maxChars = parseInt(process.env.HUMANIZER_BUBBLE_MAX_CHARS || '250', 10);

    // 0. KHUSUS FORM RESERVASI: Pemisahan Semantik Presisi (3 Bubble)
    // Bubble 1: Kalimat pengantar / konsultasi / empati ("Tentu bisa Bunda...")
    // Bubble 2: Format list reservasi (dari "Berikut list untuk reservasi..." sampai akhir field treatment)
    // Bubble 3: Panduan pengisian & SOP pembatalan ("Mohon bisa diisi Bunda...")
    const concludingKeywords = [
      'mohon bisa diisi',
      'mohon diisi',
      'mohon untuk mengisi',
      'harap diisi',
      'silakan diisi',
      'silahkan diisi',
      'mohon diisi ya',
      'mohon bisa diisi ya',
    ];

    const isReservationForm =
      /(berikut\s+(list|format)\s+(untuk\s+)?reservasi|format\s+reservasi|list\s+reservasi|format\s+pendaftaran\s+reservasi)/i.test(trimmed) ||
      (trimmed.toLowerCase().includes('hari dan tanggal') && trimmed.toLowerCase().includes('alamat & shareloc'));

    if (isReservationForm) {
      // Normalisasi pemisah sebelum header reservasi dan sebelum footer penutup jika hanya dipisah single \n
      let normalized = trimmed
        .replace(/([^\n])\r?\n(berikut\s+(list|format)\s+(untuk\s+)?reservasi|format\s+reservasi|list\s+reservasi)/gi, '$1\n\n$2')
        .replace(/([^\n])\r?\n(mohon\s+(bisa\s+)?diisi|silakan\s+diisi|silahkan\s+diisi|harap\s+diisi)/gi, '$1\n\n$2');

      const paragraphs = normalized
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean);

      const formHeaderIndex = paragraphs.findIndex((p) =>
        /^(berikut\s+(list|format)\s+(untuk\s+)?reservasi|format\s+reservasi|list\s+reservasi|format\s+pendaftaran\s+reservasi)/i.test(p) ||
        (p.toLowerCase().includes('hari dan tanggal') && p.toLowerCase().includes('alamat & shareloc'))
      );

      const formFooterIndex = paragraphs.findIndex((p, idx) =>
        idx >= (formHeaderIndex >= 0 ? formHeaderIndex : 0) &&
        concludingKeywords.some((keyword) => p.toLowerCase().startsWith(keyword))
      );

      if (formHeaderIndex > 0 && formFooterIndex > formHeaderIndex) {
        // Ada Intro + Form + Footer -> Pisahkan menjadi 3 BUBBLE
        const firstBubble = paragraphs.slice(0, formHeaderIndex).join('\n\n');
        const secondBubble = paragraphs.slice(formHeaderIndex, formFooterIndex).join('\n\n');
        const thirdBubble = paragraphs.slice(formFooterIndex).join('\n\n');
        return [firstBubble, secondBubble, thirdBubble];
      } else if (formHeaderIndex === 0 && formFooterIndex > 0) {
        // Hanya Form + Footer (Tanpa Intro) -> 2 BUBBLE
        const firstBubble = paragraphs.slice(0, formFooterIndex).join('\n\n');
        const secondBubble = paragraphs.slice(formFooterIndex).join('\n\n');
        return [firstBubble, secondBubble];
      } else if (formHeaderIndex > 0 && formFooterIndex === -1) {
        // Hanya Intro + Form (Tanpa Footer) -> 2 BUBBLE
        const firstBubble = paragraphs.slice(0, formHeaderIndex).join('\n\n');
        const secondBubble = paragraphs.slice(formHeaderIndex).join('\n\n');
        return [firstBubble, secondBubble];
      }
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
        let targetSplitIndex = -1;
        for (let i = 0; i < paragraphs.length; i++) {
          const lowerP = paragraphs[i].toLowerCase();
          const match = concludingKeywords.some((keyword) => lowerP.startsWith(keyword));
          if (match) {
            targetSplitIndex = i;
            break;
          }
        }

        if (targetSplitIndex > 0) {
          const firstBubble = paragraphs.slice(0, targetSplitIndex).join('\n\n');
          const secondBubble = paragraphs.slice(targetSplitIndex).join('\n\n');
          return [firstBubble, secondBubble];
        }

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
    const paragraphs = trimmed
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);

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
    const { chatId, incomingMessageId, incomingText, replyText, shouldAbort, tenantId } = params;
    const isEnabled = (process.env.HUMANIZER_ENABLED ?? 'true') !== 'false' && this.speedFactor >= 0.01;

    let bubblesSent = 0;
    let typingStopped = true; // Status awal typing mati/stop
    const bubbles = this.splitIntoBubbles(replyText);

    // Daftarkan semua bubble ke in-flight registry sebelum mulai pengiriman
    // agar echo webhook dari WAHA tidak memicu false positive human takeover
    try {
      const { messageService } = await import('./message.service');
      const effectiveTenantId = tenantId || 'default-tenant';
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
          await this.client.sendSeen(chatId, incomingMessageId).catch(() => {});
        }

        if (incomingText) {
          const readingDelayMs = this.calculateReadingDelay(incomingText);
          await this.sleep(readingDelayMs);
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
            this.client.stopTyping(chatId).catch(() => {});
            typingStopped = true;
          }
          return { success: false, bubblesSent, error: 'ABORTED_BY_HUMAN_HANDLING' };
        }

        if (isEnabled) {
          typingStopped = false; // Tandai status typing aktif sebelum startTyping
          await this.client.startTyping(chatId);

          const typingDelayMs = this.calculateTypingDelay(bubbleContent);
          const adjustedMs = Math.round(typingDelayMs / this.speedFactor);
          if (!isSimpleLogMode()) {
            console.log(`[TYPING DELAY] Bubble ${i + 1}: original=${typingDelayMs}ms, speedFactor=${this.speedFactor}, adjusted=${adjustedMs}ms`);
          } else {
            stageLog('TYPING', `Simulasi pengetikan bubble ${i + 1}/${bubbles.length} (${(adjustedMs / 1000).toFixed(1)}s)`, chatId.replace(/@.*$/, ''));
          }
          
          await measure(`TYPING_DELAY_BUBBLE_${i + 1}`, () => this.sleep(typingDelayMs));

          // Stop typing secara non-blocking (fire-and-forget) agar tidak menunda pengiriman sendText
          this.client.stopTyping(chatId).catch(() => {});
          typingStopped = true; // Status typing di-stop secara normal
        }

        // RE-CHECK GUARD SEBELUM SEND: Pastikan admin tidak takeover saat bot sedang typing!
        if (shouldAbort && (await shouldAbort())) {
          console.log(`[TYPING ABORT] Human takeover detected for ${chatId} right after typing delay of bubble ${i + 1}. Aborting sendText.`);
          if (!typingStopped) {
            this.client.stopTyping(chatId).catch(() => {});
            typingStopped = true;
          }
          return { success: false, bubblesSent, error: 'ABORTED_BY_HUMAN_HANDLING' };
        }

        const sentSuccess = await this.client.sendText(chatId, bubbleContent);

        if (!sentSuccess) {
          throw new Error(`WAHA sendText failed on bubble ${i + 1} of ${bubbles.length}`);
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
          
          await measure(`INTER_BUBBLE_DELAY_${i + 1}_TO_${i + 2}`, () => this.sleep(interBubbleDelayMs));
        }
      }

      return { success: true, bubblesSent };
    } catch (error: any) {
      const errMsg = error?.message || 'Unknown error during human reply simulation';
      return { success: false, bubblesSent, error: errMsg };
    } finally {
      // Catatan: inFlightBotOutbounds dibiarkan kedaluwarsa secara otomatis sesuai TTL (default 45 detik)
      // di messageService. Ini mencegah race condition di mana webhook echo WAHA untuk bubble terakhir
      // tiba sesaat setelah fungsi ini return dan disalahartikan sebagai balasan baru dari admin HP.

      // SAFETY NET: HANYA panggil stopTyping di blok finally jika typing belum di-stop (menghindari redundant call)!
      if (isEnabled) {
        if (!typingStopped) {
          await this.client.stopTyping(chatId).catch((err) => {
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
