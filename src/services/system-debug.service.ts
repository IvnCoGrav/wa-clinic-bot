import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { getLogBuffer, getLogBufferStats, isLogBufferInstalled, LogLevel } from '../utils/log-buffer';

/**
 * System Debug Service — mengumpulkan data observability untuk halaman Debug:
 * info sistem, feature flags (tanpa secret), ringkasan AI Router, trace pesan,
 * dan trace state machine conversation. Semua query DB dibungkus try/catch —
 * kalau DB offline, field diisi null/0 + dbNote, halaman tetap bisa render.
 */

// Env keys yang nilainya TIDAK BOLEH bocor ke UI (dilaporkan hanya kehadirannya).
const SECRET_ENV_KEYS = [
  'ADMIN_API_KEY',
  'LLM_API_KEY',
  'LLM_FALLBACK_API_KEY',
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'WAHA_API_KEY',
  'WAHA_WEBHOOK_SECRET',
  'GOOGLE_MAPS_API_KEY',
  'ORS_API_KEY',
  'DATABASE_URL',
  'POSTGRES_PASSWORD',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'WABA_TOKEN_ENCRYPTION_KEY',
  'WABA_APP_SECRET',
  'FB_CAPI_ACCESS_TOKEN',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_CALENDAR_PRIVATE_KEY',
  'TRACKING_API_KEY',
];

const FEATURE_FLAG_KEYS = [
  { key: 'AI_ROUTER_ENABLED', label: 'AI Router Engine' },
  { key: 'AI_ROUTER_SHADOW_MODE', label: 'AI Router Shadow Mode' },
  { key: 'HUMANIZER_ENABLED', label: 'Humanizer (Typing Simulation)' },
  { key: 'ESCALATE_SCHEDULE_IN_INITIAL', label: 'Eskalasi Jadwal di INITIAL' },
  { key: 'ENABLE_WAHA_HOLD_LABEL', label: 'WAHA Hold Label' },
  { key: 'TERMINAL_APPROVAL_ENABLED', label: 'Terminal Approval (Safety Net)' },
  { key: 'WAHA_MOCK', label: 'WAHA Mock Mode' },
];

export interface SystemInfo {
  process: {
    uptimeSeconds: number;
    uptimeHuman: string;
    nodeVersion: string;
    pid: number;
    memoryMb: { rss: number; heapUsed: number; heapTotal: number };
    platform: string;
  };
  database: { status: 'CONNECTED' | 'FAILED' | 'UNKNOWN'; detail?: string };
  featureFlags: Array<{ key: string; label: string; value: boolean | 'unset' }>;
  secretKeysPresent: string[];
  counts: {
    customers: number | null;
    conversations: number | null;
    messages: number | null;
    reservations: number | null;
    followUps: number | null;
    aiRouterEvaluations: number | null;
  };
  aiRouter: {
    enabled: boolean;
    shadowMode: boolean;
    circuitState: string;
  };
  logBuffer: { installed: boolean; stats: Record<LogLevel, number> };
}

export interface AiRouterSummary {
  days: number;
  since: string;
  allTotal: number;
  mappedTotal: number;
  intentMatch: number;
  escalationMatch: number;
  unmapped: number;
  intentMatchRate: number | null; // persen, null jika mappedTotal=0
  escalationMatchRate: number | null;
  unmappedRate: number | null;
  medicalMismatches: Array<{
    message_text: string;
    llm_intent: string | null;
    legacy_intent: string;
    created_at: string;
  }>;
  recentEvaluations: Array<{
    id: string;
    created_at: string;
    current_state: string;
    message_text: string;
    llm_intent: string | null;
    legacy_intent: string;
    intent_match: boolean;
    escalation_match: boolean;
    llm_used_fallback: boolean;
    mismatch_notes: string | null;
    response_time_ms: number | null;
  }>;
  dbNote?: string;
}

const SECONDS_IN_DAY = 24 * 60 * 60 * 1000;

