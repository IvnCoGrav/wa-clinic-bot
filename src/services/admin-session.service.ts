import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { prisma } from '../db/client';

export interface AdminSession {
  id: string;
  /** Token mentah — hanya diisi saat create/validate, TIDAK PERNAH dipersist. */
  token: string;
  adminIdentity: string;
  createdAt: Date;
  expiresAt: Date;
}

// 30-day TTL for stable sessions (prevents unexpected logouts)
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 Days

// SEC-AUDIT-02: hanya hash yang disimpan (DB `admin_sessions` / fallback memori).
// Berkas plaintext legacy `storage/admin_sessions.json` tidak lagi dibaca/ditulis.
const LEGACY_STORAGE_FILE = path.join(process.cwd(), 'storage', 'admin_sessions.json');

/**
 * Sinyal "penyimpanan sesi (DB) sedang tidak tersedia" — BUKAN "token invalid".
 *
 * Kontrak anti-logout-paksa: route auth WAJIB memetakan error ini ke HTTP 503,
 * bukan 401. Sebelumnya validateSession() me-return null tunggal untuk kedua
 * kasus → 401 ambigu → frontend menghapus token cadangan localStorage padahal
 * sesi 30-hari di DB masih sah (laporan "dashboard sering keluar sendiri").
 */
export class SessionStoreUnavailable extends Error {
  readonly code = 'SESSION_STORE_UNAVAILABLE';
  constructor(message = 'Penyimpanan sesi admin (database) tidak tersedia') {
    super(message);
    this.name = 'SessionStoreUnavailable';
  }
}

export function hashAdminToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

interface MemoryEntry {
  id: string;
  adminIdentity: string;
  createdAt: Date;
  expiresAt: Date;
}

// Fallback keyed by token HASH (bukan token mentah), untuk mode DB-offline/test.
// Ephemeral (memori proses) — tidak ada rahasia yang mendarat di disk.
const memoryFallback = new Map<string, MemoryEntry>();

function readMemory(hash: string, token: string): AdminSession | null {
  const entry = memoryFallback.get(hash);
  if (!entry) return null;
  if (new Date() > entry.expiresAt) {
    memoryFallback.delete(hash);
    return null;
  }
  return { ...entry, token };
}

// Hapus sisa file plaintext legacy sekali saat boot (best-effort, sekali jalan).
try {
  if (fs.existsSync(LEGACY_STORAGE_FILE)) {
    fs.unlinkSync(LEGACY_STORAGE_FILE);
    console.log('[ADMIN SESSION] Legacy plaintext storage/admin_sessions.json removed.');
  }
} catch {
  // Abaikan — file akan ditimpa alur baru (tidak dibaca lagi).
}

// --- Hot cache sesi (Fase 2, anti-logout-paksa) ---
// Sebelumnya SETIAP request admin memicu 1× findUnique (`preHandler`, /me,
// /restore, media) — pemanggilan DB per-request inilah yang membuat 401 ambigu
// saat DB lambat/jenuh. Cache keyed-by token HASH (bukan token mentah),
// TTL singkat agar revokasi tetap responsif, tanpa negative cache.
interface SessionCacheEntry {
  id: string;
  adminIdentity: string;
  createdAt: Date;
  expiresAt: Date;
  cachedAt: number;
}

const SESSION_CACHE_TTL_MS = 120 * 1000; // 2 menit: cukup menutup request burst, revokasi tetap cepat
const SESSION_CACHE_MAX_ENTRIES = 2000;
const sessionCache = new Map<string, SessionCacheEntry>();

// Tombstone: hash yang baru saja di-destroy secara eksplisit (logout). Kita MEMANG
// baru menghapusnya, jadi null (401) adalah jawaban yang jujur bahkan saat DB sedang
// mati — tanpa memicu loop 503 pada sesi yang sudah logout. TTL > TTL cache sehingga
// tak ada jendela cache-basi yang lolos.
const SESSION_TOMBSTONE_MS = 10 * 60 * 1000;
const destroyedHashes = new Map<string, number>();

function isRecentlyDestroyed(hash: string): boolean {
  const at = destroyedHashes.get(hash);
  if (at === undefined) return false;
  if (Date.now() - at > SESSION_TOMBSTONE_MS) {
    destroyedHashes.delete(hash);
    return false;
  }
  return true;
}

function readSessionCache(hash: string, token: string): AdminSession | null {
  const entry = sessionCache.get(hash);
  if (!entry) return null;
  const now = Date.now();
  if (now - entry.cachedAt > SESSION_CACHE_TTL_MS || now > entry.expiresAt.getTime()) {
    sessionCache.delete(hash);
    return null;
  }
  // Sentuh entri (LRU): pindah ke urutan terakhir untuk eviction yang adil.
  sessionCache.delete(hash);
  sessionCache.set(hash, { ...entry, cachedAt: now });
  const { cachedAt: _cachedAt, ...rest } = entry;
  return { ...rest, token };
}

function writeSessionCache(hash: string, session: Omit<AdminSession, 'token'>): void {
  if (sessionCache.size >= SESSION_CACHE_MAX_ENTRIES) {
    const oldestKey = sessionCache.keys().next().value;
    if (oldestKey !== undefined) sessionCache.delete(oldestKey);
  }
  sessionCache.set(hash, { ...session, cachedAt: Date.now() });
}

