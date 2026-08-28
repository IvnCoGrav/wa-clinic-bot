
export interface ExtractedTransaction {
  customerPhone: string;
  customerName: string;
  address: string;
  kec: string;
  kota: string;
  babyName: string;
  babyAge: string;
  treatmentCategory: 'BABY' | 'MOMS' | 'BOTH';
  treatmentDetail: string;
  bookingDateStr: string;
  bookingDate: Date | null;
  treatmentPrice: number;
  ongkir: number;
  promo: number;
  totalPrice: number;
  rawFormText: string;
  rawPaymentText: string;
}

/**
 * Normalisasi nominal mata uang fleksibel:
 * Menangani format: '130.000', '130000', '70rb', '25k', '70 rb', '95', dsb.
 * Menghindari kontaminasi angka jarak km (misal '11km (15.000)').
 */
export function parseCurrencyValue(valStr: string | null | undefined): number {
  if (!valStr || typeof valStr !== 'string') return 0;

  // 1. Bersihkan jarak km jika ada (misal "11km", "12 km")
  let raw = valStr.replace(/\b\d+\s*km\b/gi, '').replace(/\b\d+\s*kilometer\b/gi, '').trim().toLowerCase();
  if (!raw) return 0;

  // Jika ada angka di dalam kurung (misal "(15.000)" atau "(25rb)"), utamakan angka tersebut
  const parenMatch = raw.match(/\((?:rp\.?\s*)?([\d\.]+)\s*(?:rb|k|ribu)?\)/i);
  if (parenMatch) {
    raw = parenMatch[0];
  }

  // Cek apakah ada unit 'rb', 'k', 'ribu'
  const isRibuan = /\b(rb|k|ribu)\b/i.test(raw) || /[\d]+(rb|k)/i.test(raw);

  // Bersihkan karakter selain angka
  const digitsOnly = raw.replace(/[^\d]/g, '');
  if (!digitsOnly) return 0;

  let num = parseInt(digitsOnly, 10);
  if (isNaN(num)) return 0;

  // Jika eksplisit ada 'rb' / 'k' atau jika angka <= 500 (misal 60, 70, 85, 95, 105, 145)
  if (isRibuan || (num > 0 && num <= 500)) {
    num = num * 1000;
  }

  // Safety Cap: Jika angka > 5 juta (misal kontaminasi no hp atau rekening), kembalikan 0
  if (num > 5000000) {
    return 0;
  }

  return num;
}

/**
 * Parser rincian pembayaran pintar:
 * Mendukung format Equation: 'Total = 70rb + ongkir 25rb = 95rb'
 * dan format Baris: 'Treatment = 130.000\nOngkir = 25.000\nTotal = 145.000'
 */
