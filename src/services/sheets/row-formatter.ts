import { resolveSheetTarget, DEFAULT_MONTH_TAB_NAMES } from './month-resolver';

/**
 * row-formatter.ts — konversi entitas reservasi → TEPAT 16 elemen array sesuai
 * kolom A–P rekapan operasional klinik. Modul MURNI (tanpa I/O) agar deterministik
 * dan dapat diuji offline. Semua keputusan berbasis STATE/KONTRAK DATA, bukan
 * pencocokan kalimat.
 *
 * Pemetaan kolom:
 *   A Tanggal | B Hari | C Customer | D Lokasi | E Bayi/Layanan | F Tipe Customer
 *   G Layanan Detail | H Ongkir | I Total | J Diskon | K Harga akhir | L Metode Bayar
 *   M Bidan | N Tip | O Follow up | P Catatan
 */

/** Placeholder seragam agar kolom tidak pernah bergeser (16 sel selalu terisi). */
export const EMPTY_CELL = '-';

export const SHEET_COLUMN_COUNT = 16;

export interface SheetRowReservation {
  booking_date: Date | null;
  treatment_detail?: string | null;
  treatment_category?: string | null;
  purchase_value?: number | null;
  delivery_fee?: number | null;
  discount_amount?: number | null;
  payment_method?: string | null;
  is_repeat_order?: boolean | null;
  /** Ordinal riwayat transaksi nyata (jumlah reservasi qualifying lebih awal).
   *  Bila angka → otoritas new-vs-repeat; flag `is_repeat_order` DB diabaikan
   *  karena bisa terkontaminasi (bug follow-up lama). */
  prior_reservations_count?: number | null;
  status?: string | null;
  raw_text?: string | null;
}

export interface SheetRowCustomer {
  name?: string | null;
  kelurahan?: string | null;
  kecamatan?: string | null;
  kota?: string | null;
  ongkir?: number | null;
  hasAds?: boolean | null;
  adClick?: { id?: string; fbclid?: string | null; utmSource?: string | null; ctwa_clid?: string | null } | null;
}

export interface SheetRowChild {
  name?: string | null;
  raw_age_text?: string | null;
  age_months_at_registration?: number | null;
}

export interface SheetRowInput {
  reservation: SheetRowReservation;
  customer?: SheetRowCustomer | null;
  child?: SheetRowChild | null;
  assignedStaffName?: string | null;
  /** Nama 12 tab bulan dari DB (TenantSheetsConfig.month_tab_names). */
  monthTabNames?: readonly string[] | null;
}

const KNOWN_TAGS = [
  /\[HOLD\]/gi,
  /\[SAME_DAY_REQUEST\]/gi,
  /\[OUTSIDE_HOURS\]/gi,
  /\[V3_NATIVE_AGENT_TOOL\]/gi,
  /\[RESERVATION:[^\]]*\]/gi,
];

/** Rapikan teks bebas: buang tag internal, pipa pemisah, dan spasi berlebih. */
function cleanFreeText(value: string | null | undefined): string {
  if (value == null) return '';
  let s = String(value);
  for (const re of KNOWN_TAGS) s = s.replace(re, ' ');
  s = s.replace(/\[\s*Total[^\]]*\]/gi, ' ');
  s = s.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

function toCell(value: string | null | undefined): string {
  const s = cleanFreeText(value);
  return s.length > 0 ? s : EMPTY_CELL;
}

/** Lokasi: kelurahan saja; fallback ke kecamatan/kota bila kelurahan kosong. */
function resolveLocation(customer?: SheetRowCustomer | null): string {
  if (!customer) return EMPTY_CELL;
  const kel = (customer.kelurahan || '').trim();
  if (kel) return kel;
  const kec = (customer.kecamatan || '').trim();
  if (kec) return kec;
  const kota = (customer.kota || '').trim();
  if (kota) return kota;
  return EMPTY_CELL;
}

/** Nama Bidan: cukup nama saja, tanpa prefix "Bidan". */
function sanitizeStaffName(staffName: string | null | undefined): string {
  if (!staffName) return EMPTY_CELL;
  const cleaned = staffName.replace(/^bidan\s+/i, '').trim();
  return toCell(cleaned);
}

