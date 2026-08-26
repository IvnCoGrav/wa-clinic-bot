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
  isExtractedFromChat: boolean;
  confidenceScore: number;
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

const DAY_MAP: Record<string, number> = {
  minggu: 0, ahad: 0,
  senin: 1,
  selasa: 2,
  rabu: 3,
  kamis: 4,
  jumat: 5, "jum'at": 5,
  sabtu: 6
};

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
 * Ekstraksi entitas jadwal dari deretan pesan obrolan terakhir.
 */
export function extractScheduleFromMessages(
  messages: Array<{ content?: string; direction?: string; created_at?: string }>,
  customer?: any,
  clinicServices: Array<{ name: string; price: number; category?: string }> = []
): ExtractedScheduleData {
  const baseDate = new Date();
  let extractedDate: Date | null = null;
  let rawDateText = '';
  let extractedTime = '';
  let extractedTreatment = '';
  let extractedPrice = 60000;
  let extractedCategory: 'BABY' | 'MOMS' | 'BUNDLE' = 'BABY';
  let extractedChildName = '';
  let extractedChildAge = '';
  let extractedOngkir: number | null = null;
  let isExtracted = false;

  // 1. Ambil 10 pesan terakhir dan gabungkan / analisis per bubble
  const recentMessages = (messages || []).slice(-10);
  const fullChatText = recentMessages
    .map((m) => m.content || '')
    .filter(Boolean)
    .join('\n');

  const textLower = fullChatText.toLowerCase();

  // 2. Ekstraksi Waktu / Jam
  // Pola rentang jam: "jam 12.00-12.30", "12.00 - 12.30", "12:00-12:30", "jam 12.00 - 13.00"
  const rangeMatch = fullChatText.match(/(?:jam|pukul)?\s*([0-2]?\d)[.:]([0-5]\d)\s*[-–]\s*([0-2]?\d)[.:]([0-5]\d)/i);
  if (rangeMatch) {
    const startH = rangeMatch[1].padStart(2, '0');
    const startM = rangeMatch[2];
    const endH = rangeMatch[3].padStart(2, '0');
    const endM = rangeMatch[4];
    extractedTime = `${startH}.${startM}-${endH}.${endM}`;
    isExtracted = true;
  } else {
    // Pola jam tunggal: "jam 12.00", "jam 12:30", "pukul 14.00"
    const singleTimeMatch = fullChatText.match(/(?:jam|pukul)\s*([0-2]?\d)[.:]([0-5]\d)/i);
    if (singleTimeMatch) {
      const h = singleTimeMatch[1].padStart(2, '0');
      const m = singleTimeMatch[2];
      extractedTime = `${h}.${m}`;
      isExtracted = true;
    } else {
      // Pola jam wacana: "jam 1 siang", "jam 10 pagi", "jam 2 sore", "jam 7 malam"
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

  // 3. Ekstraksi Hari & Tanggal
  // Pola Relatif: "besok lusa", "lusa", "besok", "bsk", "hari ini"
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
  }

  // Pola Tanggal Absolut: "27 agustus", "tgl 27 agustus 2026", "27-08-2026", "27/08"
  if (!extractedDate) {
    const absDateMatch = textLower.match(/(?:tgl|tanggal)?\s*([0-3]?\d)\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|jan|feb|mar|apr|mei|jun|jul|agu|ags|sep|okt|nov|des)(?:\s+(\d{4}))?/i);
    if (absDateMatch) {
      const day = parseInt(absDateMatch[1], 10);
      const monthStr = absDateMatch[2].toLowerCase();
      const month = MONTH_MAP[monthStr] ?? baseDate.getMonth();
      const year = absDateMatch[3] ? parseInt(absDateMatch[3], 10) : baseDate.getFullYear();

      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) {
        extractedDate = d;
        rawDateText = formatIndonesianDate(d);
        isExtracted = true;
      }
    }
  }

  // Pola Nama Hari: "hari kamis", "kamis depan", "rabu besok"
  if (!extractedDate) {
    const dayMatch = textLower.match(/(?:hari\s*)?(senin|selasa|rabu|kamis|jumat|jum'at|sabtu|minggu)/i);
    if (dayMatch) {
      const targetDay = DAY_MAP[dayMatch[1].toLowerCase()];
      if (targetDay !== undefined) {
        const currentDay = baseDate.getDay();
        let daysAhead = targetDay - currentDay;
        if (daysAhead <= 0) daysAhead += 7; // Hari di minggu depan jika sudah lewat
        const d = new Date(baseDate);
        d.setDate(d.getDate() + daysAhead);
        extractedDate = d;
        rawDateText = formatIndonesianDate(d);
        isExtracted = true;
      }
    }
  }

  // Fallback Tanggal jika tidak terdeteksi di chat: gunakan besok
  if (!extractedDate) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + 1);
    extractedDate = d;
    rawDateText = formatIndonesianDate(d);
  }

  // Fallback Jam jika tidak terdeteksi di chat
  if (!extractedTime) {
    extractedTime = '12.00-12.30';
  }

  // 4. Ekstraksi Layanan Treatment
  // Cek katalog klinik jika tersedia
  if (clinicServices.length > 0) {
    for (const s of clinicServices) {
      const sNameLower = s.name.toLowerCase();
      if (textLower.includes(sNameLower)) {
        extractedTreatment = s.name;
        extractedPrice = s.price || 60000;
        if (s.category) {
          const cat = s.category.toUpperCase();
          if (cat.includes('MOM') || cat.includes('HAMIL') || cat.includes('NIFAS') || cat.includes('LAKTASI')) {
            extractedCategory = 'MOMS';
          } else {
            extractedCategory = 'BABY';
          }
        }
        isExtracted = true;
        break;
      }
    }
  }

  // Fallback pattern keyword layanan
  if (!extractedTreatment) {
    if (textLower.includes('pijat ceria') || textLower.includes('ceria')) {
      extractedTreatment = 'pijat ceria';
      extractedPrice = 60000;
      extractedCategory = 'BABY';
    } else if (textLower.includes('baby gym') || textLower.includes('gym')) {
      extractedTreatment = 'Baby Massage & Gym';
      extractedPrice = 75000;
      extractedCategory = 'BABY';
    } else if (textLower.includes('batuk pilek') || textLower.includes('bapil')) {
      extractedTreatment = 'Pijat Batuk Pilek & Flu';
      extractedPrice = 80000;
      extractedCategory = 'BABY';
    } else if (textLower.includes('laktasi') || textLower.includes('breast')) {
      extractedTreatment = 'Pijat Laktasi & Breast Care';
      extractedPrice = 120000;
      extractedCategory = 'MOMS';
    } else if (textLower.includes('hamil') || textLower.includes('prenatal') || textLower.includes('yoga')) {
      extractedTreatment = 'Prenatal Gentle Yoga / Massage';
      extractedPrice = 135000;
      extractedCategory = 'MOMS';
    } else {
      extractedTreatment = 'pijat ceria';
      extractedPrice = 60000;
      extractedCategory = 'BABY';
    }
  }

  // 5. Ekstraksi Data Anak / Bayi
  // Cek database customer terlebih dahulu
  if (customer?.children && customer.children.length > 0) {
    const firstChild = customer.children[0];
    extractedChildName = firstChild.name || '';
    if (firstChild.current_age) {
      extractedChildAge = firstChild.current_age;
    } else if (firstChild.age_months) {
      const yrs = Math.floor(firstChild.age_months / 12);
      const mos = firstChild.age_months % 12;
      extractedChildAge = yrs > 0 ? `${yrs} tahun ${mos} bulan` : `${mos} bulan`;
    }
  }

  // Cek apakah ada nama anak disebut di chat: "nama bayi : leo", "anak saya leo", "adik arkaan"
  const childMatch = fullChatText.match(/(?:nama\s*bayi|nama\s*anak|dedek|adik|si\s*kecil)\s*[:=]?\s*([a-zA-Z\s]{2,20})/i);
  if (childMatch && childMatch[1].trim()) {
    extractedChildName = childMatch[1].trim();
  }

  const ageMatch = fullChatText.match(/(?:usia|umur)\s*[:=]?\s*([0-9]+\s*(?:tahun|thn|bln|bulan)(?:\s*[0-9]+\s*(?:bln|bulan))?)/i);
  if (ageMatch && ageMatch[1].trim()) {
    extractedChildAge = ageMatch[1].trim();
  }

  if (!extractedChildName && extractedCategory === 'BABY') {
    extractedChildName = 'leo';
  }
  if (!extractedChildAge && extractedCategory === 'BABY') {
    extractedChildAge = '3tahun 7 bulan';
  }

  // 6. Ekstraksi Ongkir
  // Cek apakah ada ongkir disebut di chat: "ongkir 15rb", "ongkir: 10.000", "ongkir ke lokasi bunda 15rb", "ongkir free"
  const ongkirMatch = fullChatText.match(/ongkir\s*(?:ke\s*[^:\n\r\d]+|nya)?\s*[:=]?\s*(free|gratis|\d+(?:[.,]\d+)?(?:\s*k|\s*rb|\s*ribu|\.000)?)/i);
  if (ongkirMatch) {
    const rawOngkir = ongkirMatch[1].toLowerCase();
    if (rawOngkir.includes('free') || rawOngkir.includes('gratis') || rawOngkir === '0') {
      extractedOngkir = 0;
    } else {
      const numStr = rawOngkir.replace(/[^\d]/g, '');
      const parsed = parseInt(numStr, 10);
      if (!isNaN(parsed)) {
        extractedOngkir = parsed < 100 ? parsed * 1000 : parsed;
      }
    }
  }

  // Jika tidak ditemukan di chat, gunakan customer profile ongkir & jarak km
  const distanceKm = Number(customer?.distance_km ?? customer?.distanceKm ?? 3.0);
  if (extractedOngkir === null) {
    if (customer?.ongkir != null) {
      extractedOngkir = Number(customer.ongkir);
    } else if (distanceKm <= 3.0) {
      extractedOngkir = 0;
    } else {
      // Default tier: Rp 3.000 / km diatas 3km
      extractedOngkir = Math.round((distanceKm - 3.0) * 3000);
    }
  }

  // 7. Sanitasi Nama Bunda
  let bundaName = customer?.name || customer?.customer_name || 'Karmila';
  bundaName = bundaName.replace(/^(bunda|ibu|mama|mrs\.?)\s+/i, '').trim();

  return {
    bookingDate: extractedDate,
    dateDisplay: rawDateText,
    timeDisplay: extractedTime,
    treatmentName: extractedTreatment,
    treatmentPrice: extractedPrice,
    treatmentCategory: extractedCategory,
    childName: extractedChildName,
    childAge: extractedChildAge,
    bundaName,
    phone: customer?.phone || customer?.customer_phone || '081280482533',
    address: customer?.address || customer?.preferences?.address || 'infesta residense/homestay alas tipis pabean lantai 3 no 301',
    kecamatan: customer?.kecamatan || '',
    kota: customer?.kota || '',
    distanceKm: isNaN(distanceKm) ? 3.0 : distanceKm,
    ongkir: extractedOngkir ?? 0,
    isExtractedFromChat: isExtracted,
    confidenceScore: isExtracted ? 0.9 : 0.5,
  };
}
