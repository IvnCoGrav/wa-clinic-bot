import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { customerService } from '../../src/services/customer.service';
import { resolveCustomerAddressId } from '../../src/services/reservation-core.service';
import { reservationLifecycleService } from '../../src/services/reservation-lifecycle.service';
import { StaffReservationService } from '../../src/services/staff-reservation.service';
import { formatReservationToRow } from '../../src/services/sheets/row-formatter';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { addressesMatch, type SavedCustomerAddress } from '../../src/domain/customer-address';

const TENANT = DEFAULT_TENANT_ID;

let phoneSeq = 100;
const nextPhone = (): string => `628799${(phoneSeq++).toString().padStart(6, '0')}`;

describe('Adversarial & Regression Test: Multi-Rumah Pelanggan (Rumah 1 vs Rumah 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    customerService.getMemoryCustomers().clear();
  });

  describe('1. Resolusi Alamat & Dedup Spasial (<150m)', () => {
    it('membuat entri Rumah 2 otomatis saat kandidat berbeda dengan Rumah 1 (primary)', async () => {
      const phone = nextPhone();
      const customer: any = await customerService.getOrCreateCustomer(phone, 'Bunda Multi Rumah', TENANT);
      
      // Simpan Rumah 1 di Grogol sebagai alamat utama (primary)
      const r1 = await customerService.upsertSavedAddress(customer.id, {
        address: 'Jl. Melati No. 12, Grogol',
        kelurahan: 'Grogol',
        kecamatan: 'Tulangan',
        kota: 'Sidoarjo',
        lat: -7.4812,
        lng: 112.6521,
        distanceKm: 12.5,
        ongkir: 15000,
        isPrimary: true,
      }, TENANT);

      expect(r1).not.toBeNull();
      expect(r1?.isPrimary).toBe(true);

      // Kandidat baru saat reservasi: Rumah 2 di Buduran
      const candidateRumah2 = {
        address: 'Perumahan Buduran Asri Blok C-10',
        kelurahan: 'Buduran',
        kecamatan: 'Buduran',
        kota: 'Sidoarjo',
        lat: -7.4255,
        lng: 112.7214,
        distanceKm: 18.0,
        ongkir: 22000,
      };

      const resolvedId = await resolveCustomerAddressId({
        customerId: customer.id,
        tenantId: TENANT,
        candidate: candidateRumah2,
      });
      expect(resolvedId).toBeDefined();
      expect(resolvedId).not.toBe(r1?.id);

      // Verifikasi daftar alamat tersimpan kini memiliki 2 rumah
      const allAddresses = await customerService.getSavedAddresses(customer.id, TENANT);
      expect(allAddresses).toHaveLength(2);

      const r2 = allAddresses.find((a) => a.id === resolvedId);
      expect(r2).toBeDefined();
      expect(r2?.kelurahan).toBe('Buduran');
      expect(r2?.isPrimary).toBe(false); // Rumah 2 bukan primary
    });

    it('dedup spasial: tidak membuat Rumah 3 jika kandidat berada dalam radius <150m dari Rumah 1', async () => {
      const phone = nextPhone();
      const customer: any = await customerService.getOrCreateCustomer(phone, 'Bunda Anti Duplikat', TENANT);
      
      // Rumah 1
      const r1 = await customerService.upsertSavedAddress(customer.id, {
        address: 'Jl. Melati No. 12, Grogol',
        kelurahan: 'Grogol',
        kecamatan: 'Tulangan',
        kota: 'Sidoarjo',
        lat: -7.481200,
        lng: 112.652100,
        isPrimary: true,
      }, TENANT);

      // Kandidat yang sedikit bergeser ~80 meter (misal shareloc di depan gerbang komplek)
      const candidateNearR1 = {
        address: 'Jl. Melati No. 14 (depan portal), Grogol',
        kelurahan: 'Grogol',
        kecamatan: 'Tulangan',
        kota: 'Sidoarjo',
        lat: -7.481600, // pergeseran ~50 meter
        lng: 112.652150,
      };

      const resolvedId = await resolveCustomerAddressId({
        customerId: customer.id,
        tenantId: TENANT,
        candidate: candidateNearR1,
      });
      // Harus menggunakan ID Rumah 1 yang sudah ada
      expect(resolvedId).toBe(r1?.id);

      const allAddresses = await customerService.getSavedAddresses(customer.id, TENANT);
      expect(allAddresses).toHaveLength(1);
    });
  });

  describe('2. Integritas Profil Pelanggan & Lifecycle Reservasi', () => {
    it('onReservationCreated TIDAK menimpa alamat utama pelanggan di profil root saat memesan Rumah 2', async () => {
      const phone = nextPhone();
      const customer: any = await customerService.getOrCreateCustomer(phone, 'Bunda Lindungi Profil', TENANT);
      
      // Set profil root & Rumah 1
      customer.address = 'Jl. Melati No. 12, Grogol';
      customer.kelurahan = 'Grogol';
      customer.kecamatan = 'Tulangan';
      customer.kota = 'Sidoarjo';
      customer.lat = -7.4812;
      customer.lng = 112.6521;
      customer.distance_km = 12.5;
      customer.ongkir = 15000;

      await customerService.upsertSavedAddress(customer.id, {
        address: customer.address,
        kelurahan: customer.kelurahan,
        kecamatan: customer.kecamatan,
        kota: customer.kota,
        lat: customer.lat,
        lng: customer.lng,
        distanceKm: customer.distance_km,
        ongkir: customer.ongkir,
        isPrimary: true,
      }, TENANT);

      // Simpan entri Rumah 2
      const r2 = await customerService.upsertSavedAddress(customer.id, {
        address: 'Jl. Buduran No. 99',
        kelurahan: 'Buduran',
        kecamatan: 'Buduran',
        kota: 'Sidoarjo',
        lat: -7.4255,
        lng: 112.7214,
        distanceKm: 18.0,
        ongkir: 22000,
        isPrimary: false,
      }, TENANT);

      // Simulasi reservasi untuk Rumah 2
      const mockReservation: any = {
        id: `res-${Date.now()}`,
        tenant_id: TENANT,
        customer_id: customer.id,
        customer_address_id: r2?.id,
        raw_text: '[Admin Manual] Alamat: Jl. Buduran No. 99, Buduran',
        address: 'Jl. Buduran No. 99',
        kelurahan: 'Buduran',
        kecamatan: 'Buduran',
        kota: 'Sidoarjo',
        created_at: new Date(),
      };

      // Jalankan lifecycle hook
      await reservationLifecycleService.onReservationCreated(mockReservation);

      // Verifikasi: Profil root customer tetap Rumah 1 di Grogol!
      const currentCust = await customerService.getCustomerById(customer.id, TENANT);
      expect(currentCust?.kelurahan).toBe('Grogol');
      expect(currentCust?.kecamatan).toBe('Tulangan');
      expect(currentCust?.lat).toBe(-7.4812);
      expect(currentCust?.lng).toBe(112.6521);
    });
  });

  describe('3. Staff Dispatch & Peta Google Maps', () => {
    it('buildAddressText membaca alamat Rumah 2 jika customer_address terpasang', async () => {
      const reservationWithHouse2: any = {
        id: 'res-bidan-1',
        treatment_detail: 'Pijat Bayi',
        booking_date: new Date('2026-10-08T03:00:00Z'),
        status: 'confirmed',
        customer: {
          name: 'Bunda Devia',
          kelurahan: 'Grogol',
          kecamatan: 'Tulangan',
          kota: 'Sidoarjo',
          lat: -7.4812,
          lng: 112.6521,
          distance_km: 12.5,
          preferences: {
            address: 'Jl. Melati No. 12 (Rumah 1)',
          },
        },
        // Reservasi ditautkan ke Rumah 2 di Buduran
        customer_address: {
          id: 'addr-buduran',
          label: 'Rumah 2 Buduran',
          address: 'Perum Buduran Indah Blok B-5',
          kelurahan: 'Buduran',
          kecamatan: 'Buduran',
          kota: 'Sidoarjo',
          lat: -7.4255,
          lng: 112.7214,
          distance_km: 18.2,
          ongkir: 22000,
          landmark: 'Dekat Pos Satpam',
          location_source: 'gps_pin',
        },
      };

      const { buildAddressText } = await import('../../src/services/staff-reservation.service');
      const addrText = buildAddressText(reservationWithHouse2.customer_address);
      expect(addrText).toContain('Perum Buduran Indah Blok B-5');
      expect(addrText).toContain('Buduran');
      expect(addrText).not.toContain('Grogol');
    });
  });

  describe('4. Google Sheets Rekapan (Kolom D Lokasi & Kolom H Ongkir)', () => {
    it('mencatat kelurahan Rumah 2 (Buduran) pada Kolom D dan ongkir Rumah 2 pada Kolom H', () => {
      const sheetInput = {
        reservation: {
          booking_date: new Date('2026-10-08T03:00:00Z'),
          treatment_detail: 'Baby Massage',
          purchase_value: 120000,
          delivery_fee: null,
          status: 'confirmed',
        },
        customer: {
          name: 'Bunda Citra',
          kelurahan: 'Grogol',
          kecamatan: 'Tulangan',
          kota: 'Sidoarjo',
          ongkir: 15000,
        },
        customerAddress: {
          kelurahan: 'Buduran',
          kecamatan: 'Buduran',
          kota: 'Sidoarjo',
          ongkir: 22000,
        },
        child: { name: 'An. Kayla' },
        assignedStaffName: 'Bidan Ratna',
      };

      const row = formatReservationToRow(sheetInput as any);

      expect(row[3]).toBe('Buduran');
      expect(row[7]).toBe(22000);
      expect(row[8]).toBe(142000);
    });

    it('fallback aman ke profil customer bila reservasi tidak memiliki customerAddress', () => {
      const sheetInputLegacy = {
        reservation: {
          booking_date: new Date('2026-10-08T03:00:00Z'),
          treatment_detail: 'Baby Massage',
          purchase_value: 120000,
          delivery_fee: null,
          status: 'confirmed',
        },
        customer: {
          name: 'Bunda Citra',
          kelurahan: 'Grogol',
          kecamatan: 'Tulangan',
          kota: 'Sidoarjo',
          ongkir: 15000,
        },
        customerAddress: null,
        child: { name: 'An. Kayla' },
      };

      const row = formatReservationToRow(sheetInputLegacy as any);
      expect(row[3]).toBe('Grogol');
      expect(row[7]).toBe(15000);
    });
  });
});
