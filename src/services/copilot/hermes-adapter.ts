/**
 * hermes-adapter.ts (Fase 4) — klien tipis Fastify → Hermes "otak".
 *
 * Kontrak fondasional (tanpa-MCP, sesuai keputusan):
 * - Hermes HANYA memutuskan (router: tool+args) dan merangkum (summarize: teks).
 *   Eksekusi tool, strip UUID, grounding, budget, dan audit SELALU di Fastify
 *   (`copilot.service.ts`) — adapter ini tidak menyentuh DB sama sekali.
 * - Transport: POST `{baseUrl}/ask` `{ kind: 'router'|'summarize', prompt }`
 *   dengan `Authorization: Bearer <HERMES_BRIDGE_SECRET>`. Sisi Hermes (dashboard
 *   API / micro-bridge loopback) MENGIMPLEMENTASIKAN kontrak ini — adapter tidak
 *   peduli implementasi mana, selama kontrak dipenuhi (seam terdefinisi).
 * - Fail-closed & fallback-friendly: tanpa secret, non-200, payload cacat, atau
 *   timeout → kembalikan `null` (sinyal "pakai engine internal"), JANGAN throw.
 *   Zero dependency baru (fetch bawaan Node 20).
 */

import { extractBalancedJson } from '../../utils/json-extract';

export const HERMES_ASK_PATH = '/ask';
export const DEFAULT_HERMES_BASE_URL = 'http://hermes-agent:9119';
/** API OpenAI-compatible di dalam container hermes-agent (port loopback container). */
export const DEFAULT_HERMES_OPENAI_URL = 'http://hermes-agent:8642';
/**
 * Satu-satunya model yang diekspos :8642 (terverifikasi GET /v1/models dari
 * dalam hermes-agent). Default infra (bukan data bisnis); bila ID berubah,
 * API 400 → adapter fail-closed ke internal. Override via HERMES_OPENAI_MODEL.
 */
export const DEFAULT_HERMES_OPENAI_MODEL = 'hermes-agent';
const OPENAI_COMPLETIONS_PATH = '/v1/chat/completions';

export type CopilotEngine = 'hermes' | 'internal';
/**
 * Otak Hermes yang dipakai: `openai` (API :8642, primer — murah, tanpa spawn)
 * atau `bridge` (micro-bridge `/ask` + `hermes -z --skills`, cadangan).
 */
export type HermesBrainMode = 'openai' | 'bridge';

export interface HermesBridgeConfig {
  engine: CopilotEngine;
  mode: HermesBrainMode;
  baseUrl: string;
  secret: string;
  openaiUrl: string;
  openaiKey: string;
  openaiModel: string;
}

export interface HermesBridgeCallOpts {
  baseUrl: string;
  secret: string;
  timeoutMs: number;
  /** Default `bridge` (kompatibel kontrak lama) bila tidak diisi. */
  mode?: HermesBrainMode;
  openaiUrl?: string;
  openaiKey?: string;
  openaiModel?: string;
}

export interface HermesRouterDecision {
  tool: string | null;
  args: Record<string, any>;
}

/**
 * Resolve konfigurasi dari env. Default = `internal` (zero-risk rollout:
 * tanpa env, perilaku identik seperti sebelum Fase 4).
 */
export function resolveHermesConfig(): HermesBridgeConfig {
  const engine: CopilotEngine = process.env.COPILOT_ENGINE === 'hermes' ? 'hermes' : 'internal';
  const mode: HermesBrainMode = process.env.HERMES_BRAIN_MODE === 'bridge' ? 'bridge' : 'openai';
  const baseUrl = (process.env.HERMES_BRIDGE_URL || DEFAULT_HERMES_BASE_URL).replace(/\/$/, '');
  const secret = process.env.HERMES_BRIDGE_SECRET || '';
  const openaiUrl = (process.env.HERMES_OPENAI_URL || DEFAULT_HERMES_OPENAI_URL).replace(/\/$/, '');
  const openaiKey = process.env.HERMES_OPENAI_KEY || '';
  const openaiModel = (process.env.HERMES_OPENAI_MODEL || DEFAULT_HERMES_OPENAI_MODEL).trim();
  return { engine, mode, baseUrl, secret, openaiUrl, openaiKey, openaiModel };
}

