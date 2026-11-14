import { Reservation } from '../types';
import { extractBabiesFromRawText } from './reservationBabies';
import { stripBufferMetadata } from './treatmentStringParser';
import { calculateOngkirFromTiers } from './deliveryTierCalculator';
import { isValidChildName } from './chatScheduleExtractor';
import { resolveReservationAddress } from './reservationAddress';

const INDONESIAN_DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const INDONESIAN_MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export interface InvoiceCustomerData {
  id?: string;
  name?: string | null;
  phone?: string;
  address?: string | null;
  kelurahan?: string | null;
  kecamatan?: string | null;
  kota?: string | null;
  distance_km?: number | null;
  ongkir?: number | null;
  preferences?: any;
  children?: Array<{
    name: string;
    birth_date?: string | null;
    raw_age_text?: string | null;
    current_age?: string;
  }>;
}

export interface GenerateInvoiceParams {
  reservation: Partial<Reservation> & {
    booking_date?: string | null;
    treatment_detail?: string;
    treatment_category?: string;
    purchase_value?: number | null;
    raw_text?: string;
    babies?: Array<{ name: string; age?: string; ageText?: string }>;
    ongkir?: number | null;
    discount?: number | null;
  };
  customer?: InvoiceCustomerData | null;
  discount?: number;
}

function formatThousand(num: number | null | undefined): string {
  if (num === null || num === undefined || isNaN(num)) return '0';
  return new Intl.NumberFormat('id-ID').format(Math.round(num));
}

/**
 * Buang akhiran nama wilayah (kecamatan/kota) dari nama pasien.
 *
 * F-29: versi lama menyisipkan nama wilayah langsung ke `new RegExp(...)`.
 * Nama wilayah yang mengandung karakter regex — mis. `Wonokromo (Baru)`,
 * `Surabaya+Barat` — bisa melempar `SyntaxError` dan menggagalkan invoice.
 *
 * Perbaikan fondasional: tidak memakai regex sama sekali. Pencocokan akhiran
 * memakai API string standar (`toLowerCase` + `endsWith` + `slice`), sehingga
 * tidak ada karakter input yang bisa merusak pola. Syarat batas kata tetap
 * dijaga: hanya dipotong bila didahului spasi (mirror perilaku `\s+X$`).
 */
function stripTrailingRegion(name: string, region?: string | null): string {
  const full = name.trim();
  const suffix = (region || '').trim();
  if (!full || !suffix) return full;
  // `\s+X$` mustahil cocok bila tidak ada sisa nama sebelum akhiran.
  if (full.length <= suffix.length) return full;
  if (!full.toLowerCase().endsWith(suffix.toLowerCase())) return full;

  const cut = full.slice(0, full.length - suffix.length);
  if (!/\s$/.test(cut)) return full; // jangan potong di tengah kata
  return stripDanglingRegionLabel(cut.trim());
}

/**
 * Label wilayah yang biasa ikut terketik di dalam nama
 * ("Sari Kec. Wonokromo"). Setelah nama wilayah dibuang, labelnya bisa
 * tertinggal menjadi "Sari Kec." — bukan nama orang.
 *
 * Daftar ini adalah **label administratif tetap**, bukan data bisnis, jadi
 * aman diletakkan di kode. Tidak memakai regex pada input pengguna.
 */
const REGION_LABELS = ['kecamatan', 'kelurahan', 'kabupaten', 'kec', 'kel', 'kab', 'kota'];

function stripDanglingRegionLabel(name: string): string {
  let result = name;
  let changed = true;
  while (changed && result) {
    changed = false;
    const lower = result.toLowerCase();
    for (const label of REGION_LABELS) {
      // Cocokkan label utuh di ekor, boleh diikuti titik ("Kec.").
      const withDot = `${label}.`;
      const hit = lower.endsWith(` ${withDot}`) ? withDot : lower.endsWith(` ${label}`) ? label : null;
      if (!hit) continue;
      const rest = result.slice(0, result.length - hit.length).trim();
      // Jangan pernah mengosongkan nama hanya karena label.
      if (!rest) continue;
      result = rest;
      changed = true;
      break;
    }
  }
  return result;
}

export function cleanBundaName(name?: string | null, kecamatan?: string | null, kota?: string | null): string {
  if (!name) return '';
  let clean = name.replace(/^(?:bunda|ibu|mama|moms?|ny\.?|mrs\.?|kak|kakak)\s+/i, '').trim();
  if (kecamatan) {
    const kecClean = kecamatan.trim().replace(/^(?:kec\.?|kecamatan)\s+/i, '').trim();
    if (kecClean) clean = stripTrailingRegion(clean, kecClean);
  }
  if (kota) {
    const kotaClean = kota.trim().replace(/^(?:kab\.?|kabupaten|kota)\s+/i, '').trim();
    if (kotaClean) clean = stripTrailingRegion(clean, kotaClean);
  }
  return clean;
}

