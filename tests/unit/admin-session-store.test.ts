import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import {
  AdminSessionService,
  SessionStoreUnavailable,
  hashAdminToken,
} from '../../src/services/admin-session.service';
import { prisma } from '../../src/db/client';

/**
 * Kontrak sinyal penyimpanan sesi admin (anti-logout paksa pasca-sec-audit).
 *
 * Akar bug: validateSession() me-return null tunggal untuk "token invalid"
 * DAN "DB sedang mati" → backend tak bisa membedakan 401 vs 503 → frontend
 * menghapus token cadangan → user ditendang padahal sesi 30-hari di DB sah.
 *
 * Kontrak baru:
 * - DB error + tanpa entri memori  → LEMPAR SessionStoreUnavailable (→ 503)
 * - DB error + entri memori ada    → tetap valid (fallback offline/dev)
 * - DB sehat: invalid/kedaluwarsa → null (→ 401 yang jujur)
 * - Hot cache keyed-by-hash: validate berulang tidak memukul DB;
 *   destroy meng-invalidate cache (tak ada sesi basi setelah logout).
 */
const uniqToken = () => crypto.randomBytes(32).toString('hex');

describe('Admin Session Store Signal Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DB error + tanpa memori → melempar SessionStoreUnavailable, BUKAN null', async () => {
    (prisma as any).adminSession = {
      create: vi.fn(),
      findUnique: vi.fn().mockRejectedValue(new Error('connection pool timeout')),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    };

    // Sebelum fix: resolve(null) → 401 ambigu → token frontend dibuang.
    await expect(AdminSessionService.validateSession(uniqToken())).rejects.toThrow(
      SessionStoreUnavailable
    );
  });

  it('DB error TAPI sesi ada di memori (dibuat saat offline) → tetap valid, tanpa lempar', async () => {
    (prisma as any).adminSession = {
      create: vi.fn().mockRejectedValue(new Error('Database offline')),
      findUnique: vi.fn().mockRejectedValue(new Error('Database offline')),
      delete: vi.fn().mockRejectedValue(new Error('Database offline')),
      deleteMany: vi.fn().mockRejectedValue(new Error('Database offline')),
    };

    const session = await AdminSessionService.createSession('Offline Admin');
    const validated = await AdminSessionService.validateSession(session.token);
    expect(validated?.adminIdentity).toBe('Offline Admin');
  });

  it('DB sehat, token tidak ada di DB → null (401 jujur, bukan 503)', async () => {
    (prisma as any).adminSession = {
      create: vi.fn(),
      findUnique: vi.fn(async () => null),
      delete: vi.fn(),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    };

    expect(await AdminSessionService.validateSession(uniqToken())).toBeNull();
  });

  it('DB sehat, sesi kedaluwarsa → null + baris dibersihkan (bukan 503)', async () => {
    const store = new Map<string, any>();
    (prisma as any).adminSession = {
      create: vi.fn(),
      findUnique: vi.fn(async ({ where }: any) => store.get(where.token_hash) || null),
      delete: vi.fn(async ({ where }: any) => {
        store.delete(where.token_hash);
        return { token_hash: where.token_hash };
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    };

    const expired = new Date(Date.now() - 60_000);
    const token = uniqToken();
    store.set(hashAdminToken(token), {
      id: 'adm-exp',
      admin_identity: 'Expiry Tester',
      created_at: new Date(Date.now() - 120_000),
      expires_at: expired,
      revoked_at: null,
    });

    expect(await AdminSessionService.validateSession(token)).toBeNull();
    expect(store.size).toBe(0);
  });

  it('hot cache: validate berulang hanya memukul DB sekali', async () => {
    const store = new Map<string, any>();
    (prisma as any).adminSession = {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: 'adm-cache', ...data, created_at: new Date(), revoked_at: null };
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

    const session = await AdminSessionService.createSession('Cache Tester');

    const first = await AdminSessionService.validateSession(session.token);
    const second = await AdminSessionService.validateSession(session.token);
    const third = await AdminSessionService.validateSession(session.token);

    expect(first?.adminIdentity).toBe('Cache Tester');
    expect(second?.adminIdentity).toBe('Cache Tester');
    expect(third?.adminIdentity).toBe('Cache Tester');
    // Sebelum fix: 3 panggilan findUnique (1 per request).
    expect((prisma as any).adminSession.findUnique).toHaveBeenCalledTimes(1);
  });

  it('destroy meng-invalidate cache: sesi basi tak bertahan setelah logout', async () => {
    const store = new Map<string, any>();
    (prisma as any).adminSession = {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: 'adm-dest', ...data, created_at: new Date(), revoked_at: null };
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

    const session = await AdminSessionService.createSession('Destroy Tester');
    expect(await AdminSessionService.validateSession(session.token)).not.toBeNull();

    expect(await AdminSessionService.destroySession(session.token)).toBe(true);

    // Harus null — bukan sesi basi dari cache (tombstone + invalidasi cache).
    const after = await AdminSessionService.validateSession(session.token);
    expect(after).toBeNull();
    expect(store.size).toBe(0);
  });

  it('sinyal 503 vs 401 tetap terjaga saat memory fallback tercampur', async () => {
    // Sesi valid ada di memori (DB pernah offline saat login), lalu DB kembali error.
    (prisma as any).adminSession = {
      create: vi.fn().mockRejectedValue(new Error('Database offline')),
      findUnique: vi.fn().mockRejectedValue(new Error('connection pool timeout')),
      delete: vi.fn().mockRejectedValue(new Error('Database offline')),
      deleteMany: vi.fn().mockRejectedValue(new Error('Database offline')),
    };
    const session = await AdminSessionService.createSession('Mixed Fallback');
    // Entri memori masih ada → sah (jangan melempar 503 atas sesi yang valid).
    const valid = await AdminSessionService.validateSession(session.token);
    expect(valid?.adminIdentity).toBe('Mixed Fallback');

    // Token asing, DB error → 503.
    await expect(AdminSessionService.validateSession(uniqToken())).rejects.toThrow(
      SessionStoreUnavailable
    );
  });

  it('sesi sudah di-destroy lalu DB mati → null (401 jujur), bukan 503 loop', async () => {
    const store = new Map<string, any>();
    const dbFailing = { failing: false };
    (prisma as any).adminSession = {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: 'adm-tomb', ...data, created_at: new Date(), revoked_at: null };
        store.set(data.token_hash, row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        if (dbFailing.failing) throw new Error('connection pool timeout');
        return store.get(where.token_hash) || null;
      }),
      delete: vi.fn(async ({ where }: any) => {
        const row = store.get(where.token_hash);
        if (!row) throw new Error('Record not found');
        store.delete(where.token_hash);
        return row;
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    };

    const session = await AdminSessionService.createSession('Tombstone Tester');
    expect(await AdminSessionService.validateSession(session.token)).not.toBeNull();
    expect(await AdminSessionService.destroySession(session.token)).toBe(true);

    // DB tumbang SETELAH logout: hash ada di tombstone → null (401), jangan 503.
    dbFailing.failing = true;
    expect(await AdminSessionService.validateSession(session.token)).toBeNull();
  });
});
