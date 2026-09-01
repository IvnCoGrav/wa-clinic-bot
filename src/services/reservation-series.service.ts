import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

export interface CreateSeriesParams {
  customerId: string;
  treatmentName: string;
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
   * Create a reservation series with N auto-generated reservations.
   */
  async createSeries(params: CreateSeriesParams, tenantId: string = DEFAULT_TENANT_ID): Promise<SeriesWithReservations> {
    const {
      customerId,
      treatmentName,
      totalSessions,
      purchaseValue,
      assignedStaffId,
      notes,
      sessions,
    } = params;

    if (sessions.length !== totalSessions) {
      throw new Error(`sessions array length (${sessions.length}) tidak sama dengan totalSessions (${totalSessions})`);
    }

    // Create series + all reservations in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const series = await tx.reservationSeries.create({
        data: {
          tenant_id: tenantId,
          customer_id: customerId,
          treatment_name: treatmentName,
          total_sessions: totalSessions,
          purchase_value: purchaseValue ?? null,
          assigned_staff_id: assignedStaffId ?? null,
          notes: notes ?? null,
          status: 'active',
        },
      });

      const reservations = await Promise.all(
        sessions.map(async (s) => {
          const bookingDate = typeof s.bookingDate === 'string' ? new Date(s.bookingDate) : s.bookingDate;
          return tx.reservation.create({
            data: {
              tenant_id: tenantId,
              customer_id: customerId,
              treatment_category: 'BABY',
              treatment_detail: `${treatmentName} [Sesi ${s.sessionNumber}/${totalSessions}]`,
              booking_date: bookingDate,
              status: 'pending',
              assigned_staff_id: s.assignedStaffId ?? assignedStaffId ?? null,
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

    return result;
  }

  /**
   * Get a single series with all its reservations.
   */
  async getSeries(seriesId: string, tenantId: string = DEFAULT_TENANT_ID) {
    return prisma.reservationSeries.findFirst({
      where: { id: seriesId, tenant_id: tenantId },
      include: {
        reservations: { orderBy: { session_number: 'asc' } },
        customer: { select: { id: true, name: true, phone: true } },
        assigned_staff: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Get all active series for a customer.
   */
  async getCustomerSeries(customerId: string, tenantId: string = DEFAULT_TENANT_ID) {
    return prisma.reservationSeries.findMany({
      where: { customer_id: customerId, tenant_id: tenantId, status: { notIn: ['cancelled'] } },
      include: {
        reservations: { orderBy: { session_number: 'asc' } },
        assigned_staff: { select: { id: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Update a single session's booking date or staff.
   */
  async updateSession(
    reservationId: string,
    data: { bookingDate?: Date | string; assignedStaffId?: string; status?: string },
    tenantId: string = DEFAULT_TENANT_ID
  ) {
    const updateData: any = {};
    if (data.bookingDate !== undefined) {
      updateData.booking_date = typeof data.bookingDate === 'string' ? new Date(data.bookingDate) : data.bookingDate;
    }
    if (data.assignedStaffId !== undefined) {
      updateData.assigned_staff_id = data.assignedStaffId;
    }
    if (data.status !== undefined) {
      updateData.status = data.status;
    }

    return prisma.reservation.update({
      where: { id: reservationId, tenant_id: tenantId },
      data: updateData,
    });
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
