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

export interface EvidenceMessageContext {
  id: string;
  content: string;
  createdAt: Date;
  direction: string | null;
  senderType: string | null;
  isAnchor: boolean;
}

export interface EvidenceReviewItem {
  id: string;
  source: string;
  evidenceAt: Date;
  observedMinutes: number | null;
  confidence: number | null;
  reviewStatus: string;
  conversationId: string | null;
  message: { id: string; content: string; createdAt: Date } | null;
  /** Hingga 3 pesan sebelum & sesudah pesan bukti, untuk konteks review. */
  context: EvidenceMessageContext[];
  reservation: {
    id: string;
    bookingDate: Date | null;
    customerName: string | null;
    staffName: string | null;
    staffId: string | null;
  };
}

export interface ReviewEvidenceResult {
  ok: boolean;
  code?: 'NOT_FOUND' | 'ALREADY_REVIEWED' | 'INVALID_ACTION';
  data?: any;
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

  private async buildReviewWhere(params: {
    tenantId: string;
    status?: 'AUTO' | 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED';
    staffId?: string | null;
    from?: Date | null;
    to?: Date | null;
    onlyScored?: boolean;
  }): Promise<any> {
    const where: any = {
      tenant_id: params.tenantId,
      review_status: params.status ?? 'NEEDS_REVIEW',
    };

    const reservationFilter: any = {};
    if (params.staffId) {
      reservationFilter.assigned_staff_id = params.staffId;
    } else if (params.onlyScored) {
      try {
        const staff = await this.prisma.staff.findMany({
          where: { tenant_id: params.tenantId, active: true, incentive_eligible: true },
          select: { id: true },
        });
        reservationFilter.assigned_staff_id = { in: (staff || []).map((row: any) => row.id) };
      } catch {
        // Fail-closed: jangan tampilkan staf yang tidak jelas statusnya.
        reservationFilter.assigned_staff_id = { in: [] };
      }
    }
    if (params.from || params.to) {
      reservationFilter.booking_date = {
        ...(params.from ? { gte: params.from } : {}),
        ...(params.to ? { lte: params.to } : {}),
      };
    }
    if (Object.keys(reservationFilter).length > 0) {
      where.reservation = reservationFilter;
    }
    return where;
  }

  private async loadMessageContext(anchor: any): Promise<EvidenceMessageContext[]> {
    const toContext = (row: any, anchorId: string): EvidenceMessageContext => ({
      id: row.id,
      content: row.content,
      createdAt: new Date(row.created_at),
      direction: row.direction ?? null,
      senderType: row.sender_type ?? null,
      isAnchor: row.id === anchorId,
    });

    if (!anchor?.conversation_id) {
      return anchor ? [toContext(anchor, anchor.id)] : [];
    }

    const select = {
      id: true,
      content: true,
      created_at: true,
      direction: true,
      sender_type: true,
    };

    try {
      const [before, after] = await Promise.all([
        this.prisma.message.findMany({
          where: {
            conversation_id: anchor.conversation_id,
            created_at: { lt: anchor.created_at },
          },
          orderBy: { created_at: 'desc' },
          take: 3,
          select,
        }),
        this.prisma.message.findMany({
          where: {
            conversation_id: anchor.conversation_id,
            created_at: { gt: anchor.created_at },
          },
          orderBy: { created_at: 'asc' },
          take: 3,
          select,
        }),
      ]);

      const ordered = [...(before || []).reverse(), anchor, ...(after || [])];
      const seen = new Set<string>();
      return ordered
        .filter((row: any) => {
          if (!row?.id || seen.has(row.id)) return false;
          seen.add(row.id);
          return true;
        })
        .map((row: any) => toContext(row, anchor.id));
    } catch {
      // Konteks bersifat pelengkap; kegagalan baca tidak boleh menghilangkan bukti.
      return [toContext(anchor, anchor.id)];
    }
  }

