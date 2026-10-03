import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { isCopilotTenantAllowed, COPILOT_DEPRECATED_ERROR } from '../../config/copilot-tenant';
import { auditService } from '../../services/audit.service';
import { copilotService } from '../../services/copilot/copilot.service';

/**
 * copilot.subroute.ts (Fase 6r) — endpoint AI Clinic Copilot.
 * Auth admin + tenant-scope + rate-limit (global) + audit.
 */
export async function copilotAdminRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/admin/copilot/chat
   * Body: { message: string, history?: Array<{role, content}> }
   */
  fastify.post(
    '/api/admin/copilot/chat',
    {
      // Gerbang kode (bukan klaim komentar): endpoint ini memanggil LLM multi-step
      // (mahal). Batasi per-klien agar tidak bisa membanjiri biaya/kuota.
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
    },
    async (
      request: FastifyRequest<{
        Body: {
          message?: string;
          history?: Array<{ role: 'user' | 'assistant'; content: string }>;
          conversationId?: string;
          customerId?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const { message, history, conversationId, customerId } = request.body || {};

      if (!message || !message.trim()) {
        return reply.status(400).send({ success: false, error: 'message wajib diisi.' });
      }
      if (message.length > 1000) {
        return reply.status(400).send({ success: false, error: 'message maksimal 1000 karakter.' });
      }

      // ADR-001: gerbang single-tenant lapis-1 — tolak tenant non-owner SEBELUM
      // tool/LLM (hemat biaya) + catat audit percobaan akses.
      if (!isCopilotTenantAllowed(tenantId)) {
        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'AI_COPILOT_CHAT',
          targetId: tenantId,
          payload: { message: message.slice(0, 200), blocked: COPILOT_DEPRECATED_ERROR },
          ipAddress: request.ip,
          tenantId,
        });
        return reply.status(403).send({
          success: false,
          error: 'Fitur Copilot tidak tersedia untuk tenant ini.',
          code: COPILOT_DEPRECATED_ERROR,
        });
      }

      // Konteks pasien aktif (opsional) — divalidasi ulang tenant-scoped oleh tool.
      const activeContext =
        conversationId || customerId
          ? { conversationId: conversationId?.trim() || undefined, customerId: customerId?.trim() || undefined }
          : undefined;

      const result = await copilotService.chat({ tenantId, message: message.trim(), history, activeContext });

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'AI_COPILOT_CHAT',
        targetId: tenantId,
        payload: { message: message.slice(0, 200), toolsUsed: result.toolsUsed, grounded: result.grounded, rowCounts: result.rowCounts },
        ipAddress: request.ip,
        tenantId,
      });

      return reply.status(200).send({ success: result.success, data: result });
    }
  );

  /**
   * POST /api/admin/copilot/stream
   *
   * Varian SSE dari `/chat` untuk menghilangkan kesan "freeze". Alasan desain
   * (fondasional, bukan kosmetik):
   * - Memakai POST (BUKAN GET ?q=) agar pertanyaan/nama pasien TIDAK bocor ke URL,
   *   access log, maupun riwayat browser.
   * - Event `tool_start`/`tool_result` berasal dari pipeline nyata (bukan pancingan):
   *   UI menampilkan progres begitu router memutuskan tool.
   * - Grounding TETAP dijaga: jawaban final sudah melewati validator + normalizer
   *   sebelum dikirim sebagai `chunk`. Token mentah model TIDAK dialirkan agar tidak
   *   ada teks halusinasi yang sempat terkirim sebelum divalidasi.
   * - Batas anggaran, tenant-scope, rate-limit, dan audit identik dengan `/chat`.
   */
  fastify.post(
    '/api/admin/copilot/stream',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (
      request: FastifyRequest<{
        Body: {
          message?: string;
          history?: Array<{ role: 'user' | 'assistant'; content: string }>;
          conversationId?: string;
          customerId?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const { message, history, conversationId, customerId } = request.body || {};

      if (!message || !message.trim()) {
        return reply.status(400).send({ success: false, error: 'message wajib diisi.' });
      }
      if (message.length > 1000) {
        return reply.status(400).send({ success: false, error: 'message maksimal 1000 karakter.' });
      }
      if (!isCopilotTenantAllowed(tenantId)) {
        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'AI_COPILOT_CHAT',
          targetId: tenantId,
          payload: { message: message.slice(0, 200), blocked: COPILOT_DEPRECATED_ERROR, stream: true },
          ipAddress: request.ip,
          tenantId,
        });
        return reply.status(403).send({
          success: false,
          error: 'Fitur Copilot tidak tersedia untuk tenant ini.',
          code: COPILOT_DEPRECATED_ERROR,
        });
      }

      const activeContext =
        conversationId || customerId
          ? { conversationId: conversationId?.trim() || undefined, customerId: customerId?.trim() || undefined }
          : undefined;

      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform, no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      let closed = false;
      const cleanup = () => {
        closed = true;
      };
      request.raw.once('close', cleanup);
      reply.raw.once('close', cleanup);

      const sendEvent = (type: string, data: unknown) => {
        if (closed) return;
        try {
          reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
        } catch {
          cleanup();
        }
      };

      try {
        const result = await copilotService.chat({
          tenantId,
          message: message.trim(),
          history,
          activeContext,
          onEvent: (e) => {
            if (e.type === 'tool_start') sendEvent('tool_start', { tool: e.tool });
            else if (e.type === 'tool_result') sendEvent('tool_result', { tool: e.tool, count: e.count });
          },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'AI_COPILOT_CHAT',
          targetId: tenantId,
          payload: { message: message.slice(0, 200), toolsUsed: result.toolsUsed, grounded: result.grounded, rowCounts: result.rowCounts, stream: true },
          ipAddress: request.ip,
          tenantId,
        });

        // Jawaban final SUDAH tervalidasi grounding di service — aman dialirkan.
        sendEvent('chunk', { text: result.answer });
        sendEvent('done', result);
      } catch (err: any) {
        sendEvent('error', { message: err?.message || 'Copilot gagal.' });
        sendEvent('done', { success: false, answer: 'Copilot gagal menjawab.' });
      } finally {
        try {
          reply.raw.end();
        } catch {
          /* koneksi sudah tertutup */
        }
      }
      return reply;
    }
  );
}
