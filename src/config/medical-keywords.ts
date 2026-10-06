/**
 * Medical Keywords Configuration for High & Medium Severity Symptoms
 * Isolated config file easily expandable by medical staff & developers.
 */

// HIGH Severity Symptoms & Urgent Medical Emergencies (Directs to IGD / Ambulance 119)
export const HIGH_SEVERITY_MEDICAL_KEYWORDS: string[] = [  // Qualitative & Quantitative Fever / Heat
  'demam tinggi',
  'demam tinggi banget',
  'panas tinggi',
  'panas tinggi banget',
  'panas banget',
  'demam ga turun',
  'demam gak turun',
  'panas ga turun',
  'panas gak turun',
  'demam >39',
  'demam 39',
  'demam 40',
  'panas 39',
  'panas 40',

  // Seizures / Convulsions
  'kejang',
  'kejang-kejang',
  'step',
  'kaku',
  // Istilah kultural "sawan" beririsan kejang demam (audit 234800/477412) —
  // fail-closed HIGH. Matcher ≤6 huruf boundary-safe dari "kawasan"/"kesawan".
  // Pengecualian hardcode sementara (gate user 2026-09-17); sinonim klinis DB = tech debt.
  'sawan',
  'sawanen',
  'sawan tangis',

  // Respiratory Distress / Breathing Issues
  'sesak',
  'sesak napas',
  'sesak nafas',
  'ngap-ngapan',
  'napas bunyi',
  'nafas bunyi',
  'sulit bernapas',
  'sulit bernafas',
  'dada tertarik',

  // Severe Bleeding & Trauma
  'pendarahan',
  'perdarahan',
  'berdarah banyak',
  'keluar darah banyak',
  'jahitan terbuka',
  'jahitan lepas',

  // Unconsciousness / Lethargy / Severe Symptoms
  'tidak sadarkan diri',
  'pingsan',
  'lemas tidak sadar',
  'lemas banget ga respon',
  'muntah terus',
  'muntah terus menerus',
  'muntah menyembur',
  'kebiruan',
  'bibir biru',
  'sianosis',
  'hipotermia',
  'badan dingin banget',
];

// MEDIUM Severity Symptoms & General Medical Concerns (Escalates to Bidan Consultation)
// Catatan Fase 3: kolik, kembung parah, ruam, nyeri pinggang, batuk pilek DIKELUARKAN dari medium
// karena merupakan keluhan komplementer yang diarahkan ke Pijat Bayi Pulih Ceria / Kolik, bukan silent drop.
export const MEDIUM_SEVERITY_MEDICAL_KEYWORDS: string[] = [
  // Navel & Skin Concerns (ruam non-parah tetap, ruam parah dikeluarkan karena sering false positive)
  // Audit simulator (DeepSeek Flash over-helpful): varian bahasa non-formal
  // infeksi tali pusat WAJIB eskalasi deterministik, bukan dijawab LLM.
  'tali pusat',
  'tali pusar',
  'tali pusarnya bau',
  'pusar bau',
  'pusarnya bau',
  'pusar berbau',
  'pusar berdarah',
  'pusar bernanah',
  'ruam tali pusat',
  'bintik-bintik merah',
  'bintik merah',
  'merah-merah',
  'kulit mengelupas',
  'eksim',
  'bisul',
  'bentol-bentol',

  // Pregnancy / Musculoskeletal Concerns (nyeri pinggang dikeluarkan — komplementer)
  'pinggang sakit',
  'sakit menjalar',
  'kontraksi',

  // Postpartum & Maternal Health Concerns
  // Audit simulator: varian non-formal nyeri nifas + laktasi berat WAJIB
  // eskalasi deterministik (mitigasi risiko malapraktik medis).
  'jahitan pasca melahirkan',
  'jahitan nifas',
  'nyeri jahitan',
  'jahitan ngilu',
  'jahitannya ngilu',
  'jahitan masih ngilu',
  'ngilu bekas jahitan',
  'darah nifas berbau',
  'payudara bengkak keras',
  'payudara mengeras nyeri',
  'mastitis',

  // Infant Gastrointestinal & General Health (kolik/kembung parah dikeluarkan)
  'diare',
  'mencret',
  'bab berdarah',
  'bab berbusa',
  'muntah',
  'bayi menangis tanpa henti',
  'kuning',
  'bayi kuning',
  'ikterus',
  'jamur lidah',
  'ruam popok parah',
  'alergi asi',
  'alergi susu',
];

