import { prisma as defaultPrisma } from '../db/client';
import {
  CustomerStaffOwnership,
  resolveCustomerOwnerships,
} from '../domain/staff-retention';

export interface StaffOwnershipView extends CustomerStaffOwnership {
  ownerStaffName: string | null;
  lastStaffName: string | null;
  ownerInactive: boolean;
}

export class StaffOwnershipService {
  constructor(private readonly prisma = defaultPrisma) {}

  /**
   * Ambil ownership untuk banyak customer dalam SATU query.
   * Gagal DB -> Map kosong (fail-open; badge disembunyikan, halaman tetap jalan).
   */
  async getByCustomerIds(
    tenantId: string,
    customerIds: string[]
  ): Promise<Map<string, StaffOwnershipView>> {
    const ids = [...new Set((customerIds || []).filter(Boolean))];
    if (ids.length === 0) return new Map();

    try {
      const rows = await this.prisma.reservation.findMany({
        where: {
          tenant_id: tenantId,
          customer_id: { in: ids },
          status: 'completed',
          booking_date: { not: null },
          OR: [{ series_id: null }, { session_number: 1 }],
          customer: {
            is: {
              is_sandbox_test: false,
              is_internal_staff: false,
              deleted_at: null,
            },
          },
        },
        select: {
          customer_id: true,
          status: true,
          booking_date: true,
          assigned_staff_id: true,
          created_at: true,
          series_id: true,
          session_number: true,
          assigned_staff: {
            select: { id: true, name: true, active: true },
          },
        },
        orderBy: { created_at: 'asc' },
      });

      const staffMeta = new Map<string, { name: string | null; active: boolean | null }>();
      for (const row of rows) {
        if (row.assigned_staff) {
          staffMeta.set(row.assigned_staff.id, {
            name: row.assigned_staff.name ?? null,
            active: row.assigned_staff.active ?? null,
          });
        }
      }

      const ownership = resolveCustomerOwnerships(
        rows.map((row) => ({
          customerId: row.customer_id,
          status: row.status,
          bookingDate: row.booking_date,
          assignedStaffId: row.assigned_staff_id,
          createdAt: row.created_at,
          seriesId: row.series_id,
          sessionNumber: row.session_number,
        }))
      );

      const result = new Map<string, StaffOwnershipView>();
      for (const [customerId, item] of ownership.entries()) {
        const ownerMeta = item.ownerStaffId ? staffMeta.get(item.ownerStaffId) : null;
        const lastMeta = item.lastStaffId ? staffMeta.get(item.lastStaffId) : null;
        result.set(customerId, {
          ...item,
          ownerStaffName: ownerMeta?.name ?? null,
          lastStaffName: lastMeta?.name ?? null,
          ownerInactive: ownerMeta?.active === false,
        });
      }
      return result;
    } catch (err) {
      console.warn('[STAFF OWNERSHIP] query failed, badge disabled:', (err as Error).message);
      return new Map();
    }
  }
}

export const staffOwnershipService = new StaffOwnershipService();
