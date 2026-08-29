import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { webPushService } from '../../services/web-push.service';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

export async function pushSubroutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/push/public-key
   * Mendapatkan VAPID Public Key untuk pendaftaran PushManager di browser PWA.
   */
  fastify.get('/api/admin/push/public-key', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const publicKey = webPushService.getPublicKey();
      return reply.status(200).send({ success: true, publicKey });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/admin/push/subscribe
   * Mendaftarkan PushSubscription dari browser ke database.
   */
  fastify.post(
    '/api/admin/push/subscribe',
    async (
      request: FastifyRequest<{
        Body: {
          subscription: {
            endpoint: string;
            keys: {
              p256dh: string;
              auth: string;
            };
          };
          userType?: string;
          userId?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { subscription, userType, userId } = request.body || {};
        if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
          return reply.status(400).send({ success: false, error: 'Format PushSubscription tidak valid' });
        }

        const userAgent = request.headers['user-agent'] || undefined;
        const saved = await webPushService.saveSubscription({
          tenantId: DEFAULT_TENANT_ID,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          userType: userType || 'ADMIN',
          userId: userId || undefined,
          userAgent,
        });

        return reply.status(200).send({ success: true, data: saved });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * POST /api/admin/push/unsubscribe
   * Menghapus langganan PushSubscription.
   */
  fastify.post(
    '/api/admin/push/unsubscribe',
    async (
      request: FastifyRequest<{
        Body: {
          endpoint: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { endpoint } = request.body || {};
        if (!endpoint) {
          return reply.status(400).send({ success: false, error: 'Endpoint diperlukan' });
        }

        const removed = await webPushService.removeSubscription(endpoint);
        return reply.status(200).send({ success: true, removed });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * POST /api/admin/push/test
   * Mengirim notifikasi uji coba ke endpoint perangkat yang sedang aktif.
   */
  fastify.post(
    '/api/admin/push/test',
    async (
      request: FastifyRequest<{
        Body: {
          endpoint?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { endpoint } = request.body || {};
        if (endpoint) {
          const sent = await webPushService.sendTestPush(endpoint);
          return reply.status(200).send({ success: sent });
        }

        // Jika endpoint tidak dikirim, broadcast ke seluruh tenant default
        const result = await webPushService.sendPushToTenant(DEFAULT_TENANT_ID, {
          title: '🔔 Uji Coba Web Push',
          body: 'Notifikasi berhasil terkirim dari server Kala Clinic!',
          url: '/admin/live-chat',
          tag: 'test-push',
        });
        return reply.status(200).send({ success: true, ...result });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );
}
