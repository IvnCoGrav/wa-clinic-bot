import { TreatmentCategory } from '@prisma/client';

export interface BabyDetail {
  name: string;
  age: string;
}

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
  babies: BabyDetail[];
  payment?: {
    treatmentPrice: number;
    ongkir: number;
    promo: number;
    totalPrice: number;
  };
}

export interface ParseResult {
  success: boolean;
  reservation?: ParsedReservation;
  error?: string;
  missingFields?: string[];
}

/**
 * Mengecek apakah sebuah pesan WhatsApp merupakan form reservasi / booking layanan
 * secara toleran terhadap berbagai variasi penulisan tanpa false-positive pada chat biasa.
 */
export function isReservationFormMessage(rawText: string): boolean {
  if (!rawText || typeof rawText !== 'string') return false;
  const lower = rawText.toLowerCase().replace(/\s+/g, ' ');

  // 1. Explicit Form Header Signals (Kala Spa official booking format)
  const hasExplicitFormHeader =
    lower.includes('list untuk reservasi') ||
    lower.includes('berikut list untuk reservasi') ||
    lower.includes('format reservasi') ||
    lower.includes('form reservasi') ||
    lower.includes('form booking') ||
    lower.includes('format booking') ||
    lower.includes('list reservasi') ||
    lower.includes('pilihan treatment :') ||
    lower.includes('pilihan treatment (') ||
    lower.includes('pilihan paket :') ||
    lower.includes('jadwal treatment :') ||
    lower.includes('jadwal reservasi :');

  if (hasExplicitFormHeader) return true;

  // 2. Structured Colon-Based Field Signals (minimal 2 explicit structured form field keys with colons)
  const hasNameField = /nama\s*(bunda|ibu|pasien|anak|bayi)?\s*[:]/i.test(lower) || /atas\s*nama\s*[:]/i.test(lower);
  const hasAddressField = /alamat(\s*&\s*shareloc)?\s*[:]/i.test(lower) || /kec\s*[:]/i.test(lower) || /kota\s*[:]/i.test(lower) || /shareloc\s*[:]/i.test(lower);
  const hasTreatmentField = /treatment\s*[:]/i.test(lower) || /pilihan\s*treatment/i.test(lower) || /paket\s*[:]/i.test(lower);
  const hasScheduleField = /hari\s*(dan|\&)?\s*tanggal\s*[:]/i.test(lower) || /tgl\s*[:]/i.test(lower) || /jadwal\s*[:]/i.test(lower);
  const hasBabyField = /nama\s*(bayi|anak)\s*[:]/i.test(lower) || /usia\s*(bayi|anak)\s*[:]/i.test(lower);
  const hasPhoneField = /no\.?\s*(hp|wa|telepon)\s*[:]/i.test(lower);

  const structuredMatchCount =
    (hasNameField ? 1 : 0) +
    (hasAddressField ? 1 : 0) +
    (hasTreatmentField ? 1 : 0) +
    (hasScheduleField ? 1 : 0) +
    (hasBabyField ? 1 : 0) +
    (hasPhoneField ? 1 : 0);

  if (structuredMatchCount >= 2) return true;

  // 3. Explicit Free-Form Paragraph Booking Pattern (e.g. "Mau booking buat anak saya ... alamat ...")
  // Wajib memiliki kata aksi booking + penunjuk alamat spesifik + info pasien anak
  const hasBookingAction = /\b(mau|ingin|tolong|bisa)?\s*(booking|pesan\s+paket|reservasi)\b/i.test(lower);
  const hasExplicitAddressWord = /\b(alamat\s*(di|:)?|jalan|jl\.|gang|blok|komplek|perumahan)\b/i.test(lower);
  const hasChildPatientWord = /\b(anak\s+saya|bayi\s+saya|usia\s+\d+|newborn)\b/i.test(lower);

  if (hasBookingAction && hasExplicitAddressWord && hasChildPatientWord) {
    return true;
  }

  return false;
}

/**
 * Parser toleran untuk meng-parse format teks list reservasi Bidan Yusi (Kala Moms and Baby Spa)
 * Menggunakan pendekatan baris-per-baris untuk keamanan parsing dan keandalan tinggi.
 */

