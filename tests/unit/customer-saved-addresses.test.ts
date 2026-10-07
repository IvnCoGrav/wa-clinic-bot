import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { customerService } from '../../src/services/customer.service';
import {
  parseSavedAddresses,
  upsertAddressIntoList,
  ensureSinglePrimary,
  resolveActiveAddress,
  buildAutoLabel,
  addressesMatch,
  type SavedCustomerAddress,
} from '../../src/domain/customer-address';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Buku Alamat Pelanggan (Multi-Address Support) — pengujian adversarial
 * multi-varian, OFFLINE (memory fallback). Bukan hafalan satu kalimat.
 */
const TENANT = DEFAULT_TENANT_ID;

let phoneSeq = 0;
const nextPhone = (): string => `6287${Date.now().toString().slice(-6)}${(phoneSeq++).toString().padStart(2, '0')}`;

async function seedCustomer(overrides: Record<string, any> = {}): Promise<any> {
  const c: any = await customerService.getOrCreateCustomer(nextPhone(), 'Bunda Multi', TENANT);
  Object.assign(c, overrides);
  const mem = customerService.getMemoryCustomers();
  mem.set(c.phone, c);
  mem.set(c.id, c);
  return c;
}

function mkAddr(over: Partial<SavedCustomerAddress>): SavedCustomerAddress {
  const now = new Date().toISOString();
  return {
    id: over.id || `addr-${Math.random().toString(36).slice(2)}`,
    label: over.label || 'Rumah',
    address: over.address || '',
    kelurahan: over.kelurahan ?? null,
    kecamatan: over.kecamatan ?? null,
    kota: over.kota ?? null,
    lat: over.lat ?? null,
    lng: over.lng ?? null,
    distanceKm: over.distanceKm ?? null,
    ongkir: over.ongkir ?? null,
    landmark: over.landmark ?? null,
    locationSource: over.locationSource ?? 'estimated_area',
    isPrimary: over.isPrimary ?? false,
    createdAt: over.createdAt || now,
    lastUsedAt: over.lastUsedAt || now,
  } as SavedCustomerAddress;
}

describe('Domain buku alamat — upsert & dedup', () => {
  it('tambah alamat kedua TIDAK menghapus alamat pertama', () => {
    const now = new Date().toISOString();
    const a = mkAddr({ id: 'a1', address: 'Jl. Rungkut Kidul No.1', kelurahan: 'Rungkut Kidul', kecamatan: 'Rungkut', kota: 'Surabaya', isPrimary: true, lat: -7.32, lng: 112.77 });
    const { list } = upsertAddressIntoList([a], {
      address: 'Jl. Kenanga No.5', kelurahan: 'Waru', kecamatan: 'Waru', kota: 'Sidoarjo', lat: -7.35, lng: 112.72,
    }, now);
    expect(list.length).toBe(2);
    expect(list.find((x) => x.id === 'a1')).toBeTruthy();
    expect(list.filter((x) => x.isPrimary).length).toBe(1);
  });

  it('dedup KETAT: beda jalan dalam kecamatan SAMA tetap 2 entri', () => {
    const now = new Date().toISOString();
    const a = mkAddr({ id: 'a1', address: 'Jl. Melati No.1', kelurahan: 'Waru', kecamatan: 'Waru', kota: 'Sidoarjo', isPrimary: true });
    const { list } = upsertAddressIntoList([a], {
      address: 'Jl. Anggrek No.9', kelurahan: 'Waru', kecamatan: 'Waru', kota: 'Sidoarjo',
    }, now);
    expect(list.length).toBe(2);
  });

  it('dedup: alamat jalan+kelurahan+kecamatan identik → UPDATE (bukan duplikat)', () => {
    const now = new Date().toISOString();
    const a = mkAddr({ id: 'a1', address: 'Jl. Melati No.1', kelurahan: 'Waru', kecamatan: 'Waru', kota: 'Sidoarjo', isPrimary: true, ongkir: 10000 });
    const { list, entry } = upsertAddressIntoList([a], {
      address: 'jl. melati no.1', kelurahan: 'waru', kecamatan: 'waru', kota: 'sidoarjo', ongkir: 12000,
    }, now);
    expect(list.length).toBe(1);
    expect(entry.id).toBe('a1');
    expect(entry.ongkir).toBe(12000);
  });

  it('dedup: titik <150 m dianggap rumah sama walau teks beda tipis', () => {
    const a = mkAddr({ lat: -7.35, lng: 112.72, address: 'A', kelurahan: 'Waru', kecamatan: 'Waru' });
    const b = mkAddr({ lat: -7.3501, lng: 112.7201, address: 'B', kelurahan: 'Waru', kecamatan: 'Waru' });
    expect(addressesMatch(a, b)).toBe(true);
  });
});

