import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import { StaffAuthService, hashToken } from '../../src/services/staff-auth.service';
import { SessionStoreUnavailable } from '../../src/services/admin-session.service';
import { prisma } from '../../src/db/client';

/**
 * Kontrak sinyal penyimpanan sesi STAFF (paritas dengan admin, KNOWN_ISSUES #141).
 *
 * Akar bug: `StaffAuthService.validateSession` menelan SEMUA error DB menjadi
 * `null` → route staff memetakannya ke 401 → frontend menganggap token invalid
 * dan menghapus token cadangan, padahal sesi 30-hari di DB masih sah.
 *
 * Kontrak baru (mencerminkan admin):
 * - DB error (query melempar)      → LEMPAR SessionStoreUnavailable (→ 503)
 * - DB sehat: token invalid/expired → null (→ 401 yang jujur)
 * - token kosong / bukan string    → null (tak memukul DB)
 */
const uniqToken = () => crypto.randomBytes(32).toString('hex');

describe('Staff Session Store Signal Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DB error saat validate → melempar SessionStoreUnavailable, BUKAN null', async () => {
    (prisma.staffSession.findUnique as any).mockRejectedValue(
      new Error('connection pool timeout')
    );

    // Sebelum fix: resolve(null) → 401 ambigu → token frontend dibuang.
    await expect(StaffAuthService.validateSession(uniqToken())).rejects.toThrow(
      SessionStoreUnavailable
    );
  });

  it('DB sehat, token tidak ada → null (401 jujur, bukan 503)', async () => {
    (prisma.staffSession.findUnique as any).mockResolvedValue(null);

    const result = await StaffAuthService.validateSession(uniqToken());
    expect(result).toBeNull();
  });

  it('DB sehat, sesi expired → null (401 jujur)', async () => {
    (prisma.staffSession.findUnique as any).mockResolvedValue({
      id: 'session-1',
      token_hash: 'hash',
      expires_at: new Date(Date.now() - 3600_000),
      revoked_at: null,
      staff: { id: 'staff-1', active: true },
    });

    const result = await StaffAuthService.validateSession(uniqToken());
    expect(result).toBeNull();
  });

  it('token kosong / bukan string → null tanpa memukul DB', async () => {
    expect(await StaffAuthService.validateSession('')).toBeNull();
    expect(await StaffAuthService.validateSession(undefined as any)).toBeNull();
    expect(prisma.staffSession.findUnique).not.toHaveBeenCalled();
  });

  it('DB sehat, sesi valid → objek sesi (tanpa lempar)', async () => {
    const token = uniqToken();
    (prisma.staffSession.findUnique as any).mockResolvedValue({
      id: 'session-1',
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + 3600_000),
      revoked_at: null,
      staff: { id: 'staff-1', name: 'Bidan Dewi', active: true, role: 'THERAPIST' },
    });

    const session = await StaffAuthService.validateSession(token);
    expect(session?.staff.name).toBe('Bidan Dewi');
  });
});
