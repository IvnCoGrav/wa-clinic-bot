import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { typingService } from '../../src/services/typing.service';
import { wahaClient } from '../../src/integrations/waha/client';

describe('Typing Simulation & Humanizer Service Unit Tests (Final Revision)', () => {
  let oldSingleThreshold: string | undefined;
  let oldMaxCount: string | undefined;
  let oldMaxChars: string | undefined;

  beforeEach(() => {
    vi.restoreAllMocks();
    typingService.setSpeedFactor(100); // 100x speed factor untuk unit testing agar tidak timeout

    oldSingleThreshold = process.env.HUMANIZER_BUBBLE_SINGLE_THRESHOLD_CHARS;
    oldMaxCount = process.env.HUMANIZER_BUBBLE_MAX_COUNT;
    oldMaxChars = process.env.HUMANIZER_BUBBLE_MAX_CHARS;

    process.env.HUMANIZER_BUBBLE_SINGLE_THRESHOLD_CHARS = '0'; // force split
    process.env.HUMANIZER_BUBBLE_MAX_COUNT = '4';
    process.env.HUMANIZER_BUBBLE_MAX_CHARS = '130';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    typingService.setSpeedFactor(1); // Restore speed factor

    if (oldSingleThreshold !== undefined) process.env.HUMANIZER_BUBBLE_SINGLE_THRESHOLD_CHARS = oldSingleThreshold;
    else delete process.env.HUMANIZER_BUBBLE_SINGLE_THRESHOLD_CHARS;

    if (oldMaxCount !== undefined) process.env.HUMANIZER_BUBBLE_MAX_COUNT = oldMaxCount;
    else delete process.env.HUMANIZER_BUBBLE_MAX_COUNT;

    if (oldMaxChars !== undefined) process.env.HUMANIZER_BUBBLE_MAX_CHARS = oldMaxChars;
    else delete process.env.HUMANIZER_BUBBLE_MAX_CHARS;
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

    it('should split reservation form semantically right before the concluding keyword', () => {
      const reservationForm = `Berikut list untuk reservasi :

Hari dan tanggal :
Nama Bunda:
Alamat & Shareloc :
Kec :
Kota :
No. Hp :

Pilihan treatment (Baby & Kids)

Nama Bayi :
Usia Bayi/Anak :
Treatment :

Pilihan treatment (Moms) :
Usia Kehamilan (Jika hamil):
Treatment :

Mohon bisa diisi Bunda 😊
Cancel / Pembatalan Harap minimal H-3 jam

H-1 sebelum treatment akan kami reminder kembali bunda 🥰
Terimakasih.  ☺️`;

      // Set environment mock to target 2 bubbles
      const oldSingle = process.env.HUMANIZER_BUBBLE_SINGLE_THRESHOLD_CHARS;
      process.env.HUMANIZER_BUBBLE_SINGLE_THRESHOLD_CHARS = '350';

      try {
        const bubbles = typingService.splitIntoBubbles(reservationForm);

        expect(bubbles.length).toBe(2);
        expect(bubbles[0]).toContain('Pilihan treatment (Moms) :');
        expect(bubbles[0]).not.toContain('Mohon bisa diisi');
        expect(bubbles[1]).toContain('Mohon bisa diisi');
        expect(bubbles[1]).toContain('Terimakasih.');
      } finally {
        if (oldSingle) process.env.HUMANIZER_BUBBLE_SINGLE_THRESHOLD_CHARS = oldSingle;
        else delete process.env.HUMANIZER_BUBBLE_SINGLE_THRESHOLD_CHARS;
      }
    });

    it('should split full consultation reply with reservation form into exactly 3 bubbles (Intro, Form, Footer)', () => {
      const fullReply = `Tentu bisa, Bunda. Untuk keluhan batuk dan pilek, kami sarankan layanan *Pijat Bayi Pulih Ceria* yang dirancang khusus untuk membantu meredakan gejala tersebut. Untuk ketersediaan jadwal besok, akan kami bantu cekkan ketersediaan jadwal Bidan yang ready ya Bunda 😊.

Berikut list untuk reservasi :

Hari dan tanggal : besok  
Nama Bunda:  
Alamat & Shareloc : Platuk tauladan 19a, Sidotopo Wetan  
Kec : Kenjeran  
Kota : Surabaya  
No. Hp : 6289999310138  

Pilihan treatment (bayi & Kids)  

Nama Bayi :  
Usia Bayi/Anak :  
Treatment : Pijat Bayi Pulih Ceria  

Pilihan treatment (Moms) :  

Usia Kehamilan (Jika hamil):  
Treatment :  

Mohon bisa diisi Bunda 😊  
Cancel / Pembatalan Harap minimal H-3 jam  

H-1 sebelum treatment akan kami reminder kembali Bunda 🥰  
Terimakasih. ☺️`;

      const bubbles = typingService.splitIntoBubbles(fullReply);

      expect(bubbles.length).toBe(3);
      // Bubble 1: Intro / konsultasi
      expect(bubbles[0]).toContain('Tentu bisa, Bunda.');
      expect(bubbles[0]).toContain('Pijat Bayi Pulih Ceria');
      expect(bubbles[0]).not.toContain('Berikut list untuk reservasi');

      // Bubble 2: Format form reservasi (clean copyable form)
      expect(bubbles[1]).toContain('Berikut list untuk reservasi :');
      expect(bubbles[1]).toContain('Hari dan tanggal : besok');
      expect(bubbles[1]).toContain('Treatment : Pijat Bayi Pulih Ceria');
      expect(bubbles[1]).not.toContain('Tentu bisa, Bunda.');
      expect(bubbles[1]).not.toContain('Mohon bisa diisi Bunda');

      // Bubble 3: Footer SOP
      expect(bubbles[2]).toContain('Mohon bisa diisi Bunda 😊');
      expect(bubbles[2]).toContain('Cancel / Pembatalan Harap minimal H-3 jam');
      expect(bubbles[2]).toContain('Terimakasih.');
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
