import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { TEMPLATES } from '../config/persona';

/**
 * Fase 2 (Revisi Turn-0) — Template sapaan Data-Driven, tenant-aware.
 *
 * Sumber: tabel `ClinicPolicy` topic 'greeting' (kolom suggested_reply) — dapat
 * diubah admin tanpa deploy lewat endpoint settings yang SUDAH ada
 * (PUT /api/admin/settings/clinic-policies/greeting). Fallback: TEMPLATES.greeting
 * (tenant-aware via getBrandIdentity). Cache in-memory TTL 5 menit.
 *
 * TANPA migrasi skema. Interpolasi HANYA penanda aman ({{greeting}}/{{nama}}/
 * {{customerName}}); nama default "Bunda" (DILARANG ambil pushName kontak mentah).
 */

const cache = new Map<string, { text: string | null; at: number }>();
const TTL_MS = 5 * 60 * 1000;

export function invalidateGreetingTemplateCache(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

/** Baca template mentah dari DB (null bila tak ada / DB offline). Ter-cache 5 menit. */
export async function getGreetingTemplateRaw(tenantId: string = DEFAULT_TENANT_ID): Promise<string | null> {
  const cached = cache.get(tenantId);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.text;
  let text: string | null = null;
  try {
    const policy = await (prisma as any).clinicPolicy.findUnique({
      where: { tenant_id_topic: { tenant_id: tenantId, topic: 'greeting' } },
    });
    if (policy && policy.is_active && typeof policy.suggested_reply === 'string' && policy.suggested_reply.trim()) {
      text = policy.suggested_reply;
    }
  } catch (err: any) {
    console.warn(JSON.stringify({ event: 'GREETING_TEMPLATE_DB_ERROR', tenantId, error: err?.message, timestamp: new Date().toISOString() }));
  }
  cache.set(tenantId, { text, at: Date.now() });
  return text;
}

export interface GreetingRenderVars {
  isIslamic?: boolean;
  customerName?: string;
}

/**
 * Ganti penanda aman pada template. Tidak boleh menyisakan `{{...}}`.
 * {{greeting}} → "Waalaikumsalam"/"Halo"; {{nama}}/{{customerName}} → nama|Bunda.
 */
export function renderGreeting(template: string, vars: GreetingRenderVars = {}): string {
  const name = (vars.customerName || '').trim() || 'Bunda';
  const greetingWord = vars.isIslamic ? 'Waalaikumsalam' : 'Halo';
  return (template || '')
    .replace(/\{\{\s*greeting\s*\}\}/gi, greetingWord)
    .replace(/\{\{\s*(customerName|nama)\s*\}\}/gi, name)
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/**
 * Teks sapaan final: DB (jika ada) atau fallback TEMPLATES.greeting.
 */
export async function resolveGreetingText(
  tenantId: string = DEFAULT_TENANT_ID,
  vars: GreetingRenderVars = {}
): Promise<string> {
  const raw = await getGreetingTemplateRaw(tenantId);
  if (raw) return renderGreeting(raw, vars);
  return TEMPLATES.greeting({ isIslamic: vars.isIslamic });
}
