import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { auditService } from '../../services/audit.service';
import {
  matchInboundText,
  invalidateCtwaCatcherCache,
} from '../../services/ctwa-text-catcher.service';

/**
 * CTWA Greeting Catcher admin API (tenant-scoped).
 *
 * Mengelola kampanye pencocokan kalimat pembuka iklan Click-to-WhatsApp
 * (`ctwa_campaign_catchers`) + dry-run simulator. Degrade-silent: DB offline →
 * GET mengembalikan daftar kosong + dbNote; mutasi mengembalikan 503.
 */

const THRESHOLD_MIN = 0.5;
const THRESHOLD_MAX = 0.95;
const MAX_GREETINGS = 20;
const MAX_GREETING_CHARS = 300;
const MAX_CAMPAIGN_CHARS = 200;

interface CatcherPayload {
  campaign_name: string;
  source: string;
  medium: string;
  greetings: string[];
  anchor_keywords: string[];
  similarity_threshold: number;
  is_active: boolean;
  notes: string | null;
}

function resolveTenant(request: FastifyRequest): string {
  return (
    (request as any).tenantId ||
    (request as any).staffTenantId ||
    DEFAULT_TENANT_ID
  );
}

function validatePayload(
  body: any,
  { partial = false }: { partial?: boolean } = {}
): { ok: true; value: Partial<CatcherPayload> } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Body wajib berupa JSON.' };
  const value: Partial<CatcherPayload> = {};

  if (body.campaign_name !== undefined || !partial) {
    const name = typeof body.campaign_name === 'string' ? body.campaign_name.trim() : '';
    if (name.length < 2 || name.length > MAX_CAMPAIGN_CHARS) {
      return { ok: false, error: `Nama kampanye wajib 2–${MAX_CAMPAIGN_CHARS} karakter.` };
    }
    value.campaign_name = name;
  }

  if (body.greetings !== undefined || !partial) {
    if (!Array.isArray(body.greetings)) return { ok: false, error: 'greetings wajib berupa array.' };
    const greetings = body.greetings
      .filter((g: unknown): g is string => typeof g === 'string')
      .map((g: string) => g.trim())
      .filter((g: string) => g.length > 0);
    if (greetings.length < 1) return { ok: false, error: 'Minimal 1 template sapaan wajib diisi.' };
    if (greetings.length > MAX_GREETINGS) return { ok: false, error: `Maksimal ${MAX_GREETINGS} template sapaan.` };
    if (greetings.some((g: string) => g.length > MAX_GREETING_CHARS)) {
      return { ok: false, error: `Tiap template sapaan maksimal ${MAX_GREETING_CHARS} karakter.` };
    }
    value.greetings = greetings;
  }

  if (body.anchor_keywords !== undefined) {
    if (!Array.isArray(body.anchor_keywords)) return { ok: false, error: 'anchor_keywords wajib berupa array.' };
    value.anchor_keywords = body.anchor_keywords
      .filter((k: unknown): k is string => typeof k === 'string')
      .map((k: string) => k.trim())
      .filter((k: string) => k.length > 0);
  }

  if (body.similarity_threshold !== undefined) {
    const n = Number(body.similarity_threshold);
    if (!Number.isFinite(n) || n < THRESHOLD_MIN || n > THRESHOLD_MAX) {
      return { ok: false, error: `similarity_threshold wajib angka ${THRESHOLD_MIN}–${THRESHOLD_MAX}.` };
    }
    value.similarity_threshold = n;
  }

  if (body.source !== undefined) {
    const s = typeof body.source === 'string' ? body.source.trim() : '';
    if (!s || s.length > 32) return { ok: false, error: 'source wajib string 1–32 karakter.' };
    value.source = s;
  }

  if (body.medium !== undefined) {
    const m = typeof body.medium === 'string' ? body.medium.trim() : '';
    if (!m || m.length > 32) return { ok: false, error: 'medium wajib string 1–32 karakter.' };
    value.medium = m;
  }

  if (body.is_active !== undefined) {
    value.is_active = Boolean(body.is_active);
  }

  if (body.notes !== undefined) {
    value.notes = body.notes === null ? null : String(body.notes).slice(0, 1000);
  }

  return { ok: true, value };
}

