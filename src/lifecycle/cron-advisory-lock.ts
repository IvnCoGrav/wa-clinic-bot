import { prisma } from '../db/client';

/**
 * Stage 5 / K-001 & P0-C — Distributed Lock & Lease untuk Cron Runner.
 *
 * Mencegah eksekusi cron ganda saat multi-container / multi-worker berjalan bersamaan
 * (misal saat rolling deploy atau scale horizontal).
 *
 * Arsitektur berlapis:
 * 1. Primary: Tabel `cron_leases` dengan heartbeat berkala dan masa sewa (lease) 60 detik.
 *    Bebas dari masalah session pooling PostgreSQL di Prisma.
 * 2. Secondary fallback: `pg_try_advisory_lock` (kunci 8820261108n).
 * 3. Fail-closed: Pada lingkungan produksi (NODE_ENV=production), kegagalan database
 *    SELALU mengembalikan false (tidak menjadi leader) untuk mencegah eksekusi ganda.
 */
export class CronAdvisoryLock {
  private static readonly LOCK_ID = 8820261108n;
  private readonly holderId: string = `worker_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  private isHeld = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  /**
   * Coba mengambil lock/lease dari PostgreSQL.
   * Return true jika berhasil (terpilih sebagai Cron Leader).
   * Return false jika container lain sudah memegang lock (Standby mode).
   */
  public async tryAcquireLock(): Promise<boolean> {
    const isProd = process.env.NODE_ENV === 'production';

    // 1. Coba lewat tabel cron_leases
    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 60_000);
      const claimed = await prisma.$executeRaw`
        INSERT INTO cron_leases (job_name, holder_id, acquired_at, expires_at)
        VALUES ('cron_runner', ${this.holderId}, ${now}, ${expiresAt})
        ON CONFLICT (job_name) DO UPDATE
        SET holder_id = ${this.holderId}, acquired_at = ${now}, expires_at = ${expiresAt}
        WHERE cron_leases.expires_at < ${now} OR cron_leases.holder_id = ${this.holderId}
      `;
      this.isHeld = claimed > 0;
      if (this.isHeld) {
        this.startHeartbeat();
      }
      return this.isHeld;
    } catch {
      // 2. Fallback ke pg_try_advisory_lock bila tabel cron_leases belum termigrasi
      try {
        const result = await prisma.$queryRaw<Array<{ locked: boolean }>>`
          SELECT pg_try_advisory_lock(${CronAdvisoryLock.LOCK_ID}) as locked
        `;
        this.isHeld = Boolean(result?.[0]?.locked);
        return this.isHeld;
      } catch (err: any) {
        console.warn('[CRON ADVISORY LOCK] Gagal mengecek lock ke DB:', err?.message);
        // Fail-closed di produksi agar tidak terjadi eksekusi ganda
        if (isProd) {
          this.isHeld = false;
          return false;
        }
        // Fail-open HANYA di dev/test lokal offline
        this.isHeld = true;
        return true;
      }
    }
  }

  public isLeader(): boolean {
    return this.isHeld;
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(async () => {
      if (!this.isHeld) return;
      try {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 60_000);
        await prisma.$executeRaw`
          UPDATE cron_leases
          SET expires_at = ${expiresAt}
          WHERE job_name = 'cron_runner' AND holder_id = ${this.holderId}
        `;
      } catch (err: any) {
        console.warn('[CRON LEASE HEARTBEAT WARN]', err?.message);
      }
    }, 20_000);
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
  }

  /**
   * Melepaskan lock/lease saat graceful shutdown.
   */
  public async releaseLock(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (!this.isHeld) return;

    try {
      await prisma.$executeRaw`
        UPDATE cron_leases
        SET expires_at = NOW()
        WHERE job_name = 'cron_runner' AND holder_id = ${this.holderId}
      `;
    } catch {}

    try {
      await prisma.$queryRaw`
        SELECT pg_advisory_unlock(${CronAdvisoryLock.LOCK_ID})
      `;
    } catch (err: any) {
      console.warn('[CRON ADVISORY LOCK] Gagal melepas advisory lock:', err?.message);
    }

    this.isHeld = false;
    console.log('[CRON ADVISORY LOCK] Lock/lease berhasil dilepas.');
  }
}

export const cronAdvisoryLock = new CronAdvisoryLock();
