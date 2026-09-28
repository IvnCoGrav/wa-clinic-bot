import crypto from 'crypto';
import { prisma } from '../db/client';
import { verifyPassword } from '../utils/bcrypt';
import { SessionStoreUnavailable } from './admin-session.service';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari

/**
 * Query sesi staff + relasi `staff` (satu sumber). Dipisah agar tipe hasilnya
 * dapat di-infer (`Awaited<ReturnType<...>>`) tanpa kehilangan field `include`.
 */
function findStaffSessionByToken(token: string) {
  return prisma.staffSession.findUnique({
    where: { token_hash: hashToken(token) },
    include: { staff: true },
  });
}

/** Sesi staff beserta relasi `staff` (hasil `findStaffSessionByToken`). */
export type StaffSessionWithStaff = Awaited<ReturnType<typeof findStaffSessionByToken>>;

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class StaffAuthService {
  /**
   * Login: verifikasi nomor HP/username + password staff, buat sesi baru di database.
   * Mendukung semua peran staff (THERAPIST, SPVCS, ADMIN_CS, ADVERTISER, dll).
   */
  static async login(phone: string, password: string, tenantId: string) {
    if (!phone || !password) return null;

    try {
      const cleanPhone = phone.trim().replace(/^(\+62|62)/, '0');
      const staff = await prisma.staff.findFirst({
        where: {
          OR: [
            { phone: cleanPhone, tenant_id: tenantId, active: true },
            { phone: phone.trim(), tenant_id: tenantId, active: true },
            { name: phone.trim(), tenant_id: tenantId, active: true },
          ],
        },
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

      console.log(`[STAFF AUTH] Staff '${staff.name}' (${staff.phone}, role: ${staff.role}) logged in successfully.`);
      return { token, staff, expiresAt };
    } catch (err: any) {
      console.error('[STAFF AUTH] Error during staff login:', err.message);
      return null;
    }
  }

  /**
   * Validasi token sesi dari cookie.
   *
   * Kontrak sinyal (paritas dengan `AdminSessionService`, KNOWN_ISSUES #141):
   * - SessionStoreUnavailable → 503 (DB tak bisa dicek; JANGAN klaim token invalid)
   * - null                    → 401 jujur (token tidak ada / kedaluwarsa / direvoke /
   *                             akun staff nonaktif)
   *
   * Sebelumnya SEMUA error DB ditelan menjadi `null` → 401 ambigu → frontend
   * menghapus token cadangan padahal sesi 30-hari di DB masih sah.
   */
  static async validateSession(token: string) {
    if (!token || typeof token !== 'string') return null;

    let session: StaffSessionWithStaff;
    try {
      session = await findStaffSessionByToken(token);
    } catch (err: any) {
      // DB error (pool jenuh/timeout/mati) → BUKAN bukti token invalid.
      console.error('[STAFF AUTH] Penyimpanan sesi staff tidak tersedia:', err?.message ?? err);
      throw new SessionStoreUnavailable('Penyimpanan sesi staff (database) tidak tersedia');
    }

    if (!session || session.revoked_at) return null;
    if (session.expires_at < new Date()) return null;
    if (!session.staff || !session.staff.active) return null;

    return session;
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

  /**
   * Housekeeping: hapus sesi yang sudah kadaluarsa (expires_at < now).
   * Dipanggil via cron harian atau manual; best-effort, tidak melempar.
   */
  static async cleanExpiredSessions(): Promise<number> {
    try {
      const res = await prisma.staffSession.deleteMany({
        where: { expires_at: { lt: new Date() } },
      });
      if (res.count > 0) console.log(`[STAFF AUTH] Cleaned ${res.count} expired staff sessions`);
      return res.count;
    } catch (err: any) {
      console.error('[STAFF AUTH] Error cleaning expired sessions:', err.message);
      return 0;
    }
  }
}
