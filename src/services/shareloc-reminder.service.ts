/**
 * shareloc-reminder.service.ts — Service pengingat titik presisi (GPS) otomatis.
 *
 * Menerapkan prinsip fondasional repo:
 * - Anti-hardcode: template diambil dari QuickReply / ClinicPolicy di DB
 * - Multi-tenant & gateway: selalu melalui resolveGatewayForTenant (sadar WAHA/WABA)
 * - Anti-ganda: idempotency_key persis via AdminNotificationLog
 * - Hormati human handling: skip auto-send bila chat sedang dipegang staf
 * - Jam ramah: 08:00 - 19:59 WIB (skip pengiriman malam tanpa menghilangkan status)
 * - Non-destructive: dual-write Conversation.session_data + Customer.preferences (back-compat)
 */

import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { CONFIRMED_FAMILY_STATUSES, activeTreatmentCutoff } from '../domain/reservation-status';
import { getWibNow, formatWibDateYYYYMMDD } from '../utils/wib-time';
import { computeSharelocSignal, isFriendlyHoursWib } from './shareloc-signal.service';
import { resolveGatewayForTenant } from '../integrations/whatsapp/factory';
import { auditService } from './audit.service';
import { getLiveChatHub } from './live-chat-hub.service';
import { buildConversationUpdatedPayload } from './conversation.service';

export interface SharelocSweepResult {
  examined: number;
  needed: number;
  sent: number;
  skipped: number;
  reasons: Record<string, number>;
}

export class SharelocReminderService {
  /**
   * Ambil isi pesan template dari QuickReply shortcut 'shareloc'
   * dengan fallback ke ClinicPolicy topic 'shareloc_request', atau default darurat.
   */
  public async resolveTemplate(tenantId: string, customerName?: string | null): Promise<string> {
    let content: string | null = null;

    try {
      const qr = await (prisma as any).quickReply.findFirst({
        where: { tenant_id: tenantId, shortcut: 'shareloc' },
      });
      if (qr?.content && qr.content.trim()) {
        content = qr.content.trim();
      }
    } catch {
      // DB offline / fallback
    }

    if (!content) {
      try {
        const cp = await (prisma as any).clinicPolicy.findFirst({
          where: { tenant_id: tenantId, topic: 'shareloc_request', is_active: true },
        });
        if (cp?.suggested_reply && cp.suggested_reply.trim()) {
          content = cp.suggested_reply.trim();
        }
      } catch {
        // DB offline / fallback
      }
    }

    if (!content) {
      content =
        'Boleh bantu kirimkan titik lokasi (shareloc WhatsApp) atau seret pin peta di rumah Bunda {name} agar Bidan kami langsung sampai tepat di depan rumah dan tidak tersasar ya Bunda 🙏';
    }

    const name = customerName && customerName.trim() !== '-' ? customerName.trim() : 'Bunda';
    return content.replace(/\{(?:name|nama|nama_bunda)\}/gi, name);
  }