/**
 * Tipe customer:
 * - 'Repeat' bila repeat order
 * - 'New Ads' bila pelanggan baru dan traffic datang dari iklan (adClick / hasAds)
 * - 'New' bila pelanggan baru organik/langsung
 *
 * Otoritas new-vs-repeat = ORDINAL riwayat transaksi nyata (`priorCount`), bukan
 * flag `is_repeat_order` DB yang pernah terkontaminasi bug follow-up lama. Bila
 * `priorCount` tersedia (angka), `priorCount > 0` MUTLAK menentukan; flag DB hanya
 * dipakai sebagai fallback bila ordinal tidak dihitung (mis. store non-Prisma/uji).
 */
export function resolveCustomerType(
  isRepeatOrder: boolean | null | undefined,
  customer?: SheetRowCustomer | null,
  priorCount?: number | null
): 'Repeat' | 'New Ads' | 'New' {
  const isRepeat = typeof priorCount === 'number'
    ? priorCount > 0
    : Boolean(isRepeatOrder);
  if (isRepeat) return 'Repeat';
  const hasAds = Boolean(
    customer?.hasAds ||
    customer?.adClick != null
  );
  return hasAds ? 'New Ads' : 'New';
}

/** Ongkir: snapshot reservasi menang, fallback ke Customer.ongkir (pola KB-6). */
function resolveOngkir(
  reservation: SheetRowReservation,
  customer?: SheetRowCustomer | null
): number {
  if (typeof reservation.delivery_fee === 'number') return reservation.delivery_fee;
  if (customer && typeof customer.ongkir === 'number') return customer.ongkir;
  return 0;
}

function resolveDiscount(reservation: SheetRowReservation): number {
  return typeof reservation.discount_amount === 'number' ? reservation.discount_amount : 0;
}

/**
 * Bangun baris 16 kolom. WAJIB mengembalikan array panjang tepat 16.
 * @throws INVALID_BOOKING_DATE bila `booking_date` kosong/rusak.
 */
export function formatReservationToRow(input: SheetRowInput): (string | number)[] {
  const { reservation, customer, child, assignedStaffName } = input;

  const target = resolveSheetTarget(
    reservation.booking_date,
    input.monthTabNames ?? DEFAULT_MONTH_TAB_NAMES
  );

  const ongkir = resolveOngkir(reservation, customer);
  const discount = resolveDiscount(reservation);
  // Di spreadsheet klinik: "Total" = Layanan + Ongkir (sebelum diskon).
  const hargaLayanan = typeof reservation.purchase_value === 'number' ? reservation.purchase_value : 0;
  const total = hargaLayanan + ongkir;
  // "Harga akhir" = Total - Diskon (bersih yang ditagihkan/dibayar).
  const hargaAkhir = total - discount;

  // Bayi: hanya nama bayi saja, tanpa usia
  const childName = child && child.name ? child.name.trim() : '';

  const row: (string | number)[] = [
    target.isoDate,                                             // A Tanggal
    target.dayName,                                             // B Hari
    toCell(customer?.name),                                     // C Customer
    resolveLocation(customer),                                  // D Lokasi (kelurahan saja)
    toCell(childName),                                          // E Bayi/Layanan (nama saja)
    resolveCustomerType(reservation.is_repeat_order, customer, reservation.prior_reservations_count), // F Tipe Customer (Repeat / New Ads / New)
    toCell(reservation.treatment_detail),                       // G Layanan Detail
    ongkir,                                                     // H Ongkir
    total,                                                      // I Total
    discount,                                                   // J Diskon
    hargaAkhir,                                                 // K Harga akhir
    toCell(reservation.payment_method),                         // L Metode Bayar
    sanitizeStaffName(assignedStaffName),                       // M Bidan (nama saja tanpa kata "Bidan")
    '',                                                         // N Tip (kosong / null)
    toCell(reservation.status === 'completed' ? 'Sudah' : 'Belum'), // O Follow up
    '',                                                         // P Catatan (tidak perlu diisi)
  ];

  if (row.length !== SHEET_COLUMN_COUNT) {
    throw new Error(`SHEET_ROW_LENGTH_MISMATCH:${row.length}`);
  }
  return row;
}

/** Ambil blok "Catatan: ..." dari raw_text (pola `extractNotesFromRawText`). */
function extractManualNote(rawText: string | null | undefined): string {
  if (!rawText) return '';
  const m = String(rawText).match(/(?:^|\n)Catatan:\s*([\s\S]*)$/i);
  return m && m[1].trim() ? m[1].trim() : '';
}
