import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { isCopilotTenantAllowed, COPILOT_DEPRECATED_ERROR } from '../../config/copilot-tenant';
import { auditService } from '../../services/audit.service';
import { copilotService, resolveCopilotConfig } from '../../services/copilot/copilot.service';
import { resolveSessionTenantId } from './route-helpers';

/**
 * Semaphore konkurensi Copilot per-tenant (in-memory).
 * Menjamin maksimal 1 turn Copilot berjalan bersamaan per tenant,
 * mencegah lonjakan biaya LLM dan kelebihan beban database.
 */
const activeTenantTurns = new Map<string, boolean>();

export function isCopilotBusy(tenantId: string): boolean {
  return activeTenantTurns.get(tenantId) === true;
}

export function releaseCopilotTurn(tenantId: string): void {
  activeTenantTurns.delete(tenantId);
}

/**
 * copilot.subroute.ts (Fase 6r + GLM-5.3 2026-11-03) — endpoint AI Clinic Copilot.
 * Auth admin + tenant-scope + rate-limit 6/min + SSE heartbeat 15s + single turn lock + audit.
 */
export async function copilotAdminRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/admin/copilot/chat
   * Body: { message: string, history?: Array<{role, content}> }
   */
  fastify.post(
    '/api/admin/copilot/chat',
    {
      // Gerbang kode: batasi 6 per menit agar tidak membanjiri kuota LLM & anggaran.
      config: {
        rateLimit: {
          max: 6,
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
      const tenantId = resolveSessionTenantId(request);
      const { message, history, conversationId, customerId } = request.body || {};

      if (!message || !message.trim()) {
        return reply.status(400).send({ success: false, error: 'message wajib diisi.' });
      }
      if (message.length > 2000) {
        return reply.status(400).send({ success: false, error: 'message maksimal 2000 karakter.' });
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

      // Gerbang konkurensi per-tenant: maks 1 turn aktif
      if (activeTenantTurns.get(tenantId)) {
        return reply.status(429).send({
          success: false,
          error: 'Copilot sedang memproses pertanyaan sebelumnya. Mohon tunggu giliran selesai.',
          code: 'COPILOT_BUSY',
        });
      }
      const startedAt = Date.now();
      const cop = resolveCopilotConfig();
      activeTenantTurns.set(tenantId, true);

      try {
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
          payload: {
            message: message.slice(0, 200),
            toolsUsed: result.toolsUsed,
            grounded: result.grounded,
            rowCounts: result.rowCounts,
            engine: result.engine,
            model: cop.model,
            llmCalls: result.llmCalls,
            elapsedMs: Date.now() - startedAt,
            budgetMs: cop.totalBudgetMs,
          },
          ipAddress: request.ip,
          tenantId,
        });

        return reply.status(200).send({ success: result.success, data: result });
      } finally {
        activeTenantTurns.delete(tenantId);
      }
    }
  );

  /**
   * POST /api/admin/copilot/stream
   *
   * Varian SSE dari `/chat` untuk visual progress & heartbeat real-time.
   */
  fastify.post(
    '/api/admin/copilot/stream',
    {
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
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
      const tenantId = resolveSessionTenantId(request);
      const { message, history, conversationId, customerId } = request.body || {};

      if (!message || !message.trim()) {
        return reply.status(400).send({ success: false, error: 'message wajib diisi.' });
      }
      if (message.length > 2000) {
        return reply.status(400).send({ success: false, error: 'message maksimal 2000 karakter.' });
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

      // Gerbang konkurensi per-tenant: jika turn sedang aktif, tolak langsung sebelum hijack SSE
      if (activeTenantTurns.get(tenantId)) {
        return reply.status(429).send({
          success: false,
          error: 'Copilot sedang memproses pertanyaan sebelumnya. Mohon tunggu giliran selesai.',
          code: 'COPILOT_BUSY',
        });
      }
      const startedAt = Date.now();
      const cop = resolveCopilotConfig();
      activeTenantTurns.set(tenantId, true);

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
      let aborted = false;
      // Pembatalan nyata: saat klien menutup SSE (tombol Batal / tab ditutup),
      // request LLM dihentikan sehingga semaphore cepat dilepas (bukan menunggu 5 menit).
      const abortCtrl = new AbortController();

      // Heartbeat SSE tiap 15s (komentar ':' menjaga koneksi tetap hidup melewati Caddy/browser)
      const hb = setInterval(() => {
        if (closed) return;
        try {
          reply.raw.write(': keepalive\n\n');
        } catch {
          cleanup();
        }
      }, cop.heartbeatMs);

      const cleanup = () => {
        if (!closed) {
          aborted = true;
        }
        closed = true;
        clearInterval(hb);
        // Hentikan panggilan LLM yang masih berjalan (hemat biaya + lepas semaphore).
        try {
          abortCtrl.abort();
        } catch {
          /* sudah abort */
        }
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
          signal: abortCtrl.signal,
          onEvent: (e) => {
            if (e.type === 'stage') {
              sendEvent('stage', e);
            } else if (e.type === 'tool_start') {
              sendEvent('tool_start', { tool: e.tool });
            } else if (e.type === 'tool_result') {
              sendEvent('tool_result', { tool: e.tool, count: e.count });
            }
          },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'AI_COPILOT_CHAT',
          targetId: tenantId,
          payload: {
            message: message.slice(0, 200),
            toolsUsed: result.toolsUsed,
            grounded: result.grounded,
            rowCounts: result.rowCounts,
            stream: true,
            aborted,
            engine: result.engine,
            model: cop.model,
            llmCalls: result.llmCalls,
            elapsedMs: Date.now() - startedAt,
            budgetMs: cop.totalBudgetMs,
          },
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
        clearInterval(hb);
        activeTenantTurns.delete(tenantId);
        try {
          if (!reply.raw.writableEnded) {
            reply.raw.end();
          }
        } catch {
          /* koneksi sudah tertutup */
        }
      }
      return reply;
    }
  );
}
