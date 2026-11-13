/**
 * ING-10 — Seam bersama pipeline ingress WAHA & WABA.
 *
 * Sebelumnya kedua route webhook menduplikasi:
 *  1. guard pesan basi (stale/catch-up) beserta bypass GPS/form/reservasi,
 *  2. penentuan bypass admin/Skip,
 *  3. pre-logging inbound yang tidak dibalas (stale, blocked, human-handling).
 *
 * Modul ini adalah sumber tunggal untuk keputusan tersebut agar aturan tidak
 * menyimpang antar provider. Fungsi klasifikasi bersifat MURNI (tanpa I/O)
 * sehingga dapat diuji adversarial tanpa DB/Redis; helper I/O hanya membungkus
 * service yang sudah ada.
 */
import { customerService } from '../customer.service';
import { conversationService } from '../conversation.service';
import { messageService } from '../message.service';
import { hasBypassLabel, checkCustomerBypass } from '../../utils/customer-bypass';

/** Batas umur default pesan masuk (detik) — dipakai bila env tidak diisi. */
export const DEFAULT_MAX_INBOUND_AGE_SECONDS = 300;

/** Ambang batas timestamp milidetik (epoch ms > 1e10; epoch detik jauh di bawahnya). */
const MILLISECOND_THRESHOLD = 10_000_000_000;

export type StaleInboundReason =
  | 'fresh'
  | 'gps_share'
  | 'reservation_form'
  | 'image'
  | 'stale';

export interface StaleInboundDecision {
  /** true bila pesan melewati ambang umur. */
  stale: boolean;
  /** `proceed` = lanjut pipeline; `log_only` = catat ke DB lalu drop. */
  action: 'proceed' | 'log_only';
  reason: StaleInboundReason;
  /** Umur pesan (detik); null bila timestamp tidak valid. */
  ageSeconds: number | null;
}

export interface StaleInboundInput {
  /** Timestamp provider: epoch detik atau milidetik (string/number). */
  timestamp?: string | number | null;
  /** Ambang batas; <= 0 berarti guard dimatikan. Default dari env. */
  maxAgeSeconds?: number;
  /** Sinyal GPS/shareloc — jangan dibuang meski basi. */
  isGpsShare?: boolean;
  /** Formulir reservasi terdeteksi — jangan dibuang meski basi. */
  isReservationForm?: boolean;
  /** Pesan gambar — tetap disimpan ke Live Chat. */
  isImage?: boolean;
  /** Waktu acuan (ms) — diinjeksi pada test. */
  nowMs?: number;
}

