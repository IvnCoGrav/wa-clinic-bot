import { prisma } from '../db/client';
import { Customer } from '@prisma/client';

// In-Memory store fallback jika DB offline
const memoryCustomers = new Map<string, any>();

export class CustomerService {
  /**
   * Cari customer berdasarkan nomor telepon unik, atau buat record baru jika belum ada.
   */
  public async getOrCreateCustomer(phone: string, name?: string): Promise<any> {
    try {
      let customer = await prisma.customer.findUnique({
        where: { phone },
      });

      if (!customer) {
        customer = await prisma.customer.create({
          data: {
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
    }
  ): Promise<any> {
    try {
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
        if (cust.id === customerId) {
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
}

export const customerService = new CustomerService();
