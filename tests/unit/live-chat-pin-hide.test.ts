import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { messageService } from '../../src/services/message.service';
import { FastifyInstance } from 'fastify';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

const ADMIN_KEY = 'test_admin_key_pin_hide';

describe('Live Chat PIN & HIDE Bubble Chat (Adversarial & Flow Tests)', () => {
  let app: FastifyInstance;
  let conversationId: string;
  let msg1Id: string;
  let msg2Id: string;
  let internalNoteId: string;
  let revokedMsgId: string;

  beforeAll(async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    app = buildApp();
    await app.ready();

    const phone = `628799${Date.now().toString().slice(-7)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda PinHide', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    conversationId = conversation.id;

    // Simulasikan session_data yang sudah berisi data booking agar kita bisa verifikasi safe merge
    const initialConv = await conversationService.getConversationById(conversationId, DEFAULT_TENANT_ID);
    if (initialConv) {
      initialConv.session_data = {
        activeGoal: 'booking',
        cartItems: [{ treatmentId: 'treat-1', name: 'Pijat Bayi' }],
        complaint: 'Batuk pilek',
      };
    }

    const m1 = await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId,
      direction: 'INBOUND',
      content: 'Halo admin, tolong catat alergi anak saya terhadap parasetamol.',
      senderType: 'CUSTOMER',
    });
    msg1Id = m1.id;

    const m2 = await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId,
      direction: 'OUTBOUND',
      content: 'Baik Bunda, sudah kami catat ya.',
      senderType: 'ADMIN',
    });
    msg2Id = m2.id;

    const mNote = await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId,
      direction: 'OUTBOUND',
      content: 'Catatan internal staf: jangan berikan resep B.',
      senderType: 'INTERNAL_NOTE',
    });
    internalNoteId = mNote.id;

    const mRev = await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId,
      direction: 'OUTBOUND',
      content: 'Pesan keliru yang akan ditarik.',
      senderType: 'ADMIN',
    });
    revokedMsgId = mRev.id;
    await messageService.markMessageDeleted(revokedMsgId, DEFAULT_TENANT_ID);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. PIN Message (Sematkan Pesan & Single-Pin Rule)', () => {
    it('berhasil pin pesan 1 dan menyimpan identitas admin', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/live-chat/conversations/${conversationId}/messages/${msg1Id}/pin`,
        headers: {
          'x-api-key': ADMIN_KEY,
          'x-admin-name': 'Bidan Sari',
        },
        payload: { isPinned: true },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.isPinned).toBe(true);
      expect(body.message.is_message_pinned).toBe(true);
      expect(body.message.pinned_by).toBe('Bidan Sari');
      expect(body.message.pinned_at).toBeTruthy();
    });

    it('single-pin rule: ketika pin pesan 2, pesan 1 otomatis unpin', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/live-chat/conversations/${conversationId}/messages/${msg2Id}/pin`,
        headers: {
          'x-api-key': ADMIN_KEY,
          'x-admin-name': 'Admin Rina',
        },
        payload: { isPinned: true },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.isPinned).toBe(true);
      expect(body.message.id).toBe(msg2Id);

      // Verifikasi pesan 1 sekarang unpin
      const conv = await conversationService.getConversationById(conversationId, DEFAULT_TENANT_ID);
      const sessionData = (conv?.session_data as any) || {};
      expect(sessionData.pinned_message_id).toBe(msg2Id);

      // Verifikasi session_data safe merge: data booking/cart TIDAK hilang
      expect(sessionData.activeGoal).toBe('booking');
      expect(sessionData.cartItems).toHaveLength(1);
      expect(sessionData.complaint).toBe('Batuk pilek');
    });

    it('endpoint GET pinned-message mengembalikan pesan 2 yang sedang aktif', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/admin/live-chat/conversations/${conversationId}/pinned-message`,
        headers: { 'x-api-key': ADMIN_KEY },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.pinnedMessage).toBeTruthy();
      expect(body.pinnedMessage.id).toBe(msg2Id);
      expect(body.pinnedMessage.is_message_pinned).toBe(true);
      expect(body.pinnedMessage.pinned_by).toBe('Admin Rina');
    });

    it('endpoint GET messages juga mengembalikan field pinnedMessage', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/admin/live-chat/conversations/${conversationId}/messages`,
        headers: { 'x-api-key': ADMIN_KEY },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.pinnedMessage).toBeTruthy();
      expect(body.pinnedMessage.id).toBe(msg2Id);
    });

    it('bisa unpin pesan 2 dan pointer session_data.pinned_message_id dibersihkan', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/live-chat/conversations/${conversationId}/messages/${msg2Id}/pin`,
        headers: { 'x-api-key': ADMIN_KEY },
        payload: { isPinned: false },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.isPinned).toBe(false);

      const conv = await conversationService.getConversationById(conversationId, DEFAULT_TENANT_ID);
      const sessionData = (conv?.session_data as any) || {};
      expect(sessionData.pinned_message_id).toBeFalsy();
      // Data booking tetap terjaga
      expect(sessionData.activeGoal).toBe('booking');
    });

    it('menolak pin pada pesan yang sudah ditarik (revoked)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/live-chat/conversations/${conversationId}/messages/${revokedMsgId}/pin`,
        headers: { 'x-api-key': ADMIN_KEY },
        payload: { isPinned: true },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toContain('ditarik');
    });
  });

  describe('2. HIDE Message (Sembunyikan Bubble Internal)', () => {
    it('berhasil hide pesan 1', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/live-chat/conversations/${conversationId}/messages/${msg1Id}/hide`,
        headers: {
          'x-api-key': ADMIN_KEY,
          'x-admin-name': 'Supervisor Dewi',
        },
        payload: { isHidden: true },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.isHidden).toBe(true);
      expect(body.message.is_message_hidden).toBe(true);
      expect(body.message.hidden_by).toBe('Supervisor Dewi');
    });

    it('berhasil unhide pesan 1 kembali', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/live-chat/conversations/${conversationId}/messages/${msg1Id}/hide`,
        headers: { 'x-api-key': ADMIN_KEY },
        payload: { isHidden: false },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.isHidden).toBe(false);
      expect(body.message.is_message_hidden).toBe(false);
    });

    it('menolak hide pada pesan catatan internal (INTERNAL_NOTE)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/live-chat/conversations/${conversationId}/messages/${internalNoteId}/hide`,
        headers: { 'x-api-key': ADMIN_KEY },
        payload: { isHidden: true },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.toLowerCase()).toContain('catatan internal');
    });

    it('menolak hide pada pesan yang sudah ditarik (revoked)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/live-chat/conversations/${conversationId}/messages/${revokedMsgId}/hide`,
        headers: { 'x-api-key': ADMIN_KEY },
        payload: { isHidden: true },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toContain('ditarik');
    });
  });

  describe('3. Tenant Isolation & Anti-IDOR', () => {
    it('menolak pin pesan bila tenant ID berbeda', async () => {
      const alienTenant = 'tenant-alien-999';
      const result = await messageService.toggleMessagePin(conversationId, msg1Id, alienTenant, 'Hacker', true);
      expect(result.success).toBe(false);
      expect(result.error).toContain('tidak ditemukan');
    });

    it('menolak hide pesan bila tenant ID berbeda', async () => {
      const alienTenant = 'tenant-alien-999';
      const result = await messageService.toggleMessageHide(conversationId, msg1Id, alienTenant, 'Hacker', true);
      expect(result.success).toBe(false);
      expect(result.error).toContain('tidak ditemukan');
    });
  });

  describe('4. Revoke Message Auto-Cleans Pin', () => {
    it('ketika pesan yang di-pin ditarik (revoke), otomatis unpin dan session_data dibersihkan', async () => {
      // Pin pesan 1 kembali
      await messageService.toggleMessagePin(conversationId, msg1Id, DEFAULT_TENANT_ID, true, 'Admin');

      let conv = await conversationService.getConversationById(conversationId, DEFAULT_TENANT_ID);
      expect((conv?.session_data as any)?.pinned_message_id).toBe(msg1Id);

      // Tarik / revoke pesan 1
      await messageService.markMessageDeleted(msg1Id, DEFAULT_TENANT_ID);

      // Verifikasi pointer session_data dibersihkan
      conv = await conversationService.getConversationById(conversationId, DEFAULT_TENANT_ID);
      expect((conv?.session_data as any)?.pinned_message_id).toBeFalsy();

      // getPinnedMessage harus mengembalikan null
      const pinned = await messageService.getPinnedMessage(conversationId, DEFAULT_TENANT_ID);
      expect(pinned).toBeNull();
    });
  });
});
