import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../db/client';
import { customerService } from '../../../services/customer.service';
import { staffOwnershipService } from '../../../services/staff-ownership.service';
import { resolveLocationSource } from '../../../services/staff-reservation.service';
import { resolveReservationPaymentEvaluation } from '../../../services/reservation-core.service';
import { tenantOf } from '../route-helpers';

export async function registerCustomerListDetailRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/customers
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
            const { memoryCustomerLabels, memoryLabels } = await import('../labels.subroute');
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

        let enrichedChildren = customer.children || [];
        try {
          const { childService } = await import('../../../services/child.service');
          enrichedChildren = await childService.getChildrenWithCurrentAge(customer.id);
        } catch (e) {
          enrichedChildren = customer.children || [];
        }

        let ltv = 0;
        let purchaseCount = 0;
        try {
          const { resolveTreatmentValue } = await import('../../../services/capi.service');
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
   * GET /api/admin/customers/:id/default-ongkir
   */
  fastify.get(
    '/api/admin/customers/:id/default-ongkir',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const tenantId = tenantOf(request);
      try {
        const ongkir = await customerService.getLastDeliveryFee(id, tenantId);
        return reply.status(200).send({ success: true, ongkir });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/customers/:id/messages
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
}
