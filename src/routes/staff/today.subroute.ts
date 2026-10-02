import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { StaffReservationService } from '../../services/staff-reservation.service';
import { liveChatService } from '../../services/live-chat.service';
import { auditService } from '../../services/audit.service';
import { getLiveChatHub } from '../../services/live-chat-hub.service';
import {
  staffTripTrackingService,
  evaluateArrivalGeofence,
  calculateDelayStatus,
  calculateTripProgress,
} from '../../services/staff-trip-tracking.service';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { prisma } from '../../db/client';
import { isStaffSupervisorRole } from '../staff.route';
import { sanitizeMessageForStaff, sanitizeStaffHubPayload } from '../../utils/pii-masker';
import { sanitizeCustomerNameForGreeting } from '../../utils/name-sanitizer';
import { ensureStaffSignature } from '../../utils/staff-signature';
import { EN_ROUTE_STATUS } from '../../domain/reservation-status';

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
      const isSupervisor = isStaffSupervisorRole(role);
      const isAdminImpersonation = !!(request as any).staffSession?.isAdminImpersonation;
      let scope: 'mine' | 'all' = 'mine';
      const requestedScope = request.query.scope;
      if (requestedScope === 'all' && isSupervisor) scope = 'all';
      else if (!requestedScope && isAdminImpersonation && isSupervisor) scope = 'all';
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
      const isSupervisor = isStaffSupervisorRole(role);

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
      const isSupervisor = isStaffSupervisorRole(role);

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
      // Masking nomor HP HANYA untuk staf terapis; CS/SPV/supervisor melihat nomor apa adanya.
      const messages = Array.isArray(allMessages)
        ? allMessages.slice(-30).map((m) => sanitizeMessageForStaff(m, { maskPhone: !isSupervisor }))
        : [];
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
          replyToMessageId?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const staffId = (request as any).staffId;
      const staffName = (request as any).staffSession?.staff?.name || 'Staff Terapis';
      const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;
      const { id } = request.params;
      const { text, imageB64, thumbB64, mimeType, fileName, replyToMessageId } = request.body || {};

      const role = ((request as any).staffSession?.staff?.role || '').toLowerCase();
      const isSupervisor = isStaffSupervisorRole(role);

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
      const finalText = ensureStaffSignature(text || '', staffName);

      const result = await liveChatService.sendAdminReply({
        conversationId: id,
        text: finalText,
        imageB64,
        thumbB64,
        mimeType,
        fileName,
        tenantId,
        adminName: staffName,
        replyToMessageId,
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

      // Sanitizer: jangan bocorkan payload mentah ke UI staff (result tidak punya .data, sanitize langsung).
      // Masking HP HANYA untuk terapis; supervisor (CS/SPV) melihat apa adanya.
      const sanitizedResult = result ? sanitizeStaffHubPayload(result as any, 'message.created', { maskPhone: !isSupervisor }) : result;
      return reply.status(200).send({ success: true, data: sanitizedResult });
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
        Querystring: { patientName?: string; etaMinutes?: string; arrivalWib?: string; departMapsUrl?: string };
      }>,
      reply: FastifyReply
    ) => {
      const staffName = (request as any).staffSession?.staff?.name || 'Bidan Terapis';
      const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;
      const rawPatientName = request.query?.patientName || 'Bunda';
      const patientName = sanitizeCustomerNameForGreeting(rawPatientName) || 'Bunda';

      // Plan 2026-09-30: preview = pesan akhir (termasuk blok ETA/lokasi) bila diberikan.
      const etaRaw = Number(request.query?.etaMinutes);
      const etaMinutes = Number.isFinite(etaRaw) && etaRaw > 0 && etaRaw <= 180 ? Math.round(etaRaw) : null;
      const arrivalWib = typeof request.query?.arrivalWib === 'string' && /^\d{2}:\d{2}$/.test(request.query.arrivalWib)
        ? request.query.arrivalWib
        : null;
      const departMapsUrl = typeof request.query?.departMapsUrl === 'string' ? request.query.departMapsUrl : null;

      const text = await StaffReservationService.getOtwMessageText(tenantId, {
        patientName,
        therapistName: staffName,
        etaMinutes,
        arrivalWib,
        departMapsUrl,
      });

      return reply.status(200).send({ success: true, text });
    }
  );

  /**
   * GET /api/staff/arrival-template
   * Mengambil template pesan "Sudah Sampai" siap kirim (nama pasien & terapis terisi).
   * Simetris dengan `otw-template`, agar preview modal terapis identik dengan pesan WA.
   */
  fastify.get(
    '/api/staff/arrival-template',
    async (
      request: FastifyRequest<{
        Querystring: { patientName?: string };
      }>,
      reply: FastifyReply
    ) => {
      const staffName = (request as any).staffSession?.staff?.name || 'Bidan Terapis';
      const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;
      const rawPatientName = request.query?.patientName || 'Bunda';
      const patientName = sanitizeCustomerNameForGreeting(rawPatientName) || 'Bunda';

      const text = await StaffReservationService.getArrivalMessageText(tenantId, {
        patientName,
        therapistName: staffName,
      });

      return reply.status(200).send({ success: true, text });
    }
  );

  /**
   * POST /api/staff/reservations/:id/otw
   * Mengirim notifikasi WhatsApp otomatis bahwa terapis sedang meluncur ke lokasi pasien (OTW).
   *
   * Plan 2026-09-30 (kontrol keberangkatan): body opsional `{ lat, lng, accuracy,
   * etaMinutes, arrivalWib, markEnRoute }` → pesan diperkaya blok estimasi/lokasi +
   * status reservasi dipindah ke `en_route` (dalam transaksi yang sama dengan
   * `otw_sent_at`). Tanpa field ini → perilaku lama PERSIS (kompatibel mundur).
   */
  fastify.post(
    '/api/staff/reservations/:id/otw',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body?: {
          text?: string;
          customText?: string;
          lat?: number;
          lng?: number;
          accuracy?: number;
          etaMinutes?: number;
          arrivalWib?: string;
          markEnRoute?: boolean;
        };
      }>,
      reply: FastifyReply
    ) => {
      const staffId = (request as any).staffId;
      const staffName = (request as any).staffSession?.staff?.name || 'Staff Terapis';
      const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;
      const role = ((request as any).staffSession?.staff?.role || '').toLowerCase();
      const isSupervisor = isStaffSupervisorRole(role);
      const { id } = request.params;
      const customText = request.body?.customText ?? request.body?.text;

      // Validasi opsional data keberangkatan (defensif: nilai aneh diabaikan).
      const body = request.body || {};
      const hasCoords = Number.isFinite(Number(body.lat)) && Number.isFinite(Number(body.lng));
      const departLat = hasCoords ? Number(body.lat) : null;
      const departLng = hasCoords ? Number(body.lng) : null;
      const departMapsUrl =
        departLat != null && departLng != null
          ? `https://maps.google.com/?q=${departLat},${departLng}`
          : null;
      const etaMinutes =
        Number.isFinite(Number(body.etaMinutes)) && Number(body.etaMinutes) > 0 && Number(body.etaMinutes) <= 180
          ? Math.round(Number(body.etaMinutes))
          : null;
      const arrivalWib = typeof body.arrivalWib === 'string' && /^\d{2}:\d{2}$/.test(body.arrivalWib) ? body.arrivalWib : null;
      const markEnRoute = body.markEnRoute === true;

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

      // Cross-tenant guard
      if ((reservation as any).tenant_id !== tenantId) {
        return reply.status(404).send({ success: false, error: 'Reservasi tidak ditemukan.' });
      }

      // Hard guard otorisasi (Anti-IDOR) + fail-closed untuk unassigned
      if (!isSupervisor) {
        const assigned = (reservation as any).assigned_staff_id;
        if (!assigned || assigned !== staffId) {
          return reply.status(403).send({
            success: false,
            error: 'Anda tidak memiliki hak akses untuk mengirim pesan OTW pada jadwal terapis lain.',
          });
        }
      }

      // Cegah pengiriman untuk jadwal selesai/batal (case-insensitive)
      const statusLower = String((reservation as any).status || '').toLowerCase();
      if (['completed', 'cancelled', 'rejected'].includes(statusLower)) {
        return reply.status(400).send({
          success: false,
          error: `Pesan OTW tidak dapat dikirim untuk jadwal berstatus "${(reservation as any).status}".`,
        });
      }

      // Validasi batas waktu (maksimal 2 jam sebelum jam reservasi) — fail-closed bila booking_date null
      if ((reservation as any).booking_date) {
        const bookingTime = new Date((reservation as any).booking_date).getTime();
        const nowTime = Date.now();
        const twoHoursMs = 2 * 60 * 60 * 1000;
        if (!isNaN(bookingTime) && nowTime < bookingTime - twoHoursMs && !isSupervisor) {
          return reply.status(400).send({
            success: false,
            error: 'Pesan OTW hanya dapat dikirim maksimal 2 jam sebelum jam reservasi.',
          });
        }
      } else if (!isSupervisor) {
        return reply.status(400).send({
          success: false,
          error: 'Jadwal belum memiliki waktu booking yang valid.',
        });
      }

      const conversation = (reservation as any).customer?.conversations?.[0];
      if (!conversation) {
        return reply.status(400).send({
          success: false,
          error: 'Belum ada percakapan WhatsApp yang terhubung dengan customer ini.',
        });
      }

      const rawPatientName = (reservation as any).customer?.name || 'Bunda';
      const patientName = sanitizeCustomerNameForGreeting(rawPatientName) || 'Bunda';
      const therapistName = (reservation as any).assigned_staff?.name || staffName;

      let finalText = customText && customText.trim() ? customText.trim() : '';
      if (!finalText) {
        finalText = await StaffReservationService.getOtwMessageText(tenantId, {
          patientName,
          therapistName,
          etaMinutes,
          arrivalWib,
          departMapsUrl,
          departLat,
          departLng,
        });
      } else {
        // Jaring pengaman: teks kustom dari modal terapis tetap wajib bertanda tangan.
        finalText = ensureStaffSignature(finalText, therapistName);
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

      // Persist status OTW + (opsional) pindah status ke `en_route` (dalam 1 update).
      const nextStatus =
        markEnRoute && ['confirmed', 'pending'].includes(statusLower) ? EN_ROUTE_STATUS : undefined;
      await prisma.reservation.update({
        where: { id },
        data: {
          otw_sent_at: new Date(),
          ...(nextStatus ? { status: nextStatus } : {}),
        },
      });

      // Fase 1 (plan 2026-10-02): sambungkan titik keberangkatan Bidan ke memori
      // pemantauan CS. Tanpa ini, peta/motor & sisa km di widget CS kosong.
      // Fail-open: kegagalan tracking TIDAK boleh menggagalkan pengiriman WA OTW.
      if (departLat != null && departLng != null) {
        try {
          const departRecord = staffTripTrackingService.recordTripPing(
            tenantId,
            id,
            staffId,
            { lat: departLat, lng: departLng, accuracy: Number.isFinite(Number(body.accuracy)) ? Number(body.accuracy) : null },
            { arrivalStreak: 0, delayLevel: 'none' }
          );
          getLiveChatHub()
            .publish({
              type: 'staff.telemetry_updated',
              tenantId,
              payload: {
                reservationId: id,
                staffId,
                lat: departRecord.lat,
                lng: departRecord.lng,
                areaName: departRecord.areaName,
                updatedAt: departRecord.updatedAt,
              },
            })
            .catch(() => {});
        } catch (tripErr: any) {
          console.warn('[STAFF OTW] trip ping skipped:', tripErr?.message || tripErr);
        }
      }

      // Audit trail
      await auditService.logAdminAction({
        apiKey: 'STAFF_SESSION',
        adminIdentity: staffName,
        action: 'STAFF_SEND_OTW',
        targetId: id,
        payload: {
          conversationId: conversation.id,
          textPreview: finalText.slice(0, 60),
          enRoute: Boolean(nextStatus),
          etaMinutes,
        },
        ipAddress: request.ip,
        tenantId,
      });

      return reply.status(200).send({
        success: true,
        message: `Pesan OTW berhasil dikirim ke WhatsApp ${patientName}!`,
        data: { ...replyResult, status: nextStatus || (reservation as any).status },
      });
    }
  );

  /**
   * Helper internal: muat reservasi + guard tenant/anti-IDOR untuk rute telemetry.
   * Fail-closed untuk unassigned; supervisor boleh lintas-terapis.
   */
  const loadAuthorizedReservation = async (
    reservationId: string,
    staffId: string,
    tenantId: string,
    isSupervisor: boolean
  ): Promise<{ ok: true; reservation: any } | { ok: false; status: number; error: string }> => {
    if (!reservationId || typeof reservationId !== 'string') {
      return { ok: false, status: 400, error: 'reservationId wajib disertakan.' };
    }
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        customer: { select: { id: true, lat: true, lng: true, name: true } },
        assigned_staff: { select: { name: true } },
      },
    });
    if (!reservation || (reservation as any).tenant_id !== tenantId) {
      return { ok: false, status: 404, error: 'Reservasi tidak ditemukan.' };
    }
    if (!isSupervisor) {
      const assigned = (reservation as any).assigned_staff_id;
      if (!assigned || assigned !== staffId) {
        return { ok: false, status: 403, error: 'Anda tidak memiliki hak akses untuk perjalanan jadwal terapis lain.' };
      }
    }
    return { ok: true, reservation };
  };

  /**
   * POST /api/staff/telemetry
   * Menerima ping GPS berkala dari HP terapis saat OTW (transient, TTL 10 menit).
   * Wajib tenant-scoped + anti-IDOR. Payload < 1 KB.
   */
  fastify.post(
    '/api/staff/telemetry',
    { bodyLimit: 4 * 1024, config: { rateLimit: { max: 40, timeWindow: '1 minute' } } },
    async (
      request: FastifyRequest<{
        Body: { reservationId: string; lat: number; lng: number; speed?: number; heading?: number; accuracy?: number };
      }>,
      reply: FastifyReply
    ) => {
      const staffId = (request as any).staffId;
      const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;
      const role = ((request as any).staffSession?.staff?.role || '').toLowerCase();
      const isSupervisor = isStaffSupervisorRole(role);
      const { reservationId, lat, lng, speed, heading, accuracy } = request.body || {};

      const auth = await loadAuthorizedReservation(reservationId, staffId, tenantId, isSupervisor);
      if (!auth.ok) return reply.status(auth.status).send({ success: false, error: auth.error });

      const statusLower = String((auth.reservation as any).status || '').toLowerCase();
      if (['completed', 'cancelled', 'rejected'].includes(statusLower)) {
        return reply.status(400).send({ success: false, error: 'Perjalanan sudah berakhir untuk jadwal ini.' });
      }

      try {
        const prevRecord = staffTripTrackingService.getTrip(tenantId, reservationId);
        const customerLat = (auth.reservation as any).customer?.lat ?? null;
        const customerLng = (auth.reservation as any).customer?.lng ?? null;
        const patientName = (auth.reservation as any).customer?.name || 'Bunda';
        const therapistName = (auth.reservation as any).assigned_staff?.name || 'Bidan';

        // 1) Geofence kedatangan (dwell) — hanya untuk menghentikan pemancar, bukan
        //    mengubah status kedatangan resmi (arrived_at tetap tombol manual).
        const arrival = evaluateArrivalGeofence(
          Number(lat),
          Number(lng),
          customerLat,
          customerLng,
          accuracy,
          prevRecord?.arrivalStreak ?? 0
        );

        const record = staffTripTrackingService.recordTripPing(
          tenantId,
          reservationId,
          staffId,
          { lat: Number(lat), lng: Number(lng), speed, heading, accuracy },
          { arrivalStreak: arrival.consecutiveCount, delayLevel: prevRecord?.delayLevel ?? 'none' }
        );

        // Broadcast posisi ke CS: hanya payload ringkas (tanpa data pribadi customer).
        getLiveChatHub()
          .publish({
            type: 'staff.telemetry_updated',
            tenantId,
            payload: {
              reservationId,
              staffId,
              lat: record.lat,
              lng: record.lng,
              speed: record.speed,
              heading: record.heading,
              accuracy: record.accuracy,
              areaName: record.areaName,
              updatedAt: record.updatedAt,
            },
          })
          .catch(() => {});

        // 2) Auto-stop: terapis sudah di radius kedatangan → matikan pemancar di HP.
        if (arrival.isArrived) {
          staffTripTrackingService.clearTrip(tenantId, reservationId);
          getLiveChatHub()
            .publish({
              type: 'staff.trip_arrived',
              tenantId,
              payload: {
                reservationId,
                staffId,
                staffName: therapistName,
                patientName,
                distanceM: arrival.distanceM,
              },
            })
            .catch(() => {});
          return reply.status(200).send({
            success: true,
            autoStop: true,
            arrived: true,
            data: { areaName: record.areaName, updatedAt: record.updatedAt, distanceM: arrival.distanceM },
          });
        }

        // 3) Early warning keterlambatan — publish HANYA pada transisi level
        //    (anti-spam: ping tiap 25 dtk tidak boleh membanjiri CS).
        const progress = calculateTripProgress(record.lat, record.lng, customerLat, customerLng);
        const delay = calculateDelayStatus(
          (auth.reservation as any).booking_date ?? null,
          progress?.etaMinutes ?? null
        );
        if (delay.reason === 'OK' && delay.level !== 'none' && delay.level !== record.delayLevel) {
          staffTripTrackingService.recordTripPing(
            tenantId,
            reservationId,
            staffId,
            { lat: Number(lat), lng: Number(lng), speed, heading, accuracy },
            { arrivalStreak: record.arrivalStreak, delayLevel: delay.level }
          );
          getLiveChatHub()
            .publish({
              type: 'staff.trip_delay_warning',
              tenantId,
              payload: {
                reservationId,
                staffId,
                staffName: therapistName,
                patientName,
                level: delay.level,
                delayMinutes: delay.delayMinutes,
                formattedArrivalWib: delay.formattedArrivalWib,
              },
            })
            .catch(() => {});
        }

        return reply.status(200).send({ success: true, data: { areaName: record.areaName, updatedAt: record.updatedAt } });
      } catch (err: any) {
        return reply.status(400).send({ success: false, error: err.message || 'Data telemetry tidak valid.' });
      }
    }
  );

  /**
   * POST /api/staff/trip/stop
   * Mematikan sesi pemantauan perjalanan (privasi) saat terapis tiba/selesai.
   */
  fastify.post(
    '/api/staff/trip/stop',
    { bodyLimit: 4 * 1024 },
    async (
      request: FastifyRequest<{ Body: { reservationId: string } }>,
      reply: FastifyReply
    ) => {
      const staffId = (request as any).staffId;
      const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;
      const role = ((request as any).staffSession?.staff?.role || '').toLowerCase();
      const isSupervisor = isStaffSupervisorRole(role);
      const { reservationId } = request.body || {};

      const auth = await loadAuthorizedReservation(reservationId, staffId, tenantId, isSupervisor);
      if (!auth.ok) return reply.status(auth.status).send({ success: false, error: auth.error });

      const cleared = staffTripTrackingService.clearTrip(tenantId, reservationId);
      getLiveChatHub()
        .publish({ type: 'staff.trip_closed', tenantId, payload: { reservationId, staffId } })
        .catch(() => {});
      return reply.status(200).send({ success: true, data: { cleared } });
    }
  );

  /**
   * POST /api/staff/reservations/:id/arrive
   * Mencatat kedatangan bidan di depan rumah/lokasi pasien (ARRIVED) dan mengirim pesan WA otomatis.
   */
  fastify.post(
    '/api/staff/reservations/:id/arrive',
    async (
      request: FastifyRequest<{
        Params: { id: string };
      }>,
      reply: FastifyReply
    ) => {
      const staffId = (request as any).staffId;
      const staffName = (request as any).staffSession?.staff?.name || 'Bidan Terapis';
      const role = ((request as any).staffSession?.staff?.role || '').toLowerCase();
      const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;
      const isSupervisor = isStaffSupervisorRole(role);
      const { id } = request.params;

      const result = await StaffReservationService.recordArrival({
        reservationId: id,
        staffId,
        tenantId,
        staffName,
        isSupervisor,
      });

      if (!result.success) {
        return reply.status(400).send({ success: false, error: result.error });
      }

      return reply.status(200).send({
        success: true,
        message: 'Status kedatangan berhasil dicatat & pesan telah dikirim ke pasien!',
        data: result.data,
      });
    }
  );

  /**
   * POST /api/staff/reservations/:id/complete
   * Menandai tindakan kunjungan telah selesai dilakukan oleh terapis di lapangan.
   */
  fastify.post(
    '/api/staff/reservations/:id/complete',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body?: { forceUnpaid?: boolean };
      }>,
      reply: FastifyReply
    ) => {
      const staffId = (request as any).staffId;
      const staffName = (request as any).staffSession?.staff?.name || 'Bidan Terapis';
      const role = ((request as any).staffSession?.staff?.role || '').toLowerCase();
      const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;
      const isSupervisor = isStaffSupervisorRole(role);
      const { id } = request.params;
      const forceUnpaid = request.body?.forceUnpaid === true;

      const result = await StaffReservationService.completeTask({
        reservationId: id,
        staffId,
        tenantId,
        staffName,
        isSupervisor,
        forceUnpaid,
      });

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: result.error,
          requiresPayment: result.requiresPayment === true,
          paymentStatus: result.paymentStatus,
        });
      }

      return reply.status(200).send({
        success: true,
        message: 'Kunjungan berhasil diselesaikan!',
        data: result.data,
      });
    }
  );

  /**
   * GET /api/staff/payment-info
   * Mengambil informasi pembayaran resmi klinik (QRIS barcode URL & daftar rekening bank)
   * secara data-driven dari database.
   */
  fastify.get('/api/staff/payment-info', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;
    const paymentInfo = await StaffReservationService.getPaymentInfo(tenantId);
    return reply.status(200).send({ success: true, data: paymentInfo });
  });

  /**
   * POST /api/staff/reservations/:id/send-payment-info
   * Mengirim informasi pembayaran resmi klinik (QRIS & rekening bank)
   * langsung ke nomor WhatsApp customer secara data-driven.
   */
  fastify.post(
    '/api/staff/reservations/:id/send-payment-info',
    async (
      request: FastifyRequest<{
        Params: { id: string };
      }>,
      reply: FastifyReply
    ) => {
      const staffId = (request as any).staffId;
      const staffName = (request as any).staffSession?.staff?.name || 'Bidan Terapis';
      const role = ((request as any).staffSession?.staff?.role || '').toLowerCase();
      const tenantId = (request as any).staffSession?.staff?.tenant_id || DEFAULT_TENANT_ID;
      const isSupervisor = isStaffSupervisorRole(role);
      const { id } = request.params;

      const result = await StaffReservationService.sendPaymentInfo({
        reservationId: id,
        staffId,
        tenantId,
        staffName,
        isSupervisor,
      });

      if (!result.success) {
        return reply.status(400).send({ success: false, error: result.error });
      }

      return reply.status(200).send({
        success: true,
        message: 'Informasi pembayaran & QRIS berhasil dikirim ke WhatsApp pasien!',
        data: result.data,
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
      const isSupervisor = isStaffSupervisorRole(role);
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
      const isSupervisor = isStaffSupervisorRole(role);
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
      const isSupervisor = isStaffSupervisorRole(role);
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
      const isSupervisor = isStaffSupervisorRole(role);
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
    const isSupervisor = isStaffSupervisorRole(role);

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

    const ALLOWED_STAFF_EVENTS = new Set([
      'staff.task_assigned',
      'staff.task_cancelled',
      'customer.location_updated',
      'staff.task_completed',
      'staff.telemetry_updated',
      'staff.trip_closed',
      'message.created',
      'message.updated',
      'message.status_updated',
      'conversation.updated',
    ]);

    const sendEvent = async (event: any) => {
      if (closed) return;
      try {
        if (!event?.type || !ALLOWED_STAFF_EVENTS.has(event.type)) {
          return;
        }

        // Event telemetry: hanya pemilik perjalanan (anti-leak posisi lintas-terapis).
        if (event.type === 'staff.telemetry_updated' || event.type === 'staff.trip_closed') {
          if (!isSupervisor && event.payload?.staffId && event.payload.staffId !== staffId) {
            return;
          }
          const data = JSON.stringify(event.payload || {});
          reply.raw.write(`event: ${event.type}\ndata: ${data}\n\n`);
          return;
        }

        // Event penugasan, pembatalan, lokasi, & penyelesaian reservasi staff internal
        if (event.type === 'staff.task_assigned' || event.type === 'staff.task_cancelled' || event.type === 'customer.location_updated' || event.type === 'staff.task_completed') {
          if (!isSupervisor && event.payload?.staffId && event.payload.staffId !== staffId) {
            return;
          }
          const data = JSON.stringify(event.payload || {});
          reply.raw.write(`event: ${event.type}\ndata: ${data}\n\n`);
          return;
        }

        const conversationId =
          event.payload?.conversationId ||
          event.payload?.conversation_id ||
          event.payload?.id;

        // Server-side filter: hanya kirim event percakapan yang dimiliki staff hari ini (atau semua jika supervisor)
        if (!conversationId) {
          return;
        }

        const isOwned = await StaffReservationService.assertConversationOwnedByStaffToday(
          conversationId,
          staffId,
          tenantId,
          isSupervisor
        );
        if (!isOwned) return;

        // Zero Metadata Leak: sanitasi payload sebelum pancar ke browser.
        // Masking HP HANYA untuk terapis; supervisor (CS/SPV) melihat apa adanya.
        let payloadToSend: any = event.payload || {};
        if (event.type === 'message.created' || event.type === 'message.updated') {
          payloadToSend = sanitizeStaffHubPayload(payloadToSend, event.type, { maskPhone: !isSupervisor });
        }
        // P3-3: id monoton untuk Last-Event-ID replay (gap-tolerant)
        const eventId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const data = JSON.stringify(payloadToSend);
        reply.raw.write(`id: ${eventId}\nevent: ${event.type}\ndata: ${data}\n\n`);
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
