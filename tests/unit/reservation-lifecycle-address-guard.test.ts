import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db/client', () => ({
  prisma: {
    reservation: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../src/services/customer.service', () => ({
  customerService: {
    updateCustomerName: vi.fn(),
    getCustomerById: vi.fn(),
    upsertSavedAddress: vi.fn(),
    updateCustomerLocation: vi.fn(),
    recalculateCustomerLtv: vi.fn(),
  },
}));

vi.mock('../../src/services/follow-up.service', () => ({
  followUpService: { onReservationCreated: vi.fn() },
}));

vi.mock('../../src/services/google-contacts.service', () => ({
  googleContactsService: { syncCustomer: vi.fn() },
}));

import { prisma } from '../../src/db/client';
import { customerService } from '../../src/services/customer.service';
import { followUpService } from '../../src/services/follow-up.service';
import { googleContactsService } from '../../src/services/google-contacts.service';
import { reservationLifecycleService } from '../../src/services/reservation-lifecycle.service';

const BASE_PARAMS = {
  customerId: 'cust-lifecycle-1',
  reservationId: 'res-lifecycle-1',
  tenantId: 'default-tenant',
  chatId: '628123456789@c.us',
  customerName: undefined,
  kecamatan: 'Buduran',
  kelurahan: 'Buduran',
  kota: 'Sidoarjo',
  address: 'Jl. Buduran No. 1',
};

describe('ReservationLifecycleService — pagar tulis kartu alamat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      customer_address_id: 'card-1',
      customer_address: { id: 'card-1', lat: -7.4255, lng: 112.7214 },
      treatment_category: 'BABY',
    } as any);
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any);
    vi.mocked(customerService.updateCustomerLocation).mockResolvedValue({} as any);
    vi.mocked(customerService.upsertSavedAddress).mockResolvedValue({ id: 'card-new' } as any);
    vi.mocked(customerService.recalculateCustomerLtv).mockResolvedValue(undefined as any);
    vi.mocked(followUpService.onReservationCreated).mockResolvedValue(undefined as any);
    vi.mocked(googleContactsService.syncCustomer).mockResolvedValue(undefined as any);
  });

  it('reservasi sudah punya kartu → root TIDAK ditulis, auto-distance TIDAK dijalankan', async () => {
    vi.mocked(customerService.getCustomerById).mockResolvedValue({
      id: BASE_PARAMS.customerId,
      kelurahan: 'Grogol',
      kecamatan: 'Tulangan',
      preferences: { address: 'Jl. Melati No. 12' },
      distance_km: 12.5,
      lat: -7.4812,
      lng: 112.6521,
    } as any);

    await reservationLifecycleService.onReservationCreated(BASE_PARAMS as any);

    expect(customerService.updateCustomerLocation).not.toHaveBeenCalled();
    expect(customerService.upsertSavedAddress).not.toHaveBeenCalled();
    // Auto-distance hanya membaca customer; dengan kartu valid, jalur itu tidak boleh disentuh.
    expect(customerService.getCustomerById).not.toHaveBeenCalled();
  });

  it('kartu ada tetapi koordinatnya kosong → tetap TIDAK menulis root / kartu baru', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      customer_address_id: 'card-1',
      customer_address: { id: 'card-1', lat: null, lng: null },
      treatment_category: 'BABY',
    } as any);
    vi.mocked(customerService.getCustomerById).mockResolvedValue({
      id: BASE_PARAMS.customerId,
      kelurahan: 'Grogol',
      kecamatan: 'Tulangan',
      preferences: { address: 'Jl. Melati No. 12' },
      distance_km: null,
      lat: null,
      lng: null,
    } as any);

    await reservationLifecycleService.onReservationCreated(BASE_PARAMS as any);

    expect(customerService.updateCustomerLocation).not.toHaveBeenCalled();
    expect(customerService.upsertSavedAddress).not.toHaveBeenCalled();
    expect(customerService.getCustomerById).not.toHaveBeenCalled();
  });

  it('tanpa kartu + customer belum punya alamat → jalur root lama tetap berjalan', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      customer_address_id: null,
      customer_address: null,
      treatment_category: 'BABY',
    } as any);
    vi.mocked(customerService.getCustomerById).mockResolvedValue({
      id: BASE_PARAMS.customerId,
      kelurahan: null,
      kecamatan: null,
      preferences: {},
      distance_km: 5,
      lat: -7.3,
      lng: 112.7,
    } as any);

    await reservationLifecycleService.onReservationCreated(BASE_PARAMS as any);

    expect(customerService.updateCustomerLocation).toHaveBeenCalledTimes(1);
    expect(customerService.updateCustomerLocation).toHaveBeenCalledWith(
      BASE_PARAMS.customerId,
      expect.objectContaining({
        kecamatan: 'Buduran',
        kelurahan: 'Buduran',
        kota: 'Sidoarjo',
        address: 'Jl. Buduran No. 1',
      }),
      BASE_PARAMS.tenantId
    );
  });

  it('KNOWN #339: teks alamat SAMA dengan profil root → tidak membuat kartu duplikat', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      customer_address_id: null,
      customer_address: null,
      treatment_category: 'BABY',
    } as any);
    vi.mocked(customerService.getCustomerById).mockResolvedValue({
      id: BASE_PARAMS.customerId,
      kelurahan: 'Buduran',
      kecamatan: 'Buduran',
      preferences: { address: BASE_PARAMS.address },
    } as any);

    await reservationLifecycleService.onReservationCreated(BASE_PARAMS as any);

    expect(customerService.upsertSavedAddress).not.toHaveBeenCalled();
    expect(customerService.updateCustomerLocation).not.toHaveBeenCalled();
  });

  it('KNOWN #339: alamat beda tetapi wilayah kosong → tolak kartu parsial', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      customer_address_id: null,
      customer_address: null,
      treatment_category: 'BABY',
    } as any);
    vi.mocked(customerService.getCustomerById).mockResolvedValue({
      id: BASE_PARAMS.customerId,
      kelurahan: 'Buduran',
      kecamatan: 'Buduran',
      preferences: { address: 'Jl. Lama No. 2' },
    } as any);

    await reservationLifecycleService.onReservationCreated({
      ...BASE_PARAMS,
      address: 'Jl. Baru Tanpa Wilayah No. 9',
      kecamatan: undefined,
      kelurahan: undefined,
      kota: undefined,
    } as any);

    expect(customerService.upsertSavedAddress).not.toHaveBeenCalled();
  });

  it('regresi: alamat beda + wilayah lengkap → kartu secondary tetap dibuat', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      customer_address_id: null,
      customer_address: null,
      treatment_category: 'BABY',
    } as any);
    vi.mocked(customerService.getCustomerById).mockResolvedValue({
      id: BASE_PARAMS.customerId,
      kelurahan: 'Grogol',
      kecamatan: 'Tulangan',
      preferences: { address: 'Jl. Melati No. 12' },
    } as any);

    await reservationLifecycleService.onReservationCreated(BASE_PARAMS as any);

    expect(customerService.upsertSavedAddress).toHaveBeenCalledTimes(1);
  });
});
