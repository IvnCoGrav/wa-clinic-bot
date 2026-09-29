/**
 * src/utils/indonesian-date-parser.ts
 * Parser tanggal bahasa Indonesia (deterministik, zero-dependency).
 * Menangani format relatif (besok, lusa), hari, nama bulan ID, dan jam.
 */

const INDONESIAN_MONTHS: Record<string, number> = {
  januari: 0, jan: 0,
  februari: 1, feb: 1,
  maret: 2, mar: 2,
  april: 3, apr: 3,
  mei: 4,
  juni: 5, jun: 5,
  juli: 6, jul: 6,
  agustus: 7, agu: 7, ags: 7,
  september: 8, sep: 8, sept: 8,
  oktober: 9, okt: 9,
  november: 10, nov: 10,
  desember: 11, des: 11,
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
function wibCalendarToUtc(year: number, month: number, day: number, hourWib = DEFAULT_BOOKING_HOUR_WIB): Date {
  return new Date(Date.UTC(year, month, day, hourWib, 0, 0, 0) - WIB_OFFSET_MS);
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

export interface ParsedIndonesianDate {
  date: Date;
  isRecognized: boolean;
  rawMatched: string;
}

export function parseIndonesianDate(input: string, referenceDate: Date = new Date()): ParsedIndonesianDate {
  if (!input || typeof input !== 'string') {
    return { date: referenceDate, isRecognized: false, rawMatched: '' };
  }

  const clean = input.toLowerCase().trim();
  const target = new Date(referenceDate.getTime());
  const refWib = toWibParts(referenceDate);

  // Domain booking = masa depan: tanggal yang jatuh sebelum hari ini WIB
  // (mis. tahun lampau "2023" karangan LLM) digulir ke kemunculan berikutnya —
  // DILARANG menyimpan booking masa lalu ke database. Dibandingkan per HARI WIB.
  const startOfRefDayUtc = Date.UTC(refWib.year, refWib.month, refWib.day) - WIB_OFFSET_MS;
  const rollPastToFuture = (candidate: Date): Date => {
    if (candidate.getTime() >= startOfRefDayUtc) return candidate;
    // Gulir tahun (kalender WIB) hingga mencapai hari ini/ke depan, tetap 09:00 WIB.
    const p = toWibParts(candidate);
    let rolled = wibCalendarToUtc(refWib.year, p.month, p.day);
    while (rolled.getTime() < startOfRefDayUtc) {
      const rp = toWibParts(rolled);
      rolled = wibCalendarToUtc(rp.year + 1, rp.month, rp.day);
    }
    return rolled;
  };

  // 1. Standar ISO / YYYY-MM-DD
  const isoMatch = clean.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const candidate = wibCalendarToUtc(
      parseInt(isoMatch[1], 10),
      parseInt(isoMatch[2], 10) - 1,
      parseInt(isoMatch[3], 10)
    );
    return { date: rollPastToFuture(candidate), isRecognized: true, rawMatched: isoMatch[0] };
  }

  // 2. Format Relatif: "hari ini", "besok", "lusa" (berbasis hari WIB)
  if (clean.includes('lusa')) {
    return { date: wibCalendarToUtc(refWib.year, refWib.month, refWib.day + 2), isRecognized: true, rawMatched: 'lusa' };
  }
  if (clean.includes('besok')) {
    return { date: wibCalendarToUtc(refWib.year, refWib.month, refWib.day + 1), isRecognized: true, rawMatched: 'besok' };
  }
  if (clean.includes('hari ini')) {
    return { date: wibCalendarToUtc(refWib.year, refWib.month, refWib.day), isRecognized: true, rawMatched: 'hari ini' };
  }

  // 3. Tanggal dengan Nama Bulan Indonesia: "12 September", "12 September 2026", "tgl 5 okt"
  const dateMonthRegex = /\b(\d{1,2})\s+([a-z']+)(?:\s+(\d{4}))?\b/;
  const dmMatch = clean.match(dateMonthRegex);
  if (dmMatch && INDONESIAN_MONTHS[dmMatch[2]] !== undefined) {
    const day = parseInt(dmMatch[1], 10);
    const month = INDONESIAN_MONTHS[dmMatch[2]];
    const year = dmMatch[3] ? parseInt(dmMatch[3], 10) : refWib.year;
    const candidate = wibCalendarToUtc(year, month, day);
    return { date: rollPastToFuture(candidate), isRecognized: true, rawMatched: dmMatch[0] };
  }

  // 4. Hari dalam Pekan: "hari sabtu", "sabtu depan", "senin" (hari WIB)
  for (const [dayName, targetDayIndex] of Object.entries(DAY_NAME_TO_INDEX)) {
    if (clean.includes(dayName)) {
      let diff = targetDayIndex - refWib.dayOfWeek;
      if (diff <= 0) diff += 7; // Ambil hari yang terdekat di masa depan
      if (clean.includes('depan') && diff < 7) diff += 7;
      return {
        date: wibCalendarToUtc(refWib.year, refWib.month, refWib.day + diff),
        isRecognized: true,
        rawMatched: dayName,
      };
    }
  }

  // 5. Fallback ke Date.parse standar jika lolos.
  //    Date.parse mengembalikan instant absolut (tanpa default jam) → pertahankan,
  //    hanya gulir tahun bila lampau (bandingkan per hari WIB).
  const fallbackTs = Date.parse(input);
  if (!isNaN(fallbackTs)) {
    const parsed = new Date(fallbackTs);
    return { date: rollPastToFuture(parsed), isRecognized: true, rawMatched: input };
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