function flagValue(key: string): boolean | 'unset' {
  const v = process.env[key];
  if (v === undefined || v === '') return 'unset';
  if (v === 'true') return true;
  if (v === 'false') return false;
  return true; // ada nilai non-boolean → dianggap aktif
}

export function humanUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
}

export async function collectSystemInfo(): Promise<SystemInfo> {
  const memory = process.memoryUsage();

  let dbStatus: SystemInfo['database'] = { status: 'UNKNOWN' };
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = { status: 'CONNECTED' };
  } catch (err: any) {
    dbStatus = { status: 'FAILED', detail: err?.message?.slice(0, 200) };
  }

  async function safeCount(fn: () => Promise<number>): Promise<number | null> {
    try {
      return await fn();
    } catch {
      return null;
    }
  }

  const [customers, conversations, messages, reservations, followUps, aiRouterEvaluations] = await Promise.all([
    safeCount(() => prisma.customer.count({ where: { tenant_id: DEFAULT_TENANT_ID } })),
    safeCount(() => prisma.conversation.count({ where: { tenant_id: DEFAULT_TENANT_ID } })),
    safeCount(() => prisma.message.count({ where: { tenant_id: DEFAULT_TENANT_ID } })),
    safeCount(() => prisma.reservation.count({ where: { tenant_id: DEFAULT_TENANT_ID } })),
    safeCount(() => prisma.followUp.count({ where: { tenant_id: DEFAULT_TENANT_ID } })),
    safeCount(() => prisma.aiRouterEvaluation.count({ where: { tenant_id: DEFAULT_TENANT_ID } })),
  ]);

  return {
    process: {
      uptimeSeconds: process.uptime(),
      uptimeHuman: humanUptime(process.uptime()),
      nodeVersion: process.version,
      pid: process.pid,
      memoryMb: {
        rss: Math.round(memory.rss / 1024 / 1024),
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
      },
      platform: `${process.platform}/${process.arch}`,
    },
    database: dbStatus,
    featureFlags: FEATURE_FLAG_KEYS.map(({ key, label }) => ({ key, label, value: flagValue(key) })),
    secretKeysPresent: SECRET_ENV_KEYS.filter((k) => process.env[k] !== undefined && process.env[k] !== ''),
    counts: { customers, conversations, messages, reservations, followUps, aiRouterEvaluations },
    aiRouter: {
      enabled: process.env.AI_ROUTER_ENABLED === 'true',
      shadowMode: process.env.AI_ROUTER_SHADOW_MODE === 'true',
      circuitState: 'CLOSED',
    },
    logBuffer: { installed: isLogBufferInstalled(), stats: getLogBufferStats() },
  };
}

