import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface AdminSession {
  id: string;
  token: string;
  adminIdentity: string;
  createdAt: Date;
  expiresAt: Date;
}

// 30-day TTL for stable sessions (prevents unexpected logouts)
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 Days
const STORAGE_FILE = path.join(process.cwd(), 'storage', 'admin_sessions.json');

const adminSessionStore = new Map<string, AdminSession>();

// Load persisted sessions on boot
function loadPersistedSessions() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      const now = new Date();
      if (Array.isArray(data)) {
        for (const item of data) {
          const expiresAt = new Date(item.expiresAt);
          if (expiresAt > now) {
            adminSessionStore.set(item.token, {
              ...item,
              createdAt: new Date(item.createdAt),
              expiresAt,
            });
          }
        }
      }
    }
  } catch (err) {
    // Silently ignore corrupted cache
  }
}

function savePersistedSessions() {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const list = Array.from(adminSessionStore.values());
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(list), 'utf-8');
  } catch (err) {
    // Silently ignore write failures
  }
}

loadPersistedSessions();

export class AdminSessionService {
  /**
   * Generates a cryptographically secure random session token (32 bytes = 64 hex chars)
   */
  static createSession(adminIdentity = 'System Admin'): AdminSession {
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

    const session: AdminSession = {
      id: crypto.randomUUID(),
      token,
      adminIdentity,
      createdAt: now,
      expiresAt,
    };

    adminSessionStore.set(token, session);
    savePersistedSessions();
    console.log(`[ADMIN SESSION CREATED] Session token issued for ${adminIdentity}. Expires: ${expiresAt.toISOString()}`);
    return session;
  }

  /**
   * Validates a session token. Returns the session if valid, or null if expired/invalid.
   */
  static validateSession(token: string): AdminSession | null {
    if (!token || typeof token !== 'string') return null;

    const session = adminSessionStore.get(token);
    if (!session) return null;

    // Check expiration
    if (new Date() > session.expiresAt) {
      console.log(`[ADMIN SESSION EXPIRED] Token ${token.substring(0, 8)}... has expired. Removing.`);
      adminSessionStore.delete(token);
      savePersistedSessions();
      return null;
    }

    return session;
  }

  /**
   * Destroys an active session (Logout)
   */
  static destroySession(token: string): boolean {
    if (!token) return false;
    const deleted = adminSessionStore.delete(token);
    if (deleted) {
      savePersistedSessions();
      console.log(`[ADMIN SESSION DESTROYED] Session token ${token.substring(0, 8)}... logged out.`);
    }
    return deleted;
  }

  /**
   * Cleans up expired sessions periodically
   */
  static cleanupExpiredSessions() {
    const now = new Date();
    let hasChanges = false;
    for (const [token, session] of adminSessionStore.entries()) {
      if (now > session.expiresAt) {
        adminSessionStore.delete(token);
        hasChanges = true;
      }
    }
    if (hasChanges) {
      savePersistedSessions();
    }
  }
}

// Periodically clean up expired sessions every hour
setInterval(() => {
  AdminSessionService.cleanupExpiredSessions();
}, 60 * 60 * 1000);

