/**
 * reservation-date-parser.ts
 * Helper kanonis untuk parsing tanggal & waktu bahasa Indonesia dalam timezone WIB (UTC+7).
 *
 * UTL-02 & UTL-03:
 * - Determinisme timezone WIB kebal terhadap host process lokal (UTC / dev / container).
 * - Modul terfokus hasil refaktor pemecahan God Object reservation-text-parser.ts.
 */

/**
 * Menghitung index hari (0=Minggu, 1=Senin, ..., 6=Sabtu) dalam timezone WIB (UTC+7),
 * sepenuhnya deterministik dan kebal terhadap timezone server host (UTC, London, dll).
 */
export function getWibDayOfWeek(date: Date): number {
  const wibTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return wibTime.getUTCDay();
}

/**
 * Helper untuk membuat objek Date dengan timezone WIB (+07:00).
 */
export function createWibDate(
  year: number,
  monthZeroIndexed: number,
  day: number,
  hours: number,
  minutes: number
): Date {
  const y = String(year).padStart(4, '0');
  const mo = String(monthZeroIndexed + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  const h = String(hours).padStart(2, '0');
  const mi = String(minutes).padStart(2, '0');
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:00+07:00`);
}

/**
 * Cross-validation HARI vs ANGKA TANGGAL.
 *
 * Customer sering menulis hari dan tanggal yang tidak sinkron (mis. "Selasa, 21
 * September 2026" padahal 21 Sep 2026 = Senin) — slip 1 hari adalah typo manusia
 * yang sangat umum. Bila nama hari eksplisit tertulis dan selisihnya TEPAT ±1 hari
 * dari tanggal numerik, snap ke tanggal yang cocok dengan nama hari. Selisih > 1
 * hari diperlakukan sebagai kontradiksi berat → nama hari diabaikan (tanggal numerik
 * menang) agar tidak melompat liar ke tanggal tak terduga.
 */
export const WRITTEN_DAY_NAMES: Record<string, number> = {
  minggu: 0, ahad: 0,
  senin: 1,
  selasa: 2,
  rabu: 3,
  kamis: 4,
  jumat: 5, "jum'at": 5,
  sabtu: 6,
};

export function findWrittenDayOfWeek(cleanStr: string): number | undefined {
  if (!cleanStr) return undefined;
  const lower = cleanStr.toLowerCase();
  for (const [name, dayOfWeek] of Object.entries(WRITTEN_DAY_NAMES)) {
    const pattern = new RegExp(`(?:^|[^a-z])${name.replace("'", "['’]?")}(?:[^a-z]|$)`, 'i');
    if (pattern.test(lower)) return dayOfWeek;
  }
  return undefined;
}

/** Nama hari Indonesia dari index getDay() (0=Minggu). */
export const ID_DAY_NAMES = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];

/**
 * 152c — Deteksi kontradiksi nama-hari vs tanggal numerik yang TIDAK terselaraskan.
 * Slip ±1 hari sudah diperbaiki `reconcileWrittenDayWithDate`; sisa selisih
 * (≥2 hari) = kontradiksi berat → laporkan untuk catatan staf. Murni.
 */
export function detectDateMismatch(
  candidate: Date,
  cleanStr: string
): { mismatch: boolean; writtenDay?: string; actualDay?: string } {
  const written = findWrittenDayOfWeek(cleanStr);
  if (written === undefined) return { mismatch: false };
  const actual = getWibDayOfWeek(candidate);
  if (written === actual) return { mismatch: false };
  const writtenName = ID_DAY_NAMES[written];
  const actualName = ID_DAY_NAMES[actual];
  return { mismatch: true, writtenDay: writtenName, actualDay: actualName };
}

export function reconcileWrittenDayWithDate(candidate: Date, cleanStr: string): Date {
  const writtenDay = findWrittenDayOfWeek(cleanStr);
  if (writtenDay === undefined) return candidate;
  const candidateWibDay = getWibDayOfWeek(candidate);
  const diff = (writtenDay - candidateWibDay + 7) % 7;
  // diff 0 = konsisten; 1 = tanggal maju 1 hari; 6 = tanggal mundur 1 hari (slip -1).
  if (diff === 0) return candidate;
  if (diff === 1 || diff === 6) {
    const corrected = new Date(candidate.getTime() + (diff === 1 ? 1 : -1) * 24 * 60 * 60 * 1000);
    if (!isNaN(corrected.getTime())) return corrected;
  }
  return candidate;
}

/**
 * Map nama bulan Indonesia ke angka index 0-11
 */
const IND_MONTHS: Record<string, number> = {
  jan: 0, januari: 0, january: 0,
  feb: 1, februari: 1, february: 1,
  mar: 2, maret: 2, march: 2,
  apr: 3, april: 3,
  mei: 4, may: 4,
  jun: 5, juni: 5, june: 5,
  jul: 6, juli: 6, july: 6,
  agt: 7, agu: 7, ags: 7, agustus: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  okt: 9, oktober: 9, october: 9,
  nov: 10, november: 10,
  des: 11, desember: 11, december: 11,
};

export function tryParseIndonesianDate(dateStr: string, referenceDate?: Date): Date | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const cleanStr = dateStr.toLowerCase().replace(/[*_~`]/g, '').trim();
  if (!cleanStr) return null;

  const now = referenceDate || new Date();
  // Waktu referensi dalam WIB (UTC+7)
  const wibTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const currentYear = wibTime.getUTCFullYear();

  // 1. Ekstrak Jam & Menit jika ada
  let hours = 9; // Default jam kunjungan klinik (09:00 WIB) jika jam tidak disebutkan
  let minutes = 0;
  let hasExplicitTime = false;

  // Cek kata penunjuk waktu: siang/sore/malam/pagi
  let isPmModifier = false;
  if (/siang|sore|malam/i.test(cleanStr)) {
    isPmModifier = true;
  }

  // Cari pola waktu spesifik:
  // - "jam 10.00", "pukul 14.30", "pk 09.00", "@10.00"
  // - "jam 10", "pukul 2", "pk 1"
  // - "10.00 wib", "14.30 wit"
  // - "10:00" (dengan titik dua murni, bukan titik tanggal)
  const explicitTimeMatch =
    cleanStr.match(/(?:jam|pukul|pk|@)\s*(\d{1,2})[.:](\d{2})(?:\s*(?:wib|wit|wita))?(?:\s*[-–]\s*\d{1,2}[.:]\d{2})?/i) ||
    cleanStr.match(/(?:jam|pukul|pk|@)\s*(\d{1,2})(?:\s*(?:wib|wit|wita))?(?:\s*[-–]\s*\d{1,2})?(?!\d)/i) ||
    cleanStr.match(/\b(\d{1,2})[.:](\d{2})\s*(?:wib|wit|wita)\b/i) ||
    cleanStr.match(/(?:^|\s)(\d{1,2}):(\d{2})(?:\s*(?:wib|wit|wita))?(?:\s*[-–]\s*\d{1,2}:\d{2})?(?:\s|$)/i);

  if (explicitTimeMatch) {
    let h = parseInt(explicitTimeMatch[1], 10);
    const m = explicitTimeMatch[2] ? parseInt(explicitTimeMatch[2], 10) : 0;
    if (isPmModifier && h >= 1 && h <= 11) {
      h += 12;
    }
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      hours = h;
      minutes = m;
      hasExplicitTime = true;
    }
  }

  // 2. Format ISO YYYY-MM-DD (pemisah -, /, .)
  const isoMatch = cleanStr.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    const date = createWibDate(year, month, day, hours, minutes);
    if (!isNaN(date.getTime())) return reconcileWrittenDayWithDate(date, cleanStr);
  }

  // 3. Format DD-MM-YYYY atau DD-MM-YY (pemisah -, /, .)
  const indNumMatch = cleanStr.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (indNumMatch) {
    let year = parseInt(indNumMatch[3], 10);
    if (year < 100) year += 2000;
    const month = parseInt(indNumMatch[2], 10) - 1;
    const day = parseInt(indNumMatch[1], 10);
    const date = createWibDate(year, month, day, hours, minutes);
    if (!isNaN(date.getTime())) return reconcileWrittenDayWithDate(date, cleanStr);
  }

  // 4. Format Teks Bulan: "sbtu 29 agt 26 jam 09.00", "Selasa, 21 Juli 2026", "29 agt 2026", "29 agustus jam 10.00"
  const textMatch = cleanStr.match(/(\d{1,2})\s+([a-z]+)(?:\s+(\d{2,4}))?/i);
  if (textMatch) {
    const day = parseInt(textMatch[1], 10);
    const monthName = textMatch[2].toLowerCase();
    const rawYear = textMatch[3];
    const month = IND_MONTHS[monthName];

    if (month !== undefined && day >= 1 && day <= 31) {
      let year = rawYear ? parseInt(rawYear, 10) : currentYear;
      if (year < 100) year += 2000;
      const date = createWibDate(year, month, day, hours, minutes);
      if (!isNaN(date.getTime())) return reconcileWrittenDayWithDate(date, cleanStr);
    }
  }

  // 4b. Tanggal numerik mustahil ("41 September", "99 September"): JANGAN diam-diam
  // jatuh ke fallback nama-hari (+7 hari memalsukan jadwal). Coba pemulihan transposisi
  // digit (41 -> 14); bila tak pulih, return null.
  const badDayMatch = cleanStr.match(/(\d{2,})\s+([a-z]+)(?:\s+(\d{2,4}))?/i);
  if (badDayMatch) {
    const badDay = parseInt(badDayMatch[1], 10);
    const badMonth = IND_MONTHS[badDayMatch[2].toLowerCase()];
    if (badMonth !== undefined && badDay > 31) {
      const digits = String(badDay);
      let rawYear = badDayMatch[3];
      let year = rawYear ? parseInt(rawYear, 10) : currentYear;
      if (year < 100) year += 2000;
      if (digits.length === 2) {
        const swapped = parseInt(digits[1] + digits[0], 10);
        if (swapped >= 1 && swapped <= 31) {
          const candidate = createWibDate(year, badMonth, swapped, hours, minutes);
          if (!isNaN(candidate.getTime())) {
            const written = findWrittenDayOfWeek(cleanStr);
            // Tanpa nama hari tertulis, atau hari cocok dengan hasil transposisi -> pulihkan.
            if (written === undefined || written === getWibDayOfWeek(candidate)) return candidate;
          }
        }
      }
      return null;
    }
  }

  // 5. Format Kata Relatif: "hari ini", "besok", "lusa"
  if (cleanStr.includes('hari ini')) {
    return createWibDate(wibTime.getUTCFullYear(), wibTime.getUTCMonth(), wibTime.getUTCDate(), hours, minutes);
  }
  if (cleanStr.includes('besok')) {
    const tomorrow = new Date(wibTime.getTime() + 24 * 60 * 60 * 1000);
    return createWibDate(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), hours, minutes);
  }
  if (cleanStr.includes('lusa')) {
    const lusa = new Date(wibTime.getTime() + 48 * 60 * 60 * 1000);
    return createWibDate(lusa.getUTCFullYear(), lusa.getUTCMonth(), lusa.getUTCDate(), hours, minutes);
  }

  // 6. Format Nama Hari: "senin", "selasa", "rabu", "kamis", "jumat", "sabtu", "minggu"
  for (const [dName, targetDayOfWeek] of Object.entries(WRITTEN_DAY_NAMES)) {
    if (cleanStr.includes(dName)) {
      const currentDayOfWeek = wibTime.getUTCDay();
      let diff = targetDayOfWeek - currentDayOfWeek;
      if (diff <= 0) diff += 7; // Ambil hari tersebut di minggu ini/mendatang
      const targetDate = new Date(wibTime.getTime() + diff * 24 * 60 * 60 * 1000);
      return createWibDate(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), hours, minutes);
    }
  }

  // Jika formatnya tidak dikenali sama sekali
  return null;
}
