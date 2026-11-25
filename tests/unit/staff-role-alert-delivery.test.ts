import { describe, it, expect } from 'vitest';
import {
  canReceiveStaffAlert,
  isStaffSupervisorRole,
  isStaffTherapistRole,
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

describe('isStaffTherapistRole', () => {
  it('mengenali peran terapis dan bidan lapangan dalam berbagai variasi format', () => {
    for (const role of [
      'THERAPIST',
      'therapist',
      ' Therapist ',
      'SENIOR_THERAPIST',
      'JUNIOR_THERAPIST',
      'TERAPIS',
      'terapis',
      'Terapis Senior',
      'TERAPIS_SENIOR',
      'BIDAN',
      'bidan',
      ' Bidan ',
      'BIDAN_SENIOR',
      'Bidan Senior',
      'BIDAN_JUNIOR',
    ]) {
      expect(isStaffTherapistRole(role)).toBe(true);
    }
  });

  it('menolak peran non-terapis (admin, supervisor, advertiser) dan nilai kosong', () => {
    for (const role of [
      'ADMIN_CS',
      'admin_cs',
      'SPV_CS',
      'spv_cs',
      'SUPER_ADMIN',
      'TENANT_ADMIN',
      'ADVERTISER',
      'DRIVER',
      '',
      '   ',
      null,
      undefined,
    ]) {
      expect(isStaffTherapistRole(role)).toBe(false);
    }
  });

  it('menolak secara ketat peran semu yang mengandung kata THERAPIST/BIDAN (uji adversarial)', () => {
    for (const role of [
      'NON_THERAPIST',
      'EX_THERAPIST',
      'ADMIN_THERAPIST',
      'THERAPIST_ADMIN',
      'NOT_A_THERAPIST',
      'NON_BIDAN',
      'ADMIN_BIDAN',
    ]) {
      expect(isStaffTherapistRole(role)).toBe(false);
    }
  });

  it('kontrak tertutup: custom role di luar daftar kanonis ditolak sampai didaftarkan sengaja', () => {
    // Perilaku ini disengaja (fail-closed). Bila tenant memakai role baru,
    // tambahkan kuncinya ke CANONICAL_THERAPIST_ROLES + test ini.
    for (const role of [
      'MIDWIFE',
      'BIDAN_SENIOR_2',
      'TERAPIS_2',
      'TERAPIS_LAPANGAN',
      'FIELD_THERAPIST',
    ]) {
      expect(isStaffTherapistRole(role)).toBe(false);
    }
  });
});
