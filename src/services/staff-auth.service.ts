import crypto from 'crypto';
import { prisma } from '../db/client';
import { verifyPassword } from '../utils/bcrypt';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 jam (shift kerja)

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class StaffAuthService {
  /**
   * Login: verifikasi nomor HP + password staff, buat sesi baru di database.
   */
  static async login(phone: string, password: string, tenantId: string) {
    if (!phone || !password) return null;

    try {
      const staff = await prisma.staff.findFirst({
        where: { phone, tenant_id: tenantId, active: true },
      });
      if (!staff) return null;

      const valid = await verifyPassword(password, staff.password_hash);
      if (!valid) return null;

      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

      await prisma.staffSession.create({
        data: {
          staff_id: staff.id,
          token_hash: hashToken(token),
          expires_at: expiresAt,
        },
      });

      console.log(`[STAFF AUTH] Staff '${staff.name}' (${staff.phone}) logged in successfully.`);
      return { token, staff, expiresAt };
    } catch (err: any) {
      console.error('[STAFF AUTH] Error during staff login:', err.message);
      return null;
    }
  }

  /**
   * Validasi token sesi dari cookie.
   * Return null jika token tidak ada, sesi tidak ditemukan, expired, direvoke, atau akun staff dinonaktifkan.
   */
  static async validateSession(token: string) {
    if (!token || typeof token !== 'string') return null;

    try {
      const session = await prisma.staffSession.findUnique({
        where: { token_hash: hashToken(token) },
        include: { staff: true },
      });

      if (!session || session.revoked_at) return null;
      if (session.expires_at < new Date()) return null;
      if (!session.staff || !session.staff.active) return null;

      return session;
    } catch (err: any) {
      console.error('[STAFF AUTH] Error validating session:', err.message);
      return null;
    }
  }

  /**
   * Logout sesi aktif staff (menandai revoked_at).
   */
  static async logout(token: string): Promise<boolean> {
    if (!token) return false;

    try {
      await prisma.staffSession.updateMany({
        where: { token_hash: hashToken(token), revoked_at: null },
        data: { revoked_at: new Date() },
      });
      return true;
    } catch (err: any) {
      console.error('[STAFF AUTH] Error logging out session:', err.message);
      return false;
    }
  }

  /**
   * Revoke SEMUA sesi aktif milik staff tertentu (misal saat resign / nonaktif).
   */
  static async revokeAllSessions(staffId: string): Promise<boolean> {
    if (!staffId) return false;

    try {
      await prisma.staffSession.updateMany({
        where: { staff_id: staffId, revoked_at: null },
        data: { revoked_at: new Date() },
      });
      console.log(`[STAFF AUTH] Revoked all active sessions for staff ID ${staffId}`);
      return true;
    } catch (err: any) {
      console.error('[STAFF AUTH] Error revoking staff sessions:', err.message);
      return false;
    }
  }
}
