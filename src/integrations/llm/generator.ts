import { getWibTimeInfo } from '../../utils/time-wib';
import { BOT_PERSONA_PROMPT, getMaxCharsPerReply, truncateToMaxChars } from '../../config/persona';
import { KnowledgeChunkResult } from '../../services/knowledge.service';
import { CircuitBreaker } from '../../utils/circuit-breaker';
import { llmOutageStorage } from './context';
import { callChatCompletionsWithFallback, getFallbackModel } from './model-fallback';
import { getLlmEndpointConfig } from './llm-gateway';
import { stripNonIndonesianScripts, containsForeignScripts } from '../../utils/language-sanitizer';
import { LLM_HISTORY_LIMIT } from '../../config/llm-context';
import { customerService } from '../../services/customer.service';
import { conversationService } from '../../services/conversation.service';
import { measure } from '../../utils/timer';
import { llmConcurrencyLimiter } from '../../utils/llm-concurrency';
import dotenv from 'dotenv';
import { isAskingClinicLocation } from '../../state-machine/utils/clinic-location-checker';
function isReferentialQuestion(userQuestion: string): boolean {
  if (!userQuestion) return false;
  const q = userQuestion.toLowerCase();
  return /\b(berapa\s+itu|berapa\s+yang\s+tadi|yang\s+itu|yang\s+baru|yang\s+tadi\s+berapa|yang\s+tadi|itu\s+berapa|tadi\s+berapa|berapa\s+harganya\s+yang)\b/i.test(q);
}

export interface FAQResponseResult {
  answer: string;
  reasoning: string | null;
  extracted_preferences?: Record<string, any>;
  /** true jika jawaban bukan dari LLM (fallback darurat / mock-key / error API). */
  usedFallback?: boolean;
}

export class LLMResponseGenerator {
  public llmBreaker: CircuitBreaker<[string, string, KnowledgeChunkResult[], string?, string?, string?, string?, boolean?, string?], FAQResponseResult>;

