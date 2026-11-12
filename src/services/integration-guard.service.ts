import { CircuitBreaker, type CircuitState } from '../utils/circuit-breaker';
import { distributedKv, type DistributedKv } from '../utils/distributed-kv';
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

/**
 * integration-guard.service.ts — kuota harian + circuit breaker + kunci API
 * PER TENANT untuk layanan pihak ketiga (ORS, Google Distance Matrix, Geocoding).
 *
 * Latar (I-011): sebelumnya kunci API hanya dari env global dan tidak ada
 * pembatas pemakaian/circuit per tenant. Satu tenant yang boros bisa
 * menghabiskan kuota bersama dan memutus layanan tenant lain.
 *
 * Sumber konfigurasi: `Tenant.settings.integrationGuards`:
 * ```json
 * {
 *   "ors": { "enabled": true, "dailyLimit": 900 },
 *   "googleDistanceMatrix": { "dailyLimit": 500 },
 *   "googleGeocode": { "dailyLimit": 300, "failureThreshold": 0.5,
 *                      "slidingWindowSize": 10, "cooldownMs": 30000 }
 * }
 * ```
 * `apiKey` per rule opsional (override env tenant-aware). Tanpa konfigurasi
 * DB, perilaku lama dipertahankan: kunci env, tanpa batas harian, circuit
 * default — jadi deploy ini tidak memutus layanan yang sudah jalan.
 *
 * Kuota dihitung di KV bersama (`distributedKv.incr`) per tenant+layanan+hari
 * WIB, sehingga app & worker berbagi hitungan. KV mati → penghitung fallback
 * memori (degradasi jujur, bukan crash).
 */

export type IntegrationServiceName = 'ors' | 'googleDistanceMatrix' | 'googleGeocode';

export interface IntegrationGuardRule {
  enabled?: boolean;
  dailyLimit?: number;
  failureThreshold?: number;
  slidingWindowSize?: number;
  cooldownMs?: number;
  apiKey?: string;
}

export interface IntegrationGuardConfig {
  rules: Partial<Record<IntegrationServiceName, IntegrationGuardRule>>;
}

export interface QuotaStatus {
  allowed: boolean;
  used: number;
  limit: number | null;
  service: IntegrationServiceName;
  tenantId: string;
  dayKey: string;
}

const VALID_SERVICES: IntegrationServiceName[] = ['ors', 'googleDistanceMatrix', 'googleGeocode'];
const CACHE_TTL_MS = 5 * 60 * 1000;
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

export function parseIntegrationGuardConfig(raw: unknown): IntegrationGuardConfig {
  const rules: Partial<Record<IntegrationServiceName, IntegrationGuardRule>> = {};
  if (!raw || typeof raw !== 'object') return { rules };

  for (const service of VALID_SERVICES) {
    const entry = (raw as any)[service];
    if (!entry || typeof entry !== 'object') continue;
    const rule: IntegrationGuardRule = {};

    if (typeof entry.enabled === 'boolean') rule.enabled = entry.enabled;

    const limit = Number(entry.dailyLimit);
    if (Number.isInteger(limit) && limit > 0 && limit <= 1_000_000) rule.dailyLimit = limit;

    const threshold = Number(entry.failureThreshold);
    if (Number.isFinite(threshold) && threshold >= 0 && threshold <= 1) rule.failureThreshold = threshold;

    const windowSize = Number(entry.slidingWindowSize);
    if (Number.isInteger(windowSize) && windowSize >= 1 && windowSize <= 1_000) {
      rule.slidingWindowSize = windowSize;
    }

    const cooldown = Number(entry.cooldownMs);
    if (Number.isInteger(cooldown) && cooldown >= 1_000 && cooldown <= 3_600_000) {
      rule.cooldownMs = cooldown;
    }

    if (typeof entry.apiKey === 'string' && entry.apiKey.trim() && entry.apiKey.length <= 200) {
      rule.apiKey = entry.apiKey.trim();
    }

    if (Object.keys(rule).length > 0) rules[service] = rule;
  }

  return { rules };
}

export async function getIntegrationGuardConfig(
  tenantId: string = DEFAULT_TENANT_ID
): Promise<IntegrationGuardConfig> {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    return parseIntegrationGuardConfig((tenant?.settings as any)?.integrationGuards);
  } catch (err: any) {
    console.warn(
      `[IntegrationGuard] Gagal memuat konfigurasi tenant '${tenantId}', memakai default env:`,
      err?.message || err
    );
    return { rules: {} };
  }
}

const configCache = new Map<string, { config: IntegrationGuardConfig; expiresAt: number }>();

export function clearIntegrationGuardCache(tenantId?: string): void {
  if (tenantId) configCache.delete(tenantId);
  else configCache.clear();
}

export class IntegrationGuard {
  private breakers = new Map<string, CircuitBreaker<[() => Promise<any>], any>>();

  constructor(
    private readonly kv: DistributedKv = distributedKv,
    private readonly now: () => number = Date.now
  ) {}

  /** Hari kalender WIB (YYYY-MM-DD) sebagai bagian kunci kuota. */
  private dayKey(): string {
    return new Date(this.now() + WIB_OFFSET_MS).toISOString().slice(0, 10);
  }

