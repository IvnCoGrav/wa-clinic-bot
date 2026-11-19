import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { auditService } from '../../services/audit.service';
import { knowledgeBaseService } from '../../services/knowledge.service';
import { migrationService } from '../../services/migration.service';
import {
  bulkApproveStagingPurchases,
  clearPendingFaqStaging,
  countTenantConversations,
  deleteAllFaqStaging,
  listFaqStaging,
  listLegacyStaging,
  listLegacyStagingByStatus,
  reviewGeneralFaqStaging,
  reviewMedicalFaqStaging,
  updateLegacyStagingStatus,
} from '../../services/migration-staging.service';
import { resolveSessionTenantId } from './route-helpers';

export async function migrationAdminRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/admin/migration/extract
   * Ekstraksi instan dari database lokal PostgreSQL (tanpa akses ke WAHA)
   */
  fastify.post(
    '/api/admin/migration/extract',
    async (request: FastifyRequest<{ Body: { limit?: number } }>, reply: FastifyReply) => {
      const { wahaHistorySyncService } = await import('../../services/waha-history-sync.service');
      const syncStatus = wahaHistorySyncService.getBackgroundSyncStatus(resolveSessionTenantId(request));

      if (syncStatus.isSyncing) {
        return reply.status(409).send({
          success: false,
          isSyncing: true,
          error: 'Sinkronisasi riwayat WhatsApp sedang berjalan di latar belakang. Harap tunggu hingga selesai.',
        });
      }

      const result = await migrationService.extractFromLocalDatabase(resolveSessionTenantId(request));

      if (result.emptyDatabase) {
        return reply.status(200).send({
          success: false,
          emptyDatabase: true,
          count: 0,
          message:
            'Database percakapan lokal masih kosong. Silakan jalankan "Sync Riwayat WhatsApp" di menu Live Chat Monitor terlebih dahulu.',
          data: result,
        });
      }

      await auditService.logAdminAction({
        tenantId: resolveSessionTenantId(request),
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'MIGRATION_EXTRACT_CHATS',
        payload: { extractedCount: result.extractedCount, totalScanned: result.totalScanned },
        ipAddress: request.ip,
      });

      return reply.status(200).send({
        success: result.success,
        count: result.extractedCount,
        message: `Berhasil mengekstrak ${result.extractedCount} kontak dari ${result.totalScanned} percakapan database lokal ke antrean staging.`,
        data: result,
      });
    }
  );

  /**
   * GET /api/admin/migration/staging
   */
  fastify.get(
    '/api/admin/migration/staging',
    async (
      request: FastifyRequest<{
        Querystring: {
          status?: string;
          page?: string;
          limit?: string;
          hasReservation?: string;
          sortBy?: string;
          sortOrder?: 'asc' | 'desc';
          search?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const {
        status = 'PENDING',
        page = '1',
        limit = '20',
        hasReservation,
        sortBy = 'leadCreatedAt',
        sortOrder = 'desc',
        search,
      } = request.query || {};
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));
      const orderDir: 'asc' | 'desc' = sortOrder === 'asc' ? 'asc' : 'desc';

      try {
        const { wahaHistorySyncService } = await import('../../services/waha-history-sync.service');
        const syncStatus = wahaHistorySyncService.getBackgroundSyncStatus(resolveSessionTenantId(request));

        const staging = await listLegacyStaging({
          tenantId: resolveSessionTenantId(request),
          status,
          page: pageNum,
          limit: limitNum,
          hasReservation,
          sortBy,
          sortOrder: orderDir,
          search,
        });
        const enrichedItems = staging.items;
        const total = staging.total;
        const pendingCount = staging.statusCounts.PENDING;
        const approvedCount = staging.statusCounts.APPROVED;
        const committedCount = staging.statusCounts.COMMITTED;
        const rejectedCount = staging.statusCounts.REJECTED;
        const pendingWithResCount = staging.statusCounts.PENDING_WITH_RESERVATION;
        const localConversationCount = staging.localStats.conversationCount;
        const localMessageCount = staging.localStats.messageCount;

        return reply.status(200).send({
          success: true,
          data: enrichedItems,
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.max(1, Math.ceil(total / limitNum)),
          statusCounts: {
            PENDING: pendingCount,
            APPROVED: approvedCount,
            COMMITTED: committedCount,
            REJECTED: rejectedCount,
            PENDING_WITH_RESERVATION: pendingWithResCount,
          },
          syncStatus,
          localStats: {
            conversationCount: localConversationCount,
            messageCount: localMessageCount,
          },
        });
      } catch (err: any) {
        return reply.status(200).send({
          success: true,
          data: [],
          total: 0,
          page: 1,
          limit: limitNum,
          totalPages: 1,
          syncStatus: { isSyncing: false, status: 'idle' },
          localStats: { conversationCount: 0, messageCount: 0 },
        });
      }
    }
  );

  /**
   * POST /api/admin/migration/staging/bulk-approve-purchases
   * Setujui seluruh data PENDING yang memiliki form reservasi (Paid) secara instan.
   */
  fastify.post('/api/admin/migration/staging/bulk-approve-purchases', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const approvedCount = await bulkApproveStagingPurchases(resolveSessionTenantId(request));

      await auditService.logAdminAction({
        tenantId: resolveSessionTenantId(request),
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'MIGRATION_BULK_APPROVE_PURCHASES',
        payload: { count: approvedCount },
        ipAddress: request.ip,
      });

      return reply.status(200).send({
        success: true,
        count: approvedCount,
        message: `Berhasil menyetujui ${approvedCount} kontak yang memiliki form reservasi pembelian.`,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * PATCH /api/admin/migration/staging/:id
   */
  fastify.patch(
    '/api/admin/migration/staging/:id',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { status: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { status } = request.body || {};

      if (!['PENDING', 'APPROVED', 'REJECTED', 'COMMITTED'].includes(status)) {
        return reply.status(400).send({ error: 'Status tidak valid.' });
      }

      const updated = await migrationService.updateStagingStatus(id, status as any);

      await auditService.logAdminAction({
        tenantId: resolveSessionTenantId(request),
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'MIGRATION_UPDATE_STAGING_STATUS',
        targetId: id,
        payload: { status },
        ipAddress: request.ip,
      });

      return reply.status(200).send({ success: updated });
    }
  );

  /**
   * POST /api/admin/migration/commit
   */
  fastify.post('/api/admin/migration/commit', async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await migrationService.commitApprovedRecords();

    await auditService.logAdminAction({
      tenantId: resolveSessionTenantId(request),
      apiKey: (request as any).adminKeyUsed,
      adminIdentity: (request as any).adminIdentity,
      action: 'MIGRATION_COMMIT_APPROVED',
      payload: result,
      ipAddress: request.ip,
    });

    return reply.status(200).send({
      success: result.success,
      message: `Berhasil melakukan commit ${result.committedCount} record ke tabel Customer & Reservation aktif.`,
      data: result,
    });
  });

  /**
   * GET /api/admin/legacy-staging
   */
  fastify.get('/api/admin/legacy-staging', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const queryStatus = (request.query as any).status || 'PENDING';
      const items = await listLegacyStagingByStatus(resolveSessionTenantId(request), queryStatus);
      return reply.status(200).send({ success: true, count: items.length, data: items });
    } catch (err) {
      return reply.status(200).send({ success: true, count: 0, data: [] });
    }
  });

  /**
   * PATCH /api/admin/legacy-staging/:id
   */
  fastify.patch(
    '/api/admin/legacy-staging/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { status: 'APPROVED' | 'REJECTED' | 'COMMITTED' };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { status } = request.body || {};

      try {
        const item = await updateLegacyStagingStatus(id, status);

        return reply
          .status(200)
          .send({ success: true, message: `Status legacy staging berhasil diperbarui menjadi ${status}.`, data: item });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * PATCH /api/admin/legacy-staging/:id/commit
   */
  fastify.patch(
    '/api/admin/legacy-staging/:id/commit',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body?: { status?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const status = request.body?.status || 'COMMITTED';

      try {
        const item = await updateLegacyStagingStatus(id, status);

        return reply
          .status(200)
          .send({ success: true, message: `Status legacy staging berhasil diperbarui menjadi ${status}.`, data: item });
      } catch (err: any) {
        return reply.status(200).send({ success: true, message: `Legacy staging commit fallback (${status}).` });
      }
    }
  );

  /**
   * GET /api/admin/medical-faq-staging
   * Paginated + batch chunk lookup (P3 audit): hindari N+1 findUnique per row.
   */
  fastify.get('/api/admin/medical-faq-staging', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { status = 'PENDING', page = '1', limit = '50' } = (request.query as any) || {};
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

      const { items: itemsWithChunks, total } = await listFaqStaging('medical', {
        tenantId: resolveSessionTenantId(request),
        status,
        page: pageNum,
        limit: limitNum,
      });

      return reply.status(200).send({
        success: true,
        data: itemsWithChunks,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.max(1, Math.ceil(total / limitNum)),
      });
    } catch (err) {
      // Ar-005: jangan 200 + data kosong saat DB gagal di produksi.
      if (process.env.NODE_ENV === 'production') {
        return reply.status(503).send({
          success: false,
          code: 'DATABASE_UNAVAILABLE',
          error: 'Daftar staging FAQ tidak dapat dimuat.',
        });
      }
      return reply
        .status(200)
        .send({ success: true, degraded: true, data: [], total: 0, page: 1, limit: 50, totalPages: 1 });
    }
  });

  /**
   * PATCH /api/admin/medical-faq-staging/:id/review
   */
  fastify.patch(
    '/api/admin/medical-faq-staging/:id/review',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: {
          status: 'APPROVED' | 'REJECTED' | 'NEEDS_REVISION';
          generalQuestion?: string;
          generalAnswer?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { status, generalQuestion, generalAnswer } = request.body || {};
      const reviewer = (request as any).adminIdentity || 'Bidan Admin';

      try {
        const updated = await reviewMedicalFaqStaging(id, {
          status: status as any,
          general_question: generalQuestion || undefined,
          general_answer: generalAnswer || undefined,
          reviewed_by: reviewer,
          reviewed_at: new Date(),
        });

        if (status === 'APPROVED' && generalQuestion && generalAnswer) {
          await knowledgeBaseService.addFaqItem({
            tenantId: resolveSessionTenantId(request),
            category: 'medical',
            question: generalQuestion,
            answer: generalAnswer,
            status: 'APPROVED',
          });
        }

        return reply
          .status(200)
          .send({ success: true, message: `Status staging FAQ medis berhasil diperbarui menjadi ${status}.`, data: updated });
      } catch (err: any) {
        return reply.status(200).send({ success: true, message: `Review staging berhasil disimpan (${status}).` });
      }
    }
  );

  /**
   * GET /api/admin/general-faq-staging
   * Paginated + batch chunk lookup (P3 audit): hindari N+1 findUnique per row.
   */
  fastify.get('/api/admin/general-faq-staging', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { status = 'PENDING', page = '1', limit = '50' } = (request.query as any) || {};
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

      const { items: itemsWithChunks, total } = await listFaqStaging('general', {
        tenantId: resolveSessionTenantId(request),
        status,
        page: pageNum,
        limit: limitNum,
      });

      return reply.status(200).send({
        success: true,
        data: itemsWithChunks,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.max(1, Math.ceil(total / limitNum)),
      });
    } catch (err) {
      // Ar-005: jangan 200 + data kosong saat DB gagal di produksi.
      if (process.env.NODE_ENV === 'production') {
        return reply.status(503).send({
          success: false,
          code: 'DATABASE_UNAVAILABLE',
          error: 'Daftar staging FAQ umum tidak dapat dimuat.',
        });
      }
      return reply
        .status(200)
        .send({ success: true, degraded: true, data: [], total: 0, page: 1, limit: 50, totalPages: 1 });
    }
  });

  /**
   * PATCH /api/admin/general-faq-staging/:id/review
   */
  fastify.patch(
    '/api/admin/general-faq-staging/:id/review',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: {
          status: 'APPROVED' | 'REJECTED' | 'NEEDS_REVISION';
          generalQuestion?: string;
          generalAnswer?: string;
          category?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { status, generalQuestion, generalAnswer, category } = request.body || {};
      const reviewer = (request as any).adminIdentity || 'Admin Umum';

      try {
        const updated = await reviewGeneralFaqStaging(id, {
          status: status as any,
          general_question: generalQuestion || undefined,
          general_answer: generalAnswer || undefined,
          category: category || undefined,
          reviewed_by: reviewer,
          reviewed_at: new Date(),
        });

        if (status === 'APPROVED' && generalQuestion && generalAnswer) {
          await knowledgeBaseService.addFaqItem({
            tenantId: resolveSessionTenantId(request),
            category: category || 'general',
            question: generalQuestion,
            answer: generalAnswer,
            status: 'APPROVED',
          });
        }

        return reply
          .status(200)
          .send({ success: true, message: `Status FAQ umum berhasil diperbarui menjadi ${status}.`, data: updated });
      } catch (err) {
        return reply.status(200).send({ success: true, message: `Review FAQ umum berhasil disimpan (${status}).` });
      }
    }
  );

  /**
   * POST /api/admin/harvest/legacy-chat
   * Menjalankan AI Harvesting dari database lokal PostgreSQL
   */
  fastify.post(
    '/api/admin/harvest/legacy-chat',
    async (
      request: FastifyRequest<{
        Body: { maxChats?: number; maxMessagesPerChat?: number; clearPreviousPending?: boolean };
      }>,
      reply: FastifyReply
    ) => {
      const body = request.body || {};
      const { maxChats, maxMessagesPerChat, clearPreviousPending } = body;
      const { wahaHistorySyncService } = await import('../../services/waha-history-sync.service');
      const syncStatus = wahaHistorySyncService.getBackgroundSyncStatus(resolveSessionTenantId(request));

      if (syncStatus.isSyncing) {
        return reply.status(409).send({
          success: false,
          isSyncing: true,
          error: 'Sinkronisasi riwayat WhatsApp sedang berjalan di latar belakang. Harap tunggu hingga selesai.',
        });
      }

      let localConversationCount = 1;
      try {
        localConversationCount = await countTenantConversations(resolveSessionTenantId(request));
        if (localConversationCount === 0) {
          return reply.status(200).send({
            success: false,
            emptyDatabase: true,
            message:
              'Database percakapan lokal masih kosong. Silakan jalankan "Sync Riwayat WhatsApp" di menu Live Chat Monitor terlebih dahulu.',
          });
        }
      } catch (_) {}

      const { LegacyHarvestingService } = await import('../../services/legacy-harvesting.service');

      if (clearPreviousPending) {
        try {
          await clearPendingFaqStaging(resolveSessionTenantId(request));
        } catch (e: any) {}
      }

      LegacyHarvestingService.runHarvestingJob(resolveSessionTenantId(request), { maxChats, maxMessagesPerChat }).catch((err) =>
        console.error('[HARVEST JOB ERROR]', err)
      );

      return reply.status(200).send({
        success: true,
        message: 'Proses AI Harvesting histori chat lokal berhasil dimulai di background.',
        jobId: `job_${Date.now()}`,
        status: 'STARTED',
      });
    }
  );

  /**
   * POST /api/admin/harvest/reset-staging
   */
  fastify.post('/api/admin/harvest/reset-staging', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { medicalCleared, generalCleared } = await clearPendingFaqStaging(resolveSessionTenantId(request));

      return reply.status(200).send({
        success: true,
        message: `Berhasil membersihkan ${medicalCleared} kandidat medis dan ${generalCleared} kandidat umum staging PENDING yang lama.`,
        data: { medicalCleared, generalCleared },
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * DELETE /api/admin/harvest/staging/all
   */
  fastify.delete('/api/admin/harvest/staging/all', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { medicalDeleted, generalDeleted } = await deleteAllFaqStaging(resolveSessionTenantId(request));

      return reply.status(200).send({
        success: true,
        message: `Berhasil menghapus seluruh data staging: ${medicalDeleted} kandidat medis dan ${generalDeleted} kandidat umum.`,
        data: { medicalDeleted, generalDeleted },
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * GET /api/admin/harvest/status
   */
  fastify.get('/api/admin/harvest/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const { LegacyHarvestingService } = await import('../../services/legacy-harvesting.service');
    const { wahaHistorySyncService } = await import('../../services/waha-history-sync.service');

    const stats = LegacyHarvestingService.getJobStatus();
    const syncStatus = wahaHistorySyncService.getBackgroundSyncStatus(resolveSessionTenantId(request));

    let localConversationCount = 0;
    try {
      localConversationCount = await countTenantConversations(resolveSessionTenantId(request));
    } catch (_) {}

    return reply.status(200).send({
      success: true,
      data: stats,
      syncStatus,
      localStats: { conversationCount: localConversationCount },
    });
  });
}
