import webpush from 'web-push';
import fs from 'fs';
import path from 'path';
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

export interface WebPushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
  badge?: string;
  image?: string;
  data?: Record<string, any>;
}

export interface StoredSubscription {
  id: string;
  tenant_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_type: string;
  user_id?: string | null;
  user_agent?: string | null;
}

const STORAGE_FILE = path.join(process.cwd(), 'storage', 'vapid_keys.json');

export class WebPushService {
  private static instance: WebPushService | null = null;
  private memorySubscriptions = new Map<string, StoredSubscription>();
  private vapidKeys: { publicKey: string; privateKey: string } | null = null;
  private vapidSubject = 'mailto:admin@kala-clinic.com';

  private constructor() {
    this.initVapid();
  }

  public static getInstance(): WebPushService {
    if (!this.instance) {
      this.instance = new WebPushService();
    }
    return this.instance;
  }

  /**
   * Inisialisasi VAPID keys dari ENV, File Storage, atau Generate Baru.
   */
  private initVapid(): void {
    const envPublic = process.env.VAPID_PUBLIC_KEY;
    const envPrivate = process.env.VAPID_PRIVATE_KEY;
    const envSubject = process.env.VAPID_SUBJECT;

    if (envSubject) {
      this.vapidSubject = envSubject;
    }

    if (envPublic && envPrivate) {
      this.vapidKeys = {
        publicKey: envPublic.trim(),
        privateKey: envPrivate.trim(),
      };
    } else {
      // Baca dari file persistent jika ada
      try {
        if (fs.existsSync(STORAGE_FILE)) {
          const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
          const data = JSON.parse(raw);
          if (data.publicKey && data.privateKey) {
            this.vapidKeys = data;
          }
        }
      } catch (err) {
        console.warn('[WEB PUSH] Gagal membaca storage/vapid_keys.json:', err);
      }

      // Jika masih null, generate baru dan simpan
      if (!this.vapidKeys) {
        const generated = webpush.generateVAPIDKeys();
        this.vapidKeys = generated;
        try {
          const dir = path.dirname(STORAGE_FILE);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(STORAGE_FILE, JSON.stringify(generated, null, 2), 'utf-8');
          console.log('[WEB PUSH] Pasangan VAPID keys baru berhasil dibuat & disimpan ke storage/vapid_keys.json.');
        } catch (saveErr) {
          console.warn('[WEB PUSH] Gagal menyimpan vapid_keys.json:', saveErr);
        }
      }
    }

    if (this.vapidKeys) {
      webpush.setVapidDetails(
        this.vapidSubject,
        this.vapidKeys.publicKey,
        this.vapidKeys.privateKey
      );
    }
  }

  /**
   * Mengembalikan VAPID public key untuk dikirim ke frontend browser.
   */
  public getPublicKey(): string {
    if (!this.vapidKeys) {
      this.initVapid();
    }
    return this.vapidKeys?.publicKey || '';
  }

