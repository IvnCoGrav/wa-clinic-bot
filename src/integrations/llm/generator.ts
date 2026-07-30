import axios from 'axios';
import { BOT_PERSONA_PROMPT } from '../../config/persona';
import { KnowledgeChunkResult } from '../../services/knowledge.service';
import { CircuitBreaker } from '../../utils/circuit-breaker';
import { llmOutageStorage } from './context';
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
            historyMessages = await messageService.getRecentMessages(conversationId, 6, tenantId);
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

        console.log(`\n🧠 [AI REASONING] for customer query "${userQuestion}":\n"${reasoning || 'No reasoning found'}"\n`);
        
        return jawaban;
      },
      async (userQuestion: string, contextText: string, contextChunks: KnowledgeChunkResult[]) => {
        return this.fallbackFaqResponse(userQuestion, contextChunks);
      }
    );
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
