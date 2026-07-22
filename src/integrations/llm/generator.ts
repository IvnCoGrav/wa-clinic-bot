import axios from 'axios';
import { BOT_PERSONA_PROMPT } from '../../config/persona';
import { KnowledgeChunkResult } from '../../services/knowledge.service';
import dotenv from 'dotenv';
dotenv.config();

export class LLMResponseGenerator {
  private get apiKey(): string {
    return process.env.LLM_API_KEY || '';
  }
  private get baseUrl(): string {
    return (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  }
  private get model(): string {
    return process.env.OPENAI_MODEL || 'MiniMax-M2.7-highspeed';
  }

  constructor() {}

  /**
   * Menghasilkan balasan FAQ natural berdasarkan RAG (Persona + Context Chunks dari Knowledge Base).
   */
  public async generateFaqResponse(userQuestion: string, contextChunks: KnowledgeChunkResult[]): Promise<string> {
    const contextText = contextChunks.map((c, i) => `[Referensi ${i + 1} - ${c.title}]:\n${c.content}`).join('\n\n');

    if (!this.apiKey || this.apiKey.startsWith('mock')) {
      return this.fallbackFaqResponse(userQuestion, contextChunks);
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: this.model,
          messages: [
            {
              role: 'system',
              content: `${BOT_PERSONA_PROMPT}

TUGAS UTAMA:
Jawab pertanyaan customer tentang informasi/FAQ moms & baby spa berdasarkan Referensi Dokumen berikut:

${contextText ? contextText : '(Tidak ada referensi dokumen spesifik yang ditemukan)'}

ATURAN BALASAN:
- Jawab secara ramah, santun, dan informatif sesuai gaya bahasa moms & baby spa.
  - Gunakan informasi dari referensi dokumen di atas. Jangan mengarang informasi di luar referensi.
- Jawab dengan singkat dan jelas.`,
            },
            {
              role: 'user',
              content: userQuestion,
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data.choices[0].message.content.trim();
    } catch (error) {
      console.warn('[LLM GENERATOR ERROR] API call failed, using fallback FAQ response:', (error as Error).message);
      return this.fallbackFaqResponse(userQuestion, contextChunks);
    }
  }

  private fallbackFaqResponse(userQuestion: string, chunks: KnowledgeChunkResult[]): string {
    if (chunks.length > 0) {
      let text = chunks[0].content;
      if (text.includes('Jawaban:')) {
        text = text.split('Jawaban:')[1].trim();
      }
      return `${text} 😊`;
    }
    return `Untuk informasi mengenai hal tersebut, Bunda bisa menanyakannya langsung atau tim kami siap membantu memberikan penjelasan lebih detail ya bund! ✨`;
  }
}

export const llmResponseGenerator = new LLMResponseGenerator();
