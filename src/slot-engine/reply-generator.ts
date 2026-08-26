import { CustomerSlate, ExtractedEntities, GroundingPackage } from './types';
import { callChatCompletionsWithFallback } from '../integrations/llm/model-fallback';
import { getLlmEndpointConfig } from '../integrations/llm/llm-gateway';
import { AiModelConfigService } from '../config/ai-models.config';
import { DEFAULT_TENANT_ID } from '../config/tenant';

/**
 * Sanitizer Format Deterministik (0 Token):
 * Membersihkan spasi Rp, memperbaiki kata menempel, dan menjamin emoji senyum hangat.
 */
export function sanitizeFinalReply(text: string): string {
  let cleaned = text
    .replace(/\*\*([^*]+)\*\*/g, '*$1*') // Ubah **teks** menjadi *teks* standar WhatsApp
    .replace(/([a-zA-Z])(Rp\s*[\d.]+)/g, '$1 $2') // Spasi antara huruf dan Rp
    .replace(/Rp\s*(\d)/g, 'Rp $1') // Standar "Rp 25.000"
    .replace(/\bUntukjarak\b/gi, 'Untuk jarak')
    .replace(/\bDarijarak\b/gi, 'Dari jarak')
    .replace(/\bJadi\s+bisa\s+ya[,\s]+Bunda\s*[☺️😊]?\s*Jadi\s+/gi, 'Jadi ')
    .replace(/\b(?:Insya\s*Allah|Alhamdulillah|Bismillah|Puji\s*Tuhan)\b[,.\s]*/gi, '') // Netralitas agama
    .replace(/\b(?:Btw|btw)\b[,.\s]*/gi, 'Kalau boleh tahu, ') // Hapus slang
    .replace(/\bBinti\b/g, 'Bunda') // Perbaiki typo halusinasi nama
    .replace(/\b(?:Aduh\s+)?maaf\s+dengar\b/gi, 'Tidak perlu khawatir ya Bunda') // Perbaiki terjemahan kaku bahasa Inggris
    .replace(/\baku\s+(cek|bantu|jadwalkan|sarankan)\b/gi, 'kami $1') // Ganti aku -> kami
    .replace(/\bmenyembuhkan\b/gi, 'membantu meredakan') // Anti-overclaim
    .replace(/\bmembuat\s+(si\s+kecil|adik|bayi|anak)\s+tidur\s+(?:lebih\s+)?pulas\b/gi, 'membantu $1 tidur lebih nyaman') // Anti-overclaim
    .replace(/\bpasti\s+sembuh\b/gi, 'membantu proses pemulihan') // Anti-overclaim
    .replace(/\bmenghilangkan\s+(batuk|pilek|grok-grok|lendir)\b/gi, 'membantu melegakan $1') // Anti-overclaim
    .replace(/\bdiformulasi\s+khusus\b/gi, 'khusus')
    .replace(/[\u4e00-\u9fa5\u3040-\u30ff]/g, '') // Bersihkan aksara asing jika ada
    .trim();

  // Jamin setidaknya ada 1 emoji senyum hangat jika belum ada emoji sama sekali
  if (!/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[😊☺️🥰🌸]/u.test(cleaned)) {
    cleaned = `${cleaned} 😊`;
  }

  return cleaned;
}

