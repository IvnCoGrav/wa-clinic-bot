/**
 * reencrypt-tenant-secrets.ts
 *
 * Skrip utilitas migrasi kredensial rahasia (S-001 / Fase 1.1).
 * Membaca secret terenkripsi dengan kunci lama / fallback, lalu mengenkripsi ulang
 * dengan WABA_TOKEN_ENCRYPTION_KEY baru.
 *
 * Mode default: DRY-RUN (aman).
 * Jalankan dengan argumen `--apply` untuk melakukan update nyata ke database.
 * Idempoten: field yang sudah terenkripsi dengan kunci baru akan dilewati.
 */

import crypto from 'crypto';
import { prisma } from '../src/db/client';
import { encryptWithKey, decryptWithKey } from '../src/utils/encryption';

function deriveFallbackKey(seed: string): Buffer {
  return crypto.createHash('sha256').update(seed, 'utf8').digest();
}

function parseKey(keyStr: string, name: string): Buffer {
  if (keyStr.length !== 64) {
    throw new Error(`${name} harus berupa 32-byte hex (64 karakter). Panjang saat ini: ${keyStr.length}`);
  }
  const buf = Buffer.from(keyStr, 'hex');
  if (buf.length !== 32) {
    throw new Error(`${name} tidak valid sebagai buffer 32 byte.`);
  }
  return buf;
}

export interface ReencryptOptions {
  oldKey?: Buffer;
  newKey?: Buffer;
  apply?: boolean;
}

export interface ReencryptResult {
  tenantsInspected: number;
  secretsMigrated: number;
  secretsAlreadyValid: number;
  errors: Array<{ tenantId: string; field: string; error: string }>;
}

export async function reencryptAllSecrets(options: ReencryptOptions = {}): Promise<ReencryptResult> {
  const isApply = options.apply ?? process.argv.includes('--apply');

  // Kunci baru
  const rawNewKey = process.env.WABA_TOKEN_ENCRYPTION_KEY || '';
  const newKey = options.newKey || (rawNewKey ? parseKey(rawNewKey, 'WABA_TOKEN_ENCRYPTION_KEY') : null);

  if (!newKey) {
    throw new Error('Kunci baru (WABA_TOKEN_ENCRYPTION_KEY) wajib disediakan via env atau options.newKey.');
  }

  // Kunci lama / fallback
  let oldKey = options.oldKey;
  if (!oldKey) {
    const rawOldKey = process.env.OLD_WABA_TOKEN_ENCRYPTION_KEY || '';
    if (rawOldKey) {
      oldKey = parseKey(rawOldKey, 'OLD_WABA_TOKEN_ENCRYPTION_KEY');
    } else {
      const fallbackSeed = process.env.ADMIN_API_KEY || process.env.APP_SECRET || '';
      if (!fallbackSeed) {
        throw new Error('Kunci lama tidak ditemukan (butuh OLD_WABA_TOKEN_ENCRYPTION_KEY atau ADMIN_API_KEY fallback).');
      }
      oldKey = deriveFallbackKey(fallbackSeed);
    }
  }

  console.log(`🔐 [REENCRYPT] Memulai migrasi rahasia (Mode: ${isApply ? 'APPLY / UPDATE DB' : 'DRY-RUN (Simulasi)'})`);

  const result: ReencryptResult = {
    tenantsInspected: 0,
    secretsMigrated: 0,
    secretsAlreadyValid: 0,
    errors: [],
  };

  const tenants = await prisma.tenant.findMany();
  result.tenantsInspected = tenants.length;

  for (const tenant of tenants) {
    const fieldsToMigrate: Array<'waba_access_token' | 'waba_app_secret' | 'meta_capi_access_token' | 'telegram_bot_token'> = [
      'waba_access_token',
      'waba_app_secret',
      'meta_capi_access_token',
      'telegram_bot_token',
    ];

    const updates: Record<string, string> = {};

    for (const field of fieldsToMigrate) {
      const rawVal = (tenant as any)[field];
      if (!rawVal) continue;

      // 1. Cek apakah sudah terenkripsi dengan newKey (Idempoten)
      let isAlreadyNewKey = false;
      try {
        decryptWithKey(rawVal, newKey);
        isAlreadyNewKey = true;
      } catch {
        isAlreadyNewKey = false;
      }

      if (isAlreadyNewKey) {
        result.secretsAlreadyValid++;
        continue;
      }

      // 2. Coba dekripsi dengan oldKey
      let plainText = '';
      try {
        plainText = decryptWithKey(rawVal, oldKey);
      } catch (err: any) {
        // Cek apakah plaintext legacy (misal belum terenkripsi sama sekali)
        if (rawVal.startsWith('EAA') || rawVal.startsWith('bot') || rawVal.length < 30) {
          plainText = rawVal;
        } else {
          result.errors.push({
            tenantId: tenant.id,
            field,
            error: `Gagal dekripsi dengan kunci lama: ${err.message}`,
          });
          continue;
        }
      }

      // 3. Enkripsi ulang dengan newKey
      const reencrypted = encryptWithKey(plainText, newKey);
      updates[field] = reencrypted;
      result.secretsMigrated++;
      console.log(`  ↪ Tenant '${tenant.id}' field '${field}' disiapkan re-enkripsi.`);
    }

    if (isApply && Object.keys(updates).length > 0) {
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: updates,
      });
      console.log(`  ✅ Tenant '${tenant.id}' berhasil diupdate di database.`);
    }
  }

  console.log(`\n📊 [HASIL RE-ENKRIPSI]`);
  console.log(`  Total Penyewa Diperiksa : ${result.tenantsInspected}`);
  console.log(`  Secret Dimigrasi        : ${result.secretsMigrated}`);
  console.log(`  Secret Sudah Kunci Baru : ${result.secretsAlreadyValid}`);
  console.log(`  Error Dekripsi          : ${result.errors.length}`);

  if (result.errors.length > 0) {
    console.warn(`  ⚠️ Ditemukan ${result.errors.length} error dekripsi! Periksa log di atas.`);
  }

  return result;
}

if (require.main === module) {
  reencryptAllSecrets()
    .then((res) => {
      if (res.errors.length > 0) process.exit(1);
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Gagal menjalankan reencrypt-tenant-secrets:', err.message);
      process.exit(1);
    });
}
