import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  removeAddressFromList,
  SavedCustomerAddressSchema,
  type SavedCustomerAddress,
  type AddressTombstone,
  parseAddressTombstones,
  pruneAddressTombstones,
} from '../../src/domain/customer-address';
import { prisma } from '../../src/db/client';
import { buildApp } from '../../src/app';
import { customerService } from '../../src/services/customer.service';
import {
  InMemoryCustomerRepository,
  setCustomerRepository,
  resetCustomerRepository,
} from '../../src/repositories/customer.repository';

/**
 * Fase 0 — Fondasi backend Buku Alamat (PLAN_BUKU_ALAMAT_TRANSPARANSI_2026-10-18.md)
 *
 * Prinsip yang diuji (adversarial, bukan happy-path saja):
 * 1. Penghapusan kartu deterministik di domain: primary pindah otomatis, tidak
 *    pernah ada daftar tanpa primary (bila tidak kosong).
 * 2. Kartu yang DIPAKAI jadwal aktif DILARANG dihapus → { deleted:false, activeCount:1 }
 *    (route → 409). Jendela waktu isActiveReservation dihormati: reservasi
 *    `confirmed` dengan booking_date lewat >2 jam TIDAK lagi menghalangi hapus.
 * 3. Hapus sukses membersihkan DUA sumber: preferences JSON + baris tabel
 *    customer_addresses (dual-write cleanup, anti split-brain).
 * 4. Rename label & set-default lewat seam kanonis (upsertSavedAddress /
 *    setDefaultAddress) — tanpa jalur tulis baru.
 */

const ADMIN_KEY = 'test_admin_key_123';
const TENANT = 'tenant-buku-alamat';

// ── Fixture domain ─────────────────────────────────────────────────────────
function addr(
  id: string,
  opts: { isPrimary?: boolean; lastUsedAt: string; label?: string }
): SavedCustomerAddress {
  return SavedCustomerAddressSchema.parse({
    id,
    label: opts.label || id,
    address: `Jl. ${id} No. 1`,
    kelurahan: 'Rungkut Menanggal',
    kecamatan: 'Rungkut',
    kota: 'Surabaya',
    ongkir: 15000,
    isPrimary: opts.isPrimary ?? false,
    createdAt: '2026-10-01T00:00:00.000Z',
    lastUsedAt: opts.lastUsedAt,
  });
}

function freshList(): SavedCustomerAddress[] {
  return [
    addr('rumah-utama', { isPrimary: true, lastUsedAt: '2026-10-16T00:00:00.000Z' }),
    addr('rumah-mertua', { lastUsedAt: '2026-10-15T00:00:00.000Z' }),
    addr('rumah-orangtua', { lastUsedAt: '2026-10-10T00:00:00.000Z' }),
  ];
}

// ── Domain ──────────────────────────────────────────────────────────────────
describe('Fase 0 — domain removeAddressFromList', () => {
  it('hapus kartu sekunder → daftar menyusut, primary TIDAK berubah', () => {
    const list = freshList();
    const { list: next, removed } = removeAddressFromList(list, 'rumah-mertua');
    expect(removed?.id).toBe('rumah-mertua');
    expect(next.some((a) => a.id === 'rumah-mertua')).toBe(false);
    expect(next.find((a) => a.isPrimary)?.id).toBe('rumah-utama');
    expect(next.length).toBe(2);
  });

  it('hapus kartu PRIMARY → primary pindah ke kartu lastUsedAt terbaru (tanpa daftar tanpa primary)', () => {
    const { list: next, removed } = removeAddressFromList(freshList(), 'rumah-utama');
    expect(removed?.id).toBe('rumah-utama');
    const primaries = next.filter((a) => a.isPrimary);
    expect(primaries.length).toBe(1);
    expect(primaries[0].id).toBe('rumah-mertua');
  });

  it('hapus 1-satunya kartu → daftar kosong, TANPA error primary', () => {
    const { list: next, removed } = removeAddressFromList([freshList()[0]], 'rumah-utama');
    expect(removed?.id).toBe('rumah-utama');
    expect(next).toEqual([]);
  });

  it('hapus id yang TIDAK ada → daftar utuh + removed null (idempoten)', () => {
    const list = freshList();
    const { list: next, removed } = removeAddressFromList(list, 'tak-ada');
    expect(removed).toBeNull();
    expect(next.length).toBe(3);
    expect(next.find((a) => a.isPrimary)?.id).toBe('rumah-utama');
  });
});