export class ReplyGenerator {
  /**
   * Menghasilkan balasan percakapan hangat Bidan Yusi dalam 1 kali LLM Call (Single-Pass).
   */
  public static async generate(
    slate: CustomerSlate,
    extraction: ExtractedEntities,
    grounding: GroundingPackage,
    context?: {
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
      customerPhone?: string;
      customerInput?: string;
      tenantId?: string;
    }
  ): Promise<string> {
    const tenantId = context?.tenantId || DEFAULT_TENANT_ID;
    const modelConfig = AiModelConfigService.getModelConfig('CHAT_REPLY', tenantId);
    const endpoint = getLlmEndpointConfig();

    // Fallback template jika LLM offline
    const baselineFallback = `Halo Bunda ${slate.name || ''}! Terima kasih sudah menghubungi Kala Moms and Baby Spa. Ada yang bisa kami bantu untuk si kecil hari ini? 😊`;

    if (!endpoint.apiKey) {
      return sanitizeFinalReply(baselineFallback);
    }

    // 1. Format Fakta Ongkir
    const deliveryText = grounding.deliveryFacts
      ? `• Lokasi Terkonfirmasi: ${grounding.deliveryFacts.kelurahan} (Jarak ~${grounding.deliveryFacts.distanceKm} km)\n• Tarif Ongkir Normal: Rp ${grounding.deliveryFacts.ongkirNormal?.toLocaleString('id-ID')}\n• Tarif Ongkir Promo: Rp ${grounding.deliveryFacts.ongkirPromo?.toLocaleString('id-ID')} (Gunakan harga promo ini ke Bunda!)`
      : '• Lokasi: Belum diketahui secara presisi.';

    // 2. Format Fakta Usia & Layanan Rekomendasi (Bukan untuk di-dump sebagai daftar harga)
    const ageText = slate.childAgeMonths !== null
      ? `• Usia Anak: ${slate.childAgeMonths} bulan (${slate.childAgeCategory})`
      : '• Usia Anak: Belum diketahui.';

    const preferencesText = grounding.customerPreferencesText
      ? `• ${grounding.customerPreferencesText}\n`
      : '';

    const catalogText = grounding.filteredCatalog
      .map((s) => {
        const dur = s.durationMinutes ? ` (Durasi: ~${s.durationMinutes} menit)` : '';
        const desc = s.description ? `: ${s.description}` : '';
        return `- ${s.name}${dur}${desc}`;
      })
      .join('\n');

    const faqsSection = grounding.relevantFaqs && grounding.relevantFaqs.length > 0
      ? `\nFAKTA FAQ RESMI DARI DATABASE KLINIK (SUMBER KEBENARAN MUTLAK):\n` +
        grounding.relevantFaqs.map((f) => `• ${f.title}\n  ${f.content}`).join('\n\n') + '\n'
      : '';

    // 3. Format Instruksi Pertanyaan Penutup (Hanya 1 Pertanyaan Mengalir Alami)
    let slotPromptInstruction = 'Tanyakan dengan santun: "Mau kami bantu jadwalkan kunjungan Bidan ke rumah untuk si kecil, Bunda? 😊"';
    if (grounding.missingSlotsToPrompt === 'LOCATION') {
      slotPromptInstruction = 'Tanyakan di kalimat penutup: "Kalau boleh tahu, rumah Bunda di daerah atau kelurahan mana yaa agar bisa kami bantu jadwalkan kunjungan Bidan ke rumah? 😊"';
    } else if (grounding.missingSlotsToPrompt === 'AGE') {
      slotPromptInstruction = 'Tanyakan di kalimat penutup: "Kalau boleh tahu, berapa usia si kecil saat ini ya Bunda agar rekomendasinya tepat? 😊"';
    } else if (grounding.missingSlotsToPrompt === 'TREATMENT_CHOICE') {
      slotPromptInstruction = 'Tawarkan treatment terbaik dan tanyakan di kalimat penutup: "Mau kami bantu jadwalkan kunjungan Bidan ke rumah untuk si kecil, Bunda? 😊"';
    } else if (grounding.missingSlotsToPrompt === 'RESERVATION_DETAILS') {
      slotPromptInstruction = 'Tanyakan preferensi waktu di kalimat penutup: "Bunda lebih nyaman dikunjungi Bidan kami hari apa dan jam berapa yaa? 😊"';
    }

    const systemPrompt = `Anda adalah Bidan Yusi, bidan resmi dan konsultan ramah dari Kala Moms and Baby Spa.
Tugas Anda adalah merangkai balasan WhatsApp yang tenang, hangat, santun, dan profesional (seperti bidan senior yang mengayomi, BUKAN admin e-commerce atau CS kaku).

FAKTA GROUNDING RESMI (SUMBER KEBENARAN MUTLAK - DILARANG MENGARANG DATA DI LUAR INI):
- Asal Klinik: ${grounding.clinicFacts.homebase} (${grounding.clinicFacts.coverage}).
${deliveryText}
${ageText}
${preferencesText}- Layanan yang Cocok untuk Usia Pasien:
${catalogText}
${faqsSection}
PANDUAN OPERASIONAL & KLINIS RESMI:
- DURASI STANDAR LAYANAN (WAJIB GUNAKAN ANGKA INI):
  * Pijat Bayi / Baby (0-24 bulan): ~40 menit per anak.
  * Pijat Anak / Kids (>2-8 tahun): ~45 menit per anak.
  * Pijat Ibu Hamil / Nifas / Oksitosin Fullbody: ~60 menit.
  * Layanan Cukur / Tindik Bayi: ~15 menit.
  * Paket Laktasi: ~50-55 menit (Pijat punggung ~30 menit + Pijat payudara ~20-25 menit).
- Batuk / Pilek / Grok-grok -> Sangat dianjurkan *Pijat Pulih Ceria* dikombinasikan dengan *Sinar Moksa* (terapi inframerah hangat aman untuk melonggarkan lendir/saluran napas).
- Kembung / Kolik / Sembelit -> Dianjurkan *Pijat Pulih Ceria* dengan teknik pijat ILU perut.
- Rewel / Capek / Susah Tidur -> Dianjurkan *Pijat Bayi Ceria* atau *Pijat Anak Ceria* untuk relaksasi otot.

ATURAN ANTI-OVERCLAIM MEDIS (SANGAT KETAT):
- Seluruh layanan pijat dan terapi bersifat SUPORTIF & KOMPLEMENTER (tugasnya adalah MEMBANTU proses pemulihan dan kenyamanan, BUKAN menyembuhkan secara instan).
- DILARANG KERAS menggunakan kata klaim kuratif/absolut seperti "menyembuhkan", "pasti sembuh", "membuat tidur pulas", "menghilangkan batuk", atau "menjamin".
- WAJIB gunakan kata kerja suportif: "membantu meredakan", "membantu melegakan saluran napas", "membantu si kecil tidur lebih nyaman/nyenyak", "membantu relaksasi otot", "membantu mengatasi kembung".

ATURAN KOMUNIKASI & PERSONA BIDAN YUSI (SANGAT KETAT):
1. Panggil customer HANYA dengan "Bunda" atau "bund" (DILARANG mengarang nama seperti "Binti", "Kak", "Sis"). Maksimal 1-2x sapaan per pesan.
2. KATA GANTI STAF: Selalu gunakan "kami" atau "Bidan" (DILARANG KERAS menggunakan kata "aku" atau "saya pribadi").
3. DILARANG KERAS menggunakan bahasa gaul/slang ("Btw", "fyi", "guys").
4. DILARANG KERAS menggunakan terjemahan kaku bahasa Inggris seperti "Aduh maaf dengar", "diformulasi khusus", atau mengulang kata "terapinya suportif".
5. Bicaralah secara tenang dan menenangkan: "Tidak perlu khawatir ya Bunda, di usia 2 bulan saluran cerna dan napas si kecil memang masih beradaptasi...".
6. DILARANG KERAS membuat bullet-point / daftar menu harga di dalam chat teks.
7. FORMAT WHATSAPP: Gunakan HANYA satu bintang *teks* untuk cetak tebal (DILARANG **teks**).
8. DILARANG KERAS menggunakan kata-kata keagamaan ("InsyaAllah", "Alhamdulillah", "Bismillah").
9. SINGKAT & PADAT: Panjang balasan maksimal 2-3 kalimat saja dalam 1 paragraf rapi.
10. DI AKHIR PESAN: ${slotPromptInstruction} (WAJIB TEPAT 1 PERTANYAAN).
11. Gunakan tepat satu emoji senyum hangat 😊 di akhir.

CONTOH GAYA BALASAN EMAS BIDAN YUSI (IKUTI NADA & STRUKTUR INI):
"Tidak perlu khawatir ya Bunda, di usia 2 bulan saluran napas dan cerna si kecil memang masih beradaptasi sehingga grok-grok dan gumoh itu wajar terjadi 😊 Untuk membantu melegakan napas dan meredakan kembungnya, kami sangat menyarankan *Pijat Pulih Ceria* dikombinasikan dengan terapi hangat *Sinar Moksa*. Kalau boleh tahu, rumah Bunda di daerah atau kelurahan mana yaa agar bisa kami bantu jadwalkan kunjungan Bidan ke rumah? 😊"`;

    const historyContext = context?.history && context.history.length > 0
      ? `\nRIWAYAT CHAT SEBELUMNYA:\n${context.history.slice(-4).map((h) => `${h.role}: ${h.content}`).join('\n')}`
      : '';

    const userContent = `${historyContext}\n\nPESAN TERBARU BUNDA:\n"${context?.customerInput || ''}"\n\nBalas dengan ramah sebagai Bidan Yusi:`;

    const startedAt = Date.now();
    try {
      const callResult = await callChatCompletionsWithFallback({
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey,
        model: modelConfig.modelName || 'MiniMax-M2.7-highspeed',
        fallbackModel: endpoint.fallbackModel,
        timeoutMs: endpoint.timeoutMs || 25000,
        payload: {
          temperature: 0.6,
          max_tokens: 500,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
        },
      });

      const responseData = callResult.data;
      const rawReply = responseData?.choices?.[0]?.message?.content || baselineFallback;
      const finalReply = sanitizeFinalReply(rawReply);

      try {
        const { auditLlmCall } = await import('../utils/llm-audit-buffer');
        auditLlmCall({
          customer_phone: context?.customerPhone || 'unknown',
          tenant_id: context?.tenantId,
          task_type: 'SLOT_GENERATOR',
          model_name: callResult.model,
          baseUrl: callResult.baseUrl,
          startedAt,
          usage: callResult.data?.usage,
        });
      } catch {}

      try {
        const { recordLlmExecution } = await import('../utils/llm-execution-logger');
        recordLlmExecution({
          flowType: 'SLOT_GENERATOR',
          customerPhone: context?.customerPhone || 'unknown',
          customerInput: context?.customerInput || '',
          promptPayload: { systemPrompt, userContent },
          reasoning: `Single-pass reply generated | Grounding facts: [Loc: ${grounding.deliveryFacts?.kelurahan || '-'}, Age: ${slate.childAgeMonths} bln]`,
          rawReasoning: rawReply,
          groundTruthUsed: grounding,
          finalReply,
          modelUsed: callResult.model || modelConfig.modelName,
          durationMs: Date.now() - startedAt,
          status: 'SUCCESS',
        });
      } catch {}

      return finalReply;
    } catch (err: any) {
      console.warn('[REPLY GENERATOR ERROR] LLM generation failed, using fallback:', err.message);
      try {
        const { auditLlmCall } = await import('../utils/llm-audit-buffer');
        auditLlmCall({
          customer_phone: context?.customerPhone || 'unknown',
          tenant_id: context?.tenantId,
          task_type: 'SLOT_GENERATOR',
          model_name: modelConfig.modelName || 'MiniMax-M2.7-highspeed',
          baseUrl: endpoint.baseUrl,
          startedAt,
          error: { message: err?.message },
        });
      } catch {}
      return sanitizeFinalReply(baselineFallback);
    }
  }
}
