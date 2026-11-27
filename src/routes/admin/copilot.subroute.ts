import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { isCopilotTenantAllowed, COPILOT_DEPRECATED_ERROR } from '../../config/copilot-tenant';
import { auditService } from '../../services/audit.service';
import { copilotService, resolveCopilotConfig } from '../../services/copilot/copilot.service';
import { resolveSessionTenantId } from './route-helpers';
import { checkCopilotQuota, copilotPrincipalKey } from '../../services/copilot/copilot-quota';
import {
  assertCopilotDailyBudget,
  estimateTurnTokens,
  recordCopilotTokens,
} from '../../services/copilot/copilot-budget';

/**
 * Semaphore konkurensi Copilot per-tenant (in-memory).
 * Menjamin maksimal 1 turn Copilot berjalan bersamaan per tenant,
 * mencegah lonjakan biaya LLM dan kelebihan beban database.
 */
const activeTenantTurns = new Map<string, boolean>();
/** TTL fail-safe: turn tanpa pelepasan tidak boleh mengunci tenant selamanya. */
const activeTenantSince = new Map<string, number>();
const TURN_LOCK_TTL_MS = 330_000;

export function isCopilotBusy(tenantId: string): boolean {
  if (activeTenantTurns.get(tenantId) !== true) return false;
  const since = activeTenantSince.get(tenantId) || 0;
  if (since && Date.now() - since > TURN_LOCK_TTL_MS) {
    activeTenantTurns.delete(tenantId);
    activeTenantSince.delete(tenantId);
    return false;
  }
  return true;
}

export function releaseCopilotTurn(tenantId: string): void {
  activeTenantTurns.delete(tenantId);
  activeTenantSince.delete(tenantId);
}

const COPILOT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const MAX_HISTORY_TURNS = 10;
const MAX_HISTORY_CONTENT = 4000;

type ParsedCopilotBody =
  | { ok: true; message: string; history: Array<{ role: 'user' | 'assistant'; content: string }>; activeContext?: { conversationId?: string; customerId?: string } }
  | { ok: false; error: string };

/**
 * Kontrak body runtime (T6.1): role history hanya user/assistant dan content
 * dibatasi. Role `system` kiriman klien DILARANG masuk ke transcript provider.
 */
function parseCopilotBody(body: any): ParsedCopilotBody {
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message) return { ok: false, error: 'message wajib diisi.' };
  if (message.length > 2000) return { ok: false, error: 'message maksimal 2000 karakter.' };

  const rawHistory = body?.history;
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  if (rawHistory !== undefined) {
    if (!Array.isArray(rawHistory)) return { ok: false, error: 'history harus berupa array.' };
    if (rawHistory.length > MAX_HISTORY_TURNS) {
      return { ok: false, error: `history maksimal ${MAX_HISTORY_TURNS} pesan.` };
    }
    for (const h of rawHistory) {
      if (!h || typeof h !== 'object') return { ok: false, error: 'history berisi entri tidak valid.' };
      const role = (h as any).role;
      const content = (h as any).content;
      if (role !== 'user' && role !== 'assistant') {
        return { ok: false, error: 'history.role hanya boleh user atau assistant.' };
      }
      if (typeof content !== 'string' || !content.trim()) {
        return { ok: false, error: 'history.content wajib berupa teks tidak kosong.' };
      }
      if (content.length > MAX_HISTORY_CONTENT) {
        return { ok: false, error: `history.content maksimal ${MAX_HISTORY_CONTENT} karakter.` };
      }
      history.push({ role, content });
    }
  }

  const conversationId = typeof body?.conversationId === 'string' ? body.conversationId.trim() : '';
  const customerId = typeof body?.customerId === 'string' ? body.customerId.trim() : '';
  if (conversationId && !COPILOT_ID_RE.test(conversationId)) {
    return { ok: false, error: 'conversationId tidak valid.' };
  }
  if (customerId && !COPILOT_ID_RE.test(customerId)) {
    return { ok: false, error: 'customerId tidak valid.' };
  }
  const activeContext =
    conversationId || customerId
      ? { conversationId: conversationId || undefined, customerId: customerId || undefined }
      : undefined;

  return { ok: true, message, history, activeContext };
}

/**
 * copilot.subroute.ts (Fase 6r + GLM-5.3 2026-11-03) — endpoint AI Clinic Copilot.
 * Auth admin + tenant-scope + kuota 6/menit per principal + SSE heartbeat 15s + single turn lock + audit.
 */
