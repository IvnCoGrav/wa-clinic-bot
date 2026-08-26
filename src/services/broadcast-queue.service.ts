import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { TEMPLATES } from '../config/persona';
import { typingService } from './typing.service';
import dotenv from 'dotenv';

dotenv.config();

export interface BroadcastJobData {
  followUpId: string;
  customerId: string;
  tenantId: string;
}

export class BroadcastQueueService {
  private queueName = 'broadcast_queue';
  private redisEnabled = false;
  private redisClient: Redis | null = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  // Fallback in-memory queue
  private memoryQueue: BroadcastJobData[] = [];
  private isProcessingMemory = false;

  constructor() {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);

    try {
      this.redisClient = new Redis({
        host,
        port,
        maxRetriesPerRequest: null,
        connectTimeout: 3000,
        lazyConnect: true,
      });

      this.redisClient.on('error', () => {
        this.redisEnabled = false;
      });

      this.redisClient.connect()
        .then(() => {
          this.redisEnabled = true;
          this.initBullMQ();
        })
        .catch(() => {
          this.redisEnabled = false;
          console.warn('[Broadcast Queue] Redis offline. Initializing In-Memory Fallback.');
        });
    } catch {
      this.redisEnabled = false;
    }
  }

  /**
   * Inisialisasi BullMQ Queue dan Worker
   */
  private initBullMQ(): void {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);

    const connection = new Redis({
      host,
      port,
      maxRetriesPerRequest: null,
    });

    this.queue = new Queue(this.queueName, { connection });
    this.worker = new Worker(
      this.queueName,
      async (job: Job<BroadcastJobData>) => {
        await this.processBroadcastJob(job.data);
      },
      {
        connection,
        concurrency: 1, // Memproses satu per satu
      }
    );

    this.worker.on('failed', (job, err) => {
      console.error(`[Broadcast Queue] Job ${job?.id} failed:`, err.message);
    });
  }

  /**
   * Cron job harian (jam 08:30) memasukkan semua follow_ups pending yang jatuh tempo
   */
  public async enqueuePendingFollowUps(): Promise<void> {
    if (process.env.ENABLE_FOLLOWUP_WORKER !== 'true') {
      return;
    }
    try {
      const now = new Date();
      const today0900 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0);
      // Ambil follow-up yang status PENDING dan waktu scheduled_at <= jam 9 hari ini
      const pendingFollowUps = await prisma.followUp.findMany({
        where: {
          status: 'PENDING',
          scheduled_at: { lte: today0900 },
          tenant_id: DEFAULT_TENANT_ID,
        },
      });

      if (pendingFollowUps.length === 0) {
        console.log('[Broadcast Queue] No pending follow-ups to enqueue.');
        return;
      }

      console.log(`[Broadcast Queue] Enqueuing ${pendingFollowUps.length} pending follow-ups...`);

      // LANGSUNG update status ke QUEUED untuk menghindari double-enqueuing
      await prisma.followUp.updateMany({
        where: {
          id: { in: pendingFollowUps.map(f => f.id) },
        },
        data: { status: 'QUEUED' },
      });

      const delayMs = Math.max(0, today0900.getTime() - now.getTime());

      for (const f of pendingFollowUps) {
        const payload: BroadcastJobData = {
          followUpId: f.id,
          customerId: f.customer_id,
          tenantId: f.tenant_id,
        };

        if (this.redisEnabled && this.queue) {
          await this.queue.add('send_broadcast', payload, {
            jobId: `broadcast_${f.id}`,
            delay: delayMs,
          });
        } else {
          this.memoryQueue.push(payload);
        }
      }

      if (!this.redisEnabled) {
        if (delayMs > 0) {
          setTimeout(() => this.triggerMemoryProcessing(), delayMs);
        } else {
          this.triggerMemoryProcessing();
        }
      }
    } catch (err) {
      console.error('[Broadcast Queue] Failed to enqueue pending follow-ups:', err);
    }
  }

  /**
   * Logika Worker memproses pengiriman pesan broadcast tunggal
   */
  public async processBroadcastJob(data: BroadcastJobData): Promise<void> {
    const { followUpId, customerId, tenantId } = data;

    // 1. Cek Jam Kerja (09:00 - 18:00)
    const now = new Date();
    const currentHour = now.getHours();

    if (currentHour < 9 || currentHour >= 18) {
      console.log(`[Broadcast Queue] Outside business hours (${currentHour}:00). Rescheduling follow-up ${followUpId} to tomorrow at 09:00.`);
      
      const tomorrow0900 = new Date();
      tomorrow0900.setDate(tomorrow0900.getDate() + 1);
      tomorrow0900.setHours(9, 0, 0, 0);

      // Kembalikan ke PENDING dengan waktu baru agar dicrowd oleh cron besok pagi
      await prisma.followUp.update({
        where: { id: followUpId },
        data: {
          status: 'PENDING',
          scheduled_at: tomorrow0900,
        },
      });
      return;
    }

    try {
      // 2. Ambil data customer dan follow-up di database
      const followUp = await prisma.followUp.findUnique({
        where: { id: followUpId },
        include: { customer: true },
      });

      if (!followUp || followUp.status !== 'QUEUED') {
        console.log(`[Broadcast Queue] Follow-up ${followUpId} is not in QUEUED state (possibly cancelled). Skipping.`);
        return;
      }

      const customer = followUp.customer;
      if (!customer || customer.status === 'blocked' || customer.status === 'lost') {
        console.log(`[Broadcast Queue] Customer ${customerId} is blocked or lost. Cancelling follow-up.`);
        await prisma.followUp.update({
          where: { id: followUpId },
          data: { status: 'CANCELLED' },
        });
        return;
      }

      // 3. Cari template pesan acak dari array
      let replyText = '';
      const name = customer.name || 'Bunda';

      if (followUp.type === 'NO_PURCHASE') {
        let variants: any[] = [];
        if (followUp.stage === 1) {
          variants = TEMPLATES.followUpNoPurchaseDay3;
        } else if (followUp.stage === 2) {
          variants = TEMPLATES.followUpNoPurchaseDay7;
        } else {
          variants = TEMPLATES.followUpNoPurchaseDay14;
        }
        
        const randomIndex = Math.floor(Math.random() * variants.length);
        replyText = variants[randomIndex]({ name });
      } else if (followUp.type === 'NEXT_TREATMENT') {
        const variants = TEMPLATES.nextTreatmentFollowUp;
        const randomIndex = Math.floor(Math.random() * variants.length);
        replyText = variants[randomIndex]({ name, childrenSummary: 'si Kecil' });
      }

      if (!replyText) {
        throw new Error(`Failed to resolve template for follow-up: ${followUpId}`);
      }

      // Pre-log pesan follow-up ke tabel messages untuk Live Chat
      const targetTenantId = followUp.tenant_id || DEFAULT_TENANT_ID;
      try {
        const { conversationService } = await import('./conversation.service');
        const { messageService } = await import('./message.service');
        const conv = await conversationService.getOrCreateConversation(customer.id, targetTenantId);
        if (conv) {
          await messageService.logMessage({
            tenantId: targetTenantId,
            conversationId: conv.id,
            direction: 'OUTBOUND',
            content: replyText,
            senderType: 'BOT',
            senderName: 'Bot (Follow-Up)',
          });
        }
      } catch (logErr: any) {
        console.warn('[Broadcast Queue] Failed to log follow-up message to DB:', logErr.message);
      }

      // 4. Kirim pesan dengan simulasi human typing
      console.log(`[Broadcast Queue] Sending throttled follow-up (Stage ${followUp.stage}) to ${customer.phone}`);
      const res = await typingService.simulateHumanReply({
        chatId: customer.phone,
        replyText,
        tenantId: targetTenantId,
      });

      if (!res.success) {
        throw new Error(`Typing simulation failed: ${res.error}`);
      }

      // 5. Update Status Follow-Up ke SENT
      await prisma.followUp.update({
        where: { id: followUpId },
        data: {
          status: 'SENT',
          sent_at: new Date(),
        },
      });



      // 7. Jeda Acak (Random Jitter) Throttling 20 - 45 detik (0s in test mode unless overridden)
      const isTestEnv = process.env.NODE_ENV === 'test' && process.env.ENABLE_BROADCAST_THROTTLING_TEST !== 'true';
      const randomDelayMs = Math.floor(Math.random() * (45000 - 20000 + 1)) + 20000;
      if (!isTestEnv) {
        console.log(`[Broadcast Queue] Throttling: Waiting for ${randomDelayMs / 1000}s before next job.`);
        await new Promise((resolve) => setTimeout(resolve, randomDelayMs));
      }

    } catch (err: any) {
      console.error(`[Broadcast Queue] Error processing job ${followUpId}:`, err.message);
      // Kembalikan ke PENDING agar dicoba lagi
      await prisma.followUp.update({
        where: { id: followUpId },
        data: { status: 'PENDING' },
      }).catch(() => {});
    }
  }

  /**
   * Memproses antrian memori fallback
   */
  private async triggerMemoryProcessing(): Promise<void> {
    if (this.isProcessingMemory || this.memoryQueue.length === 0) return;
    this.isProcessingMemory = true;

    while (this.memoryQueue.length > 0) {
      const data = this.memoryQueue.shift();
      if (data) {
        await this.processBroadcastJob(data);
      }
    }
    this.isProcessingMemory = false;
  }

  /**
   * Menutup koneksi Redis
   */
  public async close(): Promise<void> {
    if (this.queue) await this.queue.close();
    if (this.worker) await this.worker.close();
    if (this.redisClient) await this.redisClient.quit().catch(() => {});
  }

  /**
   * Status koneksi Redis (dipakai health endpoint untuk deteksi degradasi).
   */
  public isRedisEnabled(): boolean {
    return this.redisEnabled;
  }
}

export const broadcastQueueService = new BroadcastQueueService();
