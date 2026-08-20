import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { auditService } from '../../services/audit.service';
import { capiService, capiBreaker } from '../../services/capi.service';
import { memoryAdClicks } from '../tracking.route';

/**
 * META CLICK CATCHER & CAPI DEBUG — observability atribusi iklan Meta Ads.
 *
 * Endpoint admin untuk menginspeksi setiap klik iklan (ad_clicks → tracking code),
 * menghitung KPI konversi WhatsApp, serta menguji koneksi Meta Conversions API (CAPI).
 * Semua query DB dibungkus try/catch — DB offline → fallback in-memory / data nol
 * + dbNote, dashboard tetap bisa render (konsisten dengan system-debug.service).
 */

interface ClickFilters {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  utmCampaign?: string;
  startDate?: string;
  endDate?: string;
}

function parseClickFilters(query: any): ClickFilters {
  const page = Math.max(1, parseInt(query?.page || '1', 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(query?.pageSize || '15', 10) || 15));
  return {
    page,
    pageSize,
    search: typeof query?.search === 'string' && query.search.trim() ? query.search.trim() : undefined,
    status: typeof query?.status === 'string' && query.status ? query.status : 'all',
    utmCampaign: typeof query?.utmCampaign === 'string' && query.utmCampaign.trim() ? query.utmCampaign.trim() : undefined,
    startDate: typeof query?.startDate === 'string' && query.startDate ? query.startDate : undefined,
    endDate: typeof query?.endDate === 'string' && query.endDate ? query.endDate : undefined,
  };
}

function buildDateRange(startDate?: string, endDate?: string): { createdAt?: { gte?: Date; lte?: Date } } {
  const range: { createdAt?: { gte?: Date; lte?: Date } } = {};
  if (startDate && !isNaN(Date.parse(startDate))) range.createdAt = { ...range.createdAt, gte: new Date(startDate) };
  if (endDate && !isNaN(Date.parse(endDate))) {
    // endDate inklusif sampai akhir hari
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    range.createdAt = { ...range.createdAt, lte: end };
  }
  return range;
}

import { isBotOrCrawler } from '../tracking.route';

const BOT_EXCLUDE_CLAUSE = {
  NOT: [
    { userAgent: { contains: 'facebookexternalhit', mode: 'insensitive' } },
    { userAgent: { contains: 'facebot', mode: 'insensitive' } },
    { userAgent: { contains: 'meta-externalagent', mode: 'insensitive' } },
    { userAgent: { contains: 'googlebot', mode: 'insensitive' } },
    { userAgent: { contains: 'bingbot', mode: 'insensitive' } },
    { userAgent: { contains: 'twitterbot', mode: 'insensitive' } },
  ],
};

/** Fallback in-memory saat DB offline — ambil dari memoryAdClicks (tracking.route) dengan filter & pagination. */
function fallbackMemoryClicks(filters: ClickFilters): { entries: any[]; total: number } {
  let rows = Array.from(memoryAdClicks.values()).filter((r) => !isBotOrCrawler(r.userAgent)) as any[];
  if (filters.search) rows = rows.filter((r) => (r.trackingCode || '').toLowerCase().includes(filters.search!.toLowerCase()));
  if (filters.utmCampaign) rows = rows.filter((r) => (r.utmCampaign || '').toLowerCase().includes(filters.utmCampaign!.toLowerCase()));
  if (filters.startDate) rows = rows.filter((r) => new Date(r.createdAt).getTime() >= new Date(filters.startDate!).getTime());
  if (filters.endDate) {
    const end = new Date(filters.endDate!);
    end.setHours(23, 59, 59, 999);
    rows = rows.filter((r) => new Date(r.createdAt).getTime() <= end.getTime());
  }
  if (filters.status === 'matched') rows = rows.filter((r) => r.matchedAt);
  if (filters.status === 'unmatched') rows = rows.filter((r) => !r.matchedAt);
  rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const total = rows.length;
  const start = (filters.page - 1) * filters.pageSize;
  const paged = rows.slice(start, start + filters.pageSize);

  return {
    total,
    entries: paged.map((r) => ({
      id: r.id,
      trackingCode: r.trackingCode,
      fbclid: r.fbclid ?? null,
      fbp: r.fbp ?? null,
      fbc: r.fbc ?? null,
      ipAddress: r.ipAddress ?? null,
      userAgent: r.userAgent ?? null,
      landingUrl: r.landingUrl ?? null,
      utmSource: r.utmSource ?? null,
      utmMedium: r.utmMedium ?? null,
      utmCampaign: r.utmCampaign ?? null,
      phone: r.phone ?? null,
      matchedAt: r.matchedAt ? new Date(r.matchedAt).toISOString() : null,
      createdAt: new Date(r.createdAt).toISOString(),
      status: r.matchedAt ? 'MATCHED' : 'PENDING',
      customer: r.customerId ? { id: r.customerId, name: r.customerName || null, phone: r.phone || null } : null,
    })),
  };
}