/**
 * Preprocessing: bersihkan formatting markdown, sambungkan label terpotong,
 * dan pecah label inline agar baris-per-baris mudah diproses.
 */
export function preprocessReservationText(rawText: string): string {
  if (!rawText) return '';

  // Bersihkan formatting markdown WhatsApp (*, _, ~, `)
  let cleaned = rawText.replace(/[*_~`]/g, '').replace(/\r\n/g, '\n');

  // 1. Sambungkan label yang terpotong di tengah baris (mid-word wrap)
  // Hanya untuk kata-kata label yang DIKETAHUI, supaya tidak salah gabung
  // kata biasa (misal "Hari dan\ntanggal" harus tetap terpisah).
  const LABEL_WORDS = ['Bunda', 'Kehamilan', 'Shareloc', 'Anak', 'Bayi', 'Alamat', 'Pilihan', 'Treatment', 'Keham', 'No', 'Hp', 'tanggal'];
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

  return cleaned;
}

/**
 * Memeriksa apakah suatu teks adalah placeholder / instruksi template form reservasi yang belum diisi.
 * Contoh: "(Mohon bisa diisi Bunda 😊)", "(Jika hamil)", "-", "tidak ada", "none", dsb.
 */
export function isPlaceholderText(val: string | null | undefined): boolean {
  if (!val) return true;
  const clean = val.trim().toLowerCase().replace(/[()\[\]*~_`]/g, '').trim();
  if (!clean || clean.length < 2) return true;

  if (
    clean.includes('mohon bisa diisi') ||
    clean.includes('bisa diisi bunda') ||
    clean.includes('diisi bunda') ||
    clean.includes('jika hamil') ||
    clean.includes('jika ada') ||
    clean.includes('bila ada') ||
    clean.includes('opsional') ||
    clean.includes('optional')
  ) {
    return true;
  }

  if (
    /^(tidak\s*ada|tdk\s*ada|belum\s*ada|belum|ga\s*ada|gak\s*ada|none|kosong|skip|-|\.|\/|\?)+$/i.test(clean)
  ) {
    return true;
  }

  return false;
}

