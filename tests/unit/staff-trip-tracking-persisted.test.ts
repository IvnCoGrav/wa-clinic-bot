import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { staffTripTrackingService, TRIP_PING_TTL_SEC } from '../../src/services/staff-trip-tracking.service';
import { distributedKv } from '../../src/utils/distributed-kv';

/**
 * S-03 — store trip lintas proses.
 *
 * Masalah lama: `recordTripPing` hanya menulis Map memori proses `app`,
 * sedangkan sweep auto-close berjalan di `worker` → sesi tidak pernah
 * ditutup otomatis di produksi.
 *
 * Kontrak baru: setiap ping di-write-through ke KV bersama (Redis, fallback
 * memori), dan sweep memakai `listActiveTripsAcrossProcesses()` yang
 * menggabungkan store lokal + KV.
 */

const TENANTS_KEY = 'staff:trip:tenants';
const tenantA = 'tenant-trip-a';
const tenantB = 'tenant-trip-b';

function ping(lat = -7.31, lng = 112.71) {
  return { lat, lng, accuracy: 12, speed: 6, heading: 90 };
}

beforeEach(async () => {
  await staffTripTrackingService.clearAllPersisted();
});

afterEach(async () => {
  await staffTripTrackingService.clearAllPersisted();
});

describe('write-through ping ke KV bersama', () => {
  it('recordTripPing menyimpan record + index tenant di KV', async () => {
    staffTripTrackingService.recordTripPing(tenantA, 'res-1', 'staff-1', ping());

    // Persistensi bersifat fire-and-forget; beri satu microtask tick.
    await new Promise((r) => setTimeout(r, 0));

    const raw = await distributedKv.get(staffTripTrackingService.redisKey(tenantA, 'res-1'));
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed).toMatchObject({ tenantId: tenantA, reservationId: 'res-1', staffId: 'staff-1' });

    expect(await distributedKv.smembers(`staff:trip:index:${tenantA}`)).toContain('res-1');
    expect(await distributedKv.smembers(TENANTS_KEY)).toContain(tenantA);
  });

  it('record terbaru menimpa record lama (ping berurutan)', async () => {
    staffTripTrackingService.recordTripPing(tenantA, 'res-1', 'staff-1', ping(-7.31, 112.71));
    await new Promise((r) => setTimeout(r, 0));
    staffTripTrackingService.recordTripPing(tenantA, 'res-1', 'staff-1', ping(-7.32, 112.72));
    await new Promise((r) => setTimeout(r, 0));

    const raw = await distributedKv.get(staffTripTrackingService.redisKey(tenantA, 'res-1'));
    const parsed = JSON.parse(raw as string);
    expect(parsed.lat).toBe(-7.32);
    expect(parsed.lng).toBe(112.72);
  });
});

describe('listActiveTripsAcrossProcesses', () => {
  it('tetap melihat sesi setelah store memori proses dikosongkan', async () => {
    staffTripTrackingService.recordTripPing(tenantA, 'res-1', 'staff-1', ping());
    await new Promise((r) => setTimeout(r, 0));

    // Simulasi proses lain: memori lokal kosong, KV tetap.
    staffTripTrackingService.clearAll();
    expect(staffTripTrackingService.listActiveTrips()).toHaveLength(0);

    const across = await staffTripTrackingService.listActiveTripsAcrossProcesses();
    expect(across.map((r) => r.reservationId)).toContain('res-1');
  });

  it('tenant-scoped: tidak membocorkan sesi tenant lain', async () => {
    staffTripTrackingService.recordTripPing(tenantA, 'res-a', 'staff-1', ping());
    staffTripTrackingService.recordTripPing(tenantB, 'res-b', 'staff-2', ping());
    await new Promise((r) => setTimeout(r, 0));
    staffTripTrackingService.clearAll();

    const onlyA = await staffTripTrackingService.listActiveTripsAcrossProcesses(tenantA);
    expect(onlyA.map((r) => r.reservationId)).toEqual(['res-a']);
    expect(onlyA.every((r) => r.tenantId === tenantA)).toBe(true);

    const all = await staffTripTrackingService.listActiveTripsAcrossProcesses();
    expect(all.map((r) => r.reservationId).sort()).toEqual(['res-a', 'res-b']);
  });

  it('record kedaluwarsa (lewat TTL) tidak dikembalikan', async () => {
    const stale = {
      tenantId: tenantA,
      reservationId: 'res-stale',
      staffId: 'staff-1',
      lat: -7.3,
      lng: 112.7,
      speed: null,
      heading: null,
      accuracy: 10,
      areaName: 'Test',
      createdAt: Date.now() - (TRIP_PING_TTL_SEC + 60) * 1000,
      updatedAt: Date.now() - (TRIP_PING_TTL_SEC + 60) * 1000,
      movedAt: Date.now() - (TRIP_PING_TTL_SEC + 60) * 1000,
      arrivalStreak: 0,
      delayLevel: 'none',
      originSource: 'gps',
    };
    const ttl = 60 * 60 * 1000;
    await distributedKv.set(`staff:trip:${tenantA}:res-stale`, JSON.stringify(stale), ttl);
    await distributedKv.sadd(`staff:trip:index:${tenantA}`, 'res-stale', ttl);
    await distributedKv.sadd(TENANTS_KEY, tenantA, ttl);

    const across = await staffTripTrackingService.listActiveTripsAcrossProcesses(tenantA);
    expect(across.map((r) => r.reservationId)).not.toContain('res-stale');
  });

  it('item KV rusak diabaikan tanpa melempar', async () => {
    await distributedKv.set(`staff:trip:${tenantA}:res-rusak`, '{bukan-json', 60_000);
    await distributedKv.sadd(`staff:trip:index:${tenantA}`, 'res-rusak', 60_000);
    await distributedKv.sadd(TENANTS_KEY, tenantA, 60_000);

    await expect(staffTripTrackingService.listActiveTripsAcrossProcesses(tenantA)).resolves.toEqual([]);
  });
});

describe('clearTrip & clearAllPersisted', () => {
  it('clearTrip menghapus record dan index KV', async () => {
    staffTripTrackingService.recordTripPing(tenantA, 'res-1', 'staff-1', ping());
    await new Promise((r) => setTimeout(r, 0));

    expect(staffTripTrackingService.clearTrip(tenantA, 'res-1')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));

    expect(await distributedKv.get(staffTripTrackingService.redisKey(tenantA, 'res-1'))).toBeNull();
    expect(await distributedKv.smembers(`staff:trip:index:${tenantA}`)).not.toContain('res-1');
    staffTripTrackingService.clearAll();
    expect(await staffTripTrackingService.listActiveTripsAcrossProcesses()).toHaveLength(0);
  });

  it('clearAllPersisted membersihkan seluruh tenant', async () => {
    staffTripTrackingService.recordTripPing(tenantA, 'res-a', 'staff-1', ping());
    staffTripTrackingService.recordTripPing(tenantB, 'res-b', 'staff-2', ping());
    await new Promise((r) => setTimeout(r, 0));

    await staffTripTrackingService.clearAllPersisted();

    expect(await distributedKv.smembers(TENANTS_KEY)).not.toContain(tenantA);
    expect(await staffTripTrackingService.listActiveTripsAcrossProcesses()).toHaveLength(0);
  });
});
