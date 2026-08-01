import { TreatmentCategory } from '@prisma/client';

export interface ParsedReservation {
  name: string;
  phone: string;
  address: string;
  kec: string;
  kota: string;
  treatmentCategory: TreatmentCategory;
  treatmentDetail: string;
  bookingDate: Date | null;
  rawText: string;
}

export interface ParseResult {
  success: boolean;
  reservation?: ParsedReservation;
  error?: string;
  missingFields?: string[];
}

/**
 * Parser toleran untuk meng-parse format teks list reservasi Bidan Yusi (Kala Moms and Baby Spa)
 * Menggunakan pendekatan baris-per-baris untuk keamanan parsing dan keandalan tinggi.
 */
export function parseReservationText(rawText: string): ParseResult {
  if (!rawText) {
    return { success: false, error: 'Teks reservasi kosong.', missingFields: ['rawText'] };
  }

  // Bersihkan formatting markdown WhatsApp (*, _, ~, `)
  let cleaned = rawText.replace(/[*_~`]/g, '').replace(/\r\n/g, '\n');

  // 1. Sambungkan label yang terpotong di tengah baris (mid-word wrap)
  // Hanya untuk kata-kata label yang DIKETAHUI, supaya tidak salah gabung
  // kata biasa (misal "Hari dan\ntanggal" harus tetap terpisah).
  const LABEL_WORDS = ['Bunda', 'Kehamilan', 'Shareloc', 'Anak', 'Bayi', 'Alamat', 'Pilihan', 'Treatment', 'Keham', 'Perawatan', 'No.', 'Hp', 'tanggal', 'Booking', 'Reservasi'];
  for (const word of LABEL_WORDS) {
    for (let i = 1; i < word.length; i++) {
      const part1 = word.slice(0, i);
      const part2 = word.slice(i);
      if (part1.length >= 2 && part2.length >= 1) {
        const re = new RegExp('(' + part1 + ')\\n(' + part2 + ')', 'gi');
        cleaned = cleaned.replace(re, '$1$2');
      }
    }
  }

  // 2. Gabungkan label yang terpotong ke baris baru (misal Usia Kehamilan (Jika\n hamil): -> Usia Kehamilan (Jika hamil):)
  cleaned = cleaned.replace(/(usia\s+kehamilan[^\n:]*)\n\s*([^:\n]+:)/gi, '$1 $2');

  // 3. Pisahkan label yang berada di satu baris yang sama setelah nilai field lain
  const inlineLabelRegex = /(\s+)(Nama Bunda\s*:|Alamat & Shareloc\s*:|Alamat\s*:|Kec\s*&\s*Kota\s*:|\bKec\s*:|\bKota\s*:|No\.?\s*Hp\s*:|Nama Bayi\s*:|Usia Bayi\/Anak\s*:|Usia Bayi\s*:|Usia Kehamilan[^\n:]*:|Treatment\s*:|Pilihan treatment)/gi;
  cleaned = cleaned.replace(inlineLabelRegex, '\n$2');

  const lines = cleaned.split('\n');

  let name = '';
  let phone = '';
  let address = '';
  let dateStr = '';
  let kec = '';
  let kota = '';

  let babyName = '';
  let babyAge = '';
  let babyTreatment = '';

  let momsPregnancyAge = '';
  let momsTreatment = '';

  let currentSection: 'GENERAL' | 'BABY' | 'MOMS' = 'GENERAL';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const lower = trimmed.toLowerCase();

    // Transisi Section berdasarkan header
    if (lower.includes('pilihan treatment (baby & kids)')) {
      currentSection = 'BABY';
      continue;
    }
    if (lower.includes('pilihan treatment (moms)')) {
      currentSection = 'MOMS';
      continue;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      // Cek apakah ada line gabungan tanpa colon (jarang terjadi, tapi untuk safety)
      continue;
    }

    const label = trimmed.substring(0, colonIdx).trim().toLowerCase();
    const value = trimmed.substring(colonIdx + 1).trim();

    if (currentSection === 'GENERAL') {
      if (label.includes('nama bunda')) {
        name = value;
      } else if (label.includes('no') && label.includes('hp')) {
        phone = value;
      } else if (label.includes('alamat')) {
        address = value;
      } else if (label.includes('hari dan tanggal') || label.includes('tanggal')) {
        dateStr = value;
      } else if (label === 'kec') {
        kec = value;
      } else if (label === 'kota') {
        kota = value;
      } else if (label.includes('kec') && label.includes('kota')) {
        // Gabungan Kec & Kota (misal: "Kec & Kota : Sukolilo, Surabaya")
        const parts = value.split(/[,\/]/);
        kec = parts[0]?.trim() || '';
        kota = parts[1]?.trim() || '';
      }
    } else if (currentSection === 'BABY') {
      if (label.includes('nama bayi')) {
        babyName = value;
      } else if (label.includes('usia')) {
        babyAge = value;
      } else if (label === 'treatment') {
        babyTreatment = value;
      }
    } else if (currentSection === 'MOMS') {
      if (label.includes('usia kehamilan')) {
        momsPregnancyAge = value;
      } else if (label === 'treatment') {
        momsTreatment = value;
      }
    }
  }

  // Validasi Field Krusial
  const missingFields: string[] = [];
  if (!name) missingFields.push('Nama Bunda');
  if (!phone) missingFields.push('No. Hp');
  if (!address) missingFields.push('Alamat & Shareloc');

  const hasBabyTreatment = !!babyTreatment || !!babyName;
  const hasMomsTreatment = !!momsTreatment || !!momsPregnancyAge;
  const treatmentDetailParts: string[] = [];

  if (hasBabyTreatment && babyTreatment) {
    treatmentDetailParts.push(`Baby: ${babyTreatment} (Bayi: ${babyName || '-'}, Usia: ${babyAge || '-'})`);
  }
  if (hasMomsTreatment && momsTreatment) {
    treatmentDetailParts.push(`Moms: ${momsTreatment} (Kehamilan: ${momsPregnancyAge || '-'})`);
  }

  const treatmentDetail = treatmentDetailParts.join(' | ');

  if (!treatmentDetail) {
    missingFields.push('Treatment Detail');
  }

  if (missingFields.length > 0) {
    return {
      success: false,
      error: `Gagal memproses list reservasi. Field berikut tidak terbaca atau kosong: ${missingFields.join(', ')}`,
      missingFields,
    };
  }

  // Tentukan Treatment Category
  let treatmentCategory: TreatmentCategory = TreatmentCategory.BABY;
  if (hasBabyTreatment && hasMomsTreatment) {
    treatmentCategory = TreatmentCategory.BOTH;
  } else if (hasMomsTreatment) {
    treatmentCategory = TreatmentCategory.MOMS;
  }

  // Parse Booking Date (toleran, non-blocking)
  let bookingDate: Date | null = null;
  if (dateStr) {
    bookingDate = tryParseIndonesianDate(dateStr);
  }

  // Normalisasi Nomor HP: hilangkan non-digit, 08xx -> 628xx
  let normalizedPhone = phone.replace(/\D/g, '');
  if (normalizedPhone.startsWith('0')) {
    normalizedPhone = '62' + normalizedPhone.substring(1);
  }

  return {
    success: true,
    reservation: {
      name,
      phone: normalizedPhone,
      address,
      kec,
      kota,
      treatmentCategory,
      treatmentDetail,
      bookingDate,
      rawText,
    },
  };
}

/**
 * Helper untuk mem-parse tanggal bahasa Indonesia
 */
function tryParseIndonesianDate(dateStr: string): Date | null {
  const cleanStr = dateStr.toLowerCase().trim();
  if (!cleanStr) return null;

  // Regex untuk format YYYY-MM-DD
  const isoMatch = cleanStr.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const date = new Date(parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10) - 1, parseInt(isoMatch[3], 10));
    if (!isNaN(date.getTime())) return date;
  }

  // Regex untuk format DD-MM-YYYY
  const indMatch = cleanStr.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (indMatch) {
    const date = new Date(parseInt(indMatch[3], 10), parseInt(indMatch[2], 10) - 1, parseInt(indMatch[1], 10));
    if (!isNaN(date.getTime())) return date;
  }

  // Map nama bulan Indonesia ke angka index 0-11
  const indMonths: { [key: string]: number } = {
    jan: 0, januari: 0,
    feb: 1, februari: 1,
    mar: 2, maret: 2,
    apr: 3, april: 3,
    mei: 4,
    jun: 5, juni: 5,
    jul: 6, juli: 6,
    agt: 7, agustus: 7,
    sep: 8, september: 8,
    okt: 9, oktober: 9,
    nov: 10, november: 10,
    des: 11, desember: 11,
  };

  // Regex untuk mendeteksi tanggal berformat "21 Juli 2026" atau "Selasa, 21 Juli 2026"
  const textMatch = cleanStr.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/i);
  if (textMatch) {
    const day = parseInt(textMatch[1], 10);
    const monthName = textMatch[2];
    const year = parseInt(textMatch[3], 10);
    const month = indMonths[monthName];
    if (month !== undefined) {
      const date = new Date(year, month, day);
      if (!isNaN(date.getTime())) return date;
    }
  }

  // Jika formatnya ambigu / tidak ada tahun (contoh "Selasa, 21 Juli"), return null (non-blocking)
  return null;
}
