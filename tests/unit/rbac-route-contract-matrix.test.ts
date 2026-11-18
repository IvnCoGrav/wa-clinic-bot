import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { StaffAuthService } from '../../src/services/staff-auth.service';
import {
  clearScopeCache,
  isApiScopeAllowed,
  matchApiScopePrefix,
} from '../../src/services/role-scope.service';
import {
  BASELINE_STAFF_API_SCOPES,
  MODULE_PATH_TO_API_SCOPES,
  SUPER_ADMIN_ONLY_MODULE_PATHS,
  deriveApiScopesForAllowedPaths,
  isScopeFullyBlockedByLayer1,
} from '../../src/domain/role-module-scopes';

const ROLE_PERMISSIONS_PATH = path.resolve(
  __dirname,
  '../../packages/admin-dashboard/src/config/rolePermissions.ts'
);

const MIGRATIONS_DIR = path.resolve(__dirname, '../../prisma/migrations');

/** Ekstrak seluruh path modul yang didefinisikan pada `ALL_MODULES` di frontend `rolePermissions.ts`. */
function extractFrontendAllModulePaths(): string[] {
  const src = fs.readFileSync(ROLE_PERMISSIONS_PATH, 'utf8');
  const start = src.indexOf('export const ALL_MODULES');
  const end = src.indexOf('export const ALL_PATHS', start);
  if (start === -1 || end === -1) {
    throw new Error('Tidak dapat menemukan blok ALL_MODULES pada rolePermissions.ts');
  }
  const block = src.slice(start, end);
  const paths = Array.from(block.matchAll(/path:\s*'(\/admin\/[^']+)'/g), (m) => m[1]);
  return Array.from(new Set(paths));
}

/** Muat seluruh file migrasi SQL yang menyentuh tabel `role_api_scopes` secara berurutan kronologis. */
function loadFinalMigrationScopesByRole(): Map<string, Map<string, string>> {
  const roleMap = new Map<string, Map<string, string>>();
  const ensureRole = (role: string) => {
    let m = roleMap.get(role);
    if (!m) {
      m = new Map();
      roleMap.set(role, m);
    }
    return m;
  };

  const dirs = fs.readdirSync(MIGRATIONS_DIR).sort();
  for (const dir of dirs) {
    const sqlPath = path.join(MIGRATIONS_DIR, dir, 'migration.sql');
    if (!fs.existsSync(sqlPath)) continue;
    const sql = fs.readFileSync(sqlPath, 'utf8');
    if (!sql.includes('role_api_scopes')) continue;

    // Proses DELETE terlebih dahulu
    const deleteBlocks = sql.split(/DELETE\s+FROM\s+"role_api_scopes"/i).slice(1);
    for (const rawBlock of deleteBlocks) {
      const stmt = rawBlock.split(';')[0];
      const roleFilterMatch = stmt.match(/"role_key"\s+IN\s*\(([^)]+)\)/i);
      const targetRoles = roleFilterMatch
        ? Array.from(roleFilterMatch[1].matchAll(/'([a-z0-9_]+)'/gi), (m) => m[1].toLowerCase())
        : Array.from(roleMap.keys());

      const prefixes: string[] = [];
      const single = stmt.match(/"api_prefix"\s*=\s*'(\/api\/admin\/[^']+)'/i);
      if (single) prefixes.push(single[1]);
      const inMatch = stmt.match(/"api_prefix"\s+IN\s*\(([^)]+)\)/i);
      if (inMatch) {
        for (const pm of inMatch[1].matchAll(/'(\/api\/admin\/[^']+)'/gi)) {
          prefixes.push(pm[1]);
        }
      }
      for (const rk of targetRoles) {
        const m = roleMap.get(rk);
        if (!m) continue;
        for (const p of prefixes) m.delete(p);
      }
    }

    // Proses INSERT
    const insertBlocks = sql.split(/INSERT\s+INTO\s+"role_api_scopes"/i).slice(1);
    for (const block of insertBlocks) {
      const threeColRe = /\(\s*'([a-z0-9_]+)'\s*,\s*'(\/api\/admin\/[^']+)'\s*,\s*'([^']+)'\s*\)/gi;
      let m: RegExpExecArray | null;
      let foundThree = false;
      while ((m = threeColRe.exec(block)) !== null) {
        foundThree = true;
        ensureRole(m[1].toLowerCase()).set(m[2], m[3]);
      }
      if (foundThree) continue;

      const roleKeys = Array.from(
        new Set(
          Array.from(block.matchAll(/'(admin_cs|spv_cs|therapist|advertiser)'/gi), (rm) => rm[1].toLowerCase())
        )
      );
      const twoColRe = /\(\s*'(\/api\/admin\/[^']+)'\s*,\s*'([^']+)'\s*\)/gi;
      while ((m = twoColRe.exec(block)) !== null) {
        for (const rk of roleKeys) {
          ensureRole(rk).set(m[1], m[2]);
        }
      }
    }
  }

  return roleMap;
}

