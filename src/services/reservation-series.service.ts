import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { customerService } from './customer.service';

export interface CreateSeriesParams {
  customerId: string;
  treatmentName: string;
  treatmentCategory?: string;
  totalSessions: number;
  purchaseValue?: number;
  assignedStaffId?: string;
  notes?: string;
  sessions: Array<{
    sessionNumber: number;
    bookingDate: Date | string;
    assignedStaffId?: string;
  }>;
}

export interface SeriesWithReservations {
  id: string;
  customerId: string;
  treatmentName: string;
  totalSessions: number;
  completedSessions: number;
  pendingSessions: number;
  purchaseValue: number | null;
  status: string;
  assignedStaffId: string | null;
  notes: string | null;
  createdAt: Date;
  reservations: Array<{
    id: string;
    sessionNumber: number;
    bookingDate: Date;
    status: string;
    assignedStaffId: string | null;
  }>;
}

class ReservationSeriesService {
  /**
   * Helper: Resolve treatment category dynamically from catalog or keywords
   */
  private async resolveCategory(treatmentName: string, explicitCategory?: string): Promise<'BABY' | 'MOMS' | 'BOTH'> {
    if (explicitCategory) {
      const upper = explicitCategory.toUpperCase();
      if (upper === 'MOMS' || upper === 'POSTPARTUM' || upper === 'PREGNANCY') return 'MOMS';
      if (upper === 'BOTH' || upper === 'BUNDLE') return 'BOTH';
      return 'BABY';
    }

    try {
      const { treatmentCatalogService } = await import('./treatment-catalog.service');
      const all = (treatmentCatalogService as any).getAllServices?.() || [];
      const found = all.find((s: any) => s.name?.toLowerCase() === treatmentName.toLowerCase() || treatmentName.toLowerCase().includes(s.name?.toLowerCase()));
      if (found?.category) {
        const cat = found.category.toUpperCase();
        if (cat === 'MOMS' || cat === 'POSTPARTUM' || cat === 'PREGNANCY') return 'MOMS';
        if (cat === 'BOTH' || cat === 'BUNDLE') return 'BOTH';
        return 'BABY';
      }
    } catch {}

    const nameLower = (treatmentName || '').toLowerCase();
    if (nameLower.includes('moms') || nameLower.includes('ibu') || nameLower.includes('hamil') || nameLower.includes('nifas') || nameLower.includes('postpartum') || nameLower.includes('laktasi')) {
      return 'MOMS';
    }
    if (nameLower.includes('combo') || nameLower.includes('both') || (nameLower.includes('ibu') && nameLower.includes('anak'))) {
      return 'BOTH';
    }
    return 'BABY';
  }