/**
 * Format tanggal dan jam Indonesia dari ISO string / Date — WIB deterministic via Intl
 * Contoh output: "Kamis, 27 Agustus 2026 jam 12.00-12.30" atau "Rabu, 26 Agustus 2026 jam 09.00 WIB"
 */
function formatIndonesianDateTime(dateStr?: string | null, rawText?: string): string {
  if (!dateStr) {
    if (rawText) {
      const match = rawText.match(/(?:tanggal|hari|jadwal|waktu)\s*[:=]\s*([^\n]+)/i);
      if (match && match[1]) return match[1].trim();
    }
    return '-';
  }

  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';

  // WIB deterministic: gunakan Intl dengan timeZone Asia/Jakarta (tahan di server UTC / browser non-WIB)
  const dayName = INDONESIAN_DAYS[d.getUTCDay()]; // fallback jika Intl gagal, tapi kita pakai Intl di bawah
  const formatter = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(d);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  const dayStr = get('weekday');
  const dateNum = get('day');
  const monthName = get('month');
  const year = get('year');
  const hour = get('hour').padStart(2, '0');
  const minute = get('minute').padStart(2, '0');

  // Cek apakah ada range jam di rawText (misal 12.00-12.30)
  let timeStr = `${hour}.${minute}`;
  if (rawText) {
    const rangeMatch = rawText.match(/(\d{1,2}[.:]\d{2}\s*[-–]\s*\d{1,2}[.:]\d{2})/);
    if (rangeMatch) {
      timeStr = rangeMatch[1].replace(':', '.');
    }
  }

  return `${dayStr} ${dateNum} ${monthName} ${year} jam ${timeStr}`;
}

function stripDurationFromTreatment(rawStr?: string | null): string {
  if (!rawStr) return '';
  return stripBufferMetadata(rawStr)
    .replace(/\s*\[\s*\d+\s*m(?:\s*Addon)?\s*\]/gi, '')
    .replace(/\s*\(\s*\d+\s*(?:menit|mins?|m)\s*\)/gi, '')
    .replace(/\s*\b\d+\s*(?:menit|mins?)\b/gi, '')
    .replace(/\s*\[Total\s*\d+m.*?\]/gi, '')
    .trim();
}

function buildBabyDetails(reservation: GenerateInvoiceParams['reservation'], customer: InvoiceCustomerData | null | undefined): Array<{ name: string; age: string }> {
  // Sumber 1: reservation.babies (dari form modal aktif / enrichment)
  if (Array.isArray((reservation as any).babies) && (reservation as any).babies.length > 0) {
    return (reservation as any).babies
      .map((b: any) => ({ name: (b.name || '').trim(), age: (b.age || b.ageText || '').trim() }))
      .filter((b: any) => b.name && b.name !== '-' && isValidChildName(b.name));
  }
  // Sumber 2: relasi children (reservation.children / reservation.customer.children / customer.children)
  const childrenList = (reservation as any).children || (reservation as any).customer?.children || customer?.children || [];
  if (Array.isArray(childrenList) && childrenList.length > 0) {
    return childrenList
      .map((c: any) => ({ name: (c.name || '').trim(), age: (c.current_age || c.raw_age_text || '').trim() }))
      .filter((b: any) => b.name && b.name !== '-' && isValidChildName(b.name));
  }
  // Sumber 3: reservation.baby_details (dari GET /api/admin/reservations)
  if (Array.isArray((reservation as any).baby_details) && (reservation as any).baby_details.length > 0) {
    return (reservation as any).baby_details
      .map((b: any) => ({ name: (b.name || '').trim(), age: (b.age || '').trim() }))
      .filter((b: any) => b.name && b.name !== '-' && isValidChildName(b.name));
  }
  // Sumber 4: Fallback regex raw_text / treatment_detail
  return extractBabiesFromRawText(reservation.raw_text, reservation.treatment_detail);
}

