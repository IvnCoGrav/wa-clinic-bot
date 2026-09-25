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
   * Validates a session token by hash lookup. Returns the session if valid, or null if expired/invalid.
   */
  static async validateSession(token: string): Promise<AdminSession | null> {
    if (!token || typeof token !== 'string') return null;
    const hash = hashAdminToken(token);

    try {
      const session = await prisma.adminSession.findUnique({ where: { token_hash: hash } });
      if (session && !session.revoked_at && session.expires_at > new Date()) {
        return {
          id: session.id,
          token,
          adminIdentity: session.admin_identity,
          createdAt: session.created_at,
          expiresAt: session.expires_at,
        };
      }
      if (session) {
        // Kedaluwarsa/direvoke → bersihkan best-effort.
        await prisma.adminSession.delete({ where: { token_hash: hash } }).catch(() => {});
        return null;
      }
    } catch {
      // DB offline → jatuh ke fallback memori di bawah.
    }
    return readMemory(hash, token);
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
  }
}

// Periodically clean up expired sessions every hour
setInterval(() => {
  AdminSessionService.cleanupExpiredSessions().catch(() => {});
}, 60 * 60 * 1000);
