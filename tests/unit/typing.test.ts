import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { typingService } from '../../src/services/typing.service';
import { wahaClient } from '../../src/integrations/waha/client';

describe('Typing Simulation & Humanizer Service Unit Tests (Final Revision)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    typingService.setSpeedFactor(100); // 100x speed factor untuk unit testing agar tidak timeout
  });

  afterEach(() => {
    vi.restoreAllMocks();
    typingService.setSpeedFactor(1); // Restore speed factor
  });

  describe('1. WPM Proportionality & Cap Ratio Verification', () => {
    it('should assert that HUMANIZER_TYPING_AVERAGE_WPM is <= 55 to prevent unrealistic bot typing speeds', () => {
      const wpm = parseInt(process.env.HUMANIZER_TYPING_AVERAGE_WPM || '48', 10);
      expect(wpm).toBeLessThanOrEqual(55);
      expect(wpm).toBe(48);
    });

    it('should land a 4-word bubble raw typing delay at ~81.5% of HUMANIZER_MAX_TYPING_DELAY_MS (6500ms)', () => {
      // 4 kata: (4 / 48) * 60000 + 300 = 5300ms
      const text4Words = 'satu dua tiga empat';
      
      const rawDelay = typingService.calculateTypingDelay(text4Words, true); // skipJitter = true
      const maxCap = 6500;
      const ratio = rawDelay / maxCap;

      expect(rawDelay).toBe(5300);
      expect(ratio).toBeGreaterThanOrEqual(0.75);
      expect(ratio).toBeLessThanOrEqual(0.90);
    });

    it('should show proportional difference between 2-word vs 4-word bubble (neither maxed out at cap)', () => {
      const text2Words = 'satu dua';
      const text4Words = 'satu dua tiga empat';

      const delay2Words = typingService.calculateTypingDelay(text2Words, true);
      const delay4Words = typingService.calculateTypingDelay(text4Words, true);

      // 2 kata -> 2800ms, 4 kata -> 5300ms
      expect(delay2Words).toBe(2800);
      expect(delay4Words).toBe(5300);
      expect(delay4Words - delay2Words).toBe(2500); // Beda proporsional 2.5s
      expect(delay2Words).toBeLessThan(6500);
      expect(delay4Words).toBeLessThan(6500);
    });
  });

  describe('2. Reading & Typing Delay Jitter Verification', () => {
    it('should generate different reading delay values on consecutive calls due to jitter', () => {
      const text = 'Halo Bidan, saya mau tanya lokasi moms & baby spa';
      const delays = new Set<number>();

      for (let i = 0; i < 10; i++) {
        delays.add(typingService.calculateReadingDelay(text));
      }

      expect(delays.size).toBeGreaterThan(1);
    });

    it('should generate different typing delay values on consecutive calls due to jitter', () => {
      const text = 'Moms & baby spa kami melayani homecare di Surabaya dengan berbagai layanan.';
      const delays = new Set<number>();

      for (let i = 0; i < 10; i++) {
        delays.add(typingService.calculateTypingDelay(text));
      }

      expect(delays.size).toBeGreaterThan(1);
    });
  });

  describe('3. Bubble Splitting Logic with MaxChars=130 & MaxCount=4', () => {
    it('should split long FAQ response (~350-400 chars) into 3-4 bubbles without losing content', () => {
      const faqReply = `Terima kasih Bunda! Untuk treatment pijat bayi, perawatan ini membutuhkan waktu sekitar 60 hingga 90 menit.

Perawatan ini meliputi pembersihan komedo mendalam, pengerjaan serum glowing dengan alat ultrasound, masker shooting, serta pijat relaksasi wajah.

Apakah Bunda berminat untuk mengisi form reservasi sekarang?`;

      const bubbles = typingService.splitIntoBubbles(faqReply);

      // Verifikasi split menghasilkan 3-4 bubble
      expect(bubbles.length).toBeGreaterThanOrEqual(3);
      expect(bubbles.length).toBeLessThanOrEqual(4);

      // Verifikasi seluruh teks asli tetap ada di dalam gabungan bubble
      const joinedBubbles = bubbles.join(' ');
      expect(joinedBubbles).toContain('pijat bayi');
      expect(joinedBubbles).toContain('ultrasound');
      expect(joinedBubbles).toContain('form reservasi');
    });
  });

  describe('4. Redundant stopTyping Elimination & Error Safety Net', () => {
    it('should call stopTyping ONLY ONCE per bubble in success path (no redundant call in finally)', async () => {
      vi.spyOn(wahaClient, 'sendSeen').mockResolvedValue(true);
      vi.spyOn(wahaClient, 'startTyping').mockResolvedValue(true);
      const stopTypingSpy = vi.spyOn(wahaClient, 'stopTyping').mockResolvedValue(true);
      vi.spyOn(wahaClient, 'sendText').mockResolvedValue(true);

      const result = await typingService.simulateHumanReply({
        chatId: '628123456789@c.us',
        incomingMessageId: 'msg_success_1',
        incomingText: 'Halo',
        replyText: 'Halo Bunda! Selamat datang.', // 1 bubble
      });

      expect(result.success).toBe(true);
      expect(result.bubblesSent).toBe(1);

      // stopTyping HANYA dipanggil 1 kali secara normal
      expect(stopTypingSpy).toHaveBeenCalledTimes(1);
    });

    it('should execute stopTyping via finally if an error occurs while typing is active', async () => {
      vi.spyOn(wahaClient, 'sendSeen').mockResolvedValue(true);
      
      vi.spyOn(wahaClient, 'startTyping').mockImplementation(async () => {
        throw new Error('Connection reset on startTyping');
      });
      const stopTypingSpy = vi.spyOn(wahaClient, 'stopTyping').mockResolvedValue(true);

      const result = await typingService.simulateHumanReply({
        chatId: '628123456789@c.us',
        incomingMessageId: 'msg_error_active',
        incomingText: 'Halo',
        replyText: 'Halo Bunda',
      });

      expect(result.success).toBe(false);
      expect(result.bubblesSent).toBe(0);

      // Safety net di finally harus memanggil stopTyping
      expect(stopTypingSpy).toHaveBeenCalled();
    });

    it('should NOT resend bubble 1 or attempt bubble 3 when bubble 2 sendText fails', async () => {
      vi.spyOn(wahaClient, 'sendSeen').mockResolvedValue(true);
      vi.spyOn(wahaClient, 'startTyping').mockResolvedValue(true);
      const stopTypingSpy = vi.spyOn(wahaClient, 'stopTyping').mockResolvedValue(true);

      let sendTextCalls = 0;
      const sendTextSpy = vi.spyOn(wahaClient, 'sendText').mockImplementation(async () => {
        sendTextCalls++;
        if (sendTextCalls === 2) return false; // Fail on bubble 2
        return true;
      });

      const replyText = `Bubble 1: Halo Bunda, selamat datang di Kala Moms and Baby Spa.

Bubble 2: Kami punya promo diskon untuk treatment pijat bayi minggu ini.

Bubble 3: Apakah Bunda tertarik untuk booking jadwal treatment?`;

      const result = await typingService.simulateHumanReply({
        chatId: '628123456789@c.us',
        incomingMessageId: 'msg_multi_fail',
        incomingText: 'Promo',
        replyText,
      });

      expect(result.success).toBe(false);
      expect(result.bubblesSent).toBe(1);
      expect(sendTextSpy).toHaveBeenCalledTimes(2);
      expect(stopTypingSpy).toHaveBeenCalledTimes(2);
    });
  });
});
