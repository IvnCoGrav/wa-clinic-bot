import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { tenantOf } from './route-helpers';
import { auditService } from '../../services/audit.service';
import { customerService } from '../../services/customer.service';
import {
  capiService,
  resolveTreatmentValue,
  extractValueByFormat,
  getTenantCapiFormats,
  resolveCanonicalLandingUrl,
} from '../../services/capi.service';
import { CAPI_QUEUE_EXCLUDED_RESERVATION_STATUSES } from '../../services/capi-review-status';
import { extractRupiahAmount } from '../../services/purchase-detection.service';
import { parseReservationText } from '../../utils/reservation-text-parser';
import { parsePaymentSection } from '../../utils/conversation-transaction-extractor';
import { resolveZipcode } from '../../utils/gazetteer-zipcode-resolver';
import { memoryReservations, filterMemoryByTenant } from './stores';
import { shouldExcludeFromCapiQueue } from '../../utils/dummy-filter';

export async function reservationDispatchPaymentProofRoutes(fastify: FastifyInstance) {
  /**
   * PUT /api/admin/reservation/:id/proof
   */
  fastify.put(
    '/api/admin/reservation/:id/proof',
    { bodyLimit: 12 * 1024 * 1024 },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { imageB64?: string; mimeType?: string; fileName?: string; remove?: boolean };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = tenantOf(request);
      const { id } = request.params;
      const { imageB64, mimeType, fileName, remove } = request.body || {};

      try {
        const existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: tenantId },
        });
        if (!existing) {
          throw new Error('Reservation not found');
        }

        let proofUrl: string | null = null;
        if (!remove && imageB64) {
          const { mediaService } = await import('../../services/media.service');
          const rawB64 = imageB64.replace(/^data:image\/[^;]+;base64,/, '');
          const resized = await mediaService.resizeImageToMax(Buffer.from(rawB64, 'base64'), 800);
          const saved = await mediaService.saveOutboundMedia({
            tenantId: tenantId,
            imageB64: resized.toString('base64'),
            mimeType: mimeType && mimeType !== 'application/octet-stream' ? mimeType : 'image/jpeg',
            fileName: fileName || `proof-${id}.jpg`,
          });
          proofUrl = saved.hdUrl;
        }

        const updated = await prisma.reservation.update({
          where: { id },
          data: { proof_url: proofUrl },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: remove ? 'ADMIN_REMOVE_PROOF' : 'ADMIN_UPLOAD_PROOF',
          targetId: id,
          payload: remove ? { removed: true } : { proofUrl },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, data: updated });
      } catch (error) {
        const mock = memoryReservations.get(id);
        if (mock && mock.tenant_id === tenantId) {
          mock.proof_url = remove ? null : mock.proof_url;
          mock.updated_at = new Date();
          memoryReservations.set(id, mock);
          return reply.status(200).send({ success: true, data: mock, note: 'Fallback in-memory mode' });
        }
        return reply.status(404).send({ success: false, error: 'Reservation not found' });
      }
    }
  );

  /**
   * POST /api/admin/reservation/:id/approve-purchase
   */
  fastify.post(
    '/api/admin/reservation/:id/approve-purchase',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      const { id } = request.params;
      let capiSkipped = false;
      try {
        if (id.startsWith('lead_')) {
          const customerId = id.replace('lead_', '');
          const customer = await prisma.customer.findFirst({
            where: { id: customerId, tenant_id: tenantId },
            include: { adClick: true },
          });
          if (!customer) {
            return reply.status(404).send({ success: false, error: 'Customer not found' });
          }
          const occurredDate = customer.mql_triggered_at || customer.created_at || new Date();
          const occurredAt = new Date(occurredDate);

          const leadCapiResult = await capiService.sendCapiEvent({
            eventName: 'Lead',
            customer,
            adClick: customer.adClick || undefined,
            tenantId: tenantId,
            eventTime: Math.floor(occurredAt.getTime() / 1000),
            customData: {
              source: 'ADMIN_MODERATION_APPROVE_LEAD',
              mql_bubble_count: customer.mql_bubble_count || 5,
            },
          });

          if (!leadCapiResult.success) {
            console.error(`[CAPI ERROR] Approved Lead send failed for ${id}: ${leadCapiResult.message}`);
            return reply.status(502).send({
              success: false,
              error: `Meta CAPI menolak Lead event: ${leadCapiResult.message || 'unknown error'}`,
              metaResponse: leadCapiResult.metaResponse,
            });
          }

          await auditService.logAdminAction({
            apiKey: (request as any).adminKeyUsed,
            adminIdentity: (request as any).adminIdentity,
            action: 'MQL_LEAD_EVENT_SENT',
            targetId: customerId,
            payload: { mql_triggered_at: occurredAt.toISOString() },
            ipAddress: request.ip,
          });

          return reply.status(200).send({ success: true, message: 'Lead event disetujui & dikirim ke Meta CAPI' });
        }

        const existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: tenantId },
          include: {
            customer: {
              include: { adClick: true },
            },
          },
        });
        if (!existing) {
          throw new Error('Reservation not found');
        }

        const forceResend = (request.body as any)?.force === true;
        const forceReason = typeof (request.body as any)?.reason === 'string' ? (request.body as any).reason.trim() : '';
        const allowAged = (request.body as any)?.allowAged === true;

        if (existing.purchase_event_sent_at != null && !forceResend) {
          return reply.status(400).send({
            success: false,
            error: `Event Purchase untuk reservasi ini sudah pernah terkirim ke Meta CAPI pada ${existing.purchase_event_sent_at.toISOString()}. Gunakan force: true beserta alasan (reason) untuk mengirim ulang.`,
          });
        }

        if (existing.purchase_review_status !== 'pending' && !forceResend) {
          return reply.status(400).send({
            success: false,
            error: `Purchase event sudah diproses (status: ${existing.purchase_review_status}). Gunakan force: true beserta alasan (reason) untuk mengirim ulang.`,
          });
        }

        if (forceResend && forceReason.length < 5) {
          return reply.status(400).send({
            success: false,
            error: `Pengiriman ulang (force: true) wajib menyertakan alasan minimal 5 karakter pada field reason.`,
          });
        }

        const occurredDate = existing.purchase_occurred_at || existing.created_at || new Date();
        const occurredAt = new Date(occurredDate);
        const daysOld = Math.floor((Date.now() - occurredAt.getTime()) / (24 * 60 * 60 * 1000));
        let warning: string | undefined;
        if (daysOld > 7 && !allowAged) {
          return reply.status(400).send({
            success: false,
            error: `Event terjadi ${daysOld} hari lalu (>7 hari). Meta CAPI menolak event berumur lebih dari 7 hari karena akan merusak akurasi atribusi. Gunakan allowAged: true jika Anda yakin ingin tetap mengirimkannya.`,
          });
        }
        if (daysOld > 7) {
          warning = `Event terjadi ${daysOld} hari lalu (>7 hari) dan dikirim dengan allowAged: true. Meta CAPI kemungkinan akan mengabaikan event ini.`;
        }

        const body = (request.body || {}) as { customPayload?: any; reason?: string; force?: boolean; allowAged?: boolean };
        const customPayload = body.customPayload;

        const formats = await getTenantCapiFormats(tenantId);
        let autoResolvedVal = existing.purchase_value && existing.purchase_value > 0 ? existing.purchase_value : undefined;
        if (!autoResolvedVal) {
          const raw = existing.raw_text || '';
          if (raw && /payment|pembayaran|total\s*[:=]|treatment\s*[:=]/i.test(raw)) {
            try {
              const fin = parsePaymentSection(raw);
              if (fin.treatmentPrice > 0) autoResolvedVal = fin.treatmentPrice;
              else if (fin.totalPrice > 0) autoResolvedVal = Math.max(0, fin.totalPrice - fin.ongkir + fin.promo);
            } catch {}
          }
          if (!autoResolvedVal) {
            autoResolvedVal =
              extractValueByFormat(raw, formats.formatValue) ??
              extractRupiahAmount(raw, formats.formatValue) ??
              (await resolveTreatmentValue(existing.treatment_detail || raw, tenantId));
          }
        }

        const customValueProvided = typeof customPayload?.custom_data?.value === 'number';
        const resolvedVal = customValueProvided
          ? customPayload.custom_data.value
          : autoResolvedVal;

        if (resolvedVal == null || resolvedVal <= 0) {
          return reply.status(400).send({
            success: false,
            error: `Nilai transaksi tidak terdeteksi dari data reservasi (nilai: ${resolvedVal ?? 'null'}). Harap tentukan nilai transaksi secara manual melalui form edit atau customPayload.custom_data.value.`,
          });
        }

        const eventName = (customPayload && typeof customPayload.event_name === 'string')
          ? customPayload.event_name
          : 'Purchase';

        const eventTime = (customPayload && typeof customPayload.event_time === 'number')
          ? customPayload.event_time
          : Math.floor(occurredAt.getTime() / 1000);

        const customData = customPayload?.custom_data
          ? {
              ...customPayload.custom_data,
              source: 'ADMIN_MODERATION_APPROVE_CUSTOM',
              reservationId: existing.id,
              purchaseOccurredAt: occurredAt.toISOString(),
            }
          : {
              source: 'ADMIN_MODERATION_APPROVE',
              reservationId: existing.id,
              purchaseOccurredAt: occurredAt.toISOString(),
            };

        const { isGenericCustomerName } = await import('../../utils/name-sanitizer');
        const isCurrentGeneric = !existing.customer?.name || isGenericCustomerName(existing.customer.name);
        if (isCurrentGeneric && existing.raw_text && existing.customer) {
          try {
            const pr = parseReservationText(existing.raw_text);
            if (pr.success && pr.reservation?.name && !isGenericCustomerName(pr.reservation.name)) {
              const isMale = /^(?:ayah|pak|bapak|mas)\s+/i.test(pr.reservation.name);
              const cleanName = pr.reservation.name.replace(/^(?:ayah|pak|bapak|bunda|ibu|mama|mom|mbak|mas|kak|kakak|ny|ny\.)\s+/i, '').trim();
              if (cleanName && !['bunda', 'ibu', 'mama', 'mom', 'mbak', 'mas', 'kak', 'kakak', 'pasien', 'customer', '-'].includes(cleanName.toLowerCase())) {
                const formattedName = isMale ? `Ayah ${cleanName}`.trim() : `Bunda ${cleanName}`.trim();
                const { customerService } = await import('../../services/customer.service');
                await customerService.updateCustomerName(existing.customer.id, formattedName, tenantId, { source: 'reservation' }).catch(() => {});
                existing.customer.name = formattedName;
              }
            }
          } catch {}
        }

        const { buildLegacyPurchaseEventId } = await import('../../services/capi.service');
        const legacyEventIdForResend = existing.purchase_event_sent_at != null && !customPayload?.event_id
          ? buildLegacyPurchaseEventId({
              trackingCode: (existing.customer as any)?.adClick?.trackingCode,
              reservationId: existing.id,
              customerId: existing.customer_id,
              eventTimeSec: Math.floor(occurredAt.getTime() / 1000),
            })
          : undefined;

        const capiResult = await capiService.sendCapiEvent({
          eventName,
          customer: existing.customer,
          adClick: existing.customer?.adClick || undefined,
          value: resolvedVal,
          currency: customPayload?.custom_data?.currency || 'IDR',
          tenantId: tenantId,
          eventTime,
          customData,
          customUserData: customPayload?.user_data,
          customEventId: customPayload?.event_id ?? legacyEventIdForResend,
          reservationId: existing.id,
        });
        capiSkipped = capiResult.skipped === true;

        if (!capiResult.success) {
          console.error(`[CAPI ERROR] Approved Purchase send failed for ${id}: ${capiResult.message}`);
          return reply.status(502).send({
            success: false,
            error: `Meta CAPI menolak event: ${capiResult.message || 'unknown error'}`,
            metaResponse: capiResult.metaResponse,
          });
        }

        const reservation = await prisma.reservation.update({
          where: { id },
          data: {
            ...(existing.purchase_occurred_at ? { purchase_occurred_at: occurredDate } : {}),
            purchase_value: resolvedVal ?? undefined,
            purchase_review_status: 'approved',
            ...(capiResult.skipped !== true ? { purchase_event_sent_at: new Date() } : {}),
          },
        });

        if (existing.purchase_occurred_at) {
          await customerService.recalculateCustomerLtv(existing.customer_id, existing.tenant_id || tenantId).catch(() => {});
        }

        try {
          await prisma.followUp.updateMany({
            where: {
              customer_id: existing.customer_id,
              tenant_id: existing.tenant_id || tenantId,
              status: { in: ['PENDING', 'QUEUED'] },
              type: 'NO_PURCHASE',
            },
            data: {
              status: 'CANCELLED',
              cancel_reason: 'Transaksi pembelian disetujui (Purchase Approved)',
            },
          });
        } catch (fuErr: any) {
          console.warn('[CAPI APPROVE] Failed to cancel pending follow-ups:', fuErr.message);
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'APPROVE_PURCHASE_EVENT',
          targetId: id,
          payload: {
            purchase_occurred_at: occurredAt.toISOString(),
            value: resolvedVal,
            force: forceResend || undefined,
            forceReason: forceResend ? forceReason : undefined,
            allowAged: allowAged || undefined,
            capi_suppressed: capiResult.skipped === true,
            capi_policy: capiResult.policy || undefined,
          },
          ipAddress: request.ip,
        });

        const isSkipped = capiResult.skipped === true;
        return reply.status(200).send({
          success: true,
          data: reservation,
          warning,
          skipped: isSkipped,
          note: isSkipped
            ? 'Pembelian disetujui internal; event CAPI repeat purchase tidak dikirim ke Meta untuk menjaga akurasi CAC iklan.'
            : undefined,
        });
      } catch (error) {
        console.error('[CAPI APPROVE ERROR]', (error as Error).message);
        if (process.env.NODE_ENV !== 'production') {
          const mock = memoryReservations.get(id);
          if (mock && mock.tenant_id === tenantId) {
            mock.purchase_review_status = 'approved';
            mock.purchase_event_sent_at = capiSkipped ? null : new Date();
            mock.updated_at = new Date();
            memoryReservations.set(id, mock);
            return reply.status(200).send({ success: true, data: mock, note: 'Fallback in-memory mode' });
          }
        }
        const msg = (error as Error).message || 'Reservation not found';
        const status = msg.includes('not found') || msg.includes('Not found') ? 404 : 500;
        return reply.status(status).send({ success: false, error: msg });
      }
    }
  );

  /**
   * POST /api/admin/reservation/:id/reject-purchase
   */
  fastify.post(
    '/api/admin/reservation/:id/reject-purchase',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      const { id } = request.params;
      try {
        if (id.startsWith('lead_')) {
          const customerId = id.replace('lead_', '');
          await auditService.logAdminAction({
            apiKey: (request as any).adminKeyUsed,
            adminIdentity: (request as any).adminIdentity,
            action: 'MQL_LEAD_EVENT_REJECTED',
            targetId: customerId,
            payload: { reason: 'ADMIN_MANUAL_OUTLIER_REJECT' },
            ipAddress: request.ip,
          });
          return reply.status(200).send({ success: true, message: 'Lead event diabaikan' });
        }

        const existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: tenantId },
          include: {
            customer: {
              include: { adClick: true },
            },
          },
        });
        if (!existing) {
          throw new Error('Reservation not found');
        }
        if (existing.purchase_review_status !== 'pending') {
          return reply.status(400).send({
            success: false,
            error: `Purchase event sudah diproses (status: ${existing.purchase_review_status}).`,
          });
        }

        const reservation = await prisma.reservation.update({
          where: { id },
          data: { purchase_review_status: 'ignored_outlier' },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'REJECT_PURCHASE_OUTLIER',
          targetId: id,
          payload: { reason: 'ADMIN_MANUAL_OUTLIER_REJECT' },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, data: reservation });
      } catch (error) {
        console.error('[CAPI REJECT ERROR]', (error as Error).message);
        if (process.env.NODE_ENV !== 'production') {
          const mock = memoryReservations.get(id);
          if (mock && mock.tenant_id === tenantId) {
            mock.purchase_review_status = 'ignored_outlier';
            mock.updated_at = new Date();
            memoryReservations.set(id, mock);
            return reply.status(200).send({ success: true, data: mock, note: 'Fallback in-memory mode' });
          }
        }
        const msg = (error as Error).message || 'Reservation not found';
        const status = msg.includes('not found') || msg.includes('Not found') ? 404 : 500;
        return reply.status(status).send({ success: false, error: msg });
      }
    }
  );

  /**
   * POST /api/admin/reservation/:id/unreject-purchase
   */
  fastify.post(
    '/api/admin/reservation/:id/unreject-purchase',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      const { id } = request.params;
      try {
        const existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: tenantId },
        });
        if (!existing) {
          throw new Error('Reservation not found');
        }
        if (existing.purchase_review_status !== 'ignored_outlier') {
          return reply.status(400).send({
            success: false,
            error: `Reservasi bukan berstatus outlier (status saat ini: ${existing.purchase_review_status}).`,
          });
        }

        const reservation = await prisma.reservation.update({
          where: { id },
          data: { purchase_review_status: 'pending' },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UNREJECT_PURCHASE_OUTLIER',
          targetId: id,
          payload: { previous_status: 'ignored_outlier', new_status: 'pending' },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          data: reservation,
          message: 'Status moderasi berhasil dikembalikan ke pending',
        });
      } catch (error) {
        console.error('[CAPI UNREJECT ERROR]', (error as Error).message);
        if (process.env.NODE_ENV !== 'production') {
          const mock = memoryReservations.get(id);
          if (mock && mock.tenant_id === tenantId) {
            mock.purchase_review_status = 'pending';
            mock.updated_at = new Date();
            memoryReservations.set(id, mock);
            return reply.status(200).send({
              success: true,
              data: mock,
              message: 'Status moderasi berhasil dikembalikan ke pending (fallback memory)',
            });
          }
        }
        const msg = (error as Error).message || 'Reservation not found';
        const status = msg.includes('not found') || msg.includes('Not found') ? 404 : 500;
        return reply.status(status).send({ success: false, error: msg });
      }
    }
  );

  /**
   * GET /api/admin/capi-queue
   */
  fastify.get('/api/admin/capi-queue', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = tenantOf(request);
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    reply.header('Pragma', 'no-cache');
    try {
      const query = (request.query || {}) as { status?: string; limit?: string };
      const statusFilter = query.status?.trim();
      const limitParam = parseInt(query.limit || '200', 10);
      const limit = Math.min(500, Math.max(10, Number.isFinite(limitParam) ? limitParam : 200));

      const whereClause: any = {
        tenant_id: tenantId,
        status: { notIn: [...CAPI_QUEUE_EXCLUDED_RESERVATION_STATUSES] },
        customer: { is_sandbox_test: false },
        OR: [
          { purchase_review_status: 'approved' },
          { purchase_review_status: 'pending', booking_date: { not: null } },
          { purchase_occurred_at: { not: null } },
          { status: 'completed' },
        ],
      };

      if (statusFilter && statusFilter !== 'all') {
        if (statusFilter === 'pending') {
          whereClause.purchase_review_status = { in: ['pending'] };
        } else {
          whereClause.purchase_review_status = statusFilter;
        }
      }

      const rows = await prisma.reservation.findMany({
        where: whereClause,
        orderBy: { created_at: 'desc' },
        take: limit,
        include: {
          customer: {
            include: { adClick: true, children: true },
          },
        },
      });

      const visibleRows = rows.filter(
        (r: (typeof rows)[number]) => !shouldExcludeFromCapiQueue(r.customer?.phone, r.customer?.name, (r.customer as any)?.is_sandbox_test)
      );

      const formats = await getTenantCapiFormats(tenantId);
      const { getTenantMetaPurchasePolicy } = await import('../../services/capi.service');
      const tenantMetaPolicy = await getTenantMetaPurchasePolicy(tenantId);
      const now = Date.now();

      let tenantLandingDomain = '';
      let wabaConfigured = false;
      try {
        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { id: true, landing_domain: true, waba_business_account_id: true },
        });
        if ((tenant as any)?.landing_domain) {
          tenantLandingDomain = (tenant as any).landing_domain.trim();
        }
        wabaConfigured = Boolean((tenant as any)?.waba_business_account_id);
      } catch {}

      const treatmentPriceCache = new Map<string, number | undefined>();
      const getCachedTreatmentValue = async (detail: string): Promise<number | undefined> => {
        if (treatmentPriceCache.has(detail)) return treatmentPriceCache.get(detail);
        const v = await resolveTreatmentValue(detail, tenantId);
        treatmentPriceCache.set(detail, v);
        return v;
      };

      const customerIds = Array.from(new Set(visibleRows.map((r) => r.customer_id).filter(Boolean)));
      const orderNumberByReservation = new Map<string, number>();
      const totalConfirmedByCustomer = new Map<string, number>();
      if (customerIds.length > 0) {
        try {
          const confirmedRows = await prisma.reservation.findMany({
            where: {
              tenant_id: tenantId,
              customer_id: { in: customerIds },
              status: { in: ['confirmed', 'en_route', 'completed'] },
            },
            select: { id: true, customer_id: true, created_at: true },
            orderBy: [{ customer_id: 'asc' }, { created_at: 'asc' }],
          });
          for (const row of confirmedRows as any[]) {
            const next = (totalConfirmedByCustomer.get(row.customer_id) ?? 0) + 1;
            totalConfirmedByCustomer.set(row.customer_id, next);
            orderNumberByReservation.set(row.id, next);
          }
        } catch {}
      }

      const reservationData = await Promise.all(
        visibleRows.map(async (r) => {
          const occurredDate = r.purchase_occurred_at || r.created_at || new Date();
          const occurredAt = new Date(occurredDate).getTime();
          const ageMs = Math.max(0, now - occurredAt);
          const ageHours = Math.floor(ageMs / (60 * 60 * 1000));
          const daysOld = Math.floor(ageMs / (24 * 60 * 60 * 1000));
          const orderNumber = orderNumberByReservation.get(r.id) ?? 1;
          const isRepeatOrder = orderNumber > 1;

          let sanitizedTreatmentDetail = r.treatment_detail || '';
          if (
            sanitizedTreatmentDetail.includes('Mohon bisa diisi') ||
            sanitizedTreatmentDetail.includes('bisa diisi Bunda') ||
            sanitizedTreatmentDetail.toLowerCase().includes('jika hamil') ||
            sanitizedTreatmentDetail.toLowerCase().includes('jika ada')
          ) {
            const parts = sanitizedTreatmentDetail.split('|').map(p => p.trim());
            const filtered = parts.filter(p => {
              const low = p.toLowerCase();
              return (
                !low.includes('mohon bisa diisi') &&
                !low.includes('bisa diisi bunda') &&
                !low.includes('jika hamil') &&
                !low.includes('jika ada')
              );
            });
            sanitizedTreatmentDetail = filtered.length > 0 ? filtered.join(' | ') : 'Treatment Homecare';
          }

          let calculatedValue = r.purchase_value && r.purchase_value > 0 ? r.purchase_value : undefined;
          if (!calculatedValue) {
            const raw = r.raw_text || '';
            if (raw && /payment|pembayaran|total\s*[:=]|treatment\s*[:=]/i.test(raw)) {
              try {
                const fin = parsePaymentSection(raw);
                if (fin.treatmentPrice > 0) calculatedValue = fin.treatmentPrice;
                else if (fin.totalPrice > 0) calculatedValue = Math.max(0, fin.totalPrice - fin.ongkir + fin.promo);
              } catch {}
            }
            if (!calculatedValue) {
              calculatedValue =
                extractValueByFormat(raw, formats.formatValue) ??
                extractRupiahAmount(raw, formats.formatValue) ??
                (await getCachedTreatmentValue(sanitizedTreatmentDetail || raw));
            }
          }

          const value = calculatedValue ?? 0;

          let distanceKm = r.customer?.distance_km ? `${r.customer.distance_km} km` : null;
          if (!distanceKm && r.raw_text) {
            const m = r.raw_text.match(/ongkir\s*([\d.,]+)\s*km/i);
            if (m && m[1]) distanceKm = `${m[1]} km`;
          }

          const rawLandingUrl = r.customer?.adClick?.landingUrl || null;
          const canonicalLandingUrl = resolveCanonicalLandingUrl(rawLandingUrl, tenantLandingDomain) || rawLandingUrl;
          const childName = (r.customer as any)?.children?.[0]?.name || null;

          const customerKota =
            r.customer?.kota || (r.customer as any)?.pending_kota || null;
          const customerKecamatan =
            r.customer?.kecamatan || (r.customer as any)?.pending_kecamatan || null;
          let customerZipcode =
            r.customer?.zipcode || (r.customer as any)?.pending_zipcode || null;
          if (!customerZipcode) {
            let previewKecamatan = customerKecamatan;
            let previewKota = customerKota;
            const previewKelurahan =
              r.customer?.kelurahan || (r.customer as any)?.pending_kelurahan || null;
            if ((!previewKecamatan || !previewKota) && r.raw_text) {
              try {
                const parsedPreview = parseReservationText(r.raw_text);
                if (parsedPreview.success && parsedPreview.reservation) {
                  previewKecamatan = previewKecamatan || parsedPreview.reservation.kec || null;
                  previewKota = previewKota || parsedPreview.reservation.kota || null;
                }
              } catch {}
            }
            try {
              customerZipcode = resolveZipcode({
                kelurahan: previewKelurahan || undefined,
                kecamatan: previewKecamatan || undefined,
                kota: previewKota || undefined,
                text: [r.customer?.name, r.raw_text].filter(Boolean).join(' '),
              }) || null;
            } catch {
              customerZipcode = null;
            }
          }

          return {
            id: r.id,
            status: r.status,
            eventType: 'Purchase',
            treatment_detail: sanitizedTreatmentDetail,
            raw_text: r.raw_text,
            child_name: childName,
            purchase_occurred_at: r.purchase_occurred_at || r.created_at,
            purchase_event_sent_at: r.purchase_event_sent_at,
            purchase_review_status: r.purchase_review_status || 'pending',
            value: value ?? 0,
            is_repeat_order: isRepeatOrder,
            order_number: orderNumber,
            customer_type: isRepeatOrder ? 'repeat' : 'new',
            capi_policy: tenantMetaPolicy,
            will_suppress_capi:
              isRepeatOrder &&
              tenantMetaPolicy === 'SUPPRESS_REPEAT' &&
              (r.purchase_review_status === 'pending' || !r.purchase_event_sent_at),
            distanceKm,
            customer: {
              id: r.customer?.id,
              name: r.customer?.name || 'Bunda',
              phone: r.customer?.phone || '',
              kota: customerKota,
              kecamatan: customerKecamatan,
              zipcode: customerZipcode,
            },
            attribution: {
              isPaid: !!r.customer?.adClick,
              ctwa_clid: r.customer?.adClick?.ctwa_clid || null,
              trackingCode: r.customer?.adClick?.trackingCode || null,
              landingUrl: canonicalLandingUrl,
              fbp: r.customer?.adClick?.fbp || null,
              fbc: r.customer?.adClick?.fbc || null,
              fbclid: r.customer?.adClick?.fbclid || null,
              ipAddress: r.customer?.adClick?.ipAddress || null,
              userAgent: r.customer?.adClick?.userAgent || null,
            },
            utm: {
              campaign: r.customer?.adClick?.utmCampaign || null,
              source: r.customer?.adClick?.utmSource || null,
              medium: r.customer?.adClick?.utmMedium || null,
            },
            ageHours,
            daysOld,
            expiresInDays: Math.max(0, 7 - daysOld),
            metaDropRisk: daysOld > 7,
          };
        })
      );

      let mqlLeadItems: any[] = [];
      try {
        const leadAuditLogs = await prisma.auditLog.findMany({
          where: {
            tenant_id: tenantId,
            action: { in: ['MQL_LEAD_EVENT_SENT', 'MQL_LEAD_EVENT_REJECTED'] },
          },
          select: { target_id: true, action: true, created_at: true },
          orderBy: { created_at: 'desc' },
        });
        const sentMap = new Map<string, string>();
        for (const a of leadAuditLogs) {
          if (a.target_id && !sentMap.has(a.target_id)) {
            sentMap.set(a.target_id, a.action);
          }
        }
        const processedCustomerIds: string[] = Array.from(sentMap.keys());

        const unsentMqlCustomers = await prisma.customer.findMany({
          where: {
            tenant_id: tenantId,
            is_sandbox_test: false,
            phone: { not: { startsWith: '6289999' } },
            OR: [
              { is_mql: true },
              { mql_bubble_count: { gte: 5 } },
            ],
            id: { notIn: processedCustomerIds },
            reservations: {
              none: {
                tenant_id: tenantId,
                status: { in: ['confirmed', 'en_route', 'completed'] },
              },
            },
          },
          include: {
            adClick: true,
          },
          orderBy: { created_at: 'desc' },
          take: 20,
        });

        mqlLeadItems = unsentMqlCustomers.map((c: any) => {
          const occurredDate = c.mql_triggered_at || c.created_at || new Date();
          const occurredAt = new Date(occurredDate).getTime();
          const ageMs = Math.max(0, now - occurredAt);
          const ageHours = Math.floor(ageMs / (60 * 60 * 1000));
          const daysOld = Math.floor(ageMs / (24 * 60 * 60 * 1000));

          const rawLandingUrl = c.adClick?.landingUrl || null;
          const canonicalLandingUrl = resolveCanonicalLandingUrl(rawLandingUrl, tenantLandingDomain) || rawLandingUrl;

          return {
            id: `lead_${c.id}`,
            status: 'mql_lead',
            eventType: 'Lead',
            treatment_detail: 'Lead Prospek MQL (Percakapan Aktif)',
            raw_text: `Customer teridentifikasi MQL (${c.mql_bubble_count || 5}+ pesan)`,
            purchase_occurred_at: occurredDate,
            purchase_event_sent_at: null,
            purchase_review_status: 'pending',
            value: 0,
            distanceKm: c.distance_km ? `${c.distance_km} km` : null,
            customer: {
              name: c.name || 'Bunda',
              phone: c.phone || '',
            },
            attribution: {
              isPaid: !!c.adClick,
              ctwa_clid: c.adClick?.ctwa_clid || null,
              trackingCode: c.adClick?.trackingCode || null,
              landingUrl: canonicalLandingUrl,
            },
            utm: {
              campaign: c.adClick?.utmCampaign || null,
              source: c.adClick?.utmSource || null,
              medium: c.adClick?.utmMedium || null,
            },
            ageHours,
            daysOld,
            expiresInDays: Math.max(0, 7 - daysOld),
            metaDropRisk: daysOld > 7,
          };
        });

        if (processedCustomerIds.length > 0) {
          try {
            const processedCustomers = await prisma.customer.findMany({
              where: {
                tenant_id: tenantId,
                id: { in: processedCustomerIds.slice(0, 50) },
                reservations: {
                  none: {
                    tenant_id: tenantId,
                    status: { in: ['confirmed', 'en_route', 'completed'] },
                  },
                },
              },
              include: { adClick: true },
            });
            for (const c of processedCustomers as any[]) {
              if (shouldExcludeFromCapiQueue((c as any).phone, (c as any).name, (c as any).is_sandbox_test)) continue;
              const action = sentMap.get(c.id);
              const isSent = action === 'MQL_LEAD_EVENT_SENT';
              const occurredDate = c.mql_triggered_at || c.created_at || new Date();
              const occurredAt = new Date(occurredDate).getTime();
              const ageMs = Math.max(0, now - occurredAt);
              const rawLandingUrl = (c as any).adClick?.landingUrl || null;
              const canonicalLandingUrl = resolveCanonicalLandingUrl(rawLandingUrl, tenantLandingDomain) || rawLandingUrl;
              mqlLeadItems.push({
                id: `lead_${c.id}`,
                status: 'mql_lead',
                eventType: 'Lead',
                treatment_detail: 'Lead Prospek MQL (Percakapan Aktif)',
                raw_text: `Customer teridentifikasi MQL (${(c as any).mql_bubble_count || 5}+ pesan)`,
                purchase_occurred_at: occurredDate,
                purchase_event_sent_at: isSent ? occurredDate : null,
                purchase_review_status: isSent ? 'approved' : 'ignored_outlier',
                value: 0,
                distanceKm: (c as any).distance_km ? `${(c as any).distance_km} km` : null,
                customer: { name: (c as any).name || 'Bunda', phone: (c as any).phone || '' },
                attribution: {
                  isPaid: !!(c as any).adClick,
                  ctwa_clid: (c as any).adClick?.ctwa_clid || null,
                  trackingCode: (c as any).adClick?.trackingCode || null,
                  landingUrl: canonicalLandingUrl,
                },
                utm: {
                  campaign: (c as any).adClick?.utmCampaign || null,
                  source: (c as any).adClick?.utmSource || null,
                  medium: (c as any).adClick?.utmMedium || null,
                },
                ageHours: Math.floor(ageMs / (60 * 60 * 1000)),
                daysOld: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
                expiresInDays: Math.max(0, 7 - Math.floor(ageMs / (24 * 60 * 60 * 1000))),
                metaDropRisk: Math.floor(ageMs / (24 * 60 * 60 * 1000)) > 7,
              });
            }
          } catch {}
        }
      } catch (leadErr) {
        console.warn('[CAPI QUEUE] Could not fetch unsent MQL leads:', leadErr);
      }

      const data = [...reservationData, ...mqlLeadItems];
      const pending = data.filter((d) => d.purchase_review_status === 'pending').length;

      return reply.status(200).send({ success: true, data, total: data.length, pending, wabaConfigured });
    } catch (err: any) {
      const rows = filterMemoryByTenant(memoryReservations.values(), tenantId).filter((r: any) => {
        if ((CAPI_QUEUE_EXCLUDED_RESERVATION_STATUSES as readonly string[]).includes(String(r.status))) {
          return false;
        }
        const review = r.purchase_review_status || 'pending';
        const queueEligible =
          review === 'approved'
          || (review === 'pending' && Boolean(r.booking_date))
          || Boolean(r.purchase_occurred_at)
          || r.status === 'completed';
        if (!queueEligible) return false;
        return !shouldExcludeFromCapiQueue(
          r.customer?.phone ?? r.phone,
          r.customer?.name ?? r.name,
          r.customer?.is_sandbox_test ?? r.is_sandbox_test
        );
      });
      return reply.status(200).send({
        success: true,
        data: rows,
        total: rows.length,
        pending: rows.filter((r) => (r.purchase_review_status || 'pending') === 'pending').length,
        note: 'Fallback in-memory mode (DB offline)',
      });
    }
  });
}
