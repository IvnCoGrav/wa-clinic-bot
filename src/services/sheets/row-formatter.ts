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
  status?: string | null;
  raw_text?: string | null;
}

export interface SheetRowCustomer {
  name?: string | null;
  kelurahan?: string | null;
  kecamatan?: string | null;
  kota?: string | null;
  ongkir?: number | null;
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

/** Lokasi: prioritaskan kelurahan, lalu kecamatan, lalu kota. */
function resolveLocation(customer?: SheetRowCustomer | null): string {
  if (!customer) return EMPTY_CELL;
  const parts = [customer.kelurahan, customer.kecamatan, customer.kota]
    .map((p) => (p || '').trim())
    .filter(Boolean);
  const uniq = parts.filter((p, i) => parts.indexOf(p) === i);
  return uniq.length > 0 ? uniq.join(' ') : EMPTY_CELL;
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
  // "Total" = subtotal layanan (purchase_value sudah murni layanan tanpa ongkir).
  const total = typeof reservation.purchase_value === 'number' ? reservation.purchase_value : 0;
  const hargaAkhir = total + ongkir - discount;

  const childLabel = child && (child.name || child.raw_age_text)
    ? [child.name, child.raw_age_text].map((s) => (s || '').trim()).filter(Boolean).join(' ')
    : '';

  const row: (string | number)[] = [
    target.isoDate,                                 // A Tanggal
    target.dayName,                                 // B Hari
    toCell(customer?.name),                         // C Customer
    resolveLocation(customer),                      // D Lokasi
    toCell(childLabel),                             // E Bayi/Layanan
    reservation.is_repeat_order ? 'Repeat' : 'Baru',// F Tipe Customer
    toCell(reservation.treatment_detail),           // G Layanan Detail
    ongkir,                                         // H Ongkir
    total,                                          // I Total
    discount,                                       // J Diskon
    hargaAkhir,                                     // K Harga akhir
    toCell(reservation.payment_method),             // L Metode Bayar
    toCell(assignedStaffName),                      // M Bidan
    0,                                              // N Tip (tidak ada sumber DB → 0)
    toCell(reservation.status === 'completed' ? 'Sudah' : 'Belum'), // O Follow up
    toCell(
      // P Catatan: preferensi catatan manual admin; fallback deskripsi reservasi.
      extractManualNote(reservation.raw_text) || reservation.raw_text
    ),
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
