import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { StaffAuthService } from '../../src/services/staff-auth.service';
import {
  clearScopeCache,
  invalidateScopeCache,
  isApiScopeAllowed,
  matchApiScopePrefix,
} from '../../src/services/role-scope.service';
import { prisma } from '../../src/db/client';

const FASE1_MIGRATION_PATH = path.resolve(
  __dirname,
  '../../prisma/migrations/20261118150000_seed_livechat_and_cs_operational_scopes/migration.sql'
);

const EXISTING_SEED_MIGRATIONS = [
  '20260926000002_add_role_api_scopes/migration.sql',
  '20260930000000_allow_push_for_therapist/migration.sql',
  '20261002000000_allow_meta_performance_for_advertiser/migration.sql',
  '20261002000001_allow_customer_service_for_advertiser/migration.sql',
  '20261106000000_allow_ctwa_catchers_for_advertiser/migration.sql',
  '20261108000000_seed_system_role_scopes/migration.sql',
  '20261114000000_add_admin_cs_spv_cs_operational_scopes/migration.sql',
  '20261114160000_seed_staff_operational_read_scopes/migration.sql',
  '20261118150000_seed_livechat_and_cs_operational_scopes/migration.sql',
  '20261118160000_reconcile_rbac_role_api_scopes/migration.sql',
];

interface ParsedScopeRow {
  role_key: string;
  api_prefix: string;
  methods: string;
}

/**
 * Parser deterministik untuk mengekstrak pasangan (role_key, api_prefix, methods)
 * dari migrasi SQL `role_api_scopes` (mendukung pola 2-kolom per blok role maupun 3-kolom).
 */
function parseRoleScopesFromSql(sql: string): ParsedScopeRow[] {
  const rows: ParsedScopeRow[] = [];
  // Split per statement INSERT INTO "role_api_scopes"
  const blocks = sql.split(/INSERT\s+INTO\s+"role_api_scopes"/i).slice(1);
  for (const block of blocks) {
    // 3-column VALUES: ('role_key', '/api/admin/...', 'METHODS')
    const threeColRe = /\(\s*'([a-z0-9_]+)'\s*,\s*'(\/api\/admin\/[^']+)'\s*,\s*'([^']+)'\s*\)/gi;
    let m: RegExpExecArray | null;
    let foundThree = false;
    while ((m = threeColRe.exec(block)) !== null) {
      foundThree = true;
      rows.push({ role_key: m[1].toLowerCase(), api_prefix: m[2], methods: m[3] });
    }
    if (foundThree) continue;

    // 2-column VALUES with one or more role literals in SELECT / CROSS JOIN VALUES ('admin_cs'), ('spv_cs')
    const roleKeys = Array.from(
      new Set(
        Array.from(block.matchAll(/'(admin_cs|spv_cs|therapist|advertiser)'/gi), (rm) => rm[1].toLowerCase())
      )
    );
    if (roleKeys.length === 0) continue;
    const twoColRe = /\(\s*'(\/api\/admin\/[^']+)'\s*,\s*'([^']+)'\s*\)/gi;
    while ((m = twoColRe.exec(block)) !== null) {
      for (const roleKey of roleKeys) {
        rows.push({ role_key: roleKey, api_prefix: m[1], methods: m[2] });
      }
    }
  }
  return rows;
}

function applyDeletesFromSql(sql: string, roleKey: string, map: Map<string, string>) {
  const deleteBlocks = sql.split(/DELETE\s+FROM\s+"role_api_scopes"/i).slice(1);
  for (const rawBlock of deleteBlocks) {
    const stmt = rawBlock.split(';')[0];
    // Cek apakah DELETE terbatas ke role tertentu
    const roleFilterMatch = stmt.match(/"role_key"\s+IN\s*\(([^)]+)\)/i);
    if (roleFilterMatch) {
      const targetRoles = Array.from(roleFilterMatch[1].matchAll(/'([a-z0-9_]+)'/gi), (m) => m[1].toLowerCase());
      if (!targetRoles.includes(roleKey)) continue;
    }
    const singlePrefix = stmt.match(/"api_prefix"\s*=\s*'(\/api\/admin\/[^']+)'/i);
    if (singlePrefix) {
      map.delete(singlePrefix[1]);
    }
    const inPrefixes = stmt.match(/"api_prefix"\s+IN\s*\(([^)]+)\)/i);
    if (inPrefixes) {
      for (const pm of inPrefixes[1].matchAll(/'(\/api\/admin\/[^']+)'/gi)) {
        map.delete(pm[1]);
      }
    }
  }
}