  /**
   * Halaman antrean review admin. Hanya membaca.
   * `onlyScored` membatasi ke staf aktif + incentive_eligible (daftar dinilai).
   */
  async listForReview(params: {
    tenantId: string;
    status?: 'AUTO' | 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED';
    staffId?: string | null;
    from?: Date | null;
    to?: Date | null;
    limit?: number;
    offset?: number;
    onlyScored?: boolean;
  }): Promise<{ items: EvidenceReviewItem[]; total: number }> {
    const take = Math.min(Math.max(params.limit ?? 20, 1), 50);
    const skip = Math.min(Math.max(params.offset ?? 0, 0), 10_000);
    const where = await this.buildReviewWhere(params);

    const rows = await this.prisma.visitArrivalEvidence.findMany({
      where,
      orderBy: { evidence_at: 'desc' },
      skip,
      take,
      include: {
        reservation: {
          select: {
            id: true,
            booking_date: true,
            assigned_staff_id: true,
            customer: { select: { name: true } },
            assigned_staff: { select: { name: true } },
          },
        },
      },
    });

    let total: number | null = null;
    try {
      total = await this.prisma.visitArrivalEvidence.count({ where });
    } catch {
      total = null;
    }

    const messageIds = (rows || [])
      .map((row: any) => row.message_id)
      .filter((id: any) => Boolean(id));

    const messages = messageIds.length
      ? await this.prisma.message
          .findMany({
            where: { id: { in: messageIds } },
            select: {
              id: true,
              content: true,
              created_at: true,
              conversation_id: true,
              direction: true,
              sender_type: true,
            },
          })
          .catch(() => [])
      : [];

    const messageMap = new Map<string, any>(
      (messages || []).map((message: any) => [message.id, message])
    );

    const items: EvidenceReviewItem[] = [];
    for (const row of rows || []) {
      const message = row.message_id ? messageMap.get(row.message_id) : null;
      items.push({
        id: row.id,
        source: String(row.source),
        evidenceAt: new Date(row.evidence_at),
        observedMinutes: row.observed_minutes ?? null,
        confidence: row.confidence ?? null,
        reviewStatus: String(row.review_status),
        conversationId: message?.conversation_id ?? null,
        message: message
          ? {
              id: message.id,
              content: message.content,
              createdAt: new Date(message.created_at),
            }
          : null,
        context: message ? await this.loadMessageContext(message) : [],
        reservation: {
          id: row.reservation?.id ?? row.reservation_id,
          bookingDate: row.reservation?.booking_date
            ? new Date(row.reservation.booking_date)
            : null,
          customerName: row.reservation?.customer?.name ?? null,
          staffName: row.reservation?.assigned_staff?.name ?? null,
          staffId: row.reservation?.assigned_staff_id ?? null,
        },
      });
    }

    return { items, total: Number(total ?? items.length) };
  }

  /**
   * Menyetujui/menolak bukti. Hanya mengubah baris bukti; tidak menyentuh reservasi.
   */
  async reviewEvidence(params: {
    tenantId: string;
    evidenceId: string;
    action: 'APPROVE' | 'REJECT';
    note?: string | null;
    actor: string;
  }): Promise<ReviewEvidenceResult> {
    if (params.action !== 'APPROVE' && params.action !== 'REJECT') {
      return { ok: false, code: 'INVALID_ACTION' };
    }

    const existing = await this.prisma.visitArrivalEvidence.findFirst({
      where: { id: params.evidenceId, tenant_id: params.tenantId },
    });

    if (!existing) return { ok: false, code: 'NOT_FOUND' };
    if (existing.review_status === 'APPROVED' || existing.review_status === 'REJECTED') {
      return { ok: false, code: 'ALREADY_REVIEWED' };
    }

    const updated = await this.prisma.visitArrivalEvidence.update({
      where: { id: params.evidenceId },
      data: {
        review_status: params.action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        reviewed_by: params.actor,
        reviewed_at: new Date(),
        review_note: params.note ?? null,
      },
    });

    return { ok: true, data: updated };
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
