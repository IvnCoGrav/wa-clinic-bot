import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { __clearClinicLocationCacheForTest } from '../../src/config/clinic-location';

const ADMIN_KEY = 'test_admin_key_map_points';

/**
 * Adversarial tests untuk GET /api/admin/customers/map-points.
 *
 * Endpoint melakukan tiga query berurutan:
 *   1. customer.findMany → pelanggan dengan koordinat presisi
 *   2. customer.findMany → pelanggan lat NULL (kandidat sentroid)
 *   3. tenant.findUnique  → override clinicLocation per-tenant
 *
 * Kontrak yang dipin:
 *  - Hanya titik berkoordinat valid yang lolos.
 *  - Filter default fokus wilayah layanan (toleran sby/sda/bbox/radius).
 *  - Sandbox test SELALU dikecualikan.
 *  - Sentroid hanya untuk wilayah valid; data kotor ("Kota :") dilewati.
 *  - Metadata clinic dikembalikan (tenant-aware).
 *  - DB error → 500, bukan crash.
 */
describe('GET /api/admin/customers/map-points — sebaran peta (adversarial)', () => {
  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    vi.restoreAllMocks();
    __clearClinicLocationCacheForTest();
  });

  /** Mock 3 query berurutan: koordinat, sentroid (NULL), tenant. */
  function mockQueries(coords: any[], nullRows: any[] = [], tenantSettings: any = null) {
    vi.mocked(prisma.customer.findMany)
      .mockResolvedValueOnce(coords as any)
      .mockResolvedValueOnce(nullRows as any);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce(
      (tenantSettings ? { settings: tenantSettings } : { settings: null }) as any
    );
  }

  async function getMap(query = '') {
    const app = buildApp();
    return app.inject({
      method: 'GET',
      url: `/api/admin/customers/map-points${query}`,
      headers: { 'x-api-key': ADMIN_KEY },
    });
  }

  it('1. Mengembalikan titik valid dan membuang koordinat invalid / di luar rentang', async () => {
    mockQueries([
      { id: 'c1', name: 'Valid', phone: '6281', lat: -7.35, lng: 112.75, kota: 'Surabaya', kecamatan: 'Wonokromo', kelurahan: 'X', status: 'active', is_mql: false, is_out_of_coverage: false, distance_km: 3.2, reservations: [{ id: 'r1' }] },
      { id: 'c2', name: 'LatNull', phone: '6282', lat: null, lng: 112.75, kota: 'Sidoarjo', kecamatan: '-', kelurahan: '-', status: 'active', is_mql: false, is_out_of_coverage: false, distance_km: null },
      { id: 'c3', name: 'LngOutOfRange', phone: '6283', lat: -7.3, lng: 999, kota: 'Gresik', kecamatan: '-', kelurahan: '-', status: 'active', is_mql: false, is_out_of_coverage: false, distance_km: null },
      { id: 'c4', name: 'LatOutOfRange', phone: '6284', lat: 200, lng: 112.7, kota: 'Gresik', kecamatan: '-', kelurahan: '-', status: 'active', is_mql: false, is_out_of_coverage: false, distance_km: null },
      { id: 'c5', name: 'NonNumeric', phone: '6285', lat: 'abc' as any, lng: 112.7, kota: 'Surabaya', kecamatan: '-', kelurahan: '-', status: 'active', is_mql: false, is_out_of_coverage: false, distance_km: null },
    ]);

    const res = await getMap();
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.points).toHaveLength(1);
    expect(body.points[0].id).toBe('c1');
    expect(body.points[0].is_estimated_centroid).toBe(false);
  });

  it('2. Query koordinat selalu membatasi tenant, exclude sandbox, dan lat/lng NOT NULL', async () => {
    mockQueries([]);
    await getMap();

    const arg = vi.mocked(prisma.customer.findMany).mock.calls[0][0] as any;
    expect(arg.where.tenant_id).toBe(DEFAULT_TENANT_ID);
    expect(arg.where.is_sandbox_test).toBe(false);
    expect(arg.where.lat).toEqual({ not: null });
    expect(arg.where.lng).toEqual({ not: null });
  });

  it('3. Filter ?kota= diteruskan sebagai contains case-insensitive', async () => {
    mockQueries([]);
    await getMap('?kota=surabaya');
    const arg = vi.mocked(prisma.customer.findMany).mock.calls[0][0] as any;
    expect(arg.where.kota).toEqual({ contains: 'surabaya', mode: 'insensitive' });
  });

  it('4. Default fokus 3 kota + variasi penulisan + toleransi "sby"/radius/bbox', async () => {
    mockQueries([
      { id: 'v1', name: 'Sby', phone: '1', lat: -7.3, lng: 112.7, kota: 'Kota Surabaya', kecamatan: '-', kelurahan: '-', status: 'active', is_mql: false, is_out_of_coverage: false, distance_km: 1, reservations: [{ id: 'r1' }] },
      { id: 'v2', name: 'Sda', phone: '2', lat: -7.4, lng: 112.7, kota: 'Kabupaten Sidoarjo', kecamatan: '-', kelurahan: '-', status: 'active', is_mql: false, is_out_of_coverage: false, distance_km: 1, reservations: [{ id: 'r2' }] },
      { id: 'v3', name: 'Gsk', phone: '3', lat: -7.1, lng: 112.6, kota: 'Gresik Regency', kecamatan: '-', kelurahan: '-', status: 'active', is_mql: false, is_out_of_coverage: false, distance_km: 1, reservations: [{ id: 'r3' }] },
      { id: 'v4', name: 'SbySingkat', phone: '4', lat: -7.3, lng: 112.7, kota: 'sby', kecamatan: '-', kelurahan: '-', status: 'active', is_mql: false, is_out_of_coverage: false, distance_km: 1, reservations: [{ id: 'r4' }] },
      { id: 'v5', name: 'Jakarta', phone: '5', lat: -6.2, lng: 106.8, kota: 'Jakarta Selatan', kecamatan: '-', kelurahan: '-', status: 'active', is_mql: false, is_out_of_coverage: false, distance_km: null },
      { id: 'v6', name: 'RadiusOnly', phone: '6', lat: -7.9, lng: 112.9, kota: 'Mojokerto', kecamatan: '-', kelurahan: '-', status: 'active', is_mql: false, is_out_of_coverage: false, distance_km: 20, reservations: [{ id: 'r6' }] },
      { id: 'v7', name: 'KosongKota', phone: '7', lat: -7.3, lng: 112.7, kota: null, kecamatan: null, kelurahan: null, status: 'active', is_mql: false, is_out_of_coverage: false, distance_km: null, reservations: [{ id: 'r7' }] },
    ]);

    const res = await getMap();
    const body = JSON.parse(res.body);
    const ids = body.points.map((p: any) => p.id).sort();
    // v1,v2,v3 (kota), v4 (sby), v6 (radius 20km) lolos. v5 (Jakarta) & v7 (bbox -7.3,112.7 → lolos bbox!) 
    // v7 berada di bbox Surabaya Raya → lolos. v5 di luar semua kriteria → dibuang.
    expect(ids).toEqual(['v1', 'v2', 'v3', 'v4', 'v6', 'v7']);
  });

  it('5. ?scope=all menampilkan seluruh titik tanpa batas wilayah', async () => {
    mockQueries([
      { id: 'v1', name: 'Sby', phone: '1', lat: -7.3, lng: 112.7, kota: 'Kota Surabaya', kecamatan: '-', kelurahan: '-', status: 'active', is_mql: false, is_out_of_coverage: false, distance_km: 1, reservations: [{ id: 'r1' }] },
      { id: 'v5', name: 'Jakarta', phone: '5', lat: -6.2, lng: 106.8, kota: 'Jakarta Selatan', kecamatan: '-', kelurahan: '-', status: 'active', is_mql: false, is_out_of_coverage: false, distance_km: 1, reservations: [{ id: 'r5' }] },
    ]);
    const res = await getMap('?scope=all');
    const body = JSON.parse(res.body);
    expect(body.total).toBe(2);
  });

  it('6. Sentroid: pelanggan tanpa koordinat + wilayah valid → titik estimasi', async () => {
    mockQueries(
      [],
      [
        { id: 's1', name: 'Sentroid', phone: '99', kota: 'Surabaya', kecamatan: 'Wonokromo', kelurahan: 'Darmo', status: 'active', is_mql: false, is_out_of_coverage: false, distance_km: null, reservations: [{ id: 'r1' }] },
      ]
    );
    const res = await getMap();
    const body = JSON.parse(res.body);
    expect(body.points).toHaveLength(1);
    expect(body.points[0].id).toBe('s1');
    expect(body.points[0].is_estimated_centroid).toBe(true);
    expect(typeof body.points[0].lat).toBe('number');
    expect(typeof body.points[0].lng).toBe('number');
  });

  it('7. Sentroid: data kotor (kecamatan "Kota :", kota nomor HP) dilewati', async () => {
    mockQueries(
      [],
      [
        { id: 'dirty1', name: 'Dirty', phone: '1', kota: 'No. Hp : 087852674363', kecamatan: 'Kota :', kelurahan: null, status: 'active', is_mql: false, is_out_of_coverage: false, distance_km: null },
        { id: 'dirty2', name: 'NumericOnly', phone: '2', kota: '', kecamatan: '12345', kelurahan: null, status: 'active', is_mql: false, is_out_of_coverage: false, distance_km: null },
      ]
    );
    const res = await getMap();
    const body = JSON.parse(res.body);
    expect(body.points).toHaveLength(0);
  });

  it('8. includeCentroids=false → query sentroid tidak dijalankan', async () => {
    mockQueries([], [{ id: 's1', name: 'Sentroid', phone: '99', kota: 'Surabaya', kecamatan: 'Wonokromo', kelurahan: 'Darmo', status: 'active', is_mql: false, is_out_of_coverage: false, distance_km: null }]);
    const res = await getMap('?includeCentroids=false');
    const body = JSON.parse(res.body);
    expect(body.points).toHaveLength(0);
    // Hanya 1 kali findMany (coords), bukan 2.
    expect(vi.mocked(prisma.customer.findMany).mock.calls.length).toBe(1);
  });

  it('9. Metadata clinic dikembalikan (fallback default saat tenant tanpa override)', async () => {
    mockQueries([]);
    const res = await getMap();
    const body = JSON.parse(res.body);
    expect(body.clinic).toMatchObject({
      lat: expect.any(Number),
      lng: expect.any(Number),
      name: expect.any(String),
      maxCoverageKm: expect.any(Number),
      rings: expect.any(Array),
    });
    expect(body.clinic.rings).toHaveLength(3);
  });

  it('10. Override clinicLocation per-tenant diterapkan', async () => {
    mockQueries([], [], { clinicLocation: { lat: -7.11, lng: 112.61, name: 'Klinik Custom', maxCoverageKm: 40 } });
    const res = await getMap();
    const body = JSON.parse(res.body);
    expect(body.clinic).toMatchObject({ lat: -7.11, lng: 112.61, name: 'Klinik Custom', maxCoverageKm: 40 });
  });

  it('11. DB error pada query koordinat → 500 { success:false }', async () => {
    vi.mocked(prisma.customer.findMany).mockRejectedValueOnce(new Error('Database offline'));
    const res = await getMap();
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
  });

  it('12. Tanpa auth → 401', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/customers/map-points' });
    expect(res.statusCode).toBe(401);
  });

  it('13. Opsi 1: Aktif murni tanpa reservasi & tanpa MQL tidak ditampilkan', async () => {
    mockQueries([
      { id: 'aktifMurni', name: 'AktifMurni', phone: '1', lat: -7.3, lng: 112.7, kota: 'Surabaya', kecamatan: 'Wonokromo', kelurahan: 'X', status: 'active', is_mql: false, is_out_of_coverage: false, distance_km: 2, reservations: [] },
      { id: 'sudahTreatment', name: 'SudahTreatment', phone: '2', lat: -7.3, lng: 112.7, kota: 'Surabaya', kecamatan: 'Wonokromo', kelurahan: 'X', status: 'active', is_mql: false, is_out_of_coverage: false, distance_km: 2, reservations: [{ id: 'r1' }] },
      { id: 'mqlTanpaTreatment', name: 'Mql', phone: '3', lat: -7.3, lng: 112.7, kota: 'Surabaya', kecamatan: 'Wonokromo', kelurahan: 'X', status: 'active', is_mql: true, is_out_of_coverage: false, distance_km: 2, reservations: [] },
    ]);
    const res = await getMap();
    const body = JSON.parse(res.body);
    const ids = body.points.map((p: any) => p.id).sort();
    expect(ids).toEqual(['mqlTanpaTreatment', 'sudahTreatment']);
    expect(ids).not.toContain('aktifMurni');
  });
});
