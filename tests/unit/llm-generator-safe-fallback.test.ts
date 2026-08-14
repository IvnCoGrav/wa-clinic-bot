import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { LLMResponseGenerator } from '../../src/integrations/llm/generator';
import { LlmConcurrencyLimiter } from '../../src/utils/llm-concurrency';

vi.mock('axios');

/**
 * Verifikasi perbaikan generator atas temuan stres tes 50 pesan:
 * 1. Soft-fallback JSON TIDAK lagi me-leak raw text (sintaks kurung kurawal) ke customer
 *    — diekstrak via regex key "answer", jika gagal → fallback darurat netral.
 * 2. Fallback darurat (non-catalog) tidak meng-echo dokumen RAG/KB mentah.
 * 3. Concurrency limiter membatasi jumlah panggilan LLM serentak (anti 429).
 */
describe('LLMResponseGenerator — Safe Soft Fallback (anti raw JSON leak)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LLM_API_KEY = 'sk-test';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LLM_API_KEY;
  });

  it('1. JSON terpotong TANPA field "answer" → fallback darurat aman (bukan leak raw text)', async () => {
    // Simulasi max_tokens habis di tengah serialization (reasoning panjang menelan token).
    const truncated = `{
  "reasoning": "Customer bertanya tentang usia minimal bayi untuk dipijat. Berdasarkan referensi dokumen, jawabannya adalah minimal 2 minggu. Tidak ada kebutuhan klarifikasi karena informasi sudah jelas. Sesuai aturan, di akhir jawaban perlu menyebutkan treatment 'Paket...",
  "referenced_treatment": null,
  "needs_clar`;

    vi.mocked(axios.post).mockResolvedValue({
      data: {
        choices: [{ message: { content: truncated } }],
      },
    } as any);

    const generator = new LLMResponseGenerator();
    const result = await generator.generateFaqResponseWithDetails('usia brp ya?', [], 'conv-1', 'tenant-1');

    // Tidak ada jawaban aman yang bisa diproduksi → jawaban KOSONG (bukan apology).
    // Pemanggil (interest.ts) akan mengeskalasi senyap ke antrean human handling.
    expect(result.answer).toBe('');
    expect(result.usedFallback).toBe(true);
    // Tidak boleh bocor JSON/raw text ke customer.
    expect(result.answer).not.toContain('referenced_treatment');
    expect(result.answer).not.toContain('reasoning');
    expect(result.answer).not.toContain('"');
    expect(result.answer).not.toMatch(/^\s*\{/);
    // Tidak boleh ada skenario apology "mohon maaf antrean".
    expect(result.answer).not.toMatch(/mohon maaf|antrean|belum bisa/i);
  });

  it('2. JSON terpotong TAPI field "answer" lengkap → diekstrak via regex tanpa bocor sintaks', async () => {
    const truncated = `{
  "reasoning": "customer bertanya tentang usia minimal pijat bayi",
  "referenced_treatment": null,
  "needs_clarification": false,
  "answer": "Untuk pijat bayi, Bunda, minimal usia 2 minggu sudah bisa dipijat."`;

    vi.mocked(axios.post).mockResolvedValue({
      data: {
        choices: [{ message: { content: truncated } }],
      },
    } as any);

    const generator = new LLMResponseGenerator();
    const result = await generator.generateFaqResponseWithDetails('usia brp ya?', [], 'conv-2', 'tenant-1');

    expect(result.answer).toContain('minimal usia 2 minggu sudah bisa dipijat');
    // Tidak ada sisa sintaks JSON / kata kunci internal di balasan.
    expect(result.answer).not.toContain('"reasoning"');
    expect(result.answer).not.toContain('needs_clarification');
    expect(result.answer).not.toMatch(/^\s*\{/);
  });

  it('3. Fallback darurat non-catalog TIDAK meng-echo teks dokumen KB mentah', async () => {
    process.env.LLM_API_KEY = 'mock_key'; // paksa jalur fallback deterministik
    const generator = new LLMResponseGenerator();
    const answer = await generator.generateFaqResponse(
      'Sinar moksa itu apa',
      [{
        id: '1',
        tenantId: 'default',
        sourceType: 'faq' as any,
        title: 'Sinar Moksa',
        content: 'Jawaban: Sinar moksa adalah terapi inframerah hangat.',
        documentName: 'faq',
      }],
      'conv-3',
      'default'
    );

    // Echo RAG mentah dihapus → jawaban KOSONG (pemanggil eskalasi ke human),
    // bukan apology "mohon maaf antrean".
    expect(answer).not.toContain('Sinar moksa adalah terapi inframerah hangat.');
    expect(answer).toBe('');
    expect(answer).not.toMatch(/mohon maaf|antrean|belum bisa/i);
  });

  it('5. Response body kosong/anomali (tanpa choices / content) tidak throw — jatuh ke fallback darurat', async () => {
    // choices hilang
    vi.mocked(axios.post).mockResolvedValueOnce({ data: {} } as any);
    let gen = new LLMResponseGenerator();
    let res = await gen.generateFaqResponseWithDetails('usia brp ya?', [], 'conv-5', 'tenant-1');
    expect(res.answer).toBe('');
    expect(res.usedFallback).toBe(true);

    // choices ada tapi message.content kosong
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { choices: [{ message: { content: '' } }] },
    } as any);
    gen = new LLMResponseGenerator();
    res = await gen.generateFaqResponseWithDetails('usia brp ya?', [], 'conv-5', 'tenant-1');
    expect(res.answer).toBe('');
    expect(res.usedFallback).toBe(true);
  });

  it('4. Limiter max=2 → paling banyak 2 task berjalan serentak', async () => {
    const limiter = new LlmConcurrencyLimiter(2);
    let active = 0;
    let peak = 0;

    const task = () => limiter.run(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 15));
      active--;
    });

    await Promise.all(Array.from({ length: 6 }, task));
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(1);
    expect(limiter.activeCount).toBe(0);
  });
});