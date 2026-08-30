import { Reservation } from '../types';
import { extractBabiesFromRawText } from './reservationBabies';
import { stripBufferMetadata } from './treatmentStringParser';

const INDONESIAN_DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const INDONESIAN_MONTHS = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
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
  };
  customer?: InvoiceCustomerData | null;
  discount?: number;
}

function formatThousand(num: number | null | undefined): string {
  if (num === null || num === undefined || isNaN(num)) return '0';
  return new Intl.NumberFormat('id-ID').format(Math.round(num));
}

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
 * Format tanggal dan jam Indonesia dari ISO string / Date
 * Contoh output: "Kamis 27 Agustus 2026 jam 12.00-12.30" atau "Rabu 26 Agustus 2026 jam 09.00 WIB"
 */
function formatIndonesianDateTime(dateStr?: string | null, rawText?: string): string {
  if (!dateStr) {
    // Fallback: Coba cari waktu dari rawText jika ada
    if (rawText) {
      const match = rawText.match(/(?:tanggal|hari|jadwal|waktu)\s*[:=]\s*([^\n]+)/i);
      if (match && match[1]) return match[1].trim();
    }
    return '-';
  }

  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';

  const dayName = INDONESIAN_DAYS[d.getDay()];
  const dateNum = d.getDate();
  const monthName = INDONESIAN_MONTHS[d.getMonth()];
  const year = d.getFullYear();

  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');

  // Cek apakah ada range jam di rawText (misal 12.00-12.30)
  let timeStr = `${hours}.${minutes}`;
  if (rawText) {
    const rangeMatch = rawText.match(/(\d{1,2}[.:]\d{2}\s*[-–]\s*\d{1,2}[.:]\d{2})/);
    if (rangeMatch) {
      timeStr = rangeMatch[1].replace(':', '.');
    }
  }

  return `${dayName} ${dateNum} ${monthName} ${year} jam ${timeStr}`;
}

/**
 * Mengenerate teks rincian booking & invoice pembayaran WhatsApp secara presisi
 */
export function generateReservationInvoiceText(params: GenerateInvoiceParams): string {
  const { reservation, customer, discount = 0 } = params;

  // 1. Hari dan Tanggal
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

  // 3. Alamat & Shareloc
  let address =
    customer?.address ||
    customer?.preferences?.address_detail ||
    customer?.kelurahan ||
    (reservation.customer as any)?.kelurahan ||
    '';
  if (!address && reservation.raw_text) {
    const match = reservation.raw_text.match(/(?:alamat(?:\s*dan\s*shareloc|\s*lengkap)?)\s*[:=]\s*([^\n]+)/i);
    if (match) address = match[1].trim();
  }

  // 4. Pilihan Treatment Category
  const categoryRaw = (reservation.treatment_category || '').toUpperCase();
  let categoryLabel = 'Pilihan treatment (Baby & Kids)';
  if (categoryRaw === 'MOMS' || categoryRaw.includes('MOM') || categoryRaw.includes('HAMIL')) {
    categoryLabel = 'Pilihan treatment (Moms & Hamil)';
  } else if (categoryRaw === 'BOTH' || categoryRaw.includes('BUNDLE')) {
    categoryLabel = 'Pilihan treatment (Baby & Moms Bundle)';
  }

  // 5. Data Bayi / Anak
  let babyName = '';
  let babyAge = '';

  // Coba dari relasi children
  if (customer?.children && customer.children.length > 0) {
    const c0 = customer.children[0];
    babyName = c0.name || '';
    babyAge = c0.current_age || c0.raw_age_text || '';
  }

  // Coba dari extractBabiesFromRawText
  if (!babyName || !babyAge) {
    const extracted = extractBabiesFromRawText(reservation.raw_text, reservation.treatment_detail);
    if (extracted.length > 0) {
      if (!babyName) babyName = extracted[0].name || '';
      if (!babyAge) babyAge = extracted[0].age || '';
    }
  }

  // 6. Treatment Detail
  const rawTreatment = reservation.treatment_detail || 'Layanan Homecare';
  const treatment = stripBufferMetadata(rawTreatment) || 'Layanan Homecare';

  // 7. Payment Breakdown
  // Treatment price
  let treatmentPrice = reservation.purchase_value || 0;
  if (!treatmentPrice && reservation.raw_text) {
    const match = reservation.raw_text.match(/(?:treatment|harga|biaya)\s*[:=]\s*(?:rp\.?\s*)?([\d.,]+)/i);
    if (match) {
      treatmentPrice = parseInt(match[1].replace(/[.,]/g, ''), 10) || 0;
    }
  }

  // Distance & Ongkir
  const distanceKm = customer?.distance_km ?? (reservation.customer as any)?.distance_km ?? null;
  const ongkirVal = customer?.ongkir ?? (reservation.customer as any)?.ongkir ?? 0;

  let ongkirLine = 'Ongkir = free';
  if (distanceKm !== null && distanceKm !== undefined) {
    const distStr = distanceKm.toFixed(1).replace('.', ',');
    if (ongkirVal <= 0 || distanceKm <= 3.0) {
      ongkirLine = `Ongkir ${distStr} km = free`;
    } else {
      ongkirLine = `Ongkir ${distStr} km = ${formatThousand(ongkirVal)}`;
    }
  } else if (ongkirVal > 0) {
    ongkirLine = `Ongkir = ${formatThousand(ongkirVal)}`;
  }

  const effectiveOngkir = (distanceKm !== null && distanceKm <= 3.0) ? 0 : ongkirVal;
  const effectiveDiscount = Number(discount) || 0;
  const totalVal = Math.max(0, (treatmentPrice || 0) + (effectiveOngkir || 0) - effectiveDiscount);

  // 8. Susun Template Teks Bersih
  const lines: string[] = [
    'Berikut reservasi 🐣',
    '',
    `Hari dan tanggal : ${dateTimeStr}`,
    `Nama Bunda: ${bundaName ? `${bundaName}` : '-'}`,
    `Alamat & Shareloc : ${address || '-'}`,
    `Kec : ${kec || '-'}`,
    `Kota : ${kota || '-'}`,
    `No. Hp : ${phone || '-'}`,
    '',
    categoryLabel,
    '',
  ];

  if (categoryRaw !== 'MOMS') {
    lines.push(`Nama Bayi : ${babyName || '-'}`);
    lines.push(`Usia Bayi/Anak : ${babyAge || '-'}`);
  }

  lines.push(`Treatment : ${treatment}`);
  lines.push('');
  lines.push('Payment : ');
  lines.push(`Treatment = ${formatThousand(treatmentPrice)}`);
  lines.push(ongkirLine);
  if (effectiveDiscount > 0) {
    lines.push(`Promo ongkir = - ${formatThousand(effectiveDiscount)}`);
  }
  lines.push(`Total = ${formatThousand(totalVal || treatmentPrice)}`);
  lines.push('');
  lines.push('H-1 sebelum treatment akan kami reminder kembali bunda 🥰');
  lines.push('Terimakasih.  ☺️');

  return lines.join('\n');
}
