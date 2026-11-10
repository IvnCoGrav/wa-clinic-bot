import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { customerService } from '../../src/services/customer.service';
import { resolveCustomerAddressId } from '../../src/services/reservation-core.service';
import {
  reconcileAddressLists,
  type SavedCustomerAddress,
} from '../../src/domain/customer-address';
import { getCustomerRepository } from '../../src/repositories/customer.repository';

/**
 * Regresi insiden alamat kedua (Bunda Briella, 2026-11-05):
 * - Kartu "Rumah Gunung Anyar" ADA di tabel `customer_addresses` tetapi hilang
 *   dari `preferences.saved_addresses` → tidak terlihat di Buku Alamat/AI.
 * - Kartu itu mewarisi wilayah kartu lain (Karangpoh/Tandes).
 * - Reservasi besok tertaut ke kartu Tandes karena kandidat tanpa koordinat
 *   meminjam koordinat root customer.
 *
 * Prinsip uji: state & kontrak data (bukan hafalan kalimat), termasuk parafrase
 * teks alamat yang berbeda tanda baca.
 */

const TENANT = 'tenant-address-single-source';
let phoneSeq = 9000;
const nextPhone = () => `62888${(phoneSeq++).toString().padStart(7, '0')}`;

function card(over: Partial<SavedCustomerAddress> & { id: string }): SavedCustomerAddress {
  return {
    label: over.label ?? `Rumah ${over.id}`,
    address: over.address ?? `Jl. ${over.id} No. 1`,
    kelurahan: over.kelurahan ?? 'Karangpoh',
    kecamatan: over.kecamatan ?? 'Tandes',
    kota: over.kota ?? 'Surabaya',
    lat: over.lat ?? null,
    lng: over.lng ?? null,
    distanceKm: over.distanceKm ?? null,
    ongkir: over.ongkir ?? null,
    landmark: over.landmark ?? null,
    locationSource: over.locationSource ?? null,
    isPrimary: over.isPrimary ?? false,
    createdAt: over.createdAt ?? '2026-10-25T12:33:35.758Z',
    lastUsedAt: over.lastUsedAt ?? '2026-11-05T14:19:57.469Z',
    ...over,
  } as SavedCustomerAddress;
}

async function seedCustomerWithAddresses(addresses: SavedCustomerAddress[], prefsOverride?: any) {
  const customer: any = await customerService.getOrCreateCustomer(nextPhone(), 'Bunda Uji Alamat', TENANT);
  const repo = getCustomerRepository();
  const current: any = await repo.findById(customer.id, TENANT);
  await repo.update(customer.id, {
    preferences: {
      ...((current?.preferences as any) || {}),
      saved_addresses: JSON.parse(JSON.stringify(addresses)),
      saved_addresses_updated_at: '2026-11-05T14:21:26.050Z',
      ...(prefsOverride || {}),
    },
  } as any, TENANT);
  return customer;
}

