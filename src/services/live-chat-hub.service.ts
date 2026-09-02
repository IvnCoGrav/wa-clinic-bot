import Redis from 'ioredis';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

export type LiveChatHubEventType = 'conversation.updated' | 'message.created' | 'message.updated' | 'message.status_updated' | 'sync.progress' | 'bot.cutoff_changed';

/**
 * Event real-time yang dipublikasikan ke Live Chat Panel admin.
 * `_instanceId` dipakai untuk loopback-skip: instance yang mempublish eventnya sendiri
 * tidak boleh menerima event yang sama dari subscriber Redis-nya.
 */
export interface LiveChatHubEvent {
  type: LiveChatHubEventType;
  tenantId: string;
  payload: Record<string, any>;
  _instanceId?: string;
}

/**
 * SSE Hub untuk Live Chat Panel.
 *
 * Arsitektur:
 * - Multi-instance (SaaS): publish ke Redis pub/sub channel `livechat:{tenantId}`.
 * - Koneksi Redis dedicated (terpisah dari BullMQ/queue.service) — sesuai plan.
 * - Fallback in-memory (EventEmitter) saat Redis offline, dengan ALERT format yang
 *   SAMA dengan fallback queue.service agar admin tidak bingung ada dua jenis
 *   "Redis down" alert dengan format berbeda.
 * - Loopback-skip berbasis `_instanceId` agar tidak ada duplikasi event di instance sendiri.
 */
export class LiveChatHubService {
  private readonly instanceId: string;
  private redisEnabled: boolean = false;
  private redisPublisher: Redis | null = null;
  private redisSubscriber: Redis | null = null;
  private subscribedChannels: Set<string> = new Set();
  private readonly localBus: EventEmitter = new EventEmitter();
  private readonly readyPromise: Promise<void>;

  constructor() {
    this.instanceId = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    this.readyPromise = this.init();
  }

  private channelFor(tenantId: string): string {
    return `livechat:${tenantId}`;
  }

  private init(): Promise<void> {
    if (process.env.DISABLE_REDIS === 'true') {
      this.redisEnabled = false;
      return Promise.resolve();
    }

    const host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);