function loadMergedScopesForRole(roleKey: string): Array<{ api_prefix: string; methods: string }> {
  const map = new Map<string, string>();
  for (const rel of EXISTING_SEED_MIGRATIONS) {
    const full = path.resolve(__dirname, '../../prisma/migrations', rel);
    if (!fs.existsSync(full)) continue;
    const sql = fs.readFileSync(full, 'utf8');
    applyDeletesFromSql(sql, roleKey, map);
    for (const row of parseRoleScopesFromSql(sql)) {
      if (row.role_key === roleKey) {
        map.set(row.api_prefix, row.methods);
      }
    }
  }
  return Array.from(map.entries()).map(([api_prefix, methods]) => ({ api_prefix, methods }));
}

function mockStaffSession(role: 'ADMIN_CS' | 'SPV_CS' | 'THERAPIST' | 'ADVERTISER', tenantId = 'default-tenant') {
  vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue({
    staff: {
      id: `staff-${role.toLowerCase()}`,
      tenant_id: tenantId,
      name: role === 'ADMIN_CS' ? 'Bidan Yusi F' : 'Supervisor CS',
      phone: '628111222333',
      role,
      active: true,
      created_at: new Date(),
      updated_at: new Date(),
      telegram_chat_id: null,
    },
    session: {
      id: `sess-${role.toLowerCase()}`,
      staff_id: `staff-${role.toLowerCase()}`,
      token: 'valid_cs_token',
      expires_at: new Date(Date.now() + 86400000),
      created_at: new Date(),
    },
  } as any);
}