export async function collectAiRouterSummary(days = 7): Promise<AiRouterSummary> {
  const since = new Date(Date.now() - days * SECONDS_IN_DAY);
  const base = { created_at: { gte: since }, tenant_id: DEFAULT_TENANT_ID } as any;

  const out: AiRouterSummary = {
    days,
    since: since.toISOString(),
    allTotal: 0,
    mappedTotal: 0,
    intentMatch: 0,
    escalationMatch: 0,
    unmapped: 0,
    intentMatchRate: null,
    escalationMatchRate: null,
    unmappedRate: null,
    medicalMismatches: [],
    recentEvaluations: [],
  };

  try {
    const [allTotal, mappedTotal, intentMatch, escalationMatch, unmapped, medicalMismatches, recent] = await Promise.all([
      prisma.aiRouterEvaluation.count({ where: base }),
      prisma.aiRouterEvaluation.count({ where: { ...base, legacy_intent: { not: 'UNMAPPED' } } }),
      prisma.aiRouterEvaluation.count({ where: { ...base, legacy_intent: { not: 'UNMAPPED' }, intent_match: true } }),
      prisma.aiRouterEvaluation.count({ where: { ...base, legacy_intent: { not: 'UNMAPPED' }, escalation_match: true } }),
      prisma.aiRouterEvaluation.count({ where: { ...base, legacy_intent: 'UNMAPPED' } }),
      prisma.aiRouterEvaluation.findMany({
        where: {
          ...base,
          escalation_match: false,
          OR: [{ legacy_intent: 'MEDICAL_CONCERN' }, { llm_intent: 'MEDICAL_CONCERN' }],
        },
        select: { message_text: true, llm_intent: true, legacy_intent: true, created_at: true },
        orderBy: { created_at: 'desc' },
        take: 50,
      }),
      prisma.aiRouterEvaluation.findMany({
        where: base,
        orderBy: { created_at: 'desc' },
        take: 25,
      }),
    ]);

    out.allTotal = allTotal;
    out.mappedTotal = mappedTotal;
    out.intentMatch = intentMatch;
    out.escalationMatch = escalationMatch;
    out.unmapped = unmapped;
    out.intentMatchRate = mappedTotal > 0 ? (intentMatch / mappedTotal) * 100 : null;
    out.escalationMatchRate = mappedTotal > 0 ? (escalationMatch / mappedTotal) * 100 : null;
    out.unmappedRate = allTotal > 0 ? (unmapped / allTotal) * 100 : null;
    out.medicalMismatches = medicalMismatches.map((m) => ({ ...m, created_at: m.created_at.toISOString() }));
    out.recentEvaluations = recent.map((r) => ({ ...r, created_at: r.created_at.toISOString() }));
  } catch (err: any) {
    out.dbNote = 'DB offline';
  }

  return out;
}

export interface MessageTraceEntry {
  id: string;
  created_at: string;
  direction: string;
  content: string;
  wa_message_id: string | null;
  delivery_status: string | null;
  meta_error_code: string | null;
  meta_error_desc: string | null;
  meta_pricing_category: string | null;
  customerPhone: string | null;
  customerName: string | null;
}

export async function collectRecentMessages(limit = 50): Promise<{ entries: MessageTraceEntry[]; dbNote?: string }> {
  try {
    const rows = await prisma.message.findMany({
      where: { tenant_id: DEFAULT_TENANT_ID },
      include: { conversation: { include: { customer: true } } },
      orderBy: { created_at: 'desc' },
      take: Math.min(200, Math.max(1, limit)),
    });
    return {
      entries: rows.map((m: any) => ({
        id: m.id,
        created_at: typeof m.created_at === 'string' ? m.created_at : m.created_at.toISOString(),
        direction: m.direction,
        content: (m.content || '').slice(0, 300),
        wa_message_id: m.wa_message_id,
        delivery_status: m.delivery_status ?? null,
        meta_error_code: m.meta_error_code ?? null,
        meta_error_desc: m.meta_error_desc ?? null,
        meta_pricing_category: m.meta_pricing_category ?? null,
        customerPhone: m.conversation?.customer?.phone ?? null,
        customerName: m.conversation?.customer?.name ?? null,
      })),
    };
  } catch (err: any) {
    const { messageService } = await import('./message.service');
    const memoryMessages = messageService.getMemoryMessages() || [];
    const entries: MessageTraceEntry[] = memoryMessages
      .filter((m: any) => !m.tenant_id || m.tenant_id === DEFAULT_TENANT_ID)
      .sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      .slice(0, limit)
      .map((m: any) => ({
        id: m.id || 'mem_' + Math.random(),
        created_at: typeof m.created_at === 'string' ? m.created_at : (m.created_at?.toISOString?.() || new Date().toISOString()),
        direction: m.direction || 'UNKNOWN',
        content: (m.content || '').slice(0, 300),
        wa_message_id: m.wa_message_id ?? null,
        delivery_status: m.delivery_status ?? null,
        meta_error_code: m.meta_error_code ?? null,
        meta_error_desc: m.meta_error_desc ?? null,
        meta_pricing_category: m.meta_pricing_category ?? null,
        customerPhone: m.phone || m.customerPhone || null,
        customerName: m.customerName || null,
      }));

    return { entries, dbNote: 'DB offline (using memory fallback)' };
  }
}

