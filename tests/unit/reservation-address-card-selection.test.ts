import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { auditService } from '../../src/services/audit.service';
import { customerService } from '../../src/services/customer.service';
import { deliveryService } from '../../src/services/delivery.service';
import { reservationCoreService } from '../../src/services/reservation-core.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Adversarial: pemilihan KARTU alamat pada edit reservasi & edit panduan lokasi.
 *
 * Akar insiden multi-alamat 2026-11-05 (Bunda Briella): admin tidak bisa memilih
 * alamat rumah kedua saat mengedit reservasi, lalu "jalan pintas" mengedit titik
 * GPS lewat modal lokasi justru menimpa koordinat profil ROOT (rumah utama).
 *
 * Test ini mengunci kontrak:
 *  - PATCH reservasi: kartu yang dipilih harfiah menang + ongkir ikut kartu.
 *  - Kartu milik customer lain / tidak ada → 400, tidak ada penulisan.
 *  - `null` eksplisit = lepas tautan (detach), bukan di-resolve ulang dari teks.
 *  - PUT /location dengan customerAddressId → tulis ke KARTU, bukan root.
 */

const ADMIN_KEY = 'test_admin_key_123';
const TENANT = DEFAULT_TENANT_ID;
const CUSTOMER_ID = 'cust-multi-rumah';

const CARD_TANDES = {
  id: 'card-tandes',
  label: 'Rumah Tandes',
  address: 'Gadel, tandes',
  kelurahan: 'Karangpoh',
  kecamatan: 'Tandes',
  kota: 'Surabaya',
  lat: -7.260442,
  lng: 112.681097,
  distanceKm: 19.77,
  ongkir: 15000,
  landmark: 'Pagar hijau',
  locationSource: 'gps_pin',
  isPrimary: true,
};

const CARD_GUNUNG_ANYAR = {
  id: 'card-gunung-anyar',
  label: 'Rumah Gunung Anyar',
  address: 'Gunung anyar lor no 94',
  kelurahan: null,
  kecamatan: null,
  kota: null,
  lat: null,
  lng: null,
  distanceKm: 5.2,
  ongkir: 12000,
  landmark: null,
  locationSource: 'estimated_area',
  isPrimary: false,
};

function makeExisting(overrides: Record<string, any> = {}) {
  return {
    id: 'res-multi-1',
    tenant_id: TENANT,
    customer_id: CUSTOMER_ID,
    treatment_category: 'BABY',
    treatment_detail: 'Pijat Bayi',
    purchase_value: 60000,
    status: 'confirmed',
    booking_date: null,
    assigned_staff_id: null,
    delivery_fee: 15000,
    raw_text: '[Admin Manual] BABY: Pijat Bayi',
    customer: {
      id: CUSTOMER_ID,
      tenant_id: TENANT,
      name: 'Bunda Briella',
      phone: '6283856165785',
      kelurahan: 'Karangpoh',
      kecamatan: 'Tandes',
      kota: 'Surabaya',
      lat: -7.260442,
      lng: 112.681097,
      distance_km: 19.77,
      ongkir: 15000,
      children: [],
      preferences: {
        address: 'Gadel, tandes',
        saved_addresses: [CARD_TANDES, CARD_GUNUNG_ANYAR],
      },
    },
    customer_address: CARD_TANDES,
    ...overrides,
  };
}