describe('Domain buku alamat — label unik', () => {
  it('label otomatis unik saat dua rumah di kecamatan sama', () => {
    const a = mkAddr({ label: 'Rumah Waru', kecamatan: 'Waru' });
    expect(buildAutoLabel([a], 'Waru', null)).toBe('Rumah Waru 2');
    expect(buildAutoLabel([a], 'Waru', null)).not.toBe('Rumah Waru');
  });

  it('label request eksplisit dipakai bila belum ada', () => {
    expect(buildAutoLabel([], 'Waru', 'Rumah Nenek')).toBe('Rumah Nenek');
  });
});

describe('Domain buku alamat — primary & resolusi', () => {
  it('resolveActiveAddress: primary menang', () => {
    const older = mkAddr({ id: 'p', isPrimary: true, lastUsedAt: '2026-01-01T00:00:00Z' });
    const newer = mkAddr({ id: 'n', isPrimary: false, lastUsedAt: '2026-10-01T00:00:00Z' });
    expect(resolveActiveAddress([older, newer])?.id).toBe('p');
  });

  it('resolveActiveAddress tanpa primary → lastUsedAt terbaru', () => {
    const older = mkAddr({ id: 'o', lastUsedAt: '2026-01-01T00:00:00Z' });
    const newer = mkAddr({ id: 'n', lastUsedAt: '2026-10-01T00:00:00Z' });
    expect(resolveActiveAddress([older, newer])?.id).toBe('n');
  });

  it('ensureSinglePrimary memaksa tepat 1 primary', () => {
    const a = mkAddr({ id: 'a', isPrimary: true });
    const b = mkAddr({ id: 'b', isPrimary: true });
    const out = ensureSinglePrimary([a, b], 'b');
    expect(out.filter((x) => x.isPrimary).length).toBe(1);
    expect(out.find((x) => x.isPrimary)?.id).toBe('b');
  });
});

describe('Domain buku alamat — backward-compat', () => {
  it('preferences lama tanpa saved_addresses → daftar kosong (tidak melempar)', () => {
    expect(parseSavedAddresses({ address: 'Jl. Lama No.1' })).toEqual([]);
    expect(parseSavedAddresses(undefined)).toEqual([]);
    expect(parseSavedAddresses(null)).toEqual([]);
  });

  it('entri kotor/invalid dibuang tanpa merusak entri valid', () => {
    const valid = mkAddr({ id: 'ok', label: 'Rumah' });
    const out = parseSavedAddresses({ saved_addresses: [valid, { junk: true }, null] });
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('ok');
  });
});

describe('CustomerService — buku alamat (offline memory fallback)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.customer.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.customer.update).mockRejectedValue(new Error('Database offline'));
  });

  it('upsertSavedAddress lalu getSavedAddresses mengembalikan 2 rumah', async () => {
    const c = await seedCustomer({ preferences: {} });
    const first = await customerService.upsertSavedAddress(c.id, {
      address: 'Jl. Rungkut Kidul No.1', kelurahan: 'Rungkut Kidul', kecamatan: 'Rungkut', kota: 'Surabaya', isPrimary: true,
    }, TENANT);
    expect(first).toBeTruthy();
    const second = await customerService.upsertSavedAddress(c.id, {
      address: 'Jl. Kenanga No.5', kelurahan: 'Waru', kecamatan: 'Waru', kota: 'Sidoarjo',
    }, TENANT);
    expect(second).toBeTruthy();
    expect(second!.id).not.toBe(first!.id);
    const list = await customerService.getSavedAddresses(c.id, TENANT);
    expect(list.length).toBe(2);
    expect(list.filter((a) => a.isPrimary).length).toBe(1);
  });

  it('setDefaultAddress memindah primary', async () => {
    const c = await seedCustomer({ preferences: {} });
    const a = await customerService.upsertSavedAddress(c.id, { address: 'Jl. A', kelurahan: 'Waru', kecamatan: 'Waru', kota: 'Sidoarjo', isPrimary: true }, TENANT);
    const b = await customerService.upsertSavedAddress(c.id, { address: 'Jl. B', kelurahan: 'Rungkut', kecamatan: 'Rungkut', kota: 'Surabaya' }, TENANT);
    await customerService.setDefaultAddress(c.id, b!.id, TENANT);
    const list = await customerService.getSavedAddresses(c.id, TENANT);
    expect(list.find((x) => x.isPrimary)?.id).toBe(b!.id);
    expect(list.find((x) => x.id === a!.id)?.isPrimary).toBe(false);
  });
});

