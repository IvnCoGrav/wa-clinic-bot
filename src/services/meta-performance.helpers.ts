/**
 * Helper murni laporan Meta Ads Performance.
 *
 * Diekstrak dari `meta-performance-analytics.service.ts` (Sprint 1 / S1-3) agar
 * modul service tetap di bawah batas 1.500 baris dan helper dapat diuji tanpa
 * Prisma. Aturan modul: TIDAK BOLEH menyentuh DB, network, atau cache.
 *
 * Operasi tanggal WIB didelegasikan ke `src/utils/wib-time.ts` (kanonis) agar
 * offset UTC+7 tidak dideklarasikan ulang di sini.
 */
import { formatWibDateYYYYMMDD, wibDayRangeToUtc } from '../utils/wib-time';

export const MS_PER_DAY = 86_400_000;

/** Tanggal hari ini menurut kalender WIB (YYYY-MM-DD). */
export function wibTodayStr(): string {
  return formatWibDateYYYYMMDD();
}

/** Awal hari WIB (UTC `gte`) untuk tanggal YYYY-MM-DD yang sudah tervalidasi. */
export function wibDayStart(dateStr: string): Date {
  const range = wibDayRangeToUtc(dateStr);
  if (!range) throw new Error(`Tanggal WIB tidak valid: ${dateStr}`);
  return range.start;
}

/** Akhir hari WIB (UTC `lte`) untuk tanggal YYYY-MM-DD yang sudah tervalidasi. */
export function wibDayEnd(dateStr: string): Date {
  const range = wibDayRangeToUtc(dateStr);
  if (!range) throw new Error(`Tanggal WIB tidak valid: ${dateStr}`);
  return range.end;
}

export function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function mean(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function isSandboxed(customer: any): boolean {
  return Boolean(customer?.is_sandbox_test) || Boolean(customer?.is_internal_staff);
}

export function isQualifyingStatus(status: string | null | undefined): boolean {
  const s = (status || '').toLowerCase();
  return s !== 'cancelled' && s !== 'rejected';
}

// ── Sanitasi teknis label UTM ───────────────────────────────────────────────
// Murni pembersihan mesin (bukan pemetaan alias merek — itu wewenang DB/config
// per-tenant). Cegah makro Meta yang belum ter-render (`{{ad.id}}`) bocor mentah
// ke dashboard dan pecah menjadi banyak baris.
const UTM_MACRO_RE = /\{\{[^}]*\}\}/;

function isUnrenderedUtmMacro(raw: string | null | undefined): boolean {
  return typeof raw === 'string' && UTM_MACRO_RE.test(raw);
}

export function sanitizeUtmCampaign(raw: string | null | undefined): string {
  const t = (raw ?? '').trim();
  if (!t) return '(tanpa campaign)';
  return isUnrenderedUtmMacro(t) ? '(macro UTM belum dirender)' : t;
}

export function sanitizeUtmSource(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim();
  if (!t || isUnrenderedUtmMacro(t)) return null;
  return t;
}

// ── Kohort retensi & kapasitas ──────────────────────────────────────────────

/** Kunci tanggal kalender WIB (YYYY-MM-DD) untuk Date apa pun. */
export function wibDateKey(date: Date): string {
  return formatWibDateYYYYMMDD(date);
}

/**
 * Pita utilisasi terapis. Ambang 65/85 adalah konvensi kapasitas industri
 * (headroom aman untuk scale iklan) — BUKAN data bisnis hardcode yang
 * disembunyikan; ditandai provisional untuk kalibrasi ADR.
 */
export function capacityBandFor(utilizationPct: number | null): 'AMAN' | 'OPTIMAL' | 'PENUH' | 'UNKNOWN' {
  if (utilizationPct === null || !Number.isFinite(utilizationPct)) return 'UNKNOWN';
  if (utilizationPct < 65) return 'AMAN';
  if (utilizationPct <= 85) return 'OPTIMAL';
  return 'PENUH';
}

export const JOURNEY_BRACKETS: Array<{ key: string; label: string; test: (d: number) => boolean }> = [
  { key: 'lt1', label: '< 24 Jam', test: (d) => d < 1 },
  { key: 'd1_3', label: '1 - 3 Hari', test: (d) => d >= 1 && d < 3 },
  { key: 'd3_7', label: '3 - 7 Hari', test: (d) => d >= 3 && d < 7 },
  { key: 'd7_14', label: '7 - 14 Hari', test: (d) => d >= 7 && d < 14 },
  { key: 'gt14', label: '> 14 Hari', test: (d) => d >= 14 },
];

export const LEADTIME_BRACKETS: Array<{ key: string; label: string; test: (d: number) => boolean }> = [
  { key: 'same_day', label: 'Same-Day (H-0)', test: (d) => d <= 0 },
  { key: 'h1', label: 'H-1 (Besok)', test: (d) => d === 1 },
  { key: 'h2_3', label: 'H-2 s/d H-3', test: (d) => d >= 2 && d <= 3 },
  { key: 'h4_7', label: 'H-4 s/d H-7', test: (d) => d >= 4 && d <= 7 },
  { key: 'gt7', label: '> H-7', test: (d) => d > 7 },
];

export const NO_DATE_KEY = { key: 'no_date', label: 'Tanpa Tanggal' };

export function wibMonthKey(d: Date): string {
  return formatWibDateYYYYMMDD(d).slice(0, 7);
}

export function monthDiff(fromMonth: string, toMonth: string): number {
  const [y1, m1] = fromMonth.split('-').map(Number);
  const [y2, m2] = toMonth.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

export function addMonths(monthStr: string, n: number): string {
  const [y, m] = monthStr.split('-').map(Number);
  const totalMonths = y * 12 + (m - 1) + n;
  const newY = Math.floor(totalMonths / 12);
  const newM = (totalMonths % 12) + 1;
  return `${newY}-${String(newM).padStart(2, '0')}`;
}
