import { prisma } from '../db/client';
import { Customer } from '@prisma/client';

// In-Memory store fallback jika DB offline
const memoryCustomers = new Map<string, any>();

export class CustomerService {
  /**
   * Cari customer berdasarkan nomor telepon unik dan tenantId, atau buat record baru jika belum ada.
   */
  public async getOrCreateCustomer(phone: string, name: string | undefined, tenantId: string): Promise<any> {
    try {
      let customer = await prisma.customer.findFirst({
        where: { phone, tenant_id: tenantId },
      });

      if (!customer) {
        customer = await prisma.customer.create({
          data: {
            tenant_id: tenantId,
            phone,
            name: name || null,
          },
        });
      }

      memoryCustomers.set(phone, customer);
      return customer;
    } catch (error) {
      // Memory fallback for offline mode
      if (!memoryCustomers.has(phone)) {
        const mockCustomer = {
          id: `cust_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          tenant_id: tenantId,
          phone,
          name: name || null,
          kelurahan: null,
          kecamatan: null,
          kota: null,
          lat: null,
          lng: null,
          distance_km: null,
          ongkir: null,
          is_out_of_coverage: false,
          status: 'active',
          created_at: new Date(),
          updated_at: new Date(),
        };
        memoryCustomers.set(phone, mockCustomer);
      }
      return memoryCustomers.get(phone);
    }
  }

  /**
   * Update detail data lokasi dan ongkir customer
   */
  public async updateCustomerLocation(
    customerId: string,
    data: {
      kelurahan?: string;
      kecamatan?: string;
      kota?: string;
      lat?: number;
      lng?: number;
      distanceKm?: number;
      ongkir?: number;
      isOutOfCoverage?: boolean;
    },
    tenantId: string
  ): Promise<any> {
    try {
      const existing = await prisma.customer.findFirst({
        where: { id: customerId, tenant_id: tenantId },
      });
      if (!existing) {
        throw new Error(`Customer ${customerId} not found for tenant ${tenantId}`);
      }

      return await prisma.customer.update({
        where: { id: customerId },
        data: {
          kelurahan: data.kelurahan,
          kecamatan: data.kecamatan,
          kota: data.kota,
          lat: data.lat,
          lng: data.lng,
          distance_km: data.distanceKm,
          ongkir: data.ongkir,
          is_out_of_coverage: data.isOutOfCoverage ?? false,
        },
      });
    } catch (error) {
      // Memory fallback update
      for (const [phone, cust] of memoryCustomers.entries()) {
        if (cust.id === customerId && cust.tenant_id === tenantId) {
          Object.assign(cust, {
            kelurahan: data.kelurahan ?? cust.kelurahan,
            kecamatan: data.kecamatan ?? cust.kecamatan,
            kota: data.kota ?? cust.kota,
            lat: data.lat ?? cust.lat,
            lng: data.lng ?? cust.lng,
            distance_km: data.distanceKm ?? cust.distance_km,
            ongkir: data.ongkir ?? cust.ongkir,
            is_out_of_coverage: data.isOutOfCoverage ?? cust.is_out_of_coverage,
            updated_at: new Date(),
          });
          return cust;
        }
      }
      return null;
    }
  }

  /**
   * Meng-update alamat pending/sementara milik customer
   */
  public async updateCustomerPendingLocation(
    customerId: string,
    data: {
      kelurahan?: string | null;
      kecamatan?: string | null;
      kota?: string | null;
      lat?: number | null;
      lng?: number | null;
    },
    tenantId: string
  ): Promise<any> {
    try {
      const existing = await prisma.customer.findFirst({
        where: { id: customerId, tenant_id: tenantId },
      });
      if (!existing) {
        throw new Error(`Customer ${customerId} not found for tenant ${tenantId}`);
      }

      return await prisma.customer.update({
        where: { id: customerId },
        data: {
          pending_kelurahan: data.kelurahan,
          pending_kecamatan: data.kecamatan,
          pending_kota: data.kota,
          pending_lat: data.lat,
          pending_lng: data.lng,
        },
      });
    } catch (error) {
      // Fallback in-memory
      for (const [phone, cust] of memoryCustomers.entries()) {
        if (cust.id === customerId && cust.tenant_id === tenantId) {
          Object.assign(cust, {
            pending_kelurahan: data.kelurahan !== undefined ? data.kelurahan : cust.pending_kelurahan,
            pending_kecamatan: data.kecamatan !== undefined ? data.kecamatan : cust.pending_kecamatan,
            pending_kota: data.kota !== undefined ? data.kota : cust.pending_kota,
            pending_lat: data.lat !== undefined ? data.lat : cust.pending_lat,
            pending_lng: data.lng !== undefined ? data.lng : cust.pending_lng,
            updated_at: new Date(),
          });
          return cust;
        }
      }
      return null;
    }
  }

  /**
   * Membersihkan data lokasi pending pada customer
   */
  public async clearPendingLocation(customerId: string, tenantId: string): Promise<any> {
    return this.updateCustomerPendingLocation(
      customerId,
      {
        kelurahan: null,
        kecamatan: null,
        kota: null,
        lat: null,
        lng: null,
      },
      tenantId
    );
  }

  /**
   * Mempromosikan data lokasi pending ke confirmed secara ATOMIC (prisma transaction)
   * serta menghitung ulang tarif ongkos kirim.
   */
  public async promotePendingLocation(
    customerId: string,
    pendingData: {
      pending_kelurahan: string;
      pending_kecamatan: string;
      pending_kota: string;
      pending_lat: number;
      pending_lng: number;
    },
    deliveryCalculator: (coords: { lat: number; lng: number }) => Promise<{
      distanceKm: number;
      ongkir: number;
      isOutOfCoverage: boolean;
    }>,
    tenantId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Hitung rute/jarak & ongkir terlebih dahulu
      const delivery = await deliveryCalculator({
        lat: pendingData.pending_lat,
        lng: pendingData.pending_lng,
      });

      try {
        // Lakukan atomic transaction menggunakan Prisma
        await prisma.$transaction(async (tx) => {
          const existing = await tx.customer.findFirst({
            where: { id: customerId, tenant_id: tenantId },
          });
          if (!existing) {
            throw new Error(`Customer ${customerId} not found for tenant ${tenantId}`);
          }

          await tx.customer.update({
            where: { id: customerId },
            data: {
              kelurahan: pendingData.pending_kelurahan,
              kecamatan: pendingData.pending_kecamatan,
              kota: pendingData.pending_kota,
              lat: pendingData.pending_lat,
              lng: pendingData.pending_lng,
              distance_km: delivery.distanceKm,
              ongkir: delivery.ongkir,
              is_out_of_coverage: delivery.isOutOfCoverage,

              // Null-kan pending
              pending_kelurahan: null,
              pending_kecamatan: null,
              pending_kota: null,
              pending_lat: null,
              pending_lng: null,
            },
          });
        });
        return { success: true };
      } catch (dbError) {
        console.warn('[PROMOTE FALLBACK] Database transaction failed, using in-memory promotion fallback.');
        let found = false;
        for (const [phone, cust] of memoryCustomers.entries()) {
          if (cust.id === customerId && cust.tenant_id === tenantId) {
            Object.assign(cust, {
              kelurahan: pendingData.pending_kelurahan,
              kecamatan: pendingData.pending_kecamatan,
              kota: pendingData.pending_kota,
              lat: pendingData.pending_lat,
              lng: pendingData.pending_lng,
              distance_km: delivery.distanceKm,
              ongkir: delivery.ongkir,
              is_out_of_coverage: delivery.isOutOfCoverage,

              pending_kelurahan: null,
              pending_kecamatan: null,
              pending_kota: null,
              pending_lat: null,
              pending_lng: null,
              updated_at: new Date(),
            });
            found = true;
            break;
          }
        }
        if (found) {
          return { success: true };
        }
        throw dbError;
      }
    } catch (error) {
      console.error('[PROMOTE TRANSACTION ERROR] Failed to promote pending location:', error);
      return { success: false, error: (error as Error).message };
    }
  }
}

export const customerService = new CustomerService();