  constructor() {
    this.llmBreaker = new CircuitBreaker<[string, string, KnowledgeChunkResult[], string?, string?, string?, string?, boolean?, string?], FAQResponseResult>(
      async (
        userQuestion: string,
        contextText: string,
        contextChunks: KnowledgeChunkResult[],
        conversationId?: string,
        tenantId?: string,
        treatmentNameForFollowUp?: string,
        customerId?: string,
        isLocationKnown?: boolean,
        additionalContextText?: string
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
          cacheKey = faqCacheService.generateKey(tenantId || 'default-tenant', userQuestion, contextChunks, contextText, {
            isLocationKnown,
            additionalContextText,
          });
          const cachedVal = await faqCacheService.get(cacheKey);
          if (cachedVal) {
            console.log(`[FAQ CACHE] HIT for query: "${userQuestion}"`);
            const { sanitizeRagLeakage, sanitizeForbiddenEnglishWords } = await import('../../utils/language-sanitizer');
            let sanitizedCache = sanitizeForbiddenEnglishWords(sanitizeRagLeakage(cachedVal));
            return {
              answer: sanitizedCache,
              reasoning: '[CACHE HIT] Served from FaqCacheService',
            };
          }
          console.log(`[FAQ CACHE] MISS for query: "${userQuestion}"`);
        }

        let ctaInstruction = '';
        if (isLocationKnown) {
          if (treatmentNameForFollowUp && treatmentNameForFollowUp.trim()) {
            ctaInstruction = `6. TUGAS WAJIB DI AKHIR KALIMAT: Setelah jawaban inti selesai, tutup dengan ajakan lanjut booking yang MENYATU secara natural dengan konteks jawabanmu. Sebutkan nama treatment "${treatmentNameForFollowUp.trim()}" (contoh: "Mau saya bantu jadwalkan ${treatmentNameForFollowUp.trim()} sekalian, Bunda? 🙏🏻"). DILARANG menanyakan alamat/rumah lagi karena kami sudah tahu.`;
          } else {
            ctaInstruction = '6. TUGAS WAJIB DI AKHIR KALIMAT: Setelah jawaban inti selesai, tutup pesan dengan menanyakan apakah Bunda tertarik lanjut ke reservasi. DILARANG menanyakan alamat/rumah lagi karena kami sudah tahu.';
          }
        } else {
          ctaInstruction = '6. TUGAS WAJIB DI AKHIR KALIMAT: Setelah jawaban inti selesai, Anda WAJIB MENGAKHIRI PESAN dengan menanyakan area/rumah tempat tinggal customer secara ramah (contoh: "Kalau boleh tahu rumahnya di mana ya Bunda? Biar sekalian kami bantu cekkan ketersediaan bidan & ongkir ke tempat Bunda 😊"). DILARANG KERAS menanyakan hal lain (seperti bertanya usia bayi) di akhir kalimat, HARUS menanyakan rumah/daerah. DILARANG KERAS memakai kata "lokasi".';
          if (treatmentNameForFollowUp && treatmentNameForFollowUp.trim()) {
            ctaInstruction = `6. TUGAS WAJIB DI AKHIR KALIMAT: Setelah jawaban inti selesai, tutup dengan ajakan lanjut booking yang MENYATU secara natural dengan konteks jawabanmu. Sebutkan nama treatment "${treatmentNameForFollowUp.trim()}" dan WAJIB tanyakan rumah customer di akhir chat (contoh: "Kalau boleh tahu rumahnya di mana ya Bunda? Biar sekalian kami bantu cekkan ongkirnya untuk treatment ${treatmentNameForFollowUp.trim()} 🙏🏻"). DILARANG KERAS menanyakan hal lain. DILARANG KERAS memakai kata "lokasi".`;
          }
        }

        // Batas maksimal karakter per balasan AI (tenant-aware, dari persona config).
        const maxChars = tenantId ? getMaxCharsPerReply(tenantId) : null;
        const maxCharsInstruction = maxChars && maxChars > 0
          ? `BATAS KARAKTER (WAJIB): Balasan pada bagian JAWABAN TIDAK BOLEH MELEBIHI ${maxChars} karakter. Ringkas, padat, langsung ke inti jawaban, tetap hangat dan ramah. Jangan menulis jawaban yang panjang bertele-tele.`
          : '';

        // Guard CTA anti hard-selling: nama treatment HANYA boleh disebut di CTA
        // jika customer memang sedang membahas treatment itu (bukan dipaksa sistem).
        const antiHardSellNote = `
ATURAN ANTI HARD-SELLING (WAJIB):
- JANGAN menyebut / menjual nama treatment tertentu di CTA jika customer tidak sedang membahas treatment tersebut.
- CTA harus menyatu NATURAL dengan topik yang dibahas customer. Jika sistem belum memberikan nama treatment yang dibahas, jangan menebak — cukup gunakan ajakan yang netral (tanya area/rumah atau ajakan lanjut reservasi yang umum).`;

        ctaInstruction += antiHardSellNote;

        const wibInfo = getWibTimeInfo();

        const additionalContextSection = additionalContextText && additionalContextText.trim().length > 0
          ? `[INFORMASI TAMBAHAN ONGKIR / LOKASI (WAJIB DISAMPAIKAN DALAM BALASAN)]\n${additionalContextText.trim()}\n- Kamu WAJIB menyertakan fakta ongkir/jarak di atas ke dalam jawabanmu secara natural!\n\n`
          : '';

        const systemMessage = {
          role: 'system',
          content: `${BOT_PERSONA_PROMPT}

WAKTU SEKARANG: ${wibInfo.wibTimeString}
DILARANG SAPAAN WAKTU: Ini balasan FAQ / chat lanjutan (bukan greeting pertama). DILARANG KERAS menyertakan sapaan waktu ("Selamat Pagi", "Selamat Siang", "Selamat Sore", "Selamat Malam").

${groundTruthSection}

${conversationContextSection}

${additionalContextSection}TUGAS UTAMA:
Jawab pertanyaan customer tentang informasi/FAQ moms & baby spa berdasarkan Referensi Dokumen berikut:

${contextText ? contextText : '(Tidak ada referensi dokumen spesifik yang ditemukan)'}

ATURAN BALASAN:
1. Tuliskan balasan ramah, santun, dan informatif untuk customer di bagian "answer" (gunakan informasi dari referensi dokumen di atas). Jawab layaknya chat WhatsApp biasa yang mengalir natural. DILARANG KERAS menggunakan frasa kaku pembuka seperti "Berikut jawaban untuk pertanyaan bunda:", "Berikut adalah informasi yang diminta", atau sejenisnya. Langsung ke inti jawaban dengan gaya bahasa ngobrol!
   FORMAT TEKS (WAJIB): WhatsApp hanya mengenali format SATU tanda. Untuk teks tebal pakai SATU bintang (*teks*), DILARANG memakai dua bintang (**teks**) karena markdown ganda akan tampil mentah di WhatsApp. Miring pakai _teks_, coretan ~teks~.
   PENTING: Jika customer menggunakan kata referensial seperti "berapa itu", "berapa yang tadi", "yang itu", "yang baru", dll., WAJIB gunakan info "Treatment yang terakhir dibahas" pada section [KONTEKS PERCAKAPAN] di atas sebagai sumber utama penentuan treatment. Jika section tersebut "Belum ada", baru gunakan konteks dari riwayat percakapan.
2. JIKA pertanyaan customer soal treatment/katalog (misal "pijat ibu hamil", "treatment untuk bayi rewel"): jawab dengan NADA REKOMENDASI PERSONAL seperti menyarankan ke teman, BUKAN membacakan daftar/katalog kaku. Sebutkan SEMUA treatment relevan yang ada di Referensi sebagai opsi, lalu akhiri dengan menawarkan bantuan memilih/menjadwalkan.
3. JIKA ada LEBIH DARI SATU treatment relevan di Referensi: sebutkan SEMUANYA (jangan pilih satu secara sepihak tanpa alasan) — tetap dengan nada rekomendasi.
4. JIKA TIDAK ADA treatment/data yang relevan dengan pertanyaan di Referensi: berikan penjelasan pelayanan homecare yang Bunda cari secara ramah dan profesional. DILARANG HARAM mengucapkan "tanya ke tim kami", "mau saya cekkan ke tim dulu", atau "tidak bisa memastikan harganya".
5. JIKA pertanyaan customer berisi referensi ke treatment yang baru saja dibahas (misal "berapa itu", "yang tadi berapa"): langsung jawab dengan harga treatment tersebut berdasarkan Referensi. JANGAN mengulang penjelasan treatment, LANGSUNG kasih harganya.
6. PENGECUALIAN SEMPIT UNTUK KLARIFIKASI NAMA (BUKAN "tidak tahu"):
   JIKA nama/istilah yang disebut customer secara fuzzy match ke 2 ATAU LEBIH item BERBEDA di Referensi Dokumen (nama treatment berbeda, dengan harga ATAU durasi ATAU target usia yang berbeda satu sama lain), DAN memilih salah satu secara sepihak berisiko memberi info yang salah ke customer:
   Anda BOLEH bertanya balik SATU KALI untuk memastikan item mana yang dimaksud, dengan menyebutkan SEMUA nama kandidat secara eksplisit dari Referensi (bukan bertanya generik "maksudnya yang mana ya?").
   Contoh benar: "Bunda maksudnya *Paket Spa Silver* (150rb, 60 menit) atau *Paket Spa Gold* (250rb, 90 menit) ya? Biar saya kasih info yang pas 😊"
   Contoh SALAH (tetap dilarang): "Untuk harga pastinya, boleh tanya ke tim kami dulu ya" — ini BUKAN klarifikasi nama, ini cuci tangan, TETAP dilarang.
   Pengecualian ini TIDAK berlaku jika Referensi hanya punya SATU item yang match, atau jika customer menanyakan kebutuhan umum (bukan menyebut nama spesifik) — untuk kasus itu tetap ikuti poin 2 & 3 (mode rekomendasi, sebutkan semua opsi relevan sekaligus, bukan tanya balik).
7. ATURAN SAPAAN (DILARANG SAPAAN WAKTU DAN GREETING HEADER): Ini adalah balasan FAQ/informasi lanjutan. DILARANG KERAS menyertakan sapaan waktu ("Selamat Pagi", "Selamat Siang", "Selamat Sore", "Selamat Malam"). DILARANG mengulangi greeting header ("Halo Bunda! Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi...") karena greeting header sudah ditambahkan otomatis oleh sistem di depan pesanmu. Langsung jawab ke inti pertanyaan.
8. ATURAN PERTANYAAN USIA UMUM (GENERAL WELLNESS):
   Jika customer menanyakan rekomendasi treatment untuk usia tertentu secara UMUM (contoh: "Untuk anak umur 17 bulan yg mana yaa", "buat anak 2 tahun treatment apa"), TANPA menyebutkan keluhan batuk, pilek, demam, kolik, atau sakit:
   - ARAHKAN KE TREATMENT UMUM/RELAKSASI: Cukup rekomendasikan treatment kebugaran/relaksasi standar untuk usianya (misal *Pijat Bayi Ceria* untuk bayi/balita di bawah 2 tahun, *Pijat Kids Ceria* untuk anak di atas 2 tahun, serta *Pijat Lahap Juara* untuk nafsu makan).
   - DILARANG KERAS berinisiatif menawarkan terapi penyakit / alat medis (seperti Nebulizer, Sinar Moksa, Terapi Bapil/Pulih Ceria) jika customer TIDAK menceritakan keluhan batuk, pilek, demam, atau sesak napas!
9. ATURAN BIAYA ONGKIR / TRANSPORT HOMECARE MULTI-ANAK ATAU MULTI-TREATMENT:
    Biaya transport/ongkir homecare dihitung PER KEDATANGAN / PER KUNJUNGAN (per alamat), BUKAN per anak atau per treatment. Jika customer bertanya apakah untuk 2 anak / 2 treatment / bunda + anak ongkirnya hanya 1 kali (contoh: "Untuk 2 anak transportnya 1 kan"), WAJIB konfirmasi dengan ramah bahwa ongkirnya tetap dihitung 1 kali saja per kunjungan.
10. ATURAN PEMETAAN KELUHAN & GEJALA SPESIFIK (WAJIB COCOK DENGAN REFERENSI DOKUMEN KLINIK):
    Jika customer menceritakan keluhan / gejala spesifik si kecil, WAJIB rekomendasikan treatment yang fungsinya SESUAI dengan deskripsi resmi klinik:
    - KELUHAN KEMBUNG, KOLIK, SUSAH BAB / SEMBELIT, BATUK PILEK (BAPIL), REWEL:
      * Treatment utama yang TEPAT adalah *Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)* (menggunakan teknik terapi khusus kembung/bapil dan double aromaterapi).
      * DILARANG KERAS menyuruh ambil *Pijat Bayi Ceria* / *Pijat Kids Ceria* untuk mengatasi kembung/kolik/bapil, karena *Pijat Ceria* adalah pijat relaksasi tidur nyenyak/kebugaran umum tanpa formula terapi!
      * Terapi *Sinar Moksa* atau *Nebulizer*: adalah add-on terapi pernapasan/dada untuk batuk, pilek, dahak lendir, dan hidung tersumbat (bukan untuk perut kembung). Jika anak kembung tanpa batuk pilek, jelaskan bahwa treatment intinya adalah Pijat Pulih Ceria, sedangkan Sinar Moksa sifatnya tambahan untuk pernapasan jika ada batuk pilek.
    - KELUHAN SUSAH MAKAN / GTM:
      * Treatment yang tepat adalah *Pijat Lahap Juara*.
11. ATURAN PENGGUNAAN "Bunda" vs "bund" & BAHASA:
    - "Bunda" (huruf kapital) dipakai sebagai kata ganti/sapaan utama ("untuk Bunda", "jadwal Bunda").
    - DILARANG menulis "untuk bund", "ke bund", "dari bund", "cocok untuk bund" (WAJIB "untuk Bunda", "ke Bunda", "cocok untuk Bunda").
    - DILARANG menggunakan kata kaku/baku seperti "Syukur sekali", "Puji syukur", "Alangkah baiknya", "Kiranya".
    - DILARANG menggunakan kata asing seperti "appointment" / "appointment-nya" (gunakan "jadwal reservasi" atau "jadwalnya").
${ctaInstruction}

${maxCharsInstruction}

ATURAN ANTI-HALUSINASI (WAJIB):
- HANYA gunakan fakta yang ADA di Referensi Dokumen di atas (nama treatment, usia/kategori target, durasi, deskripsi manfaat).
- DILARANG menambah/mengarang harga, durasi, usia, manfaat, atau detail treatment apa pun yang TIDAK tercantum di Referensi.
- DILARANG HARAM mengucapkan frasa "tanya ke tim kami", "saya tidak bisa memastikan harganya", "bisa langsung tanya ke tim", "mau kami cekkan ke tim dulu", "nanti saya kabari", atau kalimat sejenis yang menunjukkan bot tidak tahu/cuci tangan.
- Untuk info riwayat/status layanan customer, HANYA gunakan data di section [DATA CUSTOMER (GROUND TRUTH)] di atas. JANGAN mengambil fakta soal riwayat layanan dari [RIWAYAT PERCAKAPAN] meskipun customer menyebutkannya di sana — kalau ada perbedaan, section Ground Truth yang benar.

FORMAT RESPONS (WAJIB JSON, jangan ada teks di luar JSON):
{
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
        const endpoint = getLlmEndpointConfig({ model: modelConfig.modelName });
        let callResult: Awaited<ReturnType<typeof callChatCompletionsWithFallback>>;
        try {
          // Antrean concurrency limiter: mencegah burst request (beban tinggi / stres tes)
          // memicu 429 rate-limit yang membuat Circuit Breaker ikut terbuka massal.
          callResult = await llmConcurrencyLimiter.run(() =>
            callChatCompletionsWithFallback({
              baseUrl: endpoint.baseUrl,
              apiKey: endpoint.apiKey,
              model: modelConfig.modelName,
              fallbackModel: endpoint.fallbackModel,
              timeoutMs: endpoint.timeoutMs,
              payload: {
                temperature: modelConfig.temperature,
                max_tokens: modelConfig.maxTokens,
                response_format: { type: 'json_object' },
                messages: apiMessages,
              },
            })
          );
        } catch (err: any) {
          try {
            const { auditLlmCall } = await import('../../utils/llm-audit-buffer');
            auditLlmCall({
              tenant_id: tenantId,
              customer_phone: customerId || 'unknown',
              conversation_id: conversationId,
              task_type: 'CHAT_REPLY',
              model_name: modelConfig.modelName,
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

        const content = responseData?.choices?.[0]?.message?.content ?? '';
        
        if (!content || content.trim() === '') {
          console.error('[LLM GENERATOR] Empty content from LLM response, falling back.');
          throw new Error('Empty content from LLM JSON output');
        }
        
        let parsed: { reasoning?: string; answer?: string; referenced_treatment?: string | null; needs_clarification?: boolean; extracted_preferences?: Record<string, any> };
        try {
          let cleanContent = content.trim();
          if (cleanContent.startsWith('```')) {
            cleanContent = cleanContent.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '').trim();
          }
          parsed = JSON.parse(cleanContent);
        } catch (err) {
          // Respons JSON terpotong (mis. max_tokens habis). JANGAN men-leak raw text
          // (berisi sintaks kurung kurawal) ke customer. Coba ekstrak nilai "answer"
          // via regex; jika tidak ketemu → biarkan kosong agar jatuh ke fallback darurat.
          console.warn('[LLM GENERATOR] Failed to parse JSON response, extracting "answer" via regex. Raw content (truncated):', content.slice(0, 300));
          const extractedAnswer = this.extractAnswerFromPartialJson(content);
          if (extractedAnswer && extractedAnswer.length > 0 && !extractedAnswer.trim().startsWith('{')) {
            parsed = { answer: extractedAnswer, reasoning: '[SOFT FALLBACK] JSON parse failed, answer extracted via regex' };
          } else if (content && content.trim().length >= 15 && !content.trim().startsWith('{')) {
            console.log('[LLM GENERATOR] Plain text response detected (non-JSON model output), using content directly.');
            parsed = { answer: content.trim(), reasoning: '[PLAIN TEXT FALLBACK] Non-JSON LLM response' };
          } else {
            console.error('[LLM GENERATOR] JSON parse failed & no clean "answer" chunk recovered — falling back to emergency response.');
            parsed = { answer: '', reasoning: '[SOFT FALLBACK] JSON parse failed, no answer chunk' };
          }
        }

