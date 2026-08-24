import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { followUpService } from '../../services/follow-up.service';
import { auditService } from '../../services/audit.service';

export async function followUpAdminRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/follow-ups
   * Mengambil daftar antrian follow-up dengan pagination, filter status, filter type, dan pencarian customer.
   */
  fastify.get(
    '/api/admin/follow-ups',
    async (
      request: FastifyRequest<{
        Querystring: {
          status?: string;
          type?: string;
          search?: string;
          page?: string;
          pageSize?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { status, type, search, page, pageSize } = request.query || {};
        const result = await followUpService.listFollowUps(DEFAULT_TENANT_ID, {
          status,
          type,
          search,
          page: page ? parseInt(page, 10) : 1,
          pageSize: pageSize ? parseInt(pageSize, 10) : 20,
        });

        return reply.status(200).send({
          success: true,
          data: result.data,
          pagination: result.pagination,
        });
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({ error: 'Gagal memuat daftar follow-up', details: err.message });
      }
    }
  );

  /**
   * POST /api/admin/follow-ups/:id/queue
   * Menjadwalkan follow-up tunggal ke antrian (status QUEUED) agar dikirim saat jadwal tiba.
   */
  fastify.post(
    '/api/admin/follow-ups/:id/queue',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      try {
        const success = await followUpService.queueFollowUp(id, DEFAULT_TENANT_ID);
        if (!success) {
          return reply.status(404).send({ error: 'Item follow-up tidak ditemukan atau status bukan PENDING' });
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed || 'SYSTEM',
          adminIdentity: (request as any).adminIdentity || 'Admin',
          action: 'QUEUE_FOLLOWUP',
          targetId: id,
          payload: { status: 'QUEUED' },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: 'Follow-up berhasil dijadwalkan dan masuk ke antrian.',
        });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message || 'Gagal menjadwalkan follow-up.' });
      }
    }
  );

  /**
   * POST /api/admin/follow-ups/bulk-queue
   * Menjadwalkan seluruh follow-up PENDING ke antrian (status QUEUED).
   */
  fastify.post(
    '/api/admin/follow-ups/bulk-queue',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const queuedCount = await followUpService.bulkQueueFollowUps(DEFAULT_TENANT_ID);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed || 'SYSTEM',
          adminIdentity: (request as any).adminIdentity || 'Admin',
          action: 'BULK_QUEUE_FOLLOWUP',
          targetId: 'ALL',
          payload: { count: queuedCount, status: 'QUEUED' },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: `Berhasil menjadwalkan ${queuedCount} antrian follow-up ke status QUEUED.`,
          count: queuedCount,
        });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message || 'Gagal menjadwalkan seluruh antrian.' });
      }
    }
  );

  /**
   * POST /api/admin/follow-ups/:id/send-now
   * Manual Send (Approve & Kirim Sekarang) oleh Admin.
   */
  fastify.post(
    '/api/admin/follow-ups/:id/send-now',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      try {
        const success = await followUpService.sendNow(id, DEFAULT_TENANT_ID);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed || 'SYSTEM',
          adminIdentity: (request as any).adminIdentity || 'Admin',
          action: 'MANUAL_SEND_FOLLOWUP',
          targetId: id,
          payload: { success },
          ipAddress: request.ip,
        });

        if (success) {
          return reply.status(200).send({ success: true, message: 'Follow-up berhasil dikirim ke customer.' });
        } else {
          return reply.status(500).send({ error: 'Gagal mengirim pesan follow-up. Periksa koneksi WhatsApp.' });
        }
      } catch (err: any) {
        return reply.status(400).send({ error: err.message || 'Gagal memproses pengiriman follow-up.' });
      }
    }
  );

  /**
   * PATCH /api/admin/follow-ups/:id/cancel
   * Membatalkan item follow-up tertentu.
   */
  fastify.patch(
    '/api/admin/follow-ups/:id/cancel',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      try {
        const success = await followUpService.cancelFollowUp(id, DEFAULT_TENANT_ID);
        if (!success) {
          return reply.status(404).send({ error: 'Item follow-up tidak ditemukan' });
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed || 'SYSTEM',
          adminIdentity: (request as any).adminIdentity || 'Admin',
          action: 'CANCEL_FOLLOWUP',
          targetId: id,
          payload: { status: 'CANCELLED' },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, message: 'Follow-up berhasil dibatalkan.' });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * POST /api/admin/follow-ups/bulk-cancel
   * Membatalkan seluruh antrian follow-up (default: status PENDING).
   */
  fastify.post(
    '/api/admin/follow-ups/bulk-cancel',
    async (request: FastifyRequest<{ Body?: { status?: string } }>, reply: FastifyReply) => {
      try {
        const targetStatus = request.body?.status || 'PENDING';
        const cancelledCount = await followUpService.bulkCancelFollowUps(DEFAULT_TENANT_ID, targetStatus);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed || 'SYSTEM',
          adminIdentity: (request as any).adminIdentity || 'Admin',
          action: 'BULK_CANCEL_FOLLOWUP',
          targetId: 'ALL',
          payload: { count: cancelledCount, targetStatus },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: `Berhasil membatalkan ${cancelledCount} antrian follow-up (${targetStatus}).`,
          count: cancelledCount,
        });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * PATCH /api/admin/follow-ups/:id/reschedule
   * Mengubah jadwal kirim follow-up item.
   */
  fastify.patch(
    '/api/admin/follow-ups/:id/reschedule',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { scheduledAt: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { scheduledAt } = request.body || {};
      if (!scheduledAt) return reply.status(400).send({ error: 'scheduledAt is required' });

      try {
        const updated = await followUpService.rescheduleFollowUp(id, new Date(scheduledAt), DEFAULT_TENANT_ID);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed || 'SYSTEM',
          adminIdentity: (request as any).adminIdentity || 'Admin',
          action: 'RESCHEDULE_FOLLOWUP',
          targetId: id,
          payload: { scheduledAt },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, data: updated });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/follow-up-templates
   */
  fastify.get('/api/admin/follow-up-templates', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const templates = await followUpService.getAllTemplates(DEFAULT_TENANT_ID);
      return reply.status(200).send({ success: true, data: templates });
    } catch (err: any) {
      return reply.status(500).send({ error: 'Failed to load follow-up templates' });
    }
  });

  /**
   * POST & PUT /api/admin/follow-up-templates
   */
  const handleSaveTemplate = async (
    request: FastifyRequest<{ Body: { type: string; variant: number; text: string } }>,
    reply: FastifyReply
  ) => {
    const { type, variant, text } = request.body || {};
    if (!type || !variant || !text) {
      return reply.status(400).send({ error: 'type, variant, and text are required' });
    }
    try {
      await followUpService.saveTemplate(type, variant, text, DEFAULT_TENANT_ID);

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed || 'SYSTEM',
        adminIdentity: (request as any).adminIdentity || 'Admin',
        action: 'UPDATE_FOLLOWUP_TEMPLATE',
        targetId: `${type}_${variant}`,
        payload: { text },
        ipAddress: request.ip,
      });

      return reply.status(200).send({ success: true, message: 'Template saved successfully' });
    } catch (err: any) {
      return reply.status(500).send({ error: 'Failed to save template' });
    }
  };

  fastify.post('/api/admin/follow-up-templates', handleSaveTemplate);
  fastify.put('/api/admin/follow-up-templates', handleSaveTemplate);

  /**
   * DELETE /api/admin/follow-up-templates/:type/:variant
   */
  fastify.delete(
    '/api/admin/follow-up-templates/:type/:variant',
    async (
      request: FastifyRequest<{ Params: { type: string; variant: string } }>,
      reply: FastifyReply
    ) => {
      const { type, variant } = request.params;
      try {
        await followUpService.resetTemplate(type, parseInt(variant, 10), DEFAULT_TENANT_ID);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed || 'SYSTEM',
          adminIdentity: (request as any).adminIdentity || 'Admin',
          action: 'RESET_FOLLOWUP_TEMPLATE',
          targetId: `${type}_${variant}`,
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, message: 'Template reset to default' });
      } catch (err: any) {
        return reply.status(500).send({ error: 'Failed to reset template' });
      }
    }
  );
}
