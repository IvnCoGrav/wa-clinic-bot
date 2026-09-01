import { z } from 'zod';
import { ExtractedEntities } from './types';
import { parseAgeTextToMonths } from '../utils/age-calculator';
import { callChatCompletionsWithFallback } from '../integrations/llm/model-fallback';
import { getLlmEndpointConfig } from '../integrations/llm/llm-gateway';
import { AiModelConfigService } from '../config/ai-models.config';
import { extractJsonContent } from '../utils/json-extract';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { getGazetteerAreas, escapeRegex } from '../utils/gazetteer';

const RawLlmExtractionSchema = z.object({
  intents: z.array(z.string()).default([]),
  location_text: z.string().nullable().default(null),
  street_detail: z.string().nullable().default(null),
  child_age_months: z.number().nullable().default(null),
  symptoms: z.array(z.string()).default([]),
  treatment_referenced: z.string().nullable().default(null),
  preferred_date_text: z.string().nullable().default(null),
  preferred_time_text: z.string().nullable().default(null),
  customer_name: z.string().nullable().default(null),
  is_medical_emergency: z.boolean().default(false),
  confidence_score: z.number().default(0.9),
});

const GENERIC_TREATMENT_RE = /^(?:layanan\s+)?(?:home[-\s]?treatment|home[-\s]?care|homecare|care|treatment|perawatan|pijat|spa|layanan|paket|promo|info\s+treatment|layanan\s+kami)$/i;
const GENERIC_LOCATION_RE = /^(?:rumah|ke\s+rumah|di\s+rumah|rumah\s+saya|lokasi|alamat|klinik|tempat|sini|sana|daerah|posisi|surabaya|sidoarjo|surabaya\s*[\/-]\s*sidoarjo|mana|mn|mna|dimana|dmana|mana\s+(?:ya|kak|bund|bunda|min|mba|mbak|kk)|mn\s+(?:ya|kak|bund|bunda|min|mba|mbak|kk))$/i;
const NON_SYMPTOM_TOKENS = new Set([
  'sehat', 'selalu', 'info', 'konsultasi', 'tanya', 'tertarik', 'booking', 'reservasi', 'bisa',
  'jadwal', 'promo', 'biaya', 'harga', 'ongkir', 'homecare', 'hometreatment', 'treatment',
]);
const INVALID_CUSTOMER_NAMES = new Set([
  'saya', 'aku', 'bunda', 'bund', 'bidan', 'bu bidan', 'admin', 'kak', 'min', 'kamu', 'kami', 'bapak', 'ibu',
]);

export class EntityExtractor {
  /**
   * Filter dan normalisasi hasil ekstraksi agar istilah umum/salam tidak menjadi false positive.
   */
  public static sanitizeExtractedEntities(raw: ExtractedEntities): ExtractedEntities {
    const cleaned = { ...raw };

    // 1. Sanitasi treatment_referenced (Tolak istilah umum model bisnis)
    if (cleaned.treatmentReferenced) {
      const trimmed = cleaned.treatmentReferenced.trim();
      if (GENERIC_TREATMENT_RE.test(trimmed)) {
        cleaned.treatmentReferenced = null;
      }
    }

    // 2. Sanitasi locationText (Tolak kata tempat umum "rumah", "klinik")
    if (cleaned.locationText) {
      const trimmedLoc = cleaned.locationText.trim().toLowerCase();
      if (GENERIC_LOCATION_RE.test(trimmedLoc)) {
        cleaned.locationText = null;
        cleaned.intents = cleaned.intents.filter((i) => i !== 'provide_location');
      }
    }

    // 3. Sanitasi symptoms (Tolak kata basa-basi/salam "sehat", "info")
    if (cleaned.symptoms && cleaned.symptoms.length > 0) {
      cleaned.symptoms = cleaned.symptoms.filter((sym) => {
        const s = sym.trim().toLowerCase();
        if (NON_SYMPTOM_TOKENS.has(s)) return false;
        if (/^(?:sehat\s+selalu|konsultasi|tanya\s+tanya|info\s+lengkap|tertarik\s+layanan)$/i.test(s)) return false;
        return true;
      });
    }

    // 4. Sanitasi customerName (Tolak kata ganti diri "Saya", "Aku")
    if (cleaned.customerName) {
      const nameLower = cleaned.customerName.trim().toLowerCase();
      if (INVALID_CUSTOMER_NAMES.has(nameLower) || nameLower.length < 2) {
        cleaned.customerName = null;
      }
    }

    // Jamin minimal ada intent chitchat jika intents kosong
    if (!cleaned.intents || cleaned.intents.length === 0) {
      cleaned.intents = ['chitchat'];
    }

    return cleaned;
  }