export function parseReservationText(rawText: string): ParseResult {
  if (!rawText) {
    return { success: false, error: 'Teks reservasi kosong.', missingFields: ['rawText'] };
  }

  const cleaned = preprocessReservationText(rawText);

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
  const babyNameLines: string[] = [];
  const babyAgeLines: string[] = [];

  let momsPregnancyAge = '';
  let momsTreatment = '';

  let currentSection: 'GENERAL' | 'BABY' | 'MOMS' = 'GENERAL';
  let pendingField: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const lower = trimmed.toLowerCase();
    const lowerNorm = lower.replace(/\s+/g, ' ');

    // Transisi Section berdasarkan header
    if (
      /pilihan\s+treatment\s*\(?\s*(baby|bayi|anak|kids)/i.test(lowerNorm) ||
      /treatment\s*\(?\s*(baby|bayi|anak|kids)/i.test(lowerNorm) ||
      lowerNorm.includes('baby & kids') ||
      lowerNorm.includes('baby and kids') ||
      lowerNorm.includes('pijat bayi')
    ) {
      currentSection = 'BABY';
      pendingField = null;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx !== -1) {
        const val = trimmed.substring(colonIdx + 1).trim();
        if (val && !isPlaceholderText(val)) babyTreatment = val;
      }
      continue;
    }
    if (
      /pilihan\s+treatment\s*\(?\s*(moms|mom|ibu|hamil|nifas)/i.test(lowerNorm) ||
      /treatment\s*\(?\s*(moms|mom|ibu|hamil|nifas)/i.test(lowerNorm) ||
      lowerNorm.includes('moms & nifas') ||
      lowerNorm.includes('moms and nifas')
    ) {
      currentSection = 'MOMS';
      pendingField = null;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx !== -1) {
        const val = trimmed.substring(colonIdx + 1).trim();
        if (val && !isPlaceholderText(val)) momsTreatment = val;
      }
      continue;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      // Jika baris ini tidak punya titik dua `:`, tapi baris sebelumnya punya label dengan nilai kosong
      if (pendingField) {
        const value = trimmed;
        if (!isPlaceholderText(value)) {
          if (pendingField === 'name') name = value;
          else if (pendingField === 'phone') phone = value;
          else if (pendingField === 'address') address = value;
          else if (pendingField === 'date') dateStr = value;
          else if (pendingField === 'kec') kec = value;
          else if (pendingField === 'kota') kota = value;
          else if (pendingField === 'babyName') { babyName = value; babyNameLines.push(value); }
          else if (pendingField === 'babyAge') { babyAge = value; babyAgeLines.push(value); }
          else if (pendingField === 'babyTreatment') babyTreatment = value;
          else if (pendingField === 'momsPregnancyAge') momsPregnancyAge = value;
          else if (pendingField === 'momsTreatment') momsTreatment = value;
        }
        pendingField = null;
      }
      continue;
    }

    pendingField = null;
    const label = trimmed.substring(0, colonIdx).trim().toLowerCase().replace(/\s+/g, ' ');
    const value = trimmed.substring(colonIdx + 1).trim();

    const setOrPending = (val: string, fieldName: string, setter: (v: string) => void) => {
      if (val) {
        if (!isPlaceholderText(val)) {
          setter(val);
        }
      } else {
        pendingField = fieldName;
      }
    };

    if (currentSection === 'GENERAL') {
      if (label.includes('nama bunda') || label.includes('nama ibu') || label === 'nama') {
        setOrPending(value, 'name', (v) => (name = v));
      } else if (label.includes('no') && (label.includes('hp') || label.includes('wa') || label.includes('telp') || label.includes('telepon'))) {
        setOrPending(value, 'phone', (v) => (phone = v));
      } else if (label.includes('alamat')) {
        setOrPending(value, 'address', (v) => (address = v));
      } else if (label.includes('hari') || label.includes('tanggal')) {
        setOrPending(value, 'date', (v) => (dateStr = v));
      } else if (label === 'kec' || label.includes('kecamatan')) {
        setOrPending(value, 'kec', (v) => (kec = v));
      } else if (label === 'kota' || label.includes('kabupaten') || label.includes('kab')) {
        setOrPending(value, 'kota', (v) => (kota = v));
      } else if (label.includes('kec') && label.includes('kota')) {
        const parts = value.split(/[,\/]/);
        const k1 = parts[0]?.trim() || '';
        const k2 = parts[1]?.trim() || '';
        if (k1 && !isPlaceholderText(k1)) kec = k1;
        if (k2 && !isPlaceholderText(k2)) kota = k2;
      } else if (label.includes('treatment') || label.includes('layanan') || label.includes('paket')) {
        setOrPending(value, 'babyTreatment', (v) => (babyTreatment = v));
      }
    } else if (currentSection === 'BABY') {
      if (label.includes('nama bayi') || label.includes('nama anak') || label.includes('nama baby') || label.includes('nama pasien')) {
        setOrPending(value, 'babyName', (v) => { babyName = v; babyNameLines.push(v); });
      } else if (label.includes('usia') || label.includes('umur')) {
        setOrPending(value, 'babyAge', (v) => { babyAge = v; babyAgeLines.push(v); });
      } else if (label.includes('treatment') || label.includes('layanan') || label.includes('paket')) {
        setOrPending(value, 'babyTreatment', (v) => (babyTreatment = v));
      }
    } else if (currentSection === 'MOMS') {
      if (label.includes('usia kehamilan') || label.includes('usia hamil') || label.includes('uk')) {
        setOrPending(value, 'momsPregnancyAge', (v) => (momsPregnancyAge = v));
      } else if (label.includes('treatment') || label.includes('layanan') || label.includes('paket')) {
        setOrPending(value, 'momsTreatment', (v) => (momsTreatment = v));
      }
    }
  }

  const babies = buildBabyDetails(babyNameLines, babyAgeLines);

  // Jika Nama Bunda kosong tapi Nama Bayi ada, gunakan nama bayi
  if ((!name || isPlaceholderText(name)) && (babyName || babyNameLines.length > 0)) {
    const validBaby = babyName || babyNameLines.find(b => !isPlaceholderText(b)) || '';
    if (validBaby && !isPlaceholderText(validBaby)) {
      name = validBaby;
    }
  }

  // Validasi Field Krusial: Minimal Alamat & (Nama Bunda atau Nama Bayi)
  const missingFields: string[] = [];
  const hasName = (!!name && !isPlaceholderText(name)) || (!!babyName && !isPlaceholderText(babyName)) || babyNameLines.some(b => !isPlaceholderText(b));
  const hasAddress = !!address || !!kec || !!kota;

  if (!hasName) missingFields.push('Nama Bunda/Bayi');
  if (!hasAddress) missingFields.push('Alamat');

  if (missingFields.length > 0) {
    // Fallback: coba ekstraksi teks percakapan bebas (HANYA jika input BUKAN format form terstruktur)
    const lowerRaw = rawText.toLowerCase();
    const hasFormStructure =
      lowerRaw.includes('list untuk reservasi') ||
      lowerRaw.includes('format reservasi') ||
      lowerRaw.includes('form reservasi') ||
      lowerRaw.includes('pilihan treatment');

    if (!hasFormStructure) {
      const conversationalParsed = parseConversationalReservation(rawText);
      if (conversationalParsed) {
        console.log(`[CONVERSATIONAL RESERVATION PARSED] Successfully extracted reservation from free-form text for "${conversationalParsed.name}".`);
        return {
          success: true,
          reservation: conversationalParsed,
        };
      }
    }

    return {
      success: false,
      error: `Gagal memproses list reservasi. Field berikut tidak terbaca atau kosong: ${missingFields.join(', ')}`,
      missingFields,
    };
  }

  const hasBabyTreatment = (!!babyTreatment && !isPlaceholderText(babyTreatment)) || (!!babyName && !isPlaceholderText(babyName)) || babyNameLines.some(b => !isPlaceholderText(b));
  const hasMomsTreatment = (!!momsTreatment && !isPlaceholderText(momsTreatment)) || (!!momsPregnancyAge && !isPlaceholderText(momsPregnancyAge));
  const treatmentDetailParts: string[] = [];

  if (hasBabyTreatment) {
    const effBabyTreatment = babyTreatment || 'Treatment / Pijat Bayi';
    const validBabies = babies.filter(b => b.name && !isPlaceholderText(b.name));
    const babyParts = validBabies.length > 0
      ? validBabies.map((b) => `Bayi: ${b.name || '-'}, Usia: ${b.age || '-'}`).join(' | ')
      : `Bayi: ${babyName && !isPlaceholderText(babyName) ? babyName : '-'}, Usia: ${babyAge && !isPlaceholderText(babyAge) ? babyAge : '-'}`;
    treatmentDetailParts.push(`Baby: ${effBabyTreatment} (${babyParts})`);
  }
  if (hasMomsTreatment) {
    const effMomsTreatment = momsTreatment || 'Treatment Moms';
    treatmentDetailParts.push(`Moms: ${effMomsTreatment} (Kehamilan: ${momsPregnancyAge && !isPlaceholderText(momsPregnancyAge) ? momsPregnancyAge : '-'})`);
  }
  if (treatmentDetailParts.length === 0) {
    treatmentDetailParts.push(`Treatment: ${babyTreatment || momsTreatment || 'Treatment Homecare'}`);
  }

  const treatmentDetail = treatmentDetailParts.join(' | ');

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

  // Ekstrak rincian pembayaran jika ada di dalam teks
  let payment: { treatmentPrice: number; ongkir: number; promo: number; totalPrice: number } | undefined;
  if (/payment|pembayaran|total\s*[:=]/i.test(rawText)) {
    const { parsePaymentSection } = require('./conversation-transaction-extractor');
    payment = parsePaymentSection(rawText);
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
      babies,
      payment,
    },
  };
}

