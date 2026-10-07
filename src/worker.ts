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

async function shutdownWorker(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[WORKER SHUTDOWN] ${signal} diterima — memulai graceful shutdown worker (batas ${FORCE_EXIT_MS}ms).`);

  const forceTimer = setTimeout(() => {
    console.error('[WORKER SHUTDOWN] Batas waktu terlampaui — force exit.');
    process.exit(1);
  }, FORCE_EXIT_MS);
  forceTimer.unref();

  try {
    clearAllIntervals();
    console.log('[WORKER SHUTDOWN] Seluruh cron intervals dihentikan.');
  } catch (e: any) {
    console.error('[WORKER SHUTDOWN] clearAllIntervals gagal:', e?.message);
  }

  try {
    await queueService.close();
    console.log('[WORKER SHUTDOWN] Queue service ditutup.');
  } catch (e: any) {
    console.error('[WORKER SHUTDOWN] queueService.close gagal:', e?.message);
  }

  try {
    const { burstCoalesceService } = await import('./services/burst-coalesce.service');
    await burstCoalesceService.flushAll();
    console.log('[WORKER SHUTDOWN] Burst coalescer di-flush.');
  } catch (e: any) {
    console.error('[WORKER SHUTDOWN] burstCoalesceService.flushAll gagal:', e?.message);
  }

  try {
    await prisma.$disconnect();
    console.log('[WORKER SHUTDOWN] Prisma terputus.');
  } catch (e: any) {
    console.error('[WORKER SHUTDOWN] prisma.$disconnect gagal:', e?.message);
  }

  clearTimeout(forceTimer);
  console.log('[WORKER SHUTDOWN] Worker selesai. Keluar.');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdownWorker('SIGTERM'));
process.on('SIGINT', () => void shutdownWorker('SIGINT'));

async function main(): Promise<void> {
  console.log('👷 [WORKER] Memulai dedicated background worker process...');

  try {
    await prisma.$connect();
    console.log('✅ [WORKER] Terhubung ke basis data PostgreSQL.');
  } catch (err: any) {
    console.error('❌ [WORKER] Gagal terhubung ke basis data:', err?.message || err);
    process.exit(1);
  }

  // Jalankan seluruh cron jobs dan periodic sweeps
  startBackgroundCrons();
  console.log('🎯 [WORKER] Seluruh background cron & sweep worker telah aktif.');
}

void main();
