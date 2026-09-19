import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import {
  getClinicLocationAsync,
  getClinicLocation,
  DEFAULT_CLINIC_LOCATION,
  __clearClinicLocationCacheForTest,
} from '../../src/config/clinic-location';

/**
 * Adversarial tests untuk lokasi basecamp klinik tenant-aware.
 * Kontrak: DB offline / tenant tanpa override / nilai override invalid → fallback
 * default env (zero behavior change), bukan crash atau nilai rusak.
 */
describe('clinic-location — basecamp tenant-aware (adversarial)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __clearClinicLocationCacheForTest();
  });

  it('1. DB offline → fallback DEFAULT_CLINIC_LOCATION', async () => {
    vi.mocked(prisma.tenant.findUnique).mockRejectedValueOnce({ code: 'P1001', message: 'connect ECONNREFUSED' } as any);
    const loc = await getClinicLocationAsync('tenant-x');
    expect(loc).toEqual(DEFAULT_CLINIC_LOCATION);
  });

  it('2. Tenant tanpa override → default', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({ settings: {} } as any);
    const loc = await getClinicLocationAsync('tenant-y');
    expect(loc).toEqual(DEFAULT_CLINIC_LOCATION);
  });

  it('3. Override valid diterapkan', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      settings: { clinicLocation: { lat: -7.11, lng: 112.61, name: 'Klinik Custom', maxCoverageKm: 40 } },
    } as any);
    const loc = await getClinicLocationAsync('tenant-z');
    expect(loc).toEqual({ lat: -7.11, lng: 112.61, name: 'Klinik Custom', maxCoverageKm: 40 });
  });

  it('4. Override parsial & tidak valid diabaikan field per field', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      settings: { clinicLocation: { lat: 'abc', lng: null, name: '   ', maxCoverageKm: -5 } },
    } as any);
    const loc = await getClinicLocationAsync('tenant-w');
    expect(loc.lat).toBe(DEFAULT_CLINIC_LOCATION.lat);
    expect(loc.lng).toBe(DEFAULT_CLINIC_LOCATION.lng);
    expect(loc.name).toBe(DEFAULT_CLINIC_LOCATION.name);
    expect(loc.maxCoverageKm).toBe(DEFAULT_CLINIC_LOCATION.maxCoverageKm);
  });

  it('5. Nilai string numerik diterima (koersi)', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      settings: { clinicLocation: { lat: '-7.2', lng: '112.8', maxCoverageKm: '25' } },
    } as any);
    const loc = await getClinicLocationAsync('tenant-v');
    expect(loc.lat).toBe(-7.2);
    expect(loc.lng).toBe(112.8);
    expect(loc.maxCoverageKm).toBe(25);
  });

  it('6. Cache: pemanggilan kedua tidak query ulang', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({ settings: {} } as any);
    await getClinicLocationAsync('tenant-cache');
    await getClinicLocationAsync('tenant-cache');
    expect(vi.mocked(prisma.tenant.findUnique).mock.calls.length).toBe(1);
  });

  it('7. Varian sinkron mengembalikan default', () => {
    expect(getClinicLocation()).toEqual(DEFAULT_CLINIC_LOCATION);
  });
});