  /**
   * Tahap 1: Fast Deterministic Pre-Extractor (Pure TypeScript, 0ms latency)
   */
  public static preExtractDeterministic(
    text: string,
    incomingMessage?: any
  ): Partial<ExtractedEntities> {
    const lower = text.toLowerCase().trim();
    const result: Partial<ExtractedEntities> = {
      symptoms: [],
    };

    // 1. WhatsApp Native GPS Pin
    if (incomingMessage?.location || incomingMessage?.type === 'location') {
      const loc = incomingMessage.location || incomingMessage;
      if (loc.latitude && loc.longitude) {
        result.locationText = `${loc.latitude},${loc.longitude}`;
        result.intents = ['provide_location'];
      }
    }

    // 1b. Deteksi teks lokasi langsung (misal: "Saya lokasinya di alana tambak oso waru bisa...")
    const locMatch = lower.match(
      /\b(?:lokasi(?:nya)?|alamat(?:nya)?|rumah(?:nya)?|daerah|posisi)\s+(?:saya\s+)?(?:di\s+|:\s*|\s+)?([a-z0-9\s,.-]+?)(?:\s+(?:bisa|mau|untuk|buat|apakah|ada|mohon)\b|$)/i
    );
    if (locMatch && locMatch[1] && locMatch[1].trim().length >= 3) {
      const candidate = locMatch[1].trim();
      if (!GENERIC_LOCATION_RE.test(candidate.toLowerCase())) {
        result.locationText = candidate;
        result.intents = result.intents || [];
        if (!result.intents.includes('provide_location')) {
          result.intents.push('provide_location');
        }
      }
    }

    // 1c. Deteksi nama wilayah / kelurahan Surabaya & Sidoarjo langsung (misal: "Berbek Bund", "di Berbek", "Jambangan", "Rungkut", "gak jadi di brebek aja")
    const normalizedLower = lower
      .replace(/\bbrebek\b/gi, 'berbek')
      .replace(/\bjambangn\b/gi, 'jambangan')
      .replace(/\brungkot\b/gi, 'rungkut')
      .replace(/\bwru\b/gi, 'waru')
      .replace(/\bsdoarjo\b/gi, 'sidoarjo');

    const cleanedLocationCandidate = normalizedLower
      .replace(/^(?:gak\s+jadi\s+)?(?:di|daerah|ke|posisi|area)\s+/i, '')
      .replace(/\s+(?:aja|saja|bund|bunda|kak|sis|ya|kakak|mba|mbak|bu|bidan|kk)$/i, '')
      .trim();

    const hasStreetDetailKeywords = /\b(jalan|jl|jln|gang|gg|blok|no|nomor|rt|rw)\b/i.test(normalizedLower);

    // 1c. Deteksi Kuadran / Kawasan Wilayah Luas (misal: "SBY barat", "Surabaya Timur", "Sidoarjo Selatan", "Sidoarjo Kota")
    const quadrantPattern = /\b(?:di\s+|ke\s+|daerah\s+|area\s+)?((?:sby|surabaya|sidoarjo|sda|gresik)\s+(?:barat|timur|selatan|utara|pusat|kota|pinggiran))\b/i;
    const quadMatch = normalizedLower.match(quadrantPattern);
    if (!result.locationText && quadMatch && quadMatch[1]) {
      const quadName = quadMatch[1].trim();
      result.locationText = quadName;
      result.intents = result.intents || [];
      if (!result.intents.includes('provide_location')) {
        result.intents.push('provide_location');
      }
    }

    if (!result.locationText && !hasStreetDetailKeywords) {
      const gazetteer = getGazetteerAreas();
      if (cleanedLocationCandidate && gazetteer.has(cleanedLocationCandidate)) {
        result.locationText = gazetteer.get(cleanedLocationCandidate)!;
        result.intents = result.intents || [];
        if (!result.intents.includes('provide_location')) {
          result.intents.push('provide_location');
        }
      } else {
        for (const [areaLower, areaOrig] of gazetteer.entries()) {
          if (
            cleanedLocationCandidate.startsWith(areaLower + ' ') ||
            cleanedLocationCandidate.endsWith(' ' + areaLower) ||
            normalizedLower.includes(`di ${areaLower}`) ||
            normalizedLower.includes(`ke ${areaLower}`) ||
            normalizedLower.includes(`daerah ${areaLower}`)
          ) {
            result.locationText = areaOrig;
            result.intents = result.intents || [];
            if (!result.intents.includes('provide_location')) {
              result.intents.push('provide_location');
            }
            break;
          }
        }
      }
    }

    // 2. Usia Deterministik via Age Calculator
    const ageMonths = parseAgeTextToMonths(text);
    if (ageMonths !== null) {
      result.childAgeMonths = ageMonths;
    }

    // 3. Deteksi Darurat Medis Fatal
    const emergencyPattern = /\b(kejang|pendarahan\s+hebat|tidak\s+sadar|badan\s+biru|sesak\s+parah|darurat|koma)\b/i;
    if (emergencyPattern.test(lower)) {
      result.isMedicalEmergency = true;
      result.intents = ['medical_emergency'];
    }

    // 4. Deteksi Afirmasi / Negasi Singkat
    if (/^(boleh|iya|ya|siap|oke|ok|mau|gas|bisa|lanjut)\b/i.test(lower) && lower.split(/\s+/).length <= 3) {
      result.intents = result.intents || [];
      if (!result.intents.includes('affirmation')) {
        result.intents.push('affirmation');
      }
    }

    // 5. Deteksi Gejala Klinis Umum (Deterministic Baseline Safety Net)
    const symptomKeywords = [
      { key: 'pilek', re: /\b(pilek|flu|ingus|meler|hidung tersumbat)\b/i },
      { key: 'batuk', re: /\b(batuk|batuk-batuk)\b/i },
      { key: 'grok-grok', re: /\b(grok[\s-]*grok|nafas bunyi|bunyi grok)\b/i },
      { key: 'demam', re: /\b(demam|panas|meriang|sumeng)\b/i },
      { key: 'kembung', re: /\b(kembung|masuk angin|begah)\b/i },
      { key: 'kolik', re: /\b(kolik|colic)\b/i },
      { key: 'sembelit', re: /\b(sembelit|susah bab|konstipasi)\b/i },
      { key: 'diare', re: /\b(diare|mencret|bab cair)\b/i },
      { key: 'gtm', re: /\b(gtm|susah makan|tidak mau makan|gamau makan)\b/i },
      { key: 'susah tidur', re: /\b(susah tidur|rewel|nangis terus|gelisah)\b/i },
    ];
    for (const item of symptomKeywords) {
      if (item.re.test(lower)) {
        if (!result.symptoms) result.symptoms = [];
        if (!result.symptoms.includes(item.key)) {
          result.symptoms.push(item.key);
        }
        result.intents = result.intents || [];
        if (!result.intents.includes('consult_symptom')) {
          result.intents.push('consult_symptom');
        }
      }
    }

    // 5. Deteksi Pertanyaan Asal Klinik
    if (/\b(?:ini\s+)?(?:daerah|asal|lokasi|posisi|base)\s*(?:mana|mn|mna|dmana|dimana)\b/i.test(lower) || /\b(dari\s+daerah\s+mana|asalnya\s+mana|klinik\s+mana|daerah\s+mana|lokasi\s+klinik)\b/i.test(lower)) {
      result.intents = result.intents || [];
      if (!result.intents.includes('ask_clinic_origin')) {
        result.intents.push('ask_clinic_origin');
      }
    }

    // 6. Deteksi Kombinasi Treatment atau Treatment Spesifik
    if (/\bpijat\s+(?:bayi\s+)?ceria\b/i.test(lower) && /\bcukur\b/i.test(lower)) {
      result.treatmentReferenced = 'Pijat Bayi Ceria + Cukur Rambut Bayi';
      result.intents = result.intents || [];
      if (!result.intents.includes('select_treatment')) {
        result.intents.push('select_treatment');
      }
    } else if (/\bpijat\s+(?:bayi\s+)?pulih\s+ceria\b/i.test(lower) && /\bsinar\b/i.test(lower)) {
      result.treatmentReferenced = 'Pijat Bayi Pulih Ceria + Sinar Moksa';
      result.intents = result.intents || [];
      if (!result.intents.includes('select_treatment')) {
        result.intents.push('select_treatment');
      }
    } else if (
      /\b(?:massage|pijat)\s+(?:biasa|aja|saja|reguler|standar|rutin)\b/i.test(lower) ||
      /^(?:massage|pijat)\s+(?:biasa|aja|saja|reguler|standar|rutin)$/i.test(lower.trim())
    ) {
      result.treatmentReferenced = 'pijat bayi';
      result.intents = result.intents || [];
      if (!result.intents.includes('select_treatment')) {
        result.intents.push('select_treatment');
      }
    }

    // 7. Deteksi Permintaan Layanan di Luar Katalog Resmi (Unlisted Service)
    const isPostVaccineConsultation =
      /\b(habis|setelah|pasca|baru|selesai)\s+(?:vaksin|imunisasi|imun)\b/i.test(lower) ||
      /\b(?:vaksin|imunisasi|imun)\b.*?\b(berpengaruh|boleh\s*(?:kah|ga|gak|nggak|ta)|aman\s*(?:kah|ga|gak)|bisa\s+pijat|pijatnya)\b/i.test(lower);

    if (
      !isPostVaccineConsultation &&
      /\b(mandikan\s*bayi|mandiin\s*bayi|jasa\s*mandi|paket\s*mandi|baby\s*sitting|penitipan\s*(anak|bayi)|tindik(\s*telinga)?|jasa\s*(?:imunisasi|vaksin)|layanan\s*(?:imunisasi|vaksin)|suntik\s*(?:imunisasi|vaksin)|sunat|rawat\s*tali\s*pusat|rawat\s*luka|fisioterapi|paket\s*newborn|perawatan\s*newborn)\b/i.test(lower)
    ) {
      result.intents = result.intents || [];
      if (!result.intents.includes('ask_unlisted_service')) {
        result.intents.push('ask_unlisted_service');
      }
    }

    return result;
  }