function resolveAddress(
  customer: InvoiceCustomerData | null | undefined,
  reservation: GenerateInvoiceParams['reservation']
): string {
  const mergedReservation = {
    ...reservation,
    customer: reservation?.customer || customer,
  };
  const view = resolveReservationAddress(mergedReservation as any);
  if (view.street) return view.street;
  return (
    customer?.address ||
    customer?.preferences?.address ||
    customer?.preferences?.address_detail ||
    customer?.kelurahan ||
    (reservation?.customer as any)?.preferences?.address ||
    (reservation?.customer as any)?.preferences?.address_detail ||
    (reservation?.customer as any)?.kelurahan ||
    ''
  );
}

function resolveOngkir(reservation: GenerateInvoiceParams['reservation'], customer: InvoiceCustomerData | null | undefined): { fee: number; line: string } {
  // Prioritaskan ongkir dari reservation (form manual) > customer
  const manualOngkir = (reservation as any).ongkir;
  const distanceKm = customer?.distance_km ?? (reservation.customer as any)?.distance_km ?? null;
  const custOngkir = customer?.ongkir ?? (reservation.customer as any)?.ongkir ?? 0;
  const effectiveOngkir = (manualOngkir !== undefined && manualOngkir !== null) ? Number(manualOngkir) : custOngkir;

  if (distanceKm !== null && distanceKm !== undefined) {
    const distStr = distanceKm.toFixed(1).replace('.', ',');
    if (effectiveOngkir <= 0 || distanceKm <= 3.0) {
      return { fee: 0, line: `Ongkir ${distStr} km = free` };
    }
    return { fee: effectiveOngkir, line: `Ongkir ${distStr} km = ${formatThousand(effectiveOngkir)}` };
  } else if (effectiveOngkir > 0) {
    return { fee: effectiveOngkir, line: `Ongkir = ${formatThousand(effectiveOngkir)}` };
  }
  return { fee: 0, line: 'Ongkir = free' };
}

/**
 * Mengenerate teks rincian booking & invoice pembayaran WhatsApp secara presisi
 *
 * KONTRAK DISCOUNT (wajib):
 * - purchase_value = HARGA NETTO (sudah termasuk diskon/promo yg berlaku saat booking)
 * - param `discount` = POTONGAN TAMBAHAN yang BELUM termasuk di purchase_value (mis. promo ongkir khusus, potongan admin manual)
 * - Form-driven caller SELALU kirim discount=0 (purchase_value sudah net). Jika ada promo ongkir terpisah, set discount > 0.
 */
