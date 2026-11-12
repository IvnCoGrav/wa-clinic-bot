import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../src/app';

/**
 * Ar-005 — kejujuran degradasi DB pada route admin.
 *
 * Sebelumnya beberapa route mengembalikan `200 { success: true, data: [] }`
 * saat database gagal. Admin bisa menyimpulkan "tidak ada data" padahal
 * sistem sedang rusak. Kontrak baru:
 * - produksi  → 503 + `code: 'DATABASE_UNAVAILABLE'`
 * - non-produksi → 200 + `degraded: true` (agar simulator/test tetap jalan)
 */

const adminKey = 'test_admin_key_ar005';
const app = buildApp();
const oldNodeEnv = process.env.NODE_ENV;

const ROUTES = [
  '/api/admin/settings/notifications/logs',
  '/api/admin/medical-faq-staging',
  '/api/admin/general-faq-staging',
  '/api/admin/customers/flagged',
  '/api/admin/ai-evaluations',
  '/api/admin/ai-audit-summary',
  '/api/admin/debug/meta-manual-history',
];

beforeEach(() => {
  // Jangan vi.restoreAllMocks(): mock `src/db/client` disiapkan di tests/setup.ts
  // sebagai vi.fn().mockRejectedValue — restore akan menghapus implementasinya
  // dan route malah "sukses" dengan data undefined.
  vi.clearAllMocks();
  process.env.ADMIN_API_KEY = adminKey;
  process.env.NODE_ENV = 'production';
});

afterEach(() => {
  process.env.NODE_ENV = oldNodeEnv;
});

describe('produksi: DB gagal tidak boleh berpura-pura sukses', () => {
  for (const url of ROUTES) {
    it(`${url} → 503 DATABASE_UNAVAILABLE`, async () => {
      const res = await app.inject({
        method: 'GET',
        url,
        headers: { 'x-api-key': adminKey },
      });

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.code).toBe('DATABASE_UNAVAILABLE');
      expect(body.data).toBeUndefined();
    });
  }
});

describe('non-produksi: degradasi eksplisit (bukan diam-diam)', () => {
  for (const url of ROUTES) {
    it(`${url} → 200 degraded:true`, async () => {
      process.env.NODE_ENV = 'test';
      const res = await app.inject({
        method: 'GET',
        url,
        headers: { 'x-api-key': adminKey },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().degraded).toBe(true);
    });
  }
});
