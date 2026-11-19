/**
 * visit-evidence.service.ts — pengumpul bukti kedatangan.
 *
 * Batas tegas:
 * - HANYA menulis ke `visit_arrival_evidence`.
 * - TIDAK PERNAH menulis/mengubah `reservations.arrived_at`.
 * - Status review yang sudah APPROVED/REJECTED tidak ditimpa saat backfill ulang.
 */

import { prisma as defaultPrisma } from '../db/client';
import {
  DEFAULT_WINDOW_BUFFER_MINUTES,
  EvidenceDraft,
  PhotoCapture,
  buildVisitEvidence,
  resolveEvidenceWindow,
  type BuildVisitEvidenceResult,
  type ReservationTiming,
} from '../domain/visit-evidence';

export interface VisitEvidencePolicy {
  bufferMinutes: number;
  chatThresholdMinutes: number;
  toleranceMinutes: number;
}

export const DEFAULT_VISIT_EVIDENCE_POLICY: VisitEvidencePolicy = {
  bufferMinutes: DEFAULT_WINDOW_BUFFER_MINUTES,
  chatThresholdMinutes: DEFAULT_WINDOW_BUFFER_MINUTES,
  toleranceMinutes: 30,
};

export interface CollectPeriodSummary {
  total: number;
  measured: number;
  chatCandidate: number;
  unknown: number;
  persisted: number;
  skippedReviewed: number;
}

export class VisitEvidenceService {
  constructor(private readonly prisma: any = defaultPrisma) {}

  /**
   * Mengumpulkan bukti untuk satu reservasi. Tidak menulis apa pun.
   */
  async collectForReservation(
    reservationId: string,
    tenantId: string,
    policy: VisitEvidencePolicy = DEFAULT_VISIT_EVIDENCE_POLICY
  ): Promise<BuildVisitEvidenceResult | null> {
    const reservation = await this.prisma.reservation.findFirst({
      where: { id: reservationId, tenant_id: tenantId },
      select: {
        id: true,
        customer_id: true,
        booking_date: true,
        duration_minutes: true,
        arrived_at: true,
        otw_sent_at: true,
      },
    });

    if (!reservation) return null;

    const timing: ReservationTiming = {
      bookingDate: reservation.booking_date ? new Date(reservation.booking_date) : null,
      durationMinutes: reservation.duration_minutes ?? null,
      arrivedAt: reservation.arrived_at ? new Date(reservation.arrived_at) : null,
      otwSentAt: reservation.otw_sent_at ? new Date(reservation.otw_sent_at) : null,
    };

    const window = resolveEvidenceWindow(timing, policy.bufferMinutes);

    const messages = window
      ? await this.prisma.message.findMany({
          where: {
            tenant_id: tenantId,
            direction: 'INBOUND',
            conversation: { customer_id: reservation.customer_id },
            created_at: { gte: window.start, lte: window.end },
          },
          select: { id: true, created_at: true },
          orderBy: { created_at: 'asc' },
        })
      : [];

    const photo = await this.loadPhotoCapture(reservationId, tenantId);

    return buildVisitEvidence({
      timing,
      messages: (messages || []).map((message: any) => ({
        id: String(message.id),
        createdAt: new Date(message.created_at),
      })),
      photo,
      bufferMinutes: policy.bufferMinutes,
      chatThresholdMinutes: policy.chatThresholdMinutes,
    });
  }

  /**
   * Menyimpan draft bukti. Melewati baris yang sudah di-review admin.
   * Mengembalikan jumlah yang ditulis dan yang dilewati.
   */
  async persistDrafts(
    reservationId: string,
    tenantId: string,
    drafts: EvidenceDraft[]
  ): Promise<{ persisted: number; skippedReviewed: number }> {
    let persisted = 0;
    let skippedReviewed = 0;

    for (const draft of drafts) {
      const where = {
        tenant_id_reservation_id_source_evidence_at: {
          tenant_id: tenantId,
          reservation_id: reservationId,
          source: draft.source,
          evidence_at: draft.evidenceAt,
        },
      };

      const existing = await this.prisma.visitArrivalEvidence.findUnique({
        where,
        select: { review_status: true },
      });

      if (
        existing &&
        (existing.review_status === 'APPROVED' || existing.review_status === 'REJECTED')
      ) {
        skippedReviewed += 1;
        continue;
      }

      await this.prisma.visitArrivalEvidence.upsert({
        where,
        create: {
          tenant_id: tenantId,
          reservation_id: reservationId,
          source: draft.source,
          evidence_at: draft.evidenceAt,
          observed_minutes: draft.observedMinutes,
          confidence: draft.confidence,
          message_id: draft.messageId,
          review_status: draft.reviewStatus,
        },
        update: {
          observed_minutes: draft.observedMinutes,
          confidence: draft.confidence,
          message_id: draft.messageId,
          review_status: draft.reviewStatus,
        },
      });
      persisted += 1;
    }

    return { persisted, skippedReviewed };
  }

  /**
   * Backfill satu periode. Default tidak menulis (commit=false).
   */
  async collectForPeriod(params: {
    tenantId: string;
    from: Date;
    to: Date;
    policy?: VisitEvidencePolicy;
    commit?: boolean;
  }): Promise<CollectPeriodSummary> {
    const policy = params.policy ?? DEFAULT_VISIT_EVIDENCE_POLICY;
    const summary: CollectPeriodSummary = {
      total: 0,
      measured: 0,
      chatCandidate: 0,
      unknown: 0,
      persisted: 0,
      skippedReviewed: 0,
    };

    const reservations = await this.prisma.reservation.findMany({
      where: {
        tenant_id: params.tenantId,
        status: 'completed',
        booking_date: { gte: params.from, lt: params.to },
      },
      select: { id: true },
      orderBy: { booking_date: 'asc' },
    });

    for (const reservation of reservations || []) {
      const result = await this.collectForReservation(reservation.id, params.tenantId, policy);
      if (!result) continue;

      summary.total += 1;
      if (result.status === 'MEASURED') summary.measured += 1;
      else if (result.status === 'CHAT_CANDIDATE') summary.chatCandidate += 1;
      else summary.unknown += 1;

      if (params.commit && result.drafts.length > 0) {
        const write = await this.persistDrafts(reservation.id, params.tenantId, result.drafts);
        summary.persisted += write.persisted;
        summary.skippedReviewed += write.skippedReviewed;
      }
    }

    return summary;
  }

  /**
   * Waktu foto rumah dari audit log. Opsional dan fail-soft.
   * Catatan: audit log menyimpan reservationId di dalam payload JSON,
   * sedangkan target_id adalah customer.
   */
  private async loadPhotoCapture(
    reservationId: string,
    tenantId: string
  ): Promise<PhotoCapture | null> {
    try {
      const rows = await this.prisma.$queryRaw`
        SELECT created_at
        FROM audit_logs
        WHERE tenant_id = ${tenantId}
          AND action = 'STAFF_UPDATE_CUSTOMER_LOCATION'
          AND (payload::jsonb)->>'reservationId' = ${reservationId}
        ORDER BY created_at ASC
        LIMIT 1
      `;
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row || !row.created_at) return null;
      return { capturedAt: new Date(row.created_at) };
    } catch {
      return null;
    }
  }
}

// Catatan: sengaja tanpa singleton. Pemanggil (skrip/rute) membuat instance
// sendiri agar dependensi Prisma bisa diinjeksi saat pengujian.
