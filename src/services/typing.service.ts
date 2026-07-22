import { IWahaClient, wahaClient } from '../integrations/waha/client';
import dotenv from 'dotenv';
dotenv.config();

export interface HumanReplyParams {
  chatId: string;
  incomingMessageId: string;
  incomingText: string;   // untuk hitung reading delay
  replyText: string;      // teks balasan yang akan di-bubble-split
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

    const maxCount = parseInt(process.env.HUMANIZER_BUBBLE_MAX_COUNT || '4', 10);
    const maxChars = parseInt(process.env.HUMANIZER_BUBBLE_MAX_CHARS || '130', 10);

    // 1. Split berdasarkan paragraf (\n\n)
    const paragraphs = text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);

    const rawCandidates: string[] = [];

    for (const para of paragraphs) {
      if (para.length <= maxChars) {
        rawCandidates.push(para);
      } else {
        // Split paragraf panjang berdasarkan kalimat tanpa memotong di tengah kalimat
        const sentences = para.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [para];
        let currentGroup = '';

        for (const sentence of sentences) {
          const trimmed = sentence.trim();
          if (!trimmed) continue;

          if ((currentGroup + ' ' + trimmed).trim().length <= maxChars) {
            currentGroup = currentGroup ? `${currentGroup} ${trimmed}` : trimmed;
          } else {
            if (currentGroup) rawCandidates.push(currentGroup.trim());
            currentGroup = trimmed;
          }
        }
        if (currentGroup.trim()) {
          rawCandidates.push(currentGroup.trim());
        }
      }
    }

    if (rawCandidates.length === 0) return [text.trim()];

    // 2. Gabungkan jika jumlah bubble kandidat melebihi maxCount (maksimal 4 bubble)
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
    const { chatId, incomingMessageId, incomingText, replyText } = params;
    const isEnabled = (process.env.HUMANIZER_ENABLED ?? 'true') !== 'false';

    let bubblesSent = 0;
    let typingStopped = true; // Status awal typing mati/stop
    const bubbles = this.splitIntoBubbles(replyText);

    try {
      // Step 1: Send Seen & Reading Delay
      if (isEnabled) {
        await this.client.sendSeen(chatId, incomingMessageId);

        const readingDelayMs = this.calculateReadingDelay(incomingText);
        await this.sleep(readingDelayMs);
      }

      // Step 2: Loop sending bubbles dengan indikator mengetik per bubble
      for (let i = 0; i < bubbles.length; i++) {
        const bubbleContent = bubbles[i];

        if (isEnabled) {
          typingStopped = false; // Tandai status typing aktif sebelum startTyping
          await this.client.startTyping(chatId);

          const typingDelayMs = this.calculateTypingDelay(bubbleContent);
          await this.sleep(typingDelayMs);

          await this.client.stopTyping(chatId);
          typingStopped = true; // Status typing di-stop secara normal
        }

        const sentSuccess = await this.client.sendText(chatId, bubbleContent);

        if (!sentSuccess) {
          throw new Error(`WAHA sendText failed on bubble ${i + 1} of ${bubbles.length}`);
        }

        bubblesSent++;

        // Inter-bubble delay jika masih ada bubble berikutnya
        if (isEnabled && i < bubbles.length - 1) {
          const interBubbleDelayMs = this.calculateInterBubbleDelay();
          await this.sleep(interBubbleDelayMs);
        }
      }

      return { success: true, bubblesSent };
    } catch (error: any) {
      const errMsg = error?.message || 'Unknown error during human reply simulation';
      return { success: false, bubblesSent, error: errMsg };
    } finally {
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
