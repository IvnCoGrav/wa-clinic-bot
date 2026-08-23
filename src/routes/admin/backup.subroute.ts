import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { backupService } from '../../services/backup.service';
import { auditService } from '../../services/audit.service';
import {
  sanitizeBackupFileName,
  BACKUP_STORAGE_DIR,
} from '../../utils/backup-file';

export async function backupAdminRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/backup/list
   * Mengambil daftar riwayat backup lokal dan Google Drive
   */
  fastify.get(
    '/api/admin/backup/list',
    async (request: FastifyRequest<{ Querystring: { tenantId?: string } }>, reply: FastifyReply) => {
      try {
        const tenantId = request.query.tenantId || DEFAULT_TENANT_ID;
        const backups = await backupService.listAllBackups(tenantId);
        return reply.status(200).send({
          success: true,
          data: { backups },
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err?.message });
      }
    }
  );

  /**
   * POST /api/admin/backup/create
   * Membuat backup database baru dan opsi upload ke Google Drive
   */
  fastify.post(
    '/api/admin/backup/create',
    async (
      request: FastifyRequest<{
        Body: { uploadToDrive?: boolean; tenantId?: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = request.body?.tenantId || DEFAULT_TENANT_ID;
        const uploadToDrive = Boolean(request.body?.uploadToDrive);

        const dump = await backupService.createDatabaseDump(tenantId);
        let driveFile = null;

        if (uploadToDrive) {
          driveFile = await backupService.uploadToGoogleDrive(tenantId, dump.filePath);
        }

        await auditService.logAdminAction({
          apiKey: (request.headers['x-api-key'] as string) || 'admin_session',
          adminIdentity: 'ADMIN',
          action: 'CREATE_DATABASE_BACKUP',
          payload: { fileName: dump.fileName, sizeBytes: dump.sizeBytes, uploadedToDrive: Boolean(driveFile) },
          tenantId,
        });

        return reply.status(200).send({
          success: true,
          message: 'Backup database berhasil dibuat.',
          data: {
            fileName: dump.fileName,
            sizeBytes: dump.sizeBytes,
            driveFile,
          },
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err?.message });
      }
    }
  );

  /**
   * GET /api/admin/backup/download/:fileName
   * Mengunduh file backup .sql.gz ke laptop/komputer admin
   */
  fastify.get(
    '/api/admin/backup/download/:fileName',
    async (
      request: FastifyRequest<{
        Params: { fileName: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const fileName = sanitizeBackupFileName(request.params.fileName);
        const filePath = path.join(BACKUP_STORAGE_DIR, fileName);

        if (!fs.existsSync(filePath)) {
          return reply.status(404).send({
            success: false,
            error: `File backup ${fileName} tidak ditemukan di server.`,
          });
        }

        const stat = fs.statSync(filePath);
        const stream = fs.createReadStream(filePath);

        reply.header('Content-Type', 'application/gzip');
        reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
        reply.header('Content-Length', stat.size);

        return reply.send(stream);
      } catch (err: any) {
        return reply.status(400).send({ success: false, error: err?.message });
      }
    }
  );

  /**
   * POST /api/admin/backup/upload-drive
   * Mengunggah file backup lokal yang ada ke Google Drive
   */
  fastify.post(
    '/api/admin/backup/upload-drive',
    async (
      request: FastifyRequest<{
        Body: { fileName: string; tenantId?: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = request.body?.tenantId || DEFAULT_TENANT_ID;
        const fileName = sanitizeBackupFileName(request.body?.fileName || '');
        const filePath = path.join(BACKUP_STORAGE_DIR, fileName);

        if (!fs.existsSync(filePath)) {
          return reply.status(404).send({
            success: false,
            error: `File backup ${fileName} tidak ditemukan di server.`,
          });
        }

        const driveFile = await backupService.uploadToGoogleDrive(tenantId, filePath);

        return reply.status(200).send({
          success: true,
          message: `File ${fileName} berhasil diunggah ke Google Drive.`,
          data: { driveFile },
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err?.message });
      }
    }
  );

  /**
   * POST /api/admin/backup/restore
   * Restore database dari file backup .sql.gz
   */
  fastify.post(
    '/api/admin/backup/restore',
    async (
      request: FastifyRequest<{
        Body: { fileName: string; tenantId?: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = request.body?.tenantId || DEFAULT_TENANT_ID;
        const fileName = sanitizeBackupFileName(request.body?.fileName || '');
        const filePath = path.join(BACKUP_STORAGE_DIR, fileName);

        if (!fs.existsSync(filePath)) {
          return reply.status(404).send({
            success: false,
            error: `File backup ${fileName} tidak ditemukan di server.`,
          });
        }

        const result = await backupService.restoreDatabaseFromDump(filePath, tenantId);

        return reply.status(200).send({
          success: true,
          message: result.message,
          data: { tablesRestored: result.tablesRestored },
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err?.message });
      }
    }
  );
}
