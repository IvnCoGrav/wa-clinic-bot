import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../db/client';
import { customerService } from '../../../services/customer.service';
import { auditService } from '../../../services/audit.service';
import { conversationService } from '../../../services/conversation.service';
import { ConversationState } from '@prisma/client';
import { AI_ELIGIBILITY_ESCALATION_REASON } from '../../../services/ai-eligibility.service';
import { tenantOf } from '../route-helpers';

export async function registerCustomerActionsRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/admin/customers/:id/send-event
   * Manual trigger event Meta Pixel / CAPI untuk customer tertentu
   */
  fastify.post(
    '/api/admin/customers/:id/send-event',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { eventName: string; value?: number; currency?: string; eventTime?: number };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const tenantId = tenantOf(request);
      const { eventName, value, currency = 'IDR', eventTime } = request.body || {};

      if (!eventName) {
        return reply.status(400).send({ success: false, error: 'eventName wajib diisi (mis. Lead, Purchase, ViewContent)' });
      }

      try {
        const customer = await prisma.customer.findFirst({
          where: { id, tenant_id: tenantId },
          include: { adClick: true },
        });

        if (!customer) {
          return reply.status(404).send({ success: false, error: 'Customer tidak ditemukan.' });
        }

        const { capiService } = await import('../../../services/capi.service');
        const capiResult = await capiService.sendCapiEvent({
          eventName,
          customer,
          adClick: customer.adClick || {
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'] || 'Admin Manual Event Trigger',
          },
          value,
          currency,
          // Anti-Stempel-Janji: anchor waktu konversi EKSPLISIT — id event tidak lagi
          // mengikat ke Date.now() pengiriman (idempoten saat retry manual).
          ...(typeof eventTime === 'number' ? { eventTime } : {}),
          tenantId,
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
          tenantId,
        });

        return reply.status(200).send({
          success: true,
          message: capiResult.skipped
            ? `Event '${eventName}' tidak dikirim ke Meta CAPI: ${capiResult.message || 'Dikecualikan oleh kebijakan CAC repeat customer'}.`
            : `Event '${eventName}' berhasil dikirim ke Meta CAPI untuk customer ${customer.phone}.`,
          skipped: capiResult.skipped === true,
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
      const tenantId = tenantOf(request);
      const { reason } = request.body || {};
      if (!reason) {
        return reply.status(400).send({ error: 'reason is required' });
      }

      try {
        const customer = await customerService.blockCustomer(id, reason, tenantId);
        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'BLOCK_CUSTOMER',
          targetId: id,
          payload: { reason },
          ipAddress: request.ip,
          tenantId,
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
      const tenantId = tenantOf(request);

      try {
        const customer = await customerService.unblockCustomer(id, tenantId);
        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UNBLOCK_CUSTOMER',
          targetId: id,
          ipAddress: request.ip,
          tenantId,
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

      const tenantId = tenantOf(request);
      try {
        const customer = await customerService.getCustomerById(id, tenantId);
        if (!customer) {
          return reply.status(404).send({ success: false, error: 'Customer tidak ditemukan.' });
        }

        // 1. Kolom DB adalah sumber kebenaran
        await customerService.setLabelFlags(
          customer.phone,
          {
            isAdminLabeled: normalizedLabel === 'admin' ? enabled : undefined,
            isHoldLabeled: normalizedLabel === 'hold' ? enabled : undefined,
          },
          tenantId
        );

        // 2. Mandat Anti-Label WAHA: label toggle hanya via DB internal (customer.labels)
        // Zero WAHA label mutation — is_admin_labeled / is_hold_labeled sudah di-sync oleh reconciliation service

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: enabled ? 'ADD_LABEL' : 'REMOVE_LABEL',
          targetId: id,
          payload: { label, enabled, dbOnly: true },
          ipAddress: request.ip,
          tenantId,
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
      const tenantId = tenantOf(request);
      const flaggedConversations = await prisma.conversation.findMany({
        where: { review_flagged: true, tenant_id: tenantId },
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
      const tenantId = tenantOf(request);
      const { aiOverride } = request.body || {};
      if (aiOverride !== 'FORCE_ON' && aiOverride !== 'FORCE_OFF' && aiOverride !== null) {
        return reply.status(400).send({ error: 'aiOverride harus FORCE_ON, FORCE_OFF, atau null.' });
      }

      try {
        const updated = await customerService.setAiOverride(id, tenantId, aiOverride);

        if (aiOverride === 'FORCE_ON') {
          const silenced = await prisma.conversation.findFirst({
            where: {
              customer_id: id,
              tenant_id: tenantId,
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
              tenantId
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
          tenantId,
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
   * PATCH /api/admin/customers/:id/notes
   * Simpan "Sticky Memory Note" (catatan karakter pasien) untuk koordinasi antar-shift.
   * Bebas-teks, bukan data medis terstruktur. Menyimpan jejak editor terakhir.
   */
  fastify.patch(
    '/api/admin/customers/:id/notes',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { notes?: string | null };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { notes } = request.body || {};
      const tenantId = tenantOf(request);

      if (notes !== undefined && notes !== null && typeof notes !== 'string') {
        return reply.status(400).send({ success: false, error: 'notes harus berupa string atau null.' });
      }
      const cleanNotes = typeof notes === 'string' ? notes.trim() : '';
      if (cleanNotes.length > 2000) {
        return reply.status(400).send({ success: false, error: 'Catatan maksimal 2000 karakter.' });
      }

      const performedBy = (request as any).adminIdentity || (request as any).adminSession?.adminIdentity || 'Admin';

      try {
        const customer = await customerService.getCustomerById(id, tenantId);
        if (!customer) {
          return reply.status(404).send({ success: false, error: 'Customer tidak ditemukan.' });
        }

        const updated = await prisma.customer.update({
          where: { id: customer.id },
          data: {
            admin_notes: cleanNotes || null,
            notes_updated_at: new Date(),
            notes_updated_by: performedBy,
          },
          select: { id: true, admin_notes: true, notes_updated_at: true, notes_updated_by: true },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: performedBy,
          action: 'UPDATE_CUSTOMER_NOTES',
          targetId: id,
          payload: { length: cleanNotes.length },
          ipAddress: request.ip,
          tenantId,
        });

        return reply.status(200).send({
          success: true,
          message: 'Catatan pasien berhasil disimpan.',
          data: {
            adminNotes: updated.admin_notes,
            notesUpdatedAt: updated.notes_updated_at,
            notesUpdatedBy: updated.notes_updated_by,
          },
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
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

    const tenantId = tenantOf(request);
    try {
      const customer = await customerService.getCustomerById(id, tenantId);

      if (!customer) {
        return reply.status(404).send({ success: false, error: 'Customer tidak ditemukan.' });
      }

      const updatedCustomer = await customerService.updateCustomer(
        id,
        { name, phone, address, kelurahan, kecamatan, kota, zipcode, landmark, lat, lng, children },
        tenantId
      );

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'UPDATE_CUSTOMER_PROFILE',
        targetId: id,
        payload: { name, phone, address, kelurahan, kecamatan, kota, zipcode, landmark, lat, lng, childrenCount: children?.length },
        ipAddress: request.ip,
        tenantId,
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
}
