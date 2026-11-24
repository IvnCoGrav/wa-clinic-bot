/**
 * Antrean OTW pending (plan 2026-11-24, Fase 3/4).
 *
 * Kenapa ada: pada mode `pending` (kirim belum terkonfirmasi dalam 10 dtk) peta
 * tetap dibuka agar Bidan tidak terlambat, TAPI pesan tidak boleh hilang. Item
 * disimpan di `sessionStorage` (bukan `localStorage`) dengan TTL 2 jam — mengikuti
 * pola `useStaffFailedOutbox` — lalu dikirim ulang saat aplikasi kembali aktif
 * (Fase 4) selama masih di dalam jendela OTW server.
 *
 * `requestId` WAJIB stabil per percobaan keberangkatan: retry & flush memakai nilai
 * yang sama supaya server bisa menjawab `alreadySent` dan tidak mengirim WA ganda.
 */
import type { OtwDestination, OtwGeoPoint } from './otwDeparture';

export const OTW_PENDING_KEY = 'staff_otw_outbox_v1';
export const OTW_PENDING_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_ITEMS = 20;

export interface PendingOtwItem {
  requestId: string;
  reservationId: string;
  customerName?: string;
  conversationId?: string | null;
  draft: string;
  depart: OtwGeoPoint | null;
  dest: OtwDestination | null;
  createdAt: string;
  attempts: number;
  lastError: string | null;
}

interface PersistedShape {
  savedAt: number;
  items: PendingOtwItem[];
}

function isItem(value: any): value is PendingOtwItem {
  return !!value && typeof value === 'object' && typeof value.requestId === 'string' && typeof value.reservationId === 'string';
}

/** Baca antrean; item kedaluwarsa / rusak dibuang diam-diam. */
export function readPendingOtw(nowMs: number = Date.now()): PendingOtwItem[] {
  try {
    const raw = sessionStorage.getItem(OTW_PENDING_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedShape;
    if (!parsed || !Array.isArray(parsed.items)) return [];
    if (typeof parsed.savedAt !== 'number' || nowMs - parsed.savedAt > OTW_PENDING_TTL_MS) {
      sessionStorage.removeItem(OTW_PENDING_KEY);
      return [];
    }
    return parsed.items.filter(isItem);
  } catch {
    return [];
  }
}

function write(list: PendingOtwItem[], nowMs: number = Date.now()): PendingOtwItem[] {
  const items = list.slice(-MAX_ITEMS);
  try {
    if (items.length === 0) sessionStorage.removeItem(OTW_PENDING_KEY);
    else sessionStorage.setItem(OTW_PENDING_KEY, JSON.stringify({ savedAt: nowMs, items }));
  } catch {
    /* storage penuh / private mode: abaikan (best-effort), jangan gagalkan alur Bidan */
  }
  return items;
}

/** Simpan/segarkan satu item (idempotent terhadap `requestId` yang sama). */
export function enqueuePendingOtw(item: PendingOtwItem, nowMs: number = Date.now()): PendingOtwItem[] {
  const list = readPendingOtw(nowMs).filter((entry) => entry.requestId !== item.requestId);
  return write([...list, item], nowMs);
}

export function removePendingOtw(requestId: string, nowMs: number = Date.now()): PendingOtwItem[] {
  const list = readPendingOtw(nowMs).filter((entry) => entry.requestId !== requestId);
  return write(list, nowMs);
}

export function markPendingOtwAttempt(
  requestId: string,
  patch: { lastError?: string | null; attempts?: number },
  nowMs: number = Date.now()
): PendingOtwItem[] {
  const list = readPendingOtw(nowMs).map((entry) =>
    entry.requestId === requestId
      ? {
          ...entry,
          attempts: patch.attempts ?? entry.attempts + 1,
          lastError: patch.lastError !== undefined ? patch.lastError : entry.lastError,
        }
      : entry
  );
  return write(list, nowMs);
}

/** Dipanggil saat logout agar sisa draf (memuat nama pasien) tidak tertinggal. */
export function clearPendingOtw(): void {
  try {
    sessionStorage.removeItem(OTW_PENDING_KEY);
  } catch {
    /* storage tidak tersedia */
  }
}
