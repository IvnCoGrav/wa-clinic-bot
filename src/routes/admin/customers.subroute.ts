import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { customerService } from '../../services/customer.service';
import { auditService } from '../../services/audit.service';
import { conversationService } from '../../services/conversation.service';
import { ConversationState } from '@prisma/client';
import { AI_ELIGIBILITY_ESCALATION_REASON } from '../../services/ai-eligibility.service';
import { responseCacheService } from '../../services/response-cache.service';

export async function customerAdminRoutes(fastify: FastifyInstance) {
  // Invalidate cache saat ada create/update/delete customer
  fastify.addHook('onResponse', async (request) => {
    const method = request.method;
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) && request.url.includes('/customers')) {
      responseCacheService.invalidatePrefix('customers:');
    }
  });

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

        let ltv = 0;
        try {
          const { resolveTreatmentValue } = await import('../../services/capi.service');
          for (const r of customer.reservations || []) {
            const val = await resolveTreatmentValue(r.treatment_detail || r.raw_text);
            ltv += val || 0;
          }
        } catch (e) {
          ltv = 0;
        }

        return reply.status(200).send({
          success: true,
          data: {
            ...customer,
            children: customer.children || [],
            reservations: customer.reservations || [],
            labels: customerLabels,
            ltv: customer.ltv ?? ltv,
            purchaseCount: customer.purchaseCount ?? (customer.reservations?.length || 0),
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
        const messages = await prisma.message.findMany({
          where: { conversation_id: { in: conversationIds }, tenant_id: DEFAULT_TENANT_ID },
          orderBy: { created_at: 'asc' },
          take: limit,
        });

        return reply.status(200).send({ success: true, count: messages.length, data: messages });
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
   * Sumber kebenaran = kolom DB (is_admin_labeled / is_hold_labeled); mirror ke
   * WAHA (addLabel/removeLabel) bersifat best-effort agar label tampil di aplikasi WA.
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

        // 2. Mirror ke WAHA (best-effort, hanya jika ENABLE_WAHA_HOLD_LABEL === 'true' / test)
        let wahaOk = true;
        const enableHoldLabel = process.env.ENABLE_WAHA_HOLD_LABEL === 'true' || (process.env.NODE_ENV === 'test' && process.env.ENABLE_WAHA_HOLD_LABEL !== 'false');
        if (enableHoldLabel) {
          try {
            const { wahaClient } = await import('../../integrations/waha/client');
            if (enabled) {
              wahaOk = await wahaClient.addLabel(`${customer.phone}@c.us`, normalizedLabel);
            } else {
              wahaOk = await wahaClient.removeLabel(`${customer.phone}@c.us`, normalizedLabel);
            }
          } catch (err: any) {
            wahaOk = false;
            console.warn(`[LABEL] Gagal mirror label "${normalizedLabel}" ke WAHA utk ${customer.phone}:`, err.message);
          }
        }


        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: enabled ? 'ADD_LABEL' : 'REMOVE_LABEL',
          targetId: id,
          payload: { label, enabled, wahaOk },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: `Label "${label}" ${enabled ? 'dipasang' : 'dilepas'} untuk ${customer.name || customer.phone}.`,
          data: { id, phone: customer.phone, label, enabled, wahaOk },
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
            const enableHoldLabel = process.env.ENABLE_WAHA_HOLD_LABEL === 'true';
            if (enableHoldLabel) {
              try {
                const { wahaClient } = await import('../../integrations/waha/client');
                await wahaClient.removeLabel(`${updated.phone}@c.us`, 'hold');
              } catch (labelErr: any) {
                console.warn('[AI OVERRIDE] Gagal hapus hold label:', labelErr.message);
              }
            }
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
   * PUT /api/admin/customers/:id
   * Update field dasar customer (nama, alamat, koordinat, landmark).
   * Body: { name?, kelurahan?, kecamatan?, kota?, zipcode?, landmark?, lat?, lng? }
   */
  fastify.put(
    '/api/admin/customers/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: {
          name?: string;
          kelurahan?: string | null;
          kecamatan?: string | null;
          kota?: string | null;
          zipcode?: string | null;
          landmark?: string | null;
          lat?: number | null;
          lng?: number | null;
        };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { name, kelurahan, kecamatan, kota, zipcode, landmark, lat, lng } = request.body || {};

      // Validasi minimal ada satu field yang diupdate
      if (
        name === undefined &&
        kelurahan === undefined &&
        kecamatan === undefined &&
        kota === undefined &&
        zipcode === undefined &&
        landmark === undefined &&
        lat === undefined &&
        lng === undefined
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
          { name, kelurahan, kecamatan, kota, zipcode, landmark, lat, lng },
          DEFAULT_TENANT_ID
        );

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_CUSTOMER_PROFILE',
          targetId: id,
          payload: { name, kelurahan, kecamatan, kota, zipcode, landmark, lat, lng },
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

        let housePhotoUrl: string | null = (customer.preferences as any)?.house_photo_url || null;

        let distanceKm = customer.distance_km;
        const targetLat = lat !== undefined ? lat : customer.lat;
        const targetLng = lng !== undefined ? lng : customer.lng;

        if (targetLat != null && targetLng != null) {
          // Validasi range koordinat Indonesia
          if (targetLat < -12 || targetLat > 7 || targetLng < 94 || targetLng > 142) {
            return reply.status(400).send({ success: false, error: 'Koordinat GPS di luar wilayah Indonesia atau tidak valid.' });
          }

          const { clinicConfig } = await import('../../config/clinic');
          const { calculateHaversineDistance } = await import('../../utils/haversine');
          const clinicCoords = { lat: clinicConfig.lat, lng: clinicConfig.lng };
          distanceKm = calculateHaversineDistance(clinicCoords, { lat: targetLat, lng: targetLng });

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

            if (diffFromOriginalKm > 1.0) {
              shouldUpdatePrimaryCoords = false;
              const gpsTag = `[📍 GPS Lapangan: ${lat.toFixed(6)}, ${lng.toFixed(6)} (+${diffFromOriginalKm.toFixed(1)}km)]`;
              finalLandmark = baseLandmark ? `${baseLandmark} ${gpsTag}` : gpsTag;
            } else {
              shouldUpdatePrimaryCoords = true;
            }
          } else {
            shouldUpdatePrimaryCoords = true;
          }
        }

        if (removePhoto) {
          housePhotoUrl = null;
        } else if (housePhotoB64 && housePhotoB64.startsWith('data:image/')) {
          const { mediaService } = await import('../../services/media.service');
          const rawB64 = housePhotoB64.replace(/^data:image\/[^;]+;base64,/, '');
          const resized = await mediaService.resizeImageToMax(Buffer.from(rawB64, 'base64'), 800);
          const watermarked = await mediaService.overlayGpsBadge(resized, {
            lat: targetLat,
            lng: targetLng,
            kelurahan: customer.kelurahan,
            kecamatan: customer.kecamatan,
            landmark: finalLandmark,
          });
          const saved = await mediaService.saveOutboundMedia({
            tenantId: DEFAULT_TENANT_ID,
            imageB64: watermarked.toString('base64'),
            mimeType: 'image/jpeg',
            fileName: `house-${customer.id}.jpg`,
          });
          housePhotoUrl = saved.hdUrl;
        }

        const currentPrefs = (customer.preferences as any) || {};
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
        };

        let updatedCustomer: any = null;
        try {
          updatedCustomer = await prisma.customer.update({
            where: { id: customer.id },
            data: {
              ...(shouldUpdatePrimaryCoords && lat !== undefined ? { lat } : {}),
              ...(shouldUpdatePrimaryCoords && lng !== undefined ? { lng } : {}),
              ...(shouldUpdatePrimaryCoords && distanceKm !== undefined ? { distance_km: distanceKm } : {}),
              preferences: updatedPrefs,
            },
          });
        } catch (dbErr: any) {
          // In-memory fallback
          if (shouldUpdatePrimaryCoords) {
            customer.lat = lat !== undefined ? lat : customer.lat;
            customer.lng = lng !== undefined ? lng : customer.lng;
            customer.distance_km = distanceKm;
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