  /**
   * Sapuan berkala untuk mendeteksi dan mengirim pengingat shareloc otomatis.
   * Dikunci di belakang env flag ENABLE_SHARELOC_REMINDER_SWEEP (default false).
   */
  public async sweep(tenantId: string = DEFAULT_TENANT_ID, now: Date = new Date()): Promise<SharelocSweepResult> {
    const result: SharelocSweepResult = {
      examined: 0,
      needed: 0,
      sent: 0,
      skipped: 0,
      reasons: {},
    };

    const countReason = (r: string) => {
      result.reasons[r] = (result.reasons[r] || 0) + 1;
      result.skipped++;
    };

    // 1. Cek flag proteksi auto-send (G0-c)
    if (process.env.ENABLE_SHARELOC_REMINDER_SWEEP !== 'true') {
      countReason('flag_disabled');
      return result;
    }

    // 2. Cek jam ramah (08:00 - 19:59 WIB)
    if (!isFriendlyHoursWib(now)) {
      countReason('outside_friendly_hours');
      return result;
    }

    // 3. Query kandidat reservasi aktif
    const cutoff = activeTreatmentCutoff(now.getTime());
    let reservations: any[] = [];
    try {
      reservations = await (prisma as any).reservation.findMany({
        where: {
          tenant_id: tenantId,
          status: { in: [...CONFIRMED_FAMILY_STATUSES, 'hold'] },
          OR: [{ booking_date: null }, { booking_date: { gte: cutoff } }],
          customer: {
            is_internal_staff: false,
            is_sandbox_test: false,
            deleted_at: null,
          },
        },
        include: {
          customer: true,
        },
        orderBy: { created_at: 'desc' },
        take: 100,
      });
    } catch (err: any) {
      countReason('db_query_failed');
      return result;
    }

    result.examined = reservations.length;
    const nowMs = now.getTime();

    for (const res of reservations) {
      try {
        const cust = res.customer;
        if (!cust || !cust.phone) {
          countReason('missing_customer_or_phone');
          continue;
        }

        // Customer yang sudah presisi tidak perlu diproses
        if ((cust.location_source || '').toLowerCase() === 'gps_pin') {
          countReason('already_gps_pin');
          continue;
        }

        // Ambil percakapan aktif
        const conversation = await (prisma as any).conversation
          .findFirst({
            where: { customer_id: cust.id, tenant_id: tenantId },
            select: { id: true, is_human_handling: true, session_data: true },
          })
          .catch(() => null);

        // Jangan kirim otomatis jika admin sedang aktif menangani chat
        if (conversation?.is_human_handling) {
          countReason('human_handling_active');
          continue;
        }

        const sharelocRequestedAt =
          (conversation?.session_data as any)?.shareloc_requested_at ||
          (cust.preferences as any)?.share_location_requested_at ||
          null;

        const signal = computeSharelocSignal({
          locationSource: cust.location_source,
          shareLocationSent: cust.share_location_sent,
          lat: cust.lat,
          lng: cust.lng,
          reservationStatus: res.status,
          reservationBookingDate: res.booking_date,
          reservationCreatedAt: res.created_at,
          sharelocRequestedAt,
          now,
        });

        if (!signal.needed) {
          countReason(signal.reason || 'not_needed');
          continue;
        }

        result.needed++;

        // G0-b: Untuk same-day, bot otomatis menunggu jeda 1 jam setelah reservasi dibuat
        // (sementara kartu dashboard muncul instan 0 jam).
        if (signal.reason === 'same_day') {
          const resCreatedMs = res.created_at ? new Date(res.created_at).getTime() : nowMs;
          const ageMinutes = (nowMs - resCreatedMs) / 60_000;
          if (ageMinutes < 60) {
            countReason('same_day_bot_wait_1h');
            continue;
          }
        }

        // 4. Kunci idempoten harian via AdminNotificationLog
        const wibDate = formatWibDateYYYYMMDD(getWibNow(now));
        const idempotencyKey = `${tenantId}:SHARELOC:${cust.id}:${wibDate}`;

        const existingClaim = await (prisma as any).adminNotificationLog
          .findUnique({
            where: { idempotency_key: idempotencyKey },
          })
          .catch(() => null);

        if (existingClaim) {
          countReason('already_claimed_today');
          continue;
        }

        try {
          await (prisma as any).adminNotificationLog.create({
            data: {
              tenant_id: tenantId,
              channel: 'SYSTEM',
              recipient: cust.phone,
              notification_type: 'SHARELOC_REMINDER',
              report_date: wibDate,
              idempotency_key: idempotencyKey,
              title: 'Shareloc Reminder Claim',
              message_content: `Reminder shareloc untuk customer ${cust.phone}`,
              status: 'PENDING',
            },
          });
        } catch (err: any) {
          if (err?.code === 'P2002') {
            countReason('idempotency_race');
            continue;
          }
        }

        // 5. Rakit template pesan
        const messageText = await this.resolveTemplate(tenantId, cust.name);

        // 6. Kirim pesan via gateway yang sadar tenant
        const gateway = await resolveGatewayForTenant(tenantId);
        const sendResult = await gateway.sendTextMessage(cust.phone, messageText);

        if (!sendResult.success) {
          countReason('gateway_send_failed');
          continue;
        }

        // 7. Catat waktu permintaan ke state sesi & preferensi
        const nowIso = now.toISOString();
        if (conversation?.id) {
          const currentSession =
            typeof conversation.session_data === 'object' && conversation.session_data !== null
              ? conversation.session_data
              : {};
          await (prisma as any).conversation
            .update({
              where: { id: conversation.id },
              data: {
                session_data: {
                  ...currentSession,
                  shareloc_requested_at: nowIso,
                },
              },
            })
            .catch(() => {});
        }

        const currentPref =
          typeof cust.preferences === 'object' && cust.preferences !== null ? cust.preferences : {};
        await (prisma as any).customer
          .update({
            where: { id: cust.id },
            data: {
              preferences: {
                ...currentPref,
                share_location_requested_at: nowIso,
              },
            },
          })
          .catch(() => {});

        // 8. Update status log menjadi SENT
        await (prisma as any).adminNotificationLog
          .update({
            where: { idempotency_key: idempotencyKey },
            data: { status: 'SENT' },
          })
          .catch(() => {});

        // 9. Audit trail
        await auditService.logAdminAction({
          apiKey: 'SYSTEM_INTERNAL',
          adminIdentity: 'SYSTEM_SHARELOC_REMINDER',
          action: 'SHARELOC_REMINDER_SENT',
          targetId: cust.id,
          payload: {
            reservationId: res.id,
            phone: cust.phone,
            idempotencyKey,
          },
          tenantId,
        });

        // 10. Siarkan perubahan ke SSE Live Chat Hub
        if (conversation?.id) {
          const updatedConv = await (prisma as any).conversation
            .findUnique({
              where: { id: conversation.id },
              include: { customer: true },
            })
            .catch(() => null);

          if (updatedConv) {
            await getLiveChatHub()
              .publish({
                type: 'conversation.updated',
                tenantId,
                payload: buildConversationUpdatedPayload(updatedConv),
              })
              .catch(() => {});
          }
        }

        result.sent++;
      } catch (err: any) {
        countReason('single_item_error');
      }
    }

    return result;
  }
}

export const sharelocReminderService = new SharelocReminderService();