describe('Buku alamat — satu sumber kebenaran (regresi 2026-11-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    customerService.getMemoryCustomers().clear();
  });

  describe('domain reconcileAddressLists', () => {
    it('kartu kanonis yang tidak ada di cache TETAP dikembalikan (anti kartu tak terlihat)', () => {
      const tande = card({ id: 'tandes', isPrimary: true });
      const gunungAnyar = card({
        id: 'gunung-anyar',
        address: 'Gunung anyar lor no 94',
        kelurahan: 'Gunung Anyar Lor',
        kecamatan: 'Gunung Anyar',
      });
      const merged = reconcileAddressLists([tande, gunungAnyar], [tande]);
      expect(merged.map((a) => a.id).sort()).toEqual(['gunung-anyar', 'tandes']);
      expect(merged.filter((a) => a.isPrimary).map((a) => a.id)).toEqual(['tandes']);
    });

    it('cache-only yang identik dengan kartu kanonis TIDAK menghasilkan duplikat', () => {
      const canonical = card({ id: 'kanonik', isPrimary: true });
      const duplicate = card({ id: 'cache-lama', address: 'Jl. kanonik No. 1' }); // alamat sama, id beda
      const merged = reconcileAddressLists([canonical], [duplicate]);
      expect(merged).toHaveLength(1);
      expect(merged[0].id).toBe('kanonik');
    });

    it('primary kanonis menang; bila kanonis kosong, primary cache dipertahankan', () => {
      const a = card({ id: 'a', isPrimary: true });
      const b = card({ id: 'b', isPrimary: false, address: 'Jl. Beda 2' });
      expect(reconcileAddressLists([a], [b]).find((x) => x.isPrimary)?.id).toBe('a');

      const mergedEmptyCanonical = reconcileAddressLists([], [b]);
      expect(mergedEmptyCanonical.find((x) => x.isPrimary)?.id).toBe('b');
    });
  });

  describe('getSavedAddresses — tabel kanonis ∪ cache preferences', () => {
    it('kartu tabel yang hilang dari preferences tetap terbaca (kasus Gunung Anyar)', async () => {
      const tande = card({ id: '72dc1274', isPrimary: true, address: 'Gadel, tandes' });
      const customer = await seedCustomerWithAddresses([tande]);

      vi.mocked(prisma.customerAddress.findMany).mockResolvedValueOnce([
        {
          id: '72dc1274', label: 'Rumah Tandes', address: 'Gadel, tandes',
          kelurahan: 'Karangpoh', kecamatan: 'Tandes', kota: 'Surabaya',
          lat: -7.260442, lng: 112.681097, distance_km: 19.77, ongkir: 15000,
          location_source: 'estimated_area', is_primary: true,
          created_at: new Date('2026-10-25T12:33:35.758Z'),
          last_used_at: new Date('2026-11-05T14:22:55.928Z'),
        },
        {
          id: 'eb642bc1', label: 'Rumah Tandes 2', address: 'Gunung anyar lor no 94',
          kelurahan: 'Karangpoh', kecamatan: 'Tandes', kota: 'Surabaya',
          lat: null, lng: null, distance_km: null, ongkir: null,
          location_source: null, is_primary: false,
          created_at: new Date('2026-11-05T14:19:57.469Z'),
          last_used_at: new Date('2026-11-05T14:19:57.469Z'),
        },
      ] as any);

      const list = await customerService.getSavedAddresses(customer.id, TENANT);
      expect(list).toHaveLength(2);
      expect(list.find((a) => a.id === 'eb642bc1')?.address).toBe('Gunung anyar lor no 94');
      expect(list.find((a) => a.isPrimary)?.id).toBe('72dc1274');
    });

    it('DB tabel tidak tersedia → fallback murni preferences (perilaku lama tetap aman)', async () => {
      const only = card({ id: 'prefs-only', isPrimary: true });
      const customer = await seedCustomerWithAddresses([only]);
      const list = await customerService.getSavedAddresses(customer.id, TENANT);
      expect(list.map((a) => a.id)).toEqual(['prefs-only']);
    });
  });

  describe('mergeCustomerPreferences — patch parsial tidak menghapus buku alamat', () => {
    it('menulis preferences.address TANPA menghilangkan saved_addresses', async () => {
      const tande = card({ id: 'tandes', isPrimary: true, address: 'Gadel, tandes' });
      const customer = await seedCustomerWithAddresses([tande]);

      await customerService.mergeCustomerPreferences(customer.id, TENANT, {
        address: 'Gunung anyar lor no 94',
      });

      const fresh: any = await customerService.getCustomerById(customer.id, TENANT);
      expect(fresh.preferences.address).toBe('Gunung anyar lor no 94');
      expect(fresh.preferences.saved_addresses).toHaveLength(1);
      expect(fresh.preferences.saved_addresses[0].id).toBe('tandes');
    });

    it('patch kosong/undefined tidak menulis apa pun (idempoten)', async () => {
      const tande = card({ id: 'tandes', isPrimary: true });
      const customer = await seedCustomerWithAddresses([tande]);
      const before: any = await customerService.getCustomerById(customer.id, TENANT);
      await customerService.mergeCustomerPreferences(customer.id, TENANT, { address: undefined });
      const after: any = await customerService.getCustomerById(customer.id, TENANT);
      expect(after.preferences).toEqual(before.preferences);
    });
  });

  describe('resolveCustomerAddressId — rumah kedua tidak boleh "ditarik" ke primary', () => {
    async function seedTwoHouses() {
      const customer: any = await customerService.getOrCreateCustomer(
        nextPhone(),
        'Bunda Briella Uji',
        TENANT
      );
      const tande = await customerService.upsertSavedAddress(
        customer.id,
        {
          label: 'Rumah Tandes',
          address: 'Gadel, tandes',
          kelurahan: 'Karangpoh',
          kecamatan: 'Tandes',
          kota: 'Surabaya',
          lat: -7.260442,
          lng: 112.681097,
          distanceKm: 19.77,
          ongkir: 15000,
          locationSource: 'estimated_area',
          isPrimary: true,
        },
        TENANT
      );
      const gunungAnyar = await customerService.upsertSavedAddress(
        customer.id,
        {
          label: 'Rumah Gunung Anyar',
          address: 'Gunung anyar lor no 94',
          kelurahan: 'Gunung Anyar Lor',
          kecamatan: 'Gunung Anyar',
          kota: 'Surabaya',
          // koordinat sengaja NULL: customer baru akan shareloc besok
        },
        TENANT
      );

      // Profil root masih rumah Tandes (primary) — sumber jebakan lama.
      const repo = getCustomerRepository();
      const current: any = await repo.findById(customer.id, TENANT);
      await repo.update(customer.id, {
        lat: -7.260442,
        lng: 112.681097,
        distance_km: 19.77,
        ongkir: 15000,
        location_source: 'estimated_area',
        kelurahan: 'Karangpoh',
        kecamatan: 'Tandes',
        kota: 'Surabaya',
        preferences: { ...((current?.preferences as any) || {}), address: 'Gadel, tandes' },
      } as any, TENANT);

      return { customer, tande, gunungAnyar };
    }

    it('teks alamat identik kartu sekunder → kartu sekunder yang dipilih (bukan primary)', async () => {
      const { customer, tande, gunungAnyar } = await seedTwoHouses();

      const resolvedId = await resolveCustomerAddressId({
        customerId: customer.id,
        tenantId: TENANT,
        // Parafrase tanda baca: "No.94" vs "no 94" harus tetap rumah yang sama.
        candidate: { address: 'Gunung anyar lor No.94' } as any,
      });

      expect(resolvedId).toBe(gunungAnyar?.id);
      expect(resolvedId).not.toBe(tande?.id);

      const list = await customerService.getSavedAddresses(customer.id, TENANT);
      expect(list).toHaveLength(2); // tidak melahirkan kartu baru
    });

    it('rumah BARU tanpa koordinat → DILARANG meminjam koordinat root (anti tertaut primary)', async () => {
      const { customer, tande } = await seedTwoHouses();

      const resolvedId = await resolveCustomerAddressId({
        customerId: customer.id,
        tenantId: TENANT,
        candidate: { address: 'Jl. Melati Baru No. 7' } as any,
      });

      expect(resolvedId).not.toBe(tande?.id);
      const list = await customerService.getSavedAddresses(customer.id, TENANT);
      const created = list.find((a) => a.id === resolvedId);
      expect(created).toBeDefined();
      expect(created?.address).toBe('Jl. Melati Baru No. 7');
      // Koordinat root Tandes TIDAK boleh menempel ke rumah baru.
      expect(created?.lat).toBeNull();
      expect(created?.lng).toBeNull();
      expect(created?.isPrimary).toBe(false);
    });
  });
});