function routeMatchesScope(
  route: { method: string; url: string },
  apiPrefix: string,
  methods: string
): boolean {
  const sampleUrl = route.url.replace(/:[a-zA-Z0-9_]+/g, 'sample-id');
  const pathOk = matchApiScopePrefix(sampleUrl, apiPrefix);
  if (!pathOk) return false;
  const allowed = methods
    .split(',')
    .map((m) => m.trim().toUpperCase())
    .filter(Boolean);
  return allowed.includes('*') || allowed.includes(route.method);
}

describe('RBAC Route Contract Matrix & Custom Role Auto-Sync (KNOWN #358 Fase 4)', () => {
  const registeredRoutes: Array<{ method: string; url: string }> = [];
  const app = buildApp();
  app.addHook('onRoute', (routeOptions) => {
    const methods = Array.isArray(routeOptions.method)
      ? routeOptions.method
      : [routeOptions.method];
    for (const method of methods) {
      registeredRoutes.push({ method: String(method).toUpperCase(), url: routeOptions.url });
    }
  });

  const superAdminKey = 'test_super_admin_key_fase4_matrix';

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = superAdminKey;
    clearScopeCache();
  });

  describe('1. Invariant 1:1 Frontend ALL_MODULES vs MODULE_PATH_TO_API_SCOPES (Anti-Drift A-009)', () => {
    it('setiap modul di rolePermissions.ts ALL_MODULES terpetakan tepat di MODULE_PATH_TO_API_SCOPES atau SUPER_ADMIN_ONLY_MODULE_PATHS', () => {
      const frontendModules = extractFrontendAllModulePaths();
      expect(frontendModules.length).toBeGreaterThanOrEqual(25);

      const superOnly = new Set(SUPER_ADMIN_ONLY_MODULE_PATHS);
      const mapped = new Set(Object.keys(MODULE_PATH_TO_API_SCOPES));

      const unmapped: string[] = [];
      const overlapped: string[] = [];
      for (const modPath of frontendModules) {
        const inMapped = mapped.has(modPath);
        const inSuper = superOnly.has(modPath);
        if (!inMapped && !inSuper) unmapped.push(modPath);
        if (inMapped && inSuper) overlapped.push(modPath);
      }

      expect(unmapped, 'Modul UI baru belum didaftarkan di src/domain/role-module-scopes.ts').toEqual([]);
      expect(overlapped, 'Modul tidak boleh berada di mapped dan super-admin-only sekaligus').toEqual([]);
    });

    it('A-009: /admin/overview TIDAK BOLEH otomatis memberi /api/admin/financial-analytics (hanya via modul eksplisit)', () => {
      const overviewOnly = deriveApiScopesForAllowedPaths(['/admin/overview']);
      const overviewPrefixes = overviewOnly.map((s) => s.apiPrefix);
      expect(overviewPrefixes).not.toContain('/api/admin/financial-analytics');

      const withFinancial = deriveApiScopesForAllowedPaths(['/admin/overview', '/admin/financial-analytics']);
      const finScope = withFinancial.find((s) => s.apiPrefix === '/api/admin/financial-analytics');
      expect(finScope).toEqual({ apiPrefix: '/api/admin/financial-analytics', methods: 'GET' });
    });

    it('modul Super Admin & path tak dikenal tidak pernah membocorkan scope sensitif', () => {
      const derived = deriveApiScopesForAllowedPaths([
        '/admin/settings',
        '/admin/debug',
        '/admin/persona',
        '/admin/chat-export',
        '/admin/sandbox',
        '/admin/unknown-injected-path',
      ]);
      // Hanya menyisakan BASELINE_STAFF_API_SCOPES
      expect(derived.map((d) => d.apiPrefix).sort()).toEqual(
        BASELINE_STAFF_API_SCOPES.map((b) => b.apiPrefix).sort()
      );
    });

    it('menggabungkan method secara deterministik tanpa duplikasi apiPrefix', () => {
      const derived = deriveApiScopesForAllowedPaths(['/admin/customers', '/admin/reservations', '/admin/live-chat']);
      const prefixes = derived.map((d) => d.apiPrefix);
      expect(new Set(prefixes).size).toBe(prefixes.length);

      // /admin/customers memberi GET reservation, /admin/reservations memberi * → hasil merge wajib '*'
      const resScope = derived.find((d) => d.apiPrefix === '/api/admin/reservation');
      expect(resScope?.methods).toBe('*');
    });
  });

  describe('2. Invariant 0 Orphan & 0 Kontradiksi Layer 1 vs Layer 2 (Modul Kanonis + Seluruh Migrasi SQL)', () => {
    it('semua scope pada BASELINE_STAFF_API_SCOPES dan MODULE_PATH_TO_API_SCOPES cocok rute nyata & tidak diblokir Layer 1', async () => {
      await app.ready();

      const allEntries: Array<{ source: string; apiPrefix: string; methods: string }> = [
        ...BASELINE_STAFF_API_SCOPES.map((s) => ({ source: 'BASELINE', ...s })),
        ...Object.entries(MODULE_PATH_TO_API_SCOPES).flatMap(([modPath, list]) =>
          list.map((s) => ({ source: modPath, ...s }))
        ),
      ];

      const orphans: string[] = [];
      const layer1Blocked: string[] = [];

      for (const entry of allEntries) {
        const matched = registeredRoutes.some((r) => routeMatchesScope(r, entry.apiPrefix, entry.methods));
        if (!matched) {
          orphans.push(`${entry.source}: ${entry.methods} ${entry.apiPrefix}`);
        }
        if (isScopeFullyBlockedByLayer1(entry.apiPrefix, entry.methods)) {
          layer1Blocked.push(`${entry.source}: ${entry.methods} ${entry.apiPrefix}`);
        }
      }

      expect(orphans, 'Ditemukan orphan scope pada MODULE_PATH_TO_API_SCOPES').toEqual([]);
      expect(layer1Blocked, 'Ditemukan scope kontradiktif Layer 1 pada MODULE_PATH_TO_API_SCOPES').toEqual([]);
    });

    it('hasil akhir seluruh migrasi SQL role_api_scopes lintas semua role memiliki 0 orphan & 0 kontradiksi Layer 1', async () => {
      await app.ready();
      const roleScopes = loadFinalMigrationScopesByRole();
      expect(Array.from(roleScopes.keys()).sort()).toEqual(['admin_cs', 'advertiser', 'spv_cs', 'therapist']);

      const orphans: string[] = [];
      const contradictions: string[] = [];

      for (const [roleKey, scopeMap] of roleScopes.entries()) {
        for (const [apiPrefix, methods] of scopeMap.entries()) {
          const matched = registeredRoutes.some((r) => routeMatchesScope(r, apiPrefix, methods));
          if (!matched) {
            orphans.push(`${roleKey}: ${methods} ${apiPrefix}`);
          }
          if (isScopeFullyBlockedByLayer1(apiPrefix, methods)) {
            contradictions.push(`${roleKey}: ${methods} ${apiPrefix}`);
          }
        }
      }

      expect(orphans, 'Ditemukan orphan scope di hasil akhir migrasi SQL').toEqual([]);
      expect(contradictions, 'Ditemukan kontradiksi Layer 1 vs Layer 2 di hasil akhir migrasi SQL').toEqual([]);
    });
  });

  describe('3. End-to-End Auto-Sync Custom Role via POST & DELETE /api/admin/roles (H-04, CD-07, V-07)', () => {
    it('POST /api/admin/roles men-sync role_api_scopes secara transaksional sehingga custom role baru tidak 403 di modulnya namun tetap 403 di endpoint sensitif', async () => {
      await app.ready();

      const syncedStore = new Map<string, Array<{ api_prefix: string; methods: string }>>();

      (prisma as any).$transaction = vi.fn().mockImplementation(async (cb: any) => {
        const tx = {
          customRole: {
            upsert: vi.fn().mockImplementation(async (args: any) => ({
              id: 'role-custom-1',
              tenant_id: args.create.tenant_id,
              key: args.create.key,
              label: args.create.label,
              description: args.create.description,
              allowed_paths: args.create.allowed_paths,
              default_redirect: args.create.default_redirect,
              is_system: false,
            })),
          },
          roleApiScope: {
            deleteMany: vi.fn().mockImplementation(async (args: any) => {
              syncedStore.delete(`${args.where.tenant_id}::${args.where.role_key}`);
              return { count: 0 };
            }),
            createMany: vi.fn().mockImplementation(async (args: any) => {
              const rows = args.data as Array<{ tenant_id: string; role_key: string; api_prefix: string; methods: string }>;
              if (rows.length > 0) {
                const k = `${rows[0].tenant_id}::${rows[0].role_key}`;
                syncedStore.set(
                  k,
                  rows.map((r) => ({ api_prefix: r.api_prefix, methods: r.methods }))
                );
              }
              return { count: rows.length };
            }),
          },
        };
        return cb(tx);
      });

      (prisma as any).roleApiScope = {
        findMany: vi.fn().mockImplementation(async (args: any) => {
          return syncedStore.get(`${args.where.tenant_id}::${args.where.role_key}`) || [];
        }),
      };

      // Pra-simpan: cache kosong → role baru fail-closed (allowed: false)
      const beforeCreate = await isApiScopeAllowed('default-tenant', 'cs_junior', '/api/admin/live-chat/conversations', 'GET');
      expect(beforeCreate.allowed).toBe(false);

      // 1. Buat custom role `cs_junior` dengan Overview + Live Chat + Reservations
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/admin/roles',
        headers: { 'x-api-key': superAdminKey },
        payload: {
          key: 'cs_junior',
          label: 'CS Junior',
          allowedPaths: ['/admin/overview', '/admin/live-chat', '/admin/reservations'],
          defaultRedirect: '/admin/live-chat',
        },
      });

      expect(createRes.statusCode).toBe(200);
      const createBody = createRes.json();
      expect(createBody.success).toBe(true);
      expect(createBody.data.syncedScopesCount).toBeGreaterThan(10);

      // 2. Cache sudah ter-invalidate → langsung aktif tanpa restart
      const afterCreate = await isApiScopeAllowed('default-tenant', 'cs_junior', '/api/admin/live-chat/conversations', 'GET');
      expect(afterCreate.allowed).toBe(true);

      // 3. Autentikasi sebagai staf dengan custom role `cs_junior`
      vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue({
        staff: {
          id: 'staff-cs-junior',
          tenant_id: 'default-tenant',
          name: 'CS Junior Test',
          phone: '6281999888777',
          role: 'cs_junior',
          active: true,
          created_at: new Date(),
          updated_at: new Date(),
          telegram_chat_id: null,
        },
        session: {
          id: 'sess-cs-junior',
          staff_id: 'staff-cs-junior',
          token: 'valid_custom_role_token',
          expires_at: new Date(Date.now() + 86400000),
          created_at: new Date(),
        },
      } as any);

      const staffHeaders = {
        cookie: 'staff_session=valid_custom_role_token',
        'x-requested-with': 'XMLHttpRequest',
      };

      // Rute dalam modulnya TIDAK boleh 403
      const allowedChecks = [
        { method: 'GET' as const, url: '/api/admin/roles' },
        { method: 'GET' as const, url: '/api/admin/health' },
        { method: 'PUT' as const, url: '/api/admin/live-chat/conversations/conv-1/messages/msg-1/edit', payload: { text: 'Halo' } },
        { method: 'DELETE' as const, url: '/api/admin/live-chat/conversations/conv-1/messages/msg-1' },
        { method: 'DELETE' as const, url: '/api/admin/customers/cust-1/addresses/addr-1' },
      ];

      for (const tc of allowedChecks) {
        const res = await app.inject({
          method: tc.method,
          url: tc.url,
          headers: staffHeaders,
          ...(tc.payload ? { payload: tc.payload } : {}),
        });
        expect(res.statusCode, `${tc.method} ${tc.url} seharusnya tidak 403`).not.toBe(403);
      }

      // Rute terlarang WAJIB 403 (omzet A-009, K-6 approve-purchase & sync-full, CD-02 notifications, debug, CD-03 delete customer)
      const forbiddenChecks = [
        { method: 'GET' as const, url: '/api/admin/financial-analytics' },
        { method: 'POST' as const, url: '/api/admin/reservation/res-1/approve-purchase', payload: {} },
        { method: 'POST' as const, url: '/api/admin/live-chat/sync-full', payload: {} },
        { method: 'GET' as const, url: '/api/admin/settings/notifications' },
        { method: 'GET' as const, url: '/api/admin/debug/system' },
      ];

      for (const tc of forbiddenChecks) {
        const res = await app.inject({
          method: tc.method,
          url: tc.url,
          headers: staffHeaders,
          ...(tc.payload ? { payload: tc.payload } : {}),
        });
        expect(res.statusCode, `${tc.method} ${tc.url} WAJIB 403 untuk cs_junior`).toBe(403);
      }

      // CD-03: DELETE customer root juga tetap ditolak di scope matcher
      const deleteCustDecision = await isApiScopeAllowed('default-tenant', 'cs_junior', '/api/admin/customers/cust-1', 'DELETE');
      expect(deleteCustDecision.allowed).toBe(false);
    });

    it('DELETE /api/admin/roles/:key menghapus role + scope + invalidate cache, dan menolak hapus role sistem (409)', async () => {
      await app.ready();

      const syncedStore = new Map<string, Array<{ api_prefix: string; methods: string }>>([
        ['default-tenant::cs_temp', [{ api_prefix: '/api/admin/health', methods: 'GET' }]],
      ]);

      (prisma as any).$transaction = vi.fn().mockImplementation(async (cb: any) => {
        const tx = {
          customRole: {
            deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          roleApiScope: {
            deleteMany: vi.fn().mockImplementation(async (args: any) => {
              syncedStore.delete(`${args.where.tenant_id}::${args.where.role_key}`);
              return { count: 1 };
            }),
          },
        };
        return cb(tx);
      });

      (prisma as any).roleApiScope = {
        findMany: vi.fn().mockImplementation(async (args: any) => {
          return syncedStore.get(`${args.where.tenant_id}::${args.where.role_key}`) || [];
        }),
      };

      // Isi cache dulu
      const beforeDel = await isApiScopeAllowed('default-tenant', 'cs_temp', '/api/admin/health', 'GET');
      expect(beforeDel.allowed).toBe(true);

      // Hapus custom role
      const delRes = await app.inject({
        method: 'DELETE',
        url: '/api/admin/roles/cs_temp',
        headers: { 'x-api-key': superAdminKey },
      });
      expect(delRes.statusCode).toBe(200);

      // Setelah hapus, cache ter-invalidate & scope sudah kosong → 403 fail-closed
      const afterDel = await isApiScopeAllowed('default-tenant', 'cs_temp', '/api/admin/health', 'GET');
      expect(afterDel.allowed).toBe(false);

      // Adversarial: upaya menghapus role sistem wajib ditolak 409 tanpa menyentuh DB
      const sysDelRes = await app.inject({
        method: 'DELETE',
        url: '/api/admin/roles/admin_cs',
        headers: { 'x-api-key': superAdminKey },
      });
      expect(sysDelRes.statusCode).toBe(409);
      expect(sysDelRes.json().code).toBe('SYSTEM_ROLE_IMMUTABLE');
    });
  });
});