/**
 * Ekstrak daftar bayi/anak (nama + usia) dari teks list reservasi mentah.
 * Mendukung: satu bayi, beberapa bayi (dipisah koma/&/dan), blok berulang,
 * dan usia yang ditulis dalam kurung "Nama (usia)".
 * Dipakai untuk menampilkan info bayi di detail reservasi tanpa bergantung
 * pada keberhasilan parse penuh.
 */
export function extractBabyDetails(rawText: string | null | undefined): BabyDetail[] {
  if (!rawText) return [];
  const cleaned = preprocessReservationText(rawText);
  const lines = cleaned.split('\n');

  const nameLines: string[] = [];
  const ageLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const label = trimmed.substring(0, colonIdx).trim().toLowerCase().replace(/\s+/g, ' ');
    const value = trimmed.substring(colonIdx + 1).trim();

    if (
      label.includes('nama bayi') ||
      label.includes('nama anak') ||
      label.includes('nama baby') ||
      label.includes('nama pasien') ||
      label === 'anak' ||
      label === 'baby'
    ) {
      nameLines.push(value);
    } else if (
      (label.includes('usia') || label.includes('umur')) &&
      !label.includes('kehamilan') &&
      !label.includes('bunda')
    ) {
      ageLines.push(value);
    }
  }

  return buildBabyDetails(nameLines, ageLines);
}

