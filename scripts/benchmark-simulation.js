const dotenv = require('dotenv');
dotenv.config();
const axios = require('axios');
const fs = require('fs');

const baseUrl = process.env.OPENAI_BASE_URL || 'https://ai.sumopod.com/v1';
const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;

const { SlateStore } = require('../dist/slot-engine/slate-store');
const { EntityExtractor } = require('../dist/slot-engine/entity-extractor');
const { GroundingComposer } = require('../dist/slot-engine/grounding-composer');
const { sanitizeFinalReply } = require('../dist/slot-engine/reply-generator');
const { extractJsonContent } = require('../dist/utils/json-extract');

const prompt1 = `Anaknya usia 2 bulan\nNafasnya grok grok terus\nSering kembung\nSama gumoh`;
const prompt2 = `Mau tanya, kalau nb 3 Minggu apa sudah boleh dipijat?`;

const candidateModels = [
  { name: 'MiniMax-M2.7-highspeed', label: 'MiniMax M2.7 Highspeed' },
  { name: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { name: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
];

async function runBenchmarkForModel(modelObj, promptText, caseName, runs = 5) {
  console.log(`\n======================================================`);
  console.log(`🚀 RUNNING BENCHMARK: [${modelObj.label}] - Case: ${caseName}`);
  console.log(`Prompt:\n"${promptText}"`);
  console.log(`======================================================`);

  const results = [];

  for (let i = 1; i <= runs; i++) {
    const iterationStart = Date.now();

    // 1. Mock context & Slate
    const mockCtx = {
      customer: {
        id: 'test_cust_' + i,
        phone: '6288235780925',
        name: 'Bunda',
        tenant_id: 'tenant_default',
        kelurahan: 'Pradah Kalikendal',
        kecamatan: 'Dukuh Pakis',
        kota: 'Kota Surabaya',
        lat: -7.281,
        lng: 112.684,
        pricelist_sent: true,
        preferences: {
          distanceKm: 16.99,
          ongkirPromoFee: 20000,
          ongkirFee: 25000,
        },
      },
      conversation: {
        id: 'conv_' + i,
        current_state: 'AWAITING_INTEREST',
        is_human_handling: false,
      },
      tenantId: 'tenant_default',
    };

    const slate = SlateStore.hydrateSlate(mockCtx);

    // 2. Extractor Call
    const extractStart = Date.now();
    const deterministic = EntityExtractor.preExtractDeterministic(promptText);

    const systemPromptExtractor = `Anda adalah NLU Semantic Parser klinis untuk WhatsApp Mom & Baby Home Care Clinic (Bidan Yusi).
Tugas Anda adalah mengekstrak SEMUA entitas, keluhan, dan intensi dari pesan customer dalam format JSON terstruktur.

DAFTAR INTENTS: provide_location, supplement_address, provide_age, consult_symptom, ask_price, ask_clinic_origin, select_treatment, request_booking, affirmation, negation, medical_emergency, chitchat.

ATURAN:
1. Konversi usia ke total bulan pada child_age_months ("2 bulan" -> 2, "3 minggu" -> 0.75).
2. Tangkap semua keluhan fisik/anak ke array symptoms.

OUTPUT WAJIB JSON VALID:
{
  "intents": ["provide_age", "consult_symptom"],
  "location_text": null,
  "street_detail": null,
  "child_age_months": number | null,
  "symptoms": ["grok-grok", "kembung"],
  "treatment_referenced": null,
  "preferred_date_text": null,
  "preferred_time_text": null,
  "customer_name": null,
  "is_medical_emergency": false,
  "confidence_score": 0.95
}`;

    let extraction = {
      intents: deterministic.intents || ['consult_symptom'],
      locationText: deterministic.locationText || null,
      streetDetail: deterministic.streetDetail || null,
      childAgeMonths: deterministic.childAgeMonths || null,
      symptoms: deterministic.symptoms || [],
      treatmentReferenced: deterministic.treatmentReferenced || null,
      preferredDateText: deterministic.preferredDateText || null,
      preferredTimeText: deterministic.preferredTimeText || null,
      customerName: deterministic.customerName || null,
      isMedicalEmergency: deterministic.isMedicalEmergency || false,
      confidenceScore: 0.95,
    };

    try {
      const respExt = await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model: modelObj.name,
          temperature: 0.1,
          max_tokens: 400,
          messages: [
            { role: 'system', content: systemPromptExtractor },
            { role: 'user', content: `PESAN CUSTOMER:\n"${promptText}"\n\nEkstrak seluruh entitas di atas dalam JSON:` },
          ],
        },
        {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: 25000,
        }
      );
      const rawExt = respExt.data?.choices?.[0]?.message?.content || '{}';
      const cleanJson = extractJsonContent(rawExt) || '{}';
      const parsed = JSON.parse(cleanJson);
      extraction = {
        ...extraction,
        ...parsed,
        symptoms: Array.from(new Set([...(deterministic.symptoms || []), ...(parsed.symptoms || [])])),
        childAgeMonths: parsed.child_age_months ?? deterministic.childAgeMonths ?? null,
      };
    } catch (e) {
      console.warn(`[Extractor Fallback / Parse Error]:`, e.message);
    }
    const extractLatency = Date.now() - extractStart;

    // Merge extraction to slate
    const updatedSlate = SlateStore.updateSlateWithExtraction(slate, extraction);

    // 3. Grounding Composer
    const grounding = GroundingComposer.compose(updatedSlate, extraction);

    // 4. Generator Call
    const genStart = Date.now();
    const systemPromptGen = `Anda adalah Bidan Yusi, bidan resmi dan konsultan ramah dari Kala Moms and Baby Spa.
Tugas Anda adalah merangkai balasan WhatsApp yang tenang, hangat, santun, dan profesional (bukan sales/admin e-commerce).

FAKTA GROUNDING RESMI (SUMBER KEBENARAN MUTLAK - DILARANG MENGARANG DATA DI LUAR INI):
- Asal Klinik: ${grounding.clinicFacts.homebase} (${grounding.clinicFacts.coverage}).
${grounding.deliveryFacts ? `• Lokasi Terkonfirmasi: ${grounding.deliveryFacts.kelurahan} (Jarak ~${grounding.deliveryFacts.distanceKm} km)\n• Tarif Ongkir Promo: Rp ${grounding.deliveryFacts.ongkirPromo?.toLocaleString('id-ID')}` : ''}
• Usia Pasien: ${updatedSlate.childAgeMonths !== null ? `${updatedSlate.childAgeMonths} bulan (${updatedSlate.childAgeCategory})` : 'Belum diketahui'}
- Layanan yang Cocok:
${grounding.filteredCatalog.map((s) => `- ${s.name} (${s.description})`).join('\n')}

PANDUAN KLINIS RESMI:
- Usia Newborn (0-40 hari / 3 minggu) -> SANGAT BOLEH dan bagus dipijat dengan *Paket Selapan* atau *Pijat Bayi Ceria* (teknik sentuhan lembut stimulasi sirkulasi, relaksasi otot, membantu tidur lelap, dan stimulasi tumbuh kembang aman oleh Bidan bersertifikat).
- Batuk / Pilek / Grok-grok -> Sangat dianjurkan *Pijat Pulih Ceria* dikombinasikan dengan *Sinar Moksa* (terapi inframerah hangat aman untuk melonggarkan lendir/saluran napas).
- Kembung / Kolik / Sembelit / Gumoh -> Dianjurkan *Pijat Pulih Ceria* dengan edukasi katup lambung dan teknik pijat ILU perut.

ATURAN KOMUNIKASI & PERSONA (SANGAT KETAT):
1. Panggil customer dengan "Bunda" atau "bund" (maksimal 1-2x per pesan).
2. DILARANG KERAS membuat bullet-point / daftar menu harga di dalam chat teks.
3. FORMAT WHATSAPP: Gunakan HANYA satu bintang *teks* untuk cetak tebal. DILARANG KERAS memakai dua bintang **teks**.
4. DILARANG KERAS menggunakan kata-kata keagamaan ("InsyaAllah", "Alhamdulillah", "Bismillah").
5. SINGKAT & PADAT: Panjang balasan maksimal 2-3 kalimat saja. Dilarang bertele-tele.
6. DI AKHIR PESAN: Tanyakan 1 pertanyaan ramah penutup (apakah ingin dibantu jadwalkan atau konsultasi lebih lanjut).
7. Gunakan emoji minimalis (cukup satu emoji senyum 😊 di akhir).`;

    const userContent = `PESAN TERBARU BUNDA:\n"${promptText}"\n\nBalas dengan ramah sebagai Bidan Yusi:`;

    let rawGenReply = '';
    try {
      const resp = await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model: modelObj.name,
          temperature: 0.6,
          max_tokens: 400,
          messages: [
            { role: 'system', content: systemPromptGen },
            { role: 'user', content: userContent },
          ],
        },
        {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: 25000,
        }
      );
      rawGenReply = resp.data?.choices?.[0]?.message?.content || '';
    } catch (err) {
      rawGenReply = `[ERROR: ${err.message}]`;
    }

    const genLatency = Date.now() - genStart;
    const finalReply = sanitizeFinalReply(rawGenReply);
    const totalLatency = Date.now() - iterationStart;

    // Evaluasi Aturan & Kualitas
    const hasDoubleAsterisk = /\*\*/.test(rawGenReply);
    const hasSingleAsterisk = /\*[^*]+\*/.test(finalReply);
    const hasBulletDump = /^\s*[-*•]\s+Rp/m.test(rawGenReply);
    const hasBunda = /\b(Bunda|bund)\b/i.test(finalReply);
    const hasReligious = /\b(InsyaAllah|Alhamdulillah|Bismillah)\b/i.test(rawGenReply);
    const sentenceCount = finalReply.split(/[.!?]+\s+/).filter(Boolean).length;

    console.log(`\n[Run #${i}] Latency: Extractor=${extractLatency}ms, Gen=${genLatency}ms (Total=${totalLatency}ms)`);
    console.log(`Extracted: Age=${extraction.childAgeMonths}m, Symptoms=[${extraction.symptoms.join(', ')}]`);
    console.log(`Reply:\n"${finalReply}"`);

    results.push({
      run: i,
      extractLatency,
      genLatency,
      totalLatency,
      extractedAge: extraction.childAgeMonths,
      extractedSymptoms: extraction.symptoms,
      rawReply: rawGenReply,
      finalReply,
      compliance: {
        noDoubleAsterisk: !hasDoubleAsterisk,
        properSingleAsterisk: hasSingleAsterisk,
        noBulletDump: !hasBulletDump,
        hasBundaGreeting: hasBunda,
        noReligiousWords: !hasReligious,
        sentenceLengthOk: sentenceCount <= 4,
      },
    });
  }

  return results;
}

async function startAllBenchmarks() {
  const summaryReport = {};

  for (const model of candidateModels) {
    summaryReport[model.name] = {
      case1: await runBenchmarkForModel(model, prompt1, 'Kasus 1: Bayi 2 Bulan (Grok-grok, Kembung, Gumoh)', 5),
      case2: await runBenchmarkForModel(model, prompt2, 'Kasus 2: Newborn 3 Minggu (Boleh Pijat?)', 5),
    };
  }

  fs.writeFileSync('scratch/benchmark-results.json', JSON.stringify(summaryReport, null, 2));
  console.log('\n======================================================');
  console.log('✅ ALL BENCHMARKS COMPLETED 5X ACROSS 3 MODELS!');
  console.log('Results saved to scratch/benchmark-results.json');
  console.log('======================================================');
}

startAllBenchmarks().catch(console.error);