describe('PATCH /api/admin/reservation/:id — pilih kartu alamat rumah', () => {
  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    vi.mocked(prisma.reservation.findFirst).mockReset();
    vi.mocked(prisma.reservation.update).mockReset();
    vi.restoreAllMocks();
    vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined as any);
  });

  it('kartu rumah kedua dipilih → customer_address_id & delivery_fee mengikuti kartu itu', async () => {
    const existing = makeExisting();
    let captured: any = null;
    vi.mocked(prisma.reservation.findFirst)
      .mockResolvedValueOnce(existing as any)
      .mockResolvedValueOnce({ ...existing, customer_address_id: CARD_GUNUNG_ANYAR.id } as any);
    vi.mocked(prisma.reservation.update).mockImplementationOnce(async ({ data }: any) => {
      captured = data;
      return { ...existing, ...data } as any;
    });
    const cardsSpy = vi
      .spyOn(customerService, 'getSavedAddresses')
      .mockResolvedValue([CARD_TANDES, CARD_GUNUNG_ANYAR] as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/reservation/${existing.id}`,
      headers: { 'x-api-key': ADMIN_KEY },
      payload: {
        customerAddressId: CARD_GUNUNG_ANYAR.id,
        address: CARD_GUNUNG_ANYAR.address,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(cardsSpy).toHaveBeenCalledWith(CUSTOMER_ID, TENANT);
    expect(captured.customer_address_id).toBe(CARD_GUNUNG_ANYAR.id);
    // Ongkir WAJIB ikut kartu (bukan tarif rumah lama).
    expect(captured.delivery_fee).toBe(CARD_GUNUNG_ANYAR.ongkir);
  });

  it('kartu milik customer lain / tidak ada di buku alamat → 400 & tidak menulis apa pun', async () => {
    const existing = makeExisting();
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(existing as any);
    const updateSpy = vi.mocked(prisma.reservation.update).mockResolvedValue({} as any);
    vi.spyOn(customerService, 'getSavedAddresses').mockResolvedValue([CARD_TANDES, CARD_GUNUNG_ANYAR] as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/reservation/${existing.id}`,
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { customerAddressId: 'card-punya-orang-lain' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('CUSTOMER_ADDRESS_NOT_FOUND');
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('customerAddressId null eksplisit → lepas kartu (detach), teks alamat TIDAK me-relink ulang', async () => {
    const existing = makeExisting({ customer_address_id: CARD_TANDES.id });
    let captured: any = null;
    vi.mocked(prisma.reservation.findFirst)
      .mockResolvedValueOnce(existing as any)
      .mockResolvedValueOnce({ ...existing, customer_address_id: null } as any);
    vi.mocked(prisma.reservation.update).mockImplementationOnce(async ({ data }: any) => {
      captured = data;
      return { ...existing, ...data } as any;
    });
    const cardsSpy = vi.spyOn(customerService, 'getSavedAddresses');

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/reservation/${existing.id}`,
      headers: { 'x-api-key': ADMIN_KEY },
      payload: {
        customerAddressId: null,
        address: 'Gunung anyar lor no 94',
        kelurahan: 'Gunung Anyar',
        kecamatan: 'Gunung Anyar',
        kota: 'Surabaya',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(cardsSpy).not.toHaveBeenCalled();
    expect(captured.customer_address_id).toBeNull();
  });

  it('pilih kartu per-jadwal → DILARANG menulis alamat/wilayah/ongkir ke profil induk (anti data hibrida)', async () => {
    const existing = makeExisting();
    let captured: any = null;
    vi.mocked(prisma.reservation.findFirst)
      .mockResolvedValueOnce(existing as any)
      .mockResolvedValueOnce({ ...existing, customer_address_id: CARD_GUNUNG_ANYAR.id } as any);
    vi.mocked(prisma.reservation.update).mockImplementationOnce(async ({ data }: any) => {
      captured = data;
      return { ...existing, ...data } as any;
    });
    vi.mocked(prisma.customer.update).mockClear();
    vi.spyOn(customerService, 'getSavedAddresses').mockResolvedValue([CARD_TANDES, CARD_GUNUNG_ANYAR] as any);
    const mergeSpy = vi
      .spyOn(customerService, 'mergeCustomerPreferences')
      .mockResolvedValue(undefined as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/reservation/${existing.id}`,
      headers: { 'x-api-key': ADMIN_KEY },
      payload: {
        customerAddressId: CARD_GUNUNG_ANYAR.id,
        address: CARD_GUNUNG_ANYAR.address,
        kelurahan: 'Gunung Anyar Lor',
        kecamatan: 'Gunung Anyar',
        kota: 'Surabaya',
        ongkir: CARD_GUNUNG_ANYAR.ongkir,
      },
    });

    expect(res.statusCode).toBe(200);
    // Kartu tersimpan di reservasi + ongkir snapshot reservasi.
    expect(captured.customer_address_id).toBe(CARD_GUNUNG_ANYAR.id);
    expect(captured.delivery_fee).toBe(CARD_GUNUNG_ANYAR.ongkir);
    // Profil induk tidak disentuh sama sekali untuk data alamat.
    expect(mergeSpy).not.toHaveBeenCalled();
    for (const call of vi.mocked(prisma.customer.update).mock.calls) {
      const data = (call as any)[0]?.data || {};
      expect(data.ongkir).toBeUndefined();
      expect(data.kelurahan).toBeUndefined();
      expect(data.kecamatan).toBeUndefined();
      expect(data.kota).toBeUndefined();
    }
  });
});