export interface ConversationTraceEntry {
  id: string;
  current_state: string;
  is_human_handling: boolean;
  human_handling_since: string | null;
  escalation_reason: string | null;
  consecutive_unknown_count: number;
  location_attempts: number;
  last_message_at: string;
  last_customer_message_at: string | null;
  is_within_24h_window: boolean;
  customerPhone: string | null;
  customerName: string | null;
}

export async function collectConversationTrace(limit = 50): Promise<{ entries: ConversationTraceEntry[]; dbNote?: string }> {
  try {
    const rows = await prisma.conversation.findMany({
      where: { tenant_id: DEFAULT_TENANT_ID },
      include: { customer: true },
      orderBy: { last_message_at: 'desc' },
      take: Math.min(200, Math.max(1, limit)),
    });
    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();

    return {
      entries: rows.map((c: any) => {
        const lastCustMsgMs = c.last_customer_message_at ? new Date(c.last_customer_message_at).getTime() : null;
        const isWithin24h = lastCustMsgMs !== null ? (now - lastCustMsgMs) <= TWENTY_FOUR_HOURS_MS : false;

        return {
          id: c.id,
          current_state: c.current_state,
          is_human_handling: c.is_human_handling,
          human_handling_since: c.human_handling_since ? (typeof c.human_handling_since === 'string' ? c.human_handling_since : c.human_handling_since.toISOString()) : null,
          escalation_reason: c.escalation_reason,
          consecutive_unknown_count: c.consecutive_unknown_count ?? 0,
          location_attempts: c.location_attempts ?? 0,
          last_message_at: typeof c.last_message_at === 'string' ? c.last_message_at : c.last_message_at.toISOString(),
          last_customer_message_at: c.last_customer_message_at ? (typeof c.last_customer_message_at === 'string' ? c.last_customer_message_at : c.last_customer_message_at.toISOString()) : null,
          is_within_24h_window: isWithin24h,
          customerPhone: c.customer?.phone ?? null,
          customerName: c.customer?.name ?? null,
        };
      }),
    };
  } catch (err: any) {
    const { conversationService } = await import('./conversation.service');
    const memoryConvs = conversationService.getMemoryConversations() || [];
    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();

    const entries: ConversationTraceEntry[] = memoryConvs
      .filter((c: any) => !c.tenant_id || c.tenant_id === DEFAULT_TENANT_ID)
      .sort((a: any, b: any) => new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime())
      .slice(0, limit)
      .map((c: any) => {
        const lastCustMsgMs = c.last_customer_message_at ? new Date(c.last_customer_message_at).getTime() : null;
        const isWithin24h = lastCustMsgMs !== null ? (now - lastCustMsgMs) <= TWENTY_FOUR_HOURS_MS : false;

        return {
          id: c.id,
          current_state: c.current_state || 'INITIAL',
          is_human_handling: !!c.is_human_handling,
          human_handling_since: c.human_handling_since ? (typeof c.human_handling_since === 'string' ? c.human_handling_since : c.human_handling_since.toISOString()) : null,
          escalation_reason: c.escalation_reason ?? null,
          consecutive_unknown_count: c.consecutive_unknown_count ?? 0,
          location_attempts: c.location_attempts ?? 0,
          last_message_at: typeof c.last_message_at === 'string' ? c.last_message_at : (c.last_message_at?.toISOString?.() || new Date().toISOString()),
          last_customer_message_at: c.last_customer_message_at ? (typeof c.last_customer_message_at === 'string' ? c.last_customer_message_at : c.last_customer_message_at.toISOString()) : null,
          is_within_24h_window: isWithin24h,
          customerPhone: c.customerPhone || null,
          customerName: c.customerName || null,
        };
      });

    return { entries, dbNote: 'DB offline (using memory fallback)' };
  }
}

export { getLogBuffer, getLogBufferStats, isLogBufferInstalled };