export function parsePaymentSection(paymentText: string): {
  treatmentPrice: number;
  ongkir: number;
  promo: number;
  totalPrice: number;
} {
  if (!paymentText) {
    return { treatmentPrice: 0, ongkir: 0, promo: 0, totalPrice: 0 };
  }

  // Bersihkan markdown formatting WhatsApp (*, _, ~)
  const clean = paymentText.replace(/[*_~`]/g, '').trim();

  let treatmentPrice = 0;
  let ongkir = 0;
  let promo = 0;
  let totalPrice = 0;

  // 1. Pola Equation: Total = 70.000 + ongkir 25.000 = 95.000
  // atau: Total = 80rb + ongkir 15rb = 95rb
  // atau: Total = 85.000 + ongkir 11km (15.000) = *100.000*
  // atau: Total = 100 + 70 + ongkir 15rb = 185.000
  const equationMatch = clean.match(/Total\s*[:=]\s*([^\n\r]+)/i);
  if (equationMatch) {
    const eqLine = equationMatch[1].trim();

    // Cek apakah ada tanda '+' dan '=' di dalam baris tersebut
    if (eqLine.includes('+') && eqLine.includes('=')) {
      const parts = eqLine.split('=');
      if (parts.length >= 2) {
        const leftSide = parts[0]; // e.g. "70rb + ongkir 25rb" atau "85.000 + ongkir 11km (15.000)"
        const rightSide = parts[parts.length - 1]; // e.g. "95rb" atau "100.000"

        totalPrice = parseCurrencyValue(rightSide);

        // Pecah leftSide berdasarkan '+'
        const addends = leftSide.split('+');
        for (const addend of addends) {
          const trimmedAddend = addend.trim();
          if (/ongkir/i.test(trimmedAddend)) {
            ongkir = parseCurrencyValue(trimmedAddend);
          } else if (/promo/i.test(trimmedAddend)) {
            promo = parseCurrencyValue(trimmedAddend);
          } else {
            treatmentPrice += parseCurrencyValue(trimmedAddend);
          }
        }
      }
    }
  }

  // 2. Jika belum terisi dari Equation, gunakan pencocokan baris per baris standar
  if (treatmentPrice === 0 && totalPrice === 0) {
    const tMatch = clean.match(/(?:Treatment|Paket|Layanan)\s*[:=]\s*([^\n\r]+)/i);
    if (tMatch) treatmentPrice = parseCurrencyValue(tMatch[1]);

    const oMatch = clean.match(/Ongkir[^\n\r:=]*[:=]\s*([^\n\r]+)/i);
    if (oMatch) ongkir = parseCurrencyValue(oMatch[1]);

    const pMatch = clean.match(/Promo[^\n\r:=]*[:=]\s*[-]?\s*([^\n\r]+)/i);
    if (pMatch) promo = parseCurrencyValue(pMatch[1]);

    const totMatch = clean.match(/Total\s*[:=]\s*([^\n\r+=]+)/i);
    if (totMatch) totalPrice = parseCurrencyValue(totMatch[1]);
  }

  // 3. Rekonsiliasi Matematika
  if (totalPrice === 0 && treatmentPrice > 0) {
    totalPrice = treatmentPrice + ongkir - promo;
  } else if (treatmentPrice === 0 && totalPrice > 0) {
    if (ongkir > 0) {
      treatmentPrice = Math.max(0, totalPrice - ongkir + promo);
    } else {
      treatmentPrice = totalPrice;
    }
  }

  return { treatmentPrice, ongkir, promo, totalPrice };
}

/**
 * Parser tanggal fleksibel Bahasa Indonesia:
 * Menangani format seperti 'Rabu, 12 agustus 26 jam 12.30', 'Selasa tgl 7 Juli 2026', '26 july 2026', dsb.
 */
export function parseIndonesianDate(dateStr: string): Date | null {
  if (!dateStr || typeof dateStr !== 'string') return null;

  const raw = dateStr.toLowerCase().replace(/[*_~`]/g, '').trim();

  // Mapping bulan Indonesia
  const monthMap: Record<string, number> = {
    jan: 0, januari: 0, january: 0,
    feb: 1, februari: 1, february: 1,
    mar: 2, maret: 2, march: 2,
    apr: 3, april: 3,
    mei: 4, may: 4,
    jun: 5, juni: 5, june: 5,
    jul: 6, juli: 6, july: 6,
    agu: 7, agust: 7, agustus: 7, august: 7, agt: 7, ags: 7,
    sep: 8, sept: 8, september: 8,
    okt: 9, oktober: 9, october: 9,
    nov: 10, november: 10,
    des: 11, desember: 11, december: 11,
  };

  // 1. Ekstrak Jam & Menit
  let hour = 9;
  let minute = 0;
  const timeMatch = raw.match(/jam\s*(\d{1,2})[.:](\d{2})/i) || raw.match(/(\d{1,2})[.:](\d{2})\s*(?:wib)?/i);
  if (timeMatch) {
    hour = parseInt(timeMatch[1], 10);
    minute = parseInt(timeMatch[2], 10);
  }

  // 2. Ekstrak Hari, Bulan, Tahun
  // Format: 12 agustus 26 atau 7 Juli 2026 atau 7-07-2026
  let day = 1;
  let month = 6; // default Juli
  let year = 2026;

  // Cek format angka DD-MM-YYYY atau DD/MM/YYYY
  const numericMatch = raw.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (numericMatch) {
    day = parseInt(numericMatch[1], 10);
    month = parseInt(numericMatch[2], 10) - 1;
    let yr = parseInt(numericMatch[3], 10);
    if (yr < 100) yr += 2000;
    year = yr;
  } else {
    // Format teks bulan: "12 agustus 2026" / "12 agustus 26" / "7 Juli"
    const textMatch = raw.match(/(\d{1,2})\s+([a-z]+)(?:\s+(\d{2,4}))?/i) ||
                      raw.match(/([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{2,4}))?/i);

    if (textMatch) {
      let dStr = textMatch[1];
      let mStr = textMatch[2];
      let yStr = textMatch[3];

      // Jika dibalik (Bulan Tanggal)
      if (isNaN(parseInt(dStr, 10)) && !isNaN(parseInt(mStr, 10))) {
        const tmp = dStr;
        dStr = mStr;
        mStr = tmp;
      }

      day = parseInt(dStr, 10) || 1;
      const mLower = mStr.toLowerCase();
      for (const [key, val] of Object.entries(monthMap)) {
        if (mLower.startsWith(key)) {
          month = val;
          break;
        }
      }

      if (yStr) {
        let yr = parseInt(yStr, 10);
        if (yr < 100) yr += 2000;
        year = yr;
      }
    }
  }

  try {
    const d = new Date(Date.UTC(year, month, day, hour - 7, minute)); // UTC offset WIB (UTC+7)
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/**
 * Ekstraktor utama seluruh percakapan riwayat transkrip chat:
 * Menerapkan Conversation State Windowing untuk menyambungkan Form Terisi dengan Payment Outbound.
 */
export function extractTransactionsFromTranscript(content: string): ExtractedTransaction[] {
  if (!content) return [];

  // Split per kontak pelanggan
  const contactSections = content.split(/## #\d+\./i).slice(1);
  const results: ExtractedTransaction[] = [];

  for (const section of contactSections) {
    // Ambil nomor telepon
    const phoneMatch = section.match(/— `(\d+)`/);
    const phone = phoneMatch ? phoneMatch[1] : '';
    if (!phone) continue;

    // Bersihkan karakter quote '>' di awal baris dan split per bubble pesan
    const cleanSection = section.replace(/^[>\s]+/gm, '');

    // Cari blok form reservasi
    // Split berdasarkan header reservasi utama (bukan sub-section di tengah form)
    const formRegex = /(?:Berikut\s+(?:list\s+untuk\s+)?reservasi|Format\s+reservasi|Form\s+reservasi|Form\s+booking|List\s+reservasi)/gi;
    let formPositions: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = formRegex.exec(cleanSection)) !== null) {
      formPositions.push(match.index);
    }

    if (formPositions.length === 0) {
      // Fallback jika tidak ada kalimat pengantar, cari awal baris "Hari dan tanggal"
      const dateRegex = /Hari\s+dan\s+tanggal\s*[:=]/gi;
      while ((match = dateRegex.exec(cleanSection)) !== null) {
        formPositions.push(match.index);
      }
    }

    if (formPositions.length === 0) {
      continue;
    }

    for (let i = 0; i < formPositions.length; i++) {
      const startIdx = formPositions[i];
      const endIdx = i + 1 < formPositions.length ? formPositions[i + 1] : cleanSection.length;
      // Ambil jendela teks form + pesan-pesan setelahnya (hingga 2500 karakter atau form berikutnya)
      const windowText = cleanSection.substring(startIdx, Math.min(startIdx + 2500, endIdx));

      // Ekstrak baris form
      const dateMatch = windowText.match(/Hari\s+dan\s+tanggal\s*[:=]\s*([^\n\r]+)/i);
      const nameMatch = windowText.match(/Nama\s+Bunda\s*[:=]\s*([^\n\r]+)/i) || windowText.match(/Nama\s*[:=]\s*([^\n\r]+)/i);
      const addressMatch = windowText.match(/Alamat\s*(?:&\s*Shareloc)?\s*[:=]\s*([^\n\r]+)/i);
      const kecMatch = windowText.match(/\bKec\s*[:=]\s*([^\n\r]+)/i);
      const kotaMatch = windowText.match(/\bKota\s*[:=]\s*([^\n\r]+)/i);
      const babyMatch = windowText.match(/Nama\s+Bayi\s*[:=]\s*([^\n\r]+)/i) || windowText.match(/Nama\s+Anak\s*[:=]\s*([^\n\r]+)/i);
      const ageMatch = windowText.match(/Usia\s+Bayi(?:\/Anak)?\s*[:=]\s*([^\n\r]+)/i) || windowText.match(/Usia\s*[:=]\s*([^\n\r]+)/i);
      const treatMatch = windowText.match(/Treatment\s*[:=]\s*([^\n\r]+)/i);

      const customerName = nameMatch ? nameMatch[1].replace(/^[>\s*_-]+|[>\s*_-]+$/g, '').trim() : '';

      // VALIDASI: Lewati jika ini hanya template kosong
      if (
        !customerName ||
        customerName.length <= 1 ||
        customerName.toLowerCase() === 'nama bunda' ||
        customerName.toLowerCase().startsWith('nama bunda') ||
        customerName.includes('Alamat') ||
        customerName.includes('Shareloc')
      ) {
        continue;
      }

      const address = addressMatch ? addressMatch[1].replace(/^[>\s*_-]+|[>\s*_-]+$/g, '').trim() : '';
      const kec = kecMatch ? kecMatch[1].replace(/^[>\s*_-]+|[>\s*_-]+$/g, '').trim() : '';
      const kota = kotaMatch ? kotaMatch[1].replace(/^[>\s*_-]+|[>\s*_-]+$/g, '').trim() : '';
      const babyName = babyMatch ? babyMatch[1].replace(/^[>\s*_-]+|[>\s*_-]+$/g, '').trim() : '';
      const babyAge = ageMatch ? ageMatch[1].replace(/^[>\s*_-]+|[>\s*_-]+$/g, '').trim() : '';
      const treatmentDetail = treatMatch ? treatMatch[1].replace(/^[>\s*_-]+|[>\s*_-]+$/g, '').trim() : 'Layanan Spa';
      const bookingDateStr = dateMatch ? dateMatch[1].replace(/^[>\s*_-]+|[>\s*_-]+$/g, '').trim() : '';

      // Ekstrak bagian Payment / Pembayaran
      const paymentSectionMatch = windowText.match(/(?:Payment|Pembayaran|Rincian\s+biaya)[\s\S]*?(?=(?:Hari\s+H\s+Pagi|Sampai\s+bertemu|Terimakasih|Berikut\s+reservasi|\n\n\n|$))/i) ||
                                  windowText.match(/Total\s*[:=][^\n\r]+/i);

      const rawPaymentText = paymentSectionMatch ? paymentSectionMatch[0] : '';
      const financial = parsePaymentSection(rawPaymentText);

      // Tentukan Treatment Category
      const lowerTreat = (treatmentDetail + ' ' + windowText).toLowerCase();
      let treatmentCategory: 'BABY' | 'MOMS' | 'BOTH' = 'BABY';
      if (lowerTreat.includes('hamil') || lowerTreat.includes('nifas') || lowerTreat.includes('moms') || lowerTreat.includes('ibu') || lowerTreat.includes('laktasi')) {
        treatmentCategory = lowerTreat.includes('bayi') || lowerTreat.includes('kids') ? 'BOTH' : 'MOMS';
      }

      results.push({
        customerPhone: phone,
        customerName,
        address: [address, kec, kota].filter(Boolean).join(', ') || address || '-',
        kec,
        kota,
        babyName: babyName && babyName !== '-' ? babyName : '',
        babyAge: babyAge && babyAge !== '-' ? babyAge : '',
        treatmentCategory,
        treatmentDetail,
        bookingDateStr,
        bookingDate: parseIndonesianDate(bookingDateStr),
        treatmentPrice: financial.treatmentPrice,
        ongkir: financial.ongkir,
        promo: financial.promo,
        totalPrice: financial.totalPrice,
        rawFormText: windowText.substring(0, 500),
        rawPaymentText,
      });
    }
  }

  // DEDUPLIKASI & KONSOLIDASI:
  // Jika dalam 1 nomor telepon ada reservasi dengan tanggal/layanan yang sama,
  // dan salah satunya memiliki harga (totalPrice > 0) sedangkan yang lain Total = 0 (draft awal pelanggan),
  // pertahankan record yang memiliki rincian harga lengkap!
  const consolidated: ExtractedTransaction[] = [];
  const groupedByPhone = new Map<string, ExtractedTransaction[]>();

  for (const item of results) {
    if (!groupedByPhone.has(item.customerPhone)) {
      groupedByPhone.set(item.customerPhone, []);
    }
    groupedByPhone.get(item.customerPhone)!.push(item);
  }

  for (const [_phone, items] of groupedByPhone) {
    if (items.length === 1) {
      consolidated.push(items[0]);
      continue;
    }

    // Pisahkan item yang memiliki harga vs yang 0
    const pricedItems = items.filter((it) => it.totalPrice > 0);
    if (pricedItems.length > 0) {
      consolidated.push(...pricedItems);
    } else {
      // Jika semua 0, simpan yang paling lengkap datanya
      consolidated.push(items[items.length - 1]);
    }
  }

  return consolidated;
}
