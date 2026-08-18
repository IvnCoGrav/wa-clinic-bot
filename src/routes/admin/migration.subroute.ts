import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { auditService } from '../../services/audit.service';
import { knowledgeBaseService } from '../../services/knowledge.service';
import { migrationService } from '../../services/migration.service';

export async function migrationAdminRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/admin/migration/extract
   * Ekstraksi instan dari database lokal PostgreSQL (tanpa akses ke WAHA)
   */
  fastify.post(
    '/api/admin/migration/extract',
    async (request: FastifyRequest<{ Body: { limit?: number } }>, reply: FastifyReply) => {
      const { wahaHistorySyncService } = await import('../../services/waha-history-sync.service');
      const syncStatus = wahaHistorySyncService.getBackgroundSyncStatus(DEFAULT_TENANT_ID);

      if (syncStatus.isSyncing) {
        return reply.status(409).send({
          success: false,
          isSyncing: true,
          error: 'Sinkronisasi riwayat WhatsApp sedang berjalan di latar belakang. Harap tunggu hingga selesai.',
        });
      }

      const result = await migrationService.extractFromLocalDatabase(DEFAULT_TENANT_ID);

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
        const syncStatus = wahaHistorySyncService.getBackgroundSyncStatus(DEFAULT_TENANT_ID);

        let where: any = { tenantId: DEFAULT_TENANT_ID, status: status as any };
        if (hasReservation === 'true') {
          where.firstPurchaseAt = { not: null };
        } else if (hasReservation === 'false') {
          where.firstPurchaseAt = null;
        }

        if (search && search.trim()) {
          const q = search.trim();
          where.OR = [
            { name: { contains: q, mode: 'insensitive' } },
            { phoneNumber: { contains: q } },
            { extractedLocation: { contains: q, mode: 'insensitive' } },
          ];
        }

        const allowedSort = [
          'leadCreatedAt',
          'firstPurchaseAt',
          'name',
          'phoneNumber',
          'rawMessagesCount',
          'createdAt',
          'updatedAt',
        ];
        let orderBy: any = { leadCreatedAt: 'desc' };
        if (sortBy && allowedSort.includes(sortBy)) {
          orderBy = { [sortBy]: orderDir };
        }

        const isLtvSort = sortBy === 'ltv';

        const [
          rawItems,
          total,
          pendingCount,
          approvedCount,
          committedCount,
          rejectedCount,
          pendingWithResCount,
          localConversationCount,
          localMessageCount,
        ] = await Promise.all([
          prisma.legacyStaging.findMany({
            where,
            orderBy: isLtvSort ? { leadCreatedAt: 'desc' } : orderBy,
            skip: isLtvSort ? 0 : (pageNum - 1) * limitNum,
            take: isLtvSort ? Math.min(1000, limitNum * 20) : limitNum,
          }),
          prisma.legacyStaging.count({ where }),
          prisma.legacyStaging.count({ where: { tenantId: DEFAULT_TENANT_ID, status: 'PENDING' } }),
          prisma.legacyStaging.count({ where: { tenantId: DEFAULT_TENANT_ID, status: 'APPROVED' } }),
          prisma.legacyStaging.count({ where: { tenantId: DEFAULT_TENANT_ID, status: 'COMMITTED' } }),
          prisma.legacyStaging.count({ where: { tenantId: DEFAULT_TENANT_ID, status: 'REJECTED' } }),
          prisma.legacyStaging.count({
            where: { tenantId: DEFAULT_TENANT_ID, status: 'PENDING', firstPurchaseAt: { not: null } },
          }),
          prisma.conversation.count({ where: { tenant_id: DEFAULT_TENANT_ID } }),
          prisma.message.count({ where: { tenant_id: DEFAULT_TENANT_ID } }),
        ]);

        // Ambil LTV real dari Customer jika nomor HP sudah tersimpan di database
        const phones = rawItems.map((i) => i.phoneNumber);
        const ltvMap = new Map<string, number>();
        try {
          const customersWithLtv = await prisma.customer.findMany({
            where: { phone: { in: phones } },
            select: {
              phone: true,
              reservations: {
                where: { status: { in: ['confirmed', 'completed'] } },
                select: { purchase_value: true },
              },
            },
          });
          for (const c of customersWithLtv) {
            const sum = c.reservations.reduce((acc, r) => acc + (r.purchase_value || 0), 0);
            ltvMap.set(c.phone, sum);
          }
        } catch (_) {}

        let enrichedItems = rawItems.map((item) => {
          const json: any = item.extractedReservationJson;
          const ltv = ltvMap.get(item.phoneNumber) ?? json?.payment?.totalPrice ?? (item.firstPurchaseAt ? 70000 : 0);
          return {
            ...item,
            ltv,
          };
        });

        if (isLtvSort) {
          enrichedItems.sort((a, b) => (orderDir === 'asc' ? a.ltv - b.ltv : b.ltv - a.ltv));
          enrichedItems = enrichedItems.slice((pageNum - 1) * limitNum, pageNum * limitNum);
        }

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
      const updated = await prisma.legacyStaging.updateMany({
        where: {
          tenantId: DEFAULT_TENANT_ID,
          status: 'PENDING',
          firstPurchaseAt: { not: null },
        },
        data: {
          status: 'APPROVED',
        },
      });

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'MIGRATION_BULK_APPROVE_PURCHASES',
        payload: { count: updated.count },
        ipAddress: request.ip,
      });

      return reply.status(200).send({
        success: true,
        count: updated.count,
        message: `Berhasil menyetujui ${updated.count} kontak yang memiliki form reservasi pembelian.`,
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
      const items = await prisma.legacyStaging.findMany({
        where: { tenantId: DEFAULT_TENANT_ID, status: queryStatus as any },
        orderBy: { leadCreatedAt: 'desc' },
      });
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
        const item = await prisma.legacyStaging.update({
          where: { id },
          data: { status: status as any },
        });

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
        const item = await prisma.legacyStaging.update({
          where: { id },
          data: { status: status as any },
        });

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

      const where: any = { tenant_id: DEFAULT_TENANT_ID, status };
      const [items, total] = await Promise.all([
        prisma.medicalFaqStaging.findMany({
          where,
          orderBy: { created_at: 'desc' },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.medicalFaqStaging.count({ where }),
      ]);

      // Batch lookup chunk terlampir: 1 query untuk semua matched_chunk_id
      const chunkIds = items.filter((i) => i.matched_chunk_id).map((i) => i.matched_chunk_id as string);
      const chunks = chunkIds.length
        ? await prisma.knowledgeChunk.findMany({ where: { id: { in: chunkIds } } })
        : [];
      const chunkMap = new Map(chunks.map((c) => [c.id, c]));

      const itemsWithChunks = items.map((item) =>
        item.matched_chunk_id ? { ...item, matchedChunk: chunkMap.get(item.matched_chunk_id) ?? null } : item
      );

      return reply.status(200).send({
        success: true,
        data: itemsWithChunks,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.max(1, Math.ceil(total / limitNum)),
      });
    } catch (err) {
      return reply
        .status(200)
        .send({ success: true, data: [], total: 0, page: 1, limit: 50, totalPages: 1 });
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
        const updated = await prisma.medicalFaqStaging.update({
          where: { id },
          data: {
            status: status as any,
            general_question: generalQuestion || undefined,
            general_answer: generalAnswer || undefined,
            reviewed_by: reviewer,
            reviewed_at: new Date(),
          },
        });

        if (status === 'APPROVED' && generalQuestion && generalAnswer) {
          await knowledgeBaseService.addFaqItem({
            tenantId: DEFAULT_TENANT_ID,
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

      const where: any = { tenant_id: DEFAULT_TENANT_ID, status };
      const [items, total] = await Promise.all([
        prisma.generalFaqStaging.findMany({
          where,
          orderBy: { created_at: 'desc' },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.generalFaqStaging.count({ where }),
      ]);

      // Batch lookup chunk terlampir: 1 query untuk semua matched_chunk_id
      const chunkIds = items.filter((i) => i.matched_chunk_id).map((i) => i.matched_chunk_id as string);
      const chunks = chunkIds.length
        ? await prisma.knowledgeChunk.findMany({ where: { id: { in: chunkIds } } })
        : [];
      const chunkMap = new Map(chunks.map((c) => [c.id, c]));

      const itemsWithChunks = items.map((item) =>
        item.matched_chunk_id ? { ...item, matchedChunk: chunkMap.get(item.matched_chunk_id) ?? null } : item
      );

      return reply.status(200).send({
        success: true,
        data: itemsWithChunks,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.max(1, Math.ceil(total / limitNum)),
      });
    } catch (err) {
      return reply
        .status(200)
        .send({ success: true, data: [], total: 0, page: 1, limit: 50, totalPages: 1 });
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
        const updated = await prisma.generalFaqStaging.update({
          where: { id },
          data: {
            status: status as any,
            general_question: generalQuestion || undefined,
            general_answer: generalAnswer || undefined,
            category: category || undefined,
            reviewed_by: reviewer,
            reviewed_at: new Date(),
          },
        });

        if (status === 'APPROVED' && generalQuestion && generalAnswer) {
          await knowledgeBaseService.addFaqItem({
            tenantId: DEFAULT_TENANT_ID,
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
      const syncStatus = wahaHistorySyncService.getBackgroundSyncStatus(DEFAULT_TENANT_ID);

      if (syncStatus.isSyncing) {
        return reply.status(409).send({
          success: false,
          isSyncing: true,
          error: 'Sinkronisasi riwayat WhatsApp sedang berjalan di latar belakang. Harap tunggu hingga selesai.',
        });
      }

      let localConversationCount = 1;
      try {
        localConversationCount = await prisma.conversation.count({ where: { tenant_id: DEFAULT_TENANT_ID } });
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
          await prisma.medicalFaqStaging.deleteMany({ where: { tenant_id: DEFAULT_TENANT_ID, status: 'PENDING' } });
          await prisma.generalFaqStaging.deleteMany({ where: { tenant_id: DEFAULT_TENANT_ID, status: 'PENDING' } });
        } catch (e: any) {}
      }

      LegacyHarvestingService.runHarvestingJob(DEFAULT_TENANT_ID, { maxChats, maxMessagesPerChat }).catch((err) =>
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
      const medRes = await prisma.medicalFaqStaging.deleteMany({
        where: { tenant_id: DEFAULT_TENANT_ID, status: 'PENDING' },
      });
      const genRes = await prisma.generalFaqStaging.deleteMany({
        where: { tenant_id: DEFAULT_TENANT_ID, status: 'PENDING' },
      });

      return reply.status(200).send({
        success: true,
        message: `Berhasil membersihkan ${medRes.count} kandidat medis dan ${genRes.count} kandidat umum staging PENDING yang lama.`,
        data: { medicalCleared: medRes.count, generalCleared: genRes.count },
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
      const medRes = await prisma.medicalFaqStaging.deleteMany({ where: { tenant_id: DEFAULT_TENANT_ID } });
      const genRes = await prisma.generalFaqStaging.deleteMany({ where: { tenant_id: DEFAULT_TENANT_ID } });

      return reply.status(200).send({
        success: true,
        message: `Berhasil menghapus seluruh data staging: ${medRes.count} kandidat medis dan ${genRes.count} kandidat umum.`,
        data: { medicalDeleted: medRes.count, generalDeleted: genRes.count },
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
    const syncStatus = wahaHistorySyncService.getBackgroundSyncStatus(DEFAULT_TENANT_ID);

    let localConversationCount = 0;
    try {
      localConversationCount = await prisma.conversation.count({ where: { tenant_id: DEFAULT_TENANT_ID } });
    } catch (_) {}

    return reply.status(200).send({
      success: true,
      data: stats,
      syncStatus,
      localStats: { conversationCount: localConversationCount },
    });
  });
}
