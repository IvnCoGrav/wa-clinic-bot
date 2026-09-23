import { prisma } from '../db/client';
import { webPushService } from './web-push.service';
import { StaffReservationService } from './staff-reservation.service';
import { getStaffChatNotificationConfig, isWithinWibHourRange } from '../config/staff-chat-config';

export interface InboundMessageNotificationContext {
  tenantId: string;
  conversationId: string;
  customerId: string;
  senderName: string;
  content?: string;
  payloadRaw?: any;
}

function extractMediaUrl(payloadRaw: any): string | null {
  if (!payloadRaw) return null;
  try {
    const raw = typeof payloadRaw === 'string' ? JSON.parse(payloadRaw) : payloadRaw;
    return (
      raw?.mediaUrl ||
      raw?.media_url ||
      raw?.imageUrl ||
      raw?.image_url ||
      raw?.url ||
      raw?.media?.url ||
      null
    );
  } catch {
    return null;
  }
}

export class InboundNotificationRouter {
  private static instance: InboundNotificationRouter;

  public static getInstance(): InboundNotificationRouter {
    if (!InboundNotificationRouter.instance) {
      InboundNotificationRouter.instance = new InboundNotificationRouter();
    }
    return InboundNotificationRouter.instance;
  }

  /**
   * Merutekan notifikasi pesan masuk customer WhatsApp ke kanal yang tepat secara deterministik:
   * 1. Kanal Admin: Dikirim ke seluruh dashboard/HP admin (role 'ADMIN') via /admin/live-chat.
   * 2. Kanal Staf: HANYA jika customer memiliki jadwal aktif HARI INI yang ditugaskan ke staf,
   *    staf berstatus aktif, dan pesan masuk dalam rentang jam yang diperbolehkan (data-driven dari DB).
   */
  public async routeInboundMessage(ctx: InboundMessageNotificationContext): Promise<void> {
    try {
      const senderName = ctx.senderName || 'Pelanggan';
      const customerId = ctx.customerId || '';

      const avatarUrl = customerId
        ? `/media/avatar/${customerId}.jpg`
        : `https://ui-avatars.com/api/?name=${encodeURIComponent(senderName)}&background=008069&color=fff&size=256&bold=true`;

      const snippet = ctx.content
        ? ctx.content.length > 120
          ? ctx.content.slice(0, 117) + '...'
          : ctx.content
        : '📷 Mengirim lampiran gambar / media';

      const mediaUrl = extractMediaUrl(ctx.payloadRaw);
      const imageUrl = mediaUrl || avatarUrl;

      // -----------------------------------------------------------------------
      // 1. KANAL ADMIN: Broadcast ke semua perangkat role 'ADMIN'
      // -----------------------------------------------------------------------
      void webPushService.sendPushToRole(ctx.tenantId, 'ADMIN', {
        title: senderName,
        body: snippet,
        icon: avatarUrl,
        badge: '/admin/favicon.ico',
        image: imageUrl,
        url: `/admin/live-chat?conversationId=${ctx.conversationId}`,
        tag: `chat-${ctx.conversationId}`,
        data: {
          conversationId: ctx.conversationId,
          customerId,
        },
      }).catch((err) => {
        console.warn('[INBOUND NOTIFICATION ROUTER] Admin push error:', err.message);
      });

      // -----------------------------------------------------------------------
      // 2. KANAL STAF: Targeted push strictly untuk pasien tugas HARI INI
      // -----------------------------------------------------------------------
      if (!customerId) return;

      const { startOfDay, endOfDay } = StaffReservationService.getWibDateRange();

      let assignedReservation: {
        assigned_staff_id: string | null;
        assigned_staff: { id: string; name: string; active: boolean } | null;
      } | null = null;

      try {
        assignedReservation = await prisma.reservation.findFirst({
          where: {
            tenant_id: ctx.tenantId,
            customer_id: customerId,
            status: { notIn: ['cancelled', 'rejected'] },
            assigned_staff_id: { not: null },
            booking_date: { gte: startOfDay, lte: endOfDay },
          },
          select: {
            assigned_staff_id: true,
            assigned_staff: {
              select: { id: true, name: true, active: true },
            },
          },
          orderBy: { booking_date: 'asc' },
        });
      } catch (err: any) {
        // Fallback jika DB offline
        console.warn('[INBOUND NOTIFICATION ROUTER] DB query error checking staff reservation:', err.message);
      }

      if (!assignedReservation?.assigned_staff_id || !assignedReservation.assigned_staff?.active) {
        // Tidak ada jadwal aktif hari ini yang ditugaskan ke staf aktif -> jangan kirim ke staf
        return;
      }

      const assignedStaffId = assignedReservation.assigned_staff_id;

      // Evaluasi jam operasional / permitted hours dari database
      const config = await getStaffChatNotificationConfig(ctx.tenantId);
      if (!config.enabled) {
        return;
      }

      const isAllowedHour = isWithinWibHourRange(config.startHourWib, config.endHourWib);
      if (!isAllowedHour) {
        console.log(
          `[INBOUND NOTIFICATION ROUTER] Message from '${senderName}' arrived outside permitted hours (${config.startHourWib}:00 - ${config.endHourWib}:00 WIB). Skipping staff push notification for staff '${assignedStaffId}'.`
        );
        return;
      }

      // Kirim targeted push notification langsung ke ponsel staf penanggung jawab
      void webPushService.sendPushToStaff(assignedStaffId, ctx.tenantId, {
        title: `💬 Pesan dari ${senderName}`,
        body: snippet,
        icon: avatarUrl,
        badge: '/admin/favicon.ico',
        image: imageUrl,
        url: '/admin/staff/today',
        tag: `staff_chat_${ctx.conversationId}`,
        data: {
          conversationId: ctx.conversationId,
          staffId: assignedStaffId,
          url: '/admin/staff/today',
        },
      }).catch((err) => {
        console.warn(`[INBOUND NOTIFICATION ROUTER] Staff push error for staff '${assignedStaffId}':`, err.message);
      });
    } catch (err: any) {
      console.warn('[INBOUND NOTIFICATION ROUTER] Unexpected routing error:', err.message);
    }
  }
}

export const inboundNotificationRouter = InboundNotificationRouter.getInstance();