async function postJson(
  url: string,
  secret: string,
  body: Record<string, any>,
  timeoutMs: number
): Promise<any | null> {
  // Fail-closed: tanpa secret, jangan panggil tanpa auth.
  if (!secret) return null;
  const ms = Math.max(1, Math.floor(timeoutMs));
  const ctrl = new AbortController();
  // Race deterministik: abort saja tidak cukup bila implementasi fetch
  // mengabaikan signal (tidak pernah settle) — timer menjamin null.
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolve(null);
    }, ms);
  });
  const attempt = (async () => {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!resp.ok) return null;
      return (await resp.json()) as any;
    } catch {
      return null;
    }
  })();
  try {
    return await Promise.race([attempt, deadline]);
  } finally {
    clearTimeout(timer!);
  }
}

async function postAsk(
  baseUrl: string,
  secret: string,
  kind: 'router' | 'summarize',
  prompt: string,
  timeoutMs: number
): Promise<any | null> {
  const url = `${baseUrl.replace(/\/+$/, '')}${HERMES_ASK_PATH}`;
  return postJson(url, secret, { kind, prompt }, timeoutMs);
}

/**
 * Panggil API OpenAI-compatible (:8642) sebagai otak. Tanpa key/model →
 * fail-closed (null). Prompt router/summarize Fastify sudah self-contained
 * (menu tool + gaya + aturan) sehingga skill bukan syarat di jalur ini.
 */
async function requestOpenaiText(
  prompt: string,
  opts: HermesBridgeCallOpts,
  temperature: number,
  maxTokens: number
): Promise<string | null> {
  const key = (opts.openaiKey || '').trim();
  const model = (opts.openaiModel || '').trim();
  if (!key || !model) return null;
  const url = `${(opts.openaiUrl || DEFAULT_HERMES_OPENAI_URL).replace(/\/+$/, '')}${OPENAI_COMPLETIONS_PATH}`;
  const data = await postJson(
    url,
    key,
    { model, messages: [{ role: 'user', content: prompt }], temperature, max_tokens: maxTokens },
    opts.timeoutMs
  );
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) return null;
  return content;
}

/** Validasi keputusan router (bentuk apa pun sumbernya) → null bila cacat. */
function toRouterDecision(data: any): HermesRouterDecision | null {
  if (!data || typeof data !== 'object' || !('tool' in data)) return null;
  if (data.tool === null) return { tool: null, args: {} };
  if (typeof data.tool !== 'string' || !data.tool.trim()) return null;
  const args = data.args && typeof data.args === 'object' ? data.args : {};
  return { tool: data.tool, args };
}

/** Minta keputusan router ke Hermes. Gagal → null (fallback internal). */
export async function requestHermesRouter(
  prompt: string,
  opts: HermesBridgeCallOpts
): Promise<HermesRouterDecision | null> {
  if ((opts.mode ?? 'bridge') === 'openai') {
    const content = await requestOpenaiText(prompt, opts, 0, 300);
    if (!content) return null;
    const parsed = extractBalancedJson(content, 'tool');
    if (!parsed) return null;
    try {
      return toRouterDecision(JSON.parse(parsed));
    } catch {
      return null;
    }
  }
  const data = await postAsk(opts.baseUrl, opts.secret, 'router', prompt, opts.timeoutMs);
  return toRouterDecision(data);
}

/** Minta ringkasan ke Hermes. Gagal → null (fallback internal). */
export async function requestHermesSummarize(
  prompt: string,
  opts: HermesBridgeCallOpts
): Promise<string | null> {
  if ((opts.mode ?? 'bridge') === 'openai') {
    const content = await requestOpenaiText(prompt, opts, 0.2, 600);
    if (!content) return null;
    return content.trim() || null;
  }
  const data = await postAsk(opts.baseUrl, opts.secret, 'summarize', prompt, opts.timeoutMs);
  if (!data || typeof data.text !== 'string' || !data.text.trim()) return null;
  return data.text;
}
