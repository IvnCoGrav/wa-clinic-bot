import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getWibHour, isOutsideOperationalHours, clearOperationalHoursCache } from '../../src/config/operational-hours';

/**
 * FASE 4.1 — Jam operasional FLEKSIBEL (keputusan produk user): booking di luar
 * jam TIDAK ditolak, hanya ditandai agar bidan menyanggupi.
 */
describe('FASE 4.1 — jam operasional (fleksibel, penandaan saja)', () => {
  const hours = { startHourWib: 8, endHourWib: 17, isFlexible: true as const };

  beforeEach(() => clearOperationalHoursCache());

  it('getWibHour menghitung jam WIB dengan benar dari UTC', () => {
    // 02:00Z = 09:00 WIB
    expect(getWibHour(new Date('2026-10-04T02:00:00Z'))).toBe(9);
    // 11:00Z = 18:00 WIB
    expect(getWibHour(new Date('2026-10-04T11:00:00Z'))).toBe(18);
    // 16:00Z = 23:00 WIB
    expect(getWibHour(new Date('2026-10-04T16:00:00Z'))).toBe(23);
  });

  it('booking 09:00 WIB → DALAM jam operasional', () => {
    expect(isOutsideOperationalHours(new Date('2026-10-04T02:00:00Z'), hours)).toBe(false);
  });

  it('booking 18:00 WIB (kasus produksi) → DI LUAR jam operasional', () => {
    expect(isOutsideOperationalHours(new Date('2026-10-04T11:00:00Z'), hours)).toBe(true);
  });

  it('booking 07:00 WIB → DI LUAR jam operasional (sebelum buka)', () => {
    expect(isOutsideOperationalHours(new Date('2026-10-04T00:00:00Z'), hours)).toBe(true);
  });

  it('tepat 17:00 WIB → DI LUAR (batas akhir eksklusif)', () => {
    expect(isOutsideOperationalHours(new Date('2026-10-04T10:00:00Z'), hours)).toBe(true);
  });

  it('tanggal null/invalid → tidak ditandai (fail-open, tidak menolak)', () => {
    expect(isOutsideOperationalHours(null, hours)).toBe(false);
    expect(isOutsideOperationalHours(new Date('invalid'), hours)).toBe(false);
  });

  it('CFG-11: getOperationalHours parses diverse time string formats correctly', async () => {
    const { getOperationalHours } = await import('../../src/config/operational-hours');
    const { prisma } = await import('../../src/db/client');

    vi.mocked((prisma as any).tenant.findUnique).mockResolvedValue(null);
    vi.mocked((prisma as any).clinicPolicy.findUnique).mockResolvedValue({
      is_active: true,
      factual_summary: 'Layanan buka jam 09.00 s/d 18.00 WIB setiap hari',
    });

    const parsed = await getOperationalHours('tenant_sd_format');
    expect(parsed.startHourWib).toBe(9);
    expect(parsed.endHourWib).toBe(18);
  });
});
