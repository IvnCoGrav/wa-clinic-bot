import { prisma } from '../db/client';
import { Customer } from '@prisma/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { isDummyOrTestContact } from '../utils/dummy-filter';
import { responseCacheService } from './response-cache.service';

// In-Memory store fallback jika DB offline
const memoryCustomers = new Map<string, any>();

export class CustomerService {
  public getMemoryCustomers(): Map<string, any> {
    return memoryCustomers;
  }

  /**
   * Koerce input koordinat (bisa string dari WAHA/LLM/DB) menjadi number,
   * demi menghindari error Prisma "Expected Float, provided String".
   * null/undefined/NaN → null.
   */
  private static toNumberOrNull(value: unknown): number | null {
    if (value === undefined || value === null) return null;
    const n = typeof value === 'number' ? value : parseFloat(String(value));
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Set flag label chat (is_admin_labeled / is_hold_labeled) pada semua customer
   * yang memiliki nomor HP yang sama (baik awalan 62 maupun 0).
   * Menjamin konsistensi status chat di seluruh record customer.
   */
  public async setChatLabelFlag(
    phone: string,
    flag: 'is_admin_labeled' | 'is_hold_labeled',
    value: boolean
  ): Promise<void> {
    const raw = phone.replace(/\D/g, '');
    const clean = raw.startsWith('62') ? raw.slice(2) : raw.startsWith('0') ? raw.slice(1) : raw;
    const formats = [`62${clean}`, `0${clean}`, clean];

    try {
      await prisma.customer.updateMany({
        where: {
          phone: { in: formats },
        },
        data: {
          [flag]: value,
          labels_synced_at: new Date(),
        },
      });
    } catch {
      // Memory fallback untuk offline/mock mode
      for (const fmt of formats) {
        if (memoryCustomers.has(fmt)) {
          const cust = memoryCustomers.get(fmt);
          cust[flag] = value;
          cust.labels_synced_at = new Date();
        }
      }
    }
  }

  public async setLabelFlags(
    phone: string,
    flags: { isAdminLabeled?: boolean; isHoldLabeled?: boolean }
  ): Promise<void> {
    const data: any = { labels_synced_at: new Date() };
    if (flags.isAdminLabeled !== undefined) data.is_admin_labeled = flags.isAdminLabeled;
    if (flags.isHoldLabeled !== undefined) data.is_hold_labeled = flags.isHoldLabeled;

    try {
      await prisma.customer.updateMany({
        where: { phone },
        data,
      });
    } catch (error) {
      // Memory fallback (DB offline / test)
      const cust = memoryCustomers.get(phone);
      if (cust) {
        if (flags.isAdminLabeled !== undefined) cust.is_admin_labeled = flags.isAdminLabeled;
        if (flags.isHoldLabeled !== undefined) cust.is_hold_labeled = flags.isHoldLabeled;
        cust.labels_synced_at = new Date();
      }
    }
  }

  /**
   * Cari customer berdasarkan nomor telepon unik dan tenantId, atau buat record baru jika belum ada.
   */
  public async getOrCreateCustomer(
    phone: string,
    name: string | undefined,
    tenantId: string,
    options?: { skipFollowUpScheduling?: boolean }
  ): Promise<any> {
    try {
      const isSandbox = isDummyOrTestContact(phone, name);

      let customer = await prisma.customer.findFirst({
        where: { phone, tenant_id: tenantId },
      });

      if (!customer) {
        const newCustomer = await prisma.customer.create({
          data: {
            tenant_id: tenantId,
            phone,
            name: name || null,
            labels_synced_at: new Date(),
            is_sandbox_test: isSandbox,
          },
        });

        if (newCustomer) {
          customer = newCustomer;
          // skipFollowUpScheduling: true saat dipanggil dari migration service
          // agar legacy customer tidak mendapat follow-up NO_PURCHASE yang tidak relevan.
          if (!options?.skipFollowUpScheduling && !isSandbox) {
            try {
              const { followUpService } = await import('./follow-up.service');
              await followUpService.createNoPurchaseFollowUps(customer.id, tenantId);
            } catch (err) {
              console.error('[Customer Service] Failed to trigger follow-up creation:', err);
            }
          }
        } else {
          throw new Error('Database create returned null/undefined');
        }
      } else if (!customer.is_sandbox_test && isSandbox) {
        // Otomatis sinkronkan flag jika nomor/nama terdeteksi dummy
        try {
          await prisma.customer.update({
            where: { id: customer.id },
            data: { is_sandbox_test: true },
          });
          customer.is_sandbox_test = true;
        } catch (_) {}
      }


      memoryCustomers.set(phone, customer);
      if (customer?.id) memoryCustomers.set(customer.id, customer);
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
          zipcode: null,
          pending_zipcode: null,
          status: 'active',
          block_reason: null,
          blocked_at: null,
          is_legacy_source: false,
          legacy_scraped_at: null,
          is_admin_labeled: false,
          is_hold_labeled: false,
          labels_synced_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        };
        memoryCustomers.set(phone, mockCustomer);
        memoryCustomers.set(mockCustomer.id, mockCustomer);
        return mockCustomer;
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
      zipcode?: string;
      isNativePin?: boolean;
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

      // GPS PRIORITY GUARD: Jika customer sudah pernah mengirimkan Pin GPS asli (share_location_sent = true)
      // dan update ini BUKAN dari Pin GPS baru, pertahankan koordinat presisi asli (jangan timpa dengan centroid kelurahan teks)!
      const preserveExactGps = existing.share_location_sent && !data.isNativePin && existing.lat !== null && existing.lng !== null;

      const effectiveLat = preserveExactGps
        ? existing.lat
        : data.lat !== undefined
          ? CustomerService.toNumberOrNull(data.lat)
          : existing.lat;
      const effectiveLng = preserveExactGps
        ? existing.lng
        : data.lng !== undefined
          ? CustomerService.toNumberOrNull(data.lng)
          : existing.lng;
      const effectiveDistance = preserveExactGps
        ? existing.distance_km
        : data.distanceKm !== undefined
          ? data.distanceKm
          : existing.distance_km;
      const effectiveOngkir = preserveExactGps
        ? existing.ongkir
        : data.ongkir !== undefined
          ? data.ongkir
          : existing.ongkir;

      const updated = await prisma.customer.update({
        where: { id: customerId },
        data: {
          kelurahan: data.kelurahan ?? existing.kelurahan,
          kecamatan: data.kecamatan ?? existing.kecamatan,
          kota: data.kota ?? existing.kota,
          lat: effectiveLat,
          lng: effectiveLng,
          distance_km: effectiveDistance,
          ongkir: effectiveOngkir,
          is_out_of_coverage: data.isOutOfCoverage ?? false,
          zipcode: data.zipcode ?? existing.zipcode,
        },
      });

      // Auto-sync Google Contacts jika kelurahan / kecamatan diperbarui
      if (data.kelurahan || data.kecamatan) {
        import('./google-contacts.service')
          .then(({ googleContactsService }) => {
            googleContactsService.syncCustomer(tenantId, customerId, { trigger: 'chat' }).catch(() => {});
          })
          .catch(() => {});
      }

      return updated;
    } catch (error) {
      // Memory fallback update — hormati GPS pin priority (isNativePin true = override)
      for (const [phone, cust] of memoryCustomers.entries()) {
        if (cust.id === customerId && cust.tenant_id === tenantId) {
          const preserveGps = cust.share_location_sent && !data.isNativePin && cust.lat != null && cust.lng != null;
          const effLat = preserveGps ? cust.lat : (data.lat !== undefined ? (CustomerService.toNumberOrNull(data.lat) ?? cust.lat) : cust.lat);
          const effLng = preserveGps ? cust.lng : (data.lng !== undefined ? (CustomerService.toNumberOrNull(data.lng) ?? cust.lng) : cust.lng);
          const effDist = preserveGps ? cust.distance_km : (data.distanceKm !== undefined ? data.distanceKm : cust.distance_km);
          const effOngkir = preserveGps ? cust.ongkir : (data.ongkir !== undefined ? data.ongkir : cust.ongkir);
          Object.assign(cust, {
            kelurahan: data.kelurahan ?? cust.kelurahan,
            kecamatan: data.kecamatan ?? cust.kecamatan,
            kota: data.kota ?? cust.kota,
            lat: effLat,
            lng: effLng,
            distance_km: effDist,
            ongkir: effOngkir,
            is_out_of_coverage: data.isOutOfCoverage ?? cust.is_out_of_coverage,
            zipcode: data.zipcode !== undefined ? data.zipcode : cust.zipcode,
            updated_at: new Date(),
          });
          if (data.isNativePin) cust.share_location_sent = true;
          return cust;
        }
      }
      return null;
    }
  }