export const EMERGENCY_SYMPTOM_PATTERNS: RegExp[] = [
  /(?:gemetar|kelojotan|kaku|melotot|kejang)/i,
  /(?:tarikan\s+(?:dinding\s+)?dada|napas\s+tersengal|sesak|cekung\s+di\s+bawah\s+iga)/i,
  /(?:tidak\s+bangun|lemas\s+tidak\s+merespon|pingsan|tidak\s+sadar)/i,
  /(?:bibir\s+kebiruan|tubuh\s+dingin\s+sekali|sianosis)/i,
  /(?:darah\s+mengucur|perdarahan\s+hebat|jahitan\s+robek)/i,
];

/**
 * Helper to check text against keyword list and qualitative/quantitative patterns.
 */
export function checkMedicalKeywords(text: string): {
  isMedical: boolean;
  severity: 'HIGH' | 'MEDIUM' | 'NONE';
  detectedSymptoms: string[];
} {
  if (!text || typeof text !== 'string') {
    return { isMedical: false, severity: 'NONE', detectedSymptoms: [] };
  }

  const normalizedText = text.toLowerCase();
  const detectedHigh: string[] = [];
  const detectedMedium: string[] = [];

  // Frasa yang TIDAK boleh dianggap gejala medis meski mengandung keyword pendek.
  // Contoh: "step by step" = tahap demi tahap (bukan kejang), "kuningan" = nama daerah.
  const NON_MEDICAL_PHRASES: RegExp[] = [
    /\bstep\s+by\s+step\b/i,
  ];

  // Keyword pendek (≤6 huruf) dipakai dengan word boundary agar "kaku" tidak match
  // "kakun", "kuning" tidak match "kuningan", "step" tidak match "step by step".
  // Kata yang lebih panjang & multi-kata (mis. "demam tinggi", "tali pusat") cukup
  // substring match karena false positive-nya jauh lebih kecil.
  const matchesKeyword = (keyword: string): boolean => {
    const kw = keyword.toLowerCase();
    if (NON_MEDICAL_PHRASES.some((re) => re.test(normalizedText))) {
      return false;
    }
    if (kw.length <= 6 && !/\s/.test(kw)) {
      return new RegExp(`(^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(normalizedText);
    }
    return normalizedText.includes(kw);
  };

  // 1. Check High Severity Keywords
  for (const keyword of HIGH_SEVERITY_MEDICAL_KEYWORDS) {
    if (matchesKeyword(keyword)) {
      detectedHigh.push(keyword);
    }
  }

  // Check Quantitative Regex for Fever >= 39°C
  const feverMatch = normalizedText.match(/(?:demam|panas|suhu)\s*(?:tinggi)?\s*(?:di\s*atas|>|=)?\s*(39(?:\.[5-9])?|40|41)/i);
  if (feverMatch && !detectedHigh.includes(`demam ${feverMatch[1]}`)) {
    detectedHigh.push(`suhu ${feverMatch[1]}°C`);
  }

  if (detectedHigh.length > 0) {
    return {
      isMedical: true,
      severity: 'HIGH',
      detectedSymptoms: detectedHigh,
    };
  }

  // 2. Check Medium Severity Keywords
  for (const keyword of MEDIUM_SEVERITY_MEDICAL_KEYWORDS) {
    if (matchesKeyword(keyword)) {
      detectedMedium.push(keyword);
    }
  }

  if (detectedMedium.length > 0) {
    return {
      isMedical: true,
      severity: 'MEDIUM',
      detectedSymptoms: detectedMedium,
    };
  }

  return {
    isMedical: false,
    severity: 'NONE',
    detectedSymptoms: [],
  };
}

/**
 * Red-flag pertanyaan DOSIS obat/vitamin (RF-08) — KOMPOSIT, order-independent.
 *
 * Bug yang ditutup: "Boleh gak kasih obat batuk buat bayi 3 bulan? Sehari
 * berapa sendok?" / "vitamin C dosisnya berapa?" tidak dikenali gate medis
 * (tidak ada keyword) sehingga tidak dieskalasi, padahal klinik DILARANG
 * menyarankan dosis obat — WAJIB rujuk faskes.
 *
 * Aturan (mengikuti keluarga detectNeonatalFeverEmergency /
 * detectPersistentCoughRashEmergency — BUKAN regex adjacency hafalan kalimat):
 *   - ADA konteks obat/vitamin (farmasi), DAN
 *   - ADA satuan/penanda dosis (sendok/tetes/ml/mg/dosis/takaran/…).
 * Dua-duanya wajib (konjungsi) agar "harga obat batuk" / "resep masakan" tidak
 * ikut ter-flag. Pengecualian konteks masak (resep/sendok makan) menutup
 * false-positive dapur.
 */
const DOSE_DRUG_CONTEXT = [
  'obat', 'paracetamol', 'parasetamol', 'ibuprofen', 'amoxicillin', 'amoksisilin',
  'sirup', 'syrup', 'antibiotik', 'vitamin', 'suplemen', 'tetes', 'drops',
  'promag', 'sanmol', 'tempra', 'bodrex', 'panadol',
];
const DOSE_UNIT_MARKERS = [
  'dosis', 'dosisnya', 'takaran', 'sendok', 'tetse', 'tetes', 'ml', 'cc', 'mg', 'gram',
  'sachet', 'kapsul', 'tablet', 'pil', 'sehari berapa', 'berapa kali', 'berapa tetes',
  'berapa sendok', 'berapa ml', 'berapa mg', 'sehari', 'per hari',
];
const DOSE_BENIGN_CONTEXTS = ['resep masakan', 'resep masak', 'sendok makan', 'sendok teh masak', 'masakan', 'bumbu'];

export function detectDoseInquiryConcern(text: string, recentHistory?: string[]): {
  isConcern: boolean;
  severity: 'HIGH' | 'MEDIUM' | 'NONE';
  detectedSymptoms: string[];
} {
  const lower = (text || '').toLowerCase();
  const none = { isConcern: false, severity: 'NONE' as const, detectedSymptoms: [] as string[] };
  if (!lower.trim()) return none;

  // Konteks obat boleh lintas-turn (obat disebut di turn sebelumnya, dosis
  // ditanyakan sekarang). Penanda DOSIS WAJIB ada di pesan SAAT INI agar
  // concern tidak "menempel" ke setiap turn lanjutan.
  const historyLower = (recentHistory || []).filter((h) => typeof h === 'string').join(' \n ').toLowerCase();
  const hasDrug = DOSE_DRUG_CONTEXT.some((w) => lower.includes(w) || historyLower.includes(w));
  const hasDoseMarker = DOSE_UNIT_MARKERS.some((w) => lower.includes(w));
  if (!hasDrug || !hasDoseMarker) return none;

  // Netralkan konteks dapur: bila seluruh sinyal dosis berasal dari frasa masak.
  const benignHit = DOSE_BENIGN_CONTEXTS.find((b) => lower.includes(b));
  if (benignHit && !/\b(obat|vitamin|sirup|paracetamol|sanmol|tempra|drops|tetes)\b/.test(lower)) {
    return none;
  }

  // MEDIUM (bukan HIGH): pertanyaan dosis butuh rujukan faskes & eskalasi staf,
  // tetapi bukan kondisi gawat-darurat — menghindari alert CRITICAL palsu.
  return {
    isConcern: true,
    severity: 'MEDIUM',
    detectedSymptoms: ['pertanyaan dosis obat/vitamin (rujuk faskes)'],
  };
}

/**
 * Deteksi komposit demam neonatus (<28 hari, suhu >= 38.0°C).
 * Order-independent: parse umur-hari + suhu dari teks, bukan hafalan pola kalimat.
 * Referensi: IDAI/WHO — neonatus demam >=38.0°C = kondisi gawat darurat (Red Flag).
 */
export function detectNeonatalFeverEmergency(text: string): {
  isNeonatalFever: boolean;
  severity: 'HIGH' | 'NONE';
  detectedSymptoms: string[];
} {
  if (!text || typeof text !== 'string') {
    return { isNeonatalFever: false, severity: 'NONE', detectedSymptoms: [] };
  }
  const normalizedText = text.toLowerCase();

  // Parse usia: "10 hari", "bayi baru lahir", "newborn", "neonatus", "umur 5 hari", "usia 14 hari"
  let ageDays: number | null = null;
  const newbornKeywords = ['bayi baru lahir', 'newborn', 'neonatus'];
  if (newbornKeywords.some(k => normalizedText.includes(k))) {
    ageDays = 0; // newborn = 0 hari
  } else {
    const ageMatch = normalizedText.match(/(?:umur|usia|bayi)\s*(\d{1,2})\s*hari/);
    if (ageMatch) {
      ageDays = Number(ageMatch[1]);
    }
  }

  // Parse suhu: "suhu 38.2", "demam 38", "panas 38,2", "38.2°C", "38,2"
  let feverTemp: number | null = null;
  const tempMatch = normalizedText.match(/(?:suhu|demam|panas)\s*(\d{2}(?:[.,]\d+)?)/);
  if (tempMatch) {
    feverTemp = Number(tempMatch[1].replace(',', '.'));
  }

  if (ageDays !== null && ageDays < 28 && feverTemp !== null && feverTemp >= 38.0) {
    return {
      isNeonatalFever: true,
      severity: 'HIGH',
      detectedSymptoms: [`demam neonatus <28 hari (${feverTemp}°C, ${ageDays} hari)`],
    };
  }
  return { isNeonatalFever: false, severity: 'NONE', detectedSymptoms: [] };
}

/**
 * Red-flag komposit batuk-ruam-demam (RF-06) — SADAR-RIWAYAT lintas turn.
 *
 * Bug yang ditutup: gate medis deterministik bersifat stateless per-pesan,
 * sementara red-flag RF-06 terbagi dua turn ("batuk 2 minggu" lalu "muncul
 * ruam merah + demam"), sehingga tiap pesan tunggal lolos sebagai NONE.
 *
 * Aturan (order-independent, murni — bukan hafalan kalimat):
 *  - batuk WAJIB ada di salah satu teks (current atau riwayat), DAN
 *  - (batuk kronis >= 14 hari) ATAU (ruam mencurigakan) ATAU (demam).
 * Ruam jinak (popok/susu/biang keringat) dinetralkan agar tidak false positive.
 */
const BENIGN_RASH_PHRASES = ['ruam popok', 'ruam susu', 'biang keringat'];

export function detectPersistentCoughRashEmergency(texts: string | string[]): {
  isEmergency: boolean;
  severity: 'HIGH' | 'NONE';
  detectedSymptoms: string[];
} {
  const list = (Array.isArray(texts) ? texts : [texts])
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
  const none = { isEmergency: false, severity: 'NONE' as const, detectedSymptoms: [] as string[] };
  if (list.length === 0) return none;

  let combined = list.join(' \n ').toLowerCase();
  for (const benign of BENIGN_RASH_PHRASES) combined = combined.split(benign).join(' ');

  // Prefiks kata (bukan kata-utuh): menangkap imbuhan/varian "batuknya",
  // "batuk-batuk", "batuknya" — sebelumnya regex kata-utuh meleset sehingga
  // "batuknya udah 2 minggu" lolos tanpa eskalasi (celah audit RF-06).
  const hasCough = /(^|[^a-z])batuk/.test(combined)
    || combined.includes('bapil')
    || combined.includes('berbatuk');
  if (!hasCough) return none;

  const RASH_TOKENS = ['ruam', 'bintik', 'campak', 'bentol', 'bercak', 'merah-merah'];
  const FEVER_TOKENS = ['demam', 'panas', 'fever'];
  const hasRash = RASH_TOKENS.some((t) => combined.includes(t));
  const hasFever = FEVER_TOKENS.some((t) => combined.includes(t));

  // Durasi kuantitatif (minggu/pekan/week, hari/day, bulan/month); ambang kronis >= 14 hari.
  // Guard proksimitas penanda-usia: "3 bulan"/"2 minggu" setelah kata usia
  // (anak/bayi/umur/usia/newborn/...) adalah USIA PASIEN, bukan durasi batuk —
  // DILARANG dihitung kronis (mencegah false-positive "bayi 3 bulan batuk pilek").
  const AGE_MARKERS = ['usia', 'umur', 'anak', 'anaknya', 'bayi', 'baby', 'newborn', 'neonatus', 'adik', 'kakak', 'kecil'];
  // Verba gejala: bila token PERSIS sebelum angka adalah verba gejala
  // ("anak BATUK 2 minggu"), angka itu DURASI, bukan usia — jangan disaring
  // sebagai usia (celah audit RF-06: "anak batuk 2 minggu" terlewat).
  const SYMPTOM_VERBS = ['batuk', 'pilek', 'bapil', 'demam', 'panas', 'rewel', 'diare', 'muntah', 'sakit', 'grok', 'flu', 'sesak'];
  let maxDays = 0;
  const re = /(\d{1,3})\s*(minggu|pekan|week|hari|day|bulan|month)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(combined)) !== null) {
    const n = Number(m[1]);
    if (!Number.isFinite(n)) continue;
    const before = combined.slice(Math.max(0, m.index - 24), m.index);
    const beforeToks = before.split(/[^a-z0-9]+/).filter((t) => t.length > 0).slice(-3);
    const ageMarkerNearby = beforeToks.some((t) => AGE_MARKERS.includes(t));
    // Bila ada VERBA GEJALA di sekitar angka ("anak batuk ... 2 minggu"),
    // angka itu durasi gejala, BUKAN usia → jangan disaring sebagai usia.
    const symptomPresent = beforeToks.some((t) => SYMPTOM_VERBS.includes(t));
    if (ageMarkerNearby && !symptomPresent) continue;
    const unit = m[2];
    const days = unit === 'minggu' || unit === 'pekan' || unit === 'week'
      ? n * 7
      : unit === 'bulan' || unit === 'month'
        ? n * 30
        : n;
    if (days > maxDays) maxDays = days;
  }
  const isChronic = maxDays >= 14;

  if (!isChronic && !hasRash && !hasFever) return none;

  const detected: string[] = [isChronic ? `batuk kronis (${maxDays} hari)` : 'batuk'];
  if (hasRash) detected.push('ruam');
  if (hasFever) detected.push('demam');
  return {
    isEmergency: true,
    severity: 'HIGH',
    detectedSymptoms: [`red-flag batuk-ruam-demam: ${detected.join(', ')}`],
  };
}