export function generateReservationInvoiceText(params: GenerateInvoiceParams): string {
  const { reservation, customer, discount = 0 } = params;

  // 1. Hari dan Tanggal (WIB deterministic)
  const dateTimeStr = formatIndonesianDateTime(reservation.booking_date, reservation.raw_text);

  const kec = customer?.kecamatan || (reservation.customer as any)?.kecamatan || '';
  const kota = customer?.kota || (reservation.customer as any)?.kota || '';
  const phone = customer?.phone || (reservation.customer as any)?.phone || '';

  // 2. Data Bunda
  let bundaName = customer?.name || (reservation.customer as any)?.name || '';
  if (!bundaName && reservation.raw_text) {
    const match = reservation.raw_text.match(/(?:nama(?:\s*bunda|\s*ibu)?)\s*[:=]\s*([^\n]+)/i);
    if (match) bundaName = match[1].trim();
  }
  bundaName = cleanBundaName(bundaName, kec, kota);

  // 3. Alamat & Shareloc (preferences.address prioritized)
  const address = resolveAddress(customer, reservation);

  // 4. Pilihan Treatment Category
  const categoryRaw = (reservation.treatment_category || '').toUpperCase();
  let categoryLabel = 'Pilihan treatment (Baby & Kids)';
  if (categoryRaw === 'MOMS' || categoryRaw.includes('MOM') || categoryRaw.includes('HAMIL')) {
    categoryLabel = 'Pilihan treatment (Moms & Hamil)';
  } else if (categoryRaw === 'BOTH' || categoryRaw.includes('BUNDLE')) {
    categoryLabel = 'Pilihan treatment (Baby & Moms Bundle)';
  }

  // 5. Data Bayi / Anak — hierarkis & multi-bayi
  const babyDetails = buildBabyDetails(reservation, customer);

  // 6. Treatment Detail
  const rawTreatment = reservation.treatment_detail || 'Layanan Homecare';
  const treatment = stripDurationFromTreatment(rawTreatment) || 'Layanan Homecare';

  // 7. Payment Breakdown
  let treatmentPrice = reservation.purchase_value || 0;
  if (!treatmentPrice && reservation.raw_text) {
    const match = reservation.raw_text.match(/(?:treatment|harga|biaya)\s*[:=]\s*(?:rp\.?\s*)?([\d.,]+)/i);
    if (match) {
      treatmentPrice = parseInt(match[1].replace(/[.,]/g, ''), 10) || 0;
    }
  }

  const { fee: ongkirFee, line: ongkirLine } = resolveOngkir(reservation, customer);
  const effectiveDiscount = Number(discount) || 0;

  const totalVal = Math.max(0, (treatmentPrice || 0) + (ongkirFee || 0) - effectiveDiscount);

  // 8. Susun Template Teks Bersih
  const lines: string[] = [
    'Berikut reservasi 🐣',
    '',
    `Hari dan tanggal : ${dateTimeStr}`,
    `Nama Bunda: ${bundaName ? `${bundaName}` : '-'}`,
    `Alamat Lengkap & Patokan : ${address || '-'}`,
    `Kec : ${kec || '-'}`,
    `Kota : ${kota || '-'}`,
    `No. Hp : ${phone || '-'}`,
    '',
    categoryLabel,
    '',
  ];

  if (categoryRaw !== 'MOMS') {
    if (babyDetails.length === 0) {
      lines.push('Nama Bayi : -');
      lines.push('Usia Bayi/Anak : -');
    } else if (babyDetails.length === 1) {
      lines.push(`Nama Bayi : ${babyDetails[0].name || '-'}`);
      lines.push(`Usia Bayi/Anak : ${babyDetails[0].age || '-'}`);
    } else {
      // Multi-bayi (kembar / lebih dari 1 anak)
      babyDetails.forEach((b, idx) => {
        lines.push(`Nama Bayi ${idx + 1} : ${b.name || '-'}`);
        lines.push(`Usia Bayi/Anak ${idx + 1} : ${b.age || '-'}`);
      });
    }
  }

  const seriesBadge = (reservation as any).series_id
    ? ` [Paket Berseri Sesi ${(reservation as any).session_number || 1}/${(reservation as any).total_sessions || '?'}]`
    : '';
  lines.push(`Treatment : ${treatment}${seriesBadge}`);
  lines.push('');
  lines.push('Payment : ');
  lines.push(`Treatment = ${formatThousand(treatmentPrice)}`);
  lines.push(ongkirLine);
  if (effectiveDiscount > 0) {
    lines.push(`Promo ongkir = - ${formatThousand(effectiveDiscount)}`);
  }
  lines.push(`Total = ${formatThousand(totalVal)}`);
  lines.push('');
  lines.push('H-1 sebelum treatment akan kami reminder kembali bunda 🥰');
  lines.push('Terimakasih.  ☺️');

  return lines.join('\n');
}
export interface GenerateSeriesInvoiceParams {
  series: {
    id?: string;
    treatment_name?: string;
    treatmentName?: string;
    total_sessions?: number;
    totalSessions?: number;
    purchase_value?: number | null;
    purchaseValue?: number | null;
    delivery_fee?: number | null;
    deliveryFee?: number | null;
    discount_amount?: number | null;
    discountAmount?: number | null;
    payment_method?: string | null;
    paymentMethod?: string | null;
    reservations?: Array<{
      session_number?: number;
      sessionNumber?: number;
      booking_date?: string | Date;
      bookingDate?: string | Date;
    }>;
  };
  customer?: InvoiceCustomerData | null;
  discount?: number;
}

/**
 * Adapter helper untuk mengonversi response API / DB model ke GenerateSeriesInvoiceParams
 */
export function seriesInvoiceParamsFromApi(
  apiSeries: any,
  customer?: InvoiceCustomerData | null,
  discount?: number
): GenerateSeriesInvoiceParams {
  if (!apiSeries) {
    return {
      series: {
        treatmentName: '',
        totalSessions: 1,
      },
      customer: customer || null,
      discount: discount || 0,
    };
  }

  const rawReservations = apiSeries.reservations || apiSeries.sessions || [];
  const normalizedReservations = rawReservations.map((r: any, idx: number) => ({
    session_number: Number(r.session_number ?? r.sessionNumber ?? idx + 1),
    sessionNumber: Number(r.session_number ?? r.sessionNumber ?? idx + 1),
    booking_date: r.booking_date ?? r.bookingDate ?? r.date,
    bookingDate: r.booking_date ?? r.bookingDate ?? r.date,
  }));

  const treatmentName = apiSeries.treatment_name || apiSeries.treatmentName || '';
  const totalSessions = Number(
    apiSeries.total_sessions ?? apiSeries.totalSessions ?? normalizedReservations.length ?? 1
  );
  const purchaseValue = Number(apiSeries.purchase_value ?? apiSeries.purchaseValue ?? 0);
  const deliveryFee = Number(apiSeries.delivery_fee ?? apiSeries.deliveryFee ?? 0);
  const discountAmount = Number(discount ?? apiSeries.discount_amount ?? apiSeries.discountAmount ?? 0);

  return {
    series: {
      id: apiSeries.id,
      treatment_name: treatmentName,
      treatmentName: treatmentName,
      total_sessions: totalSessions,
      totalSessions: totalSessions,
      purchase_value: purchaseValue,
      purchaseValue: purchaseValue,
      delivery_fee: deliveryFee,
      deliveryFee: deliveryFee,
      discount_amount: discountAmount,
      discountAmount: discountAmount,
      payment_method: apiSeries.payment_method || apiSeries.paymentMethod,
      paymentMethod: apiSeries.payment_method || apiSeries.paymentMethod,
      reservations: normalizedReservations,
    },
    customer: customer || null,
    discount: discountAmount,
  };
}

