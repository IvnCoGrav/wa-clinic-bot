import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { auditService } from '../../services/audit.service';
import {
  memoryLandings,
  validateLandingSlug,
  VALID_LANDING_EVENTS,
  purgeLandingCache,
} from './stores';

export async function landingAdminRoutes(fastify: FastifyInstance) {
  const previewBaseUrlForLanding = () =>
    process.env.LANDING_BASE_URL || process.env.TRACKING_API_BASE_URL || '';

  const toLandingListItem = (l: any) => {
    const base = previewBaseUrlForLanding();
    return {
      id: l.id,
      slug: l.slug,
      title: l.title,
      landingType: l.landing_type,
      hasHtml: !!l.html_content,
      sizeBytes: l.html_content ? Buffer.byteLength(l.html_content, 'utf-8') : 0,
      events: l.events || [],
      hasPixelOverride: !!l.meta_pixel_id,
      whatsappNumber: l.whatsapp_number || '',
      isActive: l.is_active,
      previewUrl: base ? `${base.replace(/\/+$/, '')}/${l.slug}` : `/${l.slug}`,
    };
  };

  const normalizeLandingEvents = (raw: any): string[] => {
    if (!Array.isArray(raw)) return [];
    return Array.from(
      new Set(raw.filter((e) => typeof e === 'string' && VALID_LANDING_EVENTS.includes(e)))
    ) as string[];
  };

  const normalizeNullableString = (raw: any): string | null => {
    if (typeof raw !== 'string') return null;
    const t = raw.trim();
    return t ? t : null;
  };

  /**
   * GET /api/admin/tenant/:id/landing
   * Mengambil status & konten landing page tenant (raw HTML + tipe) untuk editor dashboard
   */
  fastify.get(
    '/api/admin/tenant/:id/landing',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const previewBaseUrl = process.env.LANDING_BASE_URL || process.env.TRACKING_API_BASE_URL || '';
      try {
        const tenant = await prisma.tenant.findUnique({
          where: { id },
          select: {
            id: true,
            slug: true,
            name: true,
            landing_type: true,
            raw_html_content: true,
            meta_pixel_id: true,
            whatsapp_number: true,
          },
        });

        if (!tenant) {
          return reply.status(200).send({
            success: true,
            data: {
              tenantId: id,
              slug: id,
              clinicName: `Tenant ${id}`,
              landingType: 'STRUCTURED_JSON',
              hasRawHtml: false,
              rawHtmlContent: '',
              sizeBytes: 0,
              metaPixelId: process.env.FB_PIXEL_ID || '',
              whatsappNumber: process.env.DEFAULT_WHATSAPP_PHONE || '',
              previewBaseUrl,
            },
          });
        }

        return reply.status(200).send({
          success: true,
          data: {
            tenantId: tenant.id,
            slug: tenant.slug,
            clinicName: tenant.name,
            landingType: tenant.landing_type || 'STRUCTURED_JSON',
            hasRawHtml: !!tenant.raw_html_content,
            rawHtmlContent: tenant.raw_html_content || '',
            sizeBytes: tenant.raw_html_content ? Buffer.byteLength(tenant.raw_html_content, 'utf-8') : 0,
            metaPixelId: tenant.meta_pixel_id || '',
            whatsappNumber: tenant.whatsapp_number || '',
            previewBaseUrl,
          },
        });
      } catch (err: any) {
        console.warn(`[LANDING GET FALLBACK] DB offline untuk tenant ${id}:`, err.message);
        return reply.status(200).send({
          success: true,
          data: {
            tenantId: id,
            slug: id,
            clinicName: `Tenant ${id}`,
            landingType: 'STRUCTURED_JSON',
            hasRawHtml: false,
            rawHtmlContent: '',
            sizeBytes: 0,
            metaPixelId: process.env.FB_PIXEL_ID || '',
            whatsappNumber: process.env.DEFAULT_WHATSAPP_PHONE || '',
            previewBaseUrl,
          },
        });
      }
    }
  );

  /**
   * PUT /api/admin/tenant/:id/html
   * Upload custom raw HTML untuk landing page tenant (Fase 1.5 - 17-layer security check)
   */
  fastify.put(
    '/api/admin/tenant/:id/html',
    {
      bodyLimit: 512 * 1024,
    },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { rawHtml?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { rawHtml } = request.body || {};

      if (rawHtml === undefined || rawHtml === null || typeof rawHtml !== 'string') {
        return reply.status(400).send({ error: 'rawHtml field is required and must be a string.' });
      }

      const sizeInBytes = Buffer.byteLength(rawHtml, 'utf-8');
      if (sizeInBytes > 500 * 1024) {
        return reply.status(413).send({ error: 'Payload Too Large: Raw HTML exceeds maximum size of 500 KB.' });
      }

      try {
        const { TenantHtmlService } = await import('../../services/tenant-html.service');
        const sanitizedHtml = TenantHtmlService.validateAndSanitize(rawHtml);

        const updatedTenant = await prisma.tenant.upsert({
          where: { id },
          create: {
            id,
            slug: id,
            name: `Tenant ${id}`,
            landing_type: 'RAW_HTML',
            raw_html_content: sanitizedHtml,
          },
          update: {
            landing_type: 'RAW_HTML',
            raw_html_content: sanitizedHtml,
          },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'TENANT_RAW_HTML_UPLOAD',
          targetId: id,
          payload: { sizeBytes: sizeInBytes, landingType: 'RAW_HTML' },
          ipAddress: request.ip,
        });

        await purgeLandingCache(id);

        return reply.status(200).send({
          success: true,
          message: 'Raw HTML landing page successfully updated and sanitized.',
          data: {
            tenantId: updatedTenant.id,
            landingType: updatedTenant.landing_type,
            sizeBytes: sizeInBytes,
          },
        });
      } catch (err: any) {
        if (
          err.message &&
          (err.message.includes('Forbidden') ||
            err.message.includes('http-equiv') ||
            err.message.includes("id='wa-cta'") ||
            err.message.includes('wa-cta') ||
            err.message.includes('Sanitization') ||
            err.message.includes('HTML'))
        ) {
          return reply.status(400).send({ error: err.message });
        }
        return reply.status(200).send({
          success: true,
          message: 'Raw HTML landing page uploaded (In-Memory Fallback Mode).',
          data: { tenantId: id, landingType: 'RAW_HTML', sizeBytes: sizeInBytes },
        });
      }
    }
  );

  /**
   * POST /api/admin/tenant/:id/landing/reset
   * Mengembalikan landing page tenant ke template default STRUCTURED_JSON (menghapus raw HTML)
   */
  fastify.post(
    '/api/admin/tenant/:id/landing/reset',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      try {
        const updatedTenant = await prisma.tenant.upsert({
          where: { id },
          create: { id, slug: id, name: `Tenant ${id}`, landing_type: 'STRUCTURED_JSON', raw_html_content: null },
          update: { landing_type: 'STRUCTURED_JSON', raw_html_content: null },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'TENANT_RAW_HTML_RESET',
          targetId: id,
          payload: { landingType: 'STRUCTURED_JSON' },
          ipAddress: request.ip,
        });

        try {
          await prisma.landingPage.updateMany({
            where: { tenant_id: id, slug: id },
            data: { landing_type: 'STRUCTURED_JSON', html_content: null },
          });
        } catch (syncErr: any) {
          console.warn(`[TENANT RAW HTML SYNC] Skip landing_page reset sync:`, syncErr.message);
        }

        await purgeLandingCache(id);

        return reply.status(200).send({
          success: true,
          message: 'Landing page dikembalikan ke template default.',
          data: { tenantId: updatedTenant.id, landingType: updatedTenant.landing_type },
        });
      } catch (err: any) {
        return reply.status(200).send({
          success: true,
          message: 'Landing page dikembalikan ke template default (In-Memory Fallback Mode).',
          data: { tenantId: id, landingType: 'STRUCTURED_JSON' },
        });
      }
    }
  );

  /**
   * GET /api/admin/landings?tenantId=
   */
  fastify.get('/api/admin/landings', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request.query as any)?.tenantId || DEFAULT_TENANT_ID;
    try {
      const landings = await prisma.landingPage.findMany({
        where: { tenant_id: tenantId },
        orderBy: { created_at: 'desc' },
      });
      return reply.status(200).send({ success: true, data: landings.map(toLandingListItem) });
    } catch (err: any) {
      console.warn(`[LANDINGS LIST FALLBACK] DB offline, pakai in-memory:`, err.message);
      const items = Array.from(memoryLandings.values()).filter((l) => l.tenant_id === tenantId);
      return reply.status(200).send({ success: true, data: items.map(toLandingListItem) });
    }
  });

  /**
   * GET /api/admin/landings/:id
   */
  fastify.get(
    '/api/admin/landings/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      try {
        const l = await prisma.landingPage.findUnique({ where: { id } });
        if (!l) return reply.status(404).send({ error: `Landing page '${id}' tidak ditemukan.` });
        return reply.status(200).send({
          success: true,
          data: {
            ...toLandingListItem(l),
            rawHtmlContent: l.html_content || '',
            metaPixelId: l.meta_pixel_id || '',
          },
        });
      } catch (err: any) {
        console.warn(`[LANDING GET FALLBACK] DB offline:`, err.message);
        const l = memoryLandings.get(id);
        if (!l) return reply.status(200).send({ success: true, data: null });
        return reply.status(200).send({
          success: true,
          data: { ...toLandingListItem(l), rawHtmlContent: l.html_content || '', metaPixelId: l.meta_pixel_id || '' },
        });
      }
    }
  );

  /**
   * POST /api/admin/landings
   */
  fastify.post('/api/admin/landings', async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
    const body = (request.body || {}) as any;
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
    const html = typeof body.html === 'string' ? body.html : '';

    const slugError = validateLandingSlug(slug);
    if (slugError) return reply.status(400).send({ error: slugError });
    if (!title) return reply.status(400).send({ error: 'Field title wajib diisi.' });

    let landingType: any = 'STRUCTURED_JSON';
    let sanitizedHtml: string | null = null;
    if (html && html.trim()) {
      try {
        const { TenantHtmlService } = await import('../../services/tenant-html.service');
        sanitizedHtml = TenantHtmlService.validateAndSanitize(html);
      } catch (validationError: any) {
        return reply.status(400).send({ error: validationError.message });
      }
      landingType = 'RAW_HTML';
    }

    try {
      const existing = await prisma.landingPage.findFirst({ where: { slug } });
      if (existing) return reply.status(409).send({ error: `Slug '${slug}' sudah dipakai landing page lain.` });
    } catch (err: any) {
      console.warn(`[LANDING CREATE] Unique check skipped (DB offline?):`, err.message);
    }

    const events = normalizeLandingEvents(body.events);

    try {
      const created = await prisma.landingPage.create({
        data: {
          tenant_id: DEFAULT_TENANT_ID,
          slug,
          title,
          landing_type: landingType,
          html_content: sanitizedHtml,
          events,
          meta_pixel_id: normalizeNullableString(body.metaPixelId),
          whatsapp_number: normalizeNullableString(body.whatsappNumber),
          is_active: body.isActive !== false,
        },
      });

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'LANDING_PAGE_CREATE',
        targetId: created.id,
        payload: { slug, title, landingType, events },
        ipAddress: request.ip,
      });
      await purgeLandingCache(slug);

      return reply
        .status(200)
        .send({ success: true, message: 'Landing page berhasil dibuat.', data: toLandingListItem(created) });
    } catch (err: any) {
      const id = `lp_${Date.now()}_${Math.random().toString(36).substring(4)}`;
      const record = {
        id,
        tenant_id: DEFAULT_TENANT_ID,
        slug,
        title,
        landing_type: landingType,
        html_content: sanitizedHtml,
        events,
        meta_pixel_id: normalizeNullableString(body.metaPixelId),
        whatsapp_number: normalizeNullableString(body.whatsappNumber),
        is_active: body.isActive !== false,
        created_at: new Date(),
        updated_at: new Date(),
      };
      memoryLandings.set(id, record);
      await purgeLandingCache(slug);
      return reply.status(200).send({
        success: true,
        message: 'Landing page berhasil dibuat (In-Memory Fallback Mode).',
        data: toLandingListItem(record),
      });
    }
  });

  /**
   * PUT /api/admin/landings/:id
   */
  fastify.put(
    '/api/admin/landings/:id',
    async (request: FastifyRequest<{ Params: { id: string }; Body: any }>, reply: FastifyReply) => {
      const { id } = request.params;
      const body = (request.body || {}) as any;

      try {
        const existing = await prisma.landingPage.findUnique({ where: { id } });
        if (!existing) return reply.status(404).send({ error: `Landing page '${id}' tidak ditemukan.` });

        const title = typeof body.title === 'string' ? body.title.trim() : existing.title;
        const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : existing.slug;

        const slugError = validateLandingSlug(slug);
        if (slugError) return reply.status(400).send({ error: slugError });
        if (!title) return reply.status(400).send({ error: 'Field title wajib diisi.' });

        if (slug !== existing.slug) {
          const dup = await prisma.landingPage.findFirst({ where: { slug, id: { not: id } } });
          if (dup) return reply.status(409).send({ error: `Slug '${slug}' sudah dipakai landing page lain.` });
        }

        let landingType = existing.landing_type;
        let sanitizedHtml = existing.html_content;
        const html = typeof body.html === 'string' ? body.html : null;
        if (html !== null && html.trim()) {
          try {
            const { TenantHtmlService } = await import('../../services/tenant-html.service');
            sanitizedHtml = TenantHtmlService.validateAndSanitize(html);
          } catch (validationError: any) {
            return reply.status(400).send({ error: validationError.message });
          }
          landingType = 'RAW_HTML';
        }

        const events = body.events !== undefined ? normalizeLandingEvents(body.events) : existing.events || [];

        const updated = await prisma.landingPage.update({
          where: { id },
          data: {
            slug,
            title,
            landing_type: landingType,
            html_content: sanitizedHtml,
            events,
            meta_pixel_id: body.metaPixelId !== undefined ? normalizeNullableString(body.metaPixelId) : existing.meta_pixel_id,
            whatsapp_number: body.whatsappNumber !== undefined ? normalizeNullableString(body.whatsappNumber) : existing.whatsapp_number,
            is_active: body.isActive !== undefined ? !!body.isActive : existing.is_active,
          },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'LANDING_PAGE_UPDATE',
          targetId: id,
          payload: { slug, title, landingType, events, isActive: updated.is_active },
          ipAddress: request.ip,
        });
        await purgeLandingCache(slug);
        if (slug !== existing.slug) await purgeLandingCache(existing.slug);

        return reply.status(200).send({
          success: true,
          message: 'Landing page berhasil diperbarui.',
          data: toLandingListItem(updated),
        });
      } catch (err: any) {
        const rec = memoryLandings.get(id);
        if (!rec) return reply.status(404).send({ error: `Landing page '${id}' tidak ditemukan.` });

        const title = typeof body.title === 'string' ? body.title.trim() : rec.title;
        const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : rec.slug;
        const slugError = validateLandingSlug(slug);
        if (slugError) return reply.status(400).send({ error: slugError });
        if (!title) return reply.status(400).send({ error: 'Field title wajib diisi.' });

        const html = typeof body.html === 'string' && body.html.trim() ? body.html : null;
        let sanitizedHtml = rec.html_content;
        let landingType = rec.landing_type;
        if (html) {
          const { TenantHtmlService } = await import('../../services/tenant-html.service');
          sanitizedHtml = TenantHtmlService.validateAndSanitize(html);
          landingType = 'RAW_HTML';
        }

        rec.slug = slug;
        rec.title = title;
        rec.landing_type = landingType;
        rec.html_content = sanitizedHtml;
        rec.events = body.events !== undefined ? normalizeLandingEvents(body.events) : rec.events || [];
        rec.meta_pixel_id = body.metaPixelId !== undefined ? normalizeNullableString(body.metaPixelId) : rec.meta_pixel_id;
        rec.whatsapp_number = body.whatsappNumber !== undefined ? normalizeNullableString(body.whatsappNumber) : rec.whatsapp_number;
        rec.is_active = body.isActive !== undefined ? !!body.isActive : rec.is_active;
        rec.updated_at = new Date();
        memoryLandings.set(id, rec);
        await purgeLandingCache(slug);

        return reply.status(200).send({
          success: true,
          message: 'Landing page berhasil diperbarui (In-Memory Fallback Mode).',
          data: toLandingListItem(rec),
        });
      }
    }
  );

  /**
   * DELETE /api/admin/landings/:id
   */
  fastify.delete(
    '/api/admin/landings/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      try {
        const existing = await prisma.landingPage.findUnique({ where: { id } });
        if (!existing) return reply.status(404).send({ error: `Landing page '${id}' tidak ditemukan.` });

        await prisma.landingPage.delete({ where: { id } });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'LANDING_PAGE_DELETE',
          targetId: id,
          payload: { slug: existing.slug, title: existing.title },
          ipAddress: request.ip,
        });
        await purgeLandingCache(existing.slug);

        return reply.status(200).send({ success: true, message: 'Landing page berhasil dihapus.' });
      } catch (err: any) {
        const rec = memoryLandings.get(id);
        if (!rec) return reply.status(404).send({ error: `Landing page '${id}' tidak ditemukan.` });
        memoryLandings.delete(id);
        await purgeLandingCache(rec.slug);
        return reply
          .status(200)
          .send({ success: true, message: 'Landing page berhasil dihapus (In-Memory Fallback Mode).' });
      }
    }
  );
}