        if (!parsed.answer || parsed.answer.trim() === '') {
          console.error('[LLM GENERATOR] Parsed JSON has empty answer field, falling back.');
          throw new Error('Empty answer from LLM JSON output');
        }

        let jawaban = parsed.answer.trim();

        // Sanitizer: Bersihkan jika LLM tidak sengaja menghasilkan frasa "tanya ke tim / tidak bisa memastikan harga"
        jawaban = this.sanitizeTeamReferral(jawaban);

        // Sanitizer RAG Leakage & Kata Bahasa Inggris terlarang ("little one", "baby", "mommy", "schedule")
        const { sanitizeRagLeakage, sanitizeForbiddenEnglishWords } = await import('../../utils/language-sanitizer');
        jawaban = sanitizeForbiddenEnglishWords(sanitizeRagLeakage(jawaban));

        // Sanitizer aksara asing (CJK/Kanji/Jepang/Korea/Rusia) yang bocor dari model
        const sanitizedJawaban = stripNonIndonesianScripts(jawaban);
        if (sanitizedJawaban !== jawaban) {
          console.warn(
            `[LLM GENERATOR] Karakter aksara asing bocor, di-bersihkan: ` +
              `"${containsForeignScripts(jawaban) ? jawaban : ''}".`
          );
          jawaban = sanitizedJawaban;
        }

