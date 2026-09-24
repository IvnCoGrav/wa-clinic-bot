import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { stateMachine } from '../state-machine/machine';
import { StateHandlerContext } from '../state-machine/types';
import { customerService } from './customer.service';
import { conversationService } from './conversation.service';
import { hashPiiPhone } from '../utils/logger-sanitizer';
import { contextStorage } from '../utils/context';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import dotenv from 'dotenv';
dotenv.config();

export interface QueuePayload {
  tenantId: string;
  customerId: string;
  phone?: string;
  incomingMessage: any;
  /** Correlation ID request-level (dari webhook). Aditif â€” opsional agar caller lama tetap valid. */
  correlationId?: string;
  /** ID kanonis turn inbound: `${tenantId}:${provider}:${inboundMessageId}`. */
  turnId?: string;
  /** Provider asal pesan untuk affinity ingressâ†’egress. */
  provider?: 'WAHA' | 'WABA';
  /** ID pesan asli provider. */
  inboundMessageId?: string;
}

/**
 * R3 (quick-win efektivitas): kunci dedup BullMQ yang kanonis.
 * Hierarki: turnId (`tenant:provider:msgId`) → inboundMessageId →
 * incomingMessage.id → UUID acak. Tanpa fallback UUID, pesan tanpa id
 * bertabrakan di `job_<phone>_undefined` dan dibuang diam-diam sebagai
 * "duplikat". UUID mengorbankan dedup demi tak pernah membuang pesan sah.
 */
export function resolveQueueJobId(phone: string, payload: QueuePayload): string {
  const stable =
    payload.turnId || payload.inboundMessageId || payload.incomingMessage?.id;
  return `job_${phone}_${stable || randomUUID()}`;
}

export class QueueService {
  private redisEnabled: boolean = false;
  private redisClient: Redis | null = null;
  private redisInitPromise: Promise<boolean> | null = null;
  private bullQueues: Map<string, Queue> = new Map();
  private bullWorkers: Map<string, Worker> = new Map();
  private shardsCount: number = 5;

  // Pause/Resume state for WAHA disconnection resilience
  private isPaused: boolean = false;
  private pauseTimestamp: number | null = null;

  // In-Memory Queue Fallback properties
  private memoryQueues: Map<string, QueuePayload[]> = new Map();
  private memoryProcessing: Set<string> = new Set();
  // BullMQ in-flight per-phone guard (FIFO per customer, cegah salip saat typing delay)
  private bullProcessing: Set<string> = new Set();


  constructor() {
    this.shardsCount = parseInt(process.env.QUEUE_SHARDS || '5', 10);
    this.initQueueSystem();
  }

  /**
   * Gerbang fail-fast (FOUNDATIONAL_HARDENING_PLAN_2026-09-13 G2):
   * bila QUEUE_REQUIRE_REDIS=true dan Redis tidak siap â†’ throw, boot dibatalkan.
   * Default (dev/test) false â†’ jalur in-memory tetap berjalan.
   */
  public async ensureRedisOrThrow(): Promise<void> {
    if (process.env.QUEUE_REQUIRE_REDIS !== 'true') {
      return;
    }
    const ready = this.redisInitPromise ? await this.redisInitPromise : this.redisEnabled;
    if (!ready) {
      throw new Error('FATAL_QUEUE_REDIS_REQUIRED');
    }
  }

  /**
   * Menginisialisasi sistem antrian: mencoba menghubungkan ke Redis.
   * Jika gagal (offline), otomatis beralih ke Fallback In-Memory Queue.
   */
  private initQueueSystem(): void {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);