describe('POST /api/admin/reservation — pilih kartu alamat rumah', () => {
  const CARD_BUDURAN = {
    id: 'card-buduran',
    label: 'Rumah Buduran',
    address: 'Perum Buduran Indah Blok B-5',
    kelurahan: 'Buduran',
    kecamatan: 'Buduran',
    kota: 'Sidoarjo',
    lat: -7.4255,
    lng: 112.7214,
    distanceKm: 18.0,
    ongkir: 22000,
    landmark: null,
    locationSource: 'manual_staff',
    isPrimary: false,
  };

  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    vi.restoreAllMocks();
    vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined as any);
  });

  function mockPostBase(cardResult: any | null) {
    const customer = makeExisting().customer;
    vi.spyOn(customerService, 'getCustomerById').mockResolvedValue(customer as any);
    const resolveSpy = vi
      .spyOn(customerService, 'resolveOwnedAddressCard')
      .mockResolvedValue(cardResult as any);
    const saveSpy = vi.spyOn(reservationCoreService, 'saveReservation').mockResolvedValue({
      reservation: {
        id: 'res-post-card',
        customer_id: CUSTOMER_ID,
        customer_address_id: cardResult?.id ?? null,
        treatment_category: 'BABY',
        treatment_detail: 'Pijat Bayi Ceria',
        status: 'confirmed',
        booking_date: null,
        delivery_fee: cardResult?.ongkir ?? null,
      },
    } as any);
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
      id: 'res-post-card',
      customer_id: CUSTOMER_ID,
      customer_address_id: cardResult?.id ?? null,
      treatment_category: 'BABY',
      treatment_detail: 'Pijat Bayi Ceria',
      status: 'confirmed',
      booking_date: null,
      delivery_fee: cardResult?.ongkir ?? null,
      customer,
      assigned_staff: null,
    } as any);
    vi.mocked(prisma.customer.update).mockResolvedValue({} as any);
    return { customer, resolveSpy, saveSpy };
  }

  it('kartu valid → customerAddressId, wilayah, dan deliveryFee dari kartu (bukan body)', async () => {
    const { resolveSpy, saveSpy } = mockPostBase(CARD_BUDURAN);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: {
        customerId: CUSTOMER_ID,
        treatmentCategory: 'BABY',
        treatmentDetail: 'Pijat Bayi Ceria',
        customerAddressId: CARD_BUDURAN.id,
        ongkir: 9999,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(resolveSpy).toHaveBeenCalledWith(CUSTOMER_ID, CARD_BUDURAN.id, TENANT);
    expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
      customerAddressId: CARD_BUDURAN.id,
      kecamatan: 'Buduran',
      kelurahan: 'Buduran',
      kota: 'Sidoarjo',
      deliveryFee: CARD_BUDURAN.ongkir,
    }));
  });

  it('kartu tidak ada / bukan milik customer → 400 dan save tidak dipanggil', async () => {
    const { saveSpy } = mockPostBase(null);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: {
        customerId: CUSTOMER_ID,
        treatmentCategory: 'BABY',
        treatmentDetail: 'Pijat Bayi Ceria',
        customerAddressId: 'card-punya-orang-lain',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('CUSTOMER_ADDRESS_NOT_FOUND');
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('teks alamat cocok dengan kartu → ongkir dari kartu, bukan last-fee root', async () => {
    const { saveSpy } = mockPostBase(null);
    vi.spyOn(customerService, 'getSavedAddresses').mockResolvedValue([CARD_TANDES, CARD_GUNUNG_ANYAR] as any);
    vi.spyOn(customerService, 'getLastDeliveryFee').mockResolvedValue(15000 as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: {
        customerId: CUSTOMER_ID,
        treatmentCategory: 'BABY',
        treatmentDetail: 'Pijat Bayi Ceria',
        address: CARD_GUNUNG_ANYAR.address,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
      customerAddressId: CARD_GUNUNG_ANYAR.id,
      deliveryFee: CARD_GUNUNG_ANYAR.ongkir,
    }));
  });
});

