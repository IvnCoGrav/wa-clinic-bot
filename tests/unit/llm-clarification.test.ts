import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { LLMResponseGenerator } from '../../src/integrations/llm/generator';

vi.mock('axios');

describe('LLMResponseGenerator - Aturan Klarifikasi vs Defleksi', () => {
  const generator = new LLMResponseGenerator();
  const mockTenant = 'tenant-test';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LLM_API_KEY = 'sk-test';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Kasus Ambigu Genuine: Bertanya klarifikasi jika nama fuzzy-match ke 2 treatment berbeda', async () => {
    const llmAnswer = 'Bunda maksudnya *Paket Spa Silver* (150rb, 60 menit) atau *Paket Spa Gold* (250rb, 90 menit) ya? Biar saya kasih info yang pas 😊';
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              reasoning: 'Customer menanyakan "paket spa" tapi ada 2 opsi berbeda harga/durasi di referensi.',
              needs_clarification: true,
              answer: llmAnswer
            })
          }
        }]
      }
    } as any);

    const result = await generator.generateFaqResponse('Berapa harga paket spa?', [], 'conv-1', mockTenant);

    expect(axios.post).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(axios.post).mock.calls[0][1] as any;
    const systemPrompt = payload.messages[0].content;

    // Pastikan aturan baru disisipkan di prompt
    expect(systemPrompt).toContain('PENGECUALIAN SEMPIT UNTUK KLARIFIKASI NAMA');

    // Pastikan sanitizer tidak memotong kalimat klarifikasi yang legitimate ini
    expect(result).toBe(llmAnswer);
  });

  it('2. Kasus Tidak Ambigu: Langsung jawab jika nama jelas match 1 treatment', async () => {
    const llmAnswer = 'Harga Paket Spa Silver adalah 150rb ya Bunda. Mau sekalian dijadwalkan?';
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              reasoning: 'Customer menanyakan "paket spa silver", spesifik match 1 treatment.',
              needs_clarification: false,
              answer: llmAnswer
            })
          }
        }]
      }
    } as any);

    const result = await generator.generateFaqResponse('Berapa harga paket spa silver?', [], 'conv-2', mockTenant);

    expect(result).toBe(llmAnswer);
  });

  it('3. Kasus Kebutuhan Umum: Mode rekomendasi (bukan klarifikasi) jika customer tanya manfaat generik', async () => {
    // Note: 'Untuk ' at the beginning is stripped by sanitizeTeamReferral's dangling connector guard
    const llmAnswerRaw = 'Untuk bayi rewel, Bunda bisa mencoba Pijat Relaksasi Bayi atau Spa Air Hangat Bayi ya. Keduanya sangat bagus. Bunda mau pilih yang mana?';
    const expectedAnswer = 'Bayi rewel, Bunda bisa mencoba Pijat Relaksasi Bayi atau Spa Air Hangat Bayi ya. Keduanya sangat bagus. Bunda mau pilih yang mana?';
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              reasoning: 'Customer menanyakan rekomendasi untuk bayi rewel. Ada 2 opsi, saya berikan keduanya sesuai poin 3 dan 4.',
              needs_clarification: false,
              answer: llmAnswerRaw
            })
          }
        }]
      }
    } as any);

    const result = await generator.generateFaqResponse('Treatment apa yang bagus untuk bayi rewel?', [], 'conv-3', mockTenant);

    expect(result).toBe(expectedAnswer);
    expect(result).toContain('Pijat Relaksasi Bayi');
    expect(result).toContain('Spa Air Hangat Bayi');
  });
  
  it('4. Regresi Larangan Lama: sanitizeTeamReferral memotong frasa defleksi (tanya ke tim)', () => {
    // Memastikan logic sanitizer asli tetap bekerja
    const deflectedText = 'Untuk harga, saya tidak bisa memastikan detailnya langsung ya bund. Silakan tanya ke tim kami aja ya bund 😊';
    const result = generator.sanitizeTeamReferral(deflectedText);
    
    // Harus kena potong dan mungkin fallback karena terlalu pendek
    expect(result).not.toContain('tanya ke tim kami');
    expect(result).toContain('Kami siap membantu memberikan rekomendasi');
  });
});