/**
 * Gabungkan baris nama & usia bayi menjadi daftar terstruktur.
 */
export function buildBabyDetails(nameLines: string[], ageLines: string[]): BabyDetail[] {
  const result: BabyDetail[] = [];

  // Ekspansi tiap baris nama → entri (tangani "Rara, Riri" dan "Rara (6 bulan)")
  const nameEntries: { name: string; age: string | null }[] = [];
  for (const line of nameLines) {
    for (const part of splitMultiValue(line)) {
      const p = part.trim();
      if (!p) continue;
      const parenMatch = p.match(/^(.+?)\s*\((?:umur|usia)?\s*([^)]+)\)$/i);
      if (parenMatch) {
        nameEntries.push({ name: parenMatch[1].trim(), age: parenMatch[2].trim() });
      } else {
        nameEntries.push({ name: p, age: null });
      }
    }
  }

  // Ekspansi tiap baris usia
  const ages: string[] = [];
  for (const line of ageLines) {
    for (const a of splitMultiValue(line)) {
      const t = a.trim();
      if (t) ages.push(t);
    }
  }

  const count = Math.max(nameEntries.length, ages.length);
  for (let i = 0; i < count; i++) {
    const entry = nameEntries[i];
    result.push({
      name: entry?.name || `Bayi ${i + 1}`,
      age: ages[i] ?? entry?.age ?? '',
    });
  }

  return result;
}

/**
 * Pecah nilai multi-bayi (misal "Rara, Riri" / "Kanaya & Kenshin" / "6 bulan, 2 tahun").
 * Hanya pecah pada pemisah jelas (koma, &, "dan", ";") — bukan spasi.
 */