  /**
   * Menyimpan / memperbarui langganan Push Subscription dari browser.
   */
  public async saveSubscription(params: {
    tenantId?: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userType?: string;
    userId?: string;
    userAgent?: string;
  }): Promise<StoredSubscription> {
    const tenantId = params.tenantId || DEFAULT_TENANT_ID;
    const userType = params.userType || 'ADMIN';
    const subObj: StoredSubscription = {
      id: `sub_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      tenant_id: tenantId,
      endpoint: params.endpoint,
      p256dh: params.p256dh,
      auth: params.auth,
      user_type: userType,
      user_id: params.userId || null,
      user_agent: params.userAgent || null,
    };

    // 1. Simpan ke in-memory map
    this.memorySubscriptions.set(params.endpoint, subObj);

    // 2. Simpan ke database Prisma jika tersedia
    try {
      const dbSub = await prisma.pushSubscription.upsert({
        where: { endpoint: params.endpoint },
        update: {
          tenant_id: tenantId,
          p256dh: params.p256dh,
          auth: params.auth,
          user_type: userType,
          user_id: params.userId || null,
          user_agent: params.userAgent || null,
        },
        create: {
          tenant_id: tenantId,
          endpoint: params.endpoint,
          p256dh: params.p256dh,
          auth: params.auth,
          user_type: userType,
          user_id: params.userId || null,
          user_agent: params.userAgent || null,
        },
      });
      return {
        id: dbSub.id,
        tenant_id: dbSub.tenant_id,
        endpoint: dbSub.endpoint,
        p256dh: dbSub.p256dh,
        auth: dbSub.auth,
        user_type: dbSub.user_type,
        user_id: dbSub.user_id,
        user_agent: dbSub.user_agent,
      };
    } catch {
      // Database offline fallback
      return subObj;
    }
  }

  /**
   * Menghapus langganan Push Subscription (misal saat logout atau token invalid).
   */
  public async removeSubscription(endpoint: string): Promise<boolean> {
    this.memorySubscriptions.delete(endpoint);
    try {
      await prisma.pushSubscription.delete({ where: { endpoint } });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Mengambil semua Push Subscription aktif untuk tenant tertentu.
   */
  public async getSubscriptions(tenantId: string, userType?: string): Promise<StoredSubscription[]> {
    try {
      const whereClause: any = { tenant_id: tenantId };
      if (userType) whereClause.user_type = userType;
      const list = await prisma.pushSubscription.findMany({ where: whereClause });
      if (list && list.length > 0) {
        return list;
      }
    } catch {
      // DB offline fallback ke memory
    }

    const memoryList: StoredSubscription[] = [];
    for (const sub of this.memorySubscriptions.values()) {
      if (sub.tenant_id === tenantId && (!userType || sub.user_type === userType)) {
        memoryList.push(sub);
      }
    }
    return memoryList;
  }

  /**
   * Mengirim Push Notification ke semua perangkat aktif milik tenant.
   */
  public async sendPushToTenant(
    tenantId: string,
    payload: WebPushPayload,
    targetUserType?: string
  ): Promise<{ sent: number; failed: number }> {
    if (!this.vapidKeys) {
      this.initVapid();
    }

    const subscriptions = await this.getSubscriptions(tenantId, targetUserType);
    if (subscriptions.length === 0) {
      console.log(`[WEB PUSH] No active push subscriptions found for tenant '${tenantId}'`);
      return { sent: 0, failed: 0 };
    }

    console.log(`[WEB PUSH] Dispatching notification to ${subscriptions.length} device(s) for tenant '${tenantId}': "${payload.title}" - "${payload.body}"`);

    let sent = 0;
    let failed = 0;

    const stringifiedPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url || '/admin/#/live-chat',
      tag: payload.tag || 'chat-notification',
      icon: payload.icon || '/admin/favicon.ico',
      badge: payload.badge || '/admin/favicon.ico',
      image: payload.image,
      data: payload.data || {},
    });

    await Promise.all(
      subscriptions.map(async (sub) => {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        };

        try {
          const ttlSeconds = parseInt(process.env.WEB_PUSH_TTL_SECONDS || '1800', 10);
          const ttl = Number.isNaN(ttlSeconds) || ttlSeconds <= 0 ? 1800 : ttlSeconds;

          await webpush.sendNotification(pushSubscription, stringifiedPayload, {
            TTL: ttl,
            urgency: 'high',
          });
          sent++;
          console.log(`[WEB PUSH] Delivered push successfully to ${sub.endpoint.slice(0, 45)}...`);
        } catch (err: any) {
          failed++;
          const status = err.statusCode || err.status;
          // HTTP 410 Gone / 404 Not Found: perangkat sudah uninstall / mencabut izin
          if (status === 410 || status === 404) {
            console.log(`[WEB PUSH] Pruning dead subscription (${status}):`, sub.endpoint);
            void this.removeSubscription(sub.endpoint);
          } else {
            console.warn('[WEB PUSH] Send notification error:', err.message);
          }
        }
      })
    );

    return { sent, failed };
  }

  /**
   * Mengirim notifikasi percobaan ke satu endpoint spesifik.
   */
  public async sendTestPush(endpoint: string): Promise<boolean> {
    if (!this.vapidKeys) {
      this.initVapid();
    }

    let targetSub = this.memorySubscriptions.get(endpoint);
    if (!targetSub) {
      try {
        const dbSub = await prisma.pushSubscription.findUnique({ where: { endpoint } });
        if (dbSub) targetSub = dbSub;
      } catch {}
    }

    if (!targetSub) return false;

    const pushSubscription = {
      endpoint: targetSub.endpoint,
      keys: {
        p256dh: targetSub.p256dh,
        auth: targetSub.auth,
      },
    };

    const payload = JSON.stringify({
      title: 'Bunda Sarah',
      body: 'Halo kak, apakah besok ada jadwal kosong untuk perawatan spa bayi?',
      icon: 'https://ui-avatars.com/api/?name=Bunda+Sarah&background=008069&color=fff&size=192&bold=true',
      badge: '/admin/favicon.ico',
      url: '/admin/#/live-chat',
      tag: 'test-push',
    });

    try {
      await webpush.sendNotification(pushSubscription, payload, { TTL: 60, urgency: 'high' });
      return true;
    } catch (err: any) {
      console.warn('[WEB PUSH] Test notification error:', err.message);
      return false;
    }
  }
}

export const webPushService = WebPushService.getInstance();
