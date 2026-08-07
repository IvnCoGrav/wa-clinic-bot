import { prisma } from '../db/client';
import { Customer } from '@prisma/client';

// In-Memory store fallback jika DB offline
const memoryCustomers = new Map<string, any>();

export class CustomerService {
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
      let customer = await prisma.customer.findFirst({
        where: { phone, tenant_id: tenantId },
      });

      if (!customer) {
        const newCustomer = await prisma.customer.create({
          data: {
            tenant_id: tenantId,
            phone,
            name: name || null,
          },
        });

        if (newCustomer) {
          customer = newCustomer;
          // skipFollowUpScheduling: true saat dipanggil dari migration service
          // agar legacy customer tidak mendapat follow-up NO_PURCHASE yang tidak relevan.
          if (!options?.skipFollowUpScheduling) {
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
          zipcode: null,
          pending_zipcode: null,
          status: 'active',
          block_reason: null,
          blocked_at: null,
          is_legacy_source: false,
          legacy_scraped_at: null,
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
      zipcode?: string;
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
          zipcode: data.zipcode,
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
            zipcode: data.zipcode !== undefined ? data.zipcode : cust.zipcode,
            updated_at: new Date(),
          });
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
          pending_lat: data.lat,
          pending_lng: data.lng,
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
            pending_lat: data.lat !== undefined ? data.lat : cust.pending_lat,
            pending_lng: data.lng !== undefined ? data.lng : cust.pending_lng,
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
              lat: pendingData.pending_lat,
              lng: pendingData.pending_lng,
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
      return await prisma.customer.update({
        where: { id: customerId },
        data: { name },
      });
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
  public async getCustomerById(customerId: string, tenantId: string): Promise<any> {
    try {
      const customer = await prisma.customer.findUnique({ where: { id: customerId } });
      if (customer) return customer;
      for (const [, cust] of memoryCustomers.entries()) {
        if (cust.id === customerId && cust.tenant_id === tenantId) return cust;
      }
      return null;
    } catch (error) {
      for (const [, cust] of memoryCustomers.entries()) {
        if (cust.id === customerId && cust.tenant_id === tenantId) return cust;
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

      const updated = await prisma.tenant.update({
        where: { id: targetId },
        data: {
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
      if (newlyTriggeredMql && mqlAutoLead) {
        try {
          const { capiService } = await import('./capi.service');
          await capiService.sendCapiEvent({
            eventName: 'Lead',
            customer: updatedCustomer,
            tenantId,
            customData: {
              mql_bubble_count: newCount,
              mql_threshold: mqlThreshold,
              triggered_reason: 'MQL_BUBBLE_THRESHOLD_REACHED',
            },
          });
          console.log(`[MQL AUTOMATION] Customer ${customerId} (${updatedCustomer.phone}) reached ${newCount} bubbles (threshold: ${mqlThreshold}). Lead event triggered.`);
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
    options?: { search?: string; page?: number; pageSize?: number; mqlOnly?: boolean }
  ): Promise<{ customers: any[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const page = Math.max(1, options?.page || 1);
    const pageSize = Math.min(100, Math.max(1, options?.pageSize || 20));
    const search = options?.search?.trim();
    const mqlOnly = options?.mqlOnly;

    try {
      const where: any = { tenant_id: tenantId };
      if (mqlOnly) {
        where.is_mql = true;
      }
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
          { adClick: { trackingCode: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const [rawCustomers, total] = await Promise.all([
        prisma.customer.findMany({
          where,
          include: {
            adClick: true,
            reservations: {
              where: { status: { in: ['confirmed', 'completed'] } },
            },
          },
          orderBy: { created_at: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.customer.count({ where }),
      ]);

      const { resolveTreatmentValue } = await import('./capi.service');

      const customers = await Promise.all(
        rawCustomers.map(async (c) => {
          let ltv = 0;
          if (c.reservations && c.reservations.length > 0) {
            for (const r of c.reservations) {
              const val = await resolveTreatmentValue(r.treatment_detail || r.raw_text);
              ltv += val || 0;
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
          };
        })
      );

      return {
        customers,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      };
    } catch (error) {
      const list = Array.from(memoryCustomers.values()).filter((c) => c.tenant_id === tenantId);
      return {
        customers: list.map((c) => ({
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
        })),
        total: list.length,
        page: 1,
        pageSize,
        totalPages: 1,
      };
    }
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
}

export interface CustomerGroundTruth {
  name: string | null;
  activeServices: string[];
  historicalServices: string[];
  preferences?: Record<string, any>;
}

export const customerService = new CustomerService();
