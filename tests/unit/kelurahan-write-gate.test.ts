import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { sanitizeKelurahanInput, isCorruptedKelurahan } from '../../src/utils/kelurahan-guard';
import { customerService } from '../../src/services/customer.service';
import { getCustomerRepository } from '../../src/repositories/customer.repository';

/**
 * Fase 165b — Gerbang SEAM TULIS kolom `kelurahan`.
 *
 * Adversarial: bukan happy-path. Menguji bahwa detail alamat (field "Alamat"
 * form reservasi) TIDAK bocor ke kolom kelurahan, sementara nama desa resmi
 * tetap tersimpan dan tidak dimutilasi.
 */

describe('kelurahan-guard (pure)', () => {
  it('menolak alamat jalan/perumahan/URL/RT-RW (data cemar form reservasi)', () => {
    const corrupt = [
      'Jalan Melati No 5',
      'jl. griya kebraon 12',
      'Blok A-12',
      'Gang Mawar 3',
      'RT 03 RW 07 Sukomanunggal',
      'https://maps.google.com/?q=-7.2,112.7',
      'perumahan banjar mukti residence',
      'x'.repeat(41),
    ];
    for (const v of corrupt) {
      expect(sanitizeKelurahanInput(v), `harus ditolak: ${v}`).toBeUndefined();
    }
  });

  it('meloloskan nama desa/kelurahan resmi (anti-false-positive)', () => {
    const legit = [
      'Manukan Kulon',
      'Bulakbanteng',
      'Gedangan',
      'Mulyorejo',
      'Kutisari',
      'Waru',
      'Sukomanunggal',
      'Pradah Kalikendal',
    ];
    for (const v of legit) {
      expect(sanitizeKelurahanInput(v), `harus lolos: ${v}`).toBe(v);
    }
  });

  it('trim + kosong/null → undefined (tidak menulis empty string)', () => {
    expect(sanitizeKelurahanInput('  Waru  ')).toBe('Waru');
    expect(sanitizeKelurahanInput('')).toBeUndefined();
    expect(sanitizeKelurahanInput('   ')).toBeUndefined();
    expect(sanitizeKelurahanInput(null)).toBeUndefined();
    expect(sanitizeKelurahanInput(undefined)).toBeUndefined();
  });

  it('tidak menganggap nilai pendek wajar sebagai cemar', () => {
    expect(isCorruptedKelurahan('Waru')).toBe(false);
    expect(isCorruptedKelurahan('Sidoarjo')).toBe(false);
  });
});

describe('customer.service.updateCustomerLocation — gerbang seam tulis', () => {
  const TENANT = 'default-tenant';
  let updateSpy: any;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function mockExisting(overrides: Record<string, any> = {}) {
    const row = {
      id: 'cust-1',
      tenant_id: TENANT,
      name: 'Bunda Uji',
      phone: '6281234567890',
      kelurahan: 'Waru',
      kecamatan: 'Waru',
      kota: 'Sidoarjo',
      lat: null,
      lng: null,
      distance_km: null,
      ongkir: null,
      zipcode: null,
      location_source: null,
      share_location_sent: false,
      preferences: {},
      ...overrides,
    };
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(row as any);
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(row as any);
    updateSpy = vi.spyOn(getCustomerRepository(), 'update').mockImplementation(
      async (_id: string, patch: any) => ({ ...row, ...patch })
    );
  }

  it('alamat jalan TIDAK ditulis ke kolom kelurahan (dibuang, kelurahan lama dipertahankan)', async () => {
    mockExisting({ kelurahan: 'Waru' });

    const out: any = await customerService.updateCustomerLocation(
      'cust-1',
      { kelurahan: 'Jalan Melati No 5', kecamatan: 'Waru' },
      TENANT
    );

    // Pemanggilan repo seam pertama = baris utama; kelurahan harus tetap 'Waru'
    const firstCall = updateSpy.mock.calls[0][1] as any;
    expect(firstCall.kelurahan).toBe('Waru');
    expect(out).toBeTruthy();
  });

  it('nama desa resmi TETAP ditulis apa adanya', async () => {
    mockExisting({ kelurahan: null });

    await customerService.updateCustomerLocation(
      'cust-1',
      { kelurahan: 'Bulakbanteng' },
      TENANT
    );

    const firstCall = updateSpy.mock.calls[0][1] as any;
    expect(firstCall.kelurahan).toBe('Bulakbanteng');
  });
});

describe('customer.service.updateCustomer — gerbang + redirect ke preferences.address', () => {
  const TENANT = 'default-tenant';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('kelurahan cemar dialihkan ke preferences.address, kolom kelurahan tidak ditulis', async () => {
    const row = {
      id: 'cust-2',
      tenant_id: TENANT,
      name: 'Bunda Uji',
      kelurahan: null,
      kecamatan: null,
      kota: null,
      preferences: {},
    };
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(row as any);
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(row as any);
    const updateSpy = vi.spyOn(getCustomerRepository(), 'update').mockImplementation(
      async (_id: string, patch: any) => ({ ...row, ...patch })
    );

    await customerService.updateCustomer('cust-2', { kelurahan: 'Jl. Griya Kebraon 12' }, TENANT);

    const patch = updateSpy.mock.calls[0][1] as any;
    expect(patch.kelurahan).toBeUndefined();
    expect(patch.preferences?.address).toBe('Jl. Griya Kebraon 12');
  });

  it('kelurahan resmi tidak dialihkan (tetap di kolom kelurahan)', async () => {
    const row = {
      id: 'cust-3',
      tenant_id: TENANT,
      name: 'Bunda Uji',
      kelurahan: null,
      kecamatan: null,
      kota: null,
      preferences: {},
    };
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(row as any);
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(row as any);
    const updateSpy = vi.spyOn(getCustomerRepository(), 'update').mockImplementation(
      async (_id: string, patch: any) => ({ ...row, ...patch })
    );

    await customerService.updateCustomer('cust-3', { kelurahan: 'Mulyorejo' }, TENANT);

    const patch = updateSpy.mock.calls[0][1] as any;
    expect(patch.kelurahan).toBe('Mulyorejo');
    expect(patch.preferences?.address).toBeUndefined();
  });

  it('null eksplisit (pembersihan admin) tetap diteruskan sebagai null', async () => {
    const row = {
      id: 'cust-4',
      tenant_id: TENANT,
      name: 'Bunda Uji',
      kelurahan: 'Jalan Lama',
      kecamatan: null,
      kota: null,
      preferences: {},
    };
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(row as any);
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(row as any);
    const updateSpy = vi.spyOn(getCustomerRepository(), 'update').mockImplementation(
      async (_id: string, patch: any) => ({ ...row, ...patch })
    );

    await customerService.updateCustomer('cust-4', { kelurahan: null }, TENANT);

    const patch = updateSpy.mock.calls[0][1] as any;
    expect(patch.kelurahan).toBeNull();
  });
});
