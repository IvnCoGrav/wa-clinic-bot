/**
 * Dedicated Background Worker Process (Fase 3D)
 *
 * Menjalankan background tasks, antrean cron, sweep jobs, dan queue processing
 * secara terisolasi dari proses web HTTP utama (app.ts).
 *
 * Penggunaan:
 *   npx tsx src/worker.ts
 *   node dist/worker.js
 */

import dotenv from 'dotenv';
dotenv.config();

import { prisma } from './db/client';
import { queueService } from './services/queue.service';
import { clearAllIntervals } from './lifecycle/interval-registry';
import { startBackgroundCrons } from './lifecycle/background-crons';
import { installLogBuffer } from './utils/log-buffer';
import { initializeConsoleWrapper } from './utils/context';

installLogBuffer();
initializeConsoleWrapper();

const FORCE_EXIT_MS = parseInt(process.env.SHUTDOWN_FORCE_EXIT_MS || '10000', 10);
let shuttingDown = false;

export function __resetWorkerShuttingDownForTest(): void {
  shuttingDown = false;
}

export async function shutdownWorker(signal: string, shouldExit = true): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[WORKER SHUTDOWN] ${signal} diterima — memulai graceful shutdown worker (batas ${FORCE_EXIT_MS}ms).`);

  const forceTimer = setTimeout(() => {
    console.error('[WORKER SHUTDOWN] Batas waktu terlampaui — force exit.');
    if (shouldExit) process.exit(1);
  }, FORCE_EXIT_MS);
  forceTimer.unref();

  try {
    clearAllIntervals();
    console.log('[WORKER SHUTDOWN] Seluruh cron intervals dihentikan.');
  } catch (e: any) {
    console.error('[WORKER SHUTDOWN] clearAllIntervals gagal:', e?.message);
  }

  // K-010: job cron yang sedang berjalan diberi kesempatan selesai (backup/
  // sheets/export) sebelum queue & DB ditutup.
  try {
    const { drainInFlightCronTasks } = await import('./lifecycle/background-crons');
    const drained = await drainInFlightCronTasks(Math.max(1000, FORCE_EXIT_MS - 2000));
    console.log(
      drained
        ? '[WORKER SHUTDOWN] Seluruh job cron in-flight selesai.'
        : '[WORKER SHUTDOWN] Batas drain habis — sebagian job cron mungkin terpotong.'
    );
  } catch (e: any) {
    console.error('[WORKER SHUTDOWN] drainInFlightCronTasks gagal:', e?.message);
  }

  // Task S2.5: urutan yang benar — flush burst SEBELUM menutup queue service
  try {
    const { burstCoalesceService } = await import('./services/burst-coalesce.service');
    await burstCoalesceService.flushAll();
    console.log('[WORKER SHUTDOWN] Burst coalescer di-flush.');
  } catch (e: any) {
    console.error('[WORKER SHUTDOWN] burstCoalesceService.flushAll gagal:', e?.message);
  }

  try {
    await queueService.close();
    console.log('[WORKER SHUTDOWN] Queue service ditutup.');
  } catch (e: any) {
    console.error('[WORKER SHUTDOWN] queueService.close gagal:', e?.message);
  }

  try {
    const { flushLlmAuditBuffer } = await import('./utils/llm-audit-buffer');
    await flushLlmAuditBuffer();
    console.log('[WORKER SHUTDOWN] LLM audit buffer di-flush.');
  } catch (e: any) {
    console.error('[WORKER SHUTDOWN] flushLlmAuditBuffer gagal:', e?.message);
  }

  try {
    const { cronAdvisoryLock } = await import('./lifecycle/cron-advisory-lock');
    await cronAdvisoryLock.releaseLock();
  } catch (e: any) {
    console.error('[WORKER SHUTDOWN] cronAdvisoryLock.releaseLock gagal:', e?.message);
  }

  try {
    await prisma.$disconnect();
    console.log('[WORKER SHUTDOWN] Prisma terputus.');
  } catch (e: any) {
    console.error('[WORKER SHUTDOWN] prisma.$disconnect gagal:', e?.message);
  }

  clearTimeout(forceTimer);
  console.log('[WORKER SHUTDOWN] Worker selesai. Keluar.');
  if (shouldExit) {
    process.exit(0);
  }
}

async function main(): Promise<void> {
  console.log('👷 [WORKER] Memulai dedicated background worker process...');

  try {
    await prisma.$connect();
    console.log('✅ [WORKER] Terhubung ke basis data PostgreSQL.');
  } catch (err: any) {
    console.error('❌ [WORKER] Gagal terhubung ke basis data:', err?.message || err);
    process.exit(1);
  }

  // Task S2.4: Muat data tenant dari DB via central tenant bootstrap
  try {
    const { initializeTenantRuntime } = await import('./lifecycle/tenant-bootstrap');
    await initializeTenantRuntime();
  } catch (initErr: any) {
    console.warn('[WORKER INIT TENANT DATA] Gagal memuat data tenant:', initErr?.message || initErr);
  }

  // Jalankan seluruh cron jobs dan periodic sweeps
  startBackgroundCrons();
  console.log('🎯 [WORKER] Seluruh background cron & sweep worker telah aktif.');
}

if (require.main === module) {
  process.on('SIGTERM', () => void shutdownWorker('SIGTERM'));
  process.on('SIGINT', () => void shutdownWorker('SIGINT'));
  void main();
}
