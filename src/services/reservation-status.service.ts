import { prisma } from '../db/client';
import { canTransition, isPrematureCompletion } from '../domain/reservation-status';

export class InvalidTransitionError extends Error {
  readonly code = 'ILLEGAL_TRANSITION';
  readonly statusCode = 409;
  constructor(public readonly from: string, public readonly to: string) {
    super(`Transisi ${from} → ${to} ditolak.`);
    this.name = 'InvalidTransitionError';
  }
}

export class PrematureCompletionError extends Error {
  readonly code = 'PREMATURE_COMPLETION';
  readonly statusCode = 409;
  constructor() {
    super('Reservasi masa depan tidak dapat ditandai completed sebelum tanggal kunjungan tiba.');
    this.name = 'PrematureCompletionError';
  }
}

export class ReservationStatusService {
  async getForTransition(id: string, tenantId: string) {
    return prisma.reservation.findFirst({ where: { id, tenant_id: tenantId } });
  }

  assertTransition(
    existing: { status?: string | null; booking_date?: Date | string | null; assigned_staff_id?: string | null },
    to: string,
    opts?: { force?: boolean }
  ): void {
    const currentStatus = existing.status || 'confirmed';
    if (currentStatus === to) return;
    if (!canTransition(currentStatus, to)) {
      throw new InvalidTransitionError(currentStatus, to);
    }
    if (to === 'completed' && isPrematureCompletion(existing.booking_date) && !opts?.force) {
      throw new PrematureCompletionError();
    }
  }

  async applyTransition(
    existing: { id: string; status: string; booking_date?: Date | string | null; assigned_staff_id?: string | null },
    opts: {
      to: string;
      force?: boolean;
      allowUnassignedStaff?: boolean;
      extraData?: Record<string, unknown>;
      include?: Record<string, unknown>;
      db?: any;
    }
  ): Promise<
    | { ok: true; reservation: any }
    | { ok: false; reason: 'STAFF_REQUIRED' }
  > {
    const currentStatus = existing.status || 'confirmed';
    if (!canTransition(currentStatus, opts.to)) {
      throw new InvalidTransitionError(currentStatus, opts.to);
    }
    if (opts.to === 'completed') {
      if (isPrematureCompletion(existing.booking_date) && !opts.force) {
        throw new PrematureCompletionError();
      }
      if (!existing.assigned_staff_id && !opts.allowUnassignedStaff) {
        return { ok: false, reason: 'STAFF_REQUIRED' };
      }
    }
    const client = opts.db || prisma;
    const reservation = await client.reservation.update({
      where: { id: existing.id },
      data: { status: opts.to, ...(opts.extraData || {}) } as any,
      ...(opts.include ? { include: opts.include as any } : {}),
    });
    return { ok: true, reservation };
  }
}

export const reservationStatusService = new ReservationStatusService();
