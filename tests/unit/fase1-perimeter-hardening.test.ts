import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import {
  encryptWithKey,
  decryptWithKey,
  getBackupEncryptionKey,
  encryptSecret,
  generateEncryptionKey,
} from '../../src/utils/encryption';
import {
  checkAccountLockout,
  recordAccountFailedAttempt,
  resetAccountLockout,
  normalizeAccountIdentifier,
  _clearAccountLockoutMapForTest,
} from '../../src/services/account-lockout.service';

describe('Fase 1 — Perimeter Kredensial & Akses Hardening', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.ADMIN_API_KEY = 'real_valid_admin_key_fase1';
    _clearAccountLockoutMapForTest();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    _clearAccountLockoutMapForTest();
  });

  // =========================================================================
  // Task 1.1: Enkripsi Kunci & Fail-Closed Keys
  // =========================================================================
  describe('Task 1.1 — Encryption & Key Isolation', () => {
    it('1. encryptWithKey dan decryptWithKey berhasil mengenkripsi dan mendekripsi payload', () => {
      const keyHex = generateEncryptionKey();
      const keyBuffer = Buffer.from(keyHex, 'hex');
      const plain = 'super_secret_access_token_12345';

      const encrypted = encryptWithKey(plain, keyBuffer);
      expect(encrypted).not.toBe(plain);
      expect(typeof encrypted).toBe('string');

      const decrypted = decryptWithKey(encrypted, keyBuffer);
      expect(decrypted).toBe(plain);
    });

    it('2. getBackupEncryptionKey melempar error (fail-closed) jika BACKUP_ENCRYPTION_KEY kosong', () => {
      delete process.env.BACKUP_ENCRYPTION_KEY;
      expect(() => getBackupEncryptionKey()).toThrow(/BACKUP_ENCRYPTION_KEY not configured/);
    });

    it('3. getBackupEncryptionKey mengembalikan Buffer 32 byte jika dikonfigurasi dengan benar', () => {
      const hexKey = generateEncryptionKey();
      process.env.BACKUP_ENCRYPTION_KEY = hexKey;
      const buf = getBackupEncryptionKey();
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBe(32);
    });

    it('4. Di mode production, encryptSecret menolak fallback ke ADMIN_API_KEY tanpa WABA_TOKEN_ENCRYPTION_KEY', () => {
      delete process.env.WABA_TOKEN_ENCRYPTION_KEY;
      delete process.env.ALLOW_ADMIN_KEY_ENCRYPTION_FALLBACK;
      process.env.NODE_ENV = 'production';

      expect(() => encryptSecret('some_secret')).toThrow(/Production environment requires explicit 32-byte/);
    });

    it('5. reencryptAllSecrets memigrasikan secret lama ke kunci baru dan idempoten', async () => {
      const { reencryptAllSecrets } = await import('../../scripts/reencrypt-tenant-secrets');
      const oldKeyHex = generateEncryptionKey();
      const newKeyHex = generateEncryptionKey();
      const oldKeyBuffer = Buffer.from(oldKeyHex, 'hex');
      const newKeyBuffer = Buffer.from(newKeyHex, 'hex');

      const plainToken = 'secret_token_to_reencrypt';
      const encryptedWithOld = encryptWithKey(plainToken, oldKeyBuffer);

      const mockTenants = [
        {
          id: 'tenant-1',
          waba_access_token: encryptedWithOld,
          waba_app_secret: null,
          meta_capi_access_token: null,
          telegram_bot_token: null,
        },
      ];

      vi.mocked(prisma.tenant.findMany).mockResolvedValue(mockTenants as any);
      vi.mocked(prisma.tenant.update).mockResolvedValue({} as any);

      // Run with apply: false (dry-run)
      const dryResult = await reencryptAllSecrets({
        oldKey: oldKeyBuffer,
        newKey: newKeyBuffer,
        apply: false,
      });

      expect(dryResult.tenantsInspected).toBe(1);
      expect(dryResult.secretsMigrated).toBe(1);
      expect(dryResult.errors.length).toBe(0);
      expect(prisma.tenant.update).not.toHaveBeenCalled();

      // Run with apply: true
      const applyResult = await reencryptAllSecrets({
        oldKey: oldKeyBuffer,
        newKey: newKeyBuffer,
        apply: true,
      });

      expect(applyResult.secretsMigrated).toBe(1);
      expect(prisma.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tenant-1' },
          data: expect.objectContaining({
            waba_access_token: expect.any(String),
          }),
        })
      );
    });
  });

  // =========================================================================
  // Task 1.4: Account Lockout Mechanism
  // =========================================================================
  describe('Task 1.4 — Account Lockout Mechanism', () => {
    it('1. Normalisasi identifier akun (+62 -> 0, lowercase, trim)', () => {
      expect(normalizeAccountIdentifier('+628123456789')).toBe('08123456789');
      expect(normalizeAccountIdentifier('628123456789')).toBe('08123456789');
      expect(normalizeAccountIdentifier('  Admin_CS@Clinic.COM  ')).toBe('admin_cs@clinic.com');
    });

    it('2. Mengunci akun setelah tepat 5 kali percobaan gagal berturut-turut', () => {
      const id = 'user_test_lockout';
      expect(checkAccountLockout(id).locked).toBe(false);

      for (let i = 1; i <= 4; i++) {
        const res = recordAccountFailedAttempt(id);
        expect(res.locked).toBe(false);
        expect(res.failedCount).toBe(i);
      }

      // Percobaan ke-5 memicu lockout
      const fifth = recordAccountFailedAttempt(id);
      expect(fifth.locked).toBe(true);
      expect(fifth.failedCount).toBe(5);
      expect(fifth.remainingSeconds).toBeGreaterThan(0);

      // Cek subsequent status
      const status = checkAccountLockout(id);
      expect(status.locked).toBe(true);
      expect(status.remainingSeconds).toBeGreaterThan(0);
    });

    it('3. resetAccountLockout membatalkan status lockout', () => {
      const id = 'user_locked';
      for (let i = 0; i < 5; i++) {
        recordAccountFailedAttempt(id);
      }
      expect(checkAccountLockout(id).locked).toBe(true);

      resetAccountLockout(id);
      expect(checkAccountLockout(id).locked).toBe(false);
    });

    it('4. POST /api/admin/auth/login mengunci akun setelah 5x gagal password dan mereturn 423', async () => {
      const app = buildApp();
      const testPhone = '08999998888';

      // 5 kali request login gagal dengan password salah
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/admin/auth/login',
          payload: {
            identifier: testPhone,
            password: 'wrong_password_attempt',
          },
        });
        if (i < 4) {
          expect(res.statusCode).toBe(401);
        } else {
          // Percobaan ke-5 langsung mengembalikan 423 Locked
          expect(res.statusCode).toBe(423);
          const body = JSON.parse(res.body);
          expect(body.code).toBe('ACCOUNT_LOCKED');
        }
      }

      // Request ke-6 tetap 423 Locked meskipun dari IP lain
      const res6 = await app.inject({
        method: 'POST',
        url: '/api/admin/auth/login',
        remoteAddress: '192.168.1.100', // IP berbeda
        payload: {
          identifier: testPhone,
          password: 'any_password',
        },
      });
      expect(res6.statusCode).toBe(423);
      const body6 = JSON.parse(res6.body);
      expect(body6.code).toBe('ACCOUNT_LOCKED');

      // Akun lain yang berbeda dari IP berbeda tidak terpengaruh lockout
      const resOther = await app.inject({
        method: 'POST',
        url: '/api/admin/auth/login',
        remoteAddress: '192.168.1.101',
        payload: {
          identifier: '08111112222',
          password: 'some_password',
        },
      });
      expect(resOther.statusCode).toBe(401); // 401 bukan 423
    });
  });

  // =========================================================================
  // Task 1.5: Endpoint WhatsApp Provider Super-Admin Guard
  // =========================================================================
  describe('Task 1.5 — WhatsApp Provider Super-Admin Access Guard', () => {
    it('1. GET /api/admin/whatsapp-provider menolak staf (role ADMIN_CS) dengan 403', async () => {
      const app = buildApp();

      // Mock staffSession untuk role ADMIN_CS
      const mockSession = {
        id: 'session-1',
        token_hash: 'hash-1',
        expires_at: new Date(Date.now() + 86400000),
        revoked_at: null,
        staff: {
          id: 'staff-cs-1',
          name: 'Bidan Tina',
          phone: '081234567890',
          role: 'ADMIN_CS',
          active: true,
          tenant_id: 'default-tenant',
        },
      };

      vi.mocked(prisma.staffSession.findUnique).mockResolvedValue(mockSession as any);

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/whatsapp-provider',
        headers: {
          cookie: 'staff_session=fake_staff_token_cs',
        },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('FORBIDDEN_STAFF_ROLE');
    });

    it('2. GET /api/admin/whatsapp-provider/qr menolak staf dengan 403', async () => {
      const app = buildApp();

      const mockSession = {
        id: 'session-2',
        token_hash: 'hash-2',
        expires_at: new Date(Date.now() + 86400000),
        revoked_at: null,
        staff: {
          id: 'staff-therapist-1',
          name: 'Terapis Rina',
          phone: '081234567891',
          role: 'THERAPIST',
          active: true,
          tenant_id: 'default-tenant',
        },
      };

      vi.mocked(prisma.staffSession.findUnique).mockResolvedValue(mockSession as any);

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/whatsapp-provider/qr',
        headers: {
          cookie: 'staff_session=fake_staff_token_therapist',
        },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('FORBIDDEN_STAFF_ROLE');
    });

    it('3. GET /api/admin/whatsapp-provider menerima Super Admin dengan 200', async () => {
      const app = buildApp();

      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        id: 'default-tenant',
        whatsapp_provider: 'WAHA',
        waha_session_id: 'default',
      } as any);
      vi.mocked(prisma.wabaTemplate.findMany).mockResolvedValue([] as any);

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/whatsapp-provider',
        headers: {
          'x-api-key': 'real_valid_admin_key_fase1',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.provider).toBe('WAHA');
    });
  });
});
