import { getWibTimeInfo } from '../../utils/time-wib';
import { BOT_PERSONA_PROMPT } from '../../config/persona';
import { CircuitBreaker } from '../../utils/circuit-breaker';
import { stripNonIndonesianScripts, containsForeignScripts, sanitizeHallucinatedTerms, sanitizeForbiddenEnglishWords, sanitizeEmDash } from '../../utils/language-sanitizer';
import { llmOutageStorage } from './context';
import { openerTracker } from './opener-tracker';
import { getLlmEndpointConfig } from './llm-gateway';
import { callChatCompletionsWithFallback } from './model-fallback';
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

  private get model(): string {
    if (process.env.AI_MODEL_PHRASING || process.env.AI_MODEL_HUMANIZER) {
      return process.env.AI_MODEL_PHRASING || process.env.AI_MODEL_HUMANIZER || '';
    }
    try {
      const chatConfig = AiModelConfigService.getModelConfig('CHAT_REPLY');
      return chatConfig?.modelName || 'qwen3.7-flash-2026-07-15';
    } catch {
      return 'qwen3.7-flash-2026-07-15';
    }
  }

  constructor() {
    this.phrasingBreaker = new CircuitBreaker(
      async (req: PhrasingRequest) => {
        const store = llmOutageStorage.getStore();
        if (store?.simulateOutage) {
          throw new Error('Primary LLM provider connection timeout (500 Internal Server Error)');
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

        // Khusus intent greeting, ongkir_info, & tanya lokasi: humanizer hanya boleh mengubah sebagian kecil teks
        // dari template acuan — bukan menulis ulang pesan dari nol atau menambah halusinasi.
        const greetingChangePercent = parseInt(process.env.HUMANIZER_GREETING_CHANGE_PERCENT || '10', 10);
        const keepPercent = 100 - greetingChangePercent;
        const isOngkirIntent = req.intent === 'ongkir_info';
        const isAskLocationIntent = req.intent === 'ask_kelurahan_detail' || req.intent === 'ask_location';
        const isNeedTimeIntent = req.intent === 'need_time_acknowledgment';
        const isScheduleHandoffIntent = req.intent === 'schedule_check_handoff';
        const templateConstraint = isGreetingIntent
          ? `ATURAN KHUSUS GREETING (SANGAT KETAT): Ini pesan GREETING. Pertahankan MINIMAL ${keepPercent}% dari teks acuan (fallbackTemplate) tetap sama secara kata-per-kata. Hanya ubah SEKITAR ${greetingChangePercent}% teks, misalnya ganti sedikit kata sapaan/penghubung/penutup saja. DILARANG menulis ulang pesan dari nol, mengganti struktur kalimat utama, atau mengubah fakta/brand name. Intinya: hasil akhir harus terlihat nyaris sama dengan teks acuan, hanya dengan variasi kecil yang wajar.\n\n`
          : isOngkirIntent
          ? `ATURAN KHUSUS ONGKIR INFO (SANGAT KETAT): Ini pesan ONGKIR_INFO. Pertahankan MINIMAL 85% dari teks acuan (fallbackTemplate) tetap sama secara kata-per-kata. DILARANG KERAS menambah pesan/basa-basi penutup baru. DILARANG KERAS menanyakan ketersediaan waktu/jadwal (contoh terlarang: "kapan siap ditangani", "kapan mau dijadwalkan"). HARUS SELALU diakhiri persis dengan menanyakan pilihan treatment seperti di teks acuan (contoh: "Jadi mau pilih treatment apa bunda?").\n\n`
          : isAskLocationIntent
          ? `ATURAN KHUSUS TANYA LOKASI / KELURAHAN (SANGAT KETAT): Ini pesan ${req.intent}. Gunakan istilah standar "ongkir" atau "ongkos kirim". DILARANG KERAS mengganti kata "ongkir" dengan istilah halusinasi asing seperti "antimeminjamkan", "biaya pinjam", "biaya antar jemput", dll. Pertahankan MINIMAL 80% teks acuan tetap sama.\n\n`
          : isNeedTimeIntent
          ? `ATURAN KHUSUS JEDA / TUNGGU KABAR (SANGAT KETAT): Customer meminta waktu untuk berdiskusi/menanyakan ke keluarga/berpikir. Berikan respon hangat, santun, sabar, dan penuh pengertian (contoh: "Baik Bunda, kami tunggu kabarnya yaa bund 🤗"). DILARANG KERAS mendesak, menodong, atau menanyakan ulang pertanyaan lokasi/jadwal/harga. Cukup sampaikan bahwa kita siap menunggu dan siap membantu kapan pun Bunda sudah siap.\n\n`
          : isScheduleHandoffIntent
          ? `ATURAN KHUSUS CEK JADWAL / HANDOFF (SANGAT KETAT): Ini pesan ${req.intent}. Sampaikan secara singkat dan ramah bahwa kita sedang mengecek jadwal (contoh: "Baik Bunda, kami bantu cekkan ketersediaan jadwalnya dulu yaa 🙏🏻😊"). DILARANG KERAS menanyakan ulang tanggal atau informasi yang sudah disebutkan customer. DILARANG membuat kalimat panjang atau bertele-tele. Pertahankan pesan tetap singkat dan ringkas.\n\n`
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

9. FORMAT WAJIB (JSON): Keluarkan output HANYA dalam format JSON dengan struktur: { "message": "teks balasan untuk customer" }
Tanpa markdown di luar JSON!
${templateConstraint}`;

        const tenantId = req.tenantId || DEFAULT_TENANT_ID;
        const endpoint = getLlmEndpointConfig({ model: this.model });
        const startedAt = Date.now();
        let callResult: Awaited<ReturnType<typeof callChatCompletionsWithFallback>>;
        try {
          callResult = await callChatCompletionsWithFallback({
            baseUrl: endpoint.baseUrl,
            apiKey: endpoint.apiKey,
            model: this.model,
            fallbackModel: endpoint.fallbackModel,
            timeoutMs: endpoint.timeoutMs,
            payload: {
              response_format: { type: 'json_object' },
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
              baseUrl: endpoint.baseUrl,
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
        let content = responseData?.choices?.[0]?.message?.content?.trim() ?? '';
        
        // Strip markdown code blocks if the LLM wrapped the JSON
        let cleanJsonContent = content;
        if (cleanJsonContent.startsWith('```')) {
          cleanJsonContent = cleanJsonContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
        }

        // Parse JSON output
        try {
          const parsed = JSON.parse(cleanJsonContent);
          if (parsed && typeof parsed.message === 'string') {
            content = parsed.message.trim();
          } else {
            // JSON valid tapi tanpa field "message" → jangan kirim JSON mentah,
            // pakai teks mentah hanya jika bukan berbentuk objek JSON.
            content = /^\{[\s\S]*\}$/.test(cleanJsonContent.trim())
              ? ''
              : cleanJsonContent;
          }
        } catch (jsonErr) {
          // JSON malformed. DILARANG mengirim JSON mentah (sintaks kurung kurawal)
          // ke customer — ekstrak nilai "message" via regex; jika tidak ketemu,
          // biarkan kosong agar jatuh ke fallback template statis. Plain text
          // non-JSON tetap aman dipakai (bukan leak sintaks).
          const trimmedContent = cleanJsonContent.trim();
          if (trimmedContent.startsWith('{') || trimmedContent.startsWith('[')) {
            console.warn(`[PHRASING SERVICE] Gagal parse JSON (fallback ke regex):`, cleanJsonContent);
            const messageMatch = trimmedContent.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
            content = messageMatch
              ? messageMatch[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim()
              : '';
          } else {
            content = cleanJsonContent;
          }
        }

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

        // Clean preamble meta-text (e.g. "Siapp, ini pesan variasi...", "Berikut variasi...") and surrounding quotes
        let cleanedMeta = sanitizedContent
          .replace(/^(?:Siapp|Tentu|Baik|Berikut|Ini)[^\n]*variasi[^\n]*:\s*/gi, '')
          .replace(/^(?:---|\*\*\*)\s*/g, '')
          .trim();

        if (cleanedMeta.startsWith('"') && cleanedMeta.endsWith('"') && cleanedMeta.length > 2) {
          cleanedMeta = cleanedMeta.slice(1, -1).trim();
        }

        // Safety Check 3: Bersihkan double greeting, kata terlarang & halusinasi istilah
        let finalContent = sanitizeEmDash(
          sanitizeForbiddenEnglishWords(
            sanitizeHallucinatedTerms(
              cleanedMeta
                .replace(/^(Selamat\s+(?:Pagi|Siang|Sore|Malam))\s*,\s*(Selamat\s+datang)/i, '$2')
                .replace(/\b(dimana|di\s+mana)\s+lokasinya\b/gi, 'rumahnya di mana')
                .replace(/\bmana\s+lokasinya\b/gi, 'rumahnya di mana')
                .replace(/\b(tahu|tau)\s+(dimana|di\s+mana)\s+lokasi(nya)?\b/gi, '$1 rumahnya di mana')
                .replace(/\blokasi\s+Bunda\b/gi, 'rumah Bunda')
                .replace(/\blokasinya\b/gi, 'rumahnya')
            )
          )
        );

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
    if (!isHumanizerEnabled) {
      return req.fallbackTemplate;
    }
    const endpoint = getLlmEndpointConfig({ model: this.model });
    if (!endpoint.apiKey || endpoint.apiKey.startsWith('mock')) {
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
