/**
 * visit-evidence.ts — kontrak deterministik bukti kedatangan.
 *
 * Fungsi murni: hanya membaca waktu & pesan yang diberikan, tanpa I/O.
 * Tidak pernah menghasilkan perubahan pada `reservations.arrived_at`.
 */

export type EvidenceSource = 'TAP' | 'GEOFENCE' | 'PHOTO' | 'CHAT' | 'OTW' | 'ESTIMATE';
export type EvidenceReviewStatus = 'AUTO' | 'NEEDS_REVIEW';

const DEFAULT_DURATION_MINUTES = 60;
export const DEFAULT_WINDOW_BUFFER_MINUTES = 30;

export interface ReservationTiming {
  bookingDate: Date | null;
  durationMinutes: number | null;
  arrivedAt: Date | null;
  otwSentAt: Date | null;
}

export interface InboundMessage {
  id: string;
  createdAt: Date;
}

export interface PhotoCapture {
  capturedAt: Date;
}

export interface EvidenceDraft {
  source: EvidenceSource;
  evidenceAt: Date;
  observedMinutes: number;
  confidence: number | null;
  messageId: string | null;
  reviewStatus: EvidenceReviewStatus;
}

export interface BuildVisitEvidenceInput {
  timing: ReservationTiming;
  messages: InboundMessage[];
  photo?: PhotoCapture | null;
  /** Batas atas jendela setelah durasi layanan. Default 30 menit. */
  bufferMinutes?: number;
  /** Ambang pesan customer dianggap menunggu. Default 30 menit. */
  chatThresholdMinutes?: number;
}

export interface EvidenceWindow {
  start: Date;
  end: Date;
}

export interface ChatCandidate {
  messageId: string;
  at: Date;
  observedMinutes: number;
}

export type VisitEvidenceStatus = 'MEASURED' | 'CHAT_CANDIDATE' | 'UNKNOWN';

export interface BuildVisitEvidenceResult {
  status: VisitEvidenceStatus;
  window: EvidenceWindow | null;
  drafts: EvidenceDraft[];
  chatCandidate: ChatCandidate | null;
}

function isValidDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function minutesBetween(at: Date, from: Date): number {
  return Math.round((at.getTime() - from.getTime()) / 60000);
}

function positiveMinutes(value: number | null | undefined, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

/**
 * Jendela bukti: dari jam jadwal sampai `min(jam tiba, jadwal + durasi + buffer)`.
 * Bila tiba lebih awal dari jadwal, jendela menjadi kosong (tidak ada customer menunggu).
 */
export function resolveEvidenceWindow(
  timing: ReservationTiming,
  bufferMinutes: number = DEFAULT_WINDOW_BUFFER_MINUTES
): EvidenceWindow | null {
  if (!isValidDate(timing.bookingDate)) return null;

  const booking = timing.bookingDate;
  const duration = positiveMinutes(timing.durationMinutes, DEFAULT_DURATION_MINUTES);
  const buffer = positiveMinutes(bufferMinutes, DEFAULT_WINDOW_BUFFER_MINUTES);
  const cap = new Date(booking.getTime() + (duration + buffer) * 60000);

  let end = cap;
  if (isValidDate(timing.arrivedAt) && timing.arrivedAt.getTime() < cap.getTime()) {
    end = timing.arrivedAt;
  }
  if (end.getTime() < booking.getTime()) end = booking;

  return { start: booking, end };
}

/**
 * Menyusun bukti untuk satu kunjungan.
 *
 * - TAP: `arrived_at` (terukur).
 * - OTW: `otw_sent_at` (batas bawah; jarang memicu telat).
 * - PHOTO: waktu foto rumah (batas atas kehadiran).
 * - CHAT: pesan customer terakhir di jendela yang lewat ambang (kandidat, wajib review).
 */
export function buildVisitEvidence(input: BuildVisitEvidenceInput): BuildVisitEvidenceResult {
  const window = resolveEvidenceWindow(input.timing, input.bufferMinutes);
  if (!window) {
    return { status: 'UNKNOWN', window: null, drafts: [], chatCandidate: null };
  }

  const booking = window.start;
  const drafts: EvidenceDraft[] = [];

  if (isValidDate(input.timing.arrivedAt)) {
    drafts.push({
      source: 'TAP',
      evidenceAt: input.timing.arrivedAt,
      observedMinutes: minutesBetween(input.timing.arrivedAt, booking),
      confidence: null,
      messageId: null,
      reviewStatus: 'AUTO',
    });
  }

  if (isValidDate(input.timing.otwSentAt)) {
    drafts.push({
      source: 'OTW',
      evidenceAt: input.timing.otwSentAt,
      observedMinutes: minutesBetween(input.timing.otwSentAt, booking),
      confidence: null,
      messageId: null,
      reviewStatus: 'AUTO',
    });
  }

  if (input.photo && isValidDate(input.photo.capturedAt)) {
    drafts.push({
      source: 'PHOTO',
      evidenceAt: input.photo.capturedAt,
      observedMinutes: minutesBetween(input.photo.capturedAt, booking),
      confidence: null,
      messageId: null,
      reviewStatus: 'AUTO',
    });
  }

  let chatCandidate: ChatCandidate | null = null;

  if (!isValidDate(input.timing.arrivedAt)) {
    const threshold = positiveMinutes(input.chatThresholdMinutes, DEFAULT_WINDOW_BUFFER_MINUTES);

    const qualifying = (input.messages || [])
      .filter((message) => isValidDate(message.createdAt))
      .filter(
        (message) =>
          message.createdAt.getTime() >= window.start.getTime() &&
          message.createdAt.getTime() <= window.end.getTime()
      )
      .filter((message) => minutesBetween(message.createdAt, booking) > threshold)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const last = qualifying.length > 0 ? qualifying[qualifying.length - 1] : null;
    if (last) {
      const observedMinutes = minutesBetween(last.createdAt, booking);
      chatCandidate = { messageId: last.id, at: last.createdAt, observedMinutes };
      drafts.push({
        source: 'CHAT',
        evidenceAt: last.createdAt,
        observedMinutes,
        confidence: null,
        messageId: last.id,
        reviewStatus: 'NEEDS_REVIEW',
      });
    }
  }

  const status: VisitEvidenceStatus = isValidDate(input.timing.arrivedAt)
    ? 'MEASURED'
    : chatCandidate
      ? 'CHAT_CANDIDATE'
      : 'UNKNOWN';

  return { status, window, drafts, chatCandidate };
}

/** Kunjungan dianggap punya bukti bila terukur atau ada kandidat chat. */
export function hasVisitEvidence(result: BuildVisitEvidenceResult): boolean {
  return result.status !== 'UNKNOWN';
}
