import { describe, it, expect } from 'vitest';
import {
  ACTIVE_RESERVATION_STATUSES,
  isActiveReservationStatus as canonicalIsActive,
} from '../../src/domain/reservation-status';
import {
  isTreatmentCategoryOverlap,
  isActiveReservationStatus as utilIsActive,
} from '../../src/utils/treatment-category';

/**
 * Kontrak kanonis tunggal "status aktif" (PR unifikasi, tindak lanjut audit #257).
 *
 * Seam yang diuji (public interface, bukan internal):
 *  1. `src/domain/reservation-status.ts` — SATU-SATUNYA rumah definisi "jadwal aktif".
 *  2. `src/utils/treatment-category.ts` — hanya re-export + kontrak overlap kategori.
 *
 * Dua konsep yang SENGAJA dibedakan:
 *  - "Slot aktif" (isActiveReservationStatus): menempati slot → completed/in_progress = false.
 *  - "Penghambat jadwal" (isScheduleBlockingStatus, mirror frontend): catatan same-day
 *    termasuk yang baru selesai → completed/in_progress = true. Diuji via
 *    hasExistingReservationForSchedule di reservation-intake-suppression.test.ts.
 */
describe('kontrak kanonis status aktif — satu sumber kebenaran', () => {
  it('util backend me-re-export kontrak domain (bukan definisi tandingan)', () => {
    const samples = ['confirmed', 'en_route', 'pending', 'hold', 'completed', 'in_progress', 'cancelled', null, undefined];
    for (const s of samples) {
      expect(utilIsActive(s as any)).toBe(canonicalIsActive(s as any));
    }
  });

  it('pencocokan case-insensitive dan toleran spasi (bug: domain peka huruf besar)', () => {
    expect(canonicalIsActive('Confirmed')).toBe(true);
    expect(canonicalIsActive(' EN_ROUTE ')).toBe(true);
    expect(canonicalIsActive('Pending')).toBe(true);
    expect(canonicalIsActive('HOLD')).toBe(true);
    expect(utilIsActive('Confirmed')).toBe(true);
  });

  it('completed / in_progress BUKAN slot aktif (kunci regresi en_route-test)', () => {
    for (const s of ['completed', 'COMPLETED', 'in_progress', 'IN_PROGRESS']) {
      expect(canonicalIsActive(s as any)).toBe(false);
      expect(utilIsActive(s as any)).toBe(false);
    }
    expect(ACTIVE_RESERVATION_STATUSES).not.toContain('completed');
    expect(ACTIVE_RESERVATION_STATUSES).not.toContain('in_progress');
  });

  it('kontrak overlap kategori tetap utuh (BOTH == BUNDLE == MOMS+anak)', () => {
    expect(isTreatmentCategoryOverlap('BOTH', 'BUNDLE')).toBe(true);
    expect(isTreatmentCategoryOverlap('BUNDLE', 'MOMS')).toBe(true);
    expect(isTreatmentCategoryOverlap('BOTH', 'BABY')).toBe(true);
    expect(isTreatmentCategoryOverlap('BABY', 'KIDS')).toBe(true);
    expect(isTreatmentCategoryOverlap('MOMS', 'BABY')).toBe(false);
    expect(isTreatmentCategoryOverlap(null, 'MOMS')).toBe(true);
  });
});
