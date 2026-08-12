/**
 * Age Calculator Engine
 * - Mengestimasi birth_date dari teks usia Indonesia ("6 bulan", "1 tahun 2 bulan", "10 hari").
 * - Menghitung usia SAAT INI (dinamis terhadap hari ini) dari birth_date atau snapshot usia.
 */

export interface AgeInput {
  birthDate?: Date | null;
  ageMonthsAtRegistration?: number | null;
  registeredAt?: Date | null;
  rawAgeText?: string | null;
}

const YEAR_DAYS = 365.25;
const MONTH_DAYS = 30.44;

/**
 * Ekstrak total usia dalam bulan langsung dari teks usia Indonesia.
 * Contoh: "6 bulan" → 6; "1 tahun 2 bulan" → 14; "1 tahun" → 12.
 * Mengembalikan null jika teks tidak memuat unit usia bulan/tahun.
 */
export function parseAgeTextToMonths(ageText: string): number | null {
  if (!ageText || typeof ageText !== 'string') return null;
  const lower = ageText.toLowerCase();

  let years = 0;
  let months = 0;

  const yearMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*(?:tahun|thn|th\b|taon)\b/);
  if (yearMatch) years = parseFloat(yearMatch[1].replace(',', '.')) || 0;

  const monthMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*(?:bulan|bln|bl\b)\b/);
  if (monthMatch) months = parseFloat(monthMatch[1].replace(',', '.')) || 0;

  if (years === 0 && months === 0) return null;
  return Math.round(years * 12 + months);
}

/**
 * Estimasi tanggal lahir dari teks usia Indonesia.
 * Contoh: "6 bulan" → referenceDate - 6 bulan; "1 tahun 2 bulan" → -14 bulan;
 * "3 minggu" → -21 hari; "10 hari" → -10 hari.
 * Mengembalikan null jika teks tidak bisa di-parse.
 */
export function parseAgeTextToBirthDate(ageText: string, referenceDate: Date = new Date()): Date | null {
  if (!ageText || typeof ageText !== 'string') return null;
  const lower = ageText.toLowerCase();

  const numberRe = /(\d+(?:[.,]\d+)?)/;

  let years = 0;
  let months = 0;
  let weeks = 0;
  let days = 0;

  const yearMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*(?:tahun|thn|th\b|taon)\b/);
  if (yearMatch) years = parseFloat(yearMatch[1].replace(',', '.')) || 0;

  const monthMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*(?:bulan|bln|bl\b)\b/);
  if (monthMatch) months = parseFloat(monthMatch[1].replace(',', '.')) || 0;

  const weekMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*(?:minggu|mgg?|week)\b/);
  if (weekMatch) weeks = parseFloat(weekMatch[1].replace(',', '.')) || 0;

  // "hari" harus dicek di sisa teks SETELAH unit terakhir (tahun/bulan/minggu),
  // supaya "3 minggu 2 hari" tidak tertangkap sebagai "3 hari".
  let lastUnitEnd = 0;
  for (const m of [yearMatch, monthMatch, weekMatch]) {
    if (m) lastUnitEnd = Math.max(lastUnitEnd, lower.indexOf(m[0]) + m[0].length);
  }
  const afterUnit = lower.slice(lastUnitEnd);
  const dayMatch = afterUnit.match(numberRe);
  if (dayMatch && /\b(?:hari|hr|day)\b/.test(lower)) {
    days = parseFloat(dayMatch[1].replace(',', '.')) || 0;
  }

  if (years === 0 && months === 0 && weeks === 0 && days === 0) {
    // Coba format "X hari" dengan kata hari eksplisit
    const fallbackDay = lower.match(/(\d+(?:[.,]\d+)?)\s*(?:hari|hr|day)\b/);
    if (fallbackDay) days = parseFloat(fallbackDay[1].replace(',', '.')) || 0;
  }

  if (years === 0 && months === 0 && weeks === 0 && days === 0) return null;

  const totalDays = years * YEAR_DAYS + months * MONTH_DAYS + weeks * 7 + days;
  const birth = new Date(referenceDate);
  birth.setDate(birth.getDate() - Math.floor(totalDays));
  return birth;
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
  return Math.floor(ms / (1000 * 60 * 60 * 24));
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
 * Hitung usia SAAT INI (dinamis terhadap `today`, default hari ini).
 * Prioritas: birth_date → snapshot usia + waktu berlalu → snapshot usia statis.
 */
export function computeCurrentAge(input: AgeInput, today: Date = new Date()): string {
  if (input.birthDate) {
    const months = monthsBetween(input.birthDate, today);
    if (months < 1) {
      const days = daysBetween(input.birthDate, today);
      return days <= 0 ? 'Baru lahir' : `${days} hari`;
    }
    return formatAgeFromMonths(months);
  }

  if (input.ageMonthsAtRegistration != null && input.ageMonthsAtRegistration >= 0) {
    if (input.registeredAt) {
      const elapsed = monthsBetween(input.registeredAt, today);
      return formatAgeFromMonths(input.ageMonthsAtRegistration + elapsed);
    }
    return formatAgeFromMonths(input.ageMonthsAtRegistration);
  }

  return '';
}
