import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { customerService } from '../../services/customer.service';
import { auditService } from '../../services/audit.service';
import { conversationService } from '../../services/conversation.service';
import { ConversationState, LocationSource } from '@prisma/client';
import { AI_ELIGIBILITY_ESCALATION_REASON } from '../../services/ai-eligibility.service';
import { responseCacheService } from '../../services/response-cache.service';
import { tenantOf } from './route-helpers';
import { resolveLocationSource } from '../../services/staff-reservation.service';
import { resolveReservationPaymentEvaluation } from '../../services/reservation-core.service';
import { normalizePhoneID } from '../../utils/phone-normalizer';
import { staffOwnershipService } from '../../services/staff-ownership.service';
import { customersExportRoutes } from './customers-export.subroute';
import { customersAddressRoutes } from './customers-address.subroute';
import { customersLocationRoutes } from './customers-location.subroute';

export async function customerAdminRoutes(fastify: FastifyInstance) {
  // Register submodules (API-01: Modular route split)
  await customersExportRoutes(fastify);
  await customersAddressRoutes(fastify);
  await customersLocationRoutes(fastify);

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
        const tenantId = tenantOf(request);
        const { search, page, pageSize, mqlOnly, segment, sortBy, sortOrder } = request.query || {};
        const result = await customerService.listCustomersWithLtvAndAdClick(tenantId, {
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
      const tenantId = tenantOf(request);
      const { id } = request.params;
      try {
        let customer: any = null;
        try {
          customer = await prisma.customer.findFirst({
            where: { id, tenant_id: tenantId },
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
          customer = await customerService.getCustomerById(id, tenantId);
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
              where: { customer_id: customer.id, tenant_id: tenantId },
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
              val = (await resolveTreatmentValue(r.treatment_detail || r.raw_text, tenantId)) ?? null;
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
        const savedAddresses = await customerService.getSavedAddresses(customer.id, tenantId).catch(() => []);
        const ownershipMap = await staffOwnershipService.getByCustomerIds(tenantId, [customer.id]);

        return reply.status(200).send({
          success: true,
          data: {
            ...customer,
            effective_location_source: resolveLocationSource(customer),
            address: customerAddress,
            saved_addresses: savedAddresses,
            children: enrichedChildren,
            reservations: customer.reservations || [],
            labels: customerLabels,
            follow_ups: (customer as any).follow_ups || [],
            ltv: ((customer as any).ltv_cache ?? ltv) as any,
            purchaseCount: purchaseCount as any,
            staffOwnership: ownershipMap.get(customer.id) ?? null,
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
      const tenantId = tenantOf(request);
      const limit = Math.min(1000, Math.max(1, parseInt(request.query?.limit || '200', 10) || 200));
      try {
        const conversations = await prisma.conversation.findMany({
          where: { customer_id: id, tenant_id: tenantId },
          orderBy: { updated_at: 'desc' },
        });

        if (conversations.length === 0) {
          return reply.status(200).send({ success: true, count: 0, data: [] });
        }

        const conversationIds = conversations.map((c) => c.id);
        // Ambil N pesan TERBARU (desc) lalu kembalikan kronologis (asc) agar
        // customer berriwayat panjang tidak kehilangan pesan terbarunya di modal.
        const rawMessages = await prisma.message.findMany({
          where: { conversation_id: { in: conversationIds }, tenant_id: tenantId },
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
   * Definisi kanonis (selaras reservation-core ACTIVE_STATUSES): confirmed|en_route|hold,
   * tanggal >= awal hari ini (WIB). Reservasi tanpa tanggal (null) diabaikan.
   */
  fastify.get(
    '/api/admin/customers/:id/active-reservations',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const tenantId = tenantOf(request);
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
            tenant_id: tenantId,
            status: { in: ['confirmed', 'en_route', 'hold'] },
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
            purchase_value: true,
            discount_amount: true,
            payment_method: true,
            proof_url: true,
            receipt_amount: true,
            delivery_fee: true,
            needs_staff_verification: true,
            raw_text: true,
            otw_sent_at: true,
            arrived_at: true,
            assigned_staff: { select: { id: true, name: true } },
          },
        });

        const data = reservations.map((r) => ({
          ...r,
          paymentEvaluation: resolveReservationPaymentEvaluation(r),
        }));

        return reply
          .header('Cache-Control', 'no-store, no-cache, must-revalidate')
          .status(200)
          .send({ success: true, count: data.length, data });
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
      // Ar-005: jangan 200 + daftar kosong saat DB gagal di produksi
      // (admin bisa menyimpulkan "tidak ada percakapan di-flag" padahal DB mati).
      if (process.env.NODE_ENV === 'production') {
        return reply.status(503).send({
          success: false,
          code: 'DATABASE_UNAVAILABLE',
          error: 'Daftar percakapan yang di-flag tidak dapat dimuat.',
        });
      }
      return reply
        .status(200)
        .send({ success: true, degraded: true, count: 0, data: [], note: 'Fallback in-memory mode' });
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