// Observabilitas: outage sesi harus terlihat di log, tapi jangan membanjiri.
let lastStoreUnavailableLogAt = 0;
function logStoreUnavailable(err: unknown): void {
  const now = Date.now();
  if (now - lastStoreUnavailableLogAt < 60_000) return;
  lastStoreUnavailableLogAt = now;
  console.warn(
    `[ADMIN SESSION] Penyimpanan sesi tidak tersedia (akan di throttle 60s): ${
      err instanceof Error ? err.message : String(err)
    }`
  );
}

export class AdminSessionService {
  /**
   * Generates a cryptographically secure random session token (32 bytes = 64 hex chars).
   * Hanya SHA-256 hash yang dipersist ke database; token mentah hanya dikembalikan sekali ke caller.
   */
  static async createSession(adminIdentity = 'System Admin'): Promise<AdminSession> {
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

    try {
      const created = await prisma.adminSession.create({
        data: {
          token_hash: hashAdminToken(token),
          admin_identity: adminIdentity,
          expires_at: expiresAt,
        },
      });
      console.log(`[ADMIN SESSION CREATED] Session issued for ${adminIdentity}. Expires: ${expiresAt.toISOString()}`);
      return {
        id: created.id,
        token,
        adminIdentity: created.admin_identity,
        createdAt: created.created_at,
        expiresAt: created.expires_at,
      };
    } catch (err) {
      // DB offline (dev/test) → sesi ephemeral di memori, tetap tanpa jejak plaintext di disk.
      const entry: MemoryEntry = { id: crypto.randomUUID(), adminIdentity, createdAt: now, expiresAt };
      memoryFallback.set(hashAdminToken(token), entry);
      console.log(`[ADMIN SESSION CREATED] (memory fallback, DB offline) Session issued for ${adminIdentity}.`);
      return { ...entry, token };
    }
  }

  /**
   * Validates a session token by hash lookup.
   *
   * Kontrak sinyal (WAJIB dipetakan route → HTTP):
   * - SessionStoreUnavailable → 503 (DB tak bisa dicek; jangan klaim token invalid)
   * - null                    → 401 (token benar-benar tidak ada / kedaluwarsa / direvoke)
   */
  static async validateSession(token: string): Promise<AdminSession | null> {
    if (!token || typeof token !== 'string') return null;
    const hash = hashAdminToken(token);
    if (isRecentlyDestroyed(hash)) return null;

    const cached = readSessionCache(hash, token);
    if (cached) return cached;

    let dbReachable = true;
    try {
      const session = await prisma.adminSession.findUnique({ where: { token_hash: hash } });
      if (session && !session.revoked_at && session.expires_at > new Date()) {
        const valid: AdminSession = {
          id: session.id,
          token,
          adminIdentity: session.admin_identity,
          createdAt: session.created_at,
          expiresAt: session.expires_at,
        };
        writeSessionCache(hash, {
          id: valid.id,
          adminIdentity: valid.adminIdentity,
          createdAt: valid.createdAt,
          expiresAt: valid.expiresAt,
        });
        return valid;
      }
      if (session) {
        // Kedaluwarsa/direvoke → fakta definitif dari DB: 401 yang jujur.
        await prisma.adminSession.delete({ where: { token_hash: hash } }).catch(() => {});
        return null;
      }
      // Baris tidak ada di DB yang sehat → 401 yang jujur (jatuh ke memori dulu di bawah,
      // untuk sesi yang memang dibuat lewat fallback offline).
    } catch (err) {
      // DB error (pool jenuh/timeout/mati) → BUKAN bukti token invalid.
      dbReachable = false;
      logStoreUnavailable(err);
    }

    const mem = readMemory(hash, token);
    if (mem) return mem;
    if (!dbReachable) throw new SessionStoreUnavailable();
    return null;
  }

  /**
   * Destroys an active session (Logout)
   */
  static async destroySession(token: string): Promise<boolean> {
    if (!token) return false;
    const hash = hashAdminToken(token);
    let revoked = false;
    try {
      await prisma.adminSession.delete({ where: { token_hash: hash } });
      revoked = true;
    } catch {
      // Baris tidak ada / DB offline — lanjut ke fallback memori.
    }
    sessionCache.delete(hash);
    destroyedHashes.set(hash, Date.now());
    if (destroyedHashes.size > 5000) {
      const oldestKey = destroyedHashes.keys().next().value;
      if (oldestKey !== undefined) destroyedHashes.delete(oldestKey);
    }
    if (memoryFallback.delete(hash)) revoked = true;
    if (revoked) {
      console.log(`[ADMIN SESSION DESTROYED] Session ${token.substring(0, 8)}... logged out.`);
    }
    return revoked;
  }

  /**
   * Cleans up expired sessions periodically
   */
  static async cleanupExpiredSessions(): Promise<void> {
    try {
      await prisma.adminSession.deleteMany({ where: { expires_at: { lt: new Date() } } });
    } catch {
      // DB offline — hanya bersihkan fallback memori.
    }
    const now = new Date();
    for (const [hash, entry] of memoryFallback.entries()) {
      if (now > entry.expiresAt) memoryFallback.delete(hash);
    }
    for (const [hash, entry] of sessionCache.entries()) {
      if (now > entry.expiresAt) sessionCache.delete(hash);
    }
    for (const [hash, at] of destroyedHashes.entries()) {
      if (now.getTime() - at > SESSION_TOMBSTONE_MS) destroyedHashes.delete(hash);
    }
  }
}

// Periodically clean up expired sessions every hour
setInterval(() => {
  AdminSessionService.cleanupExpiredSessions().catch(() => {});
}, 60 * 60 * 1000);
