import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app';
import type { FastifyInstance } from 'fastify';

describe('Admin & Staff Authz Matrix — 100% Route Security Check (#299-F)', () => {
  let app: FastifyInstance;
  const adminStaffRoutes: Array<{ method: string; path: string }> = [];

  // Allowlist resmi: endpoint publik atau pre-auth yang sah tanpa kredensial
  const ALLOWLIST = new Set([
    'POST:/api/admin/auth/login',     // Autentikasi login admin
    'POST:/api/admin/auth/logout',    // Logout admin (idempoten)
    'POST:/api/admin/auth/restore',   // Pemulihan sesi admin
    'GET:/api/admin/auth/me',         // Pengecekan profil sesi publik admin (return 401/null user)
    'POST:/api/staff/auth/login',     // Autentikasi login staf (therapist)
    'POST:/api/staff/auth/logout',    // Logout staf (idempoten)
    'POST:/api/staff/auth/restore',   // Pemulihan token sesi staf (pre-auth)
  ]);

  beforeAll(async () => {
    process.env.ADMIN_API_KEY = 'test_matrix_secret_key_123';
    app = buildApp();
    await app.ready();

    // Pohon rute diambil LANGSUNG dari app yang sedang diuji (bukan snapshot
    // dokumen). `commonPrefix: false` wajib: format default Fastify memecah
    // path menjadi fragmen radix (`/`, `a`, `dmin`, ...), sehingga path utuh
    // tidak bisa direkonstruksi. Dengan commonPrefix:false setiap baris sudah
    // berisi path lengkap. (Regresi #299-F: sebelumnya test ini membaca
    // snapshot docs/audit/.../routes-tree.txt sehingga gagal di checkout bersih.)
    const routesTreeContent = app.printRoutes({ commonPrefix: false });

    const lines = routesTreeContent.split('\n').filter((l) => l.trim().length > 0);
    const stack: Array<{ depth: number; segment: string }> = [];
    const seen = new Set<string>();

    for (const line of lines) {
      const matchBranch = line.match(/^([│\s]*[├└]──\s*)(.*)$/);
      if (!matchBranch) continue;

      const prefixSymbols = matchBranch[1];
      const rest = matchBranch[2];
      const depth = prefixSymbols.length;

      const methodMatch = rest.match(/^(.*?)\s*\(([^)]+)\)$/);
      if (!methodMatch) continue;

      const segment = methodMatch[1].trim();
      const methods = methodMatch[2].split(',').map((m) => m.trim());

      while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
        stack.pop();
      }

      const parentPath = stack.map((s) => s.segment).join('');
      let fullPath = (parentPath + segment).replace(/\/+/g, '/');
      if (fullPath.length > 1 && fullPath.endsWith('/')) {
        fullPath = fullPath.slice(0, -1);
      }

      stack.push({ depth, segment });

      if (fullPath.startsWith('/api/admin/') || fullPath.startsWith('/api/staff/')) {
        for (const method of methods) {
          if (method === 'HEAD') continue;
          const key = `${method}:${fullPath}`;
          if (seen.has(key)) continue;
          seen.add(key);
          adminStaffRoutes.push({ method, path: fullPath });
        }
      }
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('menemukan dan memindai seluruh rute admin dan staf', () => {
    // Baseline riil saat ini: 313 pasangan method+path (266 path unik).
    // Ambang 250 menjaga test tetap ketat tanpa rapuh saat rute bertambah.
    expect(adminStaffRoutes.length).toBeGreaterThan(250);
  });

  it('100% rute non-allowlist menolak akses tanpa kredensial (401 atau 403)', async () => {
    const unauthenticatedLeakedRoutes: string[] = [];

    let idx = 0;
    for (const route of adminStaffRoutes) {
      idx++;
      const key = `${route.method}:${route.path}`;
      if (ALLOWLIST.has(key)) {
        continue;
      }

      // Ganti path parameter :id, :slug, dll dengan dummy id
      const testPath = route.path.replace(/:[a-zA-Z0-9_-]+/g, 'dummy-id-123');

      // Rotasi remoteAddress virtual agar rate limiter per-IP tidak tersulut
      const virtualIp = `10.99.${Math.floor(idx / 20)}.${(idx % 20) + 1}`;

      const res = await app.inject({
        method: route.method as any,
        url: testPath,
        remoteAddress: virtualIp,
        // TANPA header x-api-key dan TANPA cookie staff_session
      });

      // Rute admin/staff WAJIB 401 (Unauthorized) atau 403 (Forbidden)
      if (res.statusCode !== 401 && res.statusCode !== 403) {
        unauthenticatedLeakedRoutes.push(
          `${key} -> returned ${res.statusCode} (body: ${res.body.slice(0, 100)})`
        );
      }
    }

    if (unauthenticatedLeakedRoutes.length > 0) {
      console.error('RUTE BOCOR TANPA OTORISASI:', unauthenticatedLeakedRoutes);
    }

    expect(unauthenticatedLeakedRoutes).toEqual([]);
  }, 30000);
});