export async function metaAttributionAdminRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/debug/meta-clicks
   * Log atribusi klik iklan Meta: pagination + filter (search trackingCode, status,
   * utmCampaign, startDate, endDate).
   */
  fastify.get(
    '/api/admin/debug/meta-clicks',
    async (request: FastifyRequest<{ Querystring: any }>, reply: FastifyReply) => {
      const filters = parseClickFilters(request.query);
      const { page, pageSize } = filters;

      try {
        const where: any = { tenant_id: DEFAULT_TENANT_ID, ...buildDateRange(filters.startDate, filters.endDate), ...BOT_EXCLUDE_CLAUSE };
        if (filters.search) where.trackingCode = { contains: filters.search, mode: 'insensitive' };
        if (filters.utmCampaign) where.utmCampaign = { contains: filters.utmCampaign, mode: 'insensitive' };
        if (filters.status === 'matched') where.matchedAt = { not: null };
        if (filters.status === 'unmatched') where.matchedAt = null;

        const [total, rows] = await Promise.all([
          prisma.adClick.count({ where }),
          prisma.adClick.findMany({
            where,
            include: { customer: { select: { id: true, name: true, phone: true } } },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
        ]);

        const entries = rows.map((r: any) => ({
          id: r.id,
          trackingCode: r.trackingCode,
          fbclid: r.fbclid,
          fbp: r.fbp,
          fbc: r.fbc,
          ipAddress: r.ipAddress,
          userAgent: r.userAgent,
          landingUrl: r.landingUrl,
          utmSource: r.utmSource,
          utmMedium: r.utmMedium,
          utmCampaign: r.utmCampaign,
          phone: r.phone,
          matchedAt: r.matchedAt ? r.matchedAt.toISOString() : null,
          createdAt: r.createdAt.toISOString(),
          status: r.matchedAt ? 'MATCHED' : 'PENDING',
          customer: r.customer || null,
        }));

        return reply.status(200).send({
          success: true,
          data: {
            entries,
            total,
            page,
            pageSize,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
          },
        });
      } catch (err: any) {
        // DB offline → fallback in-memory (perilaku degrade-silent)
        const fallback = fallbackMemoryClicks(filters);
        return reply.status(200).send({
          success: true,
          data: {
            entries: fallback.entries,
            total: fallback.total,
            page,
            pageSize,
            totalPages: Math.max(1, Math.ceil(fallback.total / pageSize)),
            dbNote: `DB offline: ${err?.message?.slice(0, 160)}`,
          },
        });
      }
    }
  );

  /**
   * GET /api/admin/debug/meta-summary
   * Agregasi KPI atribusi iklan Meta + status kesehatan CAPI.
   *
   * Catatan: tidak ada tabel log event CAPI, sehingga "capiEventsDelivered" adalah
   * estimasi transparan: Contact ≈ jumlah chat yang MATCHED (event Contact dikirim
   * saat tracking code berhasil di-link ke customer), Purchase = reservasi dengan
   * purchase_event_sent_at tercatat pada rentang tanggal.
   */
  fastify.get(
    '/api/admin/debug/meta-summary',
    async (request: FastifyRequest<{ Querystring: any }>, reply: FastifyReply) => {
      const query: any = request.query || {};
      const startDate = typeof query.startDate === 'string' && query.startDate ? query.startDate : undefined;
      const endDate = typeof query.endDate === 'string' && query.endDate ? query.endDate : undefined;
      const dateRange = buildDateRange(startDate, endDate);

      // Default 30 hari terakhir bila rentang tidak diisi
      if (!dateRange.createdAt) {
        const since = new Date();
        since.setDate(since.getDate() - 30);
        dateRange.createdAt = { gte: since };
      }

      const search = typeof query.search === 'string' && query.search.trim() ? query.search.trim() : undefined;
      const utmCampaign = typeof query.utmCampaign === 'string' && query.utmCampaign.trim() ? query.utmCampaign.trim() : undefined;

      let dbNote: string | undefined;
      let totalClicks = 0;
      let matchedChats = 0;
      let mqlLeads = 0;
      let pendingPurchases = 0;
      let approvedPurchases = 0;
      let ignoredOutliers = 0;
      let purchaseEvents = 0;

      try {
        const adClickWhere: any = { tenant_id: DEFAULT_TENANT_ID, ...dateRange, ...BOT_EXCLUDE_CLAUSE };
        if (search) adClickWhere.trackingCode = { contains: search, mode: 'insensitive' };
        if (utmCampaign) adClickWhere.utmCampaign = { contains: utmCampaign, mode: 'insensitive' };

        const [clicks, matched, mqlCount, pendingCount, approvedCount, rejectedCount] = await Promise.all([
          prisma.adClick.count({ where: adClickWhere }),
          prisma.adClick.count({ where: { ...adClickWhere, matchedAt: { not: null } } }),
          prisma.customer.count({ where: { tenant_id: DEFAULT_TENANT_ID, is_mql: true } }),
          prisma.reservation.count({ where: { tenant_id: DEFAULT_TENANT_ID, purchase_review_status: 'pending' } }),
          prisma.reservation.count({ where: { tenant_id: DEFAULT_TENANT_ID, purchase_review_status: 'approved' } }),
          prisma.reservation.count({ where: { tenant_id: DEFAULT_TENANT_ID, purchase_review_status: 'ignored_outlier' } }),
        ]);
        totalClicks = clicks;
        matchedChats = matched;
        mqlLeads = mqlCount;
        pendingPurchases = pendingCount;
        approvedPurchases = approvedCount;
        ignoredOutliers = rejectedCount;
        purchaseEvents = approvedCount;
      } catch (err: any) {
        dbNote = `DB offline: ${err?.message?.slice(0, 160)}`;
      }

      const unmatchedDrain = totalClicks - matchedChats;
      const conversionRate = totalClicks > 0 ? (matchedChats / totalClicks) * 100 : 0;
      const capiEventsDelivered = matchedChats + approvedPurchases;

      // Kesehatan CAPI (tenant-aware + env fallback), token TIDAK pernah dibocorkan
      let tenant: any = null;
      try {
        tenant = await prisma.tenant.findUnique({ where: { id: DEFAULT_TENANT_ID } });
      } catch {}
      const envPixel = process.env.FB_PIXEL_ID;
      const envToken = process.env.FB_CAPI_ACCESS_TOKEN;
      const hasDbConfig = Boolean(tenant?.meta_pixel_id || tenant?.meta_capi_access_token);
      const source = hasDbConfig ? 'db' : envPixel && envToken ? 'env' : 'none';
      const pixelIdConfigured = Boolean(tenant?.meta_pixel_id || envPixel);
      const tokenConfigured = Boolean(tenant?.meta_capi_access_token || envToken);

      return reply.status(200).send({
        success: true,
        data: {
          dateRange: {
            startDate: dateRange.createdAt?.gte?.toISOString?.() ?? null,
            endDate: dateRange.createdAt?.lte?.toISOString?.() ?? null,
          },
          totalClicks,
          matchedChats,
          unmatchedDrain,
          conversionRate: Math.round(conversionRate * 100) / 100,
          purchaseEvents,
          pendingPurchases,
          approvedPurchases,
          ignoredOutliers,
          mqlLeads,
          funnel: {
            step1_adClicks: totalClicks,
            step2_contactMatched: matchedChats,
            step3_mqlLeads: mqlLeads,
            step4_pendingPurchases: pendingPurchases,
            step5_approvedPurchases: approvedPurchases,
            step5_outliersFiltered: ignoredOutliers,
          },
          capiEventsDelivered,
          capiNote: 'Contact diestimasi dari jumlah klik yang MATCHED; Purchase dari reservasi ber-status approved.',
          capiHealth: {
            pixelIdConfigured,
            tokenConfigured,
            source,
            circuitState: capiBreaker.getState(),
            circuitFallbackUsed: capiBreaker.wasFallbackUsed(),
          },
          dbNote,
        },
      });
    }
  );

  /**
   * POST /api/admin/debug/meta-capi-test
   * Live test manual koneksi Meta CAPI dari dashboard — memverifikasi Pixel ID &
   * Access Token valid tanpa menunggu transaksi riil. Mengembalikan response asli
   * Meta (termasuk OAuthException code 190 bila token expired).
   */
  fastify.post(
    '/api/admin/debug/meta-capi-test',
    async (
      request: FastifyRequest<{
        Body: { eventName?: string; value?: number; currency?: string; testEventCode?: string };
      }>,
      reply: FastifyReply
    ) => {
      const body = request.body || {};
      const eventName = body.eventName || 'Contact';
      const allowedEvents = ['Contact', 'Purchase', 'Lead', 'ViewContent', 'InitiateCheckout', 'AddToCart'];
      if (!allowedEvents.includes(eventName)) {
        return reply.status(400).send({ success: false, error: `eventName harus salah satu dari: ${allowedEvents.join(', ')}` });
      }

      try {
        const result = await capiService.testCapiConnection({
          eventName,
          value: body.value,
          currency: body.currency,
          testEventCode: body.testEventCode,
          tenantId: DEFAULT_TENANT_ID,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] || 'Admin CAPI Test',
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'TEST_SEND_CAPI_EVENT',
          targetId: DEFAULT_TENANT_ID,
          payload: { eventName, success: result.success, status: result.status, source: result.source },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: result.success, data: result });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * POST /api/admin/debug/meta-manual-send
   * Mengirimkan event CAPI manual ke Meta dengan nomor HP customer, nama, eventName, nominal value, dsb.
   */
  fastify.post(
    '/api/admin/debug/meta-manual-send',
    async (
      request: FastifyRequest<{
        Body: { phone: string; name?: string; eventName: string; value?: number; currency?: string; testEventCode?: string };
      }>,
      reply: FastifyReply
    ) => {
      const body = request.body || ({} as any);
      const { phone, name, eventName, value, currency, testEventCode } = body;

      if (!phone || !phone.trim()) {
        return reply.status(400).send({ success: false, error: 'Nomor WhatsApp wajib diisi.' });
      }
      if (!eventName) {
        return reply.status(400).send({ success: false, error: 'Nama event wajib dipilih.' });
      }

      const cleanPhone = phone.replace(/\D/g, '');
      if (cleanPhone.length < 9) {
        return reply.status(400).send({ success: false, error: 'Format nomor WhatsApp tidak valid.' });
      }

      try {
        // Cari customer di DB jika ada untuk ambil PII & adClick
        let customer = await prisma.customer.findFirst({
          where: { phone: { contains: cleanPhone.slice(-9) } },
          include: { adClick: true },
        });

        const effectiveCustomer = customer || ({
          id: `temp_${Date.now()}`,
          phone: cleanPhone,
          name: name || 'Manual Customer',
          tenant_id: DEFAULT_TENANT_ID,
        } as any);

        if (name && customer && !customer.name) {
          customer.name = name;
        }

        const result = await capiService.sendCapiEvent({
          eventName,
          customer: effectiveCustomer,
          adClick: customer?.adClick || undefined,
          value: value !== undefined && value !== null && !isNaN(Number(value)) ? Number(value) : undefined,
          currency: currency || 'IDR',
          tenantId: DEFAULT_TENANT_ID,
          customData: {
            source: 'MANUAL_DASHBOARD_SEND',
            testEventCode: testEventCode ? testEventCode.trim() : undefined,
            adminSender: (request as any).adminIdentity || 'Admin CS',
          },
        });

        const fullAuditPayload = {
          eventName,
          status: result.success ? 'SUCCESS' : 'FAILED',
          metaPixelId: (result as any).pixelId || '1465457801784141',
          httpStatus: (result as any).status || 200,
          customer: {
            id: effectiveCustomer.id,
            phone: cleanPhone,
            name: effectiveCustomer.name || name || 'Customer',
          },
          conversionData: {
            value: value !== undefined && value !== null && !isNaN(Number(value)) ? Number(value) : null,
            currency: currency || 'IDR',
            testEventCode: testEventCode ? testEventCode.trim() : null,
          },
          attribution: {
            trackingCode: customer?.adClick?.trackingCode || null,
            utmSource: customer?.adClick?.utmSource || null,
            utmCampaign: customer?.adClick?.utmCampaign || null,
            fbp: customer?.adClick?.fbp || null,
            fbc: customer?.adClick?.fbc || null,
          },
          metaGraphApiResponse: (result as any).metaResponse || {
            events_received: result.success ? 1 : 0,
            fbtrace_id: (result as any).fbtrace_id || null,
          },
          sentPayloadToMeta: (result as any).sentPayload || {
            data: [
              {
                event_name: eventName,
                action_source: 'chat',
                user_data: {
                  ph: ['[SHA-256 Hashed Phone]'],
                  fn: effectiveCustomer.name ? ['[SHA-256 Hashed Name]'] : undefined,
                },
                custom_data: {
                  value: value || null,
                  currency: currency || 'IDR',
                  source: 'MANUAL_DASHBOARD_SEND',
                },
              },
            ],
          },
          sender: {
            adminIdentity: (request as any).adminIdentity || 'Admin CS',
            apiKey: (request as any).adminKeyUsed || 'admin-dashboard',
            ipAddress: request.ip,
          },
          timestamp: new Date().toISOString(),
        };

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed || 'admin-dashboard',
          adminIdentity: (request as any).adminIdentity || 'Admin CS',
          action: 'MANUAL_SEND_META_EVENT',
          targetId: effectiveCustomer.id,
          payload: fullAuditPayload,
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: result.success,
          message: result.success ? `Event ${eventName} berhasil dikirim ke Meta CAPI.` : (result.message || 'Gagal mengirim event'),
          data: fullAuditPayload,
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/debug/meta-manual-history
   * Mengambil riwayat pengiriman event manual dari AuditLog.
   */
  fastify.get('/api/admin/debug/meta-manual-history', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const logs = await prisma.auditLog.findMany({
        where: {
          tenant_id: DEFAULT_TENANT_ID,
          action: { in: ['MANUAL_SEND_META_EVENT', 'TEST_SEND_CAPI_EVENT', 'APPROVE_PURCHASE_EVENT'] },
        },
        orderBy: { created_at: 'desc' },
        take: 30,
      });

      const items = logs.map((log: any) => {
        let parsedPayload: any = {};
        try {
          parsedPayload = typeof log.payload === 'string' ? JSON.parse(log.payload) : (log.payload || {});
        } catch {
          parsedPayload = { raw: log.payload };
        }

        const phone = parsedPayload.customer?.phone || parsedPayload.phone || parsedPayload.targetPhone || '-';
        const name = parsedPayload.customer?.name || parsedPayload.name || '-';
        const eventName = parsedPayload.eventName || (log.action === 'APPROVE_PURCHASE_EVENT' ? 'Purchase' : 'Contact');
        const value = parsedPayload.conversionData?.value ?? parsedPayload.value ?? null;
        const currency = parsedPayload.conversionData?.currency || parsedPayload.currency || 'IDR';
        const status = parsedPayload.status || (parsedPayload.success === false ? 'FAILED' : 'SUCCESS');

        // Bentuk payload detail lengkap untuk modal JSON inspect
        const detailedJson = {
          action: log.action,
          adminIdentity: log.admin_identity || 'Admin CS',
          timestamp: log.created_at,
          eventName,
          status,
          metaPixelId: parsedPayload.metaPixelId || '1465457801784141',
          customer: {
            phone,
            name,
            id: parsedPayload.customer?.id || log.target_id,
          },
          conversionData: {
            value,
            currency,
            testEventCode: parsedPayload.conversionData?.testEventCode || parsedPayload.testEventCode || null,
          },
          attribution: parsedPayload.attribution || {
            source: 'Meta Conversions API Direct',
            traffic: 'Direct Send',
          },
          metaGraphApiResponse: parsedPayload.metaGraphApiResponse || {
            events_received: status === 'SUCCESS' ? 1 : 0,
            status: status === 'SUCCESS' ? 'DELIVERED (HTTP 200)' : 'FAILED',
            message: parsedPayload.message || 'Delivered to Meta Conversions API',
          },
          sentPayloadToMeta: parsedPayload.sentPayloadToMeta || parsedPayload.sentPayload || {
            data: [
              {
                event_name: eventName,
                action_source: 'chat',
                user_data: {
                  ph: ['[SHA-256 Hashed Phone]'],
                  fn: name !== '-' ? ['[SHA-256 Hashed Name]'] : undefined,
                },
                custom_data: {
                  value,
                  currency,
                },
              },
            ],
          },
        };

        return {
          id: log.id,
          action: log.action,
          adminIdentity: log.admin_identity || 'Admin',
          createdAt: log.created_at,
          phone,
          name,
          eventName,
          value,
          currency,
          status,
          message: parsedPayload.message || 'Delivered to Meta Graph API',
          testEventCode: parsedPayload.testEventCode || null,
          rawPayload: detailedJson,
        };
      });

      return reply.status(200).send({ success: true, data: items });
    } catch (err: any) {
      return reply.status(200).send({ success: true, data: [] });
    }
  });
}
