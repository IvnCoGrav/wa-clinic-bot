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
        const tenantId = (request as any).staffTenantId || (request as any).staffSession?.staff?.tenant_id || (request as any).tenantId || DEFAULT_TENANT_ID;
        const resolvedUserId = userId || (request as any).staffId || undefined;
        const resolvedUserType = userType || ((request as any).staffId ? 'STAFF' : 'ADMIN');

        const saved = await webPushService.saveSubscription({
          tenantId,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          userType: resolvedUserType,
          userId: resolvedUserId,
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

  /**
   * POST /api/admin/push/test-staff
   * Mengirim notifikasi uji coba ke perangkat staff / bidan tertentu.
   */
  fastify.post(
    '/api/admin/push/test-staff',
    async (
      request: FastifyRequest<{
        Body: {
          staffId: string;
          tenantId?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { staffId } = request.body || {};
        if (!staffId) {
          return reply.status(400).send({ success: false, error: 'staffId wajib disertakan' });
        }

        const tenantId =
          request.body?.tenantId ||
          (request as any).tenantId ||
          DEFAULT_TENANT_ID;

        // Validasi dan ambil nama staf
        let staffName = 'Staff';
        try {
          const { prisma } = await import('../../db/client');
          const staff = await prisma.staff.findUnique({
            where: { id: staffId },
            select: { id: true, name: true, active: true },
          });
          if (staff?.name) staffName = staff.name;
        } catch {}

        const result = await webPushService.sendPushToStaff(staffId, tenantId, {
          title: '🔔 Uji Coba Notifikasi Staf',
          body: `Halo ${staffName}, perangkat Anda terhubung dan siap menerima notifikasi tugas!`,
          url: '/admin/staff/today',
          tag: `test-staff-${staffId}`,
        });

        if (result.sent === 0) {
          return reply.status(200).send({
            success: false,
            reason: 'NO_DEVICES',
            staffName,
            sent: 0,
            failed: result.failed,
            message: `Belum ada perangkat terdaftar untuk ${staffName}. Minta staf membuka portal jadwal di HP lalu klik tombol 'Aktifkan Notifikasi'.`,
          });
        }

        return reply.status(200).send({
          success: true,
          staffName,
          sent: result.sent,
          failed: result.failed,
          message: `Notifikasi uji coba berhasil dikirim ke ${result.sent} perangkat ${staffName}.`,
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/push/staff-device-counts
   * Mengambil pemetaan jumlah perangkat aktif per staffId.
   */
  fastify.get('/api/admin/push/staff-device-counts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const counts = await webPushService.getStaffDeviceCounts(tenantId);
      return reply.status(200).send({ success: true, counts });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });
}