/** Baca ambang umur dari env (data teknis, bukan data bisnis). */
export function resolveMaxInboundAgeSeconds(
  raw: string | number | undefined = process.env.MAX_INBOUND_MESSAGE_AGE_SECONDS
): number {
  // Kosong/tidak diisi → batas default; terisi tapi bukan angka → guard mati (0),
  // mempertahankan perilaku `parseInt(...)` lama di kedua route.
  if (raw === undefined || raw === null || raw === '') return DEFAULT_MAX_INBOUND_AGE_SECONDS;
  const parsed = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Umur pesan dalam detik. Timestamp detik (10 digit) dan milidetik (13 digit)
 * sama-sama diterima; nilai tidak valid/0 → null (dianggap bukan pesan basi).
 */
export function computeInboundAgeSeconds(
  timestamp: string | number | null | undefined,
  nowMs: number = Date.now()
): number | null {
  if (timestamp === null || timestamp === undefined || timestamp === '') return null;
  const rawTs = Number(timestamp);
  if (!Number.isFinite(rawTs) || rawTs <= 0) return null;
  const msgTimeMs = rawTs > MILLISECOND_THRESHOLD ? rawTs : rawTs * 1000;
  return Math.floor((nowMs - msgTimeMs) / 1000);
}

/**
 * Klasifikasi deterministik pesan basi.
 *
 * Urutan prioritas WAJIB dipertahankan (paritas perilaku lama):
 *  1. GPS/shareloc  → lanjut (ingest GPS tidak boleh hilang),
 *  2. form reservasi → lanjut (capture tidak boleh hilang),
 *  3. gambar         → log-only (media tetap tersimpan),
 *  4. selain itu     → log-only.
 */
export function classifyStaleInbound(input: StaleInboundInput): StaleInboundDecision {
  const maxAgeSeconds = input.maxAgeSeconds ?? resolveMaxInboundAgeSeconds();
  const ageSeconds = computeInboundAgeSeconds(input.timestamp, input.nowMs);
  const notStale = !(maxAgeSeconds > 0) || ageSeconds === null || ageSeconds <= maxAgeSeconds;

  if (notStale) {
    return { stale: false, action: 'proceed', reason: 'fresh', ageSeconds };
  }
  if (input.isGpsShare) {
    return { stale: true, action: 'proceed', reason: 'gps_share', ageSeconds };
  }
  if (input.isReservationForm) {
    return { stale: true, action: 'proceed', reason: 'reservation_form', ageSeconds };
  }
  if (input.isImage) {
    return { stale: true, action: 'log_only', reason: 'image', ageSeconds };
  }
  return { stale: true, action: 'log_only', reason: 'stale', ageSeconds };
}

/** Cek bypass murni dari objek customer (flag kolom atau relasi label). */
export function hasInboundBypassFlag(customer: unknown): boolean {
  if (!customer) return false;
  return (customer as any).is_admin_labeled === true || hasBypassLabel(customer);
}

/**
 * Bypass admin/Skip: flag in-memory dulu, lalu pengecekan DB/phone.
 * Sumber tunggal untuk WAHA & WABA (sebelumnya dua salinan berbeda).
 */
export async function resolveInboundBypass(params: {
  customer?: any;
  phone: string;
  tenantId: string;
}): Promise<boolean> {
  const { customer, phone, tenantId } = params;
  if (hasInboundBypassFlag(customer)) return true;
  return checkCustomerBypass({ customerId: customer?.id, phone, tenantId });
}

export interface LogInboundWithoutReplyInput {
  tenantId: string;
  phone: string;
  contactName?: string | null;
  content: string;
  waMessageId?: string | null;
  payloadRaw?: unknown;
  /** true = pesan historis (catch-up), tidak memicu evaluasi MQL. */
  isHistorical?: boolean;
  /** true = lewati evaluasi MQL (pesan bypass/admin). */
  skipMqlEvaluation?: boolean;
  /** Objek yang sudah dimuat route — mencegah lookup ganda. */
  customer?: any;
  conversation?: any;
}

/**
 * Pre-logging inbound yang TIDAK dibalas bot (stale, blocked, human-handling,
 * bypass). Memastikan audit trail & Live Chat tetap menerima pesan pada semua
 * jalur return dini — perilaku yang sebelumnya ditulis ulang di dua route.
 */
export async function logInboundWithoutReply(
  input: LogInboundWithoutReplyInput
): Promise<{ customerId: string; conversationId: string }> {
  const customer =
    input.customer ??
    (await customerService.getOrCreateCustomer(input.phone, input.contactName ?? undefined, input.tenantId));
  const conversation =
    input.conversation ?? (await conversationService.getOrCreateConversation(customer.id, input.tenantId));

  await messageService.logMessage({
    tenantId: input.tenantId,
    conversationId: conversation.id,
    direction: 'INBOUND',
    content: input.content,
    ...(input.waMessageId ? { waMessageId: input.waMessageId } : {}),
    ...(input.payloadRaw !== undefined ? { payloadRaw: input.payloadRaw } : {}),
    ...(input.isHistorical ? { isHistorical: true } : {}),
    ...(input.skipMqlEvaluation ? { skipMqlEvaluation: true } : {}),
  });

  return { customerId: customer.id, conversationId: conversation.id };
}
