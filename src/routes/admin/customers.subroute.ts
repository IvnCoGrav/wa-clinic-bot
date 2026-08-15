import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { customerService } from '../../services/customer.service';
import { auditService } from '../../services/audit.service';
import { conversationService } from '../../services/conversation.service';
import { ConversationState } from '@prisma/client';
import { AI_ELIGIBILITY_ESCALATION_REASON } from '../../services/ai-eligibility.service';

export async function customerAdminRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/customers
   * Mengambil daftar customer database lengkap dengan Tracking Code, LTV, MQL Status, dan pagination
   */
  fastify.get(
    '/api/admin/customers',
    async (
      request: FastifyRequest<{
        Querystring: { search?: string; page?: string; pageSize?: string; mqlOnly?: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { search, page, pageSize, mqlOnly } = request.query || {};
        const result = await customerService.listCustomersWithLtvAndAdClick(DEFAULT_TENANT_ID, {
          search,
          page: parseInt(page || '1', 10) || 1,
          pageSize: parseInt(pageSize || '20', 10) || 20,
          mqlOnly: mqlOnly === 'true',
        });
        return reply.status(200).send({ success: true, ...result });
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

        // 2. Mirror ke WAHA (best-effort, tidak pernah throw)
        let wahaOk = true;
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
            const enableHoldLabel = process.env.ENABLE_WAHA_HOLD_LABEL === 'true' || process.env.NODE_ENV !== 'production';
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

        if (removePhoto) {
          housePhotoUrl = null;
        } else if (housePhotoB64 && housePhotoB64.startsWith('data:image/')) {
          const { mediaService } = await import('../../services/media.service');
          const rawB64 = housePhotoB64.replace(/^data:image\/[^;]+;base64,/, '');
          const resized = await mediaService.resizeImageToMax(Buffer.from(rawB64, 'base64'), 800);
          const saved = await mediaService.saveOutboundMedia({
            tenantId: DEFAULT_TENANT_ID,
            imageB64: resized.toString('base64'),
            mimeType: 'image/jpeg',
            fileName: `house-${customer.id}.jpg`,
          });
          housePhotoUrl = saved.hdUrl;
        }

        const currentPrefs = (customer.preferences as any) || {};
        const updatedPrefs = {
          ...currentPrefs,
          house_photo_url: housePhotoUrl,
          ...(landmark !== undefined ? { landmark: landmark?.trim() || null } : {}),
          location_updated_at: new Date().toISOString(),
          location_updated_by_staff_name: (request as any).adminIdentity || 'Admin CS',
        };

        let distanceKm = customer.distance_km;
        const targetLat = lat ?? customer.lat;
        const targetLng = lng ?? customer.lng;

        if (targetLat != null && targetLng != null) {
          const { clinicConfig } = await import('../../config/clinic');
          const { calculateHaversineDistance } = await import('../../utils/haversine');
          const clinicCoords = { lat: clinicConfig.lat, lng: clinicConfig.lng };
          distanceKm = calculateHaversineDistance(clinicCoords, { lat: targetLat, lng: targetLng });
        }

        let updatedCustomer: any = null;
        try {
          updatedCustomer = await prisma.customer.update({
            where: { id: customer.id },
            data: {
              ...(lat !== undefined ? { lat } : {}),
              ...(lng !== undefined ? { lng } : {}),
              ...(distanceKm !== undefined ? { distance_km: distanceKm } : {}),
              preferences: updatedPrefs,
            },
          });
        } catch (dbErr: any) {
          // In-memory fallback
          customer.lat = lat !== undefined ? lat : customer.lat;
          customer.lng = lng !== undefined ? lng : customer.lng;
          customer.distance_km = distanceKm;
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