    try {
      // Buat koneksi Redis dengan timeout cepat (3 detik) agar tidak menghambat startup saat offline
      this.redisClient = new Redis({
        host,
        port,
        maxRetriesPerRequest: null, // Diwajibkan oleh BullMQ
        connectTimeout: 3000,
        lazyConnect: true,
      });

      // Event listener untuk memantau pemutusan koneksi di runtime (Production Alerting)
      this.redisClient.on('error', (err) => {
        if (this.redisEnabled) {
          console.error(`\nðŸš¨ [CRITICAL ALERT] Redis connection lost/error at runtime! Entering In-Memory Message Queue Fallback Mode. Please check Redis server immediately. Error: ${err.message}`);
          this.redisEnabled = false;
        }
      });

      // Event listener untuk pemulihan koneksi saat Redis kambuh / reconnect di background
      this.redisClient.on('ready', () => {
        if (!this.redisEnabled) {
          console.log(`\nâš¡ [QUEUE] Redis connection restored/ready at ${host}:${port}. Restoring BullMQ mode...`);
          this.redisEnabled = true;
          if (this.bullQueues.size === 0) {
            this.initBullMQShards();
          }
        }
      });

      this.redisInitPromise = this.redisClient.connect()
        .then(() => {
          console.log(`\nâš¡ [QUEUE] Successfully connected to Redis at ${host}:${port}. Initializing sharded BullMQ...`);
          this.redisEnabled = true;
          if (this.bullQueues.size === 0) {
            this.initBullMQShards();
          }
          return true;
        })
        .catch((err) => {
          console.error(`\nðŸš¨ [CRITICAL ALERT] Redis connection failed during startup: ${err.message}. Entering In-Memory Message Queue Fallback Mode. Please check Redis server immediately.`);
          this.redisEnabled = false;
          return false;
        });
    } catch (e: any) {
      console.error(`\nðŸš¨ [CRITICAL ALERT] Could not initialize Redis client: ${e.message}. Entering In-Memory Message Queue Fallback Mode. Please check Redis server immediately.`);
      this.redisEnabled = false;
    }
  }

  /**
   * Menginisialisasi shard queues & workers BullMQ.
   * worker memiliki concurrency = 1 per shard untuk menjamin FIFO/sekuensial per customer.
   */
  private initBullMQShards(): void {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);

    const defaultJobOptions = {
      attempts: 3,
      backoff: {
        type: 'exponential' as const,
        delay: 2000,
      },
      removeOnComplete: {
        age: 3600, // Simpan histori job sukses max 1 jam
        count: 1000, // atau max 1000 entri
      },
      removeOnFail: {
        age: 86400, // Simpan histori job gagal max 24 jam untuk audit
        count: 5000,
      },
    };

    for (let i = 0; i < this.shardsCount; i++) {
      const queueName = `message_queue_shard_${i}`;
      
      const connection = new Redis({
        host,
        port,
        maxRetriesPerRequest: null,
      });

      // 1. Buat Queue dengan defaultJobOptions
      const queue = new Queue(queueName, { connection, defaultJobOptions });
      this.bullQueues.set(queueName, queue);

      // 2. Buat Worker dengan concurrency = 1 (proses pesan berurutan per antrian)
      const worker = new Worker(
        queueName,
        async (job: Job<QueuePayload>) => {
          const phoneKey = job.data?.phone || job.data?.customerId || 'unknown';
          if (this.bullProcessing.has(phoneKey)) {
            console.warn(`[QUEUE BullMQ - Shard ${i}] In-flight lock active for ${hashPiiPhone(phoneKey)}, re-queueing job ${job.id} dengan delay.`);
            // Throw agar BullMQ retry dengan backoff, FIFO tetap terjaga via concurrency 1 + retry
            throw new Error(`In-flight lock: phone ${hashPiiPhone(phoneKey)} masih diproses`);
          }
          this.bullProcessing.add(phoneKey);
          try {
            const ctx = await this.resolveFreshContext(job.data);
            if (!ctx) return;

            // RACE CONDITION GUARD: Jika percakapan sudah di-takeover CS (is_human_handling = true),
            // batalkan eksekusi antrian bot agar tidak menimpa/bocor ke chat CS!
            if (ctx.conversation?.is_human_handling) {
              console.log(`[QUEUE ABORT] Conversation ${ctx.conversation.id} (customer: ${hashPiiPhone(ctx.customer.phone)}) is in HUMAN_HANDLING mode. Dropping queued bot reply.`);
              return;
            }

            // EMERGENCY KILL-SWITCH GUARD: Jika cut-off outbound aktif, jangan proses balasan bot
            const { whatsappProviderService } = await import('./whatsapp-provider.service');
            const isCutOff = await whatsappProviderService.isOutboundCutOff(ctx.tenantId);
            if (isCutOff) {
              console.log(`[QUEUE CUT-OFF] Outbound Cut-Off is ACTIVE for tenant ${ctx.tenantId}. Dropping queued bot reply for customer: ${hashPiiPhone(ctx.customer.phone)}.`);
              return;
            }

            console.log(`[QUEUE BullMQ - Shard ${i}] Processing message for customer: ${hashPiiPhone(ctx.customer.phone)} (Tenant: ${ctx.tenantId})`);
            // Stage 5 Fase 2: claim atomik turn (RECEIVEDâ†’PROCESSING). Bila turn
            // sudah diproses (RESPONSE_READY/DELIVERED), lewati agar retry tidak
            // memproses ulang. Fail-open bila tracking tak tersedia.
            try {
              const { turnRepository } = await import('../repositories/turn.repository');
              const claimable = await turnRepository.claimForProcessing({
                tenantId: ctx.tenantId || DEFAULT_TENANT_ID, provider: job.data?.provider || 'WAHA', inboundMessageId: job.data?.inboundMessageId || '',
              });
              if (!claimable) {
                console.log(`[QUEUE TURN SKIP] Turn ${job.data?.turnId} sudah diproses â€” lewati retry.`);
                return;
              }
            } catch {}
            await contextStorage.run(
              {
                correlationId: job.data?.correlationId,
                turnId: job.data?.turnId,
                provider: job.data?.provider,
                inboundMessageId: job.data?.inboundMessageId,
                phone: ctx.customer.phone,
              },
              async () => {
                await stateMachine.processMessage(ctx);
              }
            );
            // Stage 5 Fase 2: tandai turn selesai diproses (best-effort).
            try {
              const { turnRepository } = await import('../repositories/turn.repository');
              await turnRepository.markStatus({ tenantId: ctx.tenantId || DEFAULT_TENANT_ID, provider: job.data?.provider || 'WAHA', inboundMessageId: job.data?.inboundMessageId || '', status: 'RESPONSE_READY' });
            } catch {}
          } catch (err: any) {
            console.error(`[QUEUE BullMQ - Shard ${i}] Exception during processMessage for job ${job.id}:`, err.message);
            throw err; // Throw agar BullMQ mencatat attempt gagal dan menjalankan retry backoff
          } finally {
            this.bullProcessing.delete(phoneKey);
          }
        },
        {
          connection,
          concurrency: 1, // Penting: Menjamin satu pesan diproses satu per satu per antrian
        }
      );

      worker.on('failed', async (job, err) => {
        const phone = job?.data?.phone || job?.data?.customerId || 'unknown';
        const sanitizedPhone = hashPiiPhone(phone);
        console.error(`[QUEUE BullMQ - Shard ${i}] Job ${job?.id} failed for ${sanitizedPhone} (attempt ${job?.attemptsMade}):`, err.message);

        // Jika sudah mencapai batas attempts (final failure), kirimkan critical alert
        if (job && job.attemptsMade >= (job.opts?.attempts || 1)) {
          console.error(`ðŸš¨ [QUEUE BullMQ - Shard ${i}] Job ${job.id} PERMANENTLY FAILED after ${job.attemptsMade} attempts.`);
          try {
            const { alertService, AlertType, AlertSeverity } = await import('./alert.service');
            await alertService.notifyAlert({
              type: AlertType.QUEUE_JOB_FAILED,
              severity: AlertSeverity.CRITICAL,
              message: `[QUEUE JOB FAILED] Job ${job.id} (customer: ${sanitizedPhone}) permanently failed after max retries: ${err.message}`,
              metadata: { tenantId: job.data?.tenantId, customerId: job.data?.customerId, phone: sanitizedPhone, error: err.message },
            });
          } catch (alertErr: any) {
            console.error('[QUEUE ALERT ERROR] Gagal mengirimkan alert queue failed:', alertErr.message);
          }
        }
      });

      this.bullWorkers.set(queueName, worker);
    }
    console.log(`ðŸ“Œ [QUEUE] ${this.shardsCount} BullMQ shards initialized successfully.`);
  }

  /**
   * Menghitung shard antrian berdasarkan hash dari nomor HP customer (Public untuk testing)
   */
  public getShardQueueName(phone: string): string {
    let hash = 0;
    for (let i = 0; i < phone.length; i++) {
      hash = (hash << 5) - hash + phone.charCodeAt(i);
      hash |= 0; // Ubah ke integer 32bit
    }
    const shardIndex = Math.abs(hash) % this.shardsCount;
    return `message_queue_shard_${shardIndex}`;
  }

  /**
   * Menambahkan pesan masuk ke dalam antrian pemrosesan
   */
  public async enqueueMessage(payload: QueuePayload): Promise<void> {
    const phone = payload.phone || payload.customerId;

    if (this.redisEnabled) {
      try {
        const queueName = this.getShardQueueName(phone);
        const queue = this.bullQueues.get(queueName);
        if (queue) {
          // Enqueue ke BullMQ
          await queue.add('process_message', payload, {
            // Cegah eksekusi ganda jika pesan identik masuk cepat (optional deduplication)
            jobId: resolveQueueJobId(phone, payload),
          });
          return;
        }
      } catch (err) {
        console.error(`[QUEUE ERROR] Failed to enqueue to BullMQ shard. Runtime fallback to In-Memory queue triggered. Error: ${(err as Error).message}`);
        this.redisEnabled = false;
      }
    }

    // Fallback log jika masuk antrian memori (termasuk warning jika di production)
    console.warn(`[QUEUE WARNING] Redis is offline. Enqueuing message for customer ${phone} into In-Memory Queue.`);
    this.enqueueInMemory(phone, payload);
  }

  /**
   * Penanganan Antrian di Memori (Bebas Redis)
   */
  private enqueueInMemory(phone: string, payload: QueuePayload): void {
    if (!this.memoryQueues.has(phone)) {
      this.memoryQueues.set(phone, []);
    }

    const queue = this.memoryQueues.get(phone)!;
    queue.push(payload);

    this.processNextInMemory(phone);
  }

  private async processNextInMemory(phone: string): Promise<void> {
    // Jika sedang memproses pesan untuk nomor ini, tunggu giliran berikutnya
    if (this.memoryProcessing.has(phone)) {
      return;
    }

    const queue = this.memoryQueues.get(phone);
    if (!queue || queue.length === 0) {
      return;
    }

    this.memoryProcessing.add(phone);
    const payload = queue.shift()!;

    try {
      const ctx = await this.resolveFreshContext(payload);
      if (!ctx) {
        this.memoryProcessing.delete(phone);
        this.processNextInMemory(phone);
        return;
      }

      // RACE CONDITION GUARD: Jika percakapan sudah di-takeover CS (is_human_handling = true),
      // batalkan eksekusi antrian bot agar tidak menimpa/bocor ke chat CS!
      if (ctx.conversation?.is_human_handling) {
        console.log(`[QUEUE ABORT] Conversation ${ctx.conversation.id} (customer: ${phone}) is in HUMAN_HANDLING mode. Dropping in-memory queued bot reply.`);
        return;
      }

      // EMERGENCY KILL-SWITCH GUARD: Jika cut-off outbound aktif, jangan proses balasan bot
      const { whatsappProviderService } = await import('./whatsapp-provider.service');
      const isCutOff = await whatsappProviderService.isOutboundCutOff(ctx.tenantId);
      if (isCutOff) {
        console.log(`[QUEUE CUT-OFF] Outbound Cut-Off is ACTIVE for tenant ${ctx.tenantId}. Dropping in-memory queued bot reply for customer: ${phone}.`);
        return;
      }

      console.log(`[QUEUE Memory-Fallback] Processing message for customer: ${ctx.customer.phone} (Tenant: ${ctx.tenantId}, Queue depth: ${queue.length})`);
      // Stage 5 Fase 2: claim atomik turn (fail-open).
      try {
        const { turnRepository } = await import('../repositories/turn.repository');
        const claimable = await turnRepository.claimForProcessing({
          tenantId: ctx.tenantId || DEFAULT_TENANT_ID, provider: payload?.provider || 'WAHA', inboundMessageId: payload?.inboundMessageId || '',
        });
        if (!claimable) {
          console.log(`[QUEUE TURN SKIP] Turn ${payload?.turnId} sudah diproses â€” lewati.`);
          return;
        }
      } catch {}
      await contextStorage.run(
        {
          correlationId: payload?.correlationId,
          turnId: payload?.turnId,
          provider: payload?.provider,
          inboundMessageId: payload?.inboundMessageId,
          phone: ctx.customer.phone,
        },
        async () => {
          await stateMachine.processMessage(ctx);
        }
      );
      try {
        const { turnRepository } = await import('../repositories/turn.repository');
        await turnRepository.markStatus({ tenantId: ctx.tenantId || DEFAULT_TENANT_ID, provider: payload?.provider || 'WAHA', inboundMessageId: payload?.inboundMessageId || '', status: 'RESPONSE_READY' });
      } catch {}
    } catch (e: any) {
      console.error(`[QUEUE Memory-Fallback ERROR] Failed processing message for ${phone}:`, e.message);
      const attempts = ((payload as any)._memoryAttempts || 0) + 1;
      (payload as any)._memoryAttempts = attempts;
      if (attempts <= 2) {
        const backoffMs = 1000 * attempts;
        console.warn(`[QUEUE RETRY] Re-queue ${phone} attempt ${attempts}/2 backoff ${backoffMs}ms`);
        // flag retry pending — finally akan skip cleanup, biarkan timeout yang lanjutkan
        (payload as any)._retryPending = true;
        setTimeout(() => {
          (payload as any)._retryPending = false;
          const q = this.memoryQueues.get(phone) || [];
          q.unshift(payload as any);
          this.memoryQueues.set(phone, q);
          this.memoryProcessing.delete(phone);
          this.processNextInMemory(phone);
        }, backoffMs);
      } else {
        // Dead-letter: max retries exceeded → alert
        console.error(`[QUEUE DEAD-LETTER] ${phone} tenant=${(payload as any).tenantId || '-'} permanently failed after ${attempts} attempts: ${e.message}`);
        try {
          const { alertService, AlertType, AlertSeverity } = await import('./alert.service');
          await alertService.notifyAlert({
            type: AlertType.QUEUE_JOB_FAILED,
            severity: AlertSeverity.CRITICAL,
            message: `[QUEUE DEAD-LETTER] In-memory ${phone} failed after ${attempts} attempts: ${e.message}`,
            metadata: { tenantId: (payload as any).tenantId, phone: hashPiiPhone(phone), error: e.message, attempts },
          });
        } catch {}
      }
    } finally {
      const isRetryPending = (payload as any)._retryPending === true;
      if (isRetryPending) return;
      this.memoryProcessing.delete(phone);
      this.processNextInMemory(phone);
    }
  }

  /**
   * Re-fetch fresh customer & conversation dari DB (dengan fallback memory store) tepat
   * sebelum memproses job â€” mencegah race condition / stale state saat pesan beruntun
   * masuk dalam waktu singkat. Payload queue hanya membawa identifier; snapshot lama
   * TIDAK dipakai sebagai last resort karena justru melanggengkan bug.
   * Mengembalikan null jika customer tidak bisa di-resolve â†’ job di-skip + di-log.
   */
  private async resolveFreshContext(payload: QueuePayload): Promise<StateHandlerContext | null> {
    const { tenantId, customerId, phone, incomingMessage } = payload;

    let customer = await customerService.getCustomerById(customerId, tenantId);
    if (!customer && phone) {
      customer = await customerService.getOrCreateCustomer(phone, undefined, tenantId);
    }
    if (!customer) {
      console.error(`[QUEUE SKIP] Customer ${customerId} tidak ditemukan untuk tenant ${tenantId}. Job dibuang.`);
      return null;
    }

    const conversation = await conversationService.getOrCreateConversation(customer.id, tenantId);

    return { tenantId, customer, conversation, incomingMessage };
  }

  /**
   * Memaksa penutupan koneksi Redis untuk simulasi fallback/disconnection dalam test
   */
  public async forceDisconnectRedis(): Promise<void> {
    if (this.redisClient) {
      await this.redisClient.disconnect();
    }
    this.redisEnabled = false;
    console.warn('âš ï¸ [QUEUE TEST] Redis connection has been forced offline.');
  }

  /**
   * Menghentikan sementara antrian pemrosesan saat WAHA terputus (DISCONNECTED/STOPPED).
   * Notifikasi otomatis dikirim via AlertService.
   */
  public async pauseQueue(): Promise<void> {
    if (this.isPaused) return;

    this.isPaused = true;
    this.pauseTimestamp = Date.now();

    for (const queue of this.bullQueues.values()) {
      await queue.pause().catch(() => {});
    }

    const { alertService, AlertType, AlertSeverity } = await import('./alert.service');
    await alertService.notifyAlert({
      type: AlertType.WAHA_DISCONNECTED,
      severity: AlertSeverity.CRITICAL,
      message: 'WAHA session disconnected or stopped. Outbound message queue PAUSED to prevent lost messages.',
    });

    console.warn('âš ï¸ [QUEUE PAUSED] Message processing paused due to WAHA disconnection.');
  }

  /**
   * Melanjutkan kembali antrian pemrosesan saat WAHA terhubung kembali (WORKING/CONNECTED).
   */
  public async resumeQueue(): Promise<void> {
    if (!this.isPaused) return;

    this.isPaused = false;
    this.pauseTimestamp = null;

    for (const queue of this.bullQueues.values()) {
      await queue.resume().catch(() => {});
    }

    const { alertService, AlertType, AlertSeverity } = await import('./alert.service');
    await alertService.notifyAlert({
      type: AlertType.WAHA_DISCONNECTED,
      severity: AlertSeverity.INFO,
      message: 'WAHA session reconnected. Resuming outbound message queue processing.',
    });

    console.log('âš¡ [QUEUE RESUMED] Message processing resumed after WAHA reconnection.');
  }

  public isQueuePaused(): boolean {
    return this.isPaused;
  }

  /**
   * Mengevaluasi apakah job peka waktu (misal Reminder H-1) sudah kedaluwarsa (> 6 jam pasca downtime).
   * Jika > 6 jam: kembalikan true (diberi status SKIPPED_EXPIRED). Jika <= 6 jam: kembalikan false.
   */
  public isJobExpired(scheduledTime: Date | number, isTimeSensitive = false): boolean {
    if (!isTimeSensitive) return false;
    const scheduledMs = typeof scheduledTime === 'number' ? scheduledTime : scheduledTime.getTime();
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    return Date.now() - scheduledMs > SIX_HOURS_MS;
  }

  /**
   * Helper untuk menutup seluruh koneksi queue/worker (dipakai saat shutdown server)
   */
  public async close(): Promise<void> {
    for (const [name, queue] of this.bullQueues.entries()) {
      await queue.close();
    }
    for (const [name, worker] of this.bullWorkers.entries()) {
      await worker.close();
    }
    if (this.redisClient && this.redisClient.status !== 'end') {
      await this.redisClient.quit().catch(() => {});
    }
    this.redisEnabled = false;
    console.log('[QUEUE] All BullMQ and Redis connections closed.');
  }

  /**
   * Mengecek apakah Redis saat ini aktif
   */
  public isRedisEnabled(): boolean {
    return this.redisEnabled;
  }
}

export const queueService = new QueueService();

