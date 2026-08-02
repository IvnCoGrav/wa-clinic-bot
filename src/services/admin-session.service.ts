import crypto from 'crypto';

export interface AdminSession {
  id: string;
  token: string;
  adminIdentity: string;
  createdAt: Date;
  expiresAt: Date;
}

// In-Memory Admin Session Store (24-hour TTL)
const adminSessionStore = new Map<string, AdminSession>();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 Hours

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
      console.log(`[ADMIN SESSION DESTROYED] Session token ${token.substring(0, 8)}... logged out.`);
    }
    return deleted;
  }

  /**
   * Cleans up expired sessions periodically
   */
  static cleanupExpiredSessions() {
    const now = new Date();
    for (const [token, session] of adminSessionStore.entries()) {
      if (now > session.expiresAt) {
        adminSessionStore.delete(token);
      }
    }
  }
}

// Periodically clean up expired sessions every hour
setInterval(() => {
  AdminSessionService.cleanupExpiredSessions();
}, 60 * 60 * 1000);