  /**
   * Tahap 2: Unified Semantic LLM Extractor (Single-Pass)
   */
  public static async extract(
    text: string,
    context?: {
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
      customerPhone?: string;
      conversationId?: string;
      tenantId?: string;
      incomingMessage?: any;
    }
  ): Promise<ExtractedEntities> {
    const tenantId = context?.tenantId || DEFAULT_TENANT_ID;
    const deterministic = this.preExtractDeterministic(text, context?.incomingMessage);

    // Fallback baseline jika LLM offline
    const baselineRaw: ExtractedEntities = {
      intents: (deterministic.intents as any) || ['chitchat'],
      locationText: deterministic.locationText || null,
      streetDetail: deterministic.streetDetail || null,
      childAgeMonths: deterministic.childAgeMonths || null,
      symptoms: deterministic.symptoms || [],
      treatmentReferenced: deterministic.treatmentReferenced || null,
      preferredDateText: deterministic.preferredDateText || null,
      preferredTimeText: deterministic.preferredTimeText || null,
      customerName: deterministic.customerName || null,
      isMedicalEmergency: deterministic.isMedicalEmergency || false,
      confidenceScore: 0.8,
    };
    const baseline = this.sanitizeExtractedEntities(baselineRaw);

    const modelConfig = AiModelConfigService.getModelConfig('INTENT_CLASSIFICATION', tenantId);
    const endpoint = getLlmEndpointConfig();
    const startedAt = Date.now();

    if (!endpoint.apiKey) {
      return baseline;
    }

    try {
      const systemPrompt = `Anda adalah NLU Semantic Parser klinis untuk WhatsApp Mom & Baby Home Care Clinic (Bidan Yusi).
Tugas Anda adalah mengekstrak SEMUA entitas, keluhan, dan intensi dari pesan customer dalam format JSON terstruktur.

DAFTAR INTENTS YANG DIDUKUNG:
- "provide_location": Menyebutkan nama kelurahan/desa/kecamatan/kota.
- "supplement_address": Menyebutkan detail gang/jalan/nomor rumah/RT-RW.
- "provide_age": Menyebutkan usia anak/bayi.
- "consult_symptom": Mengeluhkan kondisi anak (grok-grok, batuk, pilek, kembung, kolik, susah makan/GTM, susah tidur/rewel, pegal/capek).
- "ask_price": Menanyakan harga, tarif, promo, atau minta pricelist.
- "ask_clinic_origin": Menanyakan klinik/bidan berasal dari daerah/lokasi mana.
- "ask_schedule": Menanyakan ketersediaan hari/jam/slot (misal "hari ini tersedia kah?", "bisa hari ini?", "ada jadwal hari ini?", "Jumat apakah bisa?", "bisa besok jam 3?", "ada slot kosong hari ini?").
- "select_treatment": Memilih treatment tertentu (misal "Pijat Bayi Ceria", "Pijat Pulih", "Sinar Moksa", atau rujukan anaphora seperti "yang tadi", "paket kedua").
- "request_booking": Mengajukan reservasi/minta dijadwalkan hari/jam tertentu.
- "affirmation": Persetujuan/jawaban positif singkat (boleh, iya, siap, mau).
- "negation": Penolakan/jawaban negatif (tidak, bukan, jangan).
- "medical_emergency": Kondisi kritis fatal (kejang, biru, tidak sadar, perdarahan hebat).
- "ask_unlisted_service": Menanyakan layanan/tindakan di luar katalog resmi klinik (seperti memandikan bayi harian, penitipan anak/baby sitting, tindik telinga, imunisasi, sunat, perawatan newborn mandiri).
- "chitchat": Sapaan atau basa-basi umum.

ATURAN EKSTRAKSI (SANGAT KETAT):
1. PENTING: "location_text" dan intent "provide_location" HANYA boleh diekstrak jika customer SECARA EKSPLISIT menyebutkan nama lokasi/daerah pada PESAN CUSTOMER TERBARU. Jika customer memberikan alamat lengkap (contoh "Platuk tauladan 19a , sidotopo wetan , kenjeran"), masukkan nama kelurahan/desa/kecamatan ("Sidotopo Wetan, Kenjeran") ke "location_text", dan detail nomor/jalan/gang ("Platuk tauladan 19a") ke "street_detail". DILARANG KERAS menyalin atau mengekstrak ulang lokasi dari RIWAYAT CHAT TERAKHIR jika pesan terbaru hanya bertanya hal lain. DILARANG mengekstrak kata generik "rumah", "ke rumah", "klinik" sebagai location_text.
2. DILARANG KERAS mengekstrak istilah umum model bisnis ("home-treatment", "homecare", "home care", "layanan home", "perawatan", "treatment", "spa", "promo") sebagai "treatment_referenced". Field "treatment_referenced" HANYA boleh diisi jika customer menyebut nama perawatan spesifik katalog (contoh: "Pijat Bayi Ceria", "Pijat Pulih", "Pijat Laktasi", "Sinar Moksa", "Pijat Gemoy").
3. Jangan mengekstrak kata sapaan/basa-basi ("sehat selalu", "mau info", "konsultasi") sebagai "symptoms".
4. Jangan mengekstrak kata ganti diri ("Saya", "Aku", "Bunda") sebagai "customer_name".
5. Jika customer menyebut nama perumahan/gang (misal: "Darmo permai selatan gang 17") setelah kelurahan diketahui, masukkan ke "street_detail".
6. Konversikan usia ke total bulan pada "child_age_months" (contoh: "1 bulan" -> 1, "2 bulan" -> 2, "1 tahun" -> 12, "3 tahun" -> 36).
7. Tangkap semua keluhan fisik/anak ke dalam array "symptoms".
8. Pecahkan rujukan anaphora ("yang tadi", "yang kedua") ke "treatment_referenced" jika ada riwayat percakapan.
9. Jika pesan terbaru menanyakan ketersediaan jadwal/waktu (contoh: "hari ini tersedia kah?", "bisa hari ini?", "ada jadwal hari ini?", "Jumat apakah bisa?", "bisa besok jam 3?", "ada slot kosong hari ini?"), masukkan intent "ask_schedule" dan ekstrak waktu/hari tersebut (contoh: "hari ini", "Jumat", "besok") ke "preferred_date_text".
10. Jika customer mengatakan peralihan target audiens (contoh "untuk baby aja kak", "buat adeknya aja", "ambil yg bayi aja"), dan di riwayat chat sebelumnya ada keluhan spesifik bayi (seperti flu, batuk, pilek, grok-grok) atau paket bayi yang dibahas (misal "Pijat Pulih Ceria"), masukkan paket atau keluhan tersebut ke "treatment_referenced" atau "symptoms" agar konteks tetap terjaga.
11. Jika customer menyebutkan kombinasi lebih dari 1 treatment (contoh: "Pijat bayi ceria + cukur", "Pulih ceria dan sinar", "Laktasi plus oksitosin"), gabungkan nama treatment lengkapnya ke "treatment_referenced" (contoh: "Pijat Bayi Ceria + Cukur Rambut Bayi") dan sertakan intent "select_treatment".
12. AREA LAYANAN (SURABAYA & SIDOARJO) & NORMALISASI TYPO WILAYAH:
Klinik berlokasi di Sidoarjo dan melayani area Surabaya & Sidoarjo. Jika terdapat typo penulisan nama wilayah/kecamatan/kelurahan di Surabaya/Sidoarjo (contoh: "kencjeran" -> "Kenjeran", "jambangn" -> "Jambangan", "rungkot" -> "Rungkut", "wru" -> "Waru", "sdoarjo" -> "Sidoarjo", "gdangan" -> "Gedangan", "budurn" -> "Buduran"), normalisasikan ke nama wilayah Surabaya/Sidoarjo yang dimaksud pada "location_text", JANGAN mengubahnya menjadi nama kota/daerah lain di luar Jawa Timur (seperti mengubah "kencjeran" menjadi "Kencana").
13. ALIAS TREATMENT STANDAR / BIASA (DINAMIS):
Jika customer menyebutkan "pijat bayi", "massage bayi", "pijat baby", "pijat newborn", "massage biasa", "pijat biasa", "massage aja", "pijat aja", "pijat reguler", "massage reguler", "pijat rutin", atau "pijat standar", ini adalah sebutan generik untuk perawatan kebugaran umum si kecil. Ekstrak intent "select_treatment" dan isi "treatment_referenced" dengan alias generik "pijat bayi" saja — JANGAN paksa menjadi "Pijat Bayi Ceria" atau "Pijat Kids Ceria". Nama spesifik akan dipadankan secara dinamis dengan katalog aktif dari database (treatmentCatalogService) berdasarkan usia pasien.
14. LAYANAN DI LUAR KATALOG RESMI (UNLISTED SERVICE) VS KONSULTASI PASCA VAKSIN:
Jika customer menanyakan ketersediaan layanan/tindakan yang bukan merupakan layanan pijat/spa/terapi resmi klinik (contoh: "Ada PL homecare mandikan bayi?", "bisa baby sitting?", "bisa suntik vaksin/imunisasi?"), sertakan intent "ask_unlisted_service".
NAMUN jika customer bertanya apakah bayi yang baru divaksin/imunisasi boleh dipijat (contoh: "anak saya habis vaksin boleh pijat?", "anak saya baru imunisasi bcg polio boleh dipijat hari ini?"), ini adalah KONSULTASI KLINIS biasa (intent: "consult_symptom" atau "chitchat"), DILARANG menandainya sebagai "ask_unlisted_service"!
15. PENYEBUTAN LOKASI SINGKAT / JAWABAN WILAYAH:
Jika pesan customer menyebutkan nama daerah/kelurahan/kecamatan/kawasan di Surabaya atau Sidoarjo (contoh: "Berbek", "Berbek Bund", "di berbek", "rungkut", "jambangan", "ketintang", "tropodo", "sedati", "sukodono", "candi", "taman", "sidoarjo kota", "gayungan", "wonokromo", "gubeng", "wiyung", "pakal", "kenjeran"), ini adalah NAMA LOKASI/WILAYAH! WAJIB ekstrak sebagai "location_text" dan sertakan intent "provide_location". DILARANG menganggapnya sebagai chitchat biasa!

CONTOH FEW-SHOT EKSTRAKSI (GUNAKAN SEBAGAI ACUAN POLA KONSISTEN):
- Input: "Berbek Bund"
  Output: {"intents":["provide_location"],"location_text":"Berbek","street_detail":null,"child_age_months":null,"symptoms":[],"treatment_referenced":null,"preferred_date_text":null,"preferred_time_text":null,"customer_name":null,"is_medical_emergency":false,"confidence_score":0.95}
- Input: "gak jadi bund di brebek aja"
  Output: {"intents":["provide_location"],"location_text":"Berbek","street_detail":null,"child_age_months":null,"symptoms":[],"treatment_referenced":null,"preferred_date_text":null,"preferred_time_text":null,"customer_name":null,"is_medical_emergency":false,"confidence_score":0.95}
- Input: "Pagi Bu bidan. Untuk home care pijat bayi hari ini tersedia kah?"
  Output: {"intents":["ask_schedule","select_treatment"],"location_text":null,"street_detail":null,"child_age_months":null,"symptoms":[],"treatment_referenced":"Pijat Bayi Ceria","preferred_date_text":"hari ini","preferred_time_text":null,"customer_name":null,"is_medical_emergency":false,"confidence_score":0.95}
- Input: "kalo misal sudah boleh pijat, hari ini kan kebetulan anak saya habis vaksin bcg dan polio apakah berpengaruh kalo semisal saya ambil hari ini pijatnya?"
  Output: {"intents":["consult_symptom","ask_schedule"],"location_text":null,"street_detail":null,"child_age_months":null,"symptoms":[],"treatment_referenced":null,"preferred_date_text":"hari ini","preferred_time_text":null,"customer_name":null,"is_medical_emergency":false,"confidence_score":0.95}
- Input: "Usia adek 26hari Bu bidan, lg batuk pilek jd susah tidur karena hidung buntu sm nafasnya grok\". Jd baiknya ambil treatment yg mna Bu bidan?"
  Output: {"intents":["provide_age","consult_symptom","select_treatment"],"location_text":null,"street_detail":null,"child_age_months":0.86,"symptoms":["batuk","pilek","susah tidur","hidung buntu","grok-grok"],"treatment_referenced":"Pijat Bayi Pulih Ceria","preferred_date_text":null,"preferred_time_text":null,"customer_name":null,"is_medical_emergency":false,"confidence_score":0.98}
- Input: "banjar mukti residence, buduran, sidoarjo"
  Output: {"intents":["provide_location","supplement_address"],"location_text":"Buduran","street_detail":"banjar mukti residence","child_age_months":null,"symptoms":[],"treatment_referenced":null,"preferred_date_text":null,"preferred_time_text":null,"customer_name":null,"is_medical_emergency":false,"confidence_score":0.95}

OUTPUT WAJIB JSON VALID DENGAN FORMAT:
{
  "intents": ["provide_location", "consult_symptom", ...],
  "location_text": "Nama kelurahan/desa/kecamatan atau null",
  "street_detail": "Detail jalan/gang/nomor rumah atau null",
  "child_age_months": number atau null,
  "symptoms": ["grok-grok", "batuk"],
  "treatment_referenced": "Nama treatment atau null",
  "preferred_date_text": "Waktu/hari booking atau null",
  "preferred_time_text": "Jam booking atau null",
  "customer_name": "Nama customer jika memperkenalkan diri atau null",
  "is_medical_emergency": boolean,
  "confidence_score": 0.95
}`;

      const historyContext = context?.history && context.history.length > 0
        ? `\nRIWAYAT CHAT TERAKHIR:\n${context.history.slice(-4).map((h) => `${h.role}: ${h.content}`).join('\n')}`
        : '';

      const userContent = `${historyContext}\n\nPESAN CUSTOMER TERBARU:\n"${text}"\n\nEkstrak seluruh entitas di atas dalam JSON:`;

      const callResult = await callChatCompletionsWithFallback({
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey,
        model: modelConfig.modelName || 'gpt-4o-mini',
        fallbackModel: endpoint.fallbackModel,
        timeoutMs: endpoint.timeoutMs || 30000,
        payload: {
          temperature: 0.1,
          max_tokens: 500,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
        },
      });

      const responseData = callResult.data;
      const rawContent = responseData?.choices?.[0]?.message?.content || '{}';
      const extractedStr = extractJsonContent(rawContent) || '{}';
      let parsedObj: any = {};
      try {
        parsedObj = JSON.parse(extractedStr);
      } catch {}
      const validated = RawLlmExtractionSchema.safeParse(parsedObj);

      if (validated.success) {
        const d = validated.data;
        const finalIntents = Array.from(
          new Set([...(deterministic.intents || []), ...d.intents])
        ) as ExtractedEntities['intents'];

        const rawResult: ExtractedEntities = {
          intents: finalIntents.length > 0 ? finalIntents : ['chitchat'],
          locationText: d.location_text || deterministic.locationText || null,
          streetDetail: d.street_detail || deterministic.streetDetail || null,
          childAgeMonths: d.child_age_months ?? deterministic.childAgeMonths ?? null,
          symptoms: Array.from(new Set([...(deterministic.symptoms || []), ...d.symptoms])),
          treatmentReferenced: d.treatment_referenced || deterministic.treatmentReferenced || null,
          preferredDateText: d.preferred_date_text || deterministic.preferredDateText || null,
          preferredTimeText: d.preferred_time_text || deterministic.preferredTimeText || null,
          customerName: d.customer_name || deterministic.customerName || null,
          isMedicalEmergency: d.is_medical_emergency || deterministic.isMedicalEmergency || false,
          confidenceScore: d.confidence_score || 0.9,
        };

        const result = this.sanitizeExtractedEntities(rawResult);

        try {
          const { auditLlmCall } = await import('../utils/llm-audit-buffer');
          auditLlmCall({
            customer_phone: context?.customerPhone || 'unknown',
            tenant_id: context?.tenantId,
            task_type: 'SLOT_EXTRACTOR',
            model_name: callResult.model,
            baseUrl: callResult.baseUrl,
            startedAt,
            usage: callResult.data?.usage,
          });
        } catch {}

        try {
          const { recordLlmExecution } = await import('../utils/llm-execution-logger');
          const reasoningContent =
            responseData?.choices?.[0]?.message?.reasoning_content ||
            responseData?.choices?.[0]?.message?.reasoning ||
            null;

          const displayReasoning = reasoningContent
            ? `[MiniMax CoT Reasoning]:\n${reasoningContent}\n\n[Summary]: Extracted intents: [${result.intents.join(', ')}] | Age: ${result.childAgeMonths} bln | Loc: ${result.locationText || '-'} | Symptoms: [${result.symptoms.join(', ')}]`
            : `Extracted intents: [${result.intents.join(', ')}] | Age: ${result.childAgeMonths} bln | Loc: ${result.locationText || '-'} | Symptoms: [${result.symptoms.join(', ')}]`;

          recordLlmExecution({
            flowType: 'SLOT_EXTRACTOR',
            customerPhone: context?.customerPhone || 'unknown',
            customerInput: text,
            promptPayload: { systemPrompt, userContent },
            reasoning: displayReasoning,
            rawReasoning: reasoningContent || rawContent,
            groundTruthUsed: { deterministic, finalResult: result },
            finalReply: JSON.stringify(result),
            modelUsed: callResult.model || modelConfig.modelName,
            durationMs: Date.now() - startedAt,
            status: 'SUCCESS',
          });
        } catch {}

        return result;
      }
    } catch (err: any) {
      console.error('[ENTITY EXTRACTOR ERROR] All LLM models in fallback chain failed:', err.message);
      try {
        const { auditLlmCall } = await import('../utils/llm-audit-buffer');
        auditLlmCall({
          customer_phone: context?.customerPhone || 'unknown',
          tenant_id: context?.tenantId,
          task_type: 'SLOT_EXTRACTOR',
          model_name: modelConfig.modelName || 'MiniMax-M2.7-highspeed',
          baseUrl: endpoint.baseUrl,
          startedAt,
          error: { message: err?.message },
        });
      } catch {}
      // Jangan tebak-tebak dengan regex rapuh saat LLM outage. Lempar error untuk Silent Human Escalation!
      throw err;
    }

    return baseline;
  }
}
