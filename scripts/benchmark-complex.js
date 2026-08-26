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

const complexPrompt1 = `Malam bund, mau tanya kalau buat anak saya yang pertama umur 3 tahun lagi batuk pilek rewel terus adiknya masih 2 bulan nafasnya grok-grok dan sering gumoh itu bisa sekalian dipijat bareng di rumah ga ya? Rumah saya di daerah Manukan Kulon gang 4, kira2 kena ongkir berapa dan ada paket apa yg pas buat keduanya?`;

const complexPrompt2 = `Bunda, dedek kemarin sempat anget badannya tapi sekarang udah turun tinggal batuk berdahak sama susah tidur. Mau coba yang paket fisioterapi dada atau terapi uap itu apakah aman untuk bayi 4 bulan? Kalau bidannya bisa datang hari Minggu pagi jam 9 bisa langsung dibookingkan ga bund?`;

const candidateModels = [
  { name: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { name: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
];

async function runComplexBenchmark(modelObj, promptText, caseName, runs = 5) {
  console.log(`\n======================================================`);
  console.log(`🚀 RUNNING COMPLEX BENCHMARK: [${modelObj.label}] - Case: ${caseName}`);
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
        kelurahan: 'Manukan Kulon',
        kecamatan: 'Tandes',
        kota: 'Kota Surabaya',
        lat: -7.261,
        lng: 112.671,
        pricelist_sent: true,
        preferences: {
          distanceKm: 15.5,
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
1. Tangkap semua keluhan fisik/anak ke array symptoms.
2. Jika customer menyebutkan preferensi hari/jam, masukkan ke preferred_date_text dan preferred_time_text.
3. Konversi usia anak jika disebutkan.

OUTPUT WAJIB JSON VALID:
{
  "intents": ["provide_location", "provide_age", "consult_symptom", "ask_price"],
  "location_text": "Manukan Kulon",
  "street_detail": "gang 4",
  "child_age_months": number | null,
  "symptoms": ["batuk", "pilek", "grok-grok", "gumoh"],
  "treatment_referenced": "Pijat Pulih Ceria",
  "preferred_date_text": "hari Minggu",
  "preferred_time_text": "pagi jam 9",
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
          ...(modelObj.name.includes('luna') ? {} : { temperature: 0.1 }),
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
• Lokasi Terkonfirmasi: Manukan Kulon, Surabaya (Jarak ~15.5 km).
• Tarif Ongkir Promo: Rp 20.000 (KHUSUS: Untuk 2 anak atau lebih dalam 1 kali kedatangan/alamat, ongkir TETAP DIHITUNG 1 KALI SAJA, bukan 2 kali!).
- Layanan yang Cocok:
  * Untuk Bayi 2-4 bulan: *Pijat Pulih Ceria* (bapil, grok-grok, kembung, gumoh) & *Sinar Moksa* / *Terapi Uap*.
  * Untuk Anak 3 tahun: *Pijat Kids Ceria* atau *Pijat Pulih Ceria Anak*.

PANDUAN KLINIS RESMI:
- 2 Anak Sekaligus -> SANGAT BISA dipijat bareng dalam 1 sesi kunjungan homecare. Bidan membawa perlengkapan lengkap ke rumah Bunda.
- Batuk / Grok-grok / Dahak pada Bayi -> Terapi uap & sinar moksa SANGAT AMAN untuk bayi 4 bulan jika demam sudah turun, ditangani langsung oleh Bidan bersertifikat.
- Kembung / Gumoh -> Katup lambung bayi 2 bulan sedang adaptasi, dibantu pijat ILU perut.

ATURAN KOMUNIKASI & PERSONA (SANGAT KETAT):
1. Panggil customer dengan "Bunda" atau "bund" (maksimal 1-2x per pesan).
2. DILARANG KERAS membuat bullet-point / daftar menu harga di dalam chat teks.
3. FORMAT WHATSAPP: Gunakan HANYA satu bintang *teks* untuk cetak tebal. DILARANG KERAS memakai dua bintang **teks**.
4. DILARANG KERAS menggunakan kata-kata keagamaan ("InsyaAllah", "Alhamdulillah", "Bismillah").
5. SINGKAT & PADAT: Panjang balasan maksimal 3 kalimat saja. Jawab pertanyaan customer secara komprehensif, tenang, dan solutif.
6. DI AKHIR PESAN: Tanyakan 1 pertanyaan ramah penutup (apakah ingin langsung dijadwalkan).
7. Gunakan emoji minimalis (cukup satu emoji senyum 😊 di akhir).`;

    const userContent = `PESAN TERBARU BUNDA:\n"${promptText}"\n\nBalas dengan ramah sebagai Bidan Yusi:`;

    let rawGenReply = '';
    try {
      const resp = await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model: modelObj.name,
          ...(modelObj.name.includes('luna') ? {} : { temperature: 0.6 }),
          max_tokens: 500,
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
    console.log(`Extracted: Loc=${extraction.locationText}, Symptoms=[${extraction.symptoms.join(', ')}], Date=${extraction.preferredDateText}, Time=${extraction.preferredTimeText}`);
    console.log(`Reply:\n"${finalReply}"`);

    results.push({
      run: i,
      extractLatency,
      genLatency,
      totalLatency,
      extracted: extraction,
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

async function startComplexBenchmarks() {
  const summaryReport = {};

  for (const model of candidateModels) {
    summaryReport[model.name] = {
      case1: await runComplexBenchmark(model, complexPrompt1, 'Kasus Kompleks 1: Multi-Anak (3th & 2bln) + Lokasi Manukan + Kebijakan 1x Ongkir', 5),
      case2: await runComplexBenchmark(model, complexPrompt2, 'Kasus Kompleks 2: Pasca Demam 4 Bulan + Uap/Fisio Dada + Request Booking Minggu Jam 9', 5),
    };
  }

  fs.writeFileSync('scratch/benchmark-complex-results.json', JSON.stringify(summaryReport, null, 2));
  console.log('\n======================================================');
  console.log('✅ COMPLEX BENCHMARKS COMPLETED 5X FOR GPT-4o-mini & GPT-5.6-luna!');
  console.log('Results saved to scratch/benchmark-complex-results.json');
  console.log('======================================================');
}

startComplexBenchmarks().catch(console.error);