        // ENFORCE CTA: Jika lokasi/rumah customer BELUM diketahui, pastikan pesan DIUTAMAKAN menutup dengan pertanyaan rumah.
        if (isLocationKnown === false) {
          const asksLocation = /\b(rumah|rumahnya|daerah|kelurahan|kecamatan|area)\b/i.test(jawaban);
          if (!asksLocation) {
            // Jika LLM lupa menanyakan rumah dan malah menutup dengan "Mau saya bantu jadwalkan?",
            // ubah atau tambahkan pertanyaan rumah secara otomatis.
            if (/\bmau\s+saya\s+bantu\s+(?:jadwalkan|pilih|booking).*?\?\s*🙏🏻?😊?/gi.test(jawaban)) {
              jawaban = jawaban.replace(
                /\bmau\s+saya\s+bantu\s+(?:jadwalkan|pilih|booking).*?\?\s*🙏🏻?😊?/gi,
                'Kalau boleh tahu rumahnya di mana ya Bunda? Biar sekalian kami bantu cekkan ketersediaan bidan & ongkir ke tempat Bunda 😊'
              );
            } else if (!jawaban.includes('rumahnya di mana')) {
              jawaban = `${jawaban}\n\nKalau boleh tahu rumahnya di mana ya Bunda? Biar sekalian kami bantu cekkan ketersediaan bidan & ongkir ke tempat Bunda 😊`;
            }
          }
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
        customerId?: string,
        isLocationKnown?: boolean
      ) => {
        return {
          answer: this.fallbackFaqResponse(userQuestion, contextChunks, treatmentNameForFollowUp),
          reasoning: '[FALLBACK] LLM error or breaker open',
          usedFallback: true,
        };
      },
      { name: 'LLM Generator', failureThreshold: 0.7, slidingWindowSize: 20, cooldownPeriodMs: 60000 }
    );
  }

  /**
   * Ekstrak nilai field "answer" dari respons JSON yang TERPOTONG (max_tokens habis
   * di tengah serialisasi). Memakai regex (bukan JSON.parse) agar tahan terhadap
   * sintaks JSON yang belum selesai. Return '' jika "answer" tidak ditemukan / ikut
   * terpotong (tidak ada penutup kutip) — pemanggil harus menggunakan fallback darurat.
   */
  private extractAnswerFromPartialJson(content: string): string {
    if (!content) return '';
    const match = content.match(/"answer"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (!match) return '';
    return match[1]
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .trim();
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
    customerId?: string,
    isLocationKnown?: boolean,
    additionalContextText?: string
  ): Promise<FAQResponseResult> {
    const contextText = contextChunks.map((c, i) => `[Referensi ${i + 1} - ${c.title}]:\n${c.content}`).join('\n\n');

    const endpoint = getLlmEndpointConfig({ model: undefined });
    if (!endpoint.apiKey || endpoint.apiKey.startsWith('mock')) {
      const fallback = this.fallbackFaqResponse(userQuestion, contextChunks, treatmentNameForFollowUp);
      return { answer: fallback, reasoning: '[MOCK_KEY] Using fallback response', usedFallback: true };
    }

    try {
      const res = await measure('LLM_GENERATOR_API_CALL', () =>
        this.llmBreaker.execute(userQuestion, contextText, contextChunks, conversationId, tenantId, treatmentNameForFollowUp, customerId, isLocationKnown, additionalContextText)
      );
      const maxChars = tenantId ? getMaxCharsPerReply(tenantId) : null;
      return {
        answer: truncateToMaxChars(res.answer, maxChars),
        reasoning: res.reasoning,
        extracted_preferences: res.extracted_preferences,
        usedFallback: res.usedFallback,
      };
    } catch (error) {
      console.warn('[LLM GENERATOR ERROR] API call failed, using fallback FAQ response:', (error as Error).message);
      const maxChars = tenantId ? getMaxCharsPerReply(tenantId) : null;
      return {
        answer: truncateToMaxChars(this.fallbackFaqResponse(userQuestion, contextChunks, treatmentNameForFollowUp), maxChars),
        reasoning: '[ERROR] API call failed',
        usedFallback: true,
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
    customerId?: string,
    isLocationKnown?: boolean,
    additionalContextText?: string
  ): Promise<string> {
    const result = await this.generateFaqResponseWithDetails(
      userQuestion,
      contextChunks,
      conversationId,
      tenantId,
      treatmentNameForFollowUp,
      customerId,
      isLocationKnown,
      additionalContextText
    );
    return result.answer;
  }

  private fallbackFaqResponse(userQuestion: string, chunks: KnowledgeChunkResult[], treatmentNameForFollowUp?: string): string {
    if (chunks.length === 0) {
      // Tidak ada data → jangan kirim pesan apology/apology antrean. Kembalikan kosong;
      // pemanggil (interest.ts) akan eskalasi senyap ke antrean human handling.
      return '';
    }

    // Jalur katalog treatment terstruktur: bangun rekomendasi personal dari fakta data.
    // AMAN — data terstruktur dari DB catalog, bukan echo RAG mentah.
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

    // Jalur FAQ lokasi klinik / homebase: jawab factual lokasi Waru + Homecare
    if (firstChunk.id === 'clinic-location-faq' || isAskingClinicLocation(userQuestion)) {
      return `Kami berlokasi di daerah Waru (perbatasan Sidoarjo - Surabaya), Bunda. Kami melayani sistem Homecare (panggilan langsung ke rumah), jadi tim bidan kami yang akan datang langsung ke rumah Bunda 😊\n\nKalau boleh tahu untuk rumah Bunda di kelurahan mana ya bund? Biar sekalian kami bantu cekkan ketersediaan jadwal & ongkirnya 🙏`;
    }

    // Jalur RAG/FAQ mentah (non-catalog) TIDAK lagi di-echo verbatim ke customer.
    // Chunk yang terambil bisa generic/nyasar (mis. pertanyaan spesifik "usia minimal"
    // match ke chunk umum "bayi baru lahir sampai beberapa tahun") → berisiko memberi
    // info medis yang keliru. Saat AI gagal, jangan kirim pesan apology — kembalikan
    // kosong agar pemanggil mengeskalasi ke antrean human handling.
    return '';
  }
}

export const llmResponseGenerator = new LLMResponseGenerator();