  /**
   * Create a reservation series with N auto-generated reservations.
   */
  async createSeries(params: CreateSeriesParams, tenantId: string = DEFAULT_TENANT_ID): Promise<SeriesWithReservations> {
    const {
      customerId,
      treatmentName,
      treatmentCategory,
      totalSessions,
      purchaseValue,
      assignedStaffId,
      notes,
      sessions,
    } = params;

    if (sessions.length !== totalSessions) {
      throw new Error(`sessions array length (${sessions.length}) tidak sama dengan totalSessions (${totalSessions})`);
    }

    const resolvedCategory = await this.resolveCategory(treatmentName, treatmentCategory);
    const sanitizedStaffId = assignedStaffId?.trim() ? assignedStaffId.trim() : null;

    // Create series + all reservations in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const series = await tx.reservationSeries.create({
        data: {
          tenant_id: tenantId,
          customer_id: customerId,
          treatment_name: treatmentName,
          total_sessions: totalSessions,
          purchase_value: purchaseValue ?? null,
          assigned_staff_id: sanitizedStaffId,
          notes: notes ?? null,
          status: 'active',
        },
      });

      const reservations = await Promise.all(
        sessions.map(async (s) => {
          const bookingDate = typeof s.bookingDate === 'string' ? new Date(s.bookingDate) : s.bookingDate;
          const sessionStaffId = s.assignedStaffId?.trim() ? s.assignedStaffId.trim() : sanitizedStaffId;
          return tx.reservation.create({
            data: {
              tenant_id: tenantId,
              customer_id: customerId,
              treatment_category: resolvedCategory,
              treatment_detail: `${treatmentName} [Sesi ${s.sessionNumber}/${totalSessions}]`,
              booking_date: bookingDate,
              status: 'pending',
              assigned_staff_id: sessionStaffId,
              purchase_value: purchaseValue ? Math.round(purchaseValue / totalSessions) : null,
              series_id: series.id,
              session_number: s.sessionNumber,
              total_sessions: totalSessions,
              raw_text: `[Admin Series] ${treatmentName} - Sesi ${s.sessionNumber}/${totalSessions}`,
            },
          });
        })
      );

      return {
        id: series.id,
        customerId: series.customer_id,
        treatmentName: series.treatment_name,
        totalSessions: series.total_sessions,
        completedSessions: 0,
        pendingSessions: reservations.length,
        purchaseValue: series.purchase_value,
        status: series.status,
        assignedStaffId: series.assigned_staff_id,
        notes: series.notes,
        createdAt: series.created_at,
        reservations: reservations.map((r) => ({
          id: r.id,
          sessionNumber: r.session_number!,
          bookingDate: r.booking_date!,
          status: r.status,
          assignedStaffId: r.assigned_staff_id,
        })),
      };
    });

    // Sync customer LTV cache after series reservations are created
    try {
      await customerService.recalculateCustomerLtv(customerId, tenantId);
    } catch (err: any) {
      console.warn('[RESERVATION SERIES] recalculateCustomerLtv on create failed:', err.message);
    }

    // Best-effort background Google Calendar sync (createEvent per session)
    try {
      const { googleCalendarService } = await import('./google-calendar.service');
      const { prisma: gCalPrisma } = await import('../db/client');
      for (const r of result.reservations) {
        if (r.bookingDate) {
          const reservation = await gCalPrisma.reservation.findUnique({ where: { id: r.id } }).catch(() => null);
          const customer = reservation ? await gCalPrisma.customer.findUnique({ where: { id: customerId } }).catch(() => null) : null;
          const name = customer?.name || 'Bunda';
          if (reservation) (googleCalendarService as any).createEvent?.(reservation, name).catch(() => {});
        }
      }
    } catch {}

    return result;
  }

  /**
   * Get a single series with all its reservations.
   */
  async getSeries(seriesId: string, tenantId: string = DEFAULT_TENANT_ID) {
    const series = await prisma.reservationSeries.findFirst({
      where: { id: seriesId, tenant_id: tenantId },
      include: {
        reservations: { orderBy: { session_number: 'asc' } },
        customer: { select: { id: true, name: true, phone: true } },
        assigned_staff: { select: { id: true, name: true } },
      },
    });
    if (!series) return null;

    const completedSessions = series.reservations.filter((r) => r.status === 'completed').length;
    const pendingSessions = series.reservations.filter((r) => r.status === 'pending' || r.status === 'confirmed').length;

    return {
      ...series,
      completed_sessions: completedSessions,
      pending_sessions: pendingSessions,
    };
  }

  /**
   * Get all active series for a customer.
   */
  async getCustomerSeries(customerId: string, tenantId: string = DEFAULT_TENANT_ID) {
    const list = await prisma.reservationSeries.findMany({
      where: { customer_id: customerId, tenant_id: tenantId, status: { notIn: ['cancelled'] } },
      include: {
        reservations: { orderBy: { session_number: 'asc' } },
        assigned_staff: { select: { id: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    return list.map((series) => {
      const completedSessions = series.reservations.filter((r) => r.status === 'completed').length;
      const pendingSessions = series.reservations.filter((r) => r.status === 'pending' || r.status === 'confirmed').length;
      return {
        ...series,
        completed_sessions: completedSessions,
        pending_sessions: pendingSessions,
      };
    });
  }

  /**
   * Update a single session's booking date or staff.
   */
  async updateSession(
    reservationId: string,
    data: { bookingDate?: Date | string; assignedStaffId?: string | null; status?: string },
    tenantId: string = DEFAULT_TENANT_ID
  ) {
    const updateData: any = {};
    if (data.bookingDate !== undefined) {
      updateData.booking_date = typeof data.bookingDate === 'string' ? new Date(data.bookingDate) : data.bookingDate;
    }
    if (data.assignedStaffId !== undefined) {
      updateData.assigned_staff_id = data.assignedStaffId?.trim() ? data.assignedStaffId.trim() : null;
    }
    if (data.status !== undefined) {
      updateData.status = data.status;
    }

    const updated = await prisma.reservation.update({
      where: { id: reservationId, tenant_id: tenantId },
      data: updateData,
    });

    if (data.status !== undefined && updated.customer_id) {
      try {
        await customerService.recalculateCustomerLtv(updated.customer_id, tenantId);
      } catch (err: any) {
        console.warn('[RESERVATION SERIES] recalculateCustomerLtv on updateSession failed:', err.message);
      }
    }

    return updated;
  }

  /**
   * Pause all remaining sessions in a series (set status to 'paused').
   */
  async pauseSeries(seriesId: string, tenantId: string = DEFAULT_TENANT_ID) {
    const series = await prisma.reservationSeries.findFirst({
      where: { id: seriesId, tenant_id: tenantId },
      include: { reservations: true },
    });
    if (!series) throw new Error('Series not found');

    const pendingReservations = series.reservations.filter(
      (r) => r.status === 'pending' || r.status === 'confirmed'
    );

    await prisma.$transaction([
      prisma.reservationSeries.update({
        where: { id: seriesId },
        data: { status: 'paused' },
      }),
      ...pendingReservations.map((r) =>
        prisma.reservation.update({
          where: { id: r.id },
          data: { status: 'paused' },
        })
      ),
    ]);

    return { pausedCount: pendingReservations.length };
  }

  /**
   * Resume a paused series (set remaining sessions back to pending).
   */
  async resumeSeries(seriesId: string, tenantId: string = DEFAULT_TENANT_ID) {
    const series = await prisma.reservationSeries.findFirst({
      where: { id: seriesId, tenant_id: tenantId },
      include: { reservations: true },
    });
    if (!series) throw new Error('Series not found');

    const pausedReservations = series.reservations.filter((r) => r.status === 'paused');

    await prisma.$transaction([
      prisma.reservationSeries.update({
        where: { id: seriesId },
        data: { status: 'active' },
      }),
      ...pausedReservations.map((r) =>
        prisma.reservation.update({
          where: { id: r.id },
          data: { status: 'pending' },
        })
      ),
    ]);

    return { resumedCount: pausedReservations.length };
  }

  /**
   * Cancel remaining sessions in a series.
   */
  async cancelSeries(seriesId: string, tenantId: string = DEFAULT_TENANT_ID) {
    const series = await prisma.reservationSeries.findFirst({
      where: { id: seriesId, tenant_id: tenantId },
      include: { reservations: true },
    });
    if (!series) throw new Error('Series not found');

    const cancellable = series.reservations.filter(
      (r) => r.status === 'pending' || r.status === 'confirmed' || r.status === 'paused'
    );

    await prisma.$transaction([
      prisma.reservationSeries.update({
        where: { id: seriesId },
        data: { status: 'cancelled' },
      }),
      ...cancellable.map((r) =>
        prisma.reservation.update({
          where: { id: r.id },
          data: { status: 'cancelled' },
        })
      ),
    ]);

    // Sync LTV cache after cancelling series
    try {
      await customerService.recalculateCustomerLtv(series.customer_id, tenantId);
    } catch (err: any) {
      console.warn('[RESERVATION SERIES] recalculateCustomerLtv on cancel failed:', err.message);
    }

    return { cancelledCount: cancellable.length };
  }

  /**
   * Auto-mark series as completed when all sessions are done.
   */
  async checkAndCompleteSeries(seriesId: string, tenantId: string = DEFAULT_TENANT_ID) {
    const series = await prisma.reservationSeries.findFirst({
      where: { id: seriesId, tenant_id: tenantId },
      include: { reservations: true },
    });
    if (!series || series.status !== 'active') return;

    const allCompleted = series.reservations.every((r) => r.status === 'completed' || r.status === 'cancelled');
    if (allCompleted) {
      await prisma.reservationSeries.update({
        where: { id: seriesId },
        data: { status: 'completed' },
      });
    }
  }
}

export const reservationSeriesService = new ReservationSeriesService();