    return new Promise<void>((resolve) => {
      try {
        this.redisPublisher = new Redis({
          host,
          port,
          connectTimeout: 2000,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
        });
        this.redisSubscriber = new Redis({
          host,
          port,
          connectTimeout: 2000,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
        });

        // Format alert KONSISTEN dengan queue.service (severity CRITICAL + suffix yang sama).
        const onError = (err: Error) => {
          if (this.redisEnabled) {
            console.error(
              `\n🚨 [CRITICAL ALERT] Redis connection lost/error at runtime! Entering In-Memory LiveChat Hub Fallback Mode. Please check Redis server immediately. Error: ${err.message}`
            );
            this.redisEnabled = false;
          }
        };
        this.redisPublisher.on('error', onError);
        this.redisSubscriber.on('error', onError);

        this.redisSubscriber.on('message', (channel: string, message: string) => {
          try {
            const event = JSON.parse(message) as LiveChatHubEvent;
            // Loopback-skip: jangan kirim balik event yang kita publish sendiri
            if (event._instanceId && event._instanceId === this.instanceId) {
              return;
            }
            this.localBus.emit(channel, event);
          } catch (err) {
            // Abaikan payload yang tidak valid
          }
        });

        Promise.all([this.redisPublisher.connect(), this.redisSubscriber.connect()])
          .then(() => {
            this.redisEnabled = true;
            resolve();
          })
          .catch((err) => {
            console.error(
              `\n🚨 [CRITICAL ALERT] Redis connection failed during startup: ${err.message}. Entering In-Memory LiveChat Hub Fallback Mode. Please check Redis server immediately.`
            );
            this.redisEnabled = false;
            resolve();
          });
      } catch (e: any) {
        console.error(
          `\n🚨 [CRITICAL ALERT] Could not initialize Redis client: ${e.message}. Entering In-Memory LiveChat Hub Fallback Mode. Please check Redis server immediately.`
        );
        this.redisEnabled = false;
        resolve();
      }
    });
  }

  /**
   * Promise yang resolve saat inisialisasi Redis selesai (sukses ATAU fallback).
   * Dipakai test untuk menunggu status koneksi final sebelum mengasertikan perilaku.
   */
  public whenReady(): Promise<void> {
    return this.readyPromise;
  }

  /**
   * Publikasikan event ke channel tenant. Fire-and-forget yang aman:
   * 1. Selalu emit langsung ke subscriber lokal di instance ini.
   * 2. Broadcast ke instance lain lewat Redis pub/sub (jika Redis aktif).
   */
  public async publish(event: LiveChatHubEvent): Promise<void> {
    const channel = this.channelFor(event.tenantId);
    event._instanceId = this.instanceId;

    // 1. Emit langsung ke subscriber lokal (SSE client di instance ini)
    this.localBus.emit(channel, event);

    // 2. Broadcast ke instance lain via Redis jika Redis aktif
    if (this.redisEnabled && this.redisPublisher) {
      try {
        await this.redisPublisher.publish(channel, JSON.stringify(event));
      } catch (err: any) {
        console.error(
          `\n🚨 [CRITICAL ALERT] Redis publish failed at runtime: ${err.message}. Entering In-Memory LiveChat Hub Fallback Mode. Please check Redis server immediately.`
        );
        this.redisEnabled = false;
      }
    }
  }

  /**
   * Subscribe ke channel tenant. Mengembalikan fungsi unsubscribe.
   * Selalu memakai EventEmitter lokal sebagai bus tunggal, dengan Redis subscriber
   * sebagai sumber event lintas-instance (loopback di-skip).
   */
  public async subscribe(
    tenantId: string,
    callback: (event: LiveChatHubEvent) => void
  ): Promise<() => void> {
    const channel = this.channelFor(tenantId);
    const listener = (event: LiveChatHubEvent) => callback(event);
    this.localBus.on(channel, listener);

    if (this.redisEnabled && this.redisSubscriber) {
      try {
        await this.ensureSubscribed(channel);
      } catch (err) {
        // Fallback: tetap jalan via EventEmitter lokal saja
      }
    }

    return () => {
      this.localBus.removeListener(channel, listener);
    };
  }

  private async ensureSubscribed(channel: string): Promise<void> {
    if (this.subscribedChannels.has(channel)) return;
    if (!this.redisSubscriber) return;
    await this.redisSubscriber.subscribe(channel);
    this.subscribedChannels.add(channel);
  }

  public isRedisEnabled(): boolean {
    return this.redisEnabled;
  }

  public getInstanceId(): string {
    return this.instanceId;
  }

  /**
   * Memaksa Redis offline (untuk test) — analog queueService.forceDisconnectRedis().
   */
  public async forceDisconnectRedis(): Promise<void> {
    try {
      if (this.redisPublisher) {
        await this.redisPublisher.disconnect();
      }
      if (this.redisSubscriber) {
        await this.redisSubscriber.disconnect();
      }
    } catch (err) {
      // Abaikan error disconnect pada force-offline
    }
    this.redisEnabled = false;
    console.warn('⚠️ [LIVECHAT HUB TEST] Redis connection has been forced offline.');
  }

  public async close(): Promise<void> {
    try {
      if (this.redisPublisher) {
        await this.redisPublisher.quit();
      }
      if (this.redisSubscriber) {
        await this.redisSubscriber.quit();
      }
    } catch (err) {
      // Abaikan error saat quit
    }
    this.redisEnabled = false;
    console.log('[LIVECHAT HUB] Redis connections closed.');
  }
}

export const liveChatHubService = new LiveChatHubService();

// Dependency Injection sederhana (tanpa branch NODE_ENV):
// route/test dapat mengganti instance aktif via setLiveChatHub(), mis. fake hub di test.
let activeHub: LiveChatHubService = liveChatHubService;

export function setLiveChatHub(hub: LiveChatHubService): void {
  activeHub = hub;
}

export function getLiveChatHub(): LiveChatHubService {
  return activeHub;
}