describe('CustomerService — pin presisi tidak jadi data hibrida', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.customer.findFirst).mockRejectedValue(new Error('Database offline'));
    vi.mocked(prisma.customer.update).mockRejectedValue(new Error('Database offline'));
  });

  it('teks area rumah-2 pada customer pin presisi: koordinat root TETAP, area baru tercatat estimated_area', async () => {
    const c = await seedCustomer({
      lat: -7.32, lng: 112.77, distance_km: 10, ongkir: 15000,
      location_source: 'gps_pin', share_location_sent: true,
      preferences: {
        address: 'Jl. Rungkut Kidul No.1',
        saved_addresses: [mkAddr({ id: 'home1', label: 'Rumah Rungkut', address: 'Jl. Rungkut Kidul No.1', kelurahan: 'Rungkut Kidul', kecamatan: 'Rungkut', kota: 'Surabaya', lat: -7.32, lng: 112.77, locationSource: 'gps_pin', isPrimary: true })],
      },
    });

    const out: any = await customerService.updateCustomerLocation(
      c.id,
      { kelurahan: 'Waru', kecamatan: 'Waru', kota: 'Sidoarjo', lat: -7.35, lng: 112.72, distanceKm: 18, ongkir: 25000 },
      TENANT,
    );

    // root tetap pin rumah-1 (bukan hibrida)
    expect(out.lat).toBeCloseTo(-7.32, 4);
    expect(out.lng).toBeCloseTo(112.77, 4);
    expect(out.kelurahan).toBe('Waru');
    // area baru tercatat sebagai entri baru (non-presisi)
    const list = await customerService.getSavedAddresses(c.id, TENANT);
    const newArea = list.find((a) => a.kecamatan === 'Waru');
    expect(newArea).toBeTruthy();
    expect(newArea!.locationSource).toBe('estimated_area');
  });

  it('pindah rumah eksplisit via savedAddressId: koordinat root BERPINDAH', async () => {
    const home1 = mkAddr({ id: 'home1', label: 'Rumah Rungkut', address: 'Jl. Rungkut Kidul No.1', kelurahan: 'Rungkut Kidul', kecamatan: 'Rungkut', kota: 'Surabaya', lat: -7.32, lng: 112.77, locationSource: 'gps_pin', isPrimary: true });
    const home2 = mkAddr({ id: 'home2', label: 'Rumah Waru', address: 'Jl. Kenanga No.5', kelurahan: 'Waru', kecamatan: 'Waru', kota: 'Sidoarjo', lat: -7.35, lng: 112.72, locationSource: 'gps_pin' });
    const c = await seedCustomer({
      lat: -7.32, lng: 112.77, distance_km: 10, ongkir: 15000,
      location_source: 'gps_pin', share_location_sent: true,
      preferences: { address: 'Jl. Rungkut Kidul No.1', saved_addresses: [home1, home2] },
    });

    const out: any = await customerService.updateCustomerLocation(
      c.id,
      { savedAddressId: 'home2' } as any,
      TENANT,
    );

    expect(out.lat).toBeCloseTo(-7.35, 4);
    expect(out.lng).toBeCloseTo(112.72, 4);
    const list = await customerService.getSavedAddresses(c.id, TENANT);
    expect(list.find((a) => a.isPrimary)?.id).toBe('home2');
  });
});
