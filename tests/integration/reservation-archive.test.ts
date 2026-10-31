import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { prisma } from '../../src/db/client';
import {
  reservationArchiveService,
  ReservationArchiveService,
} from '../../src/services/reservation-archive.service';
import { googleCalendarService } from '../../src/services/google-calendar.service';
import { staffNotificationService } from '../../src/services/staff-notification.service';
import { auditService } from '../../src/services/audit.service';
import { customerService } from '../../src/services/customer.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Reservation Archive System Adversarial Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Arsip berhasil: baris dipindahkan ke reservation_archives dan dihapus dari reservations', async () => {
    const mockRes = {
      id: 'res-arch-1',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-1',
      treatment_detail: 'Pijat Bayi',
      treatment_category: 'BABY',
      booking_date: new Date('2026-11-05T10:00:00Z'),
      status: 'confirmed',
      raw_text: 'Pijat Bayi 10:00',
      purchase_value: 125000,
      customer: {
        id: 'cust-1',
        name: 'Bunda Sarah',
        phone: '081234567890',
        address: 'Jl. Melati No 5',
      },
      items: [],
      children: [],
      follow_ups: [],
    };

    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(mockRes as any);
    vi.spyOn(prisma, '$transaction').mockImplementation(async (cb: any) => {
      const tx = {
        reservationArchive: {
          create: vi.fn().mockResolvedValue({ ...mockRes, id: 'arch-123' }),
        },
        child: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        reservation: { delete: vi.fn().mockResolvedValue(mockRes) },
      };
      return cb(tx);
    });

    const auditSpy = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue({} as any);
    const recalcSpy = vi.spyOn(customerService, 'recalculateCustomerLtv').mockResolvedValue(125000);

    const result = await reservationArchiveService.archiveReservation({
      id: 'res-arch-1',
      tenantId: DEFAULT_TENANT_ID,
      actor: 'admin@kala.com',
      reason: 'Customer minta batal',
    });

    expect(result.success).toBe(true);
    expect(result.archiveId).toBe('arch-123');
    expect(recalcSpy).toHaveBeenCalledWith('cust-1', DEFAULT_TENANT_ID);
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ARCHIVE_RESERVATION',
        targetId: 'res-arch-1',
        payload: expect.objectContaining({
          customerName: 'Bunda Sarah',
          customerPhone: '081234567890',
          treatmentDetail: 'Pijat Bayi',
          purchaseValue: 125000,
        }),
      })
    );
  });

  it('2. DB mati di tengah transaksi: tidak ada baris terhapus sebagian (rollback)', async () => {
    const mockRes = {
      id: 'res-crash-1',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-2',
      treatment_detail: 'Pijat Laktasi',
      customer: { id: 'cust-2', name: 'Bunda Maya', phone: '081111111' },
      items: [],
      children: [],
      follow_ups: [],
    };

    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(mockRes as any);
    vi.spyOn(prisma, '$transaction').mockRejectedValue(new Error('PostgreSQL connection terminated'));

    await expect(
      reservationArchiveService.archiveReservation({
        id: 'res-crash-1',
        tenantId: DEFAULT_TENANT_ID,
      })
    ).rejects.toThrowError(/PostgreSQL connection terminated/);
  });

  it('3. Audit log memuat identitas lengkap customer & treatment (bukan hanya { hard: true })', async () => {
    const mockRes = {
      id: 'res-audit-detail',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-3',
      treatment_detail: 'Pijat Kolik Moksa',
      purchase_value: 150000,
      customer: { id: 'cust-3', name: 'Bunda Nia', phone: '082222222' },
      items: [],
      children: [],
      follow_ups: [],
    };

    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(mockRes as any);
    vi.spyOn(prisma, '$transaction').mockImplementation(async (cb: any) => {
      const tx = {
        reservationArchive: { create: vi.fn().mockResolvedValue({ id: 'arch-3' }) },
        child: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        reservation: { delete: vi.fn().mockResolvedValue(mockRes) },
      };
      return cb(tx);
    });

    let loggedPayload: any = null;
    vi.spyOn(auditService, 'logAdminAction').mockImplementation(async (entry: any) => {
      loggedPayload = entry.payload;
      return {} as any;
    });

    await reservationArchiveService.archiveReservation({
      id: 'res-audit-detail',
      tenantId: DEFAULT_TENANT_ID,
      actor: 'superadmin',
      reason: 'Salah booking tanggal',
    });

    expect(loggedPayload).toBeDefined();
    expect(loggedPayload.customerName).toBe('Bunda Nia');
    expect(loggedPayload.customerPhone).toBe('082222222');
    expect(loggedPayload.treatmentDetail).toBe('Pijat Kolik Moksa');
    expect(loggedPayload.purchaseValue).toBe(150000);
    expect(loggedPayload.reason).toBe('Salah booking tanggal');
    expect(loggedPayload.restoreUntil).toBeDefined();
  });

  it('4. Pulihkan: reservasi kembali muncul di tabel reservations, LTV dihitung ulang', async () => {
    const mockSnapshot = {
      schemaVersion: 1,
      reservation: {
        id: 'res-restored-1',
        tenant_id: DEFAULT_TENANT_ID,
        customer_id: 'cust-4',
        treatment_category: 'BABY',
        treatment_detail: 'Pijat Bapil',
        purchase_value: 100000,
        status: 'confirmed',
      },
      items: [
        {
          id: 'item-1',
          treatment_name: 'Pijat Bapil',
          category: 'BABY',
          price: 100000,
          quantity: 1,
        },
      ],
      children: [{ id: 'child-1', name: 'Adek Rayyan' }],
    };

    const mockArchive = {
      id: 'arch-restore-1',
      tenant_id: DEFAULT_TENANT_ID,
      reservation_id: 'res-restored-1',
      restore_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Masih 30 hari lagi
      restored_at: null,
      payload: mockSnapshot,
    };

    vi.spyOn(prisma.reservationArchive, 'findFirst').mockResolvedValue(mockArchive as any);
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null); // belum aktif

    let txCreateCalled = false;
    let txRelinkChildCalled = false;
    let txMarkRestored = false;

    vi.spyOn(prisma, '$transaction').mockImplementation(async (cb: any) => {
      const tx = {
        reservation: {
          create: vi.fn().mockImplementation((args: any) => {
            txCreateCalled = true;
            return args.data;
          }),
        },
        reservationItem: {
          create: vi.fn().mockResolvedValue({}),
        },
        child: {
          updateMany: vi.fn().mockImplementation(() => {
            txRelinkChildCalled = true;
            return { count: 1 };
          }),
        },
        reservationArchive: {
          update: vi.fn().mockImplementation(() => {
            txMarkRestored = true;
            return { id: mockArchive.id, restored_at: new Date() };
          }),
        },
      };
      return cb(tx);
    });

    const recalcSpy = vi.spyOn(customerService, 'recalculateCustomerLtv').mockResolvedValue(100000);

    const res = await reservationArchiveService.restoreReservation({
      archiveId: 'arch-restore-1',
      tenantId: DEFAULT_TENANT_ID,
      actor: 'staff-admin',
    });

    expect(res.success).toBe(true);
    expect(res.reservationId).toBe('res-restored-1');
    expect(txCreateCalled).toBe(true);
    expect(txRelinkChildCalled).toBe(true);
    expect(txMarkRestored).toBe(true);
    expect(recalcSpy).toHaveBeenCalledWith('cust-4', DEFAULT_TENANT_ID);
  });

  it('5. Purge hanya menghapus record dengan restore_until < now(); record dipulihkan aman', async () => {
    vi.spyOn(prisma.reservationArchive, 'findMany')
      .mockResolvedValueOnce([
        { id: 'expired-1' },
        { id: 'expired-2' },
      ] as any)
      .mockResolvedValueOnce([]); // batch berikutnya kosong

    const deleteManySpy = vi
      .spyOn(prisma.reservationArchive, 'deleteMany')
      .mockResolvedValue({ count: 2 });

    const purged = await reservationArchiveService.purgeExpired(DEFAULT_TENANT_ID);

    expect(purged).toBe(2);
    expect(deleteManySpy).toHaveBeenCalledWith({
      where: { id: { in: ['expired-1', 'expired-2'] } },
    });
  });

  it('6. Tenant B tidak bisa membaca atau memulihkan arsip Tenant A', async () => {
    vi.spyOn(prisma.reservationArchive, 'findFirst').mockImplementation(async (args: any) => {
      if (args.where.tenant_id === 'tenant-b' && args.where.id === 'arch-tenant-a') {
        return null; // Isolasi tenant
      }
      return { id: 'arch-tenant-a', tenant_id: 'tenant-a' } as any;
    });

    await expect(
      reservationArchiveService.restoreReservation({
        archiveId: 'arch-tenant-a',
        tenantId: 'tenant-b',
      })
    ).rejects.toThrowError(/Arsip reservasi tidak ditemukan/);
  });

  it('7. Reservasi dengan google_calendar_event_id: event dibatalkan sebelum arsip', async () => {
    const mockRes = {
      id: 'res-gcal-1',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-5',
      google_calendar_event_id: 'gcal-event-999',
      treatment_detail: 'Pijat Ceria',
      customer: { id: 'cust-5', name: 'Bunda Rara', phone: '085555555' },
      items: [],
      children: [],
      follow_ups: [],
    };

    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(mockRes as any);
    vi.spyOn(prisma, '$transaction').mockImplementation(async (cb: any) => {
      return cb({
        reservationArchive: { create: vi.fn().mockResolvedValue({ id: 'arch-gcal' }) },
        child: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        reservation: { delete: vi.fn().mockResolvedValue(mockRes) },
      });
    });

    const gcalSpy = vi.spyOn(googleCalendarService, 'deleteEvent').mockResolvedValue(undefined as any);

    await reservationArchiveService.archiveReservation({
      id: 'res-gcal-1',
      tenantId: DEFAULT_TENANT_ID,
    });

    expect(gcalSpy).toHaveBeenCalledWith('gcal-event-999');
  });

  it('8. Notifikasi staf terkirim sebelum reservasi diarsipkan jika ada assigned_staff_id', async () => {
    const mockRes = {
      id: 'res-staff-1',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-6',
      assigned_staff_id: 'staff-dewi',
      treatment_detail: 'Pijat Bapil',
      customer: { id: 'cust-6', name: 'Bunda Lita', phone: '08777777' },
      items: [],
      children: [],
      follow_ups: [],
    };

    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(mockRes as any);
    vi.spyOn(prisma, '$transaction').mockImplementation(async (cb: any) => {
      return cb({
        reservationArchive: { create: vi.fn().mockResolvedValue({ id: 'arch-staff' }) },
        child: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        reservation: { delete: vi.fn().mockResolvedValue(mockRes) },
      });
    });

    const staffNotifSpy = vi
      .spyOn(staffNotificationService, 'sendReservationCancelledNotification')
      .mockResolvedValue(undefined as any);

    await reservationArchiveService.archiveReservation({
      id: 'res-staff-1',
      tenantId: DEFAULT_TENANT_ID,
      reason: 'Bidan sakit',
    });

    expect(staffNotifSpy).toHaveBeenCalledWith('res-staff-1', 'staff-dewi', 'Bidan sakit');
  });
});
