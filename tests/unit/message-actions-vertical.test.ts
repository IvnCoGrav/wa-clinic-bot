import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import axios from 'axios';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { messageService } from '../../src/services/message.service';
import { liveChatService } from '../../src/services/live-chat.service';
import { conversationService } from '../../src/services/conversation.service';
import { customerService } from '../../src/services/customer.service';
import { whatsappProviderService } from '../../src/services/whatsapp-provider.service';
import * as whatsappFactory from '../../src/integrations/whatsapp/factory';
import { responseCacheService } from '../../src/services/response-cache.service';
import { getLiveChatHub } from '../../src/services/live-chat-hub.service';
import { WahaClient } from '../../src/integrations/waha/client';
import { extractWahaEventMessageId } from '../../src/routes/webhook.route';
import { wahaTenantService } from '../../src/services/waha-tenant.service';

const BACKFILL_MIGRATION_PATH = path.resolve(
  __dirname,
  '../../prisma/migrations/20261118153000_backfill_messages_is_revoked_column/migration.sql'
);

describe('Vertical Message Operations Hardening (KNOWN #358 Fase 2)', () => {
  const TENANT = 'tenant-vertical-test';

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'test_key_vertical';
    process.env.WAHA_WEBHOOK_SECRET = '';
  });

  describe('1. extractWahaEventMessageId (A-007 anti [object Object])', () => {
    it('mengekstrak string, _serialized, atau .id objek dengan aman tanpa [object Object]', () => {
      expect(extractWahaEventMessageId('3EB0ABC')).toBe('3EB0ABC');
      expect(extractWahaEventMessageId({ _serialized: 'true_628123@c.us_3EB0ABC', id: '3EB0ABC' })).toBe(
        'true_628123@c.us_3EB0ABC'
      );
      expect(extractWahaEventMessageId({ id: '3EB0ONLYID', fromMe: true })).toBe('3EB0ONLYID');
      expect(extractWahaEventMessageId({ fromMe: true })).toBeNull();
      expect(extractWahaEventMessageId(null)).toBeNull();
      expect(extractWahaEventMessageId(undefined)).toBeNull();
    });
  });

  describe('2. Webhook WAHA message.revoked + Single Seam markMessageDeleted (V-02, CD-04, A-008)', () => {
    it('memproses payload resmi WAHA NOWEB (revokedMessageId / before.id objek) dan mendelegasikan ke markMessageDeleted', async () => {
      const app = buildApp();
      vi.spyOn(wahaTenantService, 'resolveTenantBySession').mockResolvedValue(TENANT);
      const markSpy = vi.spyOn(messageService, 'markMessageDeleted').mockResolvedValue(true);

      const res1 = await app.inject({
        method: 'POST',
        url: '/webhook',
        payload: {
          event: 'message.revoked',
          session: 'default',
          payload: {
            from: '628123456789@c.us',
            fromMe: true,
            revokedMessageId: 'true_628123456789@c.us_3EB0REVOKED1',
          },
        },
      });
      expect(res1.statusCode).toBe(200);
      expect(markSpy).toHaveBeenCalledWith('true_628123456789@c.us_3EB0REVOKED1', expect.any(String), 'ADMIN');

      markSpy.mockClear();
      const res2 = await app.inject({
        method: 'POST',
        url: '/webhook',
        payload: {
          event: 'message.revoked',
          session: 'default',
          payload: {
            before: { id: { id: '3EB0OBJID2', fromMe: false }, from: '628123456789@c.us', fromMe: false },
          },
        },
      });
      expect(res2.statusCode).toBe(200);
      expect(markSpy).toHaveBeenCalledWith('3EB0OBJID2', expect.any(String), 'CUSTOMER');
    });

    it('CD-04: mengabaikan event message.revoked dari grup (@g.us) dan status@broadcast', async () => {
      const app = buildApp();
      vi.spyOn(wahaTenantService, 'resolveTenantBySession').mockResolvedValue(TENANT);
      const markSpy = vi.spyOn(messageService, 'markMessageDeleted').mockResolvedValue(true);

      for (const chat of ['120363123456789@g.us', 'status@broadcast']) {
        const res = await app.inject({
          method: 'POST',
          url: '/webhook',
          payload: {
            event: 'message.revoked',
            session: 'default',
            payload: {
              from: chat,
              revokedMessageId: 'true_123@g.us_3EB0GRP',
            },
          },
        });
        expect(res.statusCode).toBe(200);
      }
      expect(markSpy).not.toHaveBeenCalled();
    });

    it('CD-04 + A-008: markMessageDeleted menulis kolom is_revoked + payload_raw, dan return false TANPA hapus cache/SSE saat pesan tidak ditemukan', async () => {
      const invalidateSpy = vi.spyOn(responseCacheService, 'invalidatePrefix').mockResolvedValue(undefined as any);
      const publishSpy = vi.spyOn(getLiveChatHub(), 'publish').mockResolvedValue(undefined as any);

      // Kasus 1: Pesan tidak ada di DB (mis. dari chat tak dikenal) -> TIDAK boleh wipe cache atau broadcast SSE
      (prisma.message as any).findFirst = vi.fn().mockResolvedValue(null);
      const notFoundRes = await messageService.markMessageDeleted('true_628999@c.us_UNKNOWN999', TENANT, 'CUSTOMER');
      expect(notFoundRes).toBe(false);
      expect(invalidateSpy).not.toHaveBeenCalled();
      expect(publishSpy).not.toHaveBeenCalled();

      // Kasus 2: Pesan cocok via short key (endsWith) -> dual-write kolom + payload_raw + cache + SSE
      const updateManySpy = vi.fn().mockResolvedValue({ count: 1 });
      (prisma.message as any).findFirst = vi.fn().mockResolvedValue({
        id: 'msg-uuid-1',
        tenant_id: TENANT,
        conversation_id: 'conv-1',
        wa_message_id: '3EB0MATCH1',
        content: 'Halo',
        payload_raw: {},
      });
      (prisma.message as any).updateMany = updateManySpy;
      (prisma.conversation as any).findFirst = vi.fn().mockResolvedValue({ id: 'conv-1', session_data: {} });

      const foundRes = await messageService.markMessageDeleted('true_628123@c.us_3EB0MATCH1', TENANT, 'ADMIN');
      expect(foundRes).toBe(true);
      expect(updateManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'msg-uuid-1', tenant_id: TENANT },
          data: expect.objectContaining({
            content: '🚫 Pesan ini telah ditarik',
            is_revoked: true,
            revoked_by: 'ADMIN',
            revoked_at: expect.any(Date),
            payload_raw: expect.objectContaining({ is_revoked: true }),
          }),
        })
      );
      expect(invalidateSpy).toHaveBeenCalledWith('livechat:');
      expect(publishSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'message.updated',
          tenantId: TENANT,
          payload: expect.objectContaining({
            conversationId: 'conv-1',
            messageId: 'msg-uuid-1',
            isRevoked: true,
          }),
        })
      );
    });

    it('A-008: file migrasi backfill kolom is_revoked tersedia dan idempoten', () => {
      expect(fs.existsSync(BACKFILL_MIGRATION_PATH)).toBe(true);
      const sql = fs.readFileSync(BACKFILL_MIGRATION_PATH, 'utf8');
      expect(sql).toMatch(/UPDATE\s+"messages"/i);
      expect(sql).toMatch(/"is_revoked"\s*=\s*true/i);
      expect(sql).toMatch(/"is_revoked"\s*=\s*false/i);
    });
  });

  describe('3. Guard INTERNAL_NOTE, is_sandbox_test, wa_message_id=null, & Honest Reaction (V-03, V-05, CD-06)', () => {
    const mockGateway = {
      providerType: 'WAHA',
      supportsRevoke: true,
      supportsEdit: true,
      deleteMessage: vi.fn().mockResolvedValue({ success: true }),
      editMessage: vi.fn().mockResolvedValue({ success: true }),
      sendReactionMessage: vi.fn().mockResolvedValue({ success: false, error: { code: 'WAHA_ERR', message: 'WAHA down' } }),
    };

    beforeEach(() => {
      mockGateway.deleteMessage.mockReset().mockResolvedValue({ success: true });
      mockGateway.editMessage.mockReset().mockResolvedValue({ success: true });
      mockGateway.sendReactionMessage
        .mockReset()
        .mockResolvedValue({ success: false, error: { code: 'WAHA_ERR', message: 'WAHA down' } });

      vi.spyOn(whatsappFactory, 'resolveGatewayForTenant').mockResolvedValue(mockGateway as any);
      vi.spyOn(whatsappProviderService, 'isOutboundCutOff').mockResolvedValue(false);
      vi.spyOn(conversationService, 'getConversationById').mockResolvedValue({
        id: 'conv-1',
        customer_id: 'cust-1',
        tenant_id: TENANT,
      } as any);
    });

    it('V-03: menolak edit, revoke, dan reaction pada INTERNAL_NOTE tanpa memanggil gateway WAHA', async () => {
      vi.spyOn(customerService, 'getCustomerById').mockResolvedValue({
        id: 'cust-1',
        phone: '628123456789',
        is_sandbox_test: false,
      } as any);
      (prisma.message as any).findFirst = vi.fn().mockResolvedValue({
        id: 'note-1',
        conversation_id: 'conv-1',
        tenant_id: TENANT,
        direction: 'OUTBOUND',
        sender_type: 'INTERNAL_NOTE',
        wa_message_id: null,
        created_at: new Date(),
        payload_raw: {},
      });

      const r1 = await liveChatService.editMessage({ conversationId: 'conv-1', messageId: 'note-1', newContent: 'Edit', tenantId: TENANT });
      const r2 = await liveChatService.revokeMessage({ conversationId: 'conv-1', messageId: 'note-1', tenantId: TENANT });
      const r3 = await liveChatService.sendReaction({ conversationId: 'conv-1', messageId: 'note-1', emoji: '👍', tenantId: TENANT });

      expect(r1.success).toBe(false);
      expect(r2.success).toBe(false);
      expect(r3.success).toBe(false);
      expect(mockGateway.editMessage).not.toHaveBeenCalled();
      expect(mockGateway.deleteMessage).not.toHaveBeenCalled();
      expect(mockGateway.sendReactionMessage).not.toHaveBeenCalled();
    });

    it('V-03: menolak edit & revoke pesan non-sandbox tanpa wa_message_id (anti fallback UUID ke WAHA)', async () => {
      vi.spyOn(customerService, 'getCustomerById').mockResolvedValue({
        id: 'cust-1',
        phone: '628123456789',
        is_sandbox_test: false,
      } as any);
      (prisma.message as any).findFirst = vi.fn().mockResolvedValue({
        id: 'legacy-uuid-1',
        conversation_id: 'conv-1',
        tenant_id: TENANT,
        direction: 'OUTBOUND',
        sender_type: 'ADMIN',
        wa_message_id: null,
        created_at: new Date(),
        payload_raw: {},
      });

      const r1 = await liveChatService.editMessage({ conversationId: 'conv-1', messageId: 'legacy-uuid-1', newContent: 'Edit', tenantId: TENANT });
      const r2 = await liveChatService.revokeMessage({ conversationId: 'conv-1', messageId: 'legacy-uuid-1', tenantId: TENANT });

      expect(r1.success).toBe(false);
      expect(r2.success).toBe(false);
      expect(mockGateway.editMessage).not.toHaveBeenCalled();
      expect(mockGateway.deleteMessage).not.toHaveBeenCalled();
    });

    it('CD-06: mengizinkan edit & revoke pada chat sandbox (is_sandbox_test=true) TANPA memanggil WAHA', async () => {
      vi.spyOn(customerService, 'getCustomerById').mockResolvedValue({
        id: 'cust-sandbox',
        phone: '628000000001',
        is_sandbox_test: true,
      } as any);
      (prisma.message as any).findFirst = vi.fn().mockResolvedValue({
        id: 'sb-msg-1',
        conversation_id: 'conv-1',
        tenant_id: TENANT,
        direction: 'OUTBOUND',
        sender_type: 'ADMIN',
        wa_message_id: null,
        created_at: new Date(),
        payload_raw: {},
      });
      const updSpy = vi.spyOn(messageService, 'updateMessageContent').mockResolvedValue(true);
      const delSpy = vi.spyOn(messageService, 'markMessageDeleted').mockResolvedValue(true);

      const r1 = await liveChatService.editMessage({ conversationId: 'conv-1', messageId: 'sb-msg-1', newContent: 'Sandbox edit', tenantId: TENANT });
      const r2 = await liveChatService.revokeMessage({ conversationId: 'conv-1', messageId: 'sb-msg-1', tenantId: TENANT });

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(updSpy).toHaveBeenCalled();
      expect(delSpy).toHaveBeenCalled();
      expect(mockGateway.editMessage).not.toHaveBeenCalled();
      expect(mockGateway.deleteMessage).not.toHaveBeenCalled();
    });

    it('V-05: sendReaction non-sandbox jujur mengembalikan success=false bila WAHA gagal dan tidak menyimpan ke DB', async () => {
      vi.spyOn(customerService, 'getCustomerById').mockResolvedValue({
        id: 'cust-1',
        phone: '628123456789',
        is_sandbox_test: false,
      } as any);
      (prisma.message as any).findFirst = vi.fn().mockResolvedValue({
        id: 'msg-react-1',
        conversation_id: 'conv-1',
        tenant_id: TENANT,
        direction: 'INBOUND',
        sender_type: 'CUSTOMER',
        wa_message_id: '3EB0REACT1',
        created_at: new Date(),
        payload_raw: {},
      });
      const dbReactSpy = vi.spyOn(messageService, 'addOrUpdateReaction');

      const res = await liveChatService.sendReaction({
        conversationId: 'conv-1',
        messageId: 'msg-react-1',
        emoji: '👍',
        tenantId: TENANT,
      });

      expect(res.success).toBe(false);
      expect(dbReactSpy).not.toHaveBeenCalled();
    });
  });

  describe('4. WahaClient outboundOnly, safe fallback A-011, & deadline budget A-005', () => {
    it('outboundOnly tidak menyertakan prefix false_ untuk editMessage/deleteMessage', () => {
      const client = new WahaClient('http://waha:3000', 'default');
      const { msgIds } = (client as any).buildWahaMessageCandidates('628123456789@c.us', '3EB0OUT1', {
        outboundOnly: true,
      });
      expect(msgIds.some((id: string) => id.startsWith('false_'))).toBe(false);
      expect(msgIds.some((id: string) => id.startsWith('true_'))).toBe(true);
    });

    it('A-011: HTTP 400 pada endpoint DELETE hanya memutus loop varian endpoint DELETE, tetap mencoba fallback POST sekali', async () => {
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      process.env.WAHA_MOCK = 'false';
      try {
        const client = new WahaClient('http://waha:3000', 'default');
        const err400: any = new Error('Bad Request');
        err400.response = { status: 400, data: { message: 'Invalid' } };
        const delSpy = vi.spyOn(axios, 'delete').mockRejectedValue(err400);
        const postSpy = vi.spyOn(axios, 'post').mockResolvedValue({ status: 200, data: { ok: true } } as any);

        const ok = await client.deleteMessage('628123456789@c.us', '3EB0FALLBACK1', true);
        expect(ok).toBe(true);
        // Break-on-400 memutus sisa varian di endpoint DELETE (1 call), lalu sukses di fallback POST
        expect(delSpy).toHaveBeenCalledTimes(1);
        expect(postSpy).toHaveBeenCalledTimes(1);
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });
  });

  describe('5. updateMessageContent meng-invalidate cache livechat (V-06)', () => {
    it('memanggil responseCacheService.invalidatePrefix("livechat:") setelah edit pesan berhasil', async () => {
      const invalidateSpy = vi.spyOn(responseCacheService, 'invalidatePrefix').mockResolvedValue(undefined as any);
      vi.spyOn(getLiveChatHub(), 'publish').mockResolvedValue(undefined as any);
      (prisma.message as any).findFirst = vi.fn().mockResolvedValue({
        id: 'msg-edit-1',
        tenant_id: TENANT,
        conversation_id: 'conv-1',
        wa_message_id: '3EB0EDIT1',
        content: 'Lama',
        payload_raw: {},
      });
      (prisma.message as any).updateMany = vi.fn().mockResolvedValue({ count: 1 });

      const ok = await messageService.updateMessageContent('3EB0EDIT1', 'Baru', TENANT);
      expect(ok).toBe(true);
      expect(invalidateSpy).toHaveBeenCalledWith('livechat:');
    });
  });
});
