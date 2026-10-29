import { describe, it, expect, afterEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { customerService } from '../../src/services/customer.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { buildAddressKey } from '../../src/domain/customer-address';

describe('customerService.getLastDeliveryFee (SSOT Ongkir Promo Hierarchy & TTL Address Binding)', () => {
  const tenantId = DEFAULT_TENANT_ID;
  const customerId = 'cust-test-123';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Prioritas 1: Mengambil snapshot delivery_fee dari reservasi terakhir yang valid', async () => {
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue({
      delivery_fee: 25000,
    } as any);

    vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({
      ongkir: 35000,
      preferences: {
        distance_estimate: { ongkir: 20000 },
        saved_addresses: [
          {
            id: 'a1',
            label: 'Rumah',
            isPrimary: true,
            ongkir: 15000,
            createdAt: '2026-01-01T00:00:00.000Z',
            lastUsedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    } as any);

    const fee = await customerService.getLastDeliveryFee(customerId, tenantId);
    expect(fee).toBe(25000);
  });

  it('Prioritas 2: Mengambil distance_estimate.ongkir jika belum expired dan address_key cocok', async () => {
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null as any);

    const activeAddr = {
      id: 'addr-1',
      label: 'Rumah',
      address: 'Jl. Rungkut Asri No. 12',
      kelurahan: 'Rungkut Kidul',
      kecamatan: 'Rungkut',
      kota: 'Surabaya',
      ongkir: 30000,
      isPrimary: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: '2026-01-01T00:00:00.000Z',
    };

    const key = buildAddressKey(activeAddr);

    vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({
      ongkir: 35000,
      lat: null,
      lng: null,
      kelurahan: 'Rungkut Kidul',
      kecamatan: 'Rungkut',
      kota: 'Surabaya',
      preferences: {
        distance_estimate: {
          ongkir: 25000,
          by: 'admin_chat',
          address_key: key,
          expires_at: new Date(Date.now() + 86400000).toISOString(), // 1 hari ke depan
        },
        saved_addresses: [activeAddr],
      },
    } as any);

    const fee = await customerService.getLastDeliveryFee(customerId, tenantId);
    expect(fee).toBe(25000);
  });

  it('Estimasi kedaluwarsa (expires_at kemarin) → diabaikan, jatuh ke kartu alamat aktif', async () => {
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null as any);

    const activeAddr = {
      id: 'addr-1',
      label: 'Rumah',
      address: 'Jl. Rungkut Asri No. 12',
      kelurahan: 'Rungkut Kidul',
      kecamatan: 'Rungkut',
      kota: 'Surabaya',
      ongkir: 30000,
      isPrimary: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: '2026-01-01T00:00:00.000Z',
    };

    const key = buildAddressKey(activeAddr);

    vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({
      ongkir: 35000,
      preferences: {
        distance_estimate: {
          ongkir: 25000,
          by: 'admin_chat',
          address_key: key,
          expires_at: new Date(Date.now() - 86400000).toISOString(), // kemarin (expired)
        },
        saved_addresses: [activeAddr],
      },
    } as any);

    const fee = await customerService.getLastDeliveryFee(customerId, tenantId);
    expect(fee).toBe(30000);
  });

  it('Estimasi tanpa expires_at (data legacy) → diabaikan (fail-closed), jatuh ke kartu alamat aktif', async () => {
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null as any);

    const activeAddr = {
      id: 'addr-1',
      label: 'Rumah',
      address: 'Jl. Rungkut Asri No. 12',
      kelurahan: 'Rungkut Kidul',
      kecamatan: 'Rungkut',
      kota: 'Surabaya',
      ongkir: 30000,
      isPrimary: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: '2026-01-01T00:00:00.000Z',
    };

    const key = buildAddressKey(activeAddr);

    vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({
      ongkir: 35000,
      preferences: {
        distance_estimate: {
          ongkir: 25000,
          by: 'admin_chat',
          address_key: key,
          // expires_at tidak ada
        },
        saved_addresses: [activeAddr],
      },
    } as any);

    const fee = await customerService.getLastDeliveryFee(customerId, tenantId);
    expect(fee).toBe(30000);
  });

  it('Estimasi address_key beda dengan alamat aktif → diabaikan, jatuh ke kartu alamat aktif', async () => {
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null as any);

    const activeAddr = {
      id: 'addr-1',
      label: 'Rumah',
      address: 'Jl. Rungkut Asri No. 12',
      kelurahan: 'Rungkut Kidul',
      kecamatan: 'Rungkut',
      kota: 'Surabaya',
      ongkir: 30000,
      isPrimary: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: '2026-01-01T00:00:00.000Z',
    };

    vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({
      ongkir: 35000,
      preferences: {
        distance_estimate: {
          ongkir: 25000,
          by: 'admin_chat',
          address_key: 'txt:jl mawar no 99|rungkut menanggal|rungkut|surabaya', // beda alamat
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        },
        saved_addresses: [activeAddr],
      },
    } as any);

    const fee = await customerService.getLastDeliveryFee(customerId, tenantId);
    expect(fee).toBe(30000);
  });

  it('Prioritas 3: Mengambil primary saved_addresses ongkir jika estimasi chat kosong', async () => {
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null as any);

    vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({
      ongkir: 35000,
      preferences: {
        distance_estimate: null,
        saved_addresses: [
          {
            id: 'addr-1',
            label: 'Rumah 1',
            isPrimary: false,
            ongkir: 20000,
            createdAt: '2026-01-01T00:00:00.000Z',
            lastUsedAt: '2026-01-05T00:00:00.000Z',
          },
          {
            id: 'addr-2',
            label: 'Rumah 2',
            isPrimary: true,
            ongkir: 15000,
            createdAt: '2026-01-01T00:00:00.000Z',
            lastUsedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    } as any);

    const fee = await customerService.getLastDeliveryFee(customerId, tenantId);
    expect(fee).toBe(15000); // isPrimary: true menang atas lastUsedAt yang lebih baru
  });

  it('Prioritas 3 (Tanpa primary): Mengambil kartu dengan lastUsedAt terbaru (bukan urutan array addrs[0])', async () => {
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null as any);

    vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({
      ongkir: 35000,
      preferences: {
        distance_estimate: null,
        saved_addresses: [
          {
            id: 'addr-old',
            label: 'Rumah Lama',
            isPrimary: false,
            ongkir: 20000,
            createdAt: '2026-01-01T00:00:00.000Z',
            lastUsedAt: '2026-01-01T00:00:00.000Z',
          }, // array index 0 tapi lebih lama
          {
            id: 'addr-new',
            label: 'Rumah Baru',
            isPrimary: false,
            ongkir: 18000,
            createdAt: '2026-01-01T00:00:00.000Z',
            lastUsedAt: '2026-01-05T00:00:00.000Z',
          }, // array index 1 tapi lebih baru
        ],
      },
    } as any);

    const fee = await customerService.getLastDeliveryFee(customerId, tenantId);
    expect(fee).toBe(18000);
  });

  it('Prioritas 4: Fallback ke Customer.ongkir jika seluruh preferensi kosong', async () => {
    vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValue(null as any);

    vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({
      ongkir: 35000,
      preferences: {},
    } as any);

    const fee = await customerService.getLastDeliveryFee(customerId, tenantId);
    expect(fee).toBe(35000);
  });

  it('Mengembalikan null jika tidak ada data sama sekali atau DB offline', async () => {
    vi.spyOn(prisma.reservation, 'findFirst').mockRejectedValue(new Error('Database offline'));
    vi.spyOn(prisma.customer, 'findFirst').mockRejectedValue(new Error('Database offline'));

    const fee = await customerService.getLastDeliveryFee(customerId, tenantId);
    expect(fee).toBeNull();
  });
});
