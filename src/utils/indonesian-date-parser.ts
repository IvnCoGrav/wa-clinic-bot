/**
 * src/utils/indonesian-date-parser.ts
 * Parser tanggal bahasa Indonesia (deterministik, zero-dependency).
 * Menangani format relatif (besok, lusa), hari, nama bulan ID/EN, dan jam.
 */

const INDONESIAN_MONTHS: Record<string, number> = {
  januari: 0, jan: 0, january: 0,
  februari: 1, feb: 1, february: 1,
  maret: 2, mar: 2, march: 2,
  april: 3, apr: 3,
  mei: 4, may: 4,
  juni: 5, jun: 5, june: 5,
  juli: 6, jul: 6, july: 6,
  agustus: 7, agu: 7, ags: 7, agt: 7, agust: 7, august: 7,
  september: 8, sep: 8, sept: 8,
  oktober: 9, okt: 9, october: 9,
  november: 10, nov: 10,
  desember: 11, des: 11, december: 11,
};

const DAY_NAME_TO_INDEX: Record<string, number> = {
  minggu: 0, ahad: 0,
  senin: 1,
  selasa: 2,
  rabu: 3,
  kamis: 4,
  jumat: 5, "jum'at": 5,
  sabtu: 6,
};

// #157k: default jam booking = 09:00 WIB. Container produksi TZ=UTC, sehingga
// `setHours(9)` (jam LOKAL) menghasilkan 09:00 UTC = 16:00 WIB (drift 7 jam).
// Semua komputasi kalender WAJIB memakai field UTC pada Date yang sudah digeser
// WIB, lalu dikembalikan ke UTC absolut — TIDAK boleh bergantung TZ proses.
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DEFAULT_BOOKING_HOUR_WIB = 9;

/** Konversi komponen kalender WIB → Date UTC absolut (jam 09:00 WIB default). */
function wibCalendarToUtc(
  year: number,
  month: number,
  day: number,
  hourWib = DEFAULT_BOOKING_HOUR_WIB,
  minuteWib = 0
): Date {
  return new Date(Date.UTC(year, month, day, hourWib, minuteWib, 0, 0) - WIB_OFFSET_MS);
}

/** Proyeksi Date ke komponen kalender WIB (baca via getUTC*). */
function toWibParts(d: Date): { year: number; month: number; day: number; dayOfWeek: number } {
  const wib = new Date(d.getTime() + WIB_OFFSET_MS);
  return {
    year: wib.getUTCFullYear(),
    month: wib.getUTCMonth(),
    day: wib.getUTCDate(),
    dayOfWeek: wib.getUTCDay(),
  };
}

export interface DateParserOptions {
  /**
   * Jika true (default untuk live booking): tanggal yang jatuh sebelum hari ini (WIB)
   * digulir ke kemunculan berikutnya di masa depan.
   * Jika false (untuk transkrip/data historis): tanggal lampau dipertahankan apa adanya.
   */
  rollPastToFuture?: boolean;

  /**
   * Jika true (default untuk chat aktif): mendukung kata relatif ('hari ini', 'besok', 'lusa', nama hari).
   * Jika false (untuk dokumen/form historis): kata relatif tanpa tanggal kalender eksplisit ditolak.
   */
  allowRelative?: boolean;

  /**
   * Jam default WIB jika tidak ada jam eksplisit di input (default = 9).
   */
  defaultHourWib?: number;
}

export interface ParsedIndonesianDate {
  date: Date;
  isRecognized: boolean;
  rawMatched: string;
}

