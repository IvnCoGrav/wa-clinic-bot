import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import {
  patientLifecycleService,
  TREATMENT_HISTORY_STATUSES,
  ACTIVE_APPOINTMENT_STATUSES,
} from '../../src/services/patient-lifecycle.service';

/**
 * Canonical Patient Lifecycle Service — Single Source of Truth status klinis
 * & operasional pasien (insiden Bunda Retno 6282132249740).
 *
 * Mock prisma global (tests/setup.ts) menolak semua query DB ("Database
 * offline") dan TIDAK menyediakan `reservation.count`, jadi tiap test
 * men-stubnya eksplisit di sini.
 */

function stubReservationCount(value: number) {
  (prisma.reservation as any).count = vi.fn().mockResolvedValue(value);
}

describe('patient-lifecycle.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubReservationCount(0);
    vi.mocked(prisma.reservation.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.customer.findUnique).mockRejectedValue(new Error('Database offline'));
  });

  it('status treatment-history mencakup completed DAN confirmed', () => {
    expect([...TREATMENT_HISTORY_STATUSES].sort()).toEqual(['completed', 'confirmed']);
    expect([...ACTIVE_APPOINTMENT_STATUSES].sort()).toEqual(['confirmed', 'hold', 'pending']);
  });

  it('pasien dengan reservasi completed terdeteksi hasTreatmentHistory = true', async () => {
    stubReservationCount(1); // count confirmed+completed > 0
    const res = await patientLifecycleService.hasTreatmentHistory('cust-retno', 'default-tenant');
    expect(res).toBe(true);
    expect((prisma.reservation as any).count).toHaveBeenCalledWith({
      where: {
        customer_id: 'cust-retno',
        tenant_id: 'default-tenant',
        status: { in: ['confirmed', 'completed'] },
      },
    });
  });

  it('pasien dengan reservasi confirmed terdeteksi hasTreatmentHistory = true', async () => {
    stubReservationCount(2);
    const res = await patientLifecycleService.hasTreatmentHistory('cust-a', 'default-tenant');
    expect(res).toBe(true);
  });

  it('pasien dengan ltv_cache > 0 terdeteksi hasTreatmentHistory = true (tanpa hitungan DB)', async () => {
    stubReservationCount(0);
    const res = await patientLifecycleService.hasTreatmentHistory('cust-b', 'default-tenant', {
      ltv_cache: 160000,
    });
    expect(res).toBe(true);
  });

  it('pasien tanpa riwayat terdeteksi hasTreatmentHistory = false', async () => {
    stubReservationCount(0);
    const res = await patientLifecycleService.hasTreatmentHistory('cust-new', 'default-tenant', {
      ltv_cache: 0,
    });
    expect(res).toBe(false);
  });

  it('flag snapshot true menang tanpa query DB', async () => {
    const countMock = vi.fn();
    (prisma.reservation as any).count = countMock;
    const res = await patientLifecycleService.hasTreatmentHistory('cust-c', 'default-tenant', {
      has_treatment_history: true,
    });
    expect(res).toBe(true);
    expect(countMock).not.toHaveBeenCalled();
  });

  it('pasien dengan jadwal hari ini terdeteksi hasActiveAppointment = true', async () => {
    const now = new Date('2026-09-09T04:00:00Z');
    const booking = new Date('2026-09-09T04:00:00Z'); // 11:00 WIB
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
      id: 'res-active',
      booking_date: booking,
      status: 'pending',
    } as any);
    const res = await patientLifecycleService.getActiveAppointment('cust-retno', 'default-tenant', { now });
    expect(res.hasActive).toBe(true);
    expect((res.reservation as any).id).toBe('res-active');
    const where = vi.mocked(prisma.reservation.findFirst).mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['pending', 'confirmed', 'hold'] });
    expect(new Date(where.booking_date.gte).getTime()).toBe(now.getTime() - 12 * 3600 * 1000);
    expect(new Date(where.booking_date.lte).getTime()).toBe(now.getTime() + 24 * 3600 * 1000);
  });

  it('jadwal di luar jendela tidak dianggap aktif', async () => {
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null);
    const res = await patientLifecycleService.getActiveAppointment('cust-d', 'default-tenant');
    expect(res.hasActive).toBe(false);
    expect(res.reservation).toBeUndefined();
  });

  it('DB offline → default aman (false) tanpa throw', async () => {
    const res = await patientLifecycleService.getPatientClinicalProfile('cust-e', 'default-tenant');
    expect(res).toEqual({
      isNewLead: true,
      isExistingPatient: false,
      hasActiveAppointment: false,
      totalVisits: 0,
      activeReservation: undefined,
    });
  });

  it('getPatientClinicalProfile menggabungkan riwayat + jadwal aktif', async () => {
    stubReservationCount(3);
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({ id: 'res-today', status: 'confirmed' } as any);
    const res = await patientLifecycleService.getPatientClinicalProfile('cust-f', 'default-tenant');
    expect(res.isExistingPatient).toBe(true);
    expect(res.isNewLead).toBe(false);
    expect(res.hasActiveAppointment).toBe(true);
    expect(res.totalVisits).toBe(3);
    expect((res.activeReservation as any).id).toBe('res-today');
  });
});
