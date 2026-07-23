import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { stateMachine } from '../state-machine/machine';
import { StateHandlerContext } from '../state-machine/types';
import dotenv from 'dotenv';
dotenv.config();

export interface QueuePayload {
  tenantId: string;
  customer: any;
  conversation: any;
  incomingMessage: any;
}

export class QueueService {
  private redisEnabled: boolean = false;
  private redisClient: Redis | null = null;
  private bullQueues: Map<string, Queue> = new Map();
  private bullWorkers: Map<string, Worker> = new Map();
  private shardsCount: number = 5;

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

      this.redisClient.connect()
        .then(() => {
          console.log(`\n⚡ [QUEUE] Successfully connected to Redis at ${host}:${port}. Initializing sharded BullMQ...`);
          this.redisEnabled = true;
          this.initBullMQShards();
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

    for (let i = 0; i < this.shardsCount; i++) {
      const queueName = `message_queue_shard_${i}`;
      
      const connection = new Redis({
        host,
        port,
        maxRetriesPerRequest: null,
      });

      // 1. Buat Queue
      const queue = new Queue(queueName, { connection });
      this.bullQueues.set(queueName, queue);

      // 2. Buat Worker dengan concurrency = 1 (proses pesan berurutan per antrian)
      const worker = new Worker(
        queueName,
        async (job: Job<QueuePayload>) => {
          const { tenantId, customer, conversation, incomingMessage } = job.data;
          console.log(`[QUEUE BullMQ - Shard ${i}] Processing message for customer: ${customer.phone} (Tenant: ${tenantId})`);
          await stateMachine.processMessage({
            tenantId,
            customer,
            conversation,
            incomingMessage,
          });
        },
        {
          connection,
          concurrency: 1, // Penting: Menjamin satu pesan diproses satu per satu per antrian
        }
      );

      worker.on('failed', (job, err) => {
        console.error(`[QUEUE BullMQ - Shard ${i}] Job ${job?.id} failed:`, err.message);
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
    const phone = payload.customer.phone;

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
      console.log(`[QUEUE Memory-Fallback] Processing message for customer: ${phone} (Tenant: ${payload.tenantId}, Queue depth: ${queue.length})`);
      await stateMachine.processMessage({
        tenantId: payload.tenantId,
        customer: payload.customer,
        conversation: payload.conversation,
        incomingMessage: payload.incomingMessage,
      });
    } catch (e: any) {
      console.error(`[QUEUE Memory-Fallback ERROR] Failed processing message for ${phone}:`, e.message);
    } finally {
      this.memoryProcessing.delete(phone);
      // Pemicu otomatis untuk pesan berikutnya di antrian customer tersebut
      this.processNextInMemory(phone);
    }
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
