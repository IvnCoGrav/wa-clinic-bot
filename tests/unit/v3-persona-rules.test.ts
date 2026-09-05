import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { V3AgentRunner } from '../../src/v3/agent/agent-runner';
import { OutputSanitizer } from '../../src/v3/guardrails/sanitizer';

vi.mock('axios');

/**
 * Aturan Emas Klinik — 10 pengujian mikro deterministik (offline, tanpa LLM live).
 * Pola: mock respons assistant (mensimulasikan keluaran model) lalu verifikasi
 * perilaku pipeline agent-runner + guardrail sanitizer terhadap tiap aturan.
 * Untuk aturan yang hidup di prompt (bukan sanitizer), mock memakai balasan
 * patuh dan tes memverifikasi pipeline meloloskannya utuh tanpa merusak.
 */
describe('V3 Persona Rules — Aturan Emas Klinik', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockAssistant = (content: string) => {
    (axios.post as any).mockResolvedValueOnce({
      data: { choices: [{ message: { role: 'assistant', content } }] },
    });
  };

  const run = (incomingText: string, conversationId: string) =>
    V3AgentRunner.processMessage({
      customerId: 'mock-cust-rules',
      conversationId,
      phone: '6281234567890',
      chatId: '6281234567890@c.us',
      incomingText,
    });

  const countBunda = (s: string) => (s.match(/bunda/gi) || []).length;
  // Hitung kalimat: buang emoji dulu agar fragmen "✨" tidak terhitung kalimat sendiri
  const countSentences = (s: string) =>
    s
      .replace(/[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+/gu, '')
      .split(/(?<=[.!?…])\s+/)
      .map((t) => t.trim())
      .filter(Boolean).length;

  it('Test 1: Sapaan Pembuka (Turn-0) — hangat, kata ganti kami, ≤500 karakter', async () => {
    mockAssistant(
      'Halo Bunda! ✨\n\nPerkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa.\n\nAda yang bisa saya bantu untuk layanan Homecare Bunda atau si kecil hari ini? 😊'
    );
    const result = await run('halo kak', 'mock-rules-1');
    expect(result.replyText).toContain('Halo Bunda');
    expect(result.replyText).toContain('Homecare');
    expect(result.replyText).toContain('kami bantu');
    expect(result.replyText).not.toContain('saya bantu');
    expect(result.replyText.length).toBeLessThanOrEqual(500);
  });

  it('Test 2: Pertanyaan Lokasi (Turn-1) — Waru 30km, tanpa English leak, Bunda ≤2, ≤3 kalimat', async () => {
    mockAssistant(
      'Halo Bunda! ✨\n\nHomebase kami berada di Waru, Sidoarjo 😊 Layanan resmi kami adalah Homecare, di mana Bidan kami berkunjung langsung ke rumah untuk seluruh wilayah Surabaya dan Sidoarjo (maksimal 30 km dari Waru).\n\nKalau boleh tahu rumahnya di daerah mana ya, biar kami bantu cekkan jangkauan jaraknya? 🤗'
    );
    const result = await run('Kak ini area mana?', 'mock-rules-2');
    expect(result.replyText).toContain('Waru, Sidoarjo');
    expect(result.replyText).toContain('30 km');
    expect(result.replyText).not.toContain('treatment');
    expect(countBunda(result.replyText)).toBeLessThanOrEqual(2);
    expect(countSentences(result.replyText)).toBeLessThanOrEqual(3);
  });

  it('Test 3: Keluhan Bapil TANPA tanya harga — sanitizer menyapu Rp/menit', async () => {
    mockAssistant(
      'Untuk keluhan batuk pilek, paket yang paling tepat adalah *Pijat Bayi Pulih Ceria* (Terapi Bapil & Kembung) ya Bunda 😊 Durasinya 40 menit dengan promo *Rp 70.000* saja (harga normal *Rp 90.000*). Perawatan ini ditangani langsung oleh Bidan kami untuk membantu melegakan saluran pernapasan si kecil. Apakah si kecil saat ini sedang batuk pilek Bunda? 🤗'
    );
    const result = await run('Kalau terapi batuk pilek apa uya?', 'mock-rules-3');
    expect(result.replyText).toContain('*Pijat Bayi Pulih Ceria*');
    expect(result.replyText).not.toMatch(/Rp\s*\d+/);
    expect(result.replyText).not.toContain('40 menit');
    expect(result.replyText).not.toContain('menit');
    expect(result.replyText).not.toMatch(/(^|\n)\s*\d+\./);
    expect(result.replyText).not.toMatch(/usianya berapa bulan/i);
    expect(countSentences(result.replyText)).toBeLessThanOrEqual(3);
    expect(result.replyText.length).toBeLessThanOrEqual(500);
  });

  it('Test 4: Keluhan Bapil DENGAN tanya harga — harga & rincian dipertahankan', async () => {
    mockAssistant(
      'Untuk batuk pilek, paket yang paling tepat adalah *Pijat Bayi Pulih Ceria* ya Bunda 😊 Durasinya 40 menit dengan promo *Rp 70.000* saja (harga normal *Rp 90.000*). Rinciannya: pijat stimulasi seluruh badan oleh Bidan ber-STR aktif, terapi akupresur titik pernapasan, serta balsem herbal & double aromaterapi khusus bayi. Rencana mau kami bantu jadwalkan di hari apa ya Bunda? 🤗'
    );
    const result = await run(
      'Kalau terapi batuk pilek harganya berapa kak? Dapat apa aja?',
      'mock-rules-4'
    );
    expect(result.replyText).toContain('*Rp 70.000*');
    expect(result.replyText).toContain('40 menit');
    expect(result.replyText).not.toContain('(full body massage)');
    expect(result.replyText).toContain('akupresur');
    expect(result.replyText).toContain('aromaterapi');
  });

  it('Test 5: Pertanyaan Jadwal — anti-afirmasi, tawarkan cek jadwal', async () => {
    mockAssistant(
      'Untuk hari Sabtu, biar akurat kami bantu cekkan ketersediaan jadwal ke tim Bidan kami dulu ya Bunda 😊 Rencana mau reservasi untuk tanggal berapa ya?'
    );
    const result = await run('Hari sabtu bu bidan bisa?', 'mock-rules-5');
    expect(result.replyText).not.toContain('Tentu bisa');
    expect(result.replyText).not.toContain('Bisa Bunda');
    expect(result.replyText).not.toContain('Pasti bisa');
    expect(result.replyText).toContain('kami bantu cekkan ketersediaan jadwal');
  });

  it('Test 6: Bayi Newborn — aman & dianjurkan, tanpa suruh tunggu 1 bulan', async () => {
    mockAssistant(
      'Sangat boleh Bunda 😊 Bayi usia 2 minggu justru sangat dianjurkan dipijat oleh Bidan kami untuk membantu stimulasi tumbuh kembangnya. Pijatannya lembut dan aman untuk newborn. Rencana mau kami bantu jadwalkan di hari apa ya Bunda? 🤗'
    );
    const result = await run('Bayi 2 minggu boleh dipijat kak?', 'mock-rules-6');
    expect(result.replyText).toContain('dianjurkan');
    expect(result.replyText).not.toMatch(/tunggu.*1 bulan/i);
    expect(result.replyText).not.toMatch(/tunggu.*sebulan/i);
  });

  it('Test 7: Layanan di luar katalog — tolak sopan / eskalasi, tanpa mengarang', async () => {
    mockAssistant(
      'Mohon maaf Bunda 🙏 untuk layanan mandikan bayi harian saat ini belum tersedia di kami. Yang tersedia adalah layanan Homecare pijat bayi dan mom spa oleh Bidan kami. Biar dibantu lebih lanjut, kami teruskan ke CS manusia ya Bunda 😊'
    );
    const result = await run('Bisa mandikan bayi harian kak?', 'mock-rules-7');
    expect(result.replyText).toMatch(/CS|admin/i);
    expect(result.replyText).not.toMatch(/tersedia setiap hari|bisa setiap hari/i);
  });

  it('Test 8: Sanitizer stripping harga/durasi (unit guardrail)', () => {
    const leaky =
      'Paket *Pijat Bayi Pulih Ceria* ya Bunda 😊 Durasinya 40 menit dengan promo *Rp 70.000* saja (harga normal *Rp 90.000*). Perawatan ditangani Bidan kami.';
    const cleaned = OutputSanitizer.sanitizeUnsolicitedPriceAndDuration(
      leaky,
      'Kalau terapi batuk pilek apa ya?'
    );
    expect(cleaned).not.toMatch(/Rp\s*\d+/);
    expect(cleaned).not.toContain('menit');
    expect(cleaned).toContain('Pijat Bayi Pulih Ceria');

    const kept = OutputSanitizer.sanitizeUnsolicitedPriceAndDuration(
      leaky,
      'Harganya berapa kak?'
    );
    expect(kept).toContain('Rp 70.000');
  });

  it('Test 9: Sanitizer truncate 500 karakter (unit guardrail)', () => {
    const long =
      'Ini adalah kalimat contoh yang cukup panjang untuk pengujian. '.repeat(11);
    expect(long.length).toBeGreaterThan(650);
    const out = OutputSanitizer.truncateToMaxChars(long, 500);
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out).toMatch(/[.!?]$/);
  });

  it('Test 10: Sanitizer anti-English leak (unit guardrail)', () => {
    const dirty =
      'Layanan Homecare treatment (full body massage) dengan schedule dan appointment untuk mommy dan little one.';
    const out = OutputSanitizer.stripEnglishLeakage(dirty);
    expect(out).not.toContain('treatment');
    expect(out).not.toContain('schedule');
    expect(out).not.toContain('mommy');
    expect(out).not.toContain('little one');
    expect(out).not.toContain('(full body massage)');
    expect(out).toContain('si kecil');
    expect(out).toContain('Bunda');
    expect(out).toContain('jadwal');
  });
});
