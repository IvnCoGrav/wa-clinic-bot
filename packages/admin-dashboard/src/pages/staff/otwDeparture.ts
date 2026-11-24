/**
 * Kontrak keberangkatan OTW (plan 2026-11-24, Fase 2) — murni, tanpa DOM/React.
 *
 * Kenapa dipisah dari `StaffToday.tsx`: perilaku yang harus dijamin di sini adalah
 * *urutan* (kirim dulu, peta belakangan) dan *batas waktu* (10 dtk), bukan tampilan.
 * Dengan seam ini, seluruh skenario (sukses, gagal, duplikat, timeout) bisa diuji
 * tanpa merender komponen atau menebak isi file lewat pencocokan teks.
 *
 * Invarian:
 * 1. Navigasi tidak pernah menunggu lebih lama dari `OTW_SEND_DEADLINE_MS`.
 * 2. Timeout TIDAK membatalkan request (keepalive dibiarkan selesai); statusnya
 *    `pending` dan direkonsiliasi saat aplikasi kembali aktif (Fase 4/5).
 * 3. `already-sent`/`duplicate` bukan kegagalan: pasien sudah menerima pesan.
 */
import { calculateHaversineKm, estimateTravelMinutesKm, formatWibClock, getOtwGate } from '../../utils/geoUtils';

/** Batas tunggu maksimal sebelum peta dibuka dengan status pending. */
export const OTW_SEND_DEADLINE_MS = 10_000;

export interface OtwGeoPoint {
  lat: number;
  lng: number;
  accuracy?: number;
}

export interface OtwDestination {
  lat?: number | null;
  lng?: number | null;
}

/** Body yang dikirim ke `POST /api/staff/reservations/:id/otw`. */
export interface OtwRequestBody {
  requestId: string;
  customText: string;
  markEnRoute: true;
  etaMinutes?: number;
  arrivalWib?: string;
  lat?: number;
  lng?: number;
  accuracy?: number;
}

export interface OtwPayload {
  requestId: string;
  body: OtwRequestBody;
  /** ETA dari titik berangkat ke tujuan (null bila GPS/tujuan tidak lengkap). */
  etaMinutes: number | null;
  arrivalWib: string | null;
}

export interface BuildOtwPayloadInput {
  requestId: string;
  draft: string;
  depart?: OtwGeoPoint | null;
  dest?: OtwDestination | null;
  now?: Date;
}

/**
 * Susun body OTW + ETA. ETA hanya dihitung bila titik berangkat DAN tujuan lengkap;
 * tanpa itu body tetap sah (server memakai template DB-driven).
 */
export function buildOtwPayload(input: BuildOtwPayloadInput): OtwPayload {
  const { requestId, draft, depart, dest, now = new Date() } = input;

  const destLat = dest?.lat;
  const destLng = dest?.lng;
  const hasDest = destLat != null && destLng != null && Number.isFinite(destLat) && Number.isFinite(destLng);

  let etaMinutes: number | null = null;
  let arrivalWib: string | null = null;
  if (depart && hasDest) {
    const km = calculateHaversineKm(depart.lat, depart.lng, destLat as number, destLng as number);
    etaMinutes = estimateTravelMinutesKm(km);
    arrivalWib = formatWibClock(now, etaMinutes);
  }

  const body: OtwRequestBody = {
    requestId,
    customText: draft,
    markEnRoute: true,
    ...(etaMinutes != null ? { etaMinutes } : {}),
    ...(arrivalWib ? { arrivalWib } : {}),
    ...(depart ? { lat: depart.lat, lng: depart.lng, accuracy: depart.accuracy } : {}),
  };

  return { requestId, body, etaMinutes, arrivalWib };
}

export type OtwSendStatus = 'sent' | 'already-sent' | 'failed' | 'pending';

export interface OtwApiResponse {
  success?: boolean;
  data?: any;
  error?: unknown;
}

export interface SendOtwResult {
  status: OtwSendStatus;
  /** `response.data` dari server (status reservasi, alreadySent, otwSentAt). */
  data?: any;
  /** Pesan siap tampil untuk toast (hanya saat `failed`). */
  error?: string;
}

