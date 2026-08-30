import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { StaffReservationService } from '../../services/staff-reservation.service';
import { liveChatService } from '../../services/live-chat.service';
import { auditService } from '../../services/audit.service';
import { getLiveChatHub } from '../../services/live-chat-hub.service';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { prisma } from '../../db/client';

export async function staffTodayRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/staff/today-tasks
   * Mengambil daftar reservasi & tugas lapangan milik staff yang sedang login untuk hari ini.
   * Khusus supervisor (SPV CS / Admin) dapat memfilter scope='all' untuk melihat seluruh tugas tim.
   */
  fastify.get(
    '/api/staff/today-tasks',
    async (
      request: FastifyRequest<{ Querystring: { scope?: string; date?: string } }>,
      reply: FastifyReply
    ) => {
      const staffId = (request as any).staffId;
      const role = ((request as any).staffSession?.staff?.role || '').toLowerCase();
      const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;
      const isSupervisor =
        role === 'spv_cs' || role === 'super_admin' || role === 'tenant_admin' || role === 'admin_cs';
      const scope = request.query.scope === 'all' && isSupervisor ? 'all' : 'mine';
      const dateParam = request.query.date || 'today';

      const dateMeta = StaffReservationService.getWibDateRange(dateParam);
      const tasks = await StaffReservationService.getTodayTasks(
        staffId,
        tenantId,
        scope,
        isSupervisor,
        dateParam
      );
      return reply.status(200).send({
        success: true,
        data: tasks,
        isSupervisor,
        meta: {
          dateStr: dateMeta.dateStr,
          formattedDate: dateMeta.formattedDate,
          isToday: dateMeta.isToday,
          isTomorrow: dateMeta.isTomorrow,
        },
      });
    }
  );

  /**
   * GET /api/staff/team-members
   * Mengambil daftar staf terapis aktif untuk dropdown delegasi jadwal.
   */
  fastify.get('/api/staff/team-members', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;
    try {
      const members = await prisma.staff.findMany({
        where: { tenant_id: tenantId, active: true },
        select: { id: true, name: true, role: true },
        orderBy: { name: 'asc' },
      });
      return reply.status(200).send({ success: true, data: members });
    } catch (err: any) {
      return reply.status(200).send({ success: true, data: [] });
    }
  });

  /**
   * POST /api/staff/reservations/:id/reassign
   * Mendelegasikan tugas terapis ke staf lain (khusus supervisor / SPV CS / Admin).
   */
  fastify.post(
    '/api/staff/reservations/:id/reassign',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { targetStaffId: string };
      }>,
      reply: FastifyReply
    ) => {
      const staffId = (request as any).staffId;
      const role = ((request as any).staffSession?.staff?.role || '').toLowerCase();
      const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;
      const isSupervisor =
        role === 'spv_cs' || role === 'super_admin' || role === 'tenant_admin' || role === 'admin_cs';

      if (!isSupervisor) {
        return reply.status(403).send({ error: 'Hanya supervisor/admin yang dapat mendelegasikan tugas terapis.' });
      }

      const { id } = request.params;
      const body = request.body as any || {};
      const targetStaffId = body.targetStaffId || body.staffId;

      const result = await StaffReservationService.reassignTask({
        reservationId: id,
        targetStaffId,
        supervisorStaffId: staffId,
        tenantId,
      });

      if (!result.success) {
        return reply.status(400).send({ error: result.error || 'Gagal mendelegasikan tugas.' });
      }

      return reply.status(200).send({ success: true, data: result.data });
    }
  );

  /**
   * GET /api/staff/upcoming-schedule
   * Mengambil jadwal kunjungan masa depan (hari esok dan seterusnya).
   * Hanya jadwal murni tanpa akses percakapan chat.
   */
  fastify.get('/api/staff/upcoming-schedule', async (request: FastifyRequest, reply: FastifyReply) => {
    const staffId = (request as any).staffId;
    const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;

    const schedule = await StaffReservationService.getUpcomingSchedule(staffId, tenantId);
    return reply.status(200).send({ success: true, data: schedule });
  });

  /**
   * GET /api/staff/completed-tasks
   * Mengambil riwayat treatment yang sudah selesai dilakukan oleh staff.
   */
  fastify.get('/api/staff/completed-tasks', async (request: FastifyRequest, reply: FastifyReply) => {
    const staffId = (request as any).staffId;
    const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;

    const completed = await StaffReservationService.getCompletedTasks(staffId, tenantId);
    return reply.status(200).send({ success: true, data: completed });
  });

  /**
   * GET /api/staff/conversations/:id/messages
   * Mengambil riwayat pesan percakapan khusus customer yang tugasnya aktif hari ini.
   * Dibatasi maksimal 10 bubble chat terakhir saja untuk menjaga fokus dan privasi.
   */
  fastify.get(
    '/api/staff/conversations/:id/messages',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const staffId = (request as any).staffId;
      const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;
      const { id } = request.params;

      const role = ((request as any).staffSession?.staff?.role || '').toLowerCase();
      const isSupervisor =
        role === 'spv_cs' || role === 'super_admin' || role === 'tenant_admin' || role === 'admin_cs';

      const owned = await StaffReservationService.assertConversationOwnedByStaffToday(
        id,
        staffId,
        tenantId,
        isSupervisor
      );
      if (!owned) {
        return reply.status(403).send({ error: 'Anda tidak memiliki akses ke percakapan ini. Akses chat hanya terbuka saat jadwal treatment aktif hari ini.' });
      }

      const allMessages = await liveChatService.getConversationMessages(id, tenantId);
      const messages = Array.isArray(allMessages) ? allMessages.slice(-10) : [];
      return reply.status(200).send({ success: true, data: messages });
    }
  );

  /**
   * POST /api/staff/conversations/:id/reply
   * Staff mengirim balasan pesan ke customer yang ditugaskan.
   * Pesan dikirim atas nama Bot Official klinik (sesuai gateway tenant).
   */
  fastify.post(
    '/api/staff/conversations/:id/reply',
    { bodyLimit: 12 * 1024 * 1024 },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: {
          text?: string;
          imageB64?: string;
          thumbB64?: string;
          mimeType?: string;
          fileName?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const staffId = (request as any).staffId;
      const staffName = (request as any).staffSession?.staff?.name || 'Staff Terapis';
      const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;
      const { id } = request.params;
      const { text, imageB64, thumbB64, mimeType, fileName } = request.body || {};

      const role = ((request as any).staffSession?.staff?.role || '').toLowerCase();
      const isSupervisor =
        role === 'spv_cs' || role === 'super_admin' || role === 'tenant_admin' || role === 'admin_cs';

      const owned = await StaffReservationService.assertConversationOwnedByStaffToday(
        id,
        staffId,
        tenantId,
        isSupervisor
      );
      if (!owned) {
        return reply.status(403).send({ error: 'Anda tidak memiliki akses ke percakapan ini.' });
      }

      // Sisipkan tanda tangan nama bidan secara otomatis di baris paling bawah (~ [Nama Bidan])
      let finalText = text || '';
      if (finalText.trim()) {
        const trimmed = finalText.trim();
        const signaturePattern = new RegExp(`~\\s*${staffName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        if (!signaturePattern.test(trimmed)) {
          finalText = `${trimmed}\n\n~ ${staffName}`;
        }
      }

      const result = await liveChatService.sendAdminReply({
        conversationId: id,
        text: finalText,
        imageB64,
        thumbB64,
        mimeType,
        fileName,
        tenantId,
        adminName: staffName,
        // Balasan terapis selalu mengaktifkan mode human-handling agar bot
        // tidak menyela percakapan di tengah penanganan oleh staf.
        forceEscalate: true,
      });

      if (!result.success) {
        return reply.status(400).send({ success: false, error: result.error });
      }

      // Audit trail
      await auditService.logAdminAction({
        apiKey: 'STAFF_SESSION',
        adminIdentity: staffName,
        action: 'STAFF_REPLY',
        targetId: id,
        payload: { textPreview: text ? text.substring(0, 50) : '[Media]' },
        ipAddress: request.ip,
        tenantId,
      });

      return reply.status(200).send({ success: true, data: result });
    }
  );

  /**
   * GET /api/staff/otw-template
   * Mengambil template pesan OTW siap kirim dengan placeholder nama pasien & terapis terisi.
   */
  fastify.get(
    '/api/staff/otw-template',
    async (
      request: FastifyRequest<{
        Querystring: { patientName?: string };
      }>,
      reply: FastifyReply
    ) => {
      const staffName = (request as any).staffSession?.staff?.name || 'Bidan Terapis';
      const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;
      const { patientName = 'Bunda' } = request.query || {};

      const text = await StaffReservationService.getOtwMessageText(tenantId, {
        patientName,
        therapistName: staffName,
      });

      return reply.status(200).send({ success: true, text });
    }
  );

  /**
   * POST /api/staff/reservations/:id/otw
   * Mengirim notifikasi WhatsApp otomatis bahwa terapis sedang meluncur ke lokasi pasien (OTW).
   */
  fastify.post(
    '/api/staff/reservations/:id/otw',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body?: { text?: string };
      }>,
      reply: FastifyReply
    ) => {
      const staffId = (request as any).staffId;
      const staffName = (request as any).staffSession?.staff?.name || 'Staff Terapis';
      const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;
      const { id } = request.params;
      const customText = request.body?.text;

      const reservation = await prisma.reservation.findUnique({
        where: { id },
        include: {
          customer: {
            include: {
              conversations: {
                where: { tenant_id: tenantId },
                orderBy: { updated_at: 'desc' },
                take: 1,
              },
            },
          },
          assigned_staff: true,
        },
      });

      if (!reservation) {
        return reply.status(404).send({ success: false, error: 'Reservasi tidak ditemukan.' });
      }

      const conversation = (reservation as any).customer?.conversations?.[0];
      if (!conversation) {
        return reply.status(400).send({
          success: false,
          error: 'Belum ada percakapan WhatsApp yang terhubung dengan customer ini.',
        });
      }

      const patientName = (reservation as any).customer?.name || 'Bunda';
      const therapistName = (reservation as any).assigned_staff?.name || staffName;

      let finalText = customText;
      if (!finalText || !finalText.trim()) {
        finalText = await StaffReservationService.getOtwMessageText(tenantId, {
          patientName,
          therapistName,
        });
      }

      const replyResult = await liveChatService.sendAdminReply({
        conversationId: conversation.id,
        text: finalText,
        tenantId,
        adminName: therapistName,
        forceEscalate: true,
      });

      if (!replyResult.success) {
        return reply.status(400).send({ success: false, error: replyResult.error });
      }

      // Audit trail
      await auditService.logAdminAction({
        apiKey: 'STAFF_SESSION',
        adminIdentity: staffName,
        action: 'STAFF_SEND_OTW',
        targetId: id,
        payload: { conversationId: conversation.id, textPreview: finalText.slice(0, 60) },
        ipAddress: request.ip,
        tenantId,
      });

      return reply.status(200).send({
        success: true,
        message: `Pesan OTW berhasil dikirim ke WhatsApp ${patientName}!`,
        data: replyResult,
      });
    }
  );

  /**
   * POST /api/staff/reservations/:id/payment
   * Mencatat penyelesaian pembayaran transaksi homecare oleh terapis di lapangan.
   */
  fastify.post(
    '/api/staff/reservations/:id/payment',
    { bodyLimit: 12 * 1024 * 1024 },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: {
          paymentMethod: 'CASH' | 'TRANSFER' | 'QRIS';
          amount?: number;
          proofImageB64?: string;
          notes?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const staffId = (request as any).staffId;
      const staffName = (request as any).staffSession?.staff?.name || 'Staff Terapis';
      const role = ((request as any).staffSession?.staff?.role || '').toLowerCase();
      const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;
      const isSupervisor =
        role === 'spv_cs' || role === 'super_admin' || role === 'tenant_admin' || role === 'admin_cs' || role === 'admin';
      const { id } = request.params;
      const { paymentMethod, amount, proofImageB64, notes } = request.body || {};

      if (!paymentMethod) {
        return reply.status(400).send({ success: false, error: 'Metode pembayaran (paymentMethod) wajib dipilih.' });
      }

      const result = await StaffReservationService.recordPayment({
        reservationId: id,
        staffId,
        staffName,
        tenantId,
        paymentMethod,
        amount,
        proofImageB64,
        notes,
        isSupervisor,
      });

      if (!result.success) {
        return reply.status(400).send({ success: false, error: result.error });
      }

      return reply.status(200).send({ success: true, data: result.data });
    }
  );

  /**
   * POST /api/staff/update-location
   * Memperbarui koordinat GPS lokasi, foto tampak depan rumah, dan catatan patokan
   * milik customer dari lapangan oleh terapis.
   */
  fastify.post(
    '/api/staff/update-location',
    { bodyLimit: 12 * 1024 * 1024 },
    async (
      request: FastifyRequest<{
        Body: {
          reservationId: string;
          lat?: number;
          lng?: number;
          housePhotoB64?: string;
          landmark?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const staffId = (request as any).staffId;
      const staffName = (request as any).staffSession?.staff?.name || 'Staff Terapis';
      const role = ((request as any).staffSession?.staff?.role || '').toLowerCase();
      const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;
      const isSupervisor =
        role === 'spv_cs' || role === 'super_admin' || role === 'tenant_admin' || role === 'admin_cs' || role === 'admin';
      const { reservationId, lat, lng, housePhotoB64, landmark } = request.body || {};

      if (!reservationId) {
        return reply.status(400).send({ success: false, error: 'reservationId wajib disertakan.' });
      }

      const result = await StaffReservationService.updateCustomerLocation({
        reservationId,
        staffId,
        staffName,
        tenantId,
        lat,
        lng,
        housePhotoB64,
        landmark,
        isSupervisor,
      });

      if (!result.success) {
        return reply.status(400).send({ success: false, error: result.error });
      }

      return reply.status(200).send({ success: true, data: result.data });
    }
  );

  /**
   * GET /api/staff/gateway-capability
   * Mengambil kapabilitas gateway WhatsApp tenant aktif (apakah mendukung revoke pesan / WAHA vs WABA).
   */
  fastify.get('/api/staff/gateway-capability', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;
    const capability = await liveChatService.getGatewayCapability(tenantId);
    return reply.status(200).send({ success: true, data: capability });
  });

  /**
   * DELETE /api/staff/conversations/:id/messages/:messageId
   * Staff menarik pesan WhatsApp untuk semua orang (Delete for Everyone / Revoke).
   * Dibatasi hanya untuk percakapan customer yang aktif hari ini.
   */
  fastify.delete(
    '/api/staff/conversations/:id/messages/:messageId',
    async (
      request: FastifyRequest<{
        Params: { id: string; messageId: string };
      }>,
      reply: FastifyReply
    ) => {
      const staffId = (request as any).staffId;
      const staffName = (request as any).staffSession?.staff?.name || 'Bidan Terapis';
      const role = ((request as any).staffSession?.staff?.role || '').toLowerCase();
      const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;
      const isSupervisor =
        role === 'spv_cs' || role === 'super_admin' || role === 'tenant_admin' || role === 'admin_cs' || role === 'admin';
      const { id, messageId } = request.params;

      const owned = await StaffReservationService.assertConversationOwnedByStaffToday(id, staffId, tenantId, isSupervisor);
      if (!owned) {
        return reply.status(403).send({ error: 'Anda tidak memiliki akses ke percakapan ini.' });
      }

      const result = await liveChatService.revokeMessage({
        conversationId: id,
        messageId,
        tenantId,
        adminName: staffName,
      });

      if (!result.success) {
        return reply.status(400).send({ success: false, error: result.error });
      }

      return reply.status(200).send({ success: true, message: 'Pesan berhasil ditarik dari WhatsApp.' });
    }
  );

  /**
   * PUT /api/staff/conversations/:id/messages/:messageId/edit
   * Staff mengedit pesan WhatsApp yang sudah terkirim (maksimal 15 menit).
   * Dibatasi hanya untuk percakapan customer yang aktif hari ini.
   */
  fastify.put(
    '/api/staff/conversations/:id/messages/:messageId/edit',
    async (
      request: FastifyRequest<{
        Params: { id: string; messageId: string };
        Body: { text: string };
      }>,
      reply: FastifyReply
    ) => {
      const staffId = (request as any).staffId;
      const staffName = (request as any).staffSession?.staff?.name || 'Bidan Terapis';
      const role = ((request as any).staffSession?.staff?.role || '').toLowerCase();
      const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;
      const isSupervisor =
        role === 'spv_cs' || role === 'super_admin' || role === 'tenant_admin' || role === 'admin_cs' || role === 'admin';
      const { id, messageId } = request.params;
      const { text } = request.body || {};

      if (!text || !text.trim()) {
        return reply.status(400).send({ success: false, error: 'Teks pesan baru tidak boleh kosong.' });
      }

      const owned = await StaffReservationService.assertConversationOwnedByStaffToday(id, staffId, tenantId, isSupervisor);
      if (!owned) {
        return reply.status(403).send({ error: 'Anda tidak memiliki akses ke percakapan ini.' });
      }

      const result = await liveChatService.editMessage({
        conversationId: id,
        messageId,
        newContent: text.trim(),
        tenantId,
        adminName: staffName,
      });

      if (!result.success) {
        return reply.status(400).send({ success: false, error: result.error });
      }

      return reply.status(200).send({ success: true, message: 'Pesan berhasil diperbarui di WhatsApp.' });
    }
  );

  /**
   * GET /api/staff/live-chat/events
   * Server-Sent Events (SSE) stream khusus staff.
   * Melakukan filter server-side: hanya mem-broadcast event percakapan milik staff tersebut hari ini.
   */
  fastify.get('/api/staff/live-chat/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const staffId = (request as any).staffId;
    const role = ((request as any).staffSession?.staff?.role || '').toLowerCase();
    const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;
    const isSupervisor =
      role === 'spv_cs' || role === 'super_admin' || role === 'tenant_admin' || role === 'admin_cs';

    reply.hijack();

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write('retry: 3000\n\n');

    let closed = false;
    let unsubscribe: (() => void) | null = null;

    const sendEvent = async (event: any) => {
      if (closed) return;
      try {
        const conversationId =
          event.payload?.conversationId ||
          event.payload?.conversation_id ||
          event.payload?.id;

        // Server-side filter: hanya kirim event percakapan yang dimiliki staff hari ini (atau semua jika supervisor)
        if (conversationId) {
          const isOwned = await StaffReservationService.assertConversationOwnedByStaffToday(
            conversationId,
            staffId,
            tenantId,
            isSupervisor
          );
          if (!isOwned) return;
        }

        const data = JSON.stringify(event.payload || {});
        reply.raw.write(`event: ${event.type}\ndata: ${data}\n\n`);
      } catch (err: any) {
        console.error('[STAFF LIVE CHAT SSE] Error sending event:', err.message);
      }
    };

    const heartbeat = setInterval(() => {
      if (closed) return;
      try {
        reply.raw.write(': ping\n\n');
      } catch (err) {}
    }, 15000);
    if ((heartbeat as any).unref) (heartbeat as any).unref();

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      if (unsubscribe) unsubscribe();
    };
    request.raw.once('close', cleanup);
    reply.raw.once('close', cleanup);

    try {
      unsubscribe = await getLiveChatHub().subscribe(tenantId, sendEvent);
      if (closed) cleanup();
    } catch (err: any) {
      console.error('[STAFF LIVE CHAT SSE] Subscribe hub failed:', err.message);
      cleanup();
    }
  });
}