describe('RBAC Live Chat & Operational CS Contract (KNOWN #358 Fase 0+1)', () => {
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

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'test_super_admin_key_rbac_contract';
    clearScopeCache();
  });

  describe('1. matchApiScopePrefix (:param matcher & anti-eskalasi CD-03)', () => {
    it('cocok untuk prefix polos standar dan menolak prefix mirip sebagian', () => {
      expect(matchApiScopePrefix('/api/admin/live-chat', '/api/admin/live-chat')).toBe(true);
      expect(matchApiScopePrefix('/api/admin/live-chat/conversations/abc', '/api/admin/live-chat')).toBe(true);
      expect(matchApiScopePrefix('/api/admin/live-chat2/foo', '/api/admin/live-chat')).toBe(false);
    });

    it('mengizinkan DELETE kartu alamat via :id tanpa membocorkan DELETE /api/admin/customers/:id', () => {
      const pattern = '/api/admin/customers/:id/addresses';
      expect(matchApiScopePrefix('/api/admin/customers/cust-1/addresses/addr-2', pattern)).toBe(true);
      expect(matchApiScopePrefix('/api/admin/customers/cust-1/addresses', pattern)).toBe(true);

      // Anti-eskalasi CD-03: DELETE customer root WAJIB DITOLAK
      expect(matchApiScopePrefix('/api/admin/customers/cust-1', pattern)).toBe(false);
      expect(matchApiScopePrefix('/api/admin/customers', pattern)).toBe(false);

      // Adversarial: multi-segmen atau segmen kosong di posisi :id WAJIB DITOLAK
      expect(matchApiScopePrefix('/api/admin/customers/a/b/addresses/c', pattern)).toBe(false);
      expect(matchApiScopePrefix('/api/admin/customers//addresses/c', pattern)).toBe(false);
    });
  });

  describe('2. invalidateScopeCache produksi (V-07)', () => {
    it('mengosongkan cache tenant+role spesifik agar perubahan scope langsung berlaku', async () => {
      const findMany = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ api_prefix: '/api/admin/dispatch/trip', methods: 'GET' }]);
      (prisma as any).roleApiScope = { findMany };

      const first = await isApiScopeAllowed('tenant-a', 'admin_cs', '/api/admin/dispatch/trip/res-1', 'GET');
      expect(first.allowed).toBe(false);

      // Tanpa invalidate, hasil masih ter-cache
      const cached = await isApiScopeAllowed('tenant-a', 'admin_cs', '/api/admin/dispatch/trip/res-1', 'GET');
      expect(cached.allowed).toBe(false);
      expect(findMany).toHaveBeenCalledTimes(1);

      // Setelah invalidateScopeCache, DB dibaca ulang dan scope baru langsung aktif
      invalidateScopeCache('tenant-a', 'admin_cs');
      const refreshed = await isApiScopeAllowed('tenant-a', 'admin_cs', '/api/admin/dispatch/trip/res-1', 'GET');
      expect(refreshed.allowed).toBe(true);
      expect(findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('3. Kontrak Rute Operasional Live Chat & CS untuk ADMIN_CS dan SPV_CS', () => {
    const operationalCases: Array<{ label: string; method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; url: string; payload?: any }> = [
      // Kanonis /api/admin/live-chat/conversations/...
      { label: 'Kanonis Edit Pesan', method: 'PUT', url: '/api/admin/live-chat/conversations/conv-1/messages/msg-1/edit', payload: { text: 'Revisi teks' } },
      { label: 'Kanonis Tarik Pesan', method: 'DELETE', url: '/api/admin/live-chat/conversations/conv-1/messages/msg-1' },
      { label: 'Kanonis Mark Read', method: 'PATCH', url: '/api/admin/live-chat/conversations/conv-1/read', payload: {} },
      { label: 'Kanonis Mark Unread', method: 'PATCH', url: '/api/admin/live-chat/conversations/conv-1/unread', payload: {} },
      { label: 'Kanonis Pin Chat', method: 'PATCH', url: '/api/admin/live-chat/conversations/conv-1/pin', payload: { isPinned: true } },
      { label: 'Kanonis Release ke Bot', method: 'PATCH', url: '/api/admin/live-chat/conversations/conv-1/release', payload: {} },
      { label: 'Kanonis Takeover CS (PATCH)', method: 'PATCH', url: '/api/admin/live-chat/conversations/conv-1/takeover', payload: {} },
      // Alias lama (backward-compat PWA/browser cache CD-05)
      { label: 'Alias Lama Edit Pesan', method: 'PUT', url: '/api/admin/conversations/conv-1/messages/msg-1/edit', payload: { text: 'Revisi teks' } },
      { label: 'Alias Lama Tarik Pesan', method: 'DELETE', url: '/api/admin/conversations/conv-1/messages/msg-1' },
      { label: 'Alias Lama Mark Read', method: 'PATCH', url: '/api/admin/conversations/conv-1/read', payload: {} },
      { label: 'Alias Lama Mark Unread', method: 'PATCH', url: '/api/admin/conversations/conv-1/unread', payload: {} },
      { label: 'Alias Lama Pin Chat', method: 'PATCH', url: '/api/admin/conversations/conv-1/pin', payload: { isPinned: true } },
      { label: 'Alias Lama Release ke Bot', method: 'PATCH', url: '/api/admin/conversation/conv-1/release', payload: {} },
      { label: 'Alias Lama Takeover CS', method: 'PATCH', url: '/api/admin/conversation/conv-1/takeover', payload: {} },
      // Operasional CS di luar Live Chat (H-02a)
      { label: 'Widget Dispatch Trip', method: 'GET', url: '/api/admin/dispatch/trip/res-1' },
      { label: 'Follow-Up List', method: 'GET', url: '/api/admin/follow-ups' },
      { label: 'Follow-Up Queue Action', method: 'POST', url: '/api/admin/follow-ups/fu-1/queue', payload: {} },
      { label: 'Follow-Up Templates', method: 'GET', url: '/api/admin/follow-up-templates' },
      { label: 'Hapus Kartu Alamat Customer (CD-03)', method: 'DELETE', url: '/api/admin/customers/cust-1/addresses/addr-1' },
    ];

    for (const role of ['ADMIN_CS', 'SPV_CS'] as const) {
      it(`mengizinkan seluruh 19 rute operasional (bukan 403/404-route-missing) untuk ${role}`, async () => {
        expect(fs.existsSync(FASE1_MIGRATION_PATH)).toBe(true);
        const mergedScopes = loadMergedScopesForRole(role.toLowerCase());
        mockStaffSession(role);
        (prisma as any).roleApiScope = {
          findMany: vi.fn().mockResolvedValue(mergedScopes),
        };

        for (const tc of operationalCases) {
          const res = await app.inject({
            method: tc.method,
            url: tc.url,
            headers: {
              cookie: 'staff_session=valid_cs_token',
              'x-requested-with': 'XMLHttpRequest',
            },
            ...(tc.payload !== undefined ? { payload: tc.payload } : {}),
          });

          const body = (() => {
            try {
              return res.json();
            } catch {
              return {};
            }
          })();

          // Tidak boleh ditolak RBAC (403) dan rute kanonis wajib terdaftar (bukan Fastify 404 Route ... not found)
          expect(res.statusCode, `${role} kena 403 pada ${tc.label} (${tc.method} ${tc.url}): ${JSON.stringify(body)}`).not.toBe(403);
          expect(
            body?.message && String(body.message).startsWith('Route '),
            `Rute belum terdaftar di Fastify untuk ${tc.label} (${tc.method} ${tc.url})`
          ).toBeFalsy();
        }
      });
    }

    it('tetap FAIL-CLOSED (403) untuk ADMIN_CS pada endpoint Super Admin & DELETE customer root', async () => {
      const mergedScopes = loadMergedScopesForRole('admin_cs');
      mockStaffSession('ADMIN_CS');
      (prisma as any).roleApiScope = {
        findMany: vi.fn().mockResolvedValue(mergedScopes),
      };

      const forbiddenCases: Array<{ method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; payload?: any }> = [
        { method: 'GET', url: '/api/admin/backup/list' },
        { method: 'PATCH', url: '/api/admin/settings', payload: { globalBotActive: false } },
        { method: 'GET', url: '/api/admin/settings/notifications' },
        { method: 'POST', url: '/api/admin/ai-models/reset-defaults', payload: {} },
        { method: 'DELETE', url: '/api/admin/staff/staff-1' },
      ];

      for (const tc of forbiddenCases) {
        const res = await app.inject({
          method: tc.method,
          url: tc.url,
          headers: {
            cookie: 'staff_session=valid_cs_token',
            'x-requested-with': 'XMLHttpRequest',
          },
          ...(tc.payload !== undefined ? { payload: tc.payload } : {}),
        });
        expect(res.statusCode, `Harus 403 untuk ${tc.method} ${tc.url}`).toBe(403);
      }

      // CD-03: Verifikasi langsung pada seam isApiScopeAllowed bahwa DELETE customer root tetap DITOLAK
      const deleteRootCustomer = await isApiScopeAllowed(
        'default-tenant',
        'admin_cs',
        '/api/admin/customers/cust-1',
        'DELETE'
      );
      expect(deleteRootCustomer.allowed).toBe(false);
    });
  });

  describe('4. Invariant Anti-Orphan & Anti-Kontradiksi pada Migrasi Baru Fase 1 (A-010)', () => {
    it('setiap baris api_prefix di migrasi Fase 1 cocok dengan >= 1 rute Fastify terdaftar', async () => {
      await app.ready();
      expect(fs.existsSync(FASE1_MIGRATION_PATH)).toBe(true);
      const sql = fs.readFileSync(FASE1_MIGRATION_PATH, 'utf8');
      const rows = parseRoleScopesFromSql(sql);
      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        const scopeMethods = row.methods.split(',').map((s) => s.trim().toUpperCase());
        const matched = registeredRoutes.some((rt) => {
          // Normalisasi parameter Fastify (:id, :messageId, dll.) ke nilai dummy untuk diuji terhadap matcher
          const sampleUrl = rt.url.replace(/:([a-zA-Z0-9_]+)/g, 'sample-id');
          const pathOk = matchApiScopePrefix(sampleUrl, row.api_prefix);
          if (!pathOk) return false;
          return scopeMethods.includes('*') || scopeMethods.includes(rt.method);
        });
        expect(
          matched,
          `ORPHAN SCOPE terdeteksi di migrasi Fase 1: role=${row.role_key} prefix=${row.api_prefix} methods=${row.methods}`
        ).toBe(true);
      }
    });

    it('GLOBAL ZERO-ORPHAN (Fase 3 / H-03): seluruh baris akhir role_api_scopes lintas 4 role cocok dengan >= 1 rute Fastify', async () => {
      await app.ready();
      for (const role of ['admin_cs', 'spv_cs', 'advertiser', 'therapist'] as const) {
        const scopes = loadMergedScopesForRole(role);
        expect(scopes.length).toBeGreaterThan(0);
        for (const row of scopes) {
          const scopeMethods = row.methods.split(',').map((s) => s.trim().toUpperCase());
          const matched = registeredRoutes.some((rt) => {
            const sampleUrl = rt.url.replace(/:([a-zA-Z0-9_]+)/g, 'sample-id');
            if (!matchApiScopePrefix(sampleUrl, row.api_prefix)) return false;
            return scopeMethods.includes('*') || scopeMethods.includes(rt.method);
          });
          expect(
            matched,
            `GLOBAL ORPHAN terdeteksi setelah migrasi Fase 3: role=${role} prefix=${row.api_prefix} methods=${row.methods}`
          ).toBe(true);
        }
        // CD-02: settings/notifications tidak boleh lagi tersisa di scope CS
        if (role === 'admin_cs' || role === 'spv_cs') {
          expect(scopes.some((s) => s.api_prefix === '/api/admin/settings/notifications')).toBe(false);
        }
      }
    });
  });

  describe('5. Kontrak Fase 3: K-1..K-6, A-002 (Deny Subpath), A-003 (Brand di /auth/me), & H-02b', () => {
    it('A-002 / K-6 / CD-01: ADMIN_CS diblokir 403 pada approve/reject/unreject-purchase & sync-full, namun tetap boleh DELETE /reservation/:id', async () => {
      const mergedScopes = loadMergedScopesForRole('admin_cs');
      mockStaffSession('ADMIN_CS');
      (prisma as any).roleApiScope = { findMany: vi.fn().mockResolvedValue(mergedScopes) };

      const restricted = [
        '/api/admin/reservation/res-1/approve-purchase',
        '/api/admin/reservation/res-1/reject-purchase',
        '/api/admin/reservation/res-1/unreject-purchase',
        '/api/admin/live-chat/sync-full',
      ];
      for (const url of restricted) {
        const res = await app.inject({
          method: 'POST',
          url,
          headers: { cookie: 'staff_session=valid_cs_token', 'x-requested-with': 'XMLHttpRequest' },
          payload: {},
        });
        expect(res.statusCode, `K-6 harus 403 untuk POST ${url}`).toBe(403);
        expect(res.json().code).toBe('FORBIDDEN_STAFF_ROLE');
      }

      // CD-01: DELETE /api/admin/reservation/:id tetap lolos RBAC (bukan 403)
      const delRes = await app.inject({
        method: 'DELETE',
        url: '/api/admin/reservation/res-1',
        headers: { cookie: 'staff_session=valid_cs_token', 'x-requested-with': 'XMLHttpRequest' },
      });
      expect(delRes.statusCode).not.toBe(403);
    });

    it('H-02b + K-3 + K-4 + K-1: ADMIN_CS boleh GET payment-info, pricelist-image, customer-service, POST copilot; ditolak POST customer-service & GET financial-analytics', async () => {
      const mergedScopes = loadMergedScopesForRole('admin_cs');
      mockStaffSession('ADMIN_CS');
      (prisma as any).roleApiScope = { findMany: vi.fn().mockResolvedValue(mergedScopes) };

      for (const url of ['/api/admin/settings/payment-info', '/api/admin/settings/pricelist-image', '/api/admin/customer-service']) {
        const res = await app.inject({
          method: 'GET',
          url,
          headers: { cookie: 'staff_session=valid_cs_token' },
        });
        expect(res.statusCode, `Harus bukan 403 untuk GET ${url}`).not.toBe(403);
      }

      // K-3 Opsi C: POST /api/admin/customer-service tetap 403 FORBIDDEN_SUPER_ADMIN_ONLY_WRITE
      const postCs = await app.inject({
        method: 'POST',
        url: '/api/admin/customer-service',
        headers: { cookie: 'staff_session=valid_cs_token', 'x-requested-with': 'XMLHttpRequest' },
        payload: { csName: 'Hack' },
      });
      expect(postCs.statusCode).toBe(403);
      expect(postCs.json().code).toBe('FORBIDDEN_SUPER_ADMIN_ONLY_WRITE');

      // K-1: GET /api/admin/financial-analytics tetap 403 untuk ADMIN_CS
      const finCs = await app.inject({
        method: 'GET',
        url: '/api/admin/financial-analytics',
        headers: { cookie: 'staff_session=valid_cs_token' },
      });
      expect(finCs.statusCode).toBe(403);

      // K-4: POST /api/admin/copilot/chat lolos RBAC untuk ADMIN_CS (bukan 403)
      const copilotCs = await app.inject({
        method: 'POST',
        url: '/api/admin/copilot/chat',
        headers: { cookie: 'staff_session=valid_cs_token', 'x-requested-with': 'XMLHttpRequest' },
        payload: { message: 'halo' },
      });
      expect(copilotCs.statusCode).not.toBe(403);
    });

    it('A-003 / K-2: GET /api/admin/auth/me menyertakan brand non-rahasia untuk THERAPIST tanpa butuh /api/admin/settings', async () => {
      mockStaffSession('THERAPIST');
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/auth/me',
        headers: { cookie: 'staff_session=valid_cs_token' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.brand).toBeDefined();
      expect(typeof body.brand.businessName).toBe('string');
      expect(body.brand.businessName.length).toBeGreaterThan(0);
    });

    it('K-5: ADVERTISER boleh GET landings, capi-queue, health, customer-service, namun tetap 403 pada approve-purchase & /debug', async () => {
      const mergedScopes = loadMergedScopesForRole('advertiser');
      mockStaffSession('ADVERTISER');
      (prisma as any).roleApiScope = { findMany: vi.fn().mockResolvedValue(mergedScopes) };

      for (const url of ['/api/admin/landings', '/api/admin/capi-queue', '/api/admin/health', '/api/admin/customer-service']) {
        const res = await app.inject({
          method: 'GET',
          url,
          headers: { cookie: 'staff_session=valid_cs_token' },
        });
        expect(res.statusCode, `ADVERTISER harus bukan 403 untuk GET ${url}`).not.toBe(403);
      }

      const approve = await app.inject({
        method: 'POST',
        url: '/api/admin/reservation/res-1/approve-purchase',
        headers: { cookie: 'staff_session=valid_cs_token', 'x-requested-with': 'XMLHttpRequest' },
        payload: {},
      });
      expect(approve.statusCode).toBe(403);
    });
  });
});