export async function copilotAdminRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/admin/copilot/chat
   * Body: { message: string, history?: Array<{role, content}> }
   */
  fastify.post(
    '/api/admin/copilot/chat',
    // Kuota 6/menit dikelola `checkCopilotQuota` (bucket per principal), bukan
    // limiter global yang memakai bucket API-key bersama — limiter bersama akan
    // menolak staf lain hanya karena satu staf sudah memakai kuotanya.
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
      const parsed = parseCopilotBody(request.body);
      if (!parsed.ok) {
        return reply.status(400).send({ success: false, error: parsed.error });
      }
      const { message, history, activeContext } = parsed;

      const quota = checkCopilotQuota(copilotPrincipalKey(request));
      if (!quota.allowed) {
        return reply
          .status(429)
          .header('Retry-After', String(quota.retryAfterSec))
          .send({ success: false, error: 'Kuota Copilot per menit habis. Coba lagi sebentar.', code: 'COPILOT_QUOTA_EXCEEDED' });
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

      // Anggaran token harian per tenant (G9).
      const budget = await assertCopilotDailyBudget(tenantId, estimateTurnTokens(message, history));
      if (!budget.allowed) {
        return reply.status(429).send({
          success: false,
          error: `Kuota token Copilot harian tenant habis (${budget.used}/${budget.limit}).`,
          code: 'COPILOT_DAILY_BUDGET_EXCEEDED',
        });
      }

      // Gerbang konkurensi per-tenant: maks 1 turn aktif
      if (isCopilotBusy(tenantId)) {
        return reply.status(429).send({
          success: false,
          error: 'Copilot sedang memproses pertanyaan sebelumnya. Mohon tunggu giliran selesai.',
          code: 'COPILOT_BUSY',
        });
      }
      const startedAt = Date.now();
      const cop = resolveCopilotConfig();
      activeTenantTurns.set(tenantId, true);
      activeTenantSince.set(tenantId, startedAt);

      // Batalkan panggilan LLM bila klien menutup koneksi (non-SSE juga).
      // `reply.raw` dipakai (bukan request.raw) karena request 'close' bisa
      // sudah/akan segera menyala setelah body selesai dibaca — bukan sinyal
      // klien pergi. `writableEnded` membedakan respons selesai normal.
      const abortCtrl = new AbortController();
      const onClose = () => {
        if (!reply.raw.writableEnded) abortCtrl.abort();
      };
      reply.raw.once('close', onClose);

      try {
        const result = await copilotService.chat({
          tenantId,
          message,
          history,
          activeContext,
          signal: abortCtrl.signal,
        });
        recordCopilotTokens(tenantId, result.tokensUsed || 0);

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
            tokensUsed: result.tokensUsed || 0,
            elapsedMs: Date.now() - startedAt,
            budgetMs: cop.totalBudgetMs,
          },
          ipAddress: request.ip,
          tenantId,
        });

        return reply.status(200).send({ success: result.success, data: result });
      } finally {
        reply.raw.removeListener('close', onClose);
        releaseCopilotTurn(tenantId);
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
    // Sama seperti /chat: kuota per principal, bukan bucket API-key bersama.
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
      const parsed = parseCopilotBody(request.body);
      if (!parsed.ok) {
        return reply.status(400).send({ success: false, error: parsed.error });
      }
      const { message, history, activeContext } = parsed;

      const quota = checkCopilotQuota(copilotPrincipalKey(request));
      if (!quota.allowed) {
        return reply
          .status(429)
          .header('Retry-After', String(quota.retryAfterSec))
          .send({ success: false, error: 'Kuota Copilot per menit habis. Coba lagi sebentar.', code: 'COPILOT_QUOTA_EXCEEDED' });
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

      const budget = await assertCopilotDailyBudget(tenantId, estimateTurnTokens(message, history));
      if (!budget.allowed) {
        return reply.status(429).send({
          success: false,
          error: `Kuota token Copilot harian tenant habis (${budget.used}/${budget.limit}).`,
          code: 'COPILOT_DAILY_BUDGET_EXCEEDED',
        });
      }

      // Gerbang konkurensi per-tenant: jika turn sedang aktif, tolak langsung sebelum hijack SSE
      if (isCopilotBusy(tenantId)) {
        return reply.status(429).send({
          success: false,
          error: 'Copilot sedang memproses pertanyaan sebelumnya. Mohon tunggu giliran selesai.',
          code: 'COPILOT_BUSY',
        });
      }
      const startedAt = Date.now();
      const cop = resolveCopilotConfig();
      activeTenantTurns.set(tenantId, true);
      activeTenantSince.set(tenantId, startedAt);

      try {
        reply.hijack();
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform, no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
      } catch (err) {
        // Jangan pernah menyisakan semaphore terkunci bila hijack gagal.
        releaseCopilotTurn(tenantId);
        throw err;
      }

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

        recordCopilotTokens(tenantId, result.tokensUsed || 0);

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
            tokensUsed: result.tokensUsed || 0,
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
        releaseCopilotTurn(tenantId);
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
