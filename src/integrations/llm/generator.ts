import axios from 'axios';
import { BOT_PERSONA_PROMPT } from '../../config/persona';
import { KnowledgeChunkResult } from '../../services/knowledge.service';
import { CircuitBreaker } from '../../utils/circuit-breaker';
import { llmOutageStorage } from './context';
import { LLM_HISTORY_LIMIT } from '../../config/llm-context';
import dotenv from 'dotenv';
dotenv.config();

export class LLMResponseGenerator {
  public llmBreaker: CircuitBreaker<[string, string, KnowledgeChunkResult[], string?, string?], string>;

  private get apiKey(): string {
    return process.env.LLM_API_KEY || '';
  }
  private get baseUrl(): string {
    return (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  }
  private get model(): string {
    return process.env.OPENAI_MODEL || 'MiniMax-M2.7-highspeed';
  }

  constructor() {
    this.llmBreaker = new CircuitBreaker(
      async (userQuestion: string, contextText: string, contextChunks: KnowledgeChunkResult[], conversationId?: string, tenantId?: string) => {
        const store = llmOutageStorage.getStore();
        if (store?.simulateOutage) {
          throw new Error('SumoPod connection timeout (500 Internal Server Error)');
        }
        let historyMessages: any[] = [];
        if (conversationId && tenantId) {
          try {
            const { messageService } = await import('../../services/message.service');
            historyMessages = await messageService.getRecentMessages(conversationId, LLM_HISTORY_LIMIT, tenantId);
          } catch (err) {
            console.error('[LLM GENERATOR] Failed to fetch chat history:', err);
          }
        }

        const systemMessage = {
          role: 'system',
          content: `${BOT_PERSONA_PROMPT}

TUGAS UTAMA:
Jawab pertanyaan customer tentang informasi/FAQ moms & baby spa berdasarkan Referensi Dokumen berikut:

${contextText ? contextText : '(Tidak ada referensi dokumen spesifik yang ditemukan)'}

ATURAN BALASAN:
1. Lakukan analisis terlebih dahulu terhadap apa yang sedang ditanyakan/dibahas oleh customer berdasarkan pesan terakhir dan riwayat percakapan. Tuliskan analisis ini di bagian "REASONING".
2. Tuliskan balasan ramah, santun, dan informatif untuk customer di bagian "JAWABAN" (gunakan informasi dari referensi dokumen di atas). Jawab dengan singkat dan jelas.
3. JIKA pertanyaan customer soal treatment/katalog (misal "pijat ibu hamil", "treatment untuk bayi rewel"): jawab dengan NADA REKOMENDASI PERSONAL seperti menyarankan ke teman, BUKAN membacakan daftar/katalog. Sebutkan SEMUA treatment relevan yang ada di Referensi sebagai opsi, lalu akhiri dengan menawarkan bantuan memilih/menjadwalkan.
4. JIKA ada LEBIH DARI SATU treatment relevan di Referensi: sebutkan SEMUANYA (jangan pilih satu secara sepihak tanpa alasan) — tetap dengan nada rekomendasi.
5. JIKA TIDAK ADA treatment/data yang relevan dengan pertanyaan di Referensi: berikan penjelasan pelayanan homecare yang Bunda cari secara ramah dan profesional. DILARANG HARAM mengucapkan "tanya ke tim kami", "mau saya cekkan ke tim dulu", atau "tidak bisa memastikan harganya".

ATURAN ANTI-HALUSINASI (WAJIB):
- HANYA gunakan fakta yang ADA di Referensi Dokumen di atas (nama treatment, usia/kategori target, durasi, deskripsi manfaat).
- DILARANG menambah/mengarang harga, durasi, usia, manfaat, atau detail treatment apa pun yang TIDAK tercantum di Referensi.
- DILARANG HARAM mengucapkan frasa "tanya ke tim kami", "saya tidak bisa memastikan harganya", "bisa langsung tanya ke tim", "mau kami cekkan ke tim dulu", "nanti saya kabari", atau kalimat sejenis yang menunjukkan bot tidak tahu/cuci tangan.

FORMAT RESPONS (HARUS MENGIKUTI FORMAT INI):
REASONING: [analisis Anda tentang apa yang ditanyakan customer dan konteks percakapannya]
JAWABAN: [balasan Anda untuk customer]`,
        };

        const apiMessages: any[] = [systemMessage];

        // Append recent chat history if available
        if (historyMessages && historyMessages.length > 0) {
          const filteredHistory = historyMessages.filter(msg => msg.content !== userQuestion);
          for (const msg of filteredHistory) {
            apiMessages.push({
              role: msg.direction === 'INBOUND' ? 'user' : 'assistant',
              content: msg.content,
            });
          }
        }

        // Add the current userQuestion
        apiMessages.push({
          role: 'user',
          content: userQuestion,
        });

        const response = await axios.post(
          `${this.baseUrl}/chat/completions`,
          {
            model: this.model,
            messages: apiMessages,
          },
          {
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 8000,
          }
        );

        const content = response.data.choices[0].message.content.trim();
        
        let reasoning = '';
        let jawaban = content;

        const reasoningMatch = content.match(/REASONING:\s*([\s\S]*?)(?=JAWABAN:|$)/i);
        const jawabanMatch = content.match(/JAWABAN:\s*([\s\S]*)/i);

        if (reasoningMatch) {
          reasoning = reasoningMatch[1].trim();
        }
        if (jawabanMatch) {
          jawaban = jawabanMatch[1].trim();
        }

        // Sanitizer: Bersihkan jika LLM tidak sengaja menghasilkan frasa "tanya ke tim / tidak bisa memastikan harga"
        jawaban = this.sanitizeTeamReferral(jawaban);

        console.log(`\n🧠 [AI REASONING] for customer query "${userQuestion}":\n"${reasoning || 'No reasoning found'}"\n`);
        
        return jawaban;
      },
      async (userQuestion: string, contextText: string, contextChunks: KnowledgeChunkResult[]) => {
        return this.fallbackFaqResponse(userQuestion, contextChunks);
      }
    );
  }

  /**
   * Sanitizer untuk memastikan bot TIDAK PERNAH membalas dengan kalimat cuci tangan "tanya ke tim", "tidak bisa memastikan harga", dll.
   */
  private sanitizeTeamReferral(text: string): string {
    if (!text) return text;
    let cleaned = text
      .replace(/(?:Untuk\s+harga,?\s*)?saya\s+tidak\s+bisa\s+memastikan\s+detailnya\s+langsung\s+ya\s+bund\.?\s*/gi, '')
      .replace(/Namun,?\s*untuk\s+harga\s+yang\s+paling\s+akurat,?\s*bisa\s+langsung\s+tanya\s+ke\s+tim\s+kami\s+aja\s+ya\s+bund\s*😊?/gi, '')
      .replace(/Mau\s+kami\s+cekkan\s+harga\s+terbaru\s+ke\s+tim\s+dulu,?\s*bund\?\s*Nanti\s+saya\s+kabari\s+ya\s*😊?/gi, '')
      .replace(/(?:bisa|silakan)?\s*(?:langsung\s*)?tanya\s+(?:ke\s*)?tim\s+kami\s*(?:aja\s*)?(?:ya\s*bund)?\s*😊?/gi, '')
      .replace(/mau\s+kami\s+cekkan\s+.*?ke\s+tim\s+dulu.*?😊?/gi, '')
      .replace(/boleh\s+saya\s+cek\s+dulu\s+ya\s+bund,?\s*nanti\s+saya\s+kabari\.?/gi, '')
      .trim();

    return cleaned || `Kami siap membantu memberikan rekomendasi treatment homecare terbaik untuk Bunda dan si kecil. Ada yang ingin Bunda tanyakan seputar perawatan kami? 😊`;
  }

  /**
   * Menghasilkan balasan FAQ natural berdasarkan RAG (Persona + Context Chunks dari Knowledge Base).
   */
  public async generateFaqResponse(userQuestion: string, contextChunks: KnowledgeChunkResult[], conversationId?: string, tenantId?: string): Promise<string> {
    const contextText = contextChunks.map((c, i) => `[Referensi ${i + 1} - ${c.title}]:\n${c.content}`).join('\n\n');

    if (!this.apiKey || this.apiKey.startsWith('mock')) {
      return this.fallbackFaqResponse(userQuestion, contextChunks);
    }

    try {
      console.time('LLM_GENERATOR_API_CALL');
      const res = await this.llmBreaker.execute(userQuestion, contextText, contextChunks, conversationId, tenantId);
      console.timeEnd('LLM_GENERATOR_API_CALL');
      return res;
    } catch (error) {
      console.warn('[LLM GENERATOR ERROR] API call failed, using fallback FAQ response:', (error as Error).message);
      return this.fallbackFaqResponse(userQuestion, contextChunks);
    }
  }

  private fallbackFaqResponse(userQuestion: string, chunks: KnowledgeChunkResult[]): string {
    if (chunks.length === 0) {
      return `Kami siap membantu memberikan rekomendasi treatment homecare terbaik untuk Bunda dan si kecil. Ada yang ingin Bunda tanyakan seputar perawatan kami? 😊`;
    }

    // Jalur katalog treatment terstruktur: bangun rekomendasi personal dari fakta data.
    // Format chunk dari interest.ts adalah blok "[DATA TREATMENT] Nama:... Usia:... Durasi:... Deskripsi:..."
    // — parse fakta lalu susun kalimat rekomendasi (tetap grounded, tanpa mengarang).
    const firstChunk = chunks[0];
    if (firstChunk.content.includes('[DATA TREATMENT]')) {
      const items = firstChunk.content.split(/\[DATA TREATMENT\]/).filter((s) => s.trim().length > 0);
      if (items.length > 0) {
        const recommendations = items.map((raw) => {
          const field = (key: string) => {
            const m = raw.match(new RegExp(`${key}:\\s*(.+)`));
            return m ? m[1].trim() : '';
          };
          return {
            name: field('Nama'),
            age: field('Usia/Target'),
            duration: field('Durasi'),
            description: field('Deskripsi'),
          };
        });

        if (recommendations.length === 1) {
          const r = recommendations[0];
          return `Bunda, untuk itu kami punya *${r.name}* — treatment ini khusus untuk ${r.age.toLowerCase()}${r.duration ? ` dengan durasi ${r.duration}` : ''}. ${r.description} 😊\n\nMau saya bantu pilih treatment ini, Bunda?`;
        }

        const list = recommendations.map((r) => `*${r.name}* (${r.age.toLowerCase()}, ${r.duration})`).join(' dan ');
        const names = recommendations.map((r) => r.name).join(' atau ');
        return `Bunda, kami punya beberapa opsi yang cocok: ${list}. ${recommendations[0].description} 😊\n\nMau saya bantu pilih di antara ${names} untuk Bunda?`;
      }
    }

    // Jalur knowledge base FAQ biasa (non-catalog): ambil Jawaban yang tersimpan verbatim.
    let text = firstChunk.content;
    if (text.includes('Jawaban:')) {
      text = text.split('Jawaban:')[1].trim();
    }
    return `${text} 😊`;
  }
}

export const llmResponseGenerator = new LLMResponseGenerator();