describe('PUT /api/admin/customers/:id/location — mode kartu (multi-rumah)', () => {
  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    vi.restoreAllMocks();
    vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined as any);
  });

  it('dengan customerAddressId → landmark/GPS ditulis ke KARTU, profil root tidak disentuh', async () => {
    const customer = makeExisting().customer;
    vi.spyOn(customerService, 'getCustomerById').mockResolvedValue(customer as any);
    vi.spyOn(customerService, 'getSavedAddresses').mockResolvedValue([CARD_TANDES, CARD_GUNUNG_ANYAR] as any);
    const upsertSpy = vi
      .spyOn(customerService, 'upsertSavedAddress')
      .mockResolvedValue({ ...CARD_GUNUNG_ANYAR, lat: -7.3169, lng: 112.7801 } as any);
    const rootSpy = vi.spyOn(customerService, 'updateCustomerLocation');
    vi.spyOn(deliveryService, 'calculateDelivery').mockResolvedValue({
      distanceKm: 5.2,
      promoPrice: 12000,
    } as any);
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([] as any);

    const app = buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/customers/${CUSTOMER_ID}/location`,
      headers: { 'x-api-key': ADMIN_KEY },
      payload: {
        customerAddressId: CARD_GUNUNG_ANYAR.id,
        lat: -7.3169,
        lng: 112.7801,
        landmark: 'Depan warung Bu Sri',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(rootSpy).not.toHaveBeenCalled();
    expect(upsertSpy).toHaveBeenCalledWith(
      CUSTOMER_ID,
      expect.objectContaining({
        id: CARD_GUNUNG_ANYAR.id,
        lat: -7.3169,
        lng: 112.7801,
        landmark: 'Depan warung Bu Sri',
        ongkir: 12000,
      }),
      TENANT
    );
    const body = JSON.parse(res.body);
    expect(body.data.customer_address_id).toBe(CARD_GUNUNG_ANYAR.id);
    // Root tetap rumah utama (Tandes), bukan tertimpa titik rumah kedua.
    expect(body.data.lat).toBe(customer.lat);
    expect(body.data.lng).toBe(customer.lng);
  });

  it('customerAddressId tidak dikenal → 404, tidak menulis root maupun kartu', async () => {
    const customer = makeExisting().customer;
    vi.spyOn(customerService, 'getCustomerById').mockResolvedValue(customer as any);
    vi.spyOn(customerService, 'getSavedAddresses').mockResolvedValue([CARD_TANDES] as any);
    const upsertSpy = vi.spyOn(customerService, 'upsertSavedAddress');
    const rootSpy = vi.spyOn(customerService, 'updateCustomerLocation');

    const app = buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/customers/${CUSTOMER_ID}/location`,
      headers: { 'x-api-key': ADMIN_KEY },
      payload: {
        customerAddressId: 'card-hantu',
        lat: -7.3,
        lng: 112.7,
      },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).code).toBe('CUSTOMER_ADDRESS_NOT_FOUND');
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(rootSpy).not.toHaveBeenCalled();
  });
});