/**
 * Mengenerate teks rincian booking & invoice WhatsApp untuk satu PAKET BERSERI utuh (unit komersial tunggal)
 */
export function generateSeriesInvoiceText(params: GenerateSeriesInvoiceParams): string {
  const { series, customer, discount = 0 } = params;
  const kec = customer?.kecamatan || '';
  const kota = customer?.kota || '';
  const phone = customer?.phone || '';
  const bundaName = cleanBundaName(customer?.name || '', kec, kota);
  const address = customer?.address || customer?.preferences?.address || '';
  const treatmentName = series.treatment_name || series.treatmentName || 'Treatment Paket';
  const totalSessions = Number(series.total_sessions ?? series.totalSessions ?? series.reservations?.length ?? 1);
  const packagePrice = Number(series.purchase_value ?? series.purchaseValue ?? 0);
  const perVisitOngkir = Number(series.delivery_fee ?? series.deliveryFee ?? 0);
  const totalOngkir = perVisitOngkir * totalSessions;
  const effectiveDiscount = Number(discount) || Number(series.discount_amount ?? series.discountAmount ?? 0);
  const total = Math.max(0, packagePrice + totalOngkir - effectiveDiscount);

  const lines: string[] = [
    'Berikut reservasi Paket Berseri 🐣',
    '',
    `Paket : ${treatmentName} (${totalSessions} Sesi)`,
    `Nama Bunda : ${bundaName ? bundaName : '-'}`,
    `Alamat & Shareloc : ${address || '-'}`,
    `Kec : ${kec || '-'}`,
    `Kota : ${kota || '-'}`,
    `No. Hp : ${phone || '-'}`,
    '',
  ];

  const babyDetails = (customer?.children || [])
    .map((c) => ({ name: (c.name || '').trim(), age: (c.current_age || c.raw_age_text || '').trim() }))
    .filter((b) => b.name && b.name !== '-');

  if (babyDetails.length > 0) {
    babyDetails.forEach((b, idx) => {
      const suffix = babyDetails.length > 1 ? ` ${idx + 1}` : '';
      lines.push(`Nama Bayi${suffix} : ${b.name}`);
      lines.push(`Usia Bayi/Anak${suffix} : ${b.age || '-'}`);
    });
    lines.push('');
  }

  if (series.reservations && series.reservations.length > 0) {
    lines.push('Rincian Jadwal Sesi :');
    series.reservations.forEach((r) => {
      const sessionNum = r.session_number ?? r.sessionNumber ?? 1;
      const bDate = r.booking_date ?? r.bookingDate;
      const dateFormatted = formatIndonesianDateTime(bDate ? String(bDate) : null);
      lines.push(`• Sesi ${sessionNum}: ${dateFormatted}`);
    });
    lines.push('');
  }

  lines.push('Payment :');
  lines.push(`Paket (${totalSessions} Sesi) = ${formatThousand(packagePrice)}`);
  if (perVisitOngkir > 0) {
    lines.push(`Ongkir (${totalSessions} kunjungan @ ${formatThousand(perVisitOngkir)}) = ${formatThousand(totalOngkir)}`);
  } else {
    lines.push('Ongkir = free');
  }
  if (effectiveDiscount > 0) {
    lines.push(`Diskon = - ${formatThousand(effectiveDiscount)}`);
  }
  lines.push(`Total = ${formatThousand(total)}`);
  lines.push('');
  lines.push('H-1 sebelum setiap sesi treatment akan kami reminder kembali bunda 🥰');
  lines.push('Terimakasih. ☺️');

  return lines.join('\n');
}
