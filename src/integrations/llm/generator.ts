import { BOT_PERSONA_PROMPT, getMaxCharsPerReply, truncateToMaxChars } from '../../config/persona';
import { KnowledgeChunkResult } from '../../services/knowledge.service';
import { CircuitBreaker } from '../../utils/circuit-breaker';
import { llmOutageStorage } from './context';
import { callChatCompletionsWithFallback, getFallbackModel } from './model-fallback';
import { stripNonIndonesianScripts, containsForeignScripts } from '../../utils/language-sanitizer';
import { LLM_HISTORY_LIMIT } from '../../config/llm-context';
import { customerService } from '../../services/customer.service';
import { conversationService } from '../../services/conversation.service';
import { measure } from '../../utils/timer';
import dotenv from 'dotenv';
function isReferentialQuestion(userQuestion: string): boolean {
  if (!userQuestion) return false;
  const q = userQuestion.toLowerCase();
  return /\b(berapa\s+itu|berapa\s+yang\s+tadi|yang\s+itu|yang\s+baru|yang\s+tadi\s+berapa|yang\s+tadi|itu\s+berapa|tadi\s+berapa|berapa\s+harganya\s+yang)\b/i.test(q);
}

export interface FAQResponseResult {
  answer: string;
  reasoning: string | null;
  extracted_preferences?: Record<string, any>;
}

export class LLMResponseGenerator {
  public llmBreaker: CircuitBreaker<[string, string, KnowledgeChunkResult[], string?, string?, string?, string?], FAQResponseResult>;

