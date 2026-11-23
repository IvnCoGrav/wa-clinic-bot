import { describe, it, expect } from 'vitest';
import {
  canReceiveStaffAlert,
  isStaffSupervisorRole,
} from '../../src/domain/staff-role';

/**
 * Gerbang isolasi alert staf (anti-leak lintas-terapis).
 * Kasus kunci: reservasi tanpa bidan (`alertStaffId` null) TIDAK boleh
 * disiarkan ke terapis non-supervisor.
 */
describe('canReceiveStaffAlert', () => {
  it('supervisor menerima semua alert, termasuk yang belum ditugaskan', () => {
    expect(
      canReceiveStaffAlert({ isSupervisor: true, staffId: 'staff-a', alertStaffId: null })
    ).toBe(true);
    expect(
      canReceiveStaffAlert({ isSupervisor: true, staffId: 'staff-a', alertStaffId: 'staff-b' })
    ).toBe(true);
  });

  it('terapis menerima alert miliknya sendiri', () => {
    expect(
      canReceiveStaffAlert({ isSupervisor: false, staffId: 'staff-a', alertStaffId: 'staff-a' })
    ).toBe(true);
  });

  it('terapis TIDAK menerima alert milik terapis lain', () => {
    expect(
      canReceiveStaffAlert({ isSupervisor: false, staffId: 'staff-a', alertStaffId: 'staff-b' })
    ).toBe(false);
  });

  it('terapis TIDAK menerima alert tanpa pemilik (reservasi belum ditugaskan)', () => {
    expect(
      canReceiveStaffAlert({ isSupervisor: false, staffId: 'staff-a', alertStaffId: null })
    ).toBe(false);
    expect(
      canReceiveStaffAlert({ isSupervisor: false, staffId: 'staff-a', alertStaffId: '' })
    ).toBe(false);
  });

  it('fail-closed bila staffId sesi kosong', () => {
    expect(
      canReceiveStaffAlert({ isSupervisor: false, staffId: '', alertStaffId: 'staff-a' })
    ).toBe(false);
  });
});

describe('isStaffSupervisorRole', () => {
  it('mengenali peran supervisor yang sah dan menolak terapis', () => {
    for (const role of ['SPV_CS', 'super_admin', 'tenant_admin', 'ADMIN_CS', 'admin']) {
      expect(isStaffSupervisorRole(role)).toBe(true);
    }
    expect(isStaffSupervisorRole('THERAPIST')).toBe(false);
    expect(isStaffSupervisorRole(null)).toBe(false);
  });
});
