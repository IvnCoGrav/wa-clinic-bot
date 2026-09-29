/**
 * Age Calculator Engine
 * - Mengestimasi birth_date dari teks usia Indonesia ("6 bulan", "1 tahun 2 bulan", "10 hari").
 * - Menghitung usia SAAT INI (dinamis terhadap hari ini) dari birth_date atau snapshot usia.
 * - Menghitung usia kehamilan/nifas Moms secara dinamis (computeGestationalAge).
 *
 * Satu sumber kebenaran untuk klasifikasi entitas Moms vs Anak: `isGestationalText`.
 */

export interface AgeInput {
  birthDate?: Date | null;
  ageMonthsAtRegistration?: number | null;
  registeredAt?: Date | null;
  rawAgeText?: string | null;
}

export interface AgeEstimate {
  birthDate: Date | null;
  totalDays: number | null;
  /** Rentang ("1-2 bulan") → ambil batas bawah, tandai tidak presisi. */
  approximate: boolean;
  /** Angka telanjang ("8") atau teks tanpa unit → tidak bisa ditebak. */
  unparseable: boolean;
  /** Teks merujuk usia kehamilan/nifas (Moms), BUKAN usia anak yang sudah lahir. */
  gestational: boolean;
  /**
   * Teks memuat LEBIH DARI SATU subjek/usia (mis. "2 bln & 3 thn") → JANGAN
   * dijumlahkan menjadi satu usia. Pemanggil wajib memecah per subjek atau flag.
   */
  multiSubject: boolean;
}

export interface GestationalAgeInput {
  registeredAt: Date;
  gestationalWeeksAtReg: number;
  today?: Date;
}

export interface GestationalAgeResult {
  isPregnant: boolean;
  currentWeeks: number;
  stageLabel: string;
}

export interface MomGestationalInfo {
  isPregnant: boolean;
  currentWeeks?: number;
  stageLabel: string;
}

const YEAR_DAYS = 365.25;
const MONTH_DAYS = 30.44;
const DAY_MS = 1000 * 60 * 60 * 24;
const MS_PER_WEEK = 7 * DAY_MS;
/** Ambang klinis: lewat 41 minggu → Pasca Salin / Nifas. (Hardcode sementara — lihat KNOWN_ISSUES.) */
const GESTATIONAL_MAX_WEEKS = 41;

/**
 * Kata kunci klinis entitas Moms (kehamilan/nifas/menyusui). Deterministik pada
 * entitas, BUKAN pencocokan kalimat intent. Dipakai oleh SEMUA parser usia agar
 * "hamil 38 minggu" tidak pernah dikonversi menjadi usia anak (bug data korup).
 */
const GESTATIONAL_PHRASES = [
  'pasca salin',
  'paska salin',
  'pasca melahirkan',
  'paska melahirkan',
  'pasca persalinan',
  'paska persalinan',
  'ibu hamil',
  'ibu menyusui',
];

const GESTATIONAL_TOKENS = [
  'hamil',
  'kehamilan',
  'kandungan',
  'trimester',
  'bumil',
  'janin',
  'nifas',
  'postpartum',
  'menyusui',
  'laktasi',
  'prenatal',
  'oksitosin',
  'perineum',
  'induksi',
];

/** True bila teks merujuk kehamilan/nifas (Moms) — bukan usia anak. */
export function isGestationalText(ageText: string | null | undefined): boolean {
  if (!ageText || typeof ageText !== 'string') return false;
  const lower = ageText.toLowerCase();
  if (GESTATIONAL_PHRASES.some((p) => lower.includes(p))) return true;
  return GESTATIONAL_TOKENS.some((t) => new RegExp(`(?:^|[^a-z])${t}`, 'i').test(lower));
}

function toDays(value: number, unit: string): number {
  const u = unit.toLowerCase();
  if (/^(tahun|thn|taon|th)$/.test(u)) return value * YEAR_DAYS;
  if (/^(bulan|bln|bl)$/.test(u)) return value * MONTH_DAYS;
  if (/^(minggu|mgg|mg|week)$/.test(u)) return value * 7;
  return value; // hari | hr | day
}

const UNIT_ALT = 'tahun|thn|taon|th|bulan|bln|bl|minggu|mgg|mg|week|hari|hr|day';

