import { wibDayBoundsUtc, startOfTodayWib } from '../../../utils/wib-time';
import { maskPhoneNumber } from '../../../utils/pii-masker';
import { ACTIVE_RESERVATION_STATUSES } from '../../../domain/reservation-status';

export interface CopilotToolResult {
  tool: string;
  args: Record<string, any>;
  rows: any[];
  count: number;
  note?: string;
}

export interface CopilotTool {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
  run: (tenantId: string, args: Record<string, any>) => Promise<CopilotToolResult>;
}

export const MAX_ROWS = 20;
/**
 * Batas ambil data MENTAH untuk perhitungan deterministik (slot kosong, bentrok,
 * tagihan). Berbeda dari `MAX_ROWS` yang hanya membatasi baris yang dikirim ke LLM.
 */
export const MAX_FETCH_ROWS = 200;

export { ACTIVE_RESERVATION_STATUSES };

/**
 * Seluruh status reservasi yang dikenali kontrak tool. Menu status DILARANG
 * menyempit: bila `rejected`/`en_route` absen dari deskripsi, router LLM tidak
 * pernah bisa memilihnya walau data & filter DB mampu (akar "siapa yang saya tolak"
 * selalu kosong). Ini kontrak domain, bukan katalog bisnis.
 */
export const RESERVATION_STATUS_VALUES = [
  'confirmed',
  'en_route',
  'pending',
  'hold',
  'completed',
  'cancelled',
  'rejected',
] as const;

/** Validasi string tanggal "YYYY-MM-DD" (bukan kalimat bebas dari LLM). */
export function isValidIsoDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return false;
  const d = new Date(`${value.trim()}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

/**
 * Resolusi filter `booking_date` untuk query reservasi (murni, mudah diuji).
 * - tanggal valid → rentang hari WIB tsb
 * - tanpa tanggal / tanggal tidak valid → hanya jadwal aktif mendatang (anti past-trap)
 */
export function resolveReservationDateFilter(
  date: unknown,
  now: Date = new Date()
): { gte: Date; lte?: Date } {
  if (isValidIsoDate(date)) {
    const { start, end } = wibDayBoundsUtc(0, new Date(`${String(date).trim()}T12:00:00Z`));
    return { gte: start, lte: end };
  }
  return { gte: startOfTodayWib(now) };
}

/**
 * Format nama display pelanggan dengan privasi & higienitas (anti-kebocoran username teknis).
 * - Bila nama kosong atau hanya honorifik ("Bunda"), sematkan nomor HP tersamar bila ada.
 * - Bila nama berupa username teknis (mengandung angka atau underscore, mis. "aguspurnomo68301"),
 *   ganti dengan "Bunda (<masked_phone>)".
 * - Nama manusia asli (mis. "Chaterina", "Cindy Amalia", "Bunda Megga") DIPERTAHANKAN apa adanya.
 * Mengembalikan displayName untuk LLM dan rawName untuk grounding link token.
 */
export function formatCustomerDisplayName(
  name: string | null | undefined,
  phone: string | null | undefined
): { displayName: string; rawName: string } {
  const raw = (name || '').trim();
  const phoneSuffix = phone ? maskPhoneNumber(phone) : '';
  const cleanHonorific = raw.replace(/\b(bunda|ibu|mbak|bu|kak|ny|tante)\b/gi, ' ').trim();

  // 1. Tanpa nama atau hanya honorifik saja (mis. "Bunda", "Ibu")
  if (!raw || !cleanHonorific) {
    const disp = phoneSuffix ? `Bunda (${phoneSuffix})` : (raw || 'Bunda');
    return { displayName: disp, rawName: raw || 'Bunda' };
  }

  // 2. Username teknis sistem / nomor akun (mengandung digit atau underscore, mis. "aguspurnomo68301", "cust_01")
  // Wajib ada digit ATAU underscore, dan tanpa spasi (nama manusia punya spasi atau hanya huruf)
  const isSystemUsername =
    !/\s/.test(raw) &&
    ((/^(?=.*\d)[a-z0-9_]{6,}$/i.test(raw)) || /^[a-z0-9_]*_[a-z0-9_]*$/i.test(raw));

  if (isSystemUsername) {
    const disp = phoneSuffix ? `Bunda (${phoneSuffix})` : raw;
    return { displayName: disp, rawName: raw };
  }

  // 3. Nama normal manusia (mis. "Chaterina", "Cindy Amalia", "Bunda Megga")
  return { displayName: raw, rawName: raw };
}

/**
 * Pola spam telekomunikasi & broadcast komersial operator.
 * Memadukan kata kunci operator/telekomunikasi dengan produk (kuota/roaming/pulsa/dll)
 * agar TIDAK salah mendeteksi istilah klinik (mis. "paket persalinan", "voucher USG").
 */
export function isTelecomSpamLine(line: string): boolean {
  const lower = (line || '').toLowerCase().trim();
  if (!lower) return false;

  // 1. Operator brand jelas
  const hasOperatorBrand = /\b(im3|indosat|telkomsel|xl\s*axiata|smartfren|tri\s*indonesia|myim3|mytelkomsel)\b/i.test(lower);
  // 2. Layanan telekomunikasi spesifik
  const hasTelecomService = /\b(simpelroam|roaming|kuota\s*(data|internet|hingga)|isi\s*pulsa|paket\s*(data|roaming|nelpon|unlimited)|cashback\s*pulsa|top\s*up\s*pulsa)\b/i.test(lower);

  if (hasOperatorBrand && hasTelecomService) return true;
  if (hasTelecomService && /\b(gb|gigabyte|mbps|roaming|simpelroam)\b/i.test(lower)) return true;
  if (/\b(simpelroam|myim3|mytelkomsel)\b/i.test(lower)) return true;

  return false;
}

/**
 * Bersihkan baris spam komersial dari teks pesan.
 * Jika seluruh teks adalah spam, kembalikan string kosong.
 */
export function stripCommercialSpam(text: string): string {
  if (!text || typeof text !== 'string') return '';
  const lines = text.split('\n');
  const validLines = lines.filter((l) => !isTelecomSpamLine(l));
  return validLines.join('\n').trim();
}