  private get apiKey(): string {
    return process.env.LLM_API_KEY || '';
  }
  private get baseUrl(): string {
    return (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  }

  constructor() {
    this.llmBreaker = new CircuitBreaker<[string, string, KnowledgeChunkResult[], string?, string?, string?, string?], FAQResponseResult>(
      async (
        userQuestion: string,
        contextText: string,
        contextChunks: KnowledgeChunkResult[],
        conversationId?: string,
        tenantId?: string,
        treatmentNameForFollowUp?: string,
        customerId?: string
      ) => {
        const store = llmOutageStorage.getStore();
        if (store?.simulateOutage) {
          throw new Error('SumoPod connection timeout (500 Internal Server Error)');
        }
        
        const { AiModelConfigService } = await import('../../config/ai-models.config');
        const modelConfig = AiModelConfigService.getModelConfig('CHAT_REPLY');

        let historyMessages: any[] = [];
        if (conversationId && tenantId) {
          try {
            const { messageService } = await import('../../services/message.service');
            historyMessages = await messageService.getRecentMessages(conversationId, LLM_HISTORY_LIMIT, tenantId);
          } catch (err) {
            console.error('[LLM GENERATOR] Failed to fetch chat history:', err);
          }
        }

        let groundTruthSection = `[DATA CUSTOMER (GROUND TRUTH)]
(Fakta dari database — BUKAN hasil tebakan. Ini kebenaran mutlak, jangan dikontradiksi oleh isi Riwayat Percakapan di bawah.)
- Nama: Tidak diketahui
- Layanan Aktif Saat Ini: Tidak ada
- Layanan yang Pernah Dipakai (Historis): Tidak ada`;

        if (customerId && tenantId) {
          try {
            const gt = await customerService.getCustomerGroundTruth(customerId, tenantId);
            if (gt) {
              const nameStr = gt.name && gt.name.trim() ? gt.name.trim() : 'Tidak diketahui';
              const activeStr = gt.activeServices && gt.activeServices.length > 0 ? gt.activeServices.join(', ') : 'Tidak ada';
              const historicalStr = gt.historicalServices && gt.historicalServices.length > 0 ? gt.historicalServices.join(', ') : 'Tidak ada';
              const prefs = gt.preferences && Object.keys(gt.preferences).length > 0
                ? Object.entries(gt.preferences).map(([k, v]) => `${k}: ${v}`).join('; ')
                : 'Tidak ada';
              groundTruthSection = `[DATA CUSTOMER (GROUND TRUTH)]
(Fakta dari database — BUKAN hasil tebakan. Ini kebenaran mutlak, jangan dikontradiksi oleh isi Riwayat Percakapan di bawah.)
- Nama: ${nameStr}
- Layanan Aktif Saat Ini: ${activeStr}
- Layanan yang Pernah Dipakai (Historis): ${historicalStr}
- Preferensi: ${prefs}`;
            }
          } catch (err) {
            console.error('[LLM GENERATOR] Failed to fetch customer ground truth:', err);
          }
        }

        let conversationContextSection = `[KONTEKS PERCAKAPAN]
Treatment yang terakhir dibahas dalam percakapan ini: Belum ada`;

        if (conversationId && tenantId) {
          try {
            const conv = await conversationService.getConversationById(conversationId, tenantId);
            if (conv && conv.last_discussed_treatment) {
              conversationContextSection = `[KONTEKS PERCAKAPAN]
Treatment yang terakhir dibahas dalam percakapan ini: ${conv.last_discussed_treatment}`;
            }
          } catch (err) {
            console.error('[LLM GENERATOR] Failed to fetch conversation context:', err);
          }
        }

        // --- ATURAN KESELAMATAN FAQ CACHE ---
        let skipCacheReason: string | null = null;
        if (historyMessages && historyMessages.length > 0) {
          skipCacheReason = 'Conversation has chat history';
        } else if (treatmentNameForFollowUp && treatmentNameForFollowUp.trim().length > 0) {
          skipCacheReason = 'treatmentNameForFollowUp is present';
        } else if (isReferentialQuestion(userQuestion)) {
          skipCacheReason = 'Referential/anaphora question detected';
        }

        if (!skipCacheReason && customerId && tenantId) {
          try {
            const gtCheck = await customerService.getCustomerGroundTruth(customerId, tenantId);
            if (gtCheck && ((gtCheck.activeServices && gtCheck.activeServices.length > 0) || (gtCheck.historicalServices && gtCheck.historicalServices.length > 0))) {
              skipCacheReason = 'Customer has active or historical ground truth data';
            }
          } catch (err) {
            // ignore ground truth fetch error for cache decision
          }
        }

        let cacheKey = '';
        if (skipCacheReason) {
          console.log(`[FAQ CACHE] SKIPPED (reason: ${skipCacheReason}) for query: "${userQuestion}"`);
        } else {
          const { faqCacheService } = await import('../../services/faq-cache.service');
          cacheKey = faqCacheService.generateKey(tenantId || 'default-tenant', userQuestion, contextChunks, contextText);
          const cachedVal = await faqCacheService.get(cacheKey);
          if (cachedVal) {
            console.log(`[FAQ CACHE] HIT for query: "${userQuestion}"`);
            return {
              answer: cachedVal,
              reasoning: '[CACHE HIT] Served from FaqCacheService',
            };
          }
          console.log(`[FAQ CACHE] MISS for query: "${userQuestion}"`);
        }

        let ctaInstruction = '6. Setelah jawaban inti, tutup dengan ajakan lanjut ke pengisian list reservasi/booking yang MENYATU secara natural dengan konteks jawabanmu (bukan template terpisah).';
        if (treatmentNameForFollowUp && treatmentNameForFollowUp.trim()) {
          ctaInstruction = `6. Setelah jawaban inti, tutup dengan ajakan lanjut booking yang MENYATU secara natural dengan konteks jawabanmu. Sebutkan nama treatment "${treatmentNameForFollowUp.trim()}" dan tawarkan bantu jadwalkan.`;
        }

        // Batas maksimal karakter per balasan AI (tenant-aware, dari persona config).
        const maxChars = tenantId ? getMaxCharsPerReply(tenantId) : null;
        const maxCharsInstruction = maxChars && maxChars > 0
          ? `BATAS KARAKTER (WAJIB): Balasan pada bagian JAWABAN TIDAK BOLEH MELEBIHI ${maxChars} karakter. Ringkas, padat, langsung ke inti jawaban, tetap hangat dan ramah. Jangan menulis jawaban yang panjang bertele-tele.`
          : '';

        const systemMessage = {
          role: 'system',
          content: `${BOT_PERSONA_PROMPT}

${groundTruthSection}

${conversationContextSection}

TUGAS UTAMA:
Jawab pertanyaan customer tentang informasi/FAQ moms & baby spa berdasarkan Referensi Dokumen berikut:

${contextText ? contextText : '(Tidak ada referensi dokumen spesifik yang ditemukan)'}

ATURAN BALASAN:
1. Lakukan analisis terlebih dahulu terhadap apa yang sedang ditanyakan/dibahas oleh customer berdasarkan pesan terakhir dan riwayat percakapan. Tuliskan analisis ini di bagian "REASONING".
   PENTING: Jika customer menggunakan kata referensial seperti "berapa itu", "berapa yang tadi", "yang itu", "yang baru", dll., WAJIB gunakan info "Treatment yang terakhir dibahas" pada section [KONTEKS PERCAKAPAN] di atas sebagai sumber utama penentuan treatment. Jika section tersebut "Belum ada", baru gunakan konteks dari riwayat percakapan.
2. Tuliskan balasan ramah, santun, dan informatif untuk customer di bagian "JAWABAN" (gunakan informasi dari referensi dokumen di atas). Jawab dengan singkat dan jelas.
   FORMAT TEKS (WAJIB): WhatsApp hanya mengenali format SATU tanda. Untuk teks tebal pakai SATU bintang (*teks*), DILARANG memakai dua bintang (**teks**) karena markdown ganda akan tampil mentah di WhatsApp. Miring pakai _teks_, coretan ~teks~.
3. JIKA pertanyaan customer soal treatment/katalog (misal "pijat ibu hamil", "treatment untuk bayi rewel"): jawab dengan NADA REKOMENDASI PERSONAL seperti menyarankan ke teman, BUKAN membacakan daftar/katalog. Sebutkan SEMUA treatment relevan yang ada di Referensi sebagai opsi, lalu akhiri dengan menawarkan bantuan memilih/menjadwalkan.
4. JIKA ada LEBIH DARI SATU treatment relevan di Referensi: sebutkan SEMUANYA (jangan pilih satu secara sepihak tanpa alasan) — tetap dengan nada rekomendasi.
5. JIKA TIDAK ADA treatment/data yang relevan dengan pertanyaan di Referensi: berikan penjelasan pelayanan homecare yang Bunda cari secara ramah dan profesional. DILARANG HARAM mengucapkan "tanya ke tim kami", "mau saya cekkan ke tim dulu", atau "tidak bisa memastikan harganya".
6. JIKA pertanyaan customer berisi referensi ke treatment yang baru saja dibahas (misal "berapa itu", "yang tadi berapa"): langsung jawab dengan harga treatment tersebut berdasarkan Referensi. JANGAN mengulang penjelasan treatment, LANGSUNG kasih harganya.
7. PENGECUALIAN SEMPIT UNTUK KLARIFIKASI NAMA (BUKAN "tidak tahu"):
   JIKA nama/istilah yang disebut customer secara fuzzy match ke 2 ATAU LEBIH item BERBEDA di Referensi Dokumen (nama treatment berbeda, dengan harga ATAU durasi ATAU target usia yang berbeda satu sama lain), DAN memilih salah satu secara sepihak berisiko memberi info yang salah ke customer:
   Anda BOLEH bertanya balik SATU KALI untuk memastikan item mana yang dimaksud, dengan menyebutkan SEMUA nama kandidat secara eksplisit dari Referensi (bukan bertanya generik "maksudnya yang mana ya?").
   Contoh benar: "Bunda maksudnya *Paket Spa Silver* (150rb, 60 menit) atau *Paket Spa Gold* (250rb, 90 menit) ya? Biar saya kasih info yang pas 😊"
   Contoh SALAH (tetap dilarang): "Untuk harga pastinya, boleh tanya ke tim kami dulu ya" — ini BUKAN klarifikasi nama, ini cuci tangan, TETAP dilarang.
   Pengecualian ini TIDAK berlaku jika Referensi hanya punya SATU item yang match, atau jika customer menanyakan kebutuhan umum (bukan menyebut nama spesifik) — untuk kasus itu tetap ikuti poin 3 & 4 (mode rekomendasi, sebutkan semua opsi relevan sekaligus, bukan tanya balik).
${ctaInstruction}

${maxCharsInstruction}

ATURAN ANTI-HALUSINASI (WAJIB):
- HANYA gunakan fakta yang ADA di Referensi Dokumen di atas (nama treatment, usia/kategori target, durasi, deskripsi manfaat).
- DILARANG menambah/mengarang harga, durasi, usia, manfaat, atau detail treatment apa pun yang TIDAK tercantum di Referensi.
- DILARANG HARAM mengucapkan frasa "tanya ke tim kami", "saya tidak bisa memastikan harganya", "bisa langsung tanya ke tim", "mau kami cekkan ke tim dulu", "nanti saya kabari", atau kalimat sejenis yang menunjukkan bot tidak tahu/cuci tangan.
- Untuk info riwayat/status layanan customer, HANYA gunakan data di section [DATA CUSTOMER (GROUND TRUTH)] di atas. JANGAN mengambil fakta soal riwayat layanan dari [RIWAYAT PERCAKAPAN] meskipun customer menyebutkannya di sana — kalau ada perbedaan, section Ground Truth yang benar.

FORMAT RESPONS (WAJIB JSON, jangan ada teks di luar JSON):
{
  "reasoning": "analisis Anda tentang apa yang ditanyakan customer dan konteks percakapannya...",
  "referenced_treatment": "nama treatment yang sedang dibahas jika ada, atau null",
  "needs_clarification": true | false,
  "answer": "balasan Anda untuk customer",
  "extracted_preferences": {}
}

ATURAN EKSTRAKSI PREFERENSI:
- Jika customer menyebut fakta permanen BARU tentang profil mereka (nama anak, jumlah anak, usia bayi, kulit sensitif, alergi, keluhan spesifik yang berulang, informasi kehamilan/nifas, preferensi layanan jangka panjang), tuliskan ke field "extracted_preferences" sebagai object key-value singkat (misal: {"child_name": "Lala", "child_age_months": 5, "skin_sensitive": true}).
- JANGAN tampilkan isi "extracted_preferences" ke dalam "answer".
- Jika tidak ada fakta permanen baru, set "extracted_preferences" menjadi {}.
- Preferensi adalah fakta stabil jangka panjang — JANGAN masukkan informasi sementara (jadwal hari ini, intensitas sesaat).
`,
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

        const startedAt = Date.now();
        let callResult: Awaited<ReturnType<typeof callChatCompletionsWithFallback>>;
        try {
          callResult = await callChatCompletionsWithFallback({
            baseUrl: this.baseUrl,
            apiKey: this.apiKey,
            model: modelConfig.modelName,
            fallbackModel: getFallbackModel(),
            timeoutMs: Number(process.env.LLM_TIMEOUT_CHAT_MS || 15000),
            payload: {
              temperature: modelConfig.temperature,
              max_tokens: modelConfig.maxTokens,
              response_format: { type: 'json_object' },
              messages: apiMessages,
            },
          });
        } catch (err: any) {
          try {
            const { auditLlmCall } = await import('../../utils/llm-audit-buffer');
            auditLlmCall({
              tenant_id: tenantId,
              customer_phone: customerId || 'unknown',
              conversation_id: conversationId,
              task_type: 'CHAT_REPLY',
              model_name: modelConfig.modelName,
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
        const usedModel = callResult.model;

        try {
          const { auditLlmCall } = await import('../../utils/llm-audit-buffer');
          auditLlmCall({
            tenant_id: tenantId,
            customer_phone: customerId || 'unknown',
            conversation_id: conversationId,
            task_type: 'CHAT_REPLY',
            model_name: usedModel || modelConfig.modelName,
            baseUrl: callResult.baseUrl,
            startedAt,
            usage: responseData?.usage,
          });
        } catch (logErr) {
          // Safe fire-and-forget
        }

        const content = responseData.choices[0].message.content;
        
        let parsed: { reasoning?: string; answer?: string; referenced_treatment?: string | null; needs_clarification?: boolean; extracted_preferences?: Record<string, any> };
        try {
          let cleanContent = content.trim();
          if (cleanContent.startsWith('```')) {
            cleanContent = cleanContent.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '').trim();
          }
          parsed = JSON.parse(cleanContent);
        } catch (err) {
          console.warn('[LLM GENERATOR] Failed to parse JSON response, using raw content as soft fallback. Raw content:', content);
          parsed = { answer: content, reasoning: '[SOFT FALLBACK] JSON parse failed, using raw text' };
        }

        if (!parsed.answer || parsed.answer.trim() === '') {
          console.error('[LLM GENERATOR] Parsed JSON has empty answer field, falling back.');
          throw new Error('Empty answer from LLM JSON output');
        }

        let jawaban = parsed.answer.trim();

        // Sanitizer: Bersihkan jika LLM tidak sengaja menghasilkan frasa "tanya ke tim / tidak bisa memastikan harga"
        jawaban = this.sanitizeTeamReferral(jawaban);

        // Sanitizer aksara asing (CJK/Kanji/Jepang/Korea/Rusia) yang bocor dari model
        const sanitizedJawaban = stripNonIndonesianScripts(jawaban);
        if (sanitizedJawaban !== jawaban) {
          console.warn(
            `[LLM GENERATOR] Karakter aksara asing bocor, di-bersihkan: ` +
              `"${containsForeignScripts(jawaban) ? jawaban : ''}".
`
          );
          jawaban = sanitizedJawaban;
        }

        console.log(`\n🧠 [AI REASONING] for customer query "${userQuestion}":\n"${parsed.reasoning || 'No reasoning found'}"\n`);
        if (parsed.referenced_treatment) {
          console.log(`[LLM STATE SIGNAL] Model inferred referenced_treatment: "${parsed.referenced_treatment}"`);
        }
        
        const finalAnswer = truncateToMaxChars(jawaban, maxChars);

        if (!skipCacheReason && cacheKey) {
          try {
            const { faqCacheService } = await import('../../services/faq-cache.service');
            await faqCacheService.set(cacheKey, finalAnswer);
          } catch (cacheErr: any) {
            console.warn('[FAQ CACHE] Failed to set cache:', cacheErr.message);
          }
        }

        return {
          answer: finalAnswer,
          reasoning: parsed.reasoning || null,
          extracted_preferences:
            parsed.extracted_preferences &&
            typeof parsed.extracted_preferences === 'object' &&
            Object.keys(parsed.extracted_preferences).length > 0
              ? parsed.extracted_preferences
              : undefined,
        };
      },
      async (
        userQuestion: string,
        contextText: string,
        contextChunks: KnowledgeChunkResult[],
        conversationId?: string,
        tenantId?: string,
        treatmentNameForFollowUp?: string,
        customerId?: string
      ) => {
        return {
          answer: this.fallbackFaqResponse(userQuestion, contextChunks, treatmentNameForFollowUp),
          reasoning: '[FALLBACK] LLM error or breaker open',
        };
      },
      { name: 'LLM Generator', failureThreshold: 0.7, slidingWindowSize: 20, cooldownPeriodMs: 60000 }
    );
  }

  /**
   * Sanitizer untuk memastikan bot TIDAK PERNAH membalas dengan kalimat cuci tangan "tanya ke tim", "tidak bisa memastikan harga", dll.
   * Dilengkapi guard anti fragment <15 karakter dan dangling connector di awal/akhir kalimat.
   */
  public sanitizeTeamReferral(text: string): string {
    if (!text) return text;
    let cleaned = text
      .replace(/(?:Untuk\s+harga,?\s*)?saya\s+tidak\s+bisa\s+memastikan\s+detailnya\s+langsung\s+ya\s+bund\.?\s*/gi, '')
      .replace(/Namun,?\s*untuk\s+harga\s+yang\s+paling\s+akurat,?\s*bisa\s+langsung\s+tanya\s+ke\s+tim\s+kami\s+aja\s+ya\s+bund\s*😊?/gi, '')
      .replace(/Mau\s+kami\s+cekkan\s+harga\s+terbaru\s+ke\s+tim\s+dulu,?\s*bund\?\s*Nanti\s+saya\s+kabari\s+ya\s*😊?/gi, '')
      .replace(/(?:bisa|silakan)?\s*(?:langsung\s*)?tanya\s+(?:ke\s*)?tim\s+kami\s*(?:aja\s*)?(?:ya\s*bund)?\s*😊?/gi, '')
      .replace(/mau\s+kami\s+cekkan\s+.*?ke\s+tim\s+dulu.*?😊?/gi, '')
      .replace(/boleh\s+saya\s+cek\s+dulu\s+ya\s+bund,?\s*nanti\s+saya\s+kabari\.?/gi, '')
      .trim();

    const fallbackMsg = `Kami siap membantu memberikan rekomendasi treatment homecare terbaik untuk Bunda dan si kecil. Ada yang ingin Bunda tanyakan seputar perawatan kami? 😊`;

    // Guard 1: Terlalu pendek
    if (cleaned.length < 15) {
      return fallbackMsg;
    }

    // Guard 2: Dangling connector di AWAL kalimat
    if (/^(namun|untuk|karena|jadi|tapi|dan|agar|sehingga|atau)[,.\s]/i.test(cleaned)) {
      cleaned = cleaned.replace(/^(namun|untuk|karena|jadi|tapi|dan|agar|sehingga|atau)[,.\s]+/i, '').trim();
      if (cleaned.length > 0) {
        cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
      }
      if (cleaned.length < 15) return fallbackMsg;
    }

    // Guard 3: Dangling connector di AKHIR kalimat (trailing)
    if (/[,\s](namun|untuk|karena|jadi|tapi|dan|agar|sehingga|atau)[,.\s]*$/i.test(cleaned)) {
      cleaned = cleaned.replace(/[,\s]+(namun|untuk|karena|jadi|tapi|dan|agar|sehingga|atau)[,.\s]*$/i, '').trim();
      if (cleaned.length < 15) return fallbackMsg;
    }

    return cleaned;
  }

  /**
   * Menghasilkan balasan FAQ natural beserta reasoning secara stateless (thread-safe).
   */
  public async generateFaqResponseWithDetails(
    userQuestion: string,
    contextChunks: KnowledgeChunkResult[],
    conversationId?: string,
    tenantId?: string,
    treatmentNameForFollowUp?: string,
    customerId?: string
  ): Promise<FAQResponseResult> {
    const contextText = contextChunks.map((c, i) => `[Referensi ${i + 1} - ${c.title}]:\n${c.content}`).join('\n\n');

    if (!this.apiKey || this.apiKey.startsWith('mock')) {
      const fallback = this.fallbackFaqResponse(userQuestion, contextChunks, treatmentNameForFollowUp);
      return { answer: fallback, reasoning: '[MOCK_KEY] Using fallback response' };
    }

    try {
      const res = await measure('LLM_GENERATOR_API_CALL', () =>
        this.llmBreaker.execute(userQuestion, contextText, contextChunks, conversationId, tenantId, treatmentNameForFollowUp, customerId)
      );
      const maxChars = tenantId ? getMaxCharsPerReply(tenantId) : null;
      return {
        answer: truncateToMaxChars(res.answer, maxChars),
        reasoning: res.reasoning,
        extracted_preferences: res.extracted_preferences,
      };
    } catch (error) {
      console.warn('[LLM GENERATOR ERROR] API call failed, using fallback FAQ response:', (error as Error).message);
      const maxChars = tenantId ? getMaxCharsPerReply(tenantId) : null;
      return {
        answer: truncateToMaxChars(this.fallbackFaqResponse(userQuestion, contextChunks, treatmentNameForFollowUp), maxChars),
        reasoning: '[ERROR] API call failed',
      };
    }
  }

  /**
   * Menghasilkan balasan FAQ natural (hanya string jawaban untuk kompatibilitas mundur).
   */
  public async generateFaqResponse(
    userQuestion: string,
    contextChunks: KnowledgeChunkResult[],
    conversationId?: string,
    tenantId?: string,
    treatmentNameForFollowUp?: string,
    customerId?: string
  ): Promise<string> {
    const result = await this.generateFaqResponseWithDetails(
      userQuestion,
      contextChunks,
      conversationId,
      tenantId,
      treatmentNameForFollowUp,
      customerId
    );
    return result.answer;
  }

  private fallbackFaqResponse(userQuestion: string, chunks: KnowledgeChunkResult[], treatmentNameForFollowUp?: string): string {
    let ctaSuffix = treatmentNameForFollowUp && treatmentNameForFollowUp.trim()
      ? `\n\nKalau Bunda berminat, mau langsung saya bantu jadwalkan *${treatmentNameForFollowUp.trim()}*? 😊`
      : `\n\nApakah Bunda tertarik untuk lanjut ke pengisian list reservasi treatment sekarang? 😊`;

    if (chunks.length === 0) {
      return `Kami siap membantu memberikan rekomendasi treatment homecare terbaik untuk Bunda dan si kecil. Ada yang ingin Bunda tanyakan seputar perawatan kami? 😊`;
    }

    // Jalur katalog treatment terstruktur: bangun rekomendasi personal dari fakta data.
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
    return `${text} 😊${ctaSuffix}`;
  }
}

export const llmResponseGenerator = new LLMResponseGenerator();
