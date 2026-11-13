import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { customerService } from '../../src/services/customer.service';
import { auditService } from '../../src/services/audit.service';
import { syncActiveReservationsForCustomer } from '../../src/services/reservation-address-sync.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

const TENANT = DEFAULT_TENANT_ID;

let phoneSeq = 500;
const nextPhone = (): string => `628788${(phoneSeq++).toString().padStart(6, '0')}`;

const reservationFindMany = prisma.reservation.findMany as unknown as ReturnType<typeof vi.fn>;
const reservationUpdate = prisma.reservation.update as unknown as ReturnType<typeof vi.fn>;

const futureDate = () => new Date(Date.now() + 60 * 60 * 1000); // +1 jam
const pastDate = () => new Date(Date.now() - 5 * 60 * 60 * 1000); // -5 jam

describe('Adversarial & Regression: syncActiveReservationsForCustomer (seam kanonis jadwal aktif)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    reservationFindMany.mockReset();
    reservationUpdate.mockReset();
    reservationUpdate.mockResolvedValue({});
  });

  async function makeCustomerWithHouse1(phone: string) {
    const created: any = await customerService.getOrCreateCustomer(phone, 'Bunda Sync', TENANT);
    const card = await customerService.upsertSavedAddress(created.id, {
      address: 'Perumdos ITS Jl. Teknik Sipil Blok W no.18',
      kelurahan: 'Gebang Putih',
      kecamatan: 'Sukolilo',
      kota: 'Kota Surabaya',
      lat: -7.289199,
      lng: 112.7970673,
      distanceKm: 13.3,
      ongkir: 15000,
      locationSource: 'gps_pin',
      isPrimary: true,
    }, TENANT);
    // Ambil referensi LIVE dari repo (upsert menulis objek spread baru) lalu tanam root.
    const customer: any = await customerService.getCustomerById(created.id, TENANT);
    Object.assign(customer, {
      address: 'Perumdos ITS Jl. Teknik Sipil Blok W no.18',
      kelurahan: 'Gebang Putih',
      kecamatan: 'Sukolilo',
      kota: 'Kota Surabaya',
      lat: -7.289199,
      lng: 112.7970673,
      distance_km: 13.3,
      ongkir: 15000,
    });
    return { customer, card };
  }

  it('1. Reservasi TANPA kartu → diisi kartu terkoreksi + snapshot ongkir', async () => {
    const phone = nextPhone();
    const { customer, card } = await makeCustomerWithHouse1(phone);

    reservationFindMany.mockResolvedValue([
      { id: 'res-active-1', tenant_id: TENANT, customer_id: customer.id, status: 'confirmed', booking_date: futureDate(), customer_address_id: null, delivery_fee: null, customer_address: null },
    ]);

    const res = await syncActiveReservationsForCustomer({ tenantId: TENANT, customerId: customer.id });

    expect(res.synced).toBe(1);
    expect(reservationUpdate).toHaveBeenCalledTimes(1);
    const call = reservationUpdate.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'res-active-1' });
    expect(call.data.customer_address_id).toBe(card?.id);
    expect(call.data.delivery_fee).toBe(15000);
  });

  it('1b. Reservasi SUDAH punya kartu → tautan tidak diubah; ongkir diselaraskan dari kartu sendiri', async () => {
    const phone = nextPhone();
    const { customer, card } = await makeCustomerWithHouse1(phone);

    reservationFindMany.mockResolvedValue([
      {
        id: 'res-card-1',
        tenant_id: TENANT,
        customer_id: customer.id,
        status: 'confirmed',
        booking_date: futureDate(),
        customer_address_id: card?.id,
        customer_address: { id: card?.id, ongkir: 15000 },
        delivery_fee: 9999,
      },
    ]);

    const res = await syncActiveReservationsForCustomer({ tenantId: TENANT, customerId: customer.id });

    expect(res.synced).toBe(1);
    const data = reservationUpdate.mock.calls[0][0].data;
    expect(data.customer_address_id).toBeUndefined();
    expect(data.delivery_fee).toBe(15000);
  });

  it('2. Status kanon (hold & pending) dalam jendela aktif ikut tersinkron', async () => {
    const phone = nextPhone();
    const { customer, card } = await makeCustomerWithHouse1(phone);

    reservationFindMany.mockResolvedValue([
      { id: 'res-hold', tenant_id: TENANT, customer_id: customer.id, status: 'hold', booking_date: futureDate(), customer_address_id: null, delivery_fee: null, customer_address: null },
      { id: 'res-pending', tenant_id: TENANT, customer_id: customer.id, status: 'pending', booking_date: null, customer_address_id: null, delivery_fee: null, customer_address: null },
    ]);

    const res = await syncActiveReservationsForCustomer({ tenantId: TENANT, customerId: customer.id });

    expect(res.synced).toBe(2);
    const ids = reservationUpdate.mock.calls.map((c) => c[0].where.id);
    expect(ids).toEqual(expect.arrayContaining(['res-hold', 'res-pending']));
    for (const c of reservationUpdate.mock.calls) {
      expect(c[0].data.customer_address_id).toBe(card?.id);
    }
  });

  it('3. Reservasi completed/cancelled TIDAK tersentuh', async () => {
    const phone = nextPhone();
    const { customer } = await makeCustomerWithHouse1(phone);

    reservationFindMany.mockResolvedValue([
      { id: 'res-done', tenant_id: TENANT, customer_id: customer.id, status: 'completed', booking_date: pastDate(), customer_address_id: 'OLD', delivery_fee: 1 },
      { id: 'res-cancel', tenant_id: TENANT, customer_id: customer.id, status: 'cancelled', booking_date: futureDate(), customer_address_id: 'OLD', delivery_fee: 1 },
    ]);

    const res = await syncActiveReservationsForCustomer({ tenantId: TENANT, customerId: customer.id });

    expect(res.synced).toBe(0);
    expect(reservationUpdate).not.toHaveBeenCalled();
  });

  it('4. Dua rumah sah → reservasi eksplisit di Rumah 1 TIDAK direlink saat root pindah ke Rumah 2', async () => {
    const phone = nextPhone();
    const created: any = await customerService.getOrCreateCustomer(phone, 'Bunda Dua Rumah', TENANT);

    const rumah1 = await customerService.upsertSavedAddress(created.id, {
      address: 'Jl. Melati No. 12', kelurahan: 'Grogol', kecamatan: 'Tulangan', kota: 'Sidoarjo',
      lat: -7.4812, lng: 112.6521, distanceKm: 12.5, ongkir: 15000, isPrimary: true,
    }, TENANT);
    const rumah2 = await customerService.upsertSavedAddress(created.id, {
      address: 'Perum Buduran Indah Blok B-5', kelurahan: 'Buduran', kecamatan: 'Buduran', kota: 'Sidoarjo',
      lat: -7.4255, lng: 112.7214, distanceKm: 18.0, ongkir: 22000,
    }, TENANT);

    // Root pelanggan sekarang = Rumah 2 (Buduran).
    const customer: any = await customerService.getCustomerById(created.id, TENANT);
    Object.assign(customer, {
      address: 'Perum Buduran Indah Blok B-5',
      kelurahan: 'Buduran',
      kecamatan: 'Buduran',
      kota: 'Sidoarjo',
      lat: -7.4255,
      lng: 112.7214,
      distance_km: 18.0,
      ongkir: 22000,
    });

    reservationFindMany.mockResolvedValue([
      {
        id: 'res-r2',
        tenant_id: TENANT,
        customer_id: customer.id,
        status: 'confirmed',
        booking_date: futureDate(),
        customer_address_id: rumah1?.id,
        customer_address: { id: rumah1?.id, ongkir: 15000 },
        delivery_fee: 15000,
      },
    ]);

    const res = await syncActiveReservationsForCustomer({ tenantId: TENANT, customerId: customer.id });

    // Fill-only: kartu eksplisit dipertahankan, ongkir tidak diambil dari root Rumah 2.
    expect(res.synced).toBe(0);
    expect(reservationUpdate).not.toHaveBeenCalled();
    const all = await customerService.getSavedAddresses(customer.id, TENANT);
    expect(all).toHaveLength(2);
  });

  it('4b. Kartu eksplisit dengan ongkir berbeda dari root → fee dari kartu, bukan root', async () => {
    const phone = nextPhone();
    const created: any = await customerService.getOrCreateCustomer(phone, 'Bunda Dua Rumah Fee', TENANT);

    const rumah1 = await customerService.upsertSavedAddress(created.id, {
      address: 'Jl. Melati No. 12', kelurahan: 'Grogol', kecamatan: 'Tulangan', kota: 'Sidoarjo',
      lat: -7.4812, lng: 112.6521, distanceKm: 12.5, ongkir: 15000, isPrimary: true,
    }, TENANT);
    await customerService.upsertSavedAddress(created.id, {
      address: 'Perum Buduran Indah Blok B-5', kelurahan: 'Buduran', kecamatan: 'Buduran', kota: 'Sidoarjo',
      lat: -7.4255, lng: 112.7214, distanceKm: 18.0, ongkir: 22000,
    }, TENANT);

    const customer: any = await customerService.getCustomerById(created.id, TENANT);
    Object.assign(customer, {
      address: 'Perum Buduran Indah Blok B-5',
      kelurahan: 'Buduran',
      kecamatan: 'Buduran',
      kota: 'Sidoarjo',
      lat: -7.4255,
      lng: 112.7214,
      distance_km: 18.0,
      ongkir: 22000,
    });

    reservationFindMany.mockResolvedValue([
      {
        id: 'res-r2-fee',
        tenant_id: TENANT,
        customer_id: customer.id,
        status: 'confirmed',
        booking_date: futureDate(),
        customer_address_id: rumah1?.id,
        customer_address: { id: rumah1?.id, ongkir: 15000 },
        delivery_fee: 9999,
      },
    ]);

    const res = await syncActiveReservationsForCustomer({ tenantId: TENANT, customerId: customer.id });

    expect(res.synced).toBe(1);
    const data = reservationUpdate.mock.calls[0][0].data;
    expect(data.customer_address_id).toBeUndefined();
    expect(data.delivery_fee).toBe(15000);
  });

  it('5. Idempoten: tautan & ongkir sudah benar → tidak ada update', async () => {
    const phone = nextPhone();
    const { customer, card } = await makeCustomerWithHouse1(phone);

    reservationFindMany.mockResolvedValue([
      {
        id: 'res-same',
        tenant_id: TENANT,
        customer_id: customer.id,
        status: 'confirmed',
        booking_date: futureDate(),
        customer_address_id: card?.id,
        customer_address: { id: card?.id, ongkir: 15000 },
        delivery_fee: 15000,
      },
    ]);

    const res = await syncActiveReservationsForCustomer({ tenantId: TENANT, customerId: customer.id });

    expect(res.synced).toBe(0);
    expect(reservationUpdate).not.toHaveBeenCalled();
  });

  it('6. Tanpa reservasi aktif → no-op tanpa error', async () => {
    const phone = nextPhone();
    const { customer } = await makeCustomerWithHouse1(phone);
    reservationFindMany.mockResolvedValue([]);

    const res = await syncActiveReservationsForCustomer({ tenantId: TENANT, customerId: customer.id });
    expect(res.synced).toBe(0);
    expect(reservationUpdate).not.toHaveBeenCalled();
  });

  it('7. Audit ACTIVE_RESERVATION_LOCATION_SYNCED tercatat saat ada perubahan', async () => {
    const phone = nextPhone();
    const { customer, card } = await makeCustomerWithHouse1(phone);
    const spy = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue(undefined as any);

    reservationFindMany.mockResolvedValue([
      { id: 'res-audit', tenant_id: TENANT, customer_id: customer.id, status: 'confirmed', booking_date: futureDate(), customer_address_id: null, customer_address: null, delivery_fee: null },
    ]);

    await syncActiveReservationsForCustomer({ tenantId: TENANT, customerId: customer.id });

    expect(spy).toHaveBeenCalled();
    const arg = spy.mock.calls.find((c) => (c[0] as any)?.action === 'ACTIVE_RESERVATION_LOCATION_SYNCED');
    expect(arg).toBeTruthy();
    expect((arg?.[0] as any).targetId).toBe(customer.id);
    expect((arg?.[0] as any).payload.targetAddressId).toBe(card?.id);
  });

  it('8. Reservasi aktif tapi customer tidak ada → no-op aman', async () => {
    reservationFindMany.mockResolvedValue([{ id: 'x', tenant_id: TENANT, customer_id: 'ghost', status: 'confirmed', booking_date: futureDate() }]);
    const res = await syncActiveReservationsForCustomer({ tenantId: TENANT, customerId: 'ghost-not-found' });
    expect(res.synced).toBe(0);
    expect(reservationUpdate).not.toHaveBeenCalled();
  });
});
