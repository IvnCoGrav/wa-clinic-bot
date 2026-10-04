import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { auditService } from '../../src/services/audit.service';
import { customerService } from '../../src/services/customer.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Adversarial: Sinkronisasi penugasan terapis pada PATCH /api/admin/reservation/:id
 * - Dual-casing: camelCase ∪ snake_case (assignedStaffId / assigned_staff_id)
 * - Validasi FK staff tenant-scoped (paritas /assign-staff)
 * - Unassign eksplisit (null) tidak memicu validasi
 * - Precedence camelCase saat keduanya dikirim
 * - Dual-casing field generik (booking_date)
 */

const ADMIN_KEY = 'test_admin_key_123';

function makeExisting(overrides: Record<string, any> = {}) {
  return {
    id: 'res-sync-1',
    tenant_id: DEFAULT_TENANT_ID,
    customer_id: 'cust-sync-1',
    treatment_category: 'BABY',
    treatment_detail: 'Pijat Bayi',
    purchase_value: 60000,
    status: 'pending',
    booking_date: null,
    assigned_staff_id: null,
    raw_text: '[Admin Manual] BABY: Pijat Bayi',
    customer: {
      id: 'cust-sync-1',
      name: 'Bunda Sync',
      phone: '081234567890',
      children: [],
    },
    ...overrides,
  };
}

describe('Reservasi — sinkronisasi penugasan terapis (PATCH full-edit)', () => {
  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    vi.mocked(prisma.reservation.findFirst).mockReset();
    vi.mocked(prisma.reservation.update).mockReset();
    vi.mocked(prisma.staff.findFirst).mockReset();
  });

  it('menerima snake_case assigned_staff_id dan menyimpannya (dual-casing)', async () => {
    const existing = makeExisting();
    let capturedUpdateData: any = null;

    vi.mocked(prisma.reservation.findFirst)
      .mockResolvedValueOnce(existing as any)
      .mockResolvedValueOnce({
        ...existing,
        assigned_staff_id: 'staff-snake',
        assigned_staff: { id: 'staff-snake', name: 'Bidan Ayu', phone: '0812' },
      } as any);
    vi.mocked(prisma.staff.findFirst).mockResolvedValue({ id: 'staff-snake', name: 'Bidan Ayu' } as any);
    vi.mocked(prisma.reservation.update).mockImplementationOnce(async ({ data }: any) => {
      capturedUpdateData = data;
      return { ...existing, ...data } as any;
    });
    vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/reservation/${existing.id}`,
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { assigned_staff_id: 'staff-snake' },
    });

    expect(res.statusCode).toBe(200);
    expect(capturedUpdateData.assigned_staff_id).toBe('staff-snake');
    expect(vi.mocked(prisma.staff.findFirst)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'staff-snake', tenant_id: DEFAULT_TENANT_ID } })
    );
  });

  it('menerima camelCase assignedStaffId (kontrak lama tetap jalan)', async () => {
    const existing = makeExisting();
    let capturedUpdateData: any = null;

    vi.mocked(prisma.reservation.findFirst)
      .mockResolvedValueOnce(existing as any)
      .mockResolvedValueOnce({
        ...existing,
        assigned_staff_id: 'staff-camel',
        assigned_staff: { id: 'staff-camel', name: 'Bidan Camel', phone: '0813' },
      } as any);
    vi.mocked(prisma.staff.findFirst).mockResolvedValue({ id: 'staff-camel', name: 'Bidan Camel' } as any);
    vi.mocked(prisma.reservation.update).mockImplementationOnce(async ({ data }: any) => {
      capturedUpdateData = data;
      return { ...existing, ...data } as any;
    });
    vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/reservation/${existing.id}`,
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { assignedStaffId: 'staff-camel' },
    });

    expect(res.statusCode).toBe(200);
    expect(capturedUpdateData.assigned_staff_id).toBe('staff-camel');
  });

  it('precedence: camelCase menang bila keduanya dikirim (anti ambigu)', async () => {
    const existing = makeExisting();
    let capturedUpdateData: any = null;

    vi.mocked(prisma.reservation.findFirst)
      .mockResolvedValueOnce(existing as any)
      .mockResolvedValueOnce({ ...existing, assigned_staff_id: 'staff-a' } as any);
    vi.mocked(prisma.staff.findFirst).mockResolvedValue({ id: 'staff-a', name: 'Bidan A' } as any);
    vi.mocked(prisma.reservation.update).mockImplementationOnce(async ({ data }: any) => {
      capturedUpdateData = data;
      return { ...existing, ...data } as any;
    });
    vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/reservation/${existing.id}`,
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { assignedStaffId: 'staff-a', assigned_staff_id: 'staff-b' },
    });

    expect(res.statusCode).toBe(200);
    expect(capturedUpdateData.assigned_staff_id).toBe('staff-a');
  });

  it('staffId tidak valid → 400 tanpa menyentuh prisma.reservation.update', async () => {
    const existing = makeExisting();
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(existing as any);
    vi.mocked(prisma.staff.findFirst).mockResolvedValue(null);
    const updateSpy = vi.mocked(prisma.reservation.update).mockResolvedValue({} as any);
    updateSpy.mockClear();

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/reservation/${existing.id}`,
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { assigned_staff_id: 'staff-ghost' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('Staff');
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('unassign eksplisit null → clear FK, tanpa validasi staff', async () => {
    const existing = makeExisting({ assigned_staff_id: 'staff-old' });
    let capturedUpdateData: any = null;

    vi.mocked(prisma.reservation.findFirst)
      .mockResolvedValueOnce(existing as any)
      .mockResolvedValueOnce({ ...existing, assigned_staff_id: null, assigned_staff: null } as any);
    vi.mocked(prisma.reservation.update).mockImplementationOnce(async ({ data }: any) => {
      capturedUpdateData = data;
      return { ...existing, ...data } as any;
    });
    vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/reservation/${existing.id}`,
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { assigned_staff_id: null },
    });

    expect(res.statusCode).toBe(200);
    expect(capturedUpdateData.assigned_staff_id).toBeNull();
    expect(vi.mocked(prisma.staff.findFirst)).not.toHaveBeenCalled();
  });

  it('dual-casing generik: booking_date snake diterima & dikonversi', async () => {
    const existing = makeExisting({ assigned_staff_id: null });
    let capturedUpdateData: any = null;

    vi.mocked(prisma.reservation.findFirst)
      .mockResolvedValueOnce(existing as any)
      .mockResolvedValueOnce({ ...existing } as any);
    vi.mocked(prisma.reservation.update).mockImplementationOnce(async ({ data }: any) => {
      capturedUpdateData = data;
      return { ...existing, ...data } as any;
    });
    vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined as any);
    vi.spyOn(customerService, 'recalculateCustomerLtv').mockResolvedValue(undefined as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/reservation/${existing.id}`,
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { booking_date: '2026-08-20T10:00:00.000Z' },
    });

    expect(res.statusCode).toBe(200);
    expect(capturedUpdateData.booking_date).toBeInstanceOf(Date);
    expect((capturedUpdateData.booking_date as Date).toISOString()).toBe('2026-08-20T10:00:00.000Z');
  });
});
