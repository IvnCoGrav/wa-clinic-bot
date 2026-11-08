import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../db/client';
import { tenantOf } from '../route-helpers';
import { memoryReservations } from '../stores';
import { auditService } from '../../../services/audit.service';
import { customerService } from '../../../services/customer.service';
import {
  capiService,
  resolveTreatmentValue,
  extractValueByFormat,
  getTenantCapiFormats,
} from '../../../services/capi.service';
import { extractRupiahAmount } from '../../../services/purchase-detection.service';
import { parsePaymentSection } from '../../../utils/conversation-transaction-extractor';

export async function registerPurchaseRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/admin/reservation/:id/approve-purchase
   * Moderasi outlier: admin menyetujui event Purchase yang ditahan queue
   * (purchase_review_status='pending'). Event dikirim ke Meta CAPI dengan
   * event_time HISTORIS (purchase_occurred_at) agar attribution akurat.
   * Event >7 hari ditolak — Meta akan drop event yang terlalu lama.
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

        // Izinkan re-send jika force=true, bahkan jika status sudah approved
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

        // Jika nama customer masih generic (misal "Mbak" / "Bunda"), update nama customer di DB dari raw_text
        const { isGenericCustomerName } = await import('../../../utils/name-sanitizer');
        const isCurrentGeneric = !existing.customer?.name || isGenericCustomerName(existing.customer.name);
        if (isCurrentGeneric && existing.raw_text && existing.customer) {
          try {
            const { parseReservationText } = await import('../../../utils/reservation-text-parser');
            const pr = parseReservationText(existing.raw_text);
            if (pr.success && pr.reservation?.name && !isGenericCustomerName(pr.reservation.name)) {
              const isMale = /^(?:ayah|pak|bapak)\s+/i.test(pr.reservation.name);
              const cleanName = pr.reservation.name.replace(/^(?:ayah|pak|bapak|bunda|ibu|mama|mom|mbak|mas|kak|kakak|ny|ny\.)\s+/i, '').trim();
              if (cleanName && !['bunda', 'ibu', 'mama', 'mom', 'mbak', 'mas', 'kak', 'kakak', 'pasien', 'customer', '-'].includes(cleanName.toLowerCase())) {
                const formattedName = isMale ? `Ayah ${cleanName}`.trim() : `Bunda ${cleanName}`.trim();
                await customerService.updateCustomerName(existing.customer.id, formattedName, tenantId, { source: 'reservation' }).catch(() => {});
                existing.customer.name = formattedName;
              }
            }
          } catch {}
        }

        // Tahap-B (A-004): reservasi yang sudah pernah terkirim SEBELUM kontrak
        // event_id deterministik WAJIB memakai ulang event_id pengiriman pertamanya
        // (format lama berbasis occurredAt) saat force-resend — jangan membuat id baru
        // yang membuat Meta menghitung ulang konversi yang sama (double count).
        const { buildLegacyPurchaseEventId } = await import('../../../services/capi.service');
        const legacyEventIdForResend = existing.purchase_event_sent_at != null && !customPayload?.event_id
          ? buildLegacyPurchaseEventId({
              trackingCode: (existing.customer as any)?.adClick?.trackingCode,
              reservationId: existing.id,
              customerId: existing.customer_id,
              eventTimeSec: Math.floor(occurredAt.getTime() / 1000),
            })
          : undefined;

        // 5. AWAIT CAPI — hanya set approved jika Meta benar-benar menerima event.
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
            // Integritas kasir: pertahankan nilai apa adanya. Null tetap null (belum terima uang).
            // occurredDate (created_at fallback) hanya dipakai untuk event_time Meta, bukan disimpan.
            ...(existing.purchase_occurred_at ? { purchase_occurred_at: occurredDate } : {}),
            purchase_value: resolvedVal ?? undefined,
            purchase_review_status: 'approved',
            // Jangan memalsukan status pengiriman jika event CAPI di-suppress (kebijakan repeat order)
            ...(capiResult.skipped !== true ? { purchase_event_sent_at: new Date() } : {}),
          },
        });

        // LTV = uang riil. Jangan katrol LTV saat approve dini (kasir masih null); LTV naik nanti via recordPayment.
        if (existing.purchase_occurred_at) {
          await customerService.recalculateCustomerLtv(existing.customer_id, existing.tenant_id || tenantId).catch(() => {});
        }

        // Fase 4.3: Otomatis batalkan follow-up NO_PURCHASE yang masih PENDING/QUEUED
        // karena customer sudah terbukti purchase / closing
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
        // Fallback in-memory hanya untuk dev/test — di production harus fail agar UI tidak tampil success palsu
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
   * Moderasi outlier: admin menandai transaksi sebagai outlier / dibatalkan
   * (purchase_review_status='ignored_outlier'). Event TIDAK dikirim ke Meta CAPI
   * agar tidak mencemari data optimasi Ads Manager.
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

        // Moderasi CAPI murni urusan atribusi Meta Ads: HANYA mengubah
        // purchase_review_status. DILARANG menyentuh purchase_occurred_at /
        // purchase_value / payment_method — status keuangan internal TIDAK
        // berubah. Melunasi reservasi tetap lewat jalur bayar resmi.
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
   * Fase 4.2: Memulihkan transaksi yang salah ditandai outlier kembali ke status pending
   * agar dapat dievaluasi atau disetujui ulang oleh admin.
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
}
