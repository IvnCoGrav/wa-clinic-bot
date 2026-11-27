import { parsePositiveInt } from '../../utils/env-numeric';
import { wibDayBoundsUtc } from '../../utils/wib-time';

/**
 * Plafon biaya token Copilot (G9): 20k token per turn, 500k token/hari/tenant.
 * Angka dapat dioverride via env; akuntansi harian memakai llm_audit_logs dan
 * fallback in-memory jika DB offline.
 *
 * Cakupan sengaja HANYA `task_type = AI_COPILOT_CHAT`: bila agregat memakai
 * seluruh trafik LLM tenant, lonjakan chat WhatsApp akan memblokir Copilot
 * (dua fitur berbeda dengan pemilik anggaran berbeda).
 */
const DEFAULT_MAX_TOKENS_PER_TURN = 20_000;
const DEFAULT_MAX_TOKENS_PER_DAY = 500_000;
const COPILOT_AUDIT_TASK_TYPE = 'AI_COPILOT_CHAT';

const memoryUsage = new Map<string, { day: string; tokens: number }>();
const CACHE_TTL_MS = 30_000;
let cached: { key: string; at: number; tokens: number } | null = null;

function wibDayKey(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function maxTokensPerTurn(): number {
  return parsePositiveInt(process.env.COPILOT_MAX_TOKENS_PER_TURN, DEFAULT_MAX_TOKENS_PER_TURN);
}

export function maxTokensPerDay(): number {
  return parsePositiveInt(process.env.COPILOT_MAX_TOKENS_PER_DAY, DEFAULT_MAX_TOKENS_PER_DAY);
}

export async function getCopilotDailyTokensUsed(tenantId: string): Promise<number> {
  const day = wibDayKey();
  const cacheKey = `${tenantId}:${day}`;
  if (cached && cached.key === cacheKey && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.tokens;
  }

  let dbTokens = 0;
  try {
    const { prisma } = await import('../../db/client');
    const bounds = wibDayBoundsUtc(0);
    const agg = await (prisma as any).llmAuditLog?.aggregate?.({
      _sum: { prompt_tokens: true, completion_tokens: true },
      where: {
        tenant_id: tenantId,
        task_type: COPILOT_AUDIT_TASK_TYPE,
        created_at: { gte: bounds.start, lte: bounds.end },
      },
    });
    dbTokens = Number(agg?._sum?.prompt_tokens || 0) + Number(agg?._sum?.completion_tokens || 0);
  } catch {
    dbTokens = 0;
  }

  // llm_audit_logs ditulis lewat buffer (flush tiap 10 detik / 20 baris), jadi
  // DB bisa tertinggal dari pemakaian nyata. Ambil nilai TERBESAR antara DB dan
  // catatan proses ini agar burst dalam satu window flush tidak lolos anggaran,
  // tanpa risiko menghitung ganda baris yang sudah ter-flush.
  const memoryTokens = memoryUsage.get(cacheKey)?.tokens || 0;
  const tokens = Math.max(dbTokens, memoryTokens);

  cached = { key: cacheKey, at: Date.now(), tokens };
  return tokens;
}

export async function assertCopilotDailyBudget(
  tenantId: string,
  estimatedTokens: number
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limit = maxTokensPerDay();
  const used = await getCopilotDailyTokensUsed(tenantId);
  return { allowed: used + Math.max(0, estimatedTokens) <= limit, used, limit };
}

export function estimateTurnTokens(message: string, history?: Array<{ content: string }>): number {
  const chars = String(message || '').length + (history || []).reduce((sum, h) => sum + String(h.content || '').length, 0);
  return Math.ceil(chars / 4) + 2_000; // output/rounding overhead
}

export function recordCopilotTokens(tenantId: string, tokens: number): void {
  if (!Number.isFinite(tokens) || tokens <= 0) return;
  const key = `${tenantId}:${wibDayKey()}`;
  const prev = memoryUsage.get(key);
  memoryUsage.set(key, { day: wibDayKey(), tokens: (prev?.tokens || 0) + Math.round(tokens) });
  cached = null;
}

export function resetCopilotBudgetCache(): void {
  memoryUsage.clear();
  cached = null;
}
