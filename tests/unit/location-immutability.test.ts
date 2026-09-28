import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { customerService } from '../../src/services/customer.service';
import { buildAddressText, resolveLocationSource } from '../../src/services/staff-reservation.service';
import { getGazetteerCoordinates } from '../../src/utils/gazetteer';
import { geocodingService } from '../../src/integrations/google-maps/geocoding';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Jaminan Akurasi Koordinat & Presisi Navigasi Terapis (insiden Terapis Tersasar).
 *
 * Prinsip (fondasional, bukan tambal-sulam):
 *   1. Koordinat PRESISI (pin GPS / shareloc / link Maps ber-koordinat →
 *      location_source 'gps_pin' ATAU share_location_sent=true) HARAM ditimpa
 *      oleh hasil geocoding teks / sentroid gazetteer.
 *   2. Estimasi wilayah (estimated_area) TETAP boleh dikoreksi oleh data lebih baik.
 *   3. Override presisi hanya sah lewat input eksplisit: isNativePin,
 *      locationSource gps_pin, atau forceUpdateGps (tombol "pindah rumah").
 *   4. Alamat jalan/perumahan TIDAK BOLEH jadi kolom kelurahan; nama desa tidak
 *      boleh difabrikasi dari sentroid kecamatan.
 *
 * Test adversarial multi-varian (bukan hafalan satu kalimat), berjalan OFFLINE
 * (memory fallback — tanpa DB/network).
 */
const TENANT = DEFAULT_TENANT_ID;

let phoneSeq = 0;
const nextPhone = (): string => `6281${Date.now().toString().slice(-6)}${(phoneSeq++).toString().padStart(2, '0')}`;

async function seedCustomer(overrides: Record<string, any> = {}): Promise<any> {
  const c: any = await customerService.getOrCreateCustomer(nextPhone(), 'Bunda Audit', TENANT);
  Object.assign(c, overrides);
  const mem = customerService.getMemoryCustomers();
  mem.set(c.phone, c);
  mem.set(c.id, c);
  return c;
}

describe('Fase 1 — GPS Immutability Guard (updateCustomerLocation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.customer.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.customer.update).mockRejectedValue(new Error('Database offline'));
  });

  it('pin presisi (location_source=gps_pin, share_sent=false) TIDAK tertimpa update teks', async () => {
    const c = await seedCustomer({
      lat: -7.4,
      lng: 112.7,
      distance_km: 10,
      ongkir: 15000,
      location_source: 'gps_pin',
      share_location_sent: false,
    });

    const out: any = await customerService.updateCustomerLocation(
      c.id,
      { kelurahan: 'Buduran', kecamatan: 'Buduran', lat: -7.38, lng: 112.72, distanceKm: 8, ongkir: 20000 },
      TENANT,
    );

    expect(out.lat).toBeCloseTo(-7.4, 6);
    expect(out.lng).toBeCloseTo(112.7, 6);
    expect(out.distance_km).toBe(10);
    expect(out.ongkir).toBe(15000);
    // teks wilayah tetap boleh diperbarui
    expect(out.kelurahan).toBe('Buduran');
  });

  it('shareloc native (share_location_sent=true) tetap terkunci untuk berbagai parafrase teks', async () => {
    const variants = [
      'Buduran',
      'Perum Banjarmukti Blok G-6A, Buduran',
      'sidoarjo buduran dekat masjid',
    ];
    for (const kel of variants) {
      const c = await seedCustomer({
        lat: -7.45,
        lng: 112.75,
        distance_km: 12,
        ongkir: 18000,
        location_source: 'gps_pin',
        share_location_sent: true,
      });
      const out: any = await customerService.updateCustomerLocation(
        c.id,
        { kelurahan: kel, lat: -7.3, lng: 112.6, distanceKm: 3, ongkir: 10000 },
        TENANT,
      );
      expect(out.lat).toBeCloseTo(-7.45, 6);
      expect(out.lng).toBeCloseTo(112.75, 6);
      expect(out.distance_km).toBe(12);
    }
  });

  it('estimasi wilayah (estimated_area) BOLEH dikoreksi oleh koordinat lebih baik', async () => {
    const c = await seedCustomer({
      lat: -7.43,
      lng: 112.71,
      distance_km: 11,
      ongkir: 15000,
      location_source: 'estimated_area',
      share_location_sent: false,
    });

    const out: any = await customerService.updateCustomerLocation(
      c.id,
      { lat: -7.44, lng: 112.72, distanceKm: 11.5, ongkir: 15000 },
      TENANT,
    );

    expect(out.lat).toBeCloseTo(-7.44, 6);
    expect(out.lng).toBeCloseTo(112.72, 6);
    expect(out.distance_km).toBe(11.5);
  });

  it('pin GPS baru (isNativePin) boleh meng-override pin presisi lama + menandai share_location_sent', async () => {
    const c = await seedCustomer({
      lat: -7.4,
      lng: 112.7,
      distance_km: 10,
      ongkir: 15000,
      location_source: 'gps_pin',
      share_location_sent: true,
    });

    const out: any = await customerService.updateCustomerLocation(
      c.id,
      { lat: -7.5, lng: 112.8, distanceKm: 14, ongkir: 20000, isNativePin: true },
      TENANT,
    );

    expect(out.lat).toBeCloseTo(-7.5, 6);
    expect(out.lng).toBeCloseTo(112.8, 6);
    expect(out.share_location_sent).toBe(true);
  });

  it('override eksplisit forceUpdateGps (pindah rumah) boleh menimpa pin presisi', async () => {
    const c = await seedCustomer({
      lat: -7.4,
      lng: 112.7,
      distance_km: 10,
      ongkir: 15000,
      location_source: 'gps_pin',
      share_location_sent: true,
    });

    const out: any = await customerService.updateCustomerLocation(
      c.id,
      { lat: -7.6, lng: 112.9, distanceKm: 25, ongkir: 30000, forceUpdateGps: true } as any,
      TENANT,
    );

    expect(out.lat).toBeCloseTo(-7.6, 6);
    expect(out.lng).toBeCloseTo(112.9, 6);
  });
});

