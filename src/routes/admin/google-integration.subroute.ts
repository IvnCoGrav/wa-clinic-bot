import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { googleOAuthClientManager } from '../../integrations/google-contacts/google-oauth.client';
import { googleContactsService } from '../../services/google-contacts.service';
import { auditService } from '../../services/audit.service';

export async function googleIntegrationAdminRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/integrations/google/auth-url
   * Dapatkan URL otorisasi Google OAuth
   */
  fastify.get(
    '/api/admin/integrations/google/auth-url',
    async (request: FastifyRequest<{ Querystring: { tenantId?: string } }>, reply: FastifyReply) => {
      try {
        const tenantId = request.query.tenantId || DEFAULT_TENANT_ID;
        if (!googleOAuthClientManager.isPlatformConfigured()) {
          return reply.status(400).send({
            success: false,
            error: 'Google OAuth platform credentials (Client ID / Secret / Redirect URI) belum dikonfigurasi di environment server.',
          });
        }

        const authUrl = googleOAuthClientManager.generateAuthUrl(tenantId);
        return reply.status(200).send({
          success: true,
          data: { authUrl },
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err?.message });
      }
    }
  );

  /**
   * GET /api/admin/integrations/google/callback
   * Redirect callback dari Google OAuth setelah klien login & memberi izin
   */
  fastify.get(
    '/api/admin/integrations/google/callback',
    async (
      request: FastifyRequest<{
        Querystring: { code?: string; state?: string; error?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { code, state, error } = request.query;

      if (error) {
        return reply.redirect(`/admin/settings?google_error=${encodeURIComponent(error)}`);
      }

      if (!code) {
        return reply.redirect('/admin/settings?google_error=missing_auth_code');
      }

      try {
        const { tenantId } = googleOAuthClientManager.parseState(state);
        const tokens = await googleOAuthClientManager.exchangeCodeForTokens(code);

        await googleContactsService.saveOAuthTokens(tenantId, tokens);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed || 'OAUTH_CALLBACK',
          adminIdentity: (request as any).adminIdentity || 'google_oauth_callback',
          action: 'CONNECT_GOOGLE_CONTACTS',
          payload: { tenantId, email: tokens.email },
          ipAddress: request.ip,
        });

        return reply.redirect('/admin/settings?google_connected=true');
      } catch (err: any) {
        console.error('[GoogleOAuth Callback Error]:', err?.message);
        return reply.redirect(
          `/admin/settings?google_error=${encodeURIComponent(err?.message || 'callback_failed')}`
        );
      }
    }
  );

  /**
   * GET /api/admin/integrations/google/status
   * Ambil status integrasi Google Contacts untuk tenant aktif
   */
  fastify.get(
    '/api/admin/integrations/google/status',
    async (request: FastifyRequest<{ Querystring: { tenantId?: string } }>, reply: FastifyReply) => {
      try {
        const tenantId = request.query.tenantId || DEFAULT_TENANT_ID;
        const status = await googleContactsService.getIntegrationStatus(tenantId);
        return reply.status(200).send({
          success: true,
          data: status,
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err?.message });
      }
    }
  );

  /**
   * PUT /api/admin/integrations/google/settings
   * Update preferensi penamaan kontak & toggle auto-sync
   */
  fastify.put(
    '/api/admin/integrations/google/settings',
    async (
      request: FastifyRequest<{
        Body: {
          tenantId?: string;
          isEnabled?: boolean;
          namingTemplate?: string;
          contactLabel?: string;
          autoSyncOnChat?: boolean;
          autoSyncOnReserve?: boolean;
        };
      }>,
      reply: FastifyReply
    ) => {
      const {
        tenantId = DEFAULT_TENANT_ID,
        isEnabled,
        namingTemplate,
        contactLabel,
        autoSyncOnChat,
        autoSyncOnReserve,
      } = request.body || {};

      try {
        const updated = await googleContactsService.updateSettings(tenantId, {
          isEnabled,
          namingTemplate,
          contactLabel,
          autoSyncOnChat,
          autoSyncOnReserve,
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_GOOGLE_CONTACTS_SETTINGS',
          payload: { tenantId, isEnabled, namingTemplate, contactLabel },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          data: updated,
          message: 'Pengaturan Google Contacts berhasil disimpan.',
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err?.message });
      }
    }
  );

  /**
   * POST /api/admin/integrations/google/sync-all
   * Jalankan sinkronisasi massal semua customer tenant ke Google Contacts
   */
  fastify.post(
    '/api/admin/integrations/google/sync-all',
    async (
      request: FastifyRequest<{
        Body: { tenantId?: string };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = request.body?.tenantId || DEFAULT_TENANT_ID;

      try {
        const status = await googleContactsService.getIntegrationStatus(tenantId);
        if (!status.isConnected) {
          return reply.status(400).send({
            success: false,
            error: 'Akun Google belum terhubung. Silakan sambungkan akun terlebih dahulu.',
          });
        }

        const result = await googleContactsService.batchSyncAllCustomers(tenantId);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'BATCH_SYNC_GOOGLE_CONTACTS',
          payload: { tenantId, result },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          data: result,
          message: `Sinkronisasi selesai. Berhasil: ${result.success}, Gagal: ${result.failed}, Total: ${result.total}.`,
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err?.message });
      }
    }
  );

  /**
   * POST /api/admin/integrations/google/import
   * Tarik & impor seluruh kontak eksisting dari akun Google Contacts ke database bot (Inbound Sync)
   */
  fastify.post(
    '/api/admin/integrations/google/import',
    async (
      request: FastifyRequest<{
        Body: { tenantId?: string };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = request.body?.tenantId || DEFAULT_TENANT_ID;

      try {
        const status = await googleContactsService.getIntegrationStatus(tenantId);
        if (!status.isConnected) {
          return reply.status(400).send({
            success: false,
            error: 'Akun Google belum terhubung. Silakan sambungkan akun terlebih dahulu.',
          });
        }

        const result = await googleContactsService.importContactsFromGoogle(tenantId);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'IMPORT_GOOGLE_CONTACTS',
          payload: { tenantId, result },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          data: result,
          message: `Berhasil menarik ${result.totalFetched} kontak dari Google Contacts: ${result.newlyCreated} pasien baru ditambahkan, ${result.updatedExisting} pasien diperbarui, ${result.skippedNoPhone} dilewati (tanpa no HP).`,
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err?.message });
      }
    }
  );

  /**
   * POST /api/admin/integrations/google/disconnect
   * Putus koneksi Google Contacts & hapus token
   */
  fastify.post(
    '/api/admin/integrations/google/disconnect',
    async (
      request: FastifyRequest<{
        Body: { tenantId?: string };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = request.body?.tenantId || DEFAULT_TENANT_ID;

      try {
        await googleOAuthClientManager.revokeAndDisconnect(tenantId);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'DISCONNECT_GOOGLE_CONTACTS',
          payload: { tenantId },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: 'Koneksi Google Contacts berhasil diputus.',
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err?.message });
      }
    }
  );

  /**
   * GET /api/admin/integrations/google/sheets-config
   * Konfigurasi rekapan Google Sheets per-tenant (tanpa kredensial sensitif).
   */
  fastify.get(
    '/api/admin/integrations/google/sheets-config',
    async (request: FastifyRequest<{ Querystring: { tenantId?: string } }>, reply: FastifyReply) => {
      const tenantId = request.query.tenantId || DEFAULT_TENANT_ID;
      try {
        const { sheetsSyncService } = await import('../../services/sheets/sheets-sync.service');
        const status = await googleContactsService.getIntegrationStatus(tenantId);
        const config = await sheetsSyncService.getPublicConfig(tenantId);
        return reply.status(200).send({
          success: true,
          data: {
            config: config || null,
            googleConnected: status.isConnected,
            connectedEmail: status.connectedEmail,
          },
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err?.message });
      }
    }
  );

  /**
   * PUT /api/admin/integrations/google/sheets-config
   * Perbarui konfigurasi rekapan Sheets (toggle, nama file, ID master, template).
   */
  fastify.put(
    '/api/admin/integrations/google/sheets-config',
    async (
      request: FastifyRequest<{
        Body: {
          tenantId?: string;
          isEnabled?: boolean;
          fileBaseName?: string;
          masterSpreadsheetId?: string | null;
          templateSheetName?: string;
          monthTabNames?: string[];
          yearlyFileIds?: Record<string, string>;
        };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = request.body?.tenantId || DEFAULT_TENANT_ID;
      const body = request.body || {};
      try {
        const { sheetsSyncService } = await import('../../services/sheets/sheets-sync.service');
        await sheetsSyncService.updateConfig(tenantId, {
          is_enabled: body.isEnabled,
          file_base_name: body.fileBaseName,
          master_spreadsheet_id: body.masterSpreadsheetId,
          template_sheet_name: body.templateSheetName,
          month_tab_names: body.monthTabNames,
          yearly_file_ids: body.yearlyFileIds,
        });
        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_SHEETS_CONFIG',
          payload: { tenantId, isEnabled: body.isEnabled },
          ipAddress: request.ip,
        });
        return reply.status(200).send({ success: true, message: 'Konfigurasi rekapan Sheets tersimpan.' });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err?.message });
      }
    }
  );

  /**
   * POST /api/admin/integrations/google/sheets-test
   * Uji koneksi tulis: pastikan tab bulan berjalan siap (duplikat template bila
   * perlu) tanpa menulis baris data. Mengembalikan pesan jujur bila izin kurang.
   */
  fastify.post(
    '/api/admin/integrations/google/sheets-test',
    async (request: FastifyRequest<{ Body: { tenantId?: string } }>, reply: FastifyReply) => {
      const tenantId = request.body?.tenantId || DEFAULT_TENANT_ID;
      try {
        const { sheetsSyncService } = await import('../../services/sheets/sheets-sync.service');
        const result = await sheetsSyncService.testConnection(tenantId);
        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'TEST_SHEETS_CONNECTION',
          payload: { tenantId, ...result },
          ipAddress: request.ip,
        });
        return reply.status(200).send({
          success: true,
          data: result,
          message: `Koneksi Sheets OK. Tab "${result.tabName}" (${result.year}) ${result.created ? 'dibuat' : 'sudah ada'}.`,
        });
      } catch (err: any) {
        const msg = err?.message || '';
        let hint = 'Gagal mengakses Google Sheets.';
        if (msg === 'SHEETS_NOT_CONNECTED') hint = 'Google belum terhubung / izin tidak cukup. Sambungkan ulang akun Google (scope spreadsheets).';
        else if (msg === 'TEMPLATE_SHEET_NOT_FOUND') hint = 'Tab template (mis. _TEMPLATE) tidak ditemukan di spreadsheet.';
        else if (msg === 'SHEETS_YEAR_NOT_CONFIGURED') hint = 'Tahun berjalan belum dipetakan ke ID file (yearly_file_ids).';
        else if (msg === 'SHEETS_CONFIG_DISABLED') hint = 'Konfigurasi rekapan belum ada untuk tenant ini.';
        return reply.status(400).send({ success: false, error: hint, detail: msg });
      }
    }
  );
}