  /** TTL cukup sampai tengah malam WIB berikutnya (+5 menit aman). */
  private quotaTtlMs(): number {
    const now = this.now();
    const wibNow = new Date(now + WIB_OFFSET_MS);
    const nextWibMidnightUtc =
      Date.UTC(wibNow.getUTCFullYear(), wibNow.getUTCMonth(), wibNow.getUTCDate() + 1) - WIB_OFFSET_MS;
    return Math.max(60_000, nextWibMidnightUtc - now + 5 * 60_000);
  }

  async getRule(
    tenantId: string = DEFAULT_TENANT_ID,
    service: IntegrationServiceName
  ): Promise<IntegrationGuardRule> {
    const cached = configCache.get(tenantId);
    let config: IntegrationGuardConfig;
    if (cached && cached.expiresAt > this.now()) {
      config = cached.config;
    } else {
      config = await getIntegrationGuardConfig(tenantId);
      configCache.set(tenantId, { config, expiresAt: this.now() + CACHE_TTL_MS });
    }
    return config.rules[service] ?? {};
  }

  async isEnabled(
    tenantId: string = DEFAULT_TENANT_ID,
    service: IntegrationServiceName
  ): Promise<boolean> {
    return (await this.getRule(tenantId, service)).enabled !== false;
  }

  /** Kunci API per tenant (DB) bila ada; jika tidak, pakai kunci env. */
  async resolveApiKey(
    tenantId: string = DEFAULT_TENANT_ID,
    service: IntegrationServiceName,
    envKey: string
  ): Promise<string> {
    const rule = await this.getRule(tenantId, service);
    return rule.apiKey || envKey || '';
  }

  /** Catat 1 pemakaian kuota hari ini untuk tenant+layanan. */
  async consume(
    tenantId: string = DEFAULT_TENANT_ID,
    service: IntegrationServiceName,
    cost = 1
  ): Promise<QuotaStatus> {
    const rule = await this.getRule(tenantId, service);
    const limit = rule.dailyLimit ?? null;
    const dayKey = this.dayKey();

    if (limit === null) {
      return { allowed: true, used: 0, limit: null, service, tenantId, dayKey };
    }

    let used = 0;
    try {
      for (let i = 0; i < Math.max(1, cost); i++) {
        used = await this.kv.incr(`quota:${service}:${tenantId}:${dayKey}`, this.quotaTtlMs());
      }
    } catch {
      // KV bermasalah: jangan blokir layanan karena penghitung (fail-open).
      return { allowed: true, used: 0, limit, service, tenantId, dayKey };
    }

    return { allowed: used <= limit, used, limit, service, tenantId, dayKey };
  }

  private breakerFor(
    tenantId: string,
    service: IntegrationServiceName,
    rule: IntegrationGuardRule
  ): CircuitBreaker<[() => Promise<any>], any> {
    const key = `${service}:${tenantId}`;
    const existing = this.breakers.get(key);
    if (existing) return existing;

    const breaker = new CircuitBreaker<[() => Promise<any>], any>(
      (fn) => fn(),
      async () => null,
      {
        name: `IntegrationGuard ${service} [${tenantId}]`,
        failureThreshold: rule.failureThreshold,
        slidingWindowSize: rule.slidingWindowSize,
        cooldownPeriodMs: rule.cooldownMs,
      }
    );
    this.breakers.set(key, breaker);
    return breaker;
  }

  /**
   * Jalankan panggilan layanan dengan gerbang tenant:
   * nonaktif / circuit OPEN / kuota habis → `null` (caller lanjut ke fallback).
   */
  async run<T>(
    tenantId: string,
    service: IntegrationServiceName,
    fn: () => Promise<T>
  ): Promise<T | null> {
    const rule = await this.getRule(tenantId, service);
    if (rule.enabled === false) return null;

    const breaker = this.breakerFor(tenantId, service, rule);
    if (breaker.getState() === 'OPEN') {
      return null;
    }

    const quota = await this.consume(tenantId, service);
    if (!quota.allowed) {
      console.warn(JSON.stringify({
        event: 'INTEGRATION_QUOTA_EXCEEDED',
        tenantId,
        service,
        used: quota.used,
        limit: quota.limit,
        dayKey: quota.dayKey,
        timestamp: new Date().toISOString(),
      }));
      return null;
    }

    const result = await breaker.execute(fn);
    return (result ?? null) as T | null;
  }

  getCircuitState(
    tenantId: string = DEFAULT_TENANT_ID,
    service: IntegrationServiceName
  ): CircuitState {
    const breaker = this.breakers.get(`${service}:${tenantId}`);
    return breaker ? breaker.getState() : 'CLOSED';
  }

  /** Reset breaker/cache (test, shutdown, atau setelah admin mengubah settings). */
  reset(tenantId?: string): void {
    if (tenantId) {
      for (const key of Array.from(this.breakers.keys())) {
        if (key.endsWith(`:${tenantId}`)) this.breakers.delete(key);
      }
      clearIntegrationGuardCache(tenantId);
    } else {
      this.breakers.clear();
      clearIntegrationGuardCache();
    }
  }
}

export const integrationGuard = new IntegrationGuard();