describe('Fase 1 — promotePendingLocation tidak mendegradasi pin presisi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockRejectedValue(new Error('Database offline'));
  });

  it('promosi pending TIDAK menimpa koordinat presisi yang sudah ada', async () => {
    const c = await seedCustomer({
      lat: -7.4,
      lng: 112.7,
      distance_km: 10,
      ongkir: 15000,
      location_source: 'gps_pin',
      share_location_sent: true,
    });

    const calc = vi.fn().mockResolvedValue({ distanceKm: 2, ongkir: 8000, isOutOfCoverage: false });
    const res = await customerService.promotePendingLocation(
      c.id,
      {
        pending_kelurahan: 'Buduran',
        pending_kecamatan: 'Buduran',
        pending_kota: 'Kabupaten Sidoarjo',
        pending_lat: -7.3,
        pending_lng: 112.6,
        pending_zipcode: '61252',
      },
      calc,
      TENANT,
    );

    expect(res.success).toBe(true);
    expect(c.lat).toBeCloseTo(-7.4, 6);
    expect(c.lng).toBeCloseTo(112.7, 6);
    expect(c.distance_km).toBe(10);
  });
});

describe('Fase 1 — updateCustomer (edit admin) tidak meng-geocode-ulang pin presisi', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ubah komponen teks pada customer presisi TIDAK memicu geocode yang menimpa lat/lng', async () => {
    const c = await seedCustomer({
      lat: -7.4,
      lng: 112.7,
      distance_km: 10,
      ongkir: 15000,
      location_source: 'gps_pin',
      share_location_sent: true,
    });
    // DB utama "sukses" agar blok auto-recalc berpotensi berjalan
    vi.mocked(prisma.customer.update).mockResolvedValue({ id: c.id } as any);
    const spy = vi.spyOn(geocodingService, 'geocodeText');

    await customerService.updateCustomer(c.id, { kelurahan: 'Buduran' }, TENANT);

    expect(spy).not.toHaveBeenCalled();
    expect(c.lat).toBeCloseTo(-7.4, 6);
    expect(c.lng).toBeCloseTo(112.7, 6);
  });
});

