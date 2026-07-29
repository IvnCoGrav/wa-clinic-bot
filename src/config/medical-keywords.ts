/**
 * Medical Keywords Configuration for High & Medium Severity Symptoms
 * Isolated config file easily expandable by medical staff & developers.
 */

// HIGH Severity Symptoms & Urgent Medical Emergencies (Directs to IGD / Ambulance 119)
export const HIGH_SEVERITY_MEDICAL_KEYWORDS: string[] = [
  // Qualitative & Quantitative Fever / Heat
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
export const MEDIUM_SEVERITY_MEDICAL_KEYWORDS: string[] = [
  // Navel & Skin Concerns
  'tali pusat',
  'pusar berbau',
  'pusar berdarah',
  'pusar bernanah',
  'ruam tali pusat',
  'bintik-bintik merah',
  'bintik merah',
  'ruam parah',
  'kulit mengelupas',
  'bisul',
  'bentol-bentol',

  // Postpartum & Maternal Health Concerns
  'jahitan pasca melahirkan',
  'jahitan nifas',
  'nyeri jahitan',
  'darah nifas berbau',
  'payudara bengkak keras',
  'mastitis',

  // Infant Gastrointestinal & General Health
  'diare',
  'mencret',
  'bab berdarah',
  'bab berbusa',
  'muntah',
  'kembung parah',
  'kolik',
  'bayi menangis tanpa henti',
  'kuning',
  'bayi kuning',
  'ikterus',
  'jamur lidah',
  'ruam popok parah',
  'alergi asi',
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

  // 1. Check High Severity Keywords
  for (const keyword of HIGH_SEVERITY_MEDICAL_KEYWORDS) {
    if (normalizedText.includes(keyword)) {
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
    if (normalizedText.includes(keyword)) {
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
