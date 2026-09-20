import { describe, it, expect } from 'vitest';
import {
  normalizeCity,
  uniqueCities,
  filterPointsByCity,
  markerColor,
  isValidLatLng,
  statusOf,
  filterPointsByStatus,
  computeSpatialMetrics,
  locationVisual,
  SpatialStatus,
} from '../../packages/admin-dashboard/src/utils/customerMapUtils';

/**
 * Adversarial tests untuk utilitas peta sebaran pelanggan.
 *
 * Fokus: normalisasi variasi penulisan kota di DB (masalah nyata: "Kota Surabaya",
 * "Kabupaten Sidoarjo", "Gresik Regency" harus dianggap satu kota kanonik) dan
 * ketahanan filter/warna terhadap data kotor.
 */
describe('customerMapUtils — peta sebaran (adversarial)', () => {
  describe('normalizeCity', () => {
    it('memetakan variasi penulisan ke nama kanonik', () => {
      expect(normalizeCity('Kota Surabaya')).toBe('Surabaya');
      expect(normalizeCity('SURABAYA')).toBe('Surabaya');
      expect(normalizeCity('Kabupaten Sidoarjo')).toBe('Sidoarjo');
      expect(normalizeCity('Gresik Regency')).toBe('Gresik');
      expect(normalizeCity('  gresik  ')).toBe('Gresik');
    });

    it('singkatan sby/sda dipetakan ke kota kanonik', () => {
      expect(normalizeCity('sby')).toBe('Surabaya');
      expect(normalizeCity('SBY')).toBe('Surabaya');
      expect(normalizeCity('sda')).toBe('Sidoarjo');
      expect(normalizeCity('Kabupaten sda')).toBe('Sidoarjo');
    });

    it('membuang prefix label & sisa tanda baca', () => {
      expect(normalizeCity('Kota : Surabaya')).toBe('Surabaya');
      expect(normalizeCity('Kabupaten: Sidoarjo')).toBe('Sidoarjo');
      expect(normalizeCity('Surabaya,')).toBe('Surabaya');
    });

    it('kota di luar wilayah layanan dikembalikan apa adanya (prefix administratif dibuang)', () => {
      expect(normalizeCity('Jakarta Selatan')).toBe('Jakarta Selatan');
      expect(normalizeCity('KOTA PADANG')).toBe('PADANG');
      expect(normalizeCity('Kota Padang')).toBe('Padang');
    });

    it('null/undefined/kosong → string kosong', () => {
      expect(normalizeCity(null)).toBe('');
      expect(normalizeCity(undefined)).toBe('');
      expect(normalizeCity('   ')).toBe('');
    });
  });

  describe('uniqueCities', () => {
    it('menggabungkan varian penulisan kota yang sama menjadi satu opsi', () => {
      const cities = uniqueCities([
        { kota: 'Kota Surabaya' },
        { kota: 'Surabaya' },
        { kota: 'Kabupaten Sidoarjo' },
        { kota: 'Gresik Regency' },
        { kota: null },
        { kota: '' },
      ]);
      expect(cities).toEqual(['Gresik', 'Sidoarjo', 'Surabaya']);
    });

    it('daftar kosong → array kosong', () => {
      expect(uniqueCities([])).toEqual([]);
    });
  });

  describe('filterPointsByCity', () => {
    const points = [
      { id: 'a', kota: 'Kota Surabaya' },
      { id: 'b', kota: 'Surabaya' },
      { id: 'c', kota: 'Kabupaten Sidoarjo' },
      { id: 'd', kota: null },
    ];

    it('filter kota kanonik menangkap semua varian penulisan', () => {
      const res = filterPointsByCity(points, 'Surabaya');
      expect(res.map((p) => p.id)).toEqual(['a', 'b']);
    });

    it('filter kosong mengembalikan seluruh titik', () => {
      expect(filterPointsByCity(points, '')).toHaveLength(4);
    });

    it('filter case-insensitive', () => {
      expect(filterPointsByCity(points, 'sidoarjo').map((p) => p.id)).toEqual(['c']);
    });

    it('filter tidak match → array kosong', () => {
      expect(filterPointsByCity(points, 'Bandung')).toEqual([]);
    });
  });

  describe('markerColor', () => {
    it('prioritas: out-of-coverage > sudah-reservasi > mql', () => {
      expect(markerColor({ lat: 0, lng: 0, is_out_of_coverage: true, is_mql: true, has_reservation: true })).toBe('#94a3b8');
      expect(markerColor({ lat: 0, lng: 0, is_mql: true, status: 'blocked' })).toBe('#2563eb');
      expect(markerColor({ lat: 0, lng: 0, status: 'blocked' })).toBe('#2563eb');
      expect(markerColor({ lat: 0, lng: 0, status: 'active' })).toBe('#2563eb');
      expect(markerColor({ lat: 0, lng: 0 })).toBe('#2563eb');
    });

    it('pelanggan MQL yang SUDAH reservasi tampil hijau (bukan biru)', () => {
      expect(markerColor({ lat: 0, lng: 0, is_mql: true, has_reservation: true })).toBe('#008069');
      expect(markerColor({ lat: 0, lng: 0, is_mql: true, has_reservation: true, status: 'active' })).toBe('#008069');
    });

    it('pelanggan sudah reservasi namun status non-aktif tetap hijau (reservasi menang atas status)', () => {
      expect(markerColor({ lat: 0, lng: 0, has_reservation: true, status: 'blocked' })).toBe('#008069');
    });

    it('out-of-coverage tetap menang atas reservasi (perlu perhatian operasional)', () => {
      expect(markerColor({ lat: 0, lng: 0, has_reservation: true, is_out_of_coverage: true })).toBe('#94a3b8');
    });
  });

  describe('isValidLatLng', () => {
    it('menolak non-number, NaN, dan di luar rentang', () => {
      expect(isValidLatLng(-7.3, 112.7)).toBe(true);
      expect(isValidLatLng('abc', 112.7)).toBe(false);
      expect(isValidLatLng(NaN, 112.7)).toBe(false);
      expect(isValidLatLng(200, 112.7)).toBe(false);
      expect(isValidLatLng(-7.3, 999)).toBe(false);
      expect(isValidLatLng(null, 112.7)).toBe(false);
    });
  });

  describe('statusOf & filterPointsByStatus (legenda interaktif)', () => {
    const points = [
      { lat: 0, lng: 0, has_reservation: true },
      { lat: 0, lng: 0, is_mql: true, has_reservation: false },
      { lat: 0, lng: 0, status: 'blocked', has_reservation: false },
      { lat: 0, lng: 0, is_out_of_coverage: true, is_mql: true },
    ];

    it('statusOf menetapkan kategori dengan prioritas tetap', () => {
      expect(statusOf(points[0])).toBe('reserved');
      expect(statusOf(points[1])).toBe('mql');
      expect(statusOf(points[2])).toBe('mql');
      expect(statusOf(points[3])).toBe('out_of_coverage');
    });

    it('MQL yang sudah reservasi dikategorikan "reserved" (legend tetap konsisten dengan warna hijau)', () => {
      expect(statusOf({ lat: 0, lng: 0, is_mql: true, has_reservation: true })).toBe('reserved');
    });

    it('set kosong → seluruh titik dikembalikan (tidak menyembunyikan apa pun)', () => {
      expect(filterPointsByStatus(points, new Set())).toHaveLength(4);
    });

    it('menyembunyikan kategori terpilih', () => {
      const allowed = new Set<SpatialStatus>(['reserved', 'out_of_coverage']);
      const res = filterPointsByStatus(points, allowed);
      expect(res).toHaveLength(2);
      // Titik MQL (indeks 1,2) tersembunyi; reserved + out_of_coverage tetap tampil.
      expect(res.some((p) => statusOf(p) === 'mql')).toBe(false);
      expect(res.filter((p) => statusOf(p) === 'out_of_coverage')).toHaveLength(1);
    });
  });

  describe('locationVisual (pembeda sumber lokasi)', () => {
    it('gps_pin → marker padat, outline putih', () => {
      const v = locationVisual({ lat: 0, lng: 0, location_source: 'gps_pin' });
      expect(v.source).toBe('gps_pin');
      expect(v.borderColor).toBe('#ffffff');
      expect(v.dashArray).toBeUndefined();
      expect(v.fillOpacity).toBeGreaterThan(0.8);
    });

    it('estimated_area → outline putus-putus & fill transparan', () => {
      const v = locationVisual({ lat: 0, lng: 0, location_source: 'estimated_area' });
      expect(v.source).toBe('estimated_area');
      expect(v.dashArray).toBeTruthy();
      expect(v.fillOpacity).toBeLessThan(0.8);
    });

    it('manual_staff → ungu solid pop-out (radius besar, border putih)', () => {
      const v = locationVisual({ lat: 0, lng: 0, location_source: 'manual_staff' });
      expect(v.source).toBe('manual_staff');
      expect(v.borderColor).toBe('#ffffff');
      expect(v.radius).toBe(9);
      expect(v.radius).not.toBe(locationVisual({ lat: 0, lng: 0, location_source: 'gps_pin' }).radius);
      expect(v.fillOpacity).toBe(1);
    });

    it('kompatibilitas data lama: location_source null → turunkan dari is_estimated_centroid', () => {
      expect(locationVisual({ lat: 0, lng: 0, is_estimated_centroid: true }).source).toBe('estimated_area');
      expect(locationVisual({ lat: 0, lng: 0, is_estimated_centroid: false }).source).toBe('gps_pin');
      expect(locationVisual({ lat: 0, lng: 0 }).source).toBe('gps_pin');
    });

    it('nilai location_source tak dikenal → fallback aman (tidak crash)', () => {
      const v = locationVisual({ lat: 0, lng: 0, location_source: 'bogus' as any });
      expect(['gps_pin', 'estimated_area', 'manual_staff']).toContain(v.source);
    });
  });

  describe('computeSpatialMetrics (KPI spasial)', () => {    it('menghitung total, presisi/estimasi, coverage %, rata-rata jarak, top kecamatan', () => {
      const m = computeSpatialMetrics([
        { lat: 0, lng: 0, kecamatan: 'Waru', distance_km: 4, is_out_of_coverage: false },
        { lat: 0, lng: 0, kecamatan: 'Waru', distance_km: 6, is_out_of_coverage: false },
        { lat: 0, lng: 0, kecamatan: 'Rungkut', distance_km: 20, is_out_of_coverage: true },
        { lat: 0, lng: 0, kecamatan: 'Rungkut', distance_km: null as any, is_out_of_coverage: false, is_estimated_centroid: true },
      ]);
      expect(m.totalPoints).toBe(4);
      expect(m.preciseCount).toBe(3);
      expect(m.estimatedCount).toBe(1);
      expect(m.inCoverageCount).toBe(3);
      expect(m.outOfCoverageCount).toBe(1);
      expect(m.inCoveragePercent).toBe(75);
      expect(m.averageDistanceKm).toBe(10); // (4+6+20)/3
      expect(m.topKecamatan[0]).toEqual({ name: 'Rungkut', count: 2 });
      expect(m.topKecamatan).toHaveLength(2);
    });

    it('data kosong → tidak crash, nilai nol/null', () => {
      const m = computeSpatialMetrics([]);
      expect(m.totalPoints).toBe(0);
      expect(m.inCoveragePercent).toBe(0);
      expect(m.averageDistanceKm).toBeNull();
      expect(m.topKecamatan).toEqual([]);
    });

    it('jarak non-finite diabaikan dari rata-rata', () => {
      const m = computeSpatialMetrics([
        { lat: 0, lng: 0, distance_km: NaN as any },
        { lat: 0, lng: 0, distance_km: 12 },
      ]);
      expect(m.averageDistanceKm).toBe(12);
    });
  });
});
