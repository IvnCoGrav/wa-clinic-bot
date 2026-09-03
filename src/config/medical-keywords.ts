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
  'tali pusat',
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
  'jahitan pasca melahirkan',
  'jahitan nifas',
  'nyeri jahitan',
  'darah nifas berbau',
  'payudara bengkak keras',
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