// ── Service ─────────────────────────────────────────────────────────────────
async function seedCustomer(saved: SavedCustomerAddress[]): Promise<{ id: string }> {
  const repo = new InMemoryCustomerRepository();
  const created = await repo.create({ tenant_id: TENANT, phone: `6281200${Date.now()}`, name: 'Bunda Firda' });
  await repo.update(created.id, {
    preferences: {
      saved_addresses: JSON.parse(JSON.stringify(saved)),
      address: saved[0]?.address || null,
    },
  } as any);
  setCustomerRepository(repo);
  return created;
}

describe('Fase 0 — service deleteSavedAddress', () => {
  beforeEach(() => {
    resetCustomerRepository();
    vi.mocked(prisma.reservation.findMany).mockReset();
    vi.mocked(prisma.customerAddress.deleteMany).mockReset();
  });
  afterEach(() => {
    resetCustomerRepository();
    vi.restoreAllMocks();
  });

  it('kartu dipakai jadwal AKTIF → DILARANG (deleted:false, activeCount:1, ZERO tulis)', async () => {
    const customer = await seedCustomer(freshList());
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([
      {
        id: 'res-aktif',
        customer_id: customer.id,
        status: 'confirmed',
        booking_date: new Date(Date.now() + 60 * 60 * 1000),
        customer_address_id: 'rumah-mertua',
      },
    ] as any);
    const deleteSpy = vi.mocked(prisma.customerAddress.deleteMany);

    const res = await customerService.deleteSavedAddress(customer.id, 'rumah-mertua', TENANT);

    expect(res).toEqual({ deleted: false, activeCount: 1 });
    // Zero tulis: JSON utuh, baris tabel TIDAK dihapus.
    const after = await customerService.getSavedAddresses(customer.id, TENANT);
    expect(after.length).toBe(3);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('reservasi confirmed dengan booking_date SUDAH LEWAT >2 jam → TIDAK menghalangi hapus (jendela dihormati)', async () => {
    const customer = await seedCustomer(freshList());
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([
      {
        id: 'res-basi',
        customer_id: customer.id,
        status: 'confirmed',
        booking_date: new Date(Date.now() - 24 * 60 * 60 * 1000),
        customer_address_id: 'rumah-mertua',
      },
    ] as any);

    const res = await customerService.deleteSavedAddress(customer.id, 'rumah-mertua', TENANT);
    expect(res).toEqual({ deleted: true, activeCount: 0 });
  });

  it('hapus sukses → JSON berkurang + baris tabel customer_addresses ikut dihapus (anti split-brain)', async () => {
    const customer = await seedCustomer(freshList());
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([] as any);
    const deleteSpy = vi.mocked(prisma.customerAddress.deleteMany).mockResolvedValue({ count: 1 } as any);

    const res = await customerService.deleteSavedAddress(customer.id, 'rumah-orangtua', TENANT);

    expect(res).toEqual({ deleted: true, activeCount: 0 });
    const after = await customerService.getSavedAddresses(customer.id, TENANT);
    expect(after.length).toBe(2);
    expect(after.some((a) => a.id === 'rumah-orangtua')).toBe(false);
    expect(deleteSpy).toHaveBeenCalledWith({
      where: { id: 'rumah-orangtua', customer_id: customer.id, tenant_id: TENANT },
    });
  });

  it('hapus PRIMARY → primary otomatis pindah ke kartu tersisa (invarian tetap 1 primary)', async () => {
    const customer = await seedCustomer(freshList());
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([] as any);

    await customerService.deleteSavedAddress(customer.id, 'rumah-utama', TENANT);

    const after = await customerService.getSavedAddresses(customer.id, TENANT);
    expect(after.length).toBe(2);
    expect(after.filter((a) => a.isPrimary).length).toBe(1);
    expect(after.find((a) => a.isPrimary)?.id).toBe('rumah-mertua');
  });

  it('customer tidak dikenal → {deleted:false, activeCount:0} tanpa melempar', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([] as any);
    const res = await customerService.deleteSavedAddress('cust-penghilang', 'x', TENANT);
    expect(res).toEqual({ deleted: false, activeCount: 0 });
  });

  it('kartu tidak ada di daftar → {deleted:false, activeCount:0} (idempoten)', async () => {
    const customer = await seedCustomer(freshList());
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([] as any);
    const res = await customerService.deleteSavedAddress(customer.id, 'tak-ada', TENANT);
    expect(res).toEqual({ deleted: false, activeCount: 0 });
    expect(await customerService.getSavedAddresses(customer.id, TENANT)).toHaveLength(3);
  });
});

// ── Routes ──────────────────────────────────────────────────────────────────
describe('Fase 0 — routes buku alamat (admin)', () => {
  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
  });
  afterEach(() => {
    resetCustomerRepository();
    vi.restoreAllMocks();
  });

  it('DELETE 200 saat kartu bebas jadwal aktif', async () => {
    vi.spyOn(customerService, 'getSavedAddresses').mockResolvedValue([
      { id: 'addr-9', label: 'Rumah Uji' } as any,
    ]);
    const spy = vi
      .spyOn(customerService as any, 'deleteSavedAddress')
      .mockResolvedValue({ deleted: true, activeCount: 0 });
    const app = buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/customers/cust-1/addresses/addr-9',
      headers: { 'x-api-key': ADMIN_KEY },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true, deleted: true });
    expect(spy).toHaveBeenCalledWith('cust-1', 'addr-9', expect.any(String));
  });

  it('DELETE 409 + activeCount saat kartu dipakai jadwal aktif', async () => {
    vi.spyOn(customerService, 'getSavedAddresses').mockResolvedValue([
      { id: 'addr-9', label: 'Rumah Uji' } as any,
    ]);
    vi.spyOn(customerService as any, 'deleteSavedAddress').mockResolvedValue({
      deleted: false,
      activeCount: 2,
    });
    const app = buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/customers/cust-1/addresses/addr-9',
      headers: { 'x-api-key': ADMIN_KEY },
    });
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.activeCount).toBe(2);
    expect(body.error).toMatch(/jadwal aktif/);
  });

  it('DELETE 404 saat kartu tidak ada di daftar', async () => {
    vi.spyOn(customerService, 'getSavedAddresses').mockResolvedValue([]);
    const app = buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/customers/cust-1/addresses/addr-x',
      headers: { 'x-api-key': ADMIN_KEY },
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH default 200 → delegasi ke setDefaultAddress', async () => {
    const spy = vi.spyOn(customerService as any, 'setDefaultAddress').mockResolvedValue(undefined);
    vi.spyOn(customerService, 'getSavedAddresses').mockResolvedValue([
      { id: 'addr-9', label: 'Rumah Uji' } as any,
    ]);
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/customers/cust-1/addresses/addr-9/default',
      headers: { 'x-api-key': ADMIN_KEY },
    });
    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith('cust-1', 'addr-9', expect.any(String));
  });

  it('PATCH default 404 saat kartu tidak ada', async () => {
    vi.spyOn(customerService, 'getSavedAddresses').mockResolvedValue([]);
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/customers/cust-1/addresses/addr-x/default',
      headers: { 'x-api-key': ADMIN_KEY },
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH label 200 → delegasi upsertSavedAddress dengan field kartu lama + label baru', async () => {
    const lama = freshList()[1];
    vi.spyOn(customerService, 'getSavedAddresses').mockResolvedValue([lama]);
    const upsertSpy = vi
      .spyOn(customerService, 'upsertSavedAddress')
      .mockResolvedValue({ ...lama, label: 'Rumah Kedua' });
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/customers/cust-1/addresses/${lama.id}/label`,
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { label: 'Rumah Kedua' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).entry.label).toBe('Rumah Kedua');
    expect(upsertSpy).toHaveBeenCalledWith(
      'cust-1',
      expect.objectContaining({
        id: lama.id,
        address: lama.address,
        label: 'Rumah Kedua',
      }),
      expect.any(String)
    );
  });

  it('PATCH label 400 saat label kosong/whitespace (validasi ketat)', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/customers/cust-1/addresses/addr-9/label',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { label: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH label 404 saat kartu tidak ada', async () => {
    vi.spyOn(customerService, 'getSavedAddresses').mockResolvedValue([]);
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/customers/cust-1/addresses/addr-x/label',
      headers: { 'x-api-key': ADMIN_KEY },
      payload: { label: 'Rumah Kedua' },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── Fase S-3 & S-UX: Tombstone, Anti-Rebirth, & POST Address Route ──────────
describe('Fase S-3: Tombstones & Anti-Rebirth', () => {
  beforeEach(() => {
    resetCustomerRepository();
    vi.mocked(prisma.reservation.findMany).mockReset();
    vi.mocked(prisma.customerAddress.deleteMany).mockReset();
  });
  afterEach(() => {
    resetCustomerRepository();
    vi.restoreAllMocks();
  });

  it('hapus kartu → rekam tombstone ke preferences', async () => {
    const list = [
      addr('rumah-1', { isPrimary: true, lastUsedAt: '2026-10-16T00:00:00.000Z' }),
      addr('rumah-2', { lastUsedAt: '2026-10-15T00:00:00.000Z' }),
    ];
    const customer = await seedCustomer(list);
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([]);

    const res = await customerService.deleteSavedAddress(customer.id, 'rumah-2', TENANT);
    expect(res.deleted).toBe(true);

    const updated = await customerService.getCustomerById(customer.id, TENANT);
    const tombstones = parseAddressTombstones(updated?.preferences);
    expect(tombstones.length).toBe(1);
    expect(tombstones[0].address).toBe('Jl. rumah-2 No. 1');
    expect(tombstones[0].deletedAt).toBeDefined();
  });

  it('anti-rebirth: sync lokasi dari pesan/link yang cocok dengan tombstone TIDAK membuat kartu baru', async () => {
    const list = [
      addr('rumah-1', { isPrimary: true, lastUsedAt: '2026-10-16T00:00:00.000Z' }),
      addr('rumah-2', { lastUsedAt: '2026-10-15T00:00:00.000Z' }),
    ];
    const customer = await seedCustomer(list);
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([]);

    // Hapus rumah-2
    await customerService.deleteSavedAddress(customer.id, 'rumah-2', TENANT);

    // Coba syncSavedAddressFromLocation dengan alamat yang sama persis dengan rumah-2
    await (customerService as any).syncSavedAddressFromLocation(
      await customerService.getCustomerById(customer.id, TENANT),
      TENANT,
      {
        address: 'Jl. rumah-2 No. 1',
        kelurahan: 'Rungkut Menanggal',
        kecamatan: 'Rungkut',
        kota: 'Surabaya',
      }
    );

    // Verifikasi: rumah-2 TIDAK bangkit kembali (anti-rebirth terjaga)
    const afterSync = await customerService.getSavedAddresses(customer.id, TENANT);
    expect(afterSync.length).toBe(1);
    expect(afterSync[0].id).toBe('rumah-1');
  });

  it('tombstone >90 hari kedaluwarsa dan dibuang saat pruning', () => {
    const nowIso = new Date().toISOString();
    const oldDate = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000).toISOString();
    const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    const tombstones: AddressTombstone[] = [
      { address: 'Jl. Basi No. 1', deletedAt: oldDate },
      { address: 'Jl. Baru No. 2', deletedAt: recentDate },
    ];

    const pruned = pruneAddressTombstones(tombstones, nowIso);
    expect(pruned.length).toBe(1);
    expect(pruned[0].address).toBe('Jl. Baru No. 2');
  });

  it('admin/user sengaja re-add alamat via addSavedAddress → tombstone yang cocok dibersihkan', async () => {
    const list = [
      addr('rumah-1', { isPrimary: true, lastUsedAt: '2026-10-16T00:00:00.000Z' }),
      addr('rumah-2', { lastUsedAt: '2026-10-15T00:00:00.000Z' }),
    ];
    const customer = await seedCustomer(list);
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([]);

    // Hapus rumah-2
    await customerService.deleteSavedAddress(customer.id, 'rumah-2', TENANT);
    let cust = await customerService.getCustomerById(customer.id, TENANT);
    expect(parseAddressTombstones(cust?.preferences).length).toBe(1);

    // Admin secara sengaja menambahkan kembali alamat tersebut via addSavedAddress
    await customerService.addSavedAddress(
      customer.id,
      {
        label: 'Rumah 2 Baru',
        address: 'Jl. rumah-2 No. 1',
        kelurahan: 'Rungkut Menanggal',
        kecamatan: 'Rungkut',
        kota: 'Surabaya',
      },
      TENANT
    );

    // Verifikasi: kartu berhasil ditambah dan tombstone dibersihkan
    const addresses = await customerService.getSavedAddresses(customer.id, TENANT);
    expect(addresses.length).toBe(2);
    cust = await customerService.getCustomerById(customer.id, TENANT);
    expect(parseAddressTombstones(cust?.preferences).length).toBe(0);
  });

  it('reservationCoreService.resolveCustomerAddressId mengabaikan kandidat yang di-tombstone dan fallback ke primary', async () => {
    const list = [
      addr('rumah-1', { isPrimary: true, lastUsedAt: '2026-10-16T00:00:00.000Z' }),
      addr('rumah-2', { lastUsedAt: '2026-10-15T00:00:00.000Z' }),
    ];
    const customer = await seedCustomer(list);
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([]);

    // Hapus rumah-2
    await customerService.deleteSavedAddress(customer.id, 'rumah-2', TENANT);

    const { resolveCustomerAddressId } = await import('../../src/services/reservation-core.service');
    const resolvedId = await resolveCustomerAddressId({
      tenantId: TENANT,
      customerId: customer.id,
      candidate: {
        address: 'Jl. rumah-2 No. 1',
        kelurahan: 'Rungkut Menanggal',
        kecamatan: 'Rungkut',
        kota: 'Surabaya',
      },
    });

    // Harus fallback ke primary ('rumah-1'), BUKAN membuat kartu baru untuk rumah-2
    expect(resolvedId).toBe('rumah-1');
    const afterResolve = await customerService.getSavedAddresses(customer.id, TENANT);
    expect(afterResolve.length).toBe(1);
  });
});

describe('Fase S-UX.2 & S-4: POST /api/admin/customers/:id/addresses and Tenant Isolation', () => {
  beforeEach(() => {
    resetCustomerRepository();
  });
  afterEach(() => {
    resetCustomerRepository();
    vi.restoreAllMocks();
  });

  it('POST /api/admin/customers/:id/addresses sukses membuat alamat baru (201)', async () => {
    const customer = await seedCustomer([
      addr('rumah-1', { isPrimary: true, lastUsedAt: '2026-10-16T00:00:00.000Z' }),
    ]);
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/customers/${customer.id}/addresses`,
      headers: { 'x-api-key': ADMIN_KEY, 'x-tenant-id': TENANT },
      payload: {
        label: 'Kantor Suami',
        address: 'Jl. Pemuda No. 45',
        kelurahan: 'Embong Kaliasin',
        kecamatan: 'Genteng',
        kota: 'Surabaya',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.entry.label).toBe('Kantor Suami');
    expect(body.entry.address).toBe('Jl. Pemuda No. 45');

    const addresses = await customerService.getSavedAddresses(customer.id, TENANT);
    expect(addresses.length).toBe(2);
  });

  it('POST /api/admin/customers/:id/addresses validasi label wajib (400 saat kosong)', async () => {
    const customer = await seedCustomer([]);
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/customers/${customer.id}/addresses`,
      headers: { 'x-api-key': ADMIN_KEY, 'x-tenant-id': TENANT },
      payload: {
        label: '   ',
        address: 'Jl. Pemuda No. 45',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Label wajib diisi/i);
  });

  it('POST /api/admin/customers/:id/addresses validasi label terlalu panjang (400)', async () => {
    const customer = await seedCustomer([]);
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/customers/${customer.id}/addresses`,
      headers: { 'x-api-key': ADMIN_KEY, 'x-tenant-id': TENANT },
      payload: {
        label: 'R'.repeat(61),
        address: 'Jl. Pemuda No. 45',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Label maksimal 60 karakter/i);
  });

  it('POST /api/admin/customers/:id/addresses 404 saat customer tidak ditemukan', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/customers/cust-tidak-ada/addresses',
      headers: { 'x-api-key': ADMIN_KEY, 'x-tenant-id': TENANT },
      payload: {
        label: 'Kantor',
        address: 'Jl. Pemuda No. 45',
      },
    });

    expect(res.statusCode).toBe(404);
  });

  it('S-4 IDOR Guard: akses cross-tenant pada endpoint alamat customer ditolak (404)', async () => {
    const customer = await seedCustomer([
      addr('rumah-1', { isPrimary: true, lastUsedAt: '2026-10-16T00:00:00.000Z' }),
    ]);
    const app = buildApp();

    // Mencoba akses customer TENANT dari TENANT_LAIN
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/customers/${customer.id}/addresses`,
      headers: { 'x-api-key': ADMIN_KEY, 'x-tenant-id': 'tenant-asing' },
      payload: {
        label: 'Hacker Address',
        address: 'Jl. Terlarang No. 99',
      },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('PUT: edit alamat lengkap (/api/admin/customers/:id/addresses/:addressId)', () => {
  beforeEach(() => {
    resetCustomerRepository();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    resetCustomerRepository();
    vi.restoreAllMocks();
  });

  it('PUT teks jalan kartu sekunder -> tersimpan di JSON dan delegasi upsertSavedAddress dipanggil dengan id kartu (spy)', async () => {
    const customer = await seedCustomer([
      addr('rumah-1', { isPrimary: true, lastUsedAt: '2026-10-16T00:00:00.000Z' }),
      addr('rumah-2', { isPrimary: false, lastUsedAt: '2026-10-15T00:00:00.000Z' }),
    ]);
    const spy = vi.spyOn(customerService, 'upsertSavedAddress');
    const app = buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/customers/${customer.id}/addresses/rumah-2`,
      headers: { 'x-api-key': ADMIN_KEY, 'x-tenant-id': TENANT },
      payload: {
        address: 'Jl. Rungkut Asri Timur No. 88',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.entry.address).toBe('Jl. Rungkut Asri Timur No. 88');
    expect(spy).toHaveBeenCalledWith(
      customer.id,
      expect.objectContaining({
        id: 'rumah-2',
        address: 'Jl. Rungkut Asri Timur No. 88',
      }),
      TENANT
    );

    const addresses = await customerService.getSavedAddresses(customer.id, TENANT);
    const card = addresses.find((a) => a.id === 'rumah-2');
    expect(card?.address).toBe('Jl. Rungkut Asri Timur No. 88');
  });

  it('PUT koordinat kartu sekunder + jadwal aktif menunjuk kartu -> customer_address_id reservasi relink; PUT landmark/foto saja -> TIDAK memicu relink (gate koordinat, D-1)', async () => {
    const customer = await seedCustomer([
      addr('rumah-1', { isPrimary: true, lastUsedAt: '2026-10-16T00:00:00.000Z' }),
      addr('rumah-2', { isPrimary: false, lastUsedAt: '2026-10-15T00:00:00.000Z' }),
    ]);
    const app = buildApp();

    vi.mocked(prisma.reservation.findMany).mockResolvedValue([
      {
        id: 'res-aktif-kartu-2',
        customer_id: customer.id,
        customer_address_id: 'rumah-2',
        status: 'confirmed',
        booking_date: new Date(Date.now() + 2 * 60 * 60 * 1000),
      },
    ] as any);
    const updateSpy = vi.mocked(prisma.reservation.update).mockResolvedValue({} as any);

    // 1. PUT landmark saja (koordinat tidak berubah) -> TIDAK memicu relink
    const resLandmark = await app.inject({
      method: 'PUT',
      url: `/api/admin/customers/${customer.id}/addresses/rumah-2`,
      headers: { 'x-api-key': ADMIN_KEY, 'x-tenant-id': TENANT },
      payload: {
        landmark: 'Pagar cat hitam',
      },
    });
    expect(resLandmark.statusCode).toBe(200);
    expect(updateSpy).not.toHaveBeenCalled();

    // 2. PUT koordinat baru -> MEMICU relink jadwal aktif
    const resCoords = await app.inject({
      method: 'PUT',
      url: `/api/admin/customers/${customer.id}/addresses/rumah-2`,
      headers: { 'x-api-key': ADMIN_KEY, 'x-tenant-id': TENANT },
      payload: {
        lat: -7.310000,
        lng: 112.750000,
        ongkir: 20000,
      },
    });
    expect(resCoords.statusCode).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'res-aktif-kartu-2' },
        data: expect.objectContaining({
          customer_address_id: 'rumah-2',
          delivery_fee: 20000,
        }),
      })
    );
  });

  it('PUT lat/lng tak valid (string "abc") -> diabaikan, nilai lama bertahan', async () => {
    const customer = await seedCustomer([
      addr('rumah-1', { isPrimary: true, lastUsedAt: '2026-10-16T00:00:00.000Z' }),
    ]);
    const app = buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/customers/${customer.id}/addresses/rumah-1`,
      headers: { 'x-api-key': ADMIN_KEY, 'x-tenant-id': TENANT },
      payload: {
        lat: 'abc' as any,
        lng: 'xyz' as any,
      },
    });

    expect(res.statusCode).toBe(200);
    const addresses = await customerService.getSavedAddresses(customer.id, TENANT);
    const card = addresses.find((a) => a.id === 'rumah-1');
    expect(typeof card?.lat === 'number' || card?.lat === null || card?.lat === undefined).toBe(true);
    expect(card?.lat).not.toBe('abc');
  });

  it('IDOR tenant: PUT kartu customer tenant lain dengan x-tenant-id: "tenant-asing" -> 404', async () => {
    const customer = await seedCustomer([
      addr('rumah-1', { isPrimary: true, lastUsedAt: '2026-10-16T00:00:00.000Z' }),
    ]);
    const app = buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/customers/${customer.id}/addresses/rumah-1`,
      headers: { 'x-api-key': ADMIN_KEY, 'x-tenant-id': 'tenant-asing' },
      payload: {
        address: 'Jl. Usurpation No. 1',
      },
    });

    expect(res.statusCode).toBe(404);
  });

  it('Label 61 char -> 400', async () => {
    const customer = await seedCustomer([
      addr('rumah-1', { isPrimary: true, lastUsedAt: '2026-10-16T00:00:00.000Z' }),
    ]);
    const app = buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/customers/${customer.id}/addresses/rumah-1`,
      headers: { 'x-api-key': ADMIN_KEY, 'x-tenant-id': TENANT },
      payload: {
        label: 'A'.repeat(61),
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Label maksimal 60 karakter/i);
  });
});