/**
 * Estimasi usia dari teks Indonesia dengan metadata ketidakpastian.
 * - Teks kehamilan → `gestational: true` (tidak pernah jadi usia anak).
 * - Angka telanjang ("8") → `unparseable: true` (DILARANG ditebak).
 * - Rentang ("1-2 bulan") → ambil batas bawah, `approximate: true`.
 * - "10 bulan kurang 6 hari" → total dikurangi, presisi hari dipertahankan.
 */
export function parseAgeTextEstimate(ageText: string, referenceDate: Date = new Date()): AgeEstimate {
  const empty: AgeEstimate = { birthDate: null, totalDays: null, approximate: false, unparseable: true, gestational: false, multiSubject: false };
  if (!ageText || typeof ageText !== 'string') return empty;
  const lower = ageText.toLowerCase().trim();
  if (!lower) return empty;

  if (isGestationalText(lower)) {
    return { birthDate: null, totalDays: null, approximate: false, unparseable: false, gestational: true, multiSubject: false };
  }

  // Angka telanjang tanpa unit → ambigu (hari? minggu? bulan?), jangan ditebak.
  if (/^\d+(?:[.,]\d+)?$/.test(lower)) {
    return empty;
  }

  // Multi-subjek: dua usia digabung ("2 bln & 3 thn", "9bulan, 5th,3th", "8 & 2.5 th")
  // DILARANG dijumlahkan jadi satu usia — pemanggil harus memecah per anak.
  // - Separator kuat (& ; + dan): ≥2 token angka → multi.
  // - Unit berulang ("5th,3th") → multi.
  // - Koma desimal ("1,5 tahun") BUKAN pemisah (comma diapit digit).
  const strongSep = /[&;+]|\bdan\b/.test(lower);
  const numericTokens = (lower.match(/\d+(?:[.,]\d+)?/g) || []).length;
  const units = lower.match(new RegExp(`(?:${UNIT_ALT})\\b`, 'gi')) || [];
  const repeatedUnit = new Set(units.map((u) => u.toLowerCase())).size < units.length;
  if ((strongSep && numericTokens >= 2) || repeatedUnit) {
    return { birthDate: null, totalDays: null, approximate: false, unparseable: false, gestational: false, multiSubject: true };
  }

  let approximate = false;
  let totalDays: number | null = null;

  // "10 bulan kurang 6 hari" → pengurangan presisi.
  const kurang = lower.match(
    new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_ALT})\\s*kurang\\s*(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_ALT})?`)
  );
  if (kurang) {
    const a = parseFloat(kurang[1].replace(',', '.')) || 0;
    const b = parseFloat(kurang[3].replace(',', '.')) || 0;
    const unitB = kurang[4] || kurang[2];
    totalDays = toDays(a, kurang[2]) - toDays(b, unitB);
  }

  // Rentang "1-2 bulan" / "1 - 2 bulan" → ambil batas bawah.
  if (totalDays == null) {
    const range = lower.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*[-–]\\s*(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_ALT})\\b`));
    if (range) {
      approximate = true;
      const a = parseFloat(range[1].replace(',', '.')) || 0;
      totalDays = toDays(a, range[3]);
    }
  }

  if (totalDays == null) {
    const re = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_ALT})\\b`, 'gi');
    let sum = 0;
    let matched = false;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lower)) !== null) {
      matched = true;
      sum += toDays(parseFloat(m[1].replace(',', '.')) || 0, m[2]);
    }
    if (matched) totalDays = sum;
  }

  if (totalDays == null) return empty;

  const birth = new Date(referenceDate);
  birth.setDate(birth.getDate() - Math.floor(totalDays));
  return { birthDate: birth, totalDays, approximate, unparseable: false, gestational: false, multiSubject: false };
}

/**
 * Ekstrak total usia dalam bulan langsung dari teks usia Indonesia.
 * Contoh: "6 bulan" → 6; "1 tahun 2 bulan" → 14; "1 tahun" → 12.
 * Mengembalikan null jika teks kehamilan atau tidak memuat unit usia bulan/tahun.
 */
export function parseAgeTextToMonths(ageText: string): number | null {
  if (!ageText || typeof ageText !== 'string') return null;
  const lower = ageText.toLowerCase();

  // Teks konteksnya usia kehamilan/ibu hamil/nifas, bukan usia anak yang sudah lahir.
  if (isGestationalText(lower)) return null;

  // Bayi baru lahir
  if (/\b(newborn|baru\s+lahir|nb)\b/i.test(lower)) return 0;

  let years = 0;
  let months = 0;

  const yearMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*(?:tahun|thn|th\b|taon)\b/);
  if (yearMatch) years = parseFloat(yearMatch[1].replace(',', '.')) || 0;

  const monthMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*(?:bulan|bln|bl\b)\b/);
  if (monthMatch) months = parseFloat(monthMatch[1].replace(',', '.')) || 0;

  if (years !== 0 || months !== 0) {
    return Math.round(years * 12 + months);
  }

  // Hari -> bulan
  const dayMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*(?:hari|hr)\b/);
  if (dayMatch) {
    const days = parseFloat(dayMatch[1].replace(',', '.')) || 0;
    return Math.round((days / MONTH_DAYS) * 10) / 10;
  }

  // Minggu -> bulan
  const weekMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*(?:minggu|mgg|mg)\b/);
  if (weekMatch) {
    const weeks = parseFloat(weekMatch[1].replace(',', '.')) || 0;
    return Math.round(((weeks * 7) / MONTH_DAYS) * 10) / 10;
  }

  return null;
}

/**
 * Estimasi tanggal lahir dari teks usia Indonesia.
 * Teks kehamilan/nifas & angka telanjang → null (tidak pernah jadi usia anak).
 */
export function parseAgeTextToBirthDate(ageText: string, referenceDate: Date = new Date()): Date | null {
  return parseAgeTextEstimate(ageText, referenceDate).birthDate;
}

/** Selisih bulan penuh antara dua tanggal (min 0). */
export function monthsBetween(from: Date, to: Date): number {
  if (!from || !to || to < from) return 0;
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  return Math.max(0, months);
}

/** Selisih hari penuh antara dua tanggal (min 0). */
export function daysBetween(from: Date, to: Date): number {
  if (!from || !to || to < from) return 0;
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / DAY_MS);
}

/** Tambah `months` bulan kalender ke tanggal (clamp akhir bulan). */
function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const targetMonth = d.getMonth() + months;
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(targetMonth);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

/** Format total bulan → string usia Indonesia. */
export function formatAgeFromMonths(totalMonths: number): string {
  if (totalMonths <= 0) return 'Baru lahir';
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  if (years === 0) return `${months} bulan`;
  if (months === 0) return `${years} tahun`;
  return `${years} tahun ${months} bulan`;
}

/**
 * Format usia klinis seragam, presisi hari terhadap `today`:
 * - < 30 hari            → "X hari"
 * - 30 hari s/d 2 tahun  → "X bulan Y hari" (Y dihilangkan bila 0)
 * - > 2 tahun            → "X tahun Y bulan" (Y dihilangkan bila 0)
 */
export function formatClinicalAge(birthDate: Date, today: Date = new Date()): string {
  const totalDays = daysBetween(birthDate, today);
  if (totalDays <= 0) return 'Baru lahir';
  if (totalDays < 30) return `${totalDays} hari`;

  const months = monthsBetween(birthDate, today);
  if (totalDays < 730) {
    if (months < 1) return `${totalDays} hari`;
    const remDays = daysBetween(addMonths(birthDate, months), today);
    return remDays > 0 ? `${months} bulan ${remDays} hari` : `${months} bulan`;
  }

  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  return remMonths > 0 ? `${years} tahun ${remMonths} bulan` : `${years} tahun`;
}

/**
 * Hitung usia SAAT INI (dinamis terhadap `today`, default hari ini).
 * Prioritas: birth_date → snapshot usia + waktu berlalu → estimasi on-the-fly
 * dari rawAgeText + registeredAt (agar data lama tanpa birth_date tetap tumbuh).
 */
export function computeCurrentAge(input: AgeInput, today: Date = new Date()): string {
  if (input.birthDate) {
    return formatClinicalAge(input.birthDate, today);
  }

  if (input.ageMonthsAtRegistration != null && input.ageMonthsAtRegistration >= 0) {
    if (input.registeredAt) {
      const elapsed = monthsBetween(input.registeredAt, today);
      return formatAgeFromMonths(input.ageMonthsAtRegistration + elapsed);
    }
    return formatAgeFromMonths(input.ageMonthsAtRegistration);
  }

  // On-the-fly: data lama tanpa birth_date tetap aktif bertambah hari.
  if (input.rawAgeText) {
    if (isGestationalText(input.rawAgeText)) return '';
    const anchor = input.registeredAt || today;
    const est = parseAgeTextEstimate(input.rawAgeText, anchor);
    if (est.birthDate) return formatClinicalAge(est.birthDate, today);
  }

  return '';
}

/**
 * Engine usia kehamilan/nifas dinamis.
 * - `currentWeeks = gestationalWeeksAtReg + elapsedWeeks`.
 * - ≤ 41 minggu → PREGNANT ("Hamil X minggu (Trimester Y)").
 * - > 41 minggu → POSTPARTUM ("Pasca Salin / Nifas (~Z minggu)").
 */
export function computeGestationalAge(input: GestationalAgeInput): GestationalAgeResult {
  const today = input.today || new Date();
  const elapsedMs = Math.max(0, today.getTime() - input.registeredAt.getTime());
  const elapsedWeeks = Math.floor(elapsedMs / MS_PER_WEEK);
  const currentWeeks = Math.max(0, Math.floor(input.gestationalWeeksAtReg) + elapsedWeeks);

  if (currentWeeks <= GESTATIONAL_MAX_WEEKS) {
    const trimester = currentWeeks <= 13 ? 1 : currentWeeks <= 27 ? 2 : 3;
    return { isPregnant: true, currentWeeks, stageLabel: `Hamil ${currentWeeks} minggu (Trimester ${trimester})` };
  }

  const postpartumWeeks = currentWeeks - 40;
  return { isPregnant: false, currentWeeks, stageLabel: `Pasca Salin / Nifas (~${postpartumWeeks} minggu)` };
}

/**
 * Ambil usia kehamilan (minggu) dari teks bebas, mis. "hamil 38 minggu",
 * "UK 30 weeks", "usia kandungan 20 mg". Null bila tidak ada penanda kehamilan
 * atau angka minggu tidak ditemukan.
 */
export function extractGestationalWeeks(text: string | null | undefined): number | null {
  if (!text || typeof text !== 'string') return null;
  const lower = text.toLowerCase();
  const hasPregnancy = /hamil|kehamilan|kandungan|\buk\b|trimester|janin|bumil/.test(lower);
  if (!hasPregnancy) return null;
  const m = lower.match(/(\d{1,2})\s*(?:minggu|mgg|mg|week)/);
  if (!m) return null;
  const w = parseInt(m[1], 10);
  return w >= 1 && w <= 45 ? w : null;
}

/**
 * Resolusi info gestasional Moms untuk badge dashboard — pure & deterministik.
 * Prioritas: minggu gestasional eksplisit dari teks → engine dinamis;
 * selain itu deteksi nifas → POSTPARTUM; jika tidak ada penanda → isPregnant:false.
 */
export function resolveMomGestationalInfo(params: {
  text?: string | null;
  treatmentCategory?: string | null;
  registeredAt?: Date | null;
  today?: Date;
}): MomGestationalInfo {
  const { text, treatmentCategory, registeredAt, today = new Date() } = params;
  const cat = String(treatmentCategory || '').toUpperCase();
  const isMomContext = cat === 'MOMS' || cat === 'BOTH' || isGestationalText(text);
  if (!isMomContext) return { isPregnant: false, stageLabel: '' };

  const weeks = extractGestationalWeeks(text);
  if (weeks != null) {
    const anchor = registeredAt || today;
    return computeGestationalAge({ registeredAt: anchor, gestationalWeeksAtReg: weeks, today });
  }

  const lower = String(text || '').toLowerCase();
  if (/nifas|pasca salin|paska salin|postpartum|menyusui|laktasi|pasca melahirkan|paska melahirkan/.test(lower)) {
    return { isPregnant: false, stageLabel: 'Pasca Salin / Nifas' };
  }
  if (cat === 'MOMS') return { isPregnant: false, stageLabel: 'Ibu (data kehamilan belum spesifik)' };
  return { isPregnant: false, stageLabel: '' };
}