function splitMultiValue(value: string): string[] {
  if (!value) return [];
  return value
    .replace(/\s+dan\s+/gi, ', ')
    .replace(/\s*&\s*/gi, ', ')
    .replace(/\s*;\s*/gi, ', ')
    .split(/\s*,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
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

/**
 * Fallback parser untuk mengekstrak entitas reservasi dari teks paragraf / percakapan bebas (Free-form text).
 * Contoh input:
 * "Mau booking buat anak saya Raffa 1 th, Wisma Lidah Kulon no 12, besok rabu jam 10 ya bund"
 */
export function parseConversationalReservation(rawText: string): ParsedReservation | null {
  if (!rawText) return null;
  const lower = rawText.toLowerCase().replace(/\s+/g, ' ');

  // 1. Ekstrak Nama Bunda / Pasien / Bayi
  let name = '';
  let babyName = '';
  let babyAge = '';

  const babyMatch =
    rawText.match(/(?:anak(?:nya)?(?:\s+saya)?|bayi(?:nya)?(?:\s+saya)?|pasien|atas\s+nama\s+anak)\s+(?:nama(?:nya)?\s+)?([A-Za-z\s]{2,30}?)(?:\s+usia|\s+umur|\s+\d+|\s+di|\s+alamat|,|\.|\n|$)/i) ||
    rawText.match(/nama\s+(?:anak|bayi)\s*[:\-]?\s*([A-Za-z\s]{2,30}?)(?:\s+usia|\s+umur|\s+alamat|,|\.|\n|$)/i);

  if (babyMatch && babyMatch[1]) {
    const candidate = babyMatch[1].trim();
    if (!isPlaceholderText(candidate) && candidate.length >= 2) {
      babyName = candidate;
    }
  }

  const momMatch =
    rawText.match(/(?:atas\s+nama|nama\s+bunda|nama\s+ibu|nama\s+pasien)\s*[:\-]?\s*([A-Za-z\s]{2,30}?)(?:\s+alamat|\s+di|\s+nomor|\s+no|,|\.|\n|$)/i) ||
    rawText.match(/nama\s*[:\-]\s*([A-Za-z\s]{2,30}?)(?:\s+alamat|\s+di|,|\.|\n|$)/i);

  if (momMatch && momMatch[1]) {
    const candidate = momMatch[1].trim();
    if (!isPlaceholderText(candidate) && candidate.length >= 2) {
      name = candidate;
    }
  }

  if (!name && babyName) {
    name = babyName;
  }

  // 2. Ekstrak Usia Bayi / Anak
  const ageMatch = rawText.match(/(\d+\s*(?:bulan|bln|tahun|thn|th|hari|hr|minggu|mg|mgg))/i);
  if (ageMatch) {
    babyAge = ageMatch[1].trim();
  }

  // 3. Ekstrak Alamat
  let address = '';
  const addressMatch =
    rawText.match(/(?:alamat(?:nya)?|shareloc(?:nya)?|lokasi(?:nya)?)\s*[:\-]?\s*([^,\n]+(?:,[^,\n]+){0,2})/i) ||
    rawText.match(/(?:di|ke)\s+([A-Za-z0-9\s.\-\/]{4,50}?)(?:\s+besok|\s+hari|\s+tanggal|\s+jam|\s+pukul|\s+no|\s+wa|,|\.|\n|$)/i);

  if (addressMatch && addressMatch[1]) {
    const candidate = addressMatch[1].trim();
    if (!isPlaceholderText(candidate) && candidate.length >= 3) {
      address = candidate;
    }
  }

  // 4. Ekstrak Tanggal & Jam
  let dateStr = '';
  const dateMatch = rawText.match(/(besok(?:\s+pagi|\s+siang|\s+sore)?|lusa|senin|selasa|rabu|kamis|jumat|sabtu|minggu|tanggal\s+\d+[\/\-\s]\d+)/i);
  const timeMatch = rawText.match(/(?:jam|pukul)\s*(\d{1,2}(?:[.:]\d{2})?)/i);

  if (dateMatch) {
    dateStr = dateMatch[1].trim() + (timeMatch ? ` ${timeMatch[0]}` : '');
  }

  // 5. Ekstrak Treatment
  let treatmentDetail = 'Pijat / Treatment Homecare';
  const treatmentMatch = rawText.match(/(pijat\s+bayi|pijat\s+anak|baby\s+spa|newborn|pulih\s+ceria|mom\s+spa|pijat\s+hamil|pijat\s+laktasi|nebulizer|terapi\s+moksa|cukur\s+bayi|tindik\s+bayi)/i);
  if (treatmentMatch) {
    treatmentDetail = treatmentMatch[1].trim();
  }

  // Validasi: harus ada Nama DAN Alamat
  if (!name || !address) {
    return null;
  }

  const babies: BabyDetail[] = babyName ? [{ name: babyName, age: babyAge || '-' }] : [];
  const bookingDate = dateStr ? tryParseIndonesianDate(dateStr) : null;

  return {
    name,
    phone: '',
    address,
    kec: '',
    kota: '',
    treatmentCategory: TreatmentCategory.BABY,
    treatmentDetail: `Baby: ${treatmentDetail} (Bayi: ${babyName || name}, Usia: ${babyAge || '-'})`,
    bookingDate,
    rawText,
    babies,
  };
}
