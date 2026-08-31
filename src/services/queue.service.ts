import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { stateMachine } from '../state-machine/machine';
import { StateHandlerContext } from '../state-machine/types';
import { customerService } from './customer.service';
import { conversationService } from './conversation.service';
import { hashPiiPhone } from '../utils/logger-sanitizer';
import dotenv from 'dotenv';
dotenv.config();

export interface QueuePayload {
  tenantId: string;
  customerId: string;
  phone?: string;
  incomingMessage: any;
}

export class QueueService {
  private redisEnabled: boolean = false;
  private redisClient: Redis | null = null;
  private bullQueues: Map<string, Queue> = new Map();
  private bullWorkers: Map<string, Worker> = new Map();
  private shardsCount: number = 5;

  // Pause/Resume state for WAHA disconnection resilience
  private isPaused: boolean = false;
  private pauseTimestamp: number | null = null;

  // In-Memory Queue Fallback properties
  private memoryQueues: Map<string, QueuePayload[]> = new Map();
  private memoryProcessing: Set<string> = new Set();


  constructor() {
    this.shardsCount = parseInt(process.env.QUEUE_SHARDS || '5', 10);
    this.initQueueSystem();
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
          console.error(`\n🚨 [CRITICAL ALERT] Redis connection lost/error at runtime! Entering In-Memory Message Queue Fallback Mode. Please check Redis server immediately. Error: ${err.message}`);
          this.redisEnabled = false;
        }
      });

      // Event listener untuk pemulihan koneksi saat Redis kambuh / reconnect di background
      this.redisClient.on('ready', () => {
        if (!this.redisEnabled) {
          console.log(`\n⚡ [QUEUE] Redis connection restored/ready at ${host}:${port}. Restoring BullMQ mode...`);
          this.redisEnabled = true;
          if (this.bullQueues.size === 0) {
            this.initBullMQShards();
          }
        }
      });

      this.redisClient.connect()
        .then(() => {
          console.log(`\n⚡ [QUEUE] Successfully connected to Redis at ${host}:${port}. Initializing sharded BullMQ...`);
          this.redisEnabled = true;
          if (this.bullQueues.size === 0) {
            this.initBullMQShards();
          }
        })
        .catch((err) => {
          console.error(`\n🚨 [CRITICAL ALERT] Redis connection failed during startup: ${err.message}. Entering In-Memory Message Queue Fallback Mode. Please check Redis server immediately.`);
          this.redisEnabled = false;
        });
    } catch (e: any) {
      console.error(`\n🚨 [CRITICAL ALERT] Could not initialize Redis client: ${e.message}. Entering In-Memory Message Queue Fallback Mode. Please check Redis server immediately.`);
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
            await stateMachine.processMessage(ctx);
          } catch (err: any) {
            console.error(`[QUEUE BullMQ - Shard ${i}] Exception during processMessage for job ${job.id}:`, err.message);
            throw err; // Throw agar BullMQ mencatat attempt gagal dan menjalankan retry backoff
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
          console.error(`🚨 [QUEUE BullMQ - Shard ${i}] Job ${job.id} PERMANENTLY FAILED after ${job.attemptsMade} attempts.`);
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
    console.log(`📌 [QUEUE] ${this.shardsCount} BullMQ shards initialized successfully.`);
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
            jobId: `job_${phone}_${payload.incomingMessage.id}`,
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
      await stateMachine.processMessage(ctx);
    } catch (e: any) {
      console.error(`[QUEUE Memory-Fallback ERROR] Failed processing message for ${phone}:`, e.message);
    } finally {
      this.memoryProcessing.delete(phone);
      // Pemicu otomatis untuk pesan berikutnya di antrian customer tersebut
      this.processNextInMemory(phone);
    }
  }

  /**
   * Re-fetch fresh customer & conversation dari DB (dengan fallback memory store) tepat
   * sebelum memproses job — mencegah race condition / stale state saat pesan beruntun
   * masuk dalam waktu singkat. Payload queue hanya membawa identifier; snapshot lama
   * TIDAK dipakai sebagai last resort karena justru melanggengkan bug.
   * Mengembalikan null jika customer tidak bisa di-resolve → job di-skip + di-log.
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
    console.warn('⚠️ [QUEUE TEST] Redis connection has been forced offline.');
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

    console.warn('⚠️ [QUEUE PAUSED] Message processing paused due to WAHA disconnection.');
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

    console.log('⚡ [QUEUE RESUMED] Message processing resumed after WAHA reconnection.');
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

