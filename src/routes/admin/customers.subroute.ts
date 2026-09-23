import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { customerService } from '../../services/customer.service';
import { auditService } from '../../services/audit.service';
import { conversationService } from '../../services/conversation.service';
import { ConversationState } from '@prisma/client';
import { AI_ELIGIBILITY_ESCALATION_REASON } from '../../services/ai-eligibility.service';
import { responseCacheService } from '../../services/response-cache.service';
import { getClinicLocationAsync } from '../../config/clinic-location';

export async function customerAdminRoutes(fastify: FastifyInstance) {
  // Invalidate cache saat ada create/update/delete customer
  fastify.addHook('onResponse', async (request) => {
    const method = request.method;
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) && request.url.includes('/customers')) {
      // Phase 3: only invalidate list cache, preserve stats cache (60s)
      if (!request.url.includes('/stats')) {
        responseCacheService.invalidatePrefix('customers:list:');
      }
    }
  });

  /**
   * GET /api/admin/customers/stats
   * Phase 3: Stats terpisah — cached 60s, tidak memblok list query.
   */
  fastify.get('/api/admin/customers/stats', async (request, reply) => {
    try {
      const stats = await customerService.getCustomerStats(DEFAULT_TENANT_ID);
      return reply
        .header('Cache-Control', 'private, max-age=5, stale-while-revalidate=30')
        .status(200)
        .send({ success: true, stats });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/admin/customers/map-points
   * Endpoint ringan untuk peta sebaran: hanya kolom spasial + identitas ringkas.
   *
   * - Default difokuskan ke wilayah layanan dengan filter toleran: teks
   *   kota/kecamatan mengandung surabaya/sidoarjo/gresik/sby/sda, ATAU
   *   distance_km <= 35, ATAU koordinat di dalam bounding box Surabaya Raya.
   * - `?scope=all` menampilkan seluruh titik tanpa batas wilayah.
   * - `?includeCentroids=false` mematikan titik sentroid estimasi.
   * - Titik sentroid: pelanggan dengan lat NULL tetapi punya kelurahan/kecamatan
   *   valid → di-resolve ke koordinat gazetteer, ditandai `is_estimated_centroid`.
   * - `clinic` memuat lokasi basecamp tenant-aware (getClinicLocationAsync).
   */
  // Southwest (Porong/Krian/Mojokerto) ke Northeast (Gresik Utara/Ujungpangkah/Panceng)
  const SURABAYA_RAYA_BBOX = { minLat: -7.90, maxLat: -6.75, minLng: 112.10, maxLng: 113.15 };
  const AREA_KEYWORDS = ['surabaya', 'sidoarjo', 'gresik', 'sby', 'sda'];

  const isWithinServiceArea = (c: any): boolean => {
    const areaText = `${c.kota || ''} ${c.kecamatan || ''}`.toLowerCase();
    if (AREA_KEYWORDS.some((w) => areaText.includes(w))) return true;
    if (typeof c.distance_km === 'number' && c.distance_km <= 35) return true;
    if (typeof c.lat === 'number' && typeof c.lng === 'number') {
      return (
        c.lat >= SURABAYA_RAYA_BBOX.minLat &&
        c.lat <= SURABAYA_RAYA_BBOX.maxLat &&
        c.lng >= SURABAYA_RAYA_BBOX.minLng &&
        c.lng <= SURABAYA_RAYA_BBOX.maxLng
      );
    }
    return false;
  };

  fastify.get(
    '/api/admin/customers/map-points',
    async (
      request: FastifyRequest<{
        Querystring: { kota?: string; scope?: string; includeCentroids?: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const kota = request.query?.kota?.trim();
        const showAll = request.query?.scope === 'all';
        const includeCentroids = request.query?.includeCentroids !== 'false';

        const qualifiedFilter = {
          OR: [
            { is_mql: true },
            { reservations: { some: { status: { notIn: ['cancelled', 'rejected'] } } } },
          ],
        };
        const coordsRows = await prisma.customer.findMany({
          where: {
            tenant_id: DEFAULT_TENANT_ID,
            is_sandbox_test: false,
            lat: { not: null },
            lng: { not: null },
            ...qualifiedFilter,
            ...(kota ? { kota: { contains: kota, mode: 'insensitive' } } : {}),
          },
          select: {
            id: true,
            name: true,
            phone: true,
            lat: true,
            lng: true,
            kota: true,
            kecamatan: true,
            kelurahan: true,
            status: true,
            is_mql: true,
            is_out_of_coverage: true,
            distance_km: true,
            location_source: true,
            preferences: true,
            reservations: {
              where: { status: { notIn: ['cancelled', 'rejected'] } },
              select: { id: true },
              take: 1,
            },
          },
          take: 5000,
        });

        const clinic = await getClinicLocationAsync(DEFAULT_TENANT_ID);
        const { haversineKm } = await import('../../utils/gazetteer');
        let points: any[] = coordsRows
          .filter(
            (c: any) =>
              typeof c.lat === 'number' &&
              typeof c.lng === 'number' &&
              c.lat >= -90 &&
              c.lat <= 90 &&
              c.lng >= -180 &&
              c.lng <= 180
          )
          .map((c: any) => {
            let dist = typeof c.distance_km === 'number' ? c.distance_km : null;
            if (dist == null && clinic && typeof clinic.lat === 'number' && typeof clinic.lng === 'number') {
              dist = Math.round(haversineKm(clinic.lat, clinic.lng, c.lat, c.lng) * 10) / 10;
            }
            const isOutOfCoverage =
              c.is_out_of_coverage ??
              (typeof clinic?.maxCoverageKm === 'number' && dist != null ? dist > clinic.maxCoverageKm : false);
            const prefs = (c.preferences as any) || {};
            let effectiveSource = c.location_source;
            if (!effectiveSource) {
              if (prefs.location_updated_by_staff_name || prefs.location_updated_by_staff_id || prefs.field_gps_lat) {
                effectiveSource = 'manual_staff';
              } else if (prefs.source === 'geocoding' || prefs.location_source === 'geocoding') {
                effectiveSource = 'estimated_area';
              } else {
                effectiveSource = 'gps_pin';
              }
            }
            return {
              ...c,
              distance_km: dist,
              is_out_of_coverage: isOutOfCoverage,
              location_source: effectiveSource,
              has_reservation: Array.isArray(c.reservations) && c.reservations.length > 0,
              reservations: undefined,
              preferences: undefined,
              is_estimated_centroid: false,
            };
          });

        if (!showAll) {
          points = points.filter(isWithinServiceArea);
        }

        // Titik sentroid estimasi: pelanggan tanpa koordinat presisi namun punya wilayah valid.
        if (includeCentroids) {
          try {
            const nullRows = await prisma.customer.findMany({
              where: {
                tenant_id: DEFAULT_TENANT_ID,
                is_sandbox_test: false,
                lat: null,
                ...qualifiedFilter,
                ...(kota ? { kota: { contains: kota, mode: 'insensitive' } } : {}),
              },
              select: {
                id: true,
                name: true,
                phone: true,
                kota: true,
                kecamatan: true,
                kelurahan: true,
                status: true,
                is_mql: true,
                is_out_of_coverage: true,
                distance_km: true,
                location_source: true,
                reservations: {
                  where: { status: { notIn: ['cancelled', 'rejected'] } },
                  select: { id: true },
                  take: 1,
                },
              },
              take: 5000,
            });

            const clinic = await getClinicLocationAsync(DEFAULT_TENANT_ID);
            const { getGazetteerCoordinates, haversineKm } = await import('../../utils/gazetteer');
            const { isValidAreaName } = await import('../../utils/wilayah-normalizer');

            for (const c of nullRows) {
              const kelurahan = isValidAreaName(c.kelurahan) ? c.kelurahan : null;
              const kecamatan = isValidAreaName(c.kecamatan) ? c.kecamatan : null;
              if (!kelurahan) {
                // Hanya kelurahan spesifik yang boleh jadi sentroid — kecamatan saja tidak dimasukkan
                continue;
              }
              // Prioritaskan pencocokan kombinasi kelurahan + kecamatan jika keduanya tersedia (desa kembar)
              let gaz = null;
              if (kelurahan && kecamatan) {
                gaz = getGazetteerCoordinates(`${kelurahan} ${kecamatan}`);
              }
              if (!gaz) {
                gaz = getGazetteerCoordinates(kelurahan || kecamatan || '');
              }
              if (!gaz || !Number.isFinite(gaz.lat) || !Number.isFinite(gaz.lng)) continue;
              const dist = Math.round(haversineKm(clinic.lat, clinic.lng, gaz.lat, gaz.lng) * 10) / 10;
              const isOutOfCoverage = typeof clinic.maxCoverageKm === 'number' && dist > clinic.maxCoverageKm;
              const centroidPoint: any = {
                id: c.id,
                name: c.name,
                phone: c.phone,
                lat: gaz.lat,
                lng: gaz.lng,
                kota: c.kota || gaz.kota,
                kecamatan: c.kecamatan || gaz.kecamatan,
                kelurahan: c.kelurahan || gaz.kelurahan,
                status: c.status,
                is_mql: c.is_mql,
                has_reservation: Array.isArray(c.reservations) && c.reservations.length > 0,
                is_out_of_coverage: isOutOfCoverage,
                distance_km: dist,
                // Titik sentroid = estimasi wilayah (bukan GPS presisi) apa pun kolom aslinya.
                location_source: 'estimated_area',
                is_estimated_centroid: true,
              };
              if (showAll || isWithinServiceArea(centroidPoint)) {
                points.push(centroidPoint);
              }
            }
          } catch (centroidErr: any) {
            // Sentroid bersifat pelengkap; kegagalan tidak boleh menggagalkan peta.
            console.warn('[map-points] sentroid gagal:', centroidErr?.message);
          }
        }

        // Opsi 1: peta hanya untuk sebaran customer yang sudah treatment (has_reservation) + MQL (toggleable)
        // Aktif murni tanpa reservasi & tanpa MQL tidak ditampilkan sama sekali.
        points = points.filter((p: any) => p.has_reservation || p.is_mql === true);

        return reply
          .header('Cache-Control', 'private, max-age=15, stale-while-revalidate=60')
          .status(200)
          .send({
            success: true,
            points,
            total: points.length,
            clinic: {
              lat: clinic.lat,
              lng: clinic.lng,
              name: clinic.name,
              maxCoverageKm: clinic.maxCoverageKm,
              rings: [5, 15, clinic.maxCoverageKm],
            },
          });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/customers
   * Mengambil daftar customer database lengkap dengan Tracking Code, LTV, MQL Status, dan pagination
   */
  fastify.get(
    '/api/admin/customers',
    async (
      request: FastifyRequest<{
        Querystring: {
          search?: string;
          page?: string;
          pageSize?: string;
          mqlOnly?: string;
          segment?: 'all' | 'purchased' | 'mql' | 'prospect';
          sortBy?: string;
          sortOrder?: 'asc' | 'desc';
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { search, page, pageSize, mqlOnly, segment, sortBy, sortOrder } = request.query || {};
        const result = await customerService.listCustomersWithLtvAndAdClick(DEFAULT_TENANT_ID, {
          search,
          page: parseInt(page || '1', 10) || 1,
          pageSize: parseInt(pageSize || '20', 10) || 20,
          mqlOnly: mqlOnly === 'true',
          segment,
          sortBy,
          sortOrder,
        });
        return reply
          .header('Cache-Control', 'private, max-age=5, stale-while-revalidate=30')
          .status(200)
          .send({ success: true, ...result });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/customers/:id
   * Mengambil detail lengkap customer termasuk reservasi, anak, label, dan ad click
   */
  fastify.get(
    '/api/admin/customers/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      try {
        let customer: any = null;
        try {
          customer = await prisma.customer.findFirst({
            where: { id, tenant_id: DEFAULT_TENANT_ID },
            include: {
              children: true,
              reservations: { orderBy: { created_at: 'desc' }, include: { assigned_staff: { select: { id: true, name: true } } } },
              labels: { include: { label: true } },
              adClick: true,
              follow_ups: {
                orderBy: { scheduled_at: 'asc' },
                include: {
                  reservation: {
                    select: {
                      id: true,
                      booking_date: true,
                      treatment_category: true,
                      treatment_detail: true,
                    },
                  },
                },
              },
            },
          });
        } catch (dbErr) {
          // DB offline fallback
        }

        if (!customer) {
          customer = await customerService.getCustomerById(id);
        }

        if (!customer) {
          for (const c of customerService.getMemoryCustomers().values()) {
            if (c?.id === id || c?.phone === id) {
              customer = c;
              break;
            }
          }
        }

        if (!customer) {
          return reply.status(404).send({ success: false, error: 'Customer tidak ditemukan' });
        }

        // Hydrate follow_ups bila belum ter-include (fallback memory / customerService)
        if (!Array.isArray((customer as any).follow_ups)) {
          try {
            const fus = await prisma.followUp.findMany({
              where: { customer_id: customer.id, tenant_id: DEFAULT_TENANT_ID },
              orderBy: { scheduled_at: 'asc' },
              include: {
                reservation: {
                  select: {
                    id: true,
                    booking_date: true,
                    treatment_category: true,
                    treatment_detail: true,
                  },
                },
              },
            });
            (customer as any).follow_ups = fus;
          } catch {
            (customer as any).follow_ups = [];
          }
        } else if ((customer as any).follow_ups == null) {
          (customer as any).follow_ups = [];
        }

        let customerLabels = customer.labels || [];
        if (customerLabels.length === 0) {
          try {
            const { memoryCustomerLabels, memoryLabels } = await import('./labels.subroute');
            const matched: any[] = [];
            for (const key of memoryCustomerLabels) {
              if (key.startsWith(`${customer.id}:`) || key.startsWith(`${customer.phone}:`)) {
                const lid = key.split(':')[1];
                const l = memoryLabels.get(lid);
                if (l) matched.push({ label: l });
              }
            }
            if (matched.length > 0) {
              customerLabels = matched;
            }
          } catch {
            // fallback ignore
          }
        }

        // Fondasi DTO kanonikal: pastikan r.customer tidak pernah undefined
        if (Array.isArray((customer as any).reservations)) {
          (customer as any).reservations = (customer as any).reservations.map((r: any) => ({
            ...r,
            customer: r.customer || {
              id: customer.id,
              name: customer.name,
              phone: customer.phone,
              kelurahan: customer.kelurahan,
              kecamatan: customer.kecamatan,
              kota: customer.kota,
              children: customer.children || [],
              ongkir: (customer as any).ongkir || 0,
            },
          }));
        }

        // Hydrate children dengan current_age dinamis
        let enrichedChildren = customer.children || [];
        try {
          const { childService } = await import('../../services/child.service');
          enrichedChildren = await childService.getChildrenWithCurrentAge(customer.id);
        } catch (e) {
          enrichedChildren = customer.children || [];
        }

        let ltv = 0;
        let purchaseCount = 0;
        try {
          const { resolveTreatmentValue } = await import('../../services/capi.service');
          for (const r of customer.reservations || []) {
            if (['cancelled', 'rejected'].includes(String(r.status || '').toLowerCase())) continue;
            let val: number | null | undefined = null;
            if (r.purchase_value != null && Number.isFinite(Number(r.purchase_value))) {
              val = Number(r.purchase_value);
            } else {
              val = (await resolveTreatmentValue(r.treatment_detail || r.raw_text)) ?? null;
            }
            if (val) {
              ltv += val;
              purchaseCount++;
            } else if (r.purchase_value != null) {
              purchaseCount++;
            }
          }
        } catch (e) {
          ltv = 0;
          purchaseCount = 0;
        }

        const customerAddress = (customer as any).address || (customer as any).preferences?.address || (customer as any).preferences?.full_address || null;

        return reply.status(200).send({
          success: true,
          data: {
            ...customer,
            address: customerAddress,
            children: enrichedChildren,
            reservations: customer.reservations || [],
            labels: customerLabels,
            follow_ups: (customer as any).follow_ups || [],
            ltv: ((customer as any).ltv_cache ?? ltv) as any,
            purchaseCount: purchaseCount as any,
          },
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/customers/:id/messages
   * Riwayat percakapan kronologis (Chat History) untuk modal pada customer tertentu
   */
  fastify.get(
    '/api/admin/customers/:id/messages',
    async (
      request: FastifyRequest<{ Params: { id: string }; Querystring: { limit?: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const limit = Math.min(1000, Math.max(1, parseInt(request.query?.limit || '200', 10) || 200));
      try {
        const conversations = await prisma.conversation.findMany({
          where: { customer_id: id, tenant_id: DEFAULT_TENANT_ID },
          orderBy: { updated_at: 'desc' },
        });

        if (conversations.length === 0) {
          return reply.status(200).send({ success: true, count: 0, data: [] });
        }

        const conversationIds = conversations.map((c) => c.id);
        // Ambil N pesan TERBARU (desc) lalu kembalikan kronologis (asc) agar
        // customer berriwayat panjang tidak kehilangan pesan terbarunya di modal.
        const rawMessages = await prisma.message.findMany({
          where: { conversation_id: { in: conversationIds }, tenant_id: DEFAULT_TENANT_ID },
          orderBy: { created_at: 'desc' },
          take: limit,
        });
        const messages = rawMessages.reverse();

        return reply.status(200).send({ success: true, count: messages.length, data: messages });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/customers/:id/active-reservations
   *
   * Daftar jadwal AKTIF customer (status `confirmed` atau `hold`) yang belum
   * selesai: booking_date hari ini atau ke depan. Dipakai modal Create Reservation
   * & Live Chat untuk peringatan dini "customer sudah punya jadwal aktif" sehingga
   * admin tidak membuat duplikat / split-brain booking.
   *
   * Definisi kanonis (selaras reservation-core ACTIVE_STATUSES): confirmed|hold,
   * tanggal >= awal hari ini (WIB). Reservasi tanpa tanggal (null) diabaikan.
   */
  fastify.get(
    '/api/admin/customers/:id/active-reservations',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      try {
        const WIB_OFFSET_MS = 7 * 3600000;
        const nowUtc = Date.now();
        const wibNow = new Date(nowUtc + WIB_OFFSET_MS);
        const startOfTodayWib = new Date(
          Date.UTC(wibNow.getUTCFullYear(), wibNow.getUTCMonth(), wibNow.getUTCDate(), 0, 0, 0, 0) - WIB_OFFSET_MS
        );

        const reservations = await prisma.reservation.findMany({
          where: {
            customer_id: id,
            tenant_id: DEFAULT_TENANT_ID,
            status: { in: ['confirmed', 'hold'] },
            booking_date: { gte: startOfTodayWib },
          },
          orderBy: { booking_date: 'asc' },
          select: {
            id: true,
            status: true,
            treatment_detail: true,
            treatment_category: true,
            booking_date: true,
            duration_minutes: true,
            assigned_staff_id: true,
            is_repeat_order: true,
          },
        });

        return reply
          .header('Cache-Control', 'no-store, no-cache, must-revalidate')
          .status(200)
          .send({ success: true, count: reservations.length, data: reservations });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * POST /api/admin/customers/:id/send-event
   * Manual trigger event Meta Pixel / CAPI untuk customer tertentu
   */
  fastify.post(
    '/api/admin/customers/:id/send-event',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { eventName: string; value?: number; currency?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { eventName, value, currency = 'IDR' } = request.body || {};

      if (!eventName) {
        return reply.status(400).send({ success: false, error: 'eventName wajib diisi (mis. Lead, Purchase, ViewContent)' });
      }

      try {
        const customer = await prisma.customer.findFirst({
          where: { id, tenant_id: DEFAULT_TENANT_ID },
          include: { adClick: true },
        });

        if (!customer) {
          return reply.status(404).send({ success: false, error: 'Customer tidak ditemukan.' });
        }

        const { capiService } = await import('../../services/capi.service');
        const capiResult = await capiService.sendCapiEvent({
          eventName,
          customer,
          adClick: customer.adClick || {
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'] || 'Admin Manual Event Trigger',
          },
          value,
          currency,
          tenantId: DEFAULT_TENANT_ID,
          customData: {
            manual_trigger: true,
            triggered_by_admin: (request as any).adminIdentity || 'Admin',
          },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'MANUAL_SEND_META_EVENT',
          targetId: id,
          payload: { eventName, value, currency, success: capiResult.success },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: `Event '${eventName}' berhasil dikirim ke Meta CAPI untuk customer ${customer.phone}.`,
          data: capiResult,
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * POST /api/admin/customer/:id/block
   * REST Endpoint untuk memblokir customer secara manual
   */
  fastify.post(
    '/api/admin/customer/:id/block',
    async (request: FastifyRequest<{ Params: { id: string }; Body: { reason: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const { reason } = request.body || {};
      if (!reason) {
        return reply.status(400).send({ error: 'reason is required' });
      }

      try {
        const customer = await customerService.blockCustomer(id, reason, DEFAULT_TENANT_ID);
        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'BLOCK_CUSTOMER',
          targetId: id,
          payload: { reason },
          ipAddress: request.ip,
        });
        return reply.status(200).send({ success: true, data: customer });
      } catch (error: any) {
        return reply.status(404).send({ success: false, error: error.message });
      }
    }
  );

  /**
   * POST /api/admin/customer/:id/unblock
   * REST Endpoint untuk membuka blokir customer
   */
  fastify.post(
    '/api/admin/customer/:id/unblock',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      try {
        const customer = await customerService.unblockCustomer(id, DEFAULT_TENANT_ID);
        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UNBLOCK_CUSTOMER',
          targetId: id,
          ipAddress: request.ip,
        });
        return reply.status(200).send({ success: true, data: customer });
      } catch (error: any) {
        return reply.status(404).send({ success: false, error: error.message });
      }
    }
  );

  /**
   * PATCH /api/admin/customers/:id/label
   * Set/toggle label 'admin' atau 'hold' untuk customer.
   * Sumber kebenaran = kolom DB (is_admin_labeled / is_hold_labeled) + tabel
   * CustomerLabel internal. Mandat Mutlak Anti-Label WAHA: zero mutasi label
   * WAHA (tanpa addLabel/removeLabel/batching ke WA) — DB adalah single source of truth.
   */
  fastify.patch(
    '/api/admin/customers/:id/label',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { label: 'admin' | 'hold'; enabled: boolean };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { label, enabled } = request.body || {};
      const normalizedLabel = String(label || '').toLowerCase();
      if (normalizedLabel !== 'admin' && normalizedLabel !== 'hold') {
        return reply.status(400).send({ success: false, error: 'label harus "admin" atau "hold".' });
      }
      if (typeof enabled !== 'boolean') {
        return reply.status(400).send({ success: false, error: 'enabled wajib boolean.' });
      }

      try {
        const customer = await customerService.getCustomerById(id, DEFAULT_TENANT_ID);
        if (!customer) {
          return reply.status(404).send({ success: false, error: 'Customer tidak ditemukan.' });
        }

        // 1. Kolom DB adalah sumber kebenaran
        await customerService.setLabelFlags(customer.phone, {
          isAdminLabeled: normalizedLabel === 'admin' ? enabled : undefined,
          isHoldLabeled: normalizedLabel === 'hold' ? enabled : undefined,
        });

        // 2. Mandat Anti-Label WAHA: label toggle hanya via DB internal (customer.labels)
        // Zero WAHA label mutation — is_admin_labeled / is_hold_labeled sudah di-sync oleh reconciliation service


        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: enabled ? 'ADD_LABEL' : 'REMOVE_LABEL',
          targetId: id,
          payload: { label, enabled, dbOnly: true },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: `Label "${label}" ${enabled ? 'dipasang' : 'dilepas'} untuk ${customer.name || customer.phone}.`,
          data: { id, phone: customer.phone, label, enabled, dbOnly: true },
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/customers/flagged
   * REST Endpoint untuk melihat percakapan yang di-flag untuk review
   */
  fastify.get('/api/admin/customers/flagged', async (request, reply) => {
    try {
      const flaggedConversations = await prisma.conversation.findMany({
        where: { review_flagged: true, tenant_id: DEFAULT_TENANT_ID },
        include: { customer: true },
      });
      return reply.status(200).send({ success: true, count: flaggedConversations.length, data: flaggedConversations });
    } catch (error) {
      const mockFlagged: any[] = [];
      return reply
        .status(200)
        .send({ success: true, count: mockFlagged.length, data: mockFlagged, note: 'Fallback in-memory mode' });
    }
  });

  /**
   * PATCH /api/admin/customers/:id/ai-override
   * Set override AI per customer (FORCE_ON / FORCE_OFF / null).
   */
  fastify.patch(
    '/api/admin/customers/:id/ai-override',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { aiOverride?: 'FORCE_ON' | 'FORCE_OFF' | null };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { aiOverride } = request.body || {};
      if (aiOverride !== 'FORCE_ON' && aiOverride !== 'FORCE_OFF' && aiOverride !== null) {
        return reply.status(400).send({ error: 'aiOverride harus FORCE_ON, FORCE_OFF, atau null.' });
      }

      try {
        const updated = await customerService.setAiOverride(id, DEFAULT_TENANT_ID, aiOverride);

        if (aiOverride === 'FORCE_ON') {
          const silenced = await prisma.conversation.findFirst({
            where: {
              customer_id: id,
              tenant_id: DEFAULT_TENANT_ID,
              is_human_handling: true,
              escalation_reason: AI_ELIGIBILITY_ESCALATION_REASON,
            },
          });
          if (silenced) {
            const restoredState = silenced.previous_state || ConversationState.INITIAL;
            await conversationService.updateConversationState(
              silenced.id,
              {
                currentState: restoredState as any,
                isHumanHandling: false,
                humanHandlingSince: null,
                escalationReason: null,
              },
              DEFAULT_TENANT_ID
            );
            // Mandat Anti-Label WAHA: hold release via DB internal (is_human_handling), zero WAHA label
            console.log(
              `[AI OVERRIDE] FORCE_ON utk customer ${updated.phone} — conversation ${silenced.id} di-release dari LEGACY_AI_SCOPE_DISABLED.`
            );
          }
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_AI_OVERRIDE',
          targetId: id,
          payload: { aiOverride },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: `Override AI customer diperbarui: ${aiOverride || 'ikut aturan tenant'}.`,
          data: { id, aiOverride: updated.ai_override ?? null },
        });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * PUT /api/admin/customers/:id & PATCH /api/admin/customers/:id
   * Update field dasar customer (nama, phone, alamat, koordinat, landmark, dan data anak).
   * Body: { name?, phone?, address?, kelurahan?, kecamatan?, kota?, zipcode?, landmark?, lat?, lng?, children? }
   */
  const handleUpdateCustomer = async (
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        name?: string;
        phone?: string;
        address?: string;
        kelurahan?: string | null;
        kecamatan?: string | null;
        kota?: string | null;
        zipcode?: string | null;
        landmark?: string | null;
        lat?: number | null;
        lng?: number | null;
        children?: Array<{
          id?: string;
          name: string;
          ageText?: string;
          raw_age_text?: string;
          birthDate?: string | null;
        }>;
      };
    }>,
    reply: FastifyReply
  ) => {
    const { id } = request.params;
    const { name, phone, address, kelurahan, kecamatan, kota, zipcode, landmark, lat, lng, children } =
      request.body || {};

    // Validasi minimal ada satu field yang diupdate
    if (
      name === undefined &&
      phone === undefined &&
      address === undefined &&
      kelurahan === undefined &&
      kecamatan === undefined &&
      kota === undefined &&
      zipcode === undefined &&
      landmark === undefined &&
      lat === undefined &&
      lng === undefined &&
      children === undefined
    ) {
      return reply.status(400).send({ success: false, error: 'Minimal satu field harus diisi untuk update.' });
    }

    try {
      const customer = await customerService.getCustomerById(id, DEFAULT_TENANT_ID);

      if (!customer) {
        return reply.status(404).send({ success: false, error: 'Customer tidak ditemukan.' });
      }

      const updatedCustomer = await customerService.updateCustomer(
        id,
        { name, phone, address, kelurahan, kecamatan, kota, zipcode, landmark, lat, lng, children },
        DEFAULT_TENANT_ID
      );

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'UPDATE_CUSTOMER_PROFILE',
        targetId: id,
        payload: { name, phone, address, kelurahan, kecamatan, kota, zipcode, landmark, lat, lng, childrenCount: children?.length },
        ipAddress: request.ip,
      });

      return reply.status(200).send({
        success: true,
        message: 'Profil customer berhasil diperbarui.',
        data: updatedCustomer,
      });
    } catch (err: any) {
      console.error('[ADMIN CUSTOMER] Error updating customer profile:', err.message);
      return reply.status(500).send({ success: false, error: err.message });
    }
  };

  fastify.put('/api/admin/customers/:id', handleUpdateCustomer);
  fastify.patch('/api/admin/customers/:id', handleUpdateCustomer);

  /**
    * POST /api/admin/customers/:id/refresh-location
    * Refresh & Hitung Ulang Lokasi, Jarak & Ongkir berdasar hierarki validitas (Bidan → Customer → DB → Geocoding)
    */
  fastify.post(
    '/api/admin/customers/:id/refresh-location',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      try {
        const performedBy = (request as any).adminIdentity || (request as any).adminSession?.adminIdentity || 'Admin';
        const result = await customerService.refreshCustomerLocationAndOngkir(id, DEFAULT_TENANT_ID, performedBy);
        if (!result.success) {
          return reply.status(400).send({ success: false, error: result.error });
        }
        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: performedBy,
          action: 'CUSTOMER_LOCATION_REFRESHED',
          targetId: id,
          payload: result.data,
          ipAddress: request.ip,
        });
        const ongkirStr = new Intl.NumberFormat('id-ID').format(result.data!.ongkir);
        return reply.status(200).send({
          success: true,
          data: result.data,
          message: `Lokasi & ongkir berhasil dimutakhirkan berdasarkan ${result.data!.sourceLabel} (Jarak: ${result.data!.distanceKm.toFixed(2)} km, Ongkir: Rp ${ongkirStr}).`,
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
    * PUT /api/admin/customers/:id/location
    * Admin memperbarui foto rumah, catatan patokan, dan/atau titik koordinat GPS customer.
    */
  fastify.put(
    '/api/admin/customers/:id/location',
    { bodyLimit: 12 * 1024 * 1024 },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: {
          housePhotoB64?: string | null;
          landmark?: string | null;
          lat?: number | null;
          lng?: number | null;
          removePhoto?: boolean;
        };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { housePhotoB64, landmark, lat, lng, removePhoto } = request.body || {};

      try {
        const customer = await customerService.getCustomerById(id, DEFAULT_TENANT_ID);

        if (!customer) {
          return reply.status(404).send({ success: false, error: 'Customer tidak ditemukan.' });
        }

        const { mediaService } = await import('../../services/media.service');

        const hasNewPhoto = !!housePhotoB64 && housePhotoB64.startsWith('data:image/');
        const targetLatPre = lat !== undefined ? lat : customer.lat;
        const targetLngPre = lng !== undefined ? lng : customer.lng;
        if (hasNewPhoto && (targetLatPre == null || targetLngPre == null)) {
          return reply.status(400).send({ success: false, error: 'Foto rumah wajib disertai koordinat GPS. Isi titik GPS dulu sebelum menyimpan foto.' });
        }

        let housePhotoUrl: string | null = (customer.preferences as any)?.house_photo_url || null;

        let distanceKm = customer.distance_km;
        let newOngkir: number | null = null;
        const targetLat = lat !== undefined ? lat : customer.lat;
        const targetLng = lng !== undefined ? lng : customer.lng;

        if (targetLat != null && targetLng != null) {
          // Validasi range koordinat Indonesia
          if (targetLat < -12 || targetLat > 7 || targetLng < 94 || targetLng > 142) {
            return reply.status(400).send({ success: false, error: 'Koordinat GPS di luar wilayah Indonesia atau tidak valid.' });
          }

          const { clinicConfig } = await import('../../config/clinic');
          const clinicCoords = { lat: clinicConfig.lat, lng: clinicConfig.lng };
          const { deliveryService } = await import('../../services/delivery.service');
          const deliveryResult = await deliveryService.calculateDelivery(
            { lat: targetLat, lng: targetLng },
            clinicCoords,
            DEFAULT_TENANT_ID
          );
          distanceKm = deliveryResult.distanceKm;
          newOngkir = deliveryResult.promoPrice;

          // Skema kroscek 1: Tolak jika jarak dari klinik melenceng > 45 km (di luar area jangkauan)
          const MAX_ALLOWED_DISTANCE_KM = 45;
          if (distanceKm > MAX_ALLOWED_DISTANCE_KM) {
            return reply.status(400).send({
              success: false,
              error: `Titik GPS terdeteksi berjarak ${distanceKm.toFixed(1)} km dari klinik (melenceng jauh di luar area jangkauan maksimal ${MAX_ALLOWED_DISTANCE_KM} km). Pastikan titik koordinat berada di lokasi rumah pasien.`,
            });
          }

          // Skema kroscek 2: Tolak jika pergeseran titik melenceng > 25 km dari data kelurahan/wilayah customer sebelumnya
          if (customer.distance_km && Math.abs(distanceKm - customer.distance_km) > 25) {
            return reply.status(400).send({
              success: false,
              error: `Titik GPS melenceng terlalu jauh (${Math.abs(distanceKm - customer.distance_km).toFixed(1)} km selisih) dari estimasi area ${customer.kelurahan || 'pasien'}. Pembaruan lokasi ditolak untuk mencegah salah alamat.`,
            });
          }
        }

        // Cek selisih jarak dengan koordinat awal (Haversine > 1km)
        let shouldUpdatePrimaryCoords = true;
        let diffFromOriginalKm: number | null = null;
        const baseLandmark = landmark !== undefined ? (landmark?.trim() || null) : ((customer.preferences as any)?.landmark || null);
        let finalLandmark = baseLandmark;

        if (lat !== undefined && lng !== undefined && lat != null && lng != null) {
          if (customer.lat != null && customer.lng != null) {
            const { calculateHaversineDistance } = await import('../../utils/haversine');
            diffFromOriginalKm = calculateHaversineDistance(
              { lat: customer.lat, lng: customer.lng },
              { lat, lng }
            );

            // Admin CS otoritas tertinggi: selalu simpan koordinat primer (hapus limit 1km)
            shouldUpdatePrimaryCoords = true;
            if (diffFromOriginalKm != null && diffFromOriginalKm > 1.0) {
              const gpsTag = `[📍 GPS Lapangan: ${lat.toFixed(6)}, ${lng.toFixed(6)} (+${diffFromOriginalKm.toFixed(1)}km)]`;
              finalLandmark = baseLandmark ? `${baseLandmark} ${gpsTag}` : gpsTag;
            }
          } else {
            shouldUpdatePrimaryCoords = true;
          }
        }

        if (removePhoto) {
          // Hapus kedua file (HD + thumb) dari disk, bukan cuma null-kan DB
          const existingUrl = (customer.preferences as any)?.house_photo_url;
          if (existingUrl) {
            mediaService.deleteFile(existingUrl);
            const match = existingUrl.match(/^\/media\/(outbound|inbound)\/([^/]+)\/([^/]+)$/);
            if (match) {
              const thumbFile = match[3].replace(/(\.\w+)$/, '_thumb$1');
              const thumbUrl = `/media/${match[1]}/${match[2]}/${thumbFile}`;
              mediaService.deleteFile(thumbUrl);
            }
          }
          housePhotoUrl = null;
        } else if (housePhotoB64 && housePhotoB64.startsWith('data:image/')) {
          const rawB64 = housePhotoB64.replace(/^data:image\/[^;]+;base64,/, '');
          const resized = await mediaService.resizeImageToMax(Buffer.from(rawB64, 'base64'), 800);
          const adminName = (request as any).adminSession?.adminIdentity || 'Admin Klinik';
          const watermarked = await mediaService.overlayGpsBadge(resized, {
            lat: targetLat,
            lng: targetLng,
            kelurahan: customer.kelurahan,
            kecamatan: customer.kecamatan,
            landmark: finalLandmark,
            takerName: adminName,
            staffName: adminName,
          });
          const saved = await mediaService.saveOutboundMedia({
            tenantId: DEFAULT_TENANT_ID,
            imageB64: watermarked.toString('base64'),
            mimeType: 'image/jpeg',
            fileName: `house-${customer.id}.jpg`,
          });
          // Hemat storage: hapus file HD, hanya simpan thumbnail (~140 KB)
          if (saved.thumbUrl) {
            mediaService.deleteFile(saved.hdUrl);
            housePhotoUrl = saved.thumbUrl;
          } else {
            housePhotoUrl = saved.hdUrl;
          }
        }

        const currentPrefs = (customer.preferences as any) || {};
        const existingHistory: any[] = Array.isArray(currentPrefs.location_history) ? currentPrefs.location_history : [];
        const newHistoryEntry = (targetLat != null && targetLng != null && distanceKm != null)
          ? {
              source: 'ADMIN_GPS',
              lat: targetLat,
              lng: targetLng,
              staffName: (request as any).adminIdentity || 'Admin CS',
              distanceKm: typeof distanceKm === 'number' ? Number(distanceKm.toFixed(2)) : null,
              ongkir: newOngkir,
              updatedAt: new Date().toISOString(),
            }
          : null;
        const updatedPrefs = {
          ...currentPrefs,
          house_photo_url: housePhotoUrl,
          landmark: finalLandmark,
          ...(diffFromOriginalKm != null && diffFromOriginalKm > 1.0
            ? {
                field_gps_lat: lat,
                field_gps_lng: lng,
                field_gps_diff_km: Number(diffFromOriginalKm.toFixed(2)),
                field_gps_diverged: true,
              }
            : {}),
          location_updated_at: new Date().toISOString(),
          location_updated_by_staff_name: (request as any).adminIdentity || 'Admin CS',
          ...(newHistoryEntry ? { location_history: [...existingHistory.slice(-9), newHistoryEntry] } : {}),
        };

        let updatedCustomer: any = null;
        try {
          updatedCustomer = await prisma.customer.update({
            where: { id: customer.id },
            data: {
              ...(shouldUpdatePrimaryCoords && lat !== undefined ? { lat } : {}),
              ...(shouldUpdatePrimaryCoords && lng !== undefined ? { lng } : {}),
              ...(shouldUpdatePrimaryCoords && distanceKm !== undefined ? { distance_km: distanceKm } : {}),
              ...(shouldUpdatePrimaryCoords && lat !== undefined && lng !== undefined
                ? { location_source: 'manual_staff' as const }
                : {}),
              preferences: updatedPrefs,
            },
          });
        } catch (dbErr: any) {
          // In-memory fallback
          if (shouldUpdatePrimaryCoords) {
            customer.lat = lat !== undefined ? lat : customer.lat;
            customer.lng = lng !== undefined ? lng : customer.lng;
            customer.distance_km = distanceKm;
            if (lat !== undefined && lng !== undefined) customer.location_source = 'manual_staff';
          }
          customer.preferences = updatedPrefs;
          customer.updated_at = new Date();
          const mem = customerService.getMemoryCustomers();
          mem.set(customer.phone, customer);
          updatedCustomer = customer;
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'ADMIN_UPDATE_CUSTOMER_LOCATION',
          targetId: id,
          payload: {
            lat: updatedCustomer.lat,
            lng: updatedCustomer.lng,
            distanceKm: updatedCustomer.distance_km,
            housePhotoUrl,
            landmark,
          },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          data: {
            id: updatedCustomer.id,
            lat: updatedCustomer.lat,
            lng: updatedCustomer.lng,
            distance_km: updatedCustomer.distance_km,
            house_photo_url: housePhotoUrl,
            landmark: updatedPrefs.landmark || null,
            preferences: updatedPrefs,
          },
        });
      } catch (err: any) {
        console.error('[ADMIN CUSTOMER] Error updating location:', err.message);
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );
}
