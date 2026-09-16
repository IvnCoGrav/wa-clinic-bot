import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/client';
import { queueService } from '../services/queue.service';
import { burstCoalesceService } from '../services/burst-coalesce.service';
import { clearAllIntervals } from './interval-registry';

/**
 * shutdown.ts — Orkestrasi graceful shutdown (PLAN 8 FASE 1).
 *
 * Urutan sengaja:
 *   1. Hentikan cron        → tidak ada query baru saat koneksi ditutup
 *   2. Tutup HTTP server    → stop request baru, tunggu in-flight selesai
 *   3. Flush burst coalescer → pesan yang masih di buffer ikut terkirim
 *   4. Tutup queue          → drain BullMQ / in-memory
 *   5. Putuskan Prisma      → paling akhir
 *
 * Batas waktu keras (SHUTDOWN_FORCE_EXIT_MS, default 10s) mencegah deploy
 * menggantung bila ada tahap yang tidak kunjung selesai.
 */

const FORCE_EXIT_MS = parseInt(process.env.SHUTDOWN_FORCE_EXIT_MS || '10000', 10);

let shuttingDown = false;

/** True bila proses sedang dalam tahap shutdown. */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

export async function gracefulShutdown(server: FastifyInstance, signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[SHUTDOWN] ${signal} diterima — memulai graceful shutdown (batas ${FORCE_EXIT_MS}ms).`);

  const forceTimer = setTimeout(() => {
    console.error('[SHUTDOWN] Batas waktu terlampaui — force exit.');
    process.exit(1);
  }, FORCE_EXIT_MS);
  forceTimer.unref();

  try {
    clearAllIntervals();
    console.log('[SHUTDOWN] Cron intervals dihentikan.');
  } catch (e: any) {
    console.error('[SHUTDOWN] clearAllIntervals() gagal:', e?.message);
  }

  try {
    await server.close();
    console.log('[SHUTDOWN] HTTP server ditutup.');
  } catch (e: any) {
    console.error('[SHUTDOWN] server.close() gagal:', e?.message);
  }

  try {
    await burstCoalesceService.flushAll();
    console.log('[SHUTDOWN] Burst coalescer di-flush.');
  } catch (e: any) {
    console.error('[SHUTDOWN] flushAll() gagal:', e?.message);
  }

  try {
    await queueService.close();
    console.log('[SHUTDOWN] Queue ditutup.');
  } catch (e: any) {
    console.error('[SHUTDOWN] queue.close() gagal:', e?.message);
  }

  try {
    await prisma.$disconnect();
    console.log('[SHUTDOWN] Prisma terputus.');
  } catch (e: any) {
    console.error('[SHUTDOWN] prisma.$disconnect() gagal:', e?.message);
  }

  clearTimeout(forceTimer);
  console.log('[SHUTDOWN] Selesai. Keluar.');
  process.exit(0);
}

/** Daftarkan handler SIGTERM/SIGINT untuk instance server. */
export function registerShutdownHooks(server: FastifyInstance): void {
  process.on('SIGTERM', () => void gracefulShutdown(server, 'SIGTERM'));
  process.on('SIGINT', () => void gracefulShutdown(server, 'SIGINT'));
}