/** Ambil pesan error ramah dari bentuk error apa pun (`{code,message}` / string / Error). */
export function describeOtwError(error: unknown): string {
  if (!error) return 'kesalahan tidak diketahui';
  if (typeof error === 'string') return error;
  const maybeMessage = (error as { message?: unknown })?.message;
  if (typeof maybeMessage === 'string' && maybeMessage.trim()) return maybeMessage;
  return 'kesalahan tidak diketahui';
}

export interface SendOtwOptions {
  /** Pengirim aktual (di-inject agar teruji tanpa jaringan). */
  post: () => Promise<OtwApiResponse>;
  deadlineMs?: number;
}

/**
 * Kirim OTW dengan batas tunggu. Tidak pernah melempar.
 * - Respons sukses → `sent` / `already-sent`.
 * - Respons gagal / error jaringan → `failed` (modal tetap terbuka).
 * - Lewat batas waktu → `pending`; request DIBIARKAN (keepalive) agar tetap
 *   berpeluang sukses, lalu direkonsiliasi saat resume.
 */
export async function sendOtwWithDeadline(options: SendOtwOptions): Promise<SendOtwResult> {
  const deadlineMs = options.deadlineMs ?? OTW_SEND_DEADLINE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    // Dibungkus async IIFE: `post()` yang melempar SINKRON tetap menjadi rejection,
    // sehingga kontrak "tidak pernah melempar" berlaku untuk semua bentuk kegagalan.
    const postPromise = (async () => options.post())();
    const settled = await Promise.race([
      postPromise
        .then((res) => ({ kind: 'response' as const, res }))
        .catch((err) => ({ kind: 'error' as const, err })),
      new Promise<{ kind: 'timeout' }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'timeout' as const }), deadlineMs);
      }),
    ]);

    if (settled.kind === 'timeout') return { status: 'pending' };
    if (settled.kind === 'error') return { status: 'failed', error: describeOtwError(settled.err) };

    const res = settled.res;
    if (res?.success) {
      return {
        status: res?.data?.alreadySent ? 'already-sent' : 'sent',
        data: res.data,
      };
    }
    return { status: 'failed', error: describeOtwError(res?.error) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type OtwFlushDecision = 'flush' | 'wait' | 'drop_expired' | 'drop_closed';

/** Status reservasi yang membuat pesan "saya sedang OTW" tidak relevan lagi. */
const OTW_CLOSED_STATUSES = ['completed', 'cancelled', 'rejected', 'arrived'];

export interface ResolveFlushDecisionInput {
  bookingDate?: string | Date | null;
  status?: string | null;
  nowMs?: number;
}

/**
 * Boleh tidaknya item outbox dikirim ulang otomatis.
 * Memakai `getOtwGate` (sumber tunggal jendela waktu, identik dengan gate UI dan
 * batas server: booking − 2 jam s.d. booking + 15 menit).
 */
export function resolveFlushDecision(input: ResolveFlushDecisionInput): OtwFlushDecision {
  const status = String(input.status || '').toLowerCase();
  if (OTW_CLOSED_STATUSES.includes(status)) return 'drop_closed';

  const gate = getOtwGate(input.bookingDate, input.nowMs ?? Date.now());
  if (gate.reason === 'ok') return 'flush';
  if (gate.reason === 'too_early') return 'wait';
  // 'expired' (lewat toleransi) dan 'invalid' (tanpa waktu booking) = gagal permanen.
  return 'drop_expired';
}

/**
 * Kunci idempotensi per PERCOBAAN keberangkatan (bukan per tap): retry dan flush
 * outbox memakai nilai yang sama, sehingga server mengenali duplikat.
 */
export function createOtwRequestId(): string {
  try {
    const cryptoObj = typeof globalThis !== 'undefined' ? (globalThis as any).crypto : undefined;
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return `otw_${cryptoObj.randomUUID()}`;
  } catch {
    /* jatuh ke fallback deterministik-ish */
  }
  return `otw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
