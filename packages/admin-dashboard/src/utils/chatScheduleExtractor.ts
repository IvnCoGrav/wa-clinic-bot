/**
 * Utility untuk ekstraksi pintar jadwal, waktu, layanan, data anak, dan ongkir
 * dari percakapan obrolan WhatsApp antara Bidan/CS dan Pelanggan.
 */

export interface ExtractedScheduleData {
  bookingDate: Date | null;
  dateDisplay: string;
  timeDisplay: string;
  treatmentName: string;
  treatmentPrice: number;
  treatmentCategory: 'BABY' | 'MOMS' | 'BUNDLE';
  childName: string;
  childAge: string;
  bundaName: string;
  phone: string;
  address: string;
  kecamatan: string;
  kota: string;
  distanceKm: number;
  ongkir: number;
  discount: number;
  isExtractedFromChat: boolean;
  confidenceScore: number;
}

export interface ClinicServiceCatalogItem {
  id?: string;
  name: string;
  price?: number;
  promoPrice?: number;
  originalPrice?: number;
  category?: string;
}

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

const MONTH_MAP: Record<string, number> = {
  januari: 0, jan: 0,
  februari: 1, feb: 1,
  maret: 2, mar: 2,
  april: 3, apr: 3,
  mei: 4, may: 4,
  juni: 5, jun: 5,
  juli: 6, jul: 6,
  agustus: 7, agu: 7, ags: 7,
  september: 8, sep: 8,
  oktober: 9, okt: 9, oct: 9,
  november: 10, nov: 10,
  desember: 11, des: 11, dec: 11
};

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

const INVALID_CHILD_NAME_WORDS = new Set([
  'sehat', 'selalu', 'yaa', 'ya', 'semoga', 'lekas', 'sembuh', 'pintar', 'pinter',
  'lucu', 'ganteng', 'cantik', 'bobo', 'tidur', 'nangis', 'bapil', 'batuk', 'pilek',
  'kembung', 'demam', 'pijat', 'treatment', 'usia', 'umur', 'bulan', 'tahun',
  'terimakasih', 'makasih', 'bunda', 'mama', 'ibu', 'kak', 'kakak', 'oke', 'baik',
  'siang', 'sore', 'pagi', 'malam', 'amin', 'aamiin', 'si', 'kecil', 'anak', 'bayi',
  'dedek', 'adik', 'sayang', 'iya', 'tidak', 'gak', 'bisa', 'jadwal', 'booking',
  'alamat', 'kec', 'kota', 'kab', 'no', 'hp'
]);

/**
 * Validasi ketat nama bayi/anak agar percakapan salam/doa ("sehat selalu yaa") tidak tertangkap sebagai nama anak
 */
export function isValidChildName(name: string | null | undefined): boolean {
  if (!name) return false;
  const clean = name.trim().replace(/^[-:.,\s]+|[-:.,\s]+$/g, '');
  if (clean.length < 2 || clean.length > 40) return false;
  if (/^(?:usia|umur|treatment|layanan|pilihan|nama|alamat|kec|kota|no|jam|tgl|hari|payment|total|ongkir)\b/i.test(clean)) return false;
  
  const words = clean.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  // Reject if it contains obvious greetings/well-wishes
  if (words.some(w => ['sehat', 'selalu', 'semoga', 'lekas', 'sembuh', 'bobo', 'bapil', 'terimakasih', 'makasih'].includes(w))) {
    return false;
  }

  const invalidCount = words.filter(w => INVALID_CHILD_NAME_WORDS.has(w)).length;
  if (invalidCount >= words.length) return false;

  return true;
}

/**
 * Format tanggal dalam bahasa Indonesia (e.g. "Kamis 27 Agustus 2026")
 */
export function formatIndonesianDate(d?: Date | string | null): string {
  if (!d) {
    const today = new Date();
    today.setDate(today.getDate() + 1);
    d = today;
  }
  const dateObj = typeof d === 'string' ? new Date(d) : d;
  if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) {
    const today = new Date();
    today.setDate(today.getDate() + 1);
    const dayName = DAY_NAMES[today.getDay()] || 'Kamis';
    const monthName = MONTH_NAMES[today.getMonth()] || 'Agustus';
    return `${dayName} ${today.getDate()} ${monthName} ${today.getFullYear()}`;
  }
  const dayName = DAY_NAMES[dateObj.getDay()] || 'Kamis';
  const dayNum = dateObj.getDate();
  const monthName = MONTH_NAMES[dateObj.getMonth()] || 'Agustus';
  const year = dateObj.getFullYear();
  return `${dayName} ${dayNum} ${monthName} ${year}`;
}