export async function ctwaCatchersAdminRoutes(fastify: FastifyInstance) {
  // GET /api/admin/ctwa-catchers — daftar kampanye catcher (tenant-scoped).
  fastify.get('/api/admin/ctwa-catchers', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = resolveTenant(request);
    try {
      const rows = await prisma.ctwaCampaignCatcher.findMany({
        where: { tenant_id: tenantId },
        orderBy: { created_at: 'asc' },
      });
      return reply.status(200).send({ success: true, data: rows });
    } catch (err: any) {
      return reply.status(200).send({
        success: true,
        data: [],
        dbNote: `DB offline: ${String(err?.message || err).slice(0, 160)}`,
      });
    }
  });

  // POST /api/admin/ctwa-catchers — tambah kampanye baru.
  fastify.post('/api/admin/ctwa-catchers', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = resolveTenant(request);
    const validated = validatePayload(request.body || {});
    if (!validated.ok) return reply.status(400).send({ success: false, error: validated.error });
    const v = validated.value;

    try {
      const created = await prisma.ctwaCampaignCatcher.create({
        data: {
          tenant_id: tenantId,
          campaign_name: v.campaign_name!,
          source: v.source || 'instagram',
          medium: v.medium || 'ctwa',
          greetings: v.greetings!,
          anchor_keywords: v.anchor_keywords || [],
          similarity_threshold: v.similarity_threshold ?? 0.7,
          is_active: v.is_active ?? true,
          notes: v.notes ?? null,
        },
      });
      invalidateCtwaCatcherCache(tenantId);
      await auditService
        .logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'CREATE_CTWA_CATCHER',
          targetId: (created as any).id,
          payload: { campaign_name: v.campaign_name },
          ipAddress: request.ip,
        })
        .catch(() => {});
      return reply.status(201).send({ success: true, data: created });
    } catch (err: any) {
      return reply.status(503).send({ success: false, error: `DB tidak tersedia: ${String(err?.message || err).slice(0, 160)}` });
    }
  });

  // PUT /api/admin/ctwa-catchers/:id — ubah konfigurasi kampanye.
  fastify.put(
    '/api/admin/ctwa-catchers/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = resolveTenant(request);
      const { id } = request.params;
      const validated = validatePayload(request.body || {}, { partial: true });
      if (!validated.ok) return reply.status(400).send({ success: false, error: validated.error });

      try {
        const existing = await prisma.ctwaCampaignCatcher.findUnique({ where: { id } });
        if (!existing || (existing as any).tenant_id !== tenantId) {
          return reply.status(404).send({ success: false, error: 'Kampanye catcher tidak ditemukan.' });
        }
        const updated = await prisma.ctwaCampaignCatcher.update({
          where: { id },
          data: validated.value as any,
        });
        invalidateCtwaCatcherCache(tenantId);
        await auditService
          .logAdminAction({
            apiKey: (request as any).adminKeyUsed,
            adminIdentity: (request as any).adminIdentity,
            action: 'UPDATE_CTWA_CATCHER',
            targetId: id,
            payload: validated.value,
            ipAddress: request.ip,
          })
          .catch(() => {});
        return reply.status(200).send({ success: true, data: updated });
      } catch (err: any) {
        return reply.status(503).send({ success: false, error: `DB tidak tersedia: ${String(err?.message || err).slice(0, 160)}` });
      }
    }
  );

  // DELETE /api/admin/ctwa-catchers/:id — hapus kampanye.
  fastify.delete(
    '/api/admin/ctwa-catchers/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = resolveTenant(request);
      const { id } = request.params;
      try {
        const existing = await prisma.ctwaCampaignCatcher.findUnique({ where: { id } });
        if (!existing || (existing as any).tenant_id !== tenantId) {
          return reply.status(404).send({ success: false, error: 'Kampanye catcher tidak ditemukan.' });
        }
        await prisma.ctwaCampaignCatcher.delete({ where: { id } });
        invalidateCtwaCatcherCache(tenantId);
        await auditService
          .logAdminAction({
            apiKey: (request as any).adminKeyUsed,
            adminIdentity: (request as any).adminIdentity,
            action: 'DELETE_CTWA_CATCHER',
            targetId: id,
            payload: null,
            ipAddress: request.ip,
          })
          .catch(() => {});
        return reply.status(200).send({ success: true, data: { id } });
      } catch (err: any) {
        return reply.status(503).send({ success: false, error: `DB tidak tersedia: ${String(err?.message || err).slice(0, 160)}` });
      }
    }
  );

  // POST /api/admin/ctwa-catchers/test — dry-run simulator (read-only, tidak menulis DB).
  fastify.post(
    '/api/admin/ctwa-catchers/test',
    async (request: FastifyRequest<{ Body: { text?: string } }>, reply: FastifyReply) => {
      const tenantId = resolveTenant(request);
      const text = typeof request.body?.text === 'string' ? request.body.text : '';
      if (!text.trim()) {
        return reply.status(400).send({ success: false, error: 'Teks uji wajib diisi.' });
      }
      try {
        const result = await matchInboundText(text, tenantId);
        if (!result) {
          return reply.status(200).send({
            success: true,
            data: {
              matched: false,
              bestMatch: null,
              similarityScore: 0,
              effectiveScore: 0,
              anchorCheckPassed: false,
              anchorBypassed: false,
              diagnostics: [],
            },
          });
        }
        return reply.status(200).send({
          success: true,
          data: {
            matched: result.matched,
            bestMatch: result.catcherId
              ? {
                  catcherId: result.catcherId,
                  campaignName: result.campaignName,
                  source: result.source,
                  medium: result.medium,
                  templateIndex: result.templateIndex,
                }
              : null,
            similarityScore: result.similarityScore,
            effectiveScore: result.effectiveScore,
            anchorCheckPassed: result.anchorCheckPassed,
            anchorBypassed: result.anchorBypassed,
            diagnostics: result.diagnostics,
          },
        });
      } catch (err: any) {
        return reply.status(200).send({
          success: true,
          data: { matched: false, bestMatch: null, similarityScore: 0, effectiveScore: 0, anchorCheckPassed: false, anchorBypassed: false, diagnostics: [], dbNote: String(err?.message || err).slice(0, 160) },
        });
      }
    }
  );
}
