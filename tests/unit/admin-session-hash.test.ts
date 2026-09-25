import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AdminSessionService, hashAdminToken } from '../../src/services/admin-session.service';
import { prisma } from '../../src/db/client';

/**
 * SEC-AUDIT-02 adversarial: sesi admin tak pernah persist dalam bentuk plaintext.
 * - Jalur DB: yang tersimpan hanya SHA-256 hash (pola StaffSession).
 * - Jalur DB-offline: fallback memori keyed-by-hash, tanpa file di disk.
 * - Token salah / sesi dihancurkan → null.
 */
describe('Admin Session Hash Storage (SEC-AUDIT-02)', () => {
  const legacyFile = path.join(process.cwd(), 'storage', 'admin_sessions.json');

  beforeEach(() => {
    vi.clearAllMocks();
    if (fs.existsSync(legacyFile)) fs.rmSync(legacyFile);
  });

  describe('jalur database (hash, bukan plaintext)', () => {
    const store = new Map<string, any>();

    beforeEach(() => {
      store.clear();
      (prisma as any).adminSession = {
        create: vi.fn(async ({ data }: any) => {
          const row = { id: 'adm-1', ...data, created_at: new Date(), revoked_at: null };
          store.set(data.token_hash, row);
          return row;
        }),
        findUnique: vi.fn(async ({ where }: any) => store.get(where.token_hash) || null),
        delete: vi.fn(async ({ where }: any) => {
          const row = store.get(where.token_hash);
          if (!row) throw new Error('Record not found');
          store.delete(where.token_hash);
          return row;
        }),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      };
    });

    it('create → validate roundtrip, yang tersimpan hanya hash', async () => {
      const session = await AdminSessionService.createSession('Audit Tester');
      expect(session.token).toHaveLength(64);

      const stored = Array.from(store.values());
      expect(stored).toHaveLength(1);
      // Bukti anti-plaintext: tidak ada field/nilai yang sama dengan token mentah.
      expect(JSON.stringify(stored[0])).not.toContain(session.token);
      expect(stored[0].token_hash).toBe(hashAdminToken(session.token));
      expect(stored[0].token_hash).toBe(crypto.createHash('sha256').update(session.token).digest('hex'));

      const validated = await AdminSessionService.validateSession(session.token);
      expect(validated?.adminIdentity).toBe('Audit Tester');
    });

    it('token salah → null; destroy → validate null', async () => {
      const session = await AdminSessionService.createSession('Audit Tester');
      expect(await AdminSessionService.validateSession('token-salah')).toBeNull();
      expect(await AdminSessionService.destroySession(session.token)).toBe(true);
      expect(await AdminSessionService.validateSession(session.token)).toBeNull();
    });

    it('tidak pernah menulis berkas plaintext legacy', async () => {
      await AdminSessionService.createSession('Audit Tester');
      expect(fs.existsSync(legacyFile)).toBe(false);
    });
  });

  describe('jalur DB-offline (fallback memori, tanpa disk)', () => {
    beforeEach(() => {
      (prisma as any).adminSession = {
        create: vi.fn().mockRejectedValue(new Error('Database offline')),
        findUnique: vi.fn().mockRejectedValue(new Error('Database offline')),
        delete: vi.fn().mockRejectedValue(new Error('Database offline')),
        deleteMany: vi.fn().mockRejectedValue(new Error('Database offline')),
      };
    });

    it('login → validate → logout tetap jalan tanpa DB dan tanpa file', async () => {
      const session = await AdminSessionService.createSession('Offline Admin');
      expect(await AdminSessionService.validateSession(session.token)).not.toBeNull();
      expect(await AdminSessionService.destroySession(session.token)).toBe(true);
      expect(await AdminSessionService.validateSession(session.token)).toBeNull();
      expect(fs.existsSync(legacyFile)).toBe(false);
    });
  });
});