/**
 * Helper untuk parsing nominal harga (e.g. "80.000", "80rb", "80k", "free")
 */
export function parsePriceText(val: string | null | undefined): number | null {
  if (!val) return null;
  const str = val.trim().toLowerCase();
  if (str.includes('free') || str.includes('gratis') || str === '0') return 0;
  const cleaned = str.replace(/[^\d]/g, '');
  if (!cleaned) return null;
  const num = parseInt(cleaned, 10);
  if (isNaN(num)) return null;
  if (num < 1000 && (str.includes('k') || str.includes('rb') || str.includes('ribu'))) {
    return num * 1000;
  }
  return num;
}

/**
 * Helper untuk membersihkan nama Bunda dari prefix (Bunda, Ibu) dan suffix kota/kecamatan (e.g. "Bunda Vita Sidoarjo" -> "Vita")
 */
export function cleanBundaName(name?: string | null, kecamatan?: string | null, kota?: string | null): string {
  if (!name) return '';
  let clean = name.replace(/^(?:bunda|ibu|mama|moms?|ny\.?|mrs\.?|kak|kakak)\s+/i, '').trim();
  if (kecamatan) {
    const kecClean = kecamatan.trim().replace(/^(?:kec\.?|kecamatan)\s+/i, '').trim();
    if (kecClean) {
      const kecRegex = new RegExp(`\\s+${kecClean}$`, 'i');
      clean = clean.replace(kecRegex, '').trim();
    }
  }
  if (kota) {
    const kotaClean = kota.trim().replace(/^(?:kab\.?|kabupaten|kota)\s+/i, '').trim();
    if (kotaClean) {
      const kotaRegex = new RegExp(`\\s+${kotaClean}$`, 'i');
      clean = clean.replace(kotaRegex, '').trim();
    }
  }
  return clean;
}

/**
 * Ekstraksi entitas jadwal dari deretan pesan obrolan terakhir dan database customer.
 */
