import { getWibTimeInfo } from '../../utils/time-wib';
import { BOT_PERSONA_PROMPT } from '../../config/persona';
import { CircuitBreaker } from '../../utils/circuit-breaker';
import { stripNonIndonesianScripts, containsForeignScripts } from '../../utils/language-sanitizer';
import { llmOutageStorage } from './context';
import { openerTracker } from './opener-tracker';
import { callChatCompletionsWithFallback, getFallbackModel } from './model-fallback';
import { AiModelConfigService } from '../../config/ai-models.config';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
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
    const chatConfig = AiModelConfigService.getModelConfig('CHAT_REPLY');
    return chatConfig.modelName || process.env.OPENAI_MODEL || 'deepseek-v4-flash';
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

        const wibInfo = getWibTimeInfo();
        const isGreetingIntent = req.intent === 'greeting';
        const timeGreetingSection = isGreetingIntent
          ? `REKOMENDASI SAPAAN WAKTU: "${wibInfo.greetingRecommendation}"`
          : `DILARANG SAPAAN WAKTU: Ini BUKAN pesan greeting awal. DILARANG KERAS menyertakan sapaan waktu ("Selamat Pagi", "Selamat Siang", "Selamat Sore", "Selamat Malam").`;

        const rule5 = isGreetingIntent
          ? `5. ATURAN WAKTU HARAM SALAH: Waktu saat ini adalah ${wibInfo.wibTimeString}. Jika menggunakan sapaan waktu (pagi/siang/sore/malam), KAMU WAJIB MENGGUNAKAN "${wibInfo.greetingRecommendation}". DILARANG KERAS bilang "Selamat Pagi" jika waktu menunjukkan malam/sore/siang!`
          : `5. ATURAN SAPAAN WAKTU (DILARANG): DILARANG KERAS menggunakan sapaan waktu ("Selamat Pagi", "Selamat Siang", "Selamat Sore", "Selamat Malam") untuk intent ini (${req.intent}). Sapaan waktu HANYA untuk greeting awal. Gunakan "Halo Bunda" atau langsung jawab tanpa sapaan waktu.`;

        // Khusus intent greeting & ongkir_info: humanizer hanya boleh mengubah sebagian kecil teks
        // dari template acuan — bukan menulis ulang pesan dari nol atau menambah halusinasi.
        const greetingChangePercent = parseInt(process.env.HUMANIZER_GREETING_CHANGE_PERCENT || '10', 10);
        const keepPercent = 100 - greetingChangePercent;
        const isOngkirIntent = req.intent === 'ongkir_info';
        const templateConstraint = isGreetingIntent
          ? `ATURAN KHUSUS GREETING (SANGAT KETAT): Ini pesan GREETING. Pertahankan MINIMAL ${keepPercent}% dari teks acuan (fallbackTemplate) tetap sama secara kata-per-kata. Hanya ubah SEKITAR ${greetingChangePercent}% teks, misalnya ganti sedikit kata sapaan/penghubung/penutup saja. DILARANG menulis ulang pesan dari nol, mengganti struktur kalimat utama, atau mengubah fakta/brand name. Intinya: hasil akhir harus terlihat nyaris sama dengan teks acuan, hanya dengan variasi kecil yang wajar.\n\n`
          : isOngkirIntent
          ? `ATURAN KHUSUS ONGKIR INFO (SANGAT KETAT): Ini pesan ONGKIR_INFO. Pertahankan MINIMAL 85% dari teks acuan (fallbackTemplate) tetap sama secara kata-per-kata. DILARANG KERAS menambah pesan/basa-basi penutup baru seperti menyuruh customer sabar di perjalanan, mendoakan perjalanan, atau nasihat di luar konteks. HANYA sampaikan jarak, ongkir, dan penutup ajakan memilih treatment yang ada di teks acuan.\n\n`
          : '';

        const systemPrompt = `${BOT_PERSONA_PROMPT}

WAKTU SEKARANG: ${wibInfo.wibTimeString}
${timeGreetingSection}

TUGAS UTAMA:
Kamu adalah Phrasing & Humanizer Engine. Tugasmu adalah menyampaikan informasi/fakta dari sistem ke customer dengan gaya ngobrol natural, hangat, dan bervariasi dari biasanya, TANPA mengubah fakta numerik maupun menambah klaim baru.

Niat/Konteks Pesan: ${req.intent}
Fakta/Data dari Sistem: ${factsString}
${openerConstraint}
ATURAN STRICT & ANTI-HALUSINASI (MANDAT UTAMA):
1. JIKA ADA FAKTA NUMERIK (ongkir, jarak km, harga, discount, jam, tanggal): Kamu WAJIB menyertakan angka tersebut EXACT 100% SAMA SEPERTI DI DATA FAKTA. DILARANG HARAM mengubah, membulatkan, mengarang, atau menghilangkan angka tersebut.
2. DILARANG menambahkan fakta/informasi/basa-basi baru di luar data fakta yang diberikan (DILARANG KERAS mengarang cerita seperti mendoakan perjalanan customer, menyuruh sabar di jalan, dll.).
3. Jawab dengan kalimat pendek, ramah, dan santai-sopan khas Bunda/Bidan (pakai kata "Bunda" / "bund").
4. ATURAN SAPAAN KETAT: Maksimal 1-2 kali sapaan per paragraf pendek. JANGAN campur "Bunda" dan "Bund" (pilih satu). DILARANG sapaan ganda (misal: "Bunda-bunda"). DILARANG menaruh sapaan di akhir setiap kalimat secara beruntun.
${rule5}
6. Jangan tambahkan markdown berlebihan, buat agar terlihat alami seperti chat WhatsApp manusia.
7. FORMAT TEKS (WAJIB): WhatsApp hanya mengenali format SATU tanda. Untuk teks tebal pakai SATU bintang (*teks*), DILARANG memakai dua bintang (**teks**) karena markdown ganda akan tampil mentah di WhatsApp. Miring pakai _teks_, coretan pakai ~teks~.

HANYA BERIKAN TEKS BALASAN UNTUK CUSTOMER TANPA AWALAN/AKHIRAN TEKS PENJELASAN LAIN.
${templateConstraint}`;

        const tenantId = req.tenantId || DEFAULT_TENANT_ID;
        const startedAt = Date.now();
        let callResult: Awaited<ReturnType<typeof callChatCompletionsWithFallback>>;
        try {
          callResult = await callChatCompletionsWithFallback({
            baseUrl: this.baseUrl,
            apiKey: this.apiKey,
            model: this.model,
            fallbackModel: getFallbackModel(),
            timeoutMs: Number(process.env.LLM_TIMEOUT_CHAT_MS || 15000),
            payload: {
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Tolong sampaikan pesan ${req.intent} ini dengan variasi natural berdasarkan fakta tersebut. Contoh acuan pesan standar: "${req.fallbackTemplate}"` },
              ],
            },
          });
        } catch (err: any) {
          try {
            const { auditLlmCall } = await import('../../utils/llm-audit-buffer');
            auditLlmCall({
              tenant_id: tenantId,
              customer_phone: 'phrasing-audit',
              conversation_id: req.conversationId,
              task_type: 'PHRASING',
              model_name: this.model,
              baseUrl: this.baseUrl,
              startedAt,
              error: err,
            });
          } catch {
            // Fire-and-forget
          }
          throw err;
        }

        const responseData = callResult.data;

        try {
          const { auditLlmCall } = await import('../../utils/llm-audit-buffer');
          auditLlmCall({
            tenant_id: tenantId,
            customer_phone: 'phrasing-audit',
            conversation_id: req.conversationId,
            task_type: 'PHRASING',
            model_name: callResult.model,
            baseUrl: callResult.baseUrl,
            startedAt,
            usage: responseData?.usage,
          });
        } catch (logErr) {
          // Fire-and-forget
        }

        const content = responseData.choices[0].message.content.trim();

        // Sanitasi aksara asing (CJK/Kanji/Jepang/Korea/Rusia) yang bocor dari model
        // seperti DeepSeek — lihat dokumentasi language-sanitizer.ts
        const sanitizedContent = stripNonIndonesianScripts(content);
        if (sanitizedContent !== content) {
          console.warn(
            `[PHRASING SERVICE] Karakter aksara asing bocor, di-bersihkan: ` +
              `"${containsForeignScripts(content) ? content : ''}" (${(content.length - sanitizedContent.length)} char dibuang).`
          );
        }

        // Safety Validation: Jika req.facts punya angka, pastikan angka tersebut tidak hilang/berubah di output LLM
        if (req.facts) {
          for (const [key, value] of Object.entries(req.facts)) {
            if (typeof value === 'number' && value > 0) {
              const numStr = value.toString();
              const formattedIdStr = value.toLocaleString('id-ID');
              // Jika angka tidak ditemukan dalam bentuk raw maupun formatted (misal 15000 / 15.000)
              if (!sanitizedContent.includes(numStr) && !sanitizedContent.includes(formattedIdStr)) {
                // Khusus float (jarak) misal 5.4 -> check 5.4 or 5,4
                if (typeof value === 'number' && !Number.isInteger(value)) {
                  const floatFixed = value.toFixed(1);
                  const floatComma = floatFixed.replace('.', ',');
                  if (sanitizedContent.includes(floatFixed) || sanitizedContent.includes(floatComma)) {
                    continue;
                  }
                }
                console.warn(`[PHRASING SERVICE SAFETY TRIGGER] Fact number ${key}=${value} mutated/missing in LLM output: "${sanitizedContent}". Falling back to static template.`);
                return req.fallbackTemplate;
              }
            }
          }
        }

        // Safety Check 2: Deteksi halusinasi perjalanan/basa-basi ngawur pada ongkir_info
        if (isOngkirIntent && /\b(sabar\s+dalam\s+perjalanan|kalau\s+sudah\s+sampai|selamat\s+di\s+jalan|hati-hati\s+di\s+jalan|selama\s+perjalanan)\b/i.test(sanitizedContent)) {
          console.warn(`[PHRASING SERVICE SAFETY TRIGGER] Hallucinated travel advice detected in LLM output: "${sanitizedContent}". Falling back to static template.`);
          return req.fallbackTemplate;
        }

        // Safety Check 3: Bersihkan double greeting (misal "Selamat Siang, Selamat datang") & larang kata "lokasi/lokasinya"
        let finalContent = sanitizedContent
          .replace(/^(Selamat\s+(?:Pagi|Siang|Sore|Malam))\s*,\s*(Selamat\s+datang)/i, '$2')
          .replace(/\b(dimana|di\s+mana)\s+lokasinya\b/gi, 'rumahnya di mana')
          .replace(/\bmana\s+lokasinya\b/gi, 'rumahnya di mana')
          .replace(/\b(tahu|tau)\s+(dimana|di\s+mana)\s+lokasi(nya)?\b/gi, '$1 rumahnya di mana')
          .replace(/\blokasi\s+Bunda\b/gi, 'rumah Bunda')
          .replace(/\blokasinya\b/gi, 'rumahnya');

        if (req.conversationId) {
          openerTracker.record(req.conversationId, finalContent);
        }

        return finalContent;
      },
      async (req: PhrasingRequest) => {
        return req.fallbackTemplate;
      },
      { name: 'LLM Phrasing', failureThreshold: 0.7, slidingWindowSize: 20, cooldownPeriodMs: 60000 }
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