describe('Fase 2 — buildAddressText memuat nama perumahan/blok', () => {
  it('menyertakan preferences.address + hierarki wilayah', () => {
    const text = buildAddressText({
      kelurahan: 'Banjarsari',
      kecamatan: 'Buduran',
      kota: 'Kabupaten Sidoarjo',
      preferences: { address: 'Perum Banjarmukti Residence Blok G-6A' },
    });
    expect(text).toContain('Perum Banjarmukti Residence Blok G-6A');
    expect(text).toContain('Kel. Banjarsari');
    expect(text).toContain('Kec. Buduran');
  });

  it('data lama yang mencemari kolom kelurahan dengan alamat tidak diduplikasi', () => {
    const text = buildAddressText({
      kelurahan: 'Perum Banjarmukti Blok G-6A',
      kecamatan: 'Buduran',
      kota: 'Kabupaten Sidoarjo',
      preferences: { address: 'Perum Banjarmukti Blok G-6A' },
    });
    // hanya satu kemunculan teks alamat
    expect(text.split('Perum Banjarmukti Blok G-6A').length - 1).toBe(1);
  });

  it('tanpa alamat detail tetap fallback ke wilayah', () => {
    const text = buildAddressText({ kelurahan: 'Buduran', kecamatan: 'Buduran', kota: 'Sidoarjo' });
    expect(text).toContain('Kel. Buduran');
  });
});

describe('Fase 3 — resolveLocationSource (badge akurasi, konsisten untuk data lama)', () => {
  it('kolom location_source menang bila terisi', () => {
    expect(resolveLocationSource({ location_source: 'gps_pin', preferences: { source: 'geocoding' } })).toBe('gps_pin');
    expect(resolveLocationSource({ location_source: 'estimated_area' })).toBe('estimated_area');
    expect(resolveLocationSource({ location_source: 'manual_staff' })).toBe('manual_staff');
  });

  it('fallback ke preferences untuk data lama (kolom null)', () => {
    expect(resolveLocationSource({ location_source: null, preferences: { location_source: 'customer_shareloc' } })).toBe('gps_pin');
    expect(resolveLocationSource({ location_source: null, preferences: { source: 'geocoding' } })).toBe('estimated_area');
    expect(resolveLocationSource({ location_source: null, preferences: { source: 'url_text_geocoded' } })).toBe('estimated_area');
    expect(resolveLocationSource({ location_source: null, preferences: { location_updated_by_staff_name: 'Admin CS' } })).toBe('manual_staff');
  });

  it('share_location_sent + koordinat → gps_pin; tanpa bukti → null (netral, bukan presisi palsu)', () => {
    expect(resolveLocationSource({ location_source: null, preferences: {}, share_location_sent: true, lat: -7.4, lng: 112.7 })).toBe('gps_pin');
    expect(resolveLocationSource({ location_source: null, preferences: {} })).toBeNull();
  });
});

describe('Fase 4 — Gazetteer tidak mengarang desa yang tidak disebut', () => {  it('alamat perumahan + kecamatan tidak menghasilkan desa tetangga yang salah', () => {
    const queries = [
      'banjarmukti residence blok G-6A, buduran',
      'perum banjarmukti blok g6a buduran',
      'Banjarmukti Residence, Buduran, Sidoarjo',
    ];
    for (const q of queries) {
      const hit = getGazetteerCoordinates(q);
      // HARAM mencocokkan ke desa yang tidak disebut (mis. Banjarkemantren)
      expect(hit?.kelurahan).not.toBe('Banjarkemantren');
      // bila ter-resolve, kota/kecamatan harus sesuai konteks (Buduran)
      if (hit) expect(hit.kecamatan).toBe('Buduran');
    }
  });

  it('kecamatan + perumahan → tetap tidak mengembalikan desa salah (sentroid tidak menimpa pin)', () => {
    const q = 'perum banjarmukti blok g6a buduran';
    const hit = getGazetteerCoordinates(q);
    // Bila ter-resolve, hanya boleh menyentuh wilayah yang disebut (Buduran).
    expect(hit?.kecamatan).toBe('Buduran');
    // HARAM mencocokkan ke desa lain yang tidak disebut (mis. Banjarkemantren).
    expect(hit?.kelurahan).not.toBe('Banjarkemantren');
  });
});
