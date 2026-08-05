import axios from 'axios';
import { BOT_PERSONA_PROMPT } from '../../config/persona';
import { CircuitBreaker } from '../../utils/circuit-breaker';
import { llmOutageStorage } from './context';
import { openerTracker } from './opener-tracker';
import dotenv from 'dotenv';
dotenv.config();

export interface PhrasingRequest {
  facts?: Record<string, string | number>;
  intent: string;
  conversationId?: string;
  tenantId?: string;
  fallbackTemplate: string;
}

export class PhrasingService {
  public phrasingBreaker: CircuitBreaker<[PhrasingRequest], string>;

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
    this.phrasingBreaker = new CircuitBreaker(
      async (req: PhrasingRequest) => {
        const store = llmOutageStorage.getStore();
        if (store?.simulateOutage) {
          throw new Error('SumoPod connection timeout (500 Internal Server Error)');
        }

        const recentOpeners = req.conversationId ? openerTracker.getOpeners(req.conversationId) : [];
        const factsString = req.facts ? JSON.stringify(req.facts) : '(Tidak ada data spesifik)';

        let openerConstraint = '';
        if (recentOpeners.length > 0) {
          openerConstraint = `\nHINDARI MENGULANG POLA PEMBUKA BERIKUT yang baru saja dipakai: ${JSON.stringify(recentOpeners)}. Gunakan sapaan/variasi pembuka lain yang segar.\n`;
        }

        const systemPrompt = `${BOT_PERSONA_PROMPT}

TUGAS UTAMA:
Kamu adalah Phrasing & Humanizer Engine. Tugasmu adalah menyampaikan informasi/fakta dari sistem ke customer dengan gaya ngobrol natural, hangat, dan bervariasi dari biasanya, TANPA mengubah fakta numerik maupun menambah klaim baru.

Niat/Konteks Pesan: ${req.intent}
Fakta/Data dari Sistem: ${factsString}
${openerConstraint}
ATURAN STRICT & ANTI-HALUSINASI (MANDAT UTAMA):
1. JIKA ADA FAKTA NUMERIK (ongkir, jarak km, harga, discount, jam, tanggal): Kamu WAJIB menyertakan angka tersebut EXACT 100% SAMA SEPERTI DI DATA FAKTA. DILARANG HARAM mengubah, membulatkan, mengarang, atau menghilangkan angka tersebut.
2. DILARANG menambahkan fakta/informasi baru di luar data fakta yang diberikan.
3. Jawab dengan kalimat pendek, ramah, dan santai-sopan khas Bunda/Bidan (pakai kata "Bunda" / "bund").
4. Jangan tambahkan markdown berlebihan, buat agar terlihat alami seperti chat WhatsApp manusia.

HANYA BERIKAN TEKS BALASAN UNTUK CUSTOMER TANPA AWALAN/AKHIRAN TEKS PENJELASAN LAIN.`;

        const response = await axios.post(
          `${this.baseUrl}/chat/completions`,
          {
            model: this.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `Tolong sampaikan pesan ${req.intent} ini dengan variasi natural berdasarkan fakta tersebut. Contoh acuan pesan standar: "${req.fallbackTemplate}"` },
            ],
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

        // Safety Validation: Jika req.facts punya angka, pastikan angka tersebut tidak hilang/berubah di output LLM
        if (req.facts) {
          for (const [key, value] of Object.entries(req.facts)) {
            if (typeof value === 'number' && value > 0) {
              const numStr = value.toString();
              const formattedIdStr = value.toLocaleString('id-ID');
              // Jika angka tidak ditemukan dalam bentuk raw maupun formatted (misal 15000 / 15.000)
              if (!content.includes(numStr) && !content.includes(formattedIdStr)) {
                // Khusus float (jarak) misal 5.4 -> check 5.4 or 5,4
                if (typeof value === 'number' && !Number.isInteger(value)) {
                  const floatFixed = value.toFixed(1);
                  const floatComma = floatFixed.replace('.', ',');
                  if (content.includes(floatFixed) || content.includes(floatComma)) {
                    continue;
                  }
                }
                console.warn(`[PHRASING SERVICE SAFETY TRIGGER] Fact number ${key}=${value} mutated/missing in LLM output: "${content}". Falling back to static template.`);
                return req.fallbackTemplate;
              }
            }
          }
        }

        if (req.conversationId) {
          openerTracker.record(req.conversationId, content);
        }

        return content;
      },
      async (req: PhrasingRequest) => {
        return req.fallbackTemplate;
      }
    );
  }

  public async generate(req: PhrasingRequest): Promise<string> {
    const isHumanizerEnabled = process.env.HUMANIZER_ENABLED !== 'false';
    if (!isHumanizerEnabled || !this.apiKey || this.apiKey.startsWith('mock')) {
      return req.fallbackTemplate;
    }

    try {
      return await this.phrasingBreaker.execute(req);
    } catch (error) {
      console.warn('[PHRASING SERVICE ERROR] Fallback to static template:', (error as Error).message);
      return req.fallbackTemplate;
    }
  }
}

export const phrasingService = new PhrasingService();