export function parseIndonesianDate(
  input: string,
  referenceDate: Date = new Date(),
  options: DateParserOptions = {}
): ParsedIndonesianDate {
  if (!input || typeof input !== 'string') {
    return { date: referenceDate, isRecognized: false, rawMatched: '' };
  }

  const clean = input.toLowerCase().replace(/[*_~`]/g, '').trim();
  if (!clean) {
    return { date: referenceDate, isRecognized: false, rawMatched: '' };
  }

  const {
    rollPastToFuture: shouldRoll = true,
    allowRelative = true,
    defaultHourWib = DEFAULT_BOOKING_HOUR_WIB
  } = options;

  const refWib = toWibParts(referenceDate);

  // Ekstrak jam eksplisit jika tersedia di input (mis. "jam 12.30", "14:00 WIB", "jam 10", "23:59")
  let hourWib = defaultHourWib;
  let minuteWib = 0;
  const explicitTimeMatch = clean.match(/(?:jam|pukul)\s*(\d{1,2})[.:](\d{2})/i) ||
                            clean.match(/\b([01]?\d|2[0-3])[.:]([0-5]\d)(?:\s*wib)?\b/i) ||
                            clean.match(/(?:jam|pukul)\s*(\d{1,2})\b/i);
  if (explicitTimeMatch) {
    const h = parseInt(explicitTimeMatch[1], 10);
    const m = explicitTimeMatch[2] ? parseInt(explicitTimeMatch[2], 10) : 0;
    if (!isNaN(h) && h >= 0 && h <= 23 && !isNaN(m) && m >= 0 && m <= 59) {
      hourWib = h;
      minuteWib = m;
    }
  }

  // Domain booking = masa depan: tanggal yang jatuh sebelum hari ini WIB
  // (mis. tahun lampau "2023" karangan LLM) digulir ke kemunculan berikutnya —
  // DILARANG menyimpan booking masa lalu ke database. Dibandingkan per HARI WIB.
  const startOfRefDayUtc = Date.UTC(refWib.year, refWib.month, refWib.day) - WIB_OFFSET_MS;
  const rollPast = (candidate: Date): Date => {
    if (!shouldRoll) return candidate;
    if (candidate.getTime() >= startOfRefDayUtc) return candidate;
    // Gulir tahun (kalender WIB) hingga mencapai hari ini/ke depan, tetap pada jam ter-parse.
    const p = toWibParts(candidate);
    let rolled = wibCalendarToUtc(refWib.year, p.month, p.day, hourWib, minuteWib);
    while (rolled.getTime() < startOfRefDayUtc) {
      const rp = toWibParts(rolled);
      rolled = wibCalendarToUtc(rp.year + 1, rp.month, rp.day, hourWib, minuteWib);
    }
    return rolled;
  };

  // 1. Standar ISO YYYY-MM-DD
  const isoMatch = clean.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10) - 1;
    const d = parseInt(isoMatch[3], 10);
    if (m >= 0 && m <= 11 && d >= 1 && d <= 31) {
      const candidate = wibCalendarToUtc(y, m, d, hourWib, minuteWib);
      return { date: rollPast(candidate), isRecognized: true, rawMatched: isoMatch[0] };
    }
  }

  // 2. Format Numerik DD-MM-YYYY atau DD/MM/YYYY
  const numericMatch = clean.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/);
  if (numericMatch) {
    const d = parseInt(numericMatch[1], 10);
    const m = parseInt(numericMatch[2], 10) - 1;
    let y = parseInt(numericMatch[3], 10);
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && m >= 0 && m <= 11) {
      const candidate = wibCalendarToUtc(y, m, d, hourWib, minuteWib);
      return { date: rollPast(candidate), isRecognized: true, rawMatched: numericMatch[0] };
    }
  }

  // 3. Tanggal dengan Nama Bulan (ID atau EN): "12 September", "12 September 2026", "26 july 2026", "tgl 5 okt"
  // Hanya cocokkan nama bulan yang sah di INDONESIAN_MONTHS agar tidak menjebak angka jam/menit
  const monthNamesPattern = Object.keys(INDONESIAN_MONTHS).join('|');
  const dmRegex = new RegExp(`\\b(\\d{1,2})\\s+(${monthNamesPattern})(?:\\s+(\\d{2,4}))?\\b`, 'i');
  const mdRegex = new RegExp(`\\b(${monthNamesPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(\\d{2,4}))?\\b`, 'i');

  const dmMatch = clean.match(dmRegex);
  const mdMatch = !dmMatch ? clean.match(mdRegex) : null;

  if (dmMatch && INDONESIAN_MONTHS[dmMatch[2].toLowerCase()] !== undefined) {
    const d = parseInt(dmMatch[1], 10);
    const m = INDONESIAN_MONTHS[dmMatch[2].toLowerCase()];
    let y = dmMatch[3] ? parseInt(dmMatch[3], 10) : refWib.year;
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31) {
      const candidate = wibCalendarToUtc(y, m, d, hourWib, minuteWib);
      return { date: rollPast(candidate), isRecognized: true, rawMatched: dmMatch[0] };
    }
  } else if (mdMatch && INDONESIAN_MONTHS[mdMatch[1].toLowerCase()] !== undefined) {
    const m = INDONESIAN_MONTHS[mdMatch[1].toLowerCase()];
    const d = parseInt(mdMatch[2], 10);
    let y = mdMatch[3] ? parseInt(mdMatch[3], 10) : refWib.year;
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31) {
      const candidate = wibCalendarToUtc(y, m, d, hourWib, minuteWib);
      return { date: rollPast(candidate), isRecognized: true, rawMatched: mdMatch[0] };
    }
  }

  // 4. Format Relatif: "hari ini", "besok", "lusa" (Hanya jika allowRelative: true)
  if (allowRelative) {
    if (clean.includes('lusa')) {
      return {
        date: wibCalendarToUtc(refWib.year, refWib.month, refWib.day + 2, hourWib, minuteWib),
        isRecognized: true,
        rawMatched: 'lusa'
      };
    }
    if (clean.includes('besok')) {
      return {
        date: wibCalendarToUtc(refWib.year, refWib.month, refWib.day + 1, hourWib, minuteWib),
        isRecognized: true,
        rawMatched: 'besok'
      };
    }
    if (clean.includes('hari ini')) {
      return {
        date: wibCalendarToUtc(refWib.year, refWib.month, refWib.day, hourWib, minuteWib),
        isRecognized: true,
        rawMatched: 'hari ini'
      };
    }

    // 5. Hari dalam Pekan: "hari sabtu", "sabtu depan", "senin" (hari WIB)
    for (const [dayName, targetDayIndex] of Object.entries(DAY_NAME_TO_INDEX)) {
      if (clean.includes(dayName)) {
        let diff = targetDayIndex - refWib.dayOfWeek;
        if (diff <= 0) diff += 7; // Ambil hari yang terdekat di masa depan
        if (clean.includes('depan') && diff < 7) diff += 7;
        return {
          date: wibCalendarToUtc(refWib.year, refWib.month, refWib.day + diff, hourWib, minuteWib),
          isRecognized: true,
          rawMatched: dayName,
        };
      }
    }
  }

  // 6. Fallback ke Date.parse standar (hanya jika ada indikator tanggal terstruktur)
  const fallbackTs = Date.parse(input);
  if (!isNaN(fallbackTs) && (clean.includes('-') || clean.includes('/') || clean.includes(':'))) {
    const parsed = new Date(fallbackTs);
    return { date: rollPast(parsed), isRecognized: true, rawMatched: input };
  }

  return { date: referenceDate, isRecognized: false, rawMatched: '' };
}

/**
 * Fase 2R — Terapkan jam booking eksplisit (WIB) ke tanggal yang sudah ter-parse.
 * Deterministik, tanpa regex hafalan di caller: parsing jam terpusat di sini.
 * - Mendukung "14.00", "14:00", "14.30-15.30", "pukul 10.00 WIB" (ambil jam mulai).
 * - Validasi range 00:00-23:59; invalid → kembalikan baseDate apa adanya.
 * - Konversi WIB (UTC+7) ke UTC untuk penyimpanan DB (`Date` internal UTC).
 */
export function applyBookingTimeToDate(baseDate: Date, bookingTime: string | null | undefined): Date {
  if (!bookingTime || typeof bookingTime !== 'string') return baseDate;
  const trimmed = bookingTime.trim();
  if (!trimmed) return baseDate;
  // Ambil jam pertama dari range "14.00-15.30" / "14:00 - 15:00"
  const firstSegment = trimmed.split('-')[0].split('–')[0].trim();
  const timeMatch = firstSegment.match(/(\d{1,2})\s*[:.]\s*(\d{2})/);
  // Fallback "jam 10" tanpa menit
  const hourOnlyMatch = !timeMatch ? firstSegment.match(/\b(\d{1,2})\b/) : null;
  let hh: number, mm: number;
  if (timeMatch) {
    hh = parseInt(timeMatch[1], 10);
    mm = parseInt(timeMatch[2], 10);
  } else if (hourOnlyMatch) {
    hh = parseInt(hourOnlyMatch[1], 10);
    mm = 0;
    if (hh < 0 || hh > 23) return baseDate;
  } else {
    return baseDate;
  }
  if (isNaN(hh) || isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return baseDate;
  const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
  const wibTime = new Date(baseDate.getTime() + WIB_OFFSET_MS);
  const utcMs = Date.UTC(
    wibTime.getUTCFullYear(),
    wibTime.getUTCMonth(),
    wibTime.getUTCDate(),
    hh - 7,
    mm,
    0,
    0
  );
  return new Date(utcMs);
}
