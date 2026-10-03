import { DEFAULT_TENANT_ID } from './tenant';

/**
 * copilot-tenant.ts (ADR-001) — Gerbang single-tenant AI Clinic Copilot 2.0.
 *
 * Keputusan pemilik produk: fitur Copilot 2.0 HANYA untuk tenant owner
 * (`default-tenant`). Tenant lain = DEPRECATED / nonaktif.
 *
 * Kontrak fondasional:
 * - Deterministik & fail-closed: allowlist KOSONG / env absen → hanya
 *   `DEFAULT_TENANT_ID` yang lolos. Bukan default "semua boleh".
 * - Gerbang dipasang di 3 lapis: route (403 sebelum LLM), service (guard
 *   sebelum tool/LLM), dan UI (sembunyikan panel). Query tool TETAP
 *   tenant-scoped (anti-IDOR) — single-tenant BUKAN alasan melepas filter.
 * - TIDAK menghapus dukungan multi-tenant di lapisan data; ini murni
 *   gerbang akses fitur, bukan pemindahan skema.
 */

/** Penanda error gerbang single-tenant (dipakai route & service). */
export const COPILOT_DEPRECATED_ERROR = 'COPILOT_TENANT_DEPRECATED';

/**
 * Parse allowlist tenant Copilot dari env (murni, deterministik, mudah diuji).
 * - `undefined` → baca `process.env.COPILOT_ALLOWED_TENANT_IDS`.
 * - String kosong / hanya koma → fallback `[DEFAULT_TENANT_ID]` (fail-closed).
 * - `*` = wildcard eksplisit (mis. lingkungan test) yang mengizinkan semua tenant.
 * - Selalu trim + buang entri kosong.
 */
export function parseCopilotAllowlist(raw?: string): string[] {
  const source = raw === undefined ? process.env.COPILOT_ALLOWED_TENANT_IDS : raw;
  const list = String(source ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : [DEFAULT_TENANT_ID];
}

/**
 * Apakah tenant diizinkan memakai fitur Copilot 2.0.
 * `tenantId` null/undefined → dianggap `DEFAULT_TENANT_ID` (perilaku route lama).
 * Wildcard `*` hanya bila ditulis eksplisit di allowlist (tidak pernah default).
 */
export function isCopilotTenantAllowed(tenantId: string | null | undefined, raw?: string): boolean {
  const list = parseCopilotAllowlist(raw);
  if (list.includes('*')) return true;
  const id = (tenantId || DEFAULT_TENANT_ID).trim();
  return list.includes(id);
}