export function extractScheduleFromMessages(
  messages: Array<{ content?: string; direction?: string; created_at?: string }>,
  customer?: any,
  clinicServices: ClinicServiceCatalogItem[] = []
): ExtractedScheduleData {
  const baseDate = new Date();
  let extractedDate: Date | null = null;
  let rawDateText = '';
  let extractedTime = '';
  let extractedTreatment = '';
  let extractedPrice: number | null = null;
  let extractedCategory: 'BABY' | 'MOMS' | 'BUNDLE' = 'BABY';
  let extractedChildName = '';
  let extractedChildAge = '';
  let extractedBundaName = '';
  let extractedPhone = '';
  let extractedAddress = '';
  let extractedKecamatan = '';
  let extractedKota = '';
  let extractedDistanceKm: number | null = null;
  let extractedOngkir: number | null = null;
  let extractedDiscount: number = 0;
  let isExtracted = false;

  // 1. Ambil 15 pesan terakhir (dari terbaru ke terlama untuk prioritas data terkini)
  const recentMessages = (messages || []).slice(-15);
  const fullChatText = recentMessages
    .map((m) => m.content || '')
    .filter(Boolean)
    .join('\n');

  // =========================================================================
  // TAHAP 1: EKSTRAKSI DARI STRUKTUR FORM / TEMPLATE RESERVASI DI CHAT
  // =========================================================================

  // A. Ekstraksi "Hari dan tanggal : Kamis, 27 Agustus 2026 jam 16.30-17.00"
  const formDateMatch = fullChatText.match(/(?:hari\s*dan\s*tanggal|hari\/tgl|jadwal|tanggal)\s*[:=][ \t]*([^\r\n]+)/i);
  if (formDateMatch && formDateMatch[1].trim()) {
    const rawLine = formDateMatch[1].trim();
    // Cek apakah ada jam di baris tanggal
    const inlineTimeMatch = rawLine.match(/(?:jam|pukul)?\s*([0-2]?\d)[.:]([0-5]\d)\s*[-–]\s*([0-2]?\d)[.:]([0-5]\d)/i);
    if (inlineTimeMatch) {
      extractedTime = `${inlineTimeMatch[1].padStart(2, '0')}.${inlineTimeMatch[2]}-${inlineTimeMatch[3].padStart(2, '0')}.${inlineTimeMatch[4]}`;
      isExtracted = true;
    } else {
      const singleInline = rawLine.match(/(?:jam|pukul)\s*([0-2]?\d)[.:]([0-5]\d)/i);
      if (singleInline) {
        extractedTime = `${singleInline[1].padStart(2, '0')}.${singleInline[2]}`;
        isExtracted = true;
      }
    }

    // Parse tanggal absolut dari baris form
    const absMatch = rawLine.match(/([0-3]?\d)\s+([a-zA-Z]+)(?:\s+(\d{4}))?/i);
    if (absMatch) {
      const day = parseInt(absMatch[1], 10);
      const mStr = absMatch[2].toLowerCase();
      const month = MONTH_MAP[mStr];
      if (month !== undefined) {
        const year = absMatch[3] ? parseInt(absMatch[3], 10) : baseDate.getFullYear();
        const d = new Date(year, month, day);
        if (!isNaN(d.getTime())) {
          extractedDate = d;
          rawDateText = formatIndonesianDate(d);
          isExtracted = true;
        }
      }
    }
  }

  // B. Ekstraksi Jam Mandiri jika belum didapat
  if (!extractedTime) {
    const rangeMatch = fullChatText.match(/(?:jam|pukul)?\s*([0-2]?\d)[.:]([0-5]\d)\s*[-–]\s*([0-2]?\d)[.:]([0-5]\d)/i);
    if (rangeMatch) {
      extractedTime = `${rangeMatch[1].padStart(2, '0')}.${rangeMatch[2]}-${rangeMatch[3].padStart(2, '0')}.${rangeMatch[4]}`;
      isExtracted = true;
    } else {
      const singleTimeMatch = fullChatText.match(/(?:jam|pukul)\s*([0-2]?\d)[.:]([0-5]\d)/i);
      if (singleTimeMatch) {
        extractedTime = `${singleTimeMatch[1].padStart(2, '0')}.${singleTimeMatch[2]}`;
        isExtracted = true;
      } else {
        const wordTimeMatch = fullChatText.match(/(?:jam|pukul)\s*([0-1]?\d)\s*(pagi|siang|sore|malam)/i);
        if (wordTimeMatch) {
          let hour = parseInt(wordTimeMatch[1], 10);
          const period = wordTimeMatch[2].toLowerCase();
          if (period === 'siang' && hour < 12) hour += 12;
          if (period === 'sore' && hour < 12) hour += 12;
          if (period === 'malam' && hour < 12) hour += 12;
          extractedTime = `${String(hour).padStart(2, '0')}.00`;
          isExtracted = true;
        }
      }
    }
  }

  // C. Ekstraksi Tanggal Percakapan jika belum didapat
  if (!extractedDate) {
    const textLower = fullChatText.toLowerCase();
    if (/\b(?:besok\s*lusa|lusa)\b/i.test(textLower)) {
      const d = new Date(baseDate);
      d.setDate(d.getDate() + 2);
      extractedDate = d;
      rawDateText = formatIndonesianDate(d);
      isExtracted = true;
    } else if (/\b(?:besok|bsk|bso)\b/i.test(textLower)) {
      const d = new Date(baseDate);
      d.setDate(d.getDate() + 1);
      extractedDate = d;
      rawDateText = formatIndonesianDate(d);
      isExtracted = true;
    } else if (/\b(?:hari\s*ini)\b/i.test(textLower)) {
      const d = new Date(baseDate);
      extractedDate = d;
      rawDateText = formatIndonesianDate(d);
      isExtracted = true;
    } else {
      const absDateMatch = textLower.match(/(?:tgl|tanggal)?\s*([0-3]?\d)\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|jan|feb|mar|apr|mei|jun|jul|agu|ags|sep|okt|nov|des)(?:\s+(\d{4}))?/i);
      if (absDateMatch) {
        const day = parseInt(absDateMatch[1], 10);
        const mStr = absDateMatch[2].toLowerCase();
        const month = MONTH_MAP[mStr];
        if (month !== undefined) {
          const year = absDateMatch[3] ? parseInt(absDateMatch[3], 10) : baseDate.getFullYear();
          const d = new Date(year, month, day);
          if (!isNaN(d.getTime())) {
            extractedDate = d;
            rawDateText = formatIndonesianDate(d);
            isExtracted = true;
          }
        }
      }
    }
  }

  // D. Ekstraksi Nama Bunda dari baris: "Nama Bunda: Vita", "Nama: Vita"
  const bundaLineMatch = fullChatText.match(/(?:nama\s*bunda|nama\s*pasien|nama\s*ibu|nama\s*lengkap)\s*[:=][ \t]*([^\r\n\t]+)/i);
  if (bundaLineMatch && bundaLineMatch[1].trim()) {
    const rawVal = bundaLineMatch[1].trim();
    if (
      rawVal &&
      rawVal !== '-' &&
      rawVal !== ':' &&
      !/^(?:alamat|kec|kota|no|nomor|pilihan|treatment|usia|nama)\b/i.test(rawVal)
    ) {
      extractedBundaName = cleanBundaName(rawVal);
      isExtracted = true;
    }
  }

  // E. Ekstraksi Alamat dari baris: "Alamat & Shareloc :Jln gang sempati...", "Alamat : ..."
  const addressLineMatch = fullChatText.match(/(?:alamat\s*&(?:amp;)?\s*shareloc|alamat\s*lengkap|alamat)\s*[:=][ \t]*([^\r\n\t]+)/i);
  if (addressLineMatch && addressLineMatch[1].trim()) {
    const rawAddr = addressLineMatch[1].trim();
    if (
      rawAddr &&
      rawAddr !== '-' &&
      rawAddr.length > 3 &&
      !/^(?:kec|kota|kab|no|nomor|pilihan|treatment|usia|nama)\b/i.test(rawAddr)
    ) {
      extractedAddress = rawAddr;
      isExtracted = true;
    }
  }

  // F. Ekstraksi Kecamatan & Kota
  const kecLineMatch = fullChatText.match(/(?:kec\s*&(?:amp;)?\s*kota|kecamatan)\s*[:=][ \t]*([^\r\n\t]+)/i);
  if (kecLineMatch && kecLineMatch[1].trim()) {
    const rawKec = kecLineMatch[1].trim();
    if (rawKec && rawKec !== '-' && !/^(?:kota|kab|no|nomor|pilihan|treatment|usia|nama)\b/i.test(rawKec)) {
      extractedKecamatan = rawKec;
      isExtracted = true;
    }
  }

  const kotaLineMatch = fullChatText.match(/(?:kota|kabupaten|kab)\s*[:=][ \t]*([^\r\n\t]+)/i);
  if (kotaLineMatch && kotaLineMatch[1].trim()) {
    const rawKota = kotaLineMatch[1].trim();
    if (rawKota && rawKota !== '-' && !/^(?:no|nomor|pilihan|treatment|usia|nama)\b/i.test(rawKota)) {
      extractedKota = rawKota;
      isExtracted = true;
    }
  }

  // G. Ekstraksi No HP
  const phoneLineMatch = fullChatText.match(/(?:no\.?\s*hp|nomor\s*hp|wa|telepon|phone)\s*[:=][ \t]*([0-9\s+-]{9,20})/i);
  if (phoneLineMatch && phoneLineMatch[1].trim()) {
    extractedPhone = phoneLineMatch[1].replace(/[^\d+]/g, '').trim();
    isExtracted = true;
  }

  // H. Ekstraksi Bagian Per Kategori: (Baby & Kids) vs (Moms)
  let babySectionText = '';
  let momsSectionText = '';

  const babyIndex = fullChatText.search(/pilihan\s*treatment\s*\(\s*baby/i);
  const momsIndex = fullChatText.search(/pilihan\s*treatment\s*\(\s*moms/i);

  if (babyIndex !== -1 && momsIndex !== -1) {
    if (babyIndex < momsIndex) {
      babySectionText = fullChatText.slice(babyIndex, momsIndex);
      momsSectionText = fullChatText.slice(momsIndex);
    } else {
      momsSectionText = fullChatText.slice(momsIndex, babyIndex);
      babySectionText = fullChatText.slice(babyIndex);
    }
  } else if (babyIndex !== -1) {
    babySectionText = fullChatText.slice(babyIndex);
  } else if (momsIndex !== -1) {
    momsSectionText = fullChatText.slice(momsIndex);
  } else {
    babySectionText = fullChatText;
  }

  // Ekstraksi Data Bayi dari babySectionText (Formulir eksplisit)
  const childLineMatch = babySectionText.match(/(?:nama\s*bayi|nama\s*anak)\s*[:=][ \t]*([^\r\n\t]+)/i);
  if (childLineMatch && childLineMatch[1].trim()) {
    let candidateName = childLineMatch[1].trim();
    candidateName = candidateName.replace(/\s+(?:usia|umur)\s+.*$/i, '').trim();
    if (isValidChildName(candidateName)) {
      extractedChildName = candidateName;
      isExtracted = true;
    }
  }

  // Jika belum dapat dari form, coba cari dari frasa percakapan (misal: "dedek leo", "adik kenzo")
  if (!extractedChildName) {
    const convoMatch = fullChatText.match(/(?:dedek|adik|si\s*kecil)\s+([a-zA-Z\s]{2,20})/i);
    if (convoMatch && convoMatch[1].trim()) {
      let candidateName = convoMatch[1].trim();
      candidateName = candidateName.replace(/\s+(?:usia|umur|lagi|mau|bisa|nya)\s+.*$/i, '').trim();
      if (isValidChildName(candidateName)) {
        extractedChildName = candidateName;
        isExtracted = true;
      }
    }
  }

  // Ekstraksi Usia Bayi
  const ageLineMatch = babySectionText.match(/(?:usia\s*(?:bayi\/anak|anak|bayi)?|umur)\s*[:=][ \t]*([^\r\n\t]+)/i)
    || fullChatText.match(/(?:usia|umur)\s+([0-9]+\s*(?:tahun|thn|bln|bulan)(?:\s*[0-9]+\s*(?:bln|bulan))?)/i);
  if (ageLineMatch && ageLineMatch[1].trim()) {
    const candidateAge = ageLineMatch[1].trim();
    if (candidateAge && candidateAge !== '-' && !/^(?:treatment|layanan|pilihan)\b/i.test(candidateAge)) {
      extractedChildAge = candidateAge;
      isExtracted = true;
    }
  }

  // Ekstraksi Treatment Baby
  let babyTreatment = '';
  const babyTreatMatch = babySectionText.match(/treatment\s*[:=][ \t]*([^\r\n\t]+)/i);
  if (babyTreatMatch && babyTreatMatch[1].trim()) {
    const rawT = babyTreatMatch[1].trim().replace(/^(?:baby|anak)\s*:\s*/i, '');
    if (rawT && rawT !== '-' && !/^(?:pilihan|payment|harga|total|ongkir)\b/i.test(rawT)) {
      babyTreatment = rawT;
    }
  }

  // Ekstraksi Treatment Moms
  let momsTreatment = '';
  if (momsSectionText) {
    const momsTreatMatch = momsSectionText.match(/treatment\s*[:=][ \t]*([^\r\n\t]+)/i);
    if (momsTreatMatch && momsTreatMatch[1].trim()) {
      const rawT = momsTreatMatch[1].trim().replace(/^moms?\s*:\s*/i, '');
      if (rawT && rawT !== '-' && !/^(?:pilihan|payment|harga|total|ongkir|usia)\b/i.test(rawT)) {
        momsTreatment = rawT;
      }
    }
  }

  // Tentukan Kategori & Nama Treatment gabungan
  if (babyTreatment && momsTreatment) {
    extractedTreatment = `${babyTreatment} + ${momsTreatment}`;
    extractedCategory = 'BUNDLE';
    isExtracted = true;
  } else if (babyTreatment) {
    extractedTreatment = babyTreatment;
    extractedCategory = 'BABY';
    isExtracted = true;
  } else if (momsTreatment) {
    extractedTreatment = momsTreatment;
    extractedCategory = 'MOMS';
    isExtracted = true;
  }

  // I. Ekstraksi Payment Block: "Treatment = 80.000", "Ongkir 6,8km = 15.000", "Promo ongkir = - 5.000"
  const treatPriceMatch = fullChatText.match(/treatment\s*=\s*([\d.,]+(?:\s*k|\s*rb|\s*ribu)?)/i);
  if (treatPriceMatch) {
    const p = parsePriceText(treatPriceMatch[1]);
    if (p !== null) {
      extractedPrice = p;
      isExtracted = true;
    }
  }

  // Match: "Ongkir 6,8km = 15.000" atau "Ongkir 6.8 km = free"
  const ongkirKmMatch = fullChatText.match(/ongkir\s*([0-9]+(?:[.,][0-9]+)?)\s*km\s*=\s*(free|gratis|[\d.,]+(?:\s*k|\s*rb|\s*ribu)?)/i);
  if (ongkirKmMatch) {
    const kmStr = ongkirKmMatch[1].replace(',', '.');
    const parsedKm = parseFloat(kmStr);
    if (!isNaN(parsedKm)) {
      extractedDistanceKm = parsedKm;
    }
    const parsedO = parsePriceText(ongkirKmMatch[2]);
    if (parsedO !== null) {
      extractedOngkir = parsedO;
    }
    isExtracted = true;
  } else {
    // Match sederhana: "Ongkir = 15.000", "Ongkir: 15rb", "ongkir ke lokasi bunda 15rb"
    const simpleOngkirMatch = fullChatText.match(/ongkir\s*(?:ke\s*[^:\n\r\d]+|nya)?\s*[:=]?\s*(free|gratis|[0-9]+(?:[.,][0-9]+)?(?:\s*k|\s*rb|\s*ribu|\.000)?)/i);
    if (simpleOngkirMatch) {
      const parsedO = parsePriceText(simpleOngkirMatch[1]);
      if (parsedO !== null) {
        extractedOngkir = parsedO;
        isExtracted = true;
      }
    }
  }

  // Match: Promo / Potongan Ongkir ("Promo ongkir = - 5.000", "Promo = 5.000", "Diskon = 5rb")
  const promoMatch = fullChatText.match(/(?:promo\s*ongkir|promo|diskon|potongan)\s*=\s*-?\s*([\d.,]+(?:\s*k|\s*rb|\s*ribu)?)/i);
  if (promoMatch) {
    const parsedPromo = parsePriceText(promoMatch[1]);
    if (parsedPromo !== null && parsedPromo > 0) {
      extractedDiscount = parsedPromo;
      isExtracted = true;
    }
  }

  // =========================================================================
  // TAHAP 2: FALLBACK & INTEGRASI DATABASE PRIORITAS
  // =========================================================================

  // 1. Data Reservasi Terakhir dari Database
  const activeReservation = customer?.reservations?.[0];
  if (activeReservation) {
    if (!extractedDate && activeReservation.booking_date) {
      const bDate = new Date(activeReservation.booking_date);
      if (!isNaN(bDate.getTime())) {
        extractedDate = bDate;
        rawDateText = formatIndonesianDate(bDate);
      }
    }
    if (!extractedTreatment && activeReservation.treatment_detail) {
      extractedTreatment = activeReservation.treatment_detail.replace(/^(?:baby|moms)\s*:\s*/i, '');
    }
    if (extractedPrice === null && activeReservation.purchase_value) {
      extractedPrice = Number(activeReservation.purchase_value);
    }
    if (activeReservation.treatment_category) {
      const cat = activeReservation.treatment_category.toUpperCase();
      if (cat === 'MOMS' || cat.includes('MOM')) {
        extractedCategory = 'MOMS';
      } else if (cat === 'BOTH' || cat.includes('BUNDLE')) {
        extractedCategory = 'BUNDLE';
      } else {
        extractedCategory = 'BABY';
      }
    }
  }

  // 2. Data Anak dari Database (Prioritas jika chat tidak punya nama anak valid)
  if (customer?.children && customer.children.length > 0) {
    const firstChild = customer.children[0];
    if (!extractedChildName && isValidChildName(firstChild.name)) {
      extractedChildName = firstChild.name;
    }
    if (!extractedChildAge) {
      if (firstChild.raw_age_text) {
        extractedChildAge = firstChild.raw_age_text;
      } else if (firstChild.current_age) {
        extractedChildAge = firstChild.current_age;
      } else if (firstChild.age_months) {
        const yrs = Math.floor(firstChild.age_months / 12);
        const mos = firstChild.age_months % 12;
        extractedChildAge = yrs > 0 ? `${yrs} tahun ${mos} bulan` : `${mos} bulan`;
      }
    }
  }

  // 3. Data Pelanggan & Lokasi dari Database
  if (!extractedBundaName) {
    const rawName = customer?.name || customer?.customer_name || '';
    extractedBundaName = cleanBundaName(rawName, customer?.kecamatan, customer?.kota);
  }

  if (!extractedPhone) {
    extractedPhone = customer?.phone || customer?.customer_phone || '';
  }

  if (!extractedAddress) {
    extractedAddress = customer?.address || customer?.preferences?.address || customer?.kelurahan || '';
  }

  if (!extractedKecamatan) {
    extractedKecamatan = customer?.kecamatan || '';
  }

  if (!extractedKota) {
    extractedKota = customer?.kota || '';
  }

  if (extractedDistanceKm === null) {
    extractedDistanceKm = Number(customer?.distance_km ?? customer?.distanceKm ?? 3.0);
    if (isNaN(extractedDistanceKm)) extractedDistanceKm = 3.0;
  }

  if (extractedOngkir === null) {
    if (customer?.ongkir != null) {
      extractedOngkir = Number(customer.ongkir);
    } else if (extractedDistanceKm <= 3.0) {
      extractedOngkir = 0;
    } else {
      extractedOngkir = Math.round((extractedDistanceKm - 3.0) * 3000);
    }
  }

  // 4. Default Tanggal & Jam jika benar-benar belum terisi
  if (!extractedDate) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + 1);
    extractedDate = d;
    rawDateText = formatIndonesianDate(d);
  }

  if (!extractedTime) {
    extractedTime = '12.00-12.30';
  }

  // 5. Pencocokan Treatment dengan Katalog Layanan
  if (!extractedTreatment) {
    if (clinicServices.length > 0) {
      const s0 = clinicServices[0];
      extractedTreatment = s0.name;
      extractedPrice = Number(s0.promoPrice ?? s0.price ?? s0.originalPrice ?? 60000);
    } else {
      extractedTreatment = 'Pijat Ceria';
      extractedPrice = 60000;
    }
  } else if (extractedPrice === null) {
    // Cari kecocokan harga di katalog layanan
    const matchedService = clinicServices.find(
      (s) => s.name.toLowerCase() === extractedTreatment.toLowerCase() ||
             extractedTreatment.toLowerCase().includes(s.name.toLowerCase())
    );
    if (matchedService) {
      extractedPrice = Number(matchedService.promoPrice ?? matchedService.price ?? matchedService.originalPrice ?? 60000);
    } else {
      extractedPrice = 60000;
    }
  }

  // Tentukan Kategori Layanan jika belum terdefinisi
  const treatLower = extractedTreatment.toLowerCase();
  if (
    extractedCategory !== 'BUNDLE' &&
    (
      treatLower.includes('mom') ||
      treatLower.includes('ibu') ||
      treatLower.includes('hamil') ||
      treatLower.includes('nifas') ||
      treatLower.includes('laktasi') ||
      treatLower.includes('breast') ||
      treatLower.includes('prenatal') ||
      treatLower.includes('postpartum') ||
      treatLower.includes('yoga')
    )
  ) {
    extractedCategory = 'MOMS';
  }

  return {
    bookingDate: extractedDate,
    dateDisplay: rawDateText,
    timeDisplay: extractedTime,
    treatmentName: extractedTreatment,
    treatmentPrice: extractedPrice || 60000,
    treatmentCategory: extractedCategory,
    childName: extractedChildName,
    childAge: extractedChildAge,
    bundaName: extractedBundaName,
    phone: extractedPhone,
    address: extractedAddress,
    kecamatan: extractedKecamatan,
    kota: extractedKota,
    distanceKm: extractedDistanceKm,
    ongkir: extractedOngkir,
    discount: extractedDiscount,
    isExtractedFromChat: isExtracted,
    confidenceScore: isExtracted ? 0.95 : 0.6,
  };
}
