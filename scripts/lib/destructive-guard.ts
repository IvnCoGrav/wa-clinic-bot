/**
 * scripts/lib/destructive-guard.ts
 *
 * Guard pengaman deterministik untuk skrip destruktif (cleanup, seed, deleteMany).
 * Mencegah eksekusi tidak sengaja di database produksi atau host remote,
 * serta memastikan mode dry-run secara default tanpa flag --confirm.
 */

export interface DestructiveGuardOptions {
  argv?: string[];
  nodeEnv?: string;
  dbUrl?: string;
  allowDryRun?: boolean;
}

export interface DestructiveGuardResult {
  isDryRun: boolean;
  isConfirmed: boolean;
  host: string;
}

export function checkDestructiveSafety(options: DestructiveGuardOptions = {}): DestructiveGuardResult {
  const argv = options.argv || process.argv;
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  const dbUrl = options.dbUrl ?? process.env.DATABASE_URL;

  // 1. Blokir mutlak di environment produksi
  if (nodeEnv === 'production') {
    throw new Error('[DestructiveGuard] Execution blocked in production environment.');
  }

  // 2. Ekstraksi dan validasi host database
  let host = 'localhost';
  if (dbUrl) {
    try {
      const parsed = new URL(dbUrl);
      host = parsed.hostname || 'localhost';
    } catch {
      // Jika URL format khusus, cari host via regex
      const match = dbUrl.match(/@([^:/]+)/);
      if (match && match[1]) {
        host = match[1];
      }
    }
  }

  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const hasForceNonLocal = argv.includes('--force-nonlocal');

  if (!isLocalHost && !hasForceNonLocal) {
    throw new Error(
      `[DestructiveGuard] Execution blocked on non-local host: "${host}". Pass --force-nonlocal if you are certain.`
    );
  }

  // 3. Konfirmasi eksekusi (default dry-run)
  const isConfirmed = argv.includes('--confirm');
  const isDryRun = !isConfirmed || argv.includes('--dry-run');

  return {
    isDryRun,
    isConfirmed,
    host,
  };
}

export function assertSafeDestructiveRun(
  scriptName: string,
  options: DestructiveGuardOptions = {}
): DestructiveGuardResult {
  const result = checkDestructiveSafety(options);

  if (result.isDryRun) {
    console.warn(
      `⚠️ [DestructiveGuard] ${scriptName} berjalan dalam mode DRY-RUN. Tidak ada data yang diubah atau dihapus.`
    );
    console.warn(`   Tambahkan argumen --confirm untuk mengeksekusi operasi tulis/hapus nyata.\n`);
  } else {
    console.log(`🛡️ [DestructiveGuard] ${scriptName} terverifikasi aman: host "${result.host}", --confirm terpasang.`);
  }

  return result;
}