  /**
   * Menandai bahwa customer pernah mengirimkan share-location native (pin GPS) di WhatsApp.
   * Dipakai untuk memutuskan apakah bot perlu meminta shareloc saat form reservasi dikirim.
   */
  public async markShareLocationSent(customerId: string, tenantId: string): Promise<any> {
    try {
      const updated = await prisma.customer.update({
        where: { id: customerId },
        data: { share_location_sent: true },
      });
      memoryCustomers.set(updated.phone, updated);
      return updated;
    } catch (error) {
      const cust = Array.from(memoryCustomers.values()).find(
        (c) => c.id === customerId && c.tenant_id === tenantId
      );
      if (cust) {
        cust.share_location_sent = true;
        cust.updated_at = new Date();
      }
      return cust;
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
      zipcode?: string | null;
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
          pending_lat: CustomerService.toNumberOrNull(data.lat),
          pending_lng: CustomerService.toNumberOrNull(data.lng),
          pending_zipcode: data.zipcode,
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
            pending_lat: CustomerService.toNumberOrNull(data.lat) ?? cust.pending_lat,
            pending_lng: CustomerService.toNumberOrNull(data.lng) ?? cust.pending_lng,
            pending_zipcode: data.zipcode !== undefined ? data.zipcode : cust.pending_zipcode,
            updated_at: new Date(),
          });
          return cust;
        }
      }
      return null;
    }
  }

  /**
   * Hapus snapshot customer dari memory fallback store (dipakai saat hard wipe /reset
   * supaya snapshot lama tidak memunculkan customer yang sudah dihapus dari DB).
   */
  public clearCustomerMemory(phone: string): void {
    memoryCustomers.delete(phone);
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
        zipcode: null,
      },
      tenantId
    );
  }

  /**
   * Reset SELURUH lokasi customer (pending + confirmed) ke kosong.
   * Dipakai untuk reset penuh di CLI simulator / testing.
   */
  public async resetFullLocation(customerId: string, tenantId: string): Promise<any> {
    try {
      return await prisma.customer.update({
        where: { id: customerId },
        data: {
          kelurahan: null,
          kecamatan: null,
          kota: null,
          lat: null,
          lng: null,
          zipcode: null,
          distance_km: null,
          ongkir: null,
          is_out_of_coverage: false,
          pending_kelurahan: null,
          pending_kecamatan: null,
          pending_kota: null,
          pending_lat: null,
          pending_lng: null,
          pending_zipcode: null,
        },
      });
    } catch (error) {
      // Memory fallback update
      for (const [phone, cust] of memoryCustomers.entries()) {
        if (cust.id === customerId && cust.tenant_id === tenantId) {
          Object.assign(cust, {
            kelurahan: null,
            kecamatan: null,
            kota: null,
            lat: null,
            lng: null,
            zipcode: null,
            distance_km: null,
            ongkir: null,
            is_out_of_coverage: false,
            pending_kelurahan: null,
            pending_kecamatan: null,
            pending_kota: null,
            pending_lat: null,
            pending_lng: null,
            pending_zipcode: null,
            updated_at: new Date(),
          });
          return cust;
        }
      }
      throw new Error(`Customer ${customerId} not found for tenant ${tenantId}`);
    }
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
      pending_zipcode?: string | null;
    },
    deliveryCalculator: (coords: { lat: number; lng: number }) => Promise<{
      distanceKm: number;
      ongkir: number;
      isOutOfCoverage: boolean;
    }>,
    tenantId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Koerce dulu: pending_lat/lng bisa string bila dibuat lewat jalur yang tidak
      // melewati normalize (mis. data lama / webhook payload string).
      const pendingLat = CustomerService.toNumberOrNull(pendingData.pending_lat);
      const pendingLng = CustomerService.toNumberOrNull(pendingData.pending_lng);
      if (pendingLat === null || pendingLng === null) {
        return { success: false, error: 'Koordinat pending tidak valid (bukan angka).' };
      }

      // Hitung rute/jarak & ongkir terlebih dahulu
      const delivery = await deliveryCalculator({
        lat: pendingLat,
        lng: pendingLng,
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
              lat: pendingLat,
              lng: pendingLng,
              zipcode: pendingData.pending_zipcode || null,
              distance_km: delivery.distanceKm,
              ongkir: delivery.ongkir,
              is_out_of_coverage: delivery.isOutOfCoverage,

              // Null-kan pending
              pending_kelurahan: null,
              pending_kecamatan: null,
              pending_kota: null,
              pending_lat: null,
              pending_lng: null,
              pending_zipcode: null,
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
              lat: pendingLat,
              lng: pendingLng,
              zipcode: pendingData.pending_zipcode || null,
              distance_km: delivery.distanceKm,
              ongkir: delivery.ongkir,
              is_out_of_coverage: delivery.isOutOfCoverage,

              pending_kelurahan: null,
              pending_kecamatan: null,
              pending_kota: null,
              pending_lat: null,
              pending_lng: null,
              pending_zipcode: null,
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

  /**
   * Blokir customer secara manual / otomatis
   */
  public async blockCustomer(customerId: string, reason: string, tenantId: string): Promise<any> {
    try {
      return await prisma.customer.update({
        where: { id: customerId },
        data: {
          status: 'blocked',
          block_reason: reason,
          blocked_at: new Date(),
        },
      });
    } catch (error) {
      // Memory fallback update
      for (const [phone, cust] of memoryCustomers.entries()) {
        if (cust.id === customerId && cust.tenant_id === tenantId) {
          cust.status = 'blocked';
          cust.block_reason = reason;
          cust.blocked_at = new Date();
          return cust;
        }
      }
      throw new Error(`Customer ${customerId} not found for tenant ${tenantId}`);
    }
  }

  /**
   * Buka blokir customer
   */
  public async unblockCustomer(customerId: string, tenantId: string): Promise<any> {
    try {
      return await prisma.customer.update({
        where: { id: customerId },
        data: {
          status: 'active',
          block_reason: null,
          blocked_at: null,
        },
      });
    } catch (error) {
      // Memory fallback update
      for (const [phone, cust] of memoryCustomers.entries()) {
        if (cust.id === customerId && cust.tenant_id === tenantId) {
          cust.status = 'active';
          cust.block_reason = null;
          cust.blocked_at = null;
          return cust;
        }
      }
      throw new Error(`Customer ${customerId} not found for tenant ${tenantId}`);
    }
  }

  /**
   * Update nama kontak customer (misal: "Bunda Sari" / "Bunda Sari Waru")
   */
  public async updateCustomerName(customerId: string, name: string, tenantId: string): Promise<any> {
    try {
      const updated = await prisma.customer.update({
        where: { id: customerId },
        data: { name },
      });

      // Google Contacts auto-sync (best-effort, non-blocking)
      import('./google-contacts.service')
        .then(({ googleContactsService }) => {
          googleContactsService.syncCustomer(tenantId, customerId, { trigger: 'chat' }).catch(() => {});
        })
        .catch(() => {});

      return updated;
    } catch (error) {
      // Memory fallback update
      for (const [phone, cust] of memoryCustomers.entries()) {
        if (cust.id === customerId && cust.tenant_id === tenantId) {
          cust.name = name;
          return cust;
        }
      }
      throw new Error(`Customer ${customerId} not found for tenant ${tenantId}`);
    }
  }

  /**
   * Update field dasar customer (nama, alamat, koordinat, landmark).
   * Digunakan oleh admin dashboard untuk edit profil customer.
   * Field yang didukung: name, phone, address, kelurahan, kecamatan, kota, zipcode, landmark/address_notes, lat, lng, children
   */
  public async updateCustomer(
    customerId: string,
    data: {
      name?: string;
      phone?: string;
      address?: string;
      kelurahan?: string | null;
      kecamatan?: string | null;
      kota?: string | null;
      zipcode?: string | null;
      landmark?: string | null; // alias address_notes
      lat?: number | null;
      lng?: number | null;
      children?: Array<{
        id?: string;
        name: string;
        ageText?: string;
        raw_age_text?: string;
        birthDate?: string | null;
      }>;
    },
    tenantId: string
  ): Promise<any> {
    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.kelurahan !== undefined) updateData.kelurahan = data.kelurahan;
    if (data.kecamatan !== undefined) updateData.kecamatan = data.kecamatan;
    if (data.kota !== undefined) updateData.kota = data.kota;
    if (data.zipcode !== undefined) updateData.zipcode = data.zipcode;
    if (data.lat !== undefined) updateData.lat = CustomerService.toNumberOrNull(data.lat);
    if (data.lng !== undefined) updateData.lng = CustomerService.toNumberOrNull(data.lng);

    if (data.phone !== undefined && data.phone.trim()) {
      let normalizedPhone = data.phone.replace(/\D/g, '');
      if (normalizedPhone.startsWith('0')) normalizedPhone = '62' + normalizedPhone.substring(1);
      updateData.phone = normalizedPhone;
    }

    // Normalize address & landmark -> preferences
    if (data.address !== undefined || data.landmark !== undefined) {
      const customer = await this.getCustomerById(customerId, tenantId);
      const currentPrefs = (customer?.preferences as any) || {};
      const newPrefs: any = { ...currentPrefs };
      if (data.address !== undefined) {
        newPrefs.address = data.address;
        newPrefs.full_address = data.address;
      }
      if (data.landmark !== undefined) {
        newPrefs.landmark = data.landmark;
        newPrefs.address_notes = data.landmark;
      }
      newPrefs.location_updated_at = new Date().toISOString();
      newPrefs.location_updated_by_staff_name = 'Admin CS';
      updateData.preferences = newPrefs;
    }

    try {
      const updated = await prisma.customer.update({
        where: { id: customerId },
        data: updateData,
        include: { children: true },
      });

      // Synchronize Children records if provided
      if (Array.isArray(data.children)) {
        const existingChildren = await prisma.child.findMany({
          where: { customer_id: customerId },
        });

        const incomingValidChildren = data.children.filter((c) => c.name && c.name.trim());
        const processedChildIds = new Set<string>();

        for (const childItem of incomingValidChildren) {
          const childName = childItem.name.trim();
          const ageText = childItem.raw_age_text || childItem.ageText || null;
          const birthDate = childItem.birthDate ? new Date(childItem.birthDate) : null;

          const matchedExisting = childItem.id
            ? existingChildren.find((ec) => ec.id === childItem.id)
            : existingChildren.find((ec) => ec.name.toLowerCase() === childName.toLowerCase());

          if (matchedExisting) {
            processedChildIds.add(matchedExisting.id);
            await prisma.child.update({
              where: { id: matchedExisting.id },
              data: {
                name: childName,
                raw_age_text: ageText,
                birth_date: birthDate,
              },
            });
          } else {
            const createdChild = await prisma.child.create({
              data: {
                tenant_id: tenantId,
                customer_id: customerId,
                name: childName,
                raw_age_text: ageText,
                birth_date: birthDate,
              },
            });
            processedChildIds.add(createdChild.id);
          }
        }

        // Remove deleted children
        for (const ec of existingChildren) {
          if (!processedChildIds.has(ec.id)) {
            await prisma.child.delete({ where: { id: ec.id } }).catch(() => {});
          }
        }
      }

      // Google Contacts auto-sync (best-effort, non-blocking)
      import('./google-contacts.service')
        .then(({ googleContactsService }) => {
          googleContactsService.syncCustomer(tenantId, customerId, { trigger: 'chat' }).catch(() => {});
        })
        .catch(() => {});

      const finalCustomer = await this.getCustomerById(customerId, tenantId);
      return finalCustomer || updated;
    } catch (error) {
      // Memory fallback update
      for (const [phone, cust] of memoryCustomers.entries()) {
        if (cust.id === customerId && cust.tenant_id === tenantId) {
          Object.assign(cust, updateData);
          if (data.address !== undefined || data.landmark !== undefined) {
            cust.preferences = {
              ...(cust.preferences as any),
              ...(data.address !== undefined ? { address: data.address, full_address: data.address } : {}),
              ...(data.landmark !== undefined ? { landmark: data.landmark, address_notes: data.landmark } : {}),
              location_updated_at: new Date().toISOString(),
              location_updated_by_staff_name: 'Admin CS',
            };
          }
          if (Array.isArray(data.children)) {
            cust.children = data.children.map((c, idx) => ({
              id: c.id || `mock-child-${idx + 1}`,
              customer_id: customerId,
              tenant_id: tenantId,
              name: c.name,
              raw_age_text: c.raw_age_text || c.ageText || null,
              birth_date: c.birthDate || null,
              created_at: new Date(),
              updated_at: new Date(),
            }));
          }
          return cust;
        }
      }
      throw new Error(`Customer ${customerId} not found for tenant ${tenantId}`);
    }
  }

  /**
   * Set override AI Rollout Scope per customer (FORCE_ON / FORCE_OFF / null).
   * null = ikuti aturan tenant (scope + cutoff). Fail-over ke memory store saat DB offline.
   */
  public async setAiOverride(customerId: string, tenantId: string, aiOverride: 'FORCE_ON' | 'FORCE_OFF' | null): Promise<any> {
    try {
      return await prisma.customer.update({
        where: { id: customerId },
        data: { ai_override: aiOverride },
      });
    } catch (error) {
      // Memory fallback update
      for (const [phone, cust] of memoryCustomers.entries()) {
        if (cust.id === customerId && cust.tenant_id === tenantId) {
          cust.ai_override = aiOverride;
          return cust;
        }
      }
      throw new Error(`Customer ${customerId} not found for tenant ${tenantId}`);
    }
  }

  /**
   * Cari customer berdasarkan id (dengan memory store fallback saat DB offline).
   */
  public async getCustomerById(customerId: string, tenantId: string = DEFAULT_TENANT_ID): Promise<any> {
    try {
      const customer = await prisma.customer.findUnique({ where: { id: customerId } });
      if (customer) {
        if (tenantId && customer.tenant_id && customer.tenant_id !== tenantId) return null;
        return customer;
      }
      const memCust = memoryCustomers.get(customerId);
      if (memCust) {
        if (tenantId && memCust.tenant_id && memCust.tenant_id !== tenantId) return null;
        return memCust;
      }
      for (const [, cust] of memoryCustomers.entries()) {
        if (cust && cust.id === customerId && (!tenantId || cust.tenant_id === tenantId)) return cust;
      }
      return null;
    } catch (error) {
      const memCust = memoryCustomers.get(customerId);
      if (memCust) {
        if (tenantId && memCust.tenant_id && memCust.tenant_id !== tenantId) return null;
        return memCust;
      }
      for (const [, cust] of memoryCustomers.entries()) {
        if (cust && cust.id === customerId && (!tenantId || cust.tenant_id === tenantId)) return cust;
      }
      return null;
    }
  }

  /**
   * Cari customer berdasarkan nomor telepon
   */
  public async getCustomerByPhone(phone: string, tenantId: string): Promise<any> {
    try {
      const customer = await prisma.customer.findFirst({
        where: { phone, tenant_id: tenantId },
      });
      return customer || memoryCustomers.get(phone) || null;
    } catch (error) {
      return memoryCustomers.get(phone) || null;
    }
  }

  /**
   * Mengambil setting MQL untuk tenant
   */
  public async getMqlSettings(tenantId: string): Promise<{ mqlThresholdBubbles: number; mqlAutoLeadEnabled: boolean }> {
    try {
      const tenant = await prisma.tenant.findFirst({ where: { id: tenantId } });
      return {
        mqlThresholdBubbles: tenant?.mql_threshold_bubbles ?? 5,
        mqlAutoLeadEnabled: tenant?.mql_auto_lead_enabled ?? true,
      };
    } catch (error) {
      return { mqlThresholdBubbles: 5, mqlAutoLeadEnabled: true };
    }
  }

  /**
   * Memperbarui setting MQL untuk tenant
   */
  public async updateMqlSettings(
    tenantId: string,
    settings: { mqlThresholdBubbles?: number; mqlAutoLeadEnabled?: boolean }
  ): Promise<{ mqlThresholdBubbles: number; mqlAutoLeadEnabled: boolean }> {
    try {
      const tenant = await prisma.tenant.findFirst({ where: { id: tenantId } });
      const targetId = tenant?.id || tenantId;

      const updated = await prisma.tenant.upsert({
        where: { id: targetId },
        create: {
          id: targetId,
          slug: targetId,
          name: `Default Clinic`,
          ...(settings.mqlThresholdBubbles !== undefined && { mql_threshold_bubbles: settings.mqlThresholdBubbles }),
          ...(settings.mqlAutoLeadEnabled !== undefined && { mql_auto_lead_enabled: settings.mqlAutoLeadEnabled }),
        },
        update: {
          ...(settings.mqlThresholdBubbles !== undefined && { mql_threshold_bubbles: settings.mqlThresholdBubbles }),
          ...(settings.mqlAutoLeadEnabled !== undefined && { mql_auto_lead_enabled: settings.mqlAutoLeadEnabled }),
        },
      });

      return {
        mqlThresholdBubbles: updated.mql_threshold_bubbles,
        mqlAutoLeadEnabled: updated.mql_auto_lead_enabled,
      };
    } catch (error) {
      return {
        mqlThresholdBubbles: settings.mqlThresholdBubbles ?? 5,
        mqlAutoLeadEnabled: settings.mqlAutoLeadEnabled ?? true,
      };
    }
  }

  /**
   * Mengiterasi jumlah pesan/bubble inbound customer, dan mengevaluasi status MQL.
   * Jika jumlah bubble mencapai/melebihi threshold MQL (default: 5) dan customer belum MQL,
   * otomatis ubah status customer menjadi MQL dan picu event 'Lead' via CAPI.
   */
  public async incrementCustomerMessageCount(customerId: string, tenantId: string): Promise<{ customer: any; newlyTriggeredMql: boolean }> {
    let newlyTriggeredMql = false;
    let updatedCustomer: any = null;

    try {
      // 1. Ambil tenant settings (threshold & auto lead)
      const settings = await this.getMqlSettings(tenantId);
      const mqlThreshold = settings.mqlThresholdBubbles;
      const mqlAutoLead = settings.mqlAutoLeadEnabled;

      // 2. Fetch customer saat ini
      const current = await prisma.customer.findUnique({ where: { id: customerId } });
      if (!current) {
        return { customer: null, newlyTriggeredMql: false };
      }

      const newCount = (current.mql_bubble_count || 0) + 1;
      const shouldQualifyMql = !current.is_mql && newCount >= mqlThreshold;

      if (shouldQualifyMql) {
        newlyTriggeredMql = true;
      }

      updatedCustomer = await prisma.customer.update({
        where: { id: customerId },
        data: {
          mql_bubble_count: newCount,
          is_mql: current.is_mql || shouldQualifyMql,
          mql_triggered_at: shouldQualifyMql ? new Date() : current.mql_triggered_at,
        },
        include: {
          adClick: true,
        },
      });

      // Update memory store fallback if exists
      for (const [phone, cust] of memoryCustomers.entries()) {
        if (cust.id === customerId) {
          cust.mql_bubble_count = newCount;
          cust.is_mql = updatedCustomer.is_mql;
          cust.mql_triggered_at = updatedCustomer.mql_triggered_at;
          break;
        }
      }

      // 3. Jika baru saja memenuhi MQL dan auto lead aktif, picu event CAPI 'Lead'
      if (shouldQualifyMql && mqlAutoLead) {
        try {
          const { capiService } = await import('./capi.service');
          const { auditService } = await import('./audit.service');

          const capiResult = await capiService.sendCapiEvent({
            eventName: 'Lead',
            customer: updatedCustomer,
            adClick: (updatedCustomer as any)?.adClick || undefined,
            tenantId,
            customData: {
              mql_bubble_count: newCount,
              mql_threshold: mqlThreshold,
              triggered_reason: 'MQL_BUBBLE_THRESHOLD_REACHED',
            },
          });

          if (capiResult.success) {
            console.log(`[MQL AUTOMATION] Customer ${customerId} (${updatedCustomer.phone}) reached ${newCount} bubbles (threshold: ${mqlThreshold}). Lead event sent to Meta CAPI.`);
            await auditService.logAdminAction({
              apiKey: 'SYSTEM_MQL_WORKER',
              adminIdentity: 'System (MQL Automation)',
              action: 'MQL_LEAD_EVENT_SENT',
              targetId: customerId,
              payload: {
                phone: updatedCustomer.phone,
                mql_bubble_count: newCount,
                mql_threshold: mqlThreshold,
                fbtrace_id: capiResult.fbtrace_id,
                hasAdClick: !!(updatedCustomer as any)?.adClick,
              },
            });
          } else {
            console.warn(`[MQL AUTOMATION] Lead event skipped or failed for customer ${customerId}: ${capiResult.message}`);
          }
        } catch (capiErr: any) {
          console.error(`[MQL AUTOMATION] Failed to send Lead CAPI event for customer ${customerId}:`, capiErr.message);
        }

        // Live Chat Hub publish for real-time dashboard UI update
        try {
          const { getLiveChatHub } = await import('./live-chat-hub.service');
          getLiveChatHub().publish({
            type: 'conversation.updated',
            tenantId,
            payload: {
              event: 'customer:mql_updated',
              customerId,
              phone: updatedCustomer.phone,
              name: updatedCustomer.name,
              isMql: true,
              mqlBubbleCount: newCount,
              mqlTriggeredAt: updatedCustomer.mql_triggered_at,
            },
          }).catch(() => {});
        } catch (hubErr) {
          // ignore
        }
      }

      // Auto-sync kontak ke Google Contacts saat MQL ter-trigger
      if (shouldQualifyMql) {
        import('./google-contacts.service')
          .then(({ googleContactsService }) => {
            googleContactsService.syncCustomer(tenantId, customerId, { trigger: 'chat' }).catch(() => {});
          })
          .catch(() => {});
      }

      return { customer: updatedCustomer, newlyTriggeredMql };
    } catch (error) {
      // Memory store fallback
      for (const [phone, cust] of memoryCustomers.entries()) {
        if (cust.id === customerId) {
          cust.mql_bubble_count = (cust.mql_bubble_count || 0) + 1;
          if (!cust.is_mql && cust.mql_bubble_count >= 5) {
            cust.is_mql = true;
            cust.mql_triggered_at = new Date();
            newlyTriggeredMql = true;
          }
          return { customer: cust, newlyTriggeredMql };
        }
      }
      return { customer: null, newlyTriggeredMql: false };
    }
  }

  /**
   * Mengambil daftar customer dengan perhitungan LTV dan tracking code adClick
   */
  public async listCustomersWithLtvAndAdClick(
    tenantId: string,
    options?: {
      search?: string;
      page?: number;
      pageSize?: number;
      mqlOnly?: boolean;
      segment?: 'all' | 'purchased' | 'mql' | 'prospect';
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    }
  ): Promise<{
    customers: Array<{
      id: string;
      phone: string;
      name: string | null;
      status: string;
      isMql: boolean;
      mqlBubbleCount: number;
      mqlTriggeredAt: Date | null;
      trackingCode: string;
      adClick: any;
      ltv: number;
      reservationCount: number;
      createdAt: Date;
      updatedAt: Date;
      aiOverride: string | null;
      isAdminLabeled: boolean;
      isHoldLabeled: boolean;
      kecamatan: string | null;
      kota: string | null;
      kelurahan: string | null;
      distanceKm: number | null;
      ongkir: number | null;
    }>;
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    stats?: {
      totalCustomers: number;
      totalPurchasers: number;
      totalMql: number;
      totalProspects: number;
      totalRevenue: number;
    };
  }> {
    const page = Math.max(1, options?.page || 1);
    const pageSize = Math.max(1, Math.min(100, options?.pageSize || 20));
    const search = options?.search?.trim();
    const mqlOnly = options?.mqlOnly;
    const segment = options?.segment || 'all';
    const sortBy = options?.sortBy || 'created_at';
    const sortOrder: 'asc' | 'desc' = options?.sortOrder === 'asc' ? 'asc' : 'desc';

    try {
      const where: any = { tenant_id: tenantId, is_sandbox_test: false };
      if (mqlOnly || segment === 'mql') {
        where.is_mql = true;
      }
      if (segment === 'purchased') {
        where.reservations = { some: { status: { notIn: ['cancelled', 'rejected'] } } };
      } else if (segment === 'prospect') {
        where.reservations = { none: {} };
      }
      if (search) {
        // Phase 4: Search guard — short queries only scan indexed fields (name/phone/trackingCode)
        const isShortQuery = search.length < 4;
        where.OR = isShortQuery
          ? [
              { name: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
              { adClick: { trackingCode: { contains: search, mode: 'insensitive' } } },
            ]
          : [
              { name: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
              { kecamatan: { contains: search, mode: 'insensitive' } },
              { kota: { contains: search, mode: 'insensitive' } },
              { kelurahan: { contains: search, mode: 'insensitive' } },
              { adClick: { trackingCode: { contains: search, mode: 'insensitive' } } },
            ];
      }

      let orderBy: any = { created_at: sortOrder };
      if (sortBy === 'name') orderBy = { name: sortOrder };
      else if (sortBy === 'phone') orderBy = { phone: sortOrder };
      else if (sortBy === 'kecamatan') orderBy = { kecamatan: sortOrder };
      else if (sortBy === 'kota') orderBy = { kota: sortOrder };
      else if (sortBy === 'mqlBubbleCount') orderBy = { mql_bubble_count: sortOrder };
      else if (sortBy === 'created_at') orderBy = { created_at: sortOrder };
      else if (sortBy === 'ltv') orderBy = { ltv_cache: sortOrder };
      else if (sortBy === 'reservations' || sortBy === 'reservationCount') {
        orderBy = { reservations: { _count: sortOrder } };
      }

      const isLtvSort = sortBy === 'ltv';

      const t0 = Date.now();
      const [rawCustomers, total] = await Promise.all([
        prisma.customer.findMany({
          where,
          include: {
            adClick: true,
            reservations: {
              where: { status: { notIn: ['cancelled', 'rejected'] } },
            },
          },
          orderBy: isLtvSort ? { ltv_cache: sortOrder } : orderBy,
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.customer.count({ where }),
      ]);
      const findManyMs = Date.now() - t0;

      const cacheKeyStats = `customers:stats:${tenantId}`;
      let stats = responseCacheService.get<any>(cacheKeyStats);

      if (!stats) {
        try {
          const [totalCustomersCount, totalPurchasersCount, totalMqlCount, totalRevAgg] = await Promise.all([
            prisma.customer.count({ where: { tenant_id: tenantId, is_sandbox_test: false } }),
            prisma.customer.count({
              where: { tenant_id: tenantId, is_sandbox_test: false, reservations: { some: { status: { notIn: ['cancelled', 'rejected'] } } } },
            }),
            prisma.customer.count({
              where: { tenant_id: tenantId, is_sandbox_test: false, is_mql: true },
            }),
            prisma.reservation.aggregate({
              where: { tenant_id: tenantId, status: { notIn: ['cancelled', 'rejected'] }, customer: { is_sandbox_test: false } },
              _sum: { purchase_value: true },
            }),
          ]);
          stats = {
            totalCustomers: totalCustomersCount,
            totalPurchasers: totalPurchasersCount,
            totalMql: totalMqlCount,
            totalProspects: Math.max(0, totalCustomersCount - totalPurchasersCount),
            totalRevenue: totalRevAgg?._sum?.purchase_value || 0,
          };
          responseCacheService.set(cacheKeyStats, stats, 15);
        } catch {
          stats = {
            totalCustomers: total,
            totalPurchasers: 0,
            totalMql: 0,
            totalProspects: total,
            totalRevenue: 0,
          };
        }
      }

      const { resolveTreatmentValue } = await import('./capi.service');

      // Phase 1.5: Batch-resolve unique treatment texts to avoid N+1 per-row awaits
      const tResolve = Date.now();
      const uniqueTexts = new Set<string>();
      for (const c of rawCustomers) {
        if (c.reservations) {
          for (const r of c.reservations) {
            if ((r.purchase_value === null || r.purchase_value === undefined || r.purchase_value === 0) && (r.treatment_detail || r.raw_text)) {
              uniqueTexts.add((r.treatment_detail || r.raw_text) as string);
            }
          }
        }
      }
      const treatmentMemoMap = new Map<string, number>();
      if (uniqueTexts.size > 0) {
        const textArr = Array.from(uniqueTexts);
        const results = await Promise.all(textArr.map(async (t) => [t, (await resolveTreatmentValue(t)) ?? 0] as const));
        for (const [t, v] of results) treatmentMemoMap.set(t, v);
      }
      const resolveMs = Date.now() - tResolve;

      let customers = rawCustomers.map((c) => {
          let ltv = 0;
          if (c.reservations && c.reservations.length > 0) {
            for (const r of c.reservations) {
              let val = r.purchase_value;
              if (val === null || val === undefined || val === 0) {
                const text = r.treatment_detail || r.raw_text;
                if (text) {
                  val = treatmentMemoMap.get(text) ?? 0;
                } else {
                  val = 0;
                }
              }
              ltv += val;
            }
          }

          const trackingCode = c.adClick?.trackingCode || `TC-${c.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

          return {
            id: c.id,
            phone: c.phone,
            name: c.name || null,
            status: c.status,
            isMql: c.is_mql,
            mqlBubbleCount: c.mql_bubble_count || 0,
            mqlTriggeredAt: c.mql_triggered_at || null,
            trackingCode,
            adClick: c.adClick || null,
            ltv,
            reservationCount: c.reservations.length,
            createdAt: c.created_at,
            updatedAt: c.updated_at,
            aiOverride: c.ai_override || null,
            isAdminLabeled: !!c.is_admin_labeled,
            isHoldLabeled: !!c.is_hold_labeled,
            kecamatan: c.kecamatan || c.pending_kecamatan || null,
            kota: c.kota || c.pending_kota || null,
            kelurahan: c.kelurahan || c.pending_kelurahan || null,
            distanceKm: c.distance_km ?? null,
            ongkir: c.ongkir ?? null,
          };
        });

      // Phase 4: LTV sort now handled by DB-level ltv_cache — no JS sort needed
      // (removed: customers.sort + slice for isLtvSort)

      // Phase 7: Observability — structured log per request
      const elapsed = Date.now() - t0;
      console.log(JSON.stringify({ route: 'listCustomers', elapsed, findManyMs, resolveMs, page, sortBy, total, customersReturned: customers.length }));
      if (elapsed > 500) {
        console.warn(JSON.stringify({ route: 'listCustomers', elapsed, slow: true, findManyMs, resolveMs }));
      }

      return {
        customers,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        stats,
      };
    } catch (error) {
      let list = Array.from(memoryCustomers.values()).filter((c) => c.tenant_id === tenantId);
      if (search) {
        list = list.filter((c) => (c.name || '').includes(search) || (c.phone || '').includes(search));
      }
      if (mqlOnly) {
        list = list.filter((c) => !!c.is_mql);
      }

      if (sortBy === 'name') {
        list.sort((a, b) => (sortOrder === 'asc' ? (a.name || '').localeCompare(b.name || '') : (b.name || '').localeCompare(a.name || '')));
      } else if (sortBy === 'phone') {
        list.sort((a, b) => (sortOrder === 'asc' ? (a.phone || '').localeCompare(b.phone || '') : (b.phone || '').localeCompare(a.phone || '')));
      }

      return {
        customers: list.slice((page - 1) * pageSize, page * pageSize).map((c) => ({
          id: c.id,
          phone: c.phone,
          name: c.name || null,
          status: c.status || 'active',
          isMql: !!c.is_mql,
          mqlBubbleCount: c.mql_bubble_count || 0,
          mqlTriggeredAt: c.mql_triggered_at || null,
          trackingCode: `TC-${c.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
          adClick: null,
          ltv: 0,
          reservationCount: 0,
          createdAt: c.created_at || new Date(),
          updatedAt: c.updated_at || new Date(),
          aiOverride: c.ai_override || null,
          isAdminLabeled: !!c.is_admin_labeled,
          isHoldLabeled: !!c.is_hold_labeled,
          kecamatan: c.kecamatan || c.pending_kecamatan || null,
          kota: c.kota || c.pending_kota || null,
          kelurahan: c.kelurahan || c.pending_kelurahan || null,
          distanceKm: c.distance_km ?? null,
          ongkir: c.ongkir ?? null,
        })),
        total: list.length,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(list.length / pageSize)),
      };
    }
  }

  /**
   * Phase 3: Separate stats endpoint — cached 60s, independent from list query.
   */
  public async getCustomerStats(tenantId: string): Promise<{
    totalCustomers: number;
    totalPurchasers: number;
    totalMql: number;
    totalProspects: number;
    totalRevenue: number;
  }> {
    const cacheKey = `customers:stats:${tenantId}`;
    let stats = responseCacheService.get<any>(cacheKey);
    if (stats) return stats;

    try {
      const [totalCustomersCount, totalPurchasersCount, totalMqlCount, totalRevAgg] = await Promise.all([
        prisma.customer.count({ where: { tenant_id: tenantId, is_sandbox_test: false } }),
        prisma.customer.count({
          where: { tenant_id: tenantId, is_sandbox_test: false, reservations: { some: { status: { notIn: ['cancelled', 'rejected'] } } } },
        }),
        prisma.customer.count({
          where: { tenant_id: tenantId, is_sandbox_test: false, is_mql: true },
        }),
        prisma.reservation.aggregate({
          where: { tenant_id: tenantId, status: { notIn: ['cancelled', 'rejected'] }, customer: { is_sandbox_test: false } },
          _sum: { purchase_value: true },
        }),
      ]);
      stats = {
        totalCustomers: totalCustomersCount,
        totalPurchasers: totalPurchasersCount,
        totalMql: totalMqlCount,
        totalProspects: Math.max(0, totalCustomersCount - totalPurchasersCount),
        totalRevenue: totalRevAgg?._sum?.purchase_value || 0,
      };
      responseCacheService.set(cacheKey, stats, 60);
    } catch {
      stats = {
        totalCustomers: 0,
        totalPurchasers: 0,
        totalMql: 0,
        totalProspects: 0,
        totalRevenue: 0,
      };
    }
    return stats;
  }

  /**
   * Phase 4: Recalculate and persist ltv_cache for a single customer.
   * Called after reservation create/update/cancel to keep ltv_cache in sync.
   * Konsisten dengan listCustomers: jika purchase_value NULL/0, resolve via katalog treatment.
   */
  public async recalculateCustomerLtv(customerId: string, tenantId?: string): Promise<void> {
    try {
      const where: any = { customer_id: customerId, status: { notIn: ['cancelled', 'rejected'] } };
      if (tenantId) where.tenant_id = tenantId;
      const reservations = await prisma.reservation.findMany({
        where,
        select: { purchase_value: true, treatment_detail: true, raw_text: true },
      });
      let ltv = 0;
      let needsResolve = false;
      for (const r of reservations) {
        if (r.purchase_value !== null && r.purchase_value !== undefined && r.purchase_value !== 0) {
          ltv += r.purchase_value;
        } else {
          needsResolve = true;
        }
      }
      if (needsResolve) {
        const { resolveTreatmentValue } = await import('./capi.service');
        for (const r of reservations) {
          if (r.purchase_value === null || r.purchase_value === undefined || r.purchase_value === 0) {
            const text = r.treatment_detail || r.raw_text;
            if (text) {
              const resolved = (await resolveTreatmentValue(text)) ?? 0;
              ltv += resolved;
            }
          }
        }
      }
      await prisma.customer.update({ where: { id: customerId }, data: { ltv_cache: ltv } });
    } catch (err: any) {
      console.warn('[CUSTOMER] recalculateCustomerLtv failed:', err.message);
    }
  }

  /**
   * Phase 4: One-time backfill of ltv_cache for all customers.
   * Run via: npx tsx -e "import('./src/services/customer.service').then(s => s.customerService.backfillAllLtvCache())"
   */
  public async backfillAllLtvCache(): Promise<number> {
    const customers = await prisma.customer.findMany({ select: { id: true } });
    let count = 0;
    for (const c of customers) {
      await this.recalculateCustomerLtv(c.id);
      count++;
    }
    return count;
  }

  /**
   * Mengambil data fakta (Ground Truth) mengenai riwayat reservasi pelanggan dari database.
   */
  public async getCustomerGroundTruth(
    customerId: string,
    tenantId: string
  ): Promise<CustomerGroundTruth | null> {
    try {
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        include: {
          reservations: {
            where: { tenant_id: tenantId },
            orderBy: { created_at: 'desc' },
          },
        },
      });

      if (!customer) return null;

      const activeServices: string[] = [];
      const historicalServicesSet = new Set<string>();
      const now = new Date();

      for (const res of customer.reservations) {
        const serviceName = res.treatment_detail || res.treatment_category;
        if (!serviceName) continue;

        const st = (res.status || '').toLowerCase();
        if (st === 'cancelled') continue;

        const isFutureOrNullDate = !res.booking_date || new Date(res.booking_date) >= now;
        if (st === 'pending' || (st === 'confirmed' && isFutureOrNullDate)) {
          activeServices.push(serviceName);
        } else if (st === 'confirmed' && res.booking_date && new Date(res.booking_date) < now) {
          historicalServicesSet.add(serviceName);
        }
      }

      return {
        name: customer.name || null,
        activeServices,
        historicalServices: Array.from(historicalServicesSet),
        preferences: (customer.preferences as Record<string, any> | null) ?? undefined,
      };
    } catch (err: any) {
      console.warn('[Customer Service] getCustomerGroundTruth failed:', err?.message || err);
      return null;
    }
  }

  /**
   * Sync foto profil customer dari WhatsApp Gateway secara background (non-blocking & rate-limited).
   * URL standar yang diambil dari WAHA/CDN WhatsApp disimpan ke database PostgreSQL.
   */
  public async syncProfilePictureInBackground(
    customerId: string,
    phone: string,
    tenantId: string,
    force = false
  ): Promise<void> {
    if (!phone) return;
    setImmediate(async () => {
      try {
        let shouldFetch = force;
        if (!force) {
          try {
            const customer = await prisma.customer.findUnique({
              where: { id: customerId },
              select: { profile_picture_updated_at: true, profile_picture_url: true },
            });
            if (!customer?.profile_picture_updated_at) {
              shouldFetch = true;
            } else {
              const ageMs = Date.now() - new Date(customer.profile_picture_updated_at).getTime();
              const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
              if (ageMs > THREE_DAYS_MS) {
                shouldFetch = true;
              }
            }
          } catch {
            const mem = memoryCustomers.get(phone);
            if (!mem?.profile_picture_updated_at) {
              shouldFetch = true;
            }
          }
        }

        if (shouldFetch) {
          const { resolveGatewayForTenant } = await import('../integrations/whatsapp/factory');
          const gateway = await resolveGatewayForTenant(tenantId);
          if (gateway && typeof gateway.getProfilePicture === 'function') {
            const picUrl = await gateway.getProfilePicture(phone);
            await this.updateProfilePicture(customerId, phone, picUrl);
          }
        }
      } catch {
        // Best-effort: jangan crash background job
      }
    });
  }

  /**
   * Simpan URL foto profil ke database & memory fallback.
   */
  public async updateProfilePicture(
    customerId: string,
    phone: string,
    profilePictureUrl: string | null
  ): Promise<void> {
    const now = new Date();
    try {
      await prisma.customer.update({
        where: { id: customerId },
        data: {
          profile_picture_url: profilePictureUrl || null,
          profile_picture_updated_at: now,
        },
      });
    } catch {
      // Memory fallback
    }
    const mem = memoryCustomers.get(phone);
    if (mem) {
      mem.profile_picture_url = profilePictureUrl || null;
      mem.profile_picture_updated_at = now;
    }
  }
}

export interface CustomerGroundTruth {
  name: string | null;
  activeServices: string[];
  historicalServices: string[];
  preferences?: Record<string, any>;
}

export const customerService = new CustomerService();
