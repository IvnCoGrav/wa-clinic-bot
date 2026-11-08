import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../db/client';
import { tenantOf } from '../route-helpers';
import { memoryReservations, filterMemoryByTenant } from '../stores';
import {
  resolveTreatmentValue,
  extractValueByFormat,
  getTenantCapiFormats,
  resolveCanonicalLandingUrl,
} from '../../../services/capi.service';
import { CAPI_QUEUE_EXCLUDED_RESERVATION_STATUSES } from '../../../services/capi-review-status';
import { extractRupiahAmount } from '../../../services/purchase-detection.service';
import { parsePaymentSection } from '../../../utils/conversation-transaction-extractor';
import { shouldExcludeFromCapiQueue } from '../../../utils/dummy-filter';

export async function registerCapiQueueRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/admin/capi-queue
   * Meja kerja Advertiser (Meta CAPI Queue): daftar reservasi & lead yang masuk ke sistem
   * beserta data atribusi (paid/organic + UTM) dan estimasi sisa usia event sebelum Meta drop (7 hari).
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
          // Riwayat approved tetap terlihat walau tanpa tanggal.
          { purchase_review_status: 'approved' },
          // Pending hanya sah bila sudah punya jadwal.
          { purchase_review_status: 'pending', booking_date: { not: null } },
          // Pembayaran terdeteksi pada intake tanpa tanggal tetap boleh tampil.
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

      // Isolasi sandbox lapis presentasi (defense-in-depth): saring baris
      // sandbox/dummy yang lolos filter query (flag belum ter-set tapi nomor dummy).
      const visibleRows = rows.filter(
        (r: (typeof rows)[number]) => !shouldExcludeFromCapiQueue(r.customer?.phone, r.customer?.name, (r.customer as any)?.is_sandbox_test)
      );

      const formats = await getTenantCapiFormats(tenantId);
      const { getTenantMetaPurchasePolicy } = await import('../../../services/capi.service');
      const tenantMetaPolicy = await getTenantMetaPurchasePolicy(tenantId);
      const now = Date.now();

      let tenantLandingDomain = '';
      let wabaConfigured = false;
      try {
        // Select eksplisit: kolom tenants.settings belum ada di sebagian DB
        // (drift baseline, lihat docs/KNOWN_ISSUES.md #30) — select-* memicu P2022.
        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { id: true, landing_domain: true, waba_business_account_id: true },
        });
        if ((tenant as any)?.landing_domain) {
          tenantLandingDomain = (tenant as any).landing_domain.trim();
        }
        // State-gate UI preview: envelope business_messaging HANYA sah bila tenant
        // punya WABA id (paritas backend `capi.service.ts` useBusinessMessaging).
        wabaConfigured = Boolean((tenant as any)?.waba_business_account_id);
      } catch {}

      const treatmentPriceCache = new Map<string, number | undefined>();
      const getCachedTreatmentValue = async (detail: string): Promise<number | undefined> => {
        if (treatmentPriceCache.has(detail)) return treatmentPriceCache.get(detail);
        const v = await resolveTreatmentValue(detail, tenantId);
        treatmentPriceCache.set(detail, v);
        return v;
      };

      // Order number per customer (new vs repeat) — 1 query, bukan N+1.
      // Basis kanonis: reservasi confirmed/completed (di luar cancelled/hold).
      // Ordinal ditetapkan dari urutan created_at per customer (deterministik).
      const customerIds = Array.from(new Set(visibleRows.map((r) => r.customer_id).filter(Boolean)));
      const orderNumberByReservation = new Map<string, number>();
      const totalConfirmedByCustomer = new Map<string, number>();
      if (customerIds.length > 0) {
        try {
          const confirmedRows = await prisma.reservation.findMany({
            where: {
              tenant_id: tenantId,
              customer_id: { in: customerIds },
              // Selaras dengan kanonis `computeIsRepeatOrder` (reservation-core):
              // status riwayat = confirmed/en_route/completed.
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
          // Otoritas new-vs-repeat = ordinal riwayat transaksi nyata (orderNumber),
          // BUKAN flag `Reservation.is_repeat_order` yang bisa terkontaminasi
          // (mis. mutasi lama di follow-up.service). Order #1 SELALU 'new'.
          // Selaras dengan computeIsRepeatOrder (reservation-core) &
          // resolveNewVsRepeatContext (capi.service).
          const isRepeatOrder = orderNumber > 1;

          // Sanitize treatment_detail on the fly (hapus part yang berisi placeholder teks template)
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
            // "CAPI Filtered" hanya sah bila: belum di-approve (akan difilter nanti),
            // ATAU sudah approved tapi TIDAK PERNAH terkirim (sent_at null = hasil suppress).
            // Event historis yang sudah terkirim (sent_at terisi) TIDAK berlabel "Filtered".
            will_suppress_capi:
              isRepeatOrder &&
              tenantMetaPolicy === 'SUPPRESS_REPEAT' &&
              (r.purchase_review_status === 'pending' || !r.purchase_event_sent_at),
            distanceKm,
            customer: {
              id: r.customer?.id,
              name: r.customer?.name || 'Bunda',
              phone: r.customer?.phone || '',
              kota: r.customer?.kota || (r.customer as any)?.pending_kota || null,
              kecamatan: r.customer?.kecamatan || (r.customer as any)?.pending_kecamatan || null,
              zipcode: r.customer?.zipcode || (r.customer as any)?.pending_zipcode || null,
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

      // Unsent MQL Leads + riwayat terkirim/ditolak (agar tidak lenyap pasca-moderasi)
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
        // leadAuditLogs diurutkan created_at DESC → log TERBARU dieksekusi admin
        // harus menang. Tanpa cek `has()`, iterasi akan menimpa dengan log TERTUA
        // (bug: aksi reject/outlier terbaru hilang).
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
            // Anti-duplikasi Lead vs Purchase: customer yang SUDAH closing
            // (punya reservasi confirmed/en_route/completed) tidak dimoderasi
            // lagi sebagai Lead — sudah terkonversi ke Purchase. Syarat berbasis
            // state DB (bukan string match), tahan terhadap paginasi/date-range.
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
        // Riwayat MQL yang sudah dimoderasi (approved -> Terkirim, rejected -> ignored_outlier)
        if (processedCustomerIds.length > 0) {
          try {
            const processedCustomers = await prisma.customer.findMany({
              where: {
                tenant_id: tenantId,
                id: { in: processedCustomerIds.slice(0, 50) },
                // Sama seperti daftar unsent: sembunyikan baris Lead bagi customer
                // yang sudah closing (agar tidak tampil ganda Lead + Purchase).
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
