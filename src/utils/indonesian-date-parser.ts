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

  // 1. Standar ISO / YYYY-MM-DD
  const isoMatch = clean.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    target.setFullYear(parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10) - 1, parseInt(isoMatch[3], 10));
    target.setHours(9, 0, 0, 0);
    return { date: target, isRecognized: true, rawMatched: isoMatch[0] };
  }

  // 2. Format Relatif: "hari ini", "besok", "lusa"
  if (clean.includes('lusa')) {
    target.setDate(target.getDate() + 2);
    target.setHours(9, 0, 0, 0);
    return { date: target, isRecognized: true, rawMatched: 'lusa' };
  }
  if (clean.includes('besok')) {
    target.setDate(target.getDate() + 1);
    target.setHours(9, 0, 0, 0);
    return { date: target, isRecognized: true, rawMatched: 'besok' };
  }
  if (clean.includes('hari ini')) {
    target.setHours(9, 0, 0, 0);
    return { date: target, isRecognized: true, rawMatched: 'hari ini' };
  }

  // 3. Tanggal dengan Nama Bulan Indonesia: "12 September", "12 September 2026", "tgl 5 okt"
  const dateMonthRegex = /\b(\d{1,2})\s+([a-z']+)(?:\s+(\d{4}))?\b/;
  const dmMatch = clean.match(dateMonthRegex);
  if (dmMatch && INDONESIAN_MONTHS[dmMatch[2]] !== undefined) {
    const day = parseInt(dmMatch[1], 10);
    const month = INDONESIAN_MONTHS[dmMatch[2]];
    const year = dmMatch[3] ? parseInt(dmMatch[3], 10) : target.getFullYear();
    target.setFullYear(year, month, day);
    target.setHours(9, 0, 0, 0);
    return { date: target, isRecognized: true, rawMatched: dmMatch[0] };
  }

  // 4. Hari dalam Pekan: "hari sabtu", "sabtu depan", "senin"
  for (const [dayName, targetDayIndex] of Object.entries(DAY_NAME_TO_INDEX)) {
    if (clean.includes(dayName)) {
      const currentDay = target.getDay();
      let diff = targetDayIndex - currentDay;
      if (diff <= 0) diff += 7; // Ambil hari yang terdekat di masa depan
      if (clean.includes('depan') && diff < 7) diff += 7;
      target.setDate(target.getDate() + diff);
      target.setHours(9, 0, 0, 0);
      return { date: target, isRecognized: true, rawMatched: dayName };
    }
  }

  // 5. Fallback ke Date.parse standar jika lolos
  const fallbackTs = Date.parse(input);
  if (!isNaN(fallbackTs)) {
    return { date: new Date(fallbackTs), isRecognized: true, rawMatched: input };
  }

  return { date: referenceDate, isRecognized: false, rawMatched: '' };
}
