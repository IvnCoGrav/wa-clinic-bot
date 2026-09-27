import { prisma } from '../db/client';
import { Direction } from '@prisma/client';
import { formatReportDateWib } from './notification-delivery.service';

/**
 * NightlyWatchdogService (Fase 2r) — laporan pengawasan malam 21:00 WIB.
 *
 * Ekstensi sistem laporan Telegram yang sudah ada (bukan sistem paralel).
 * Kanal via NotificationDeliveryService (Telegram default; WA hanya bila WAHA).
 *
 * PRINSIP: agregasi berbasis STATE DB, BUKAN pencocokan kata kunci.
 * - Jadwal terkonfirmasi besok: Reservasi status confirmed, booking_date = besok WIB.
 * - Tanya jadwal belum booking: ada bukti minat slot (session_data/last_discussed_treatment)
 *   ATAU reservasi pending/hold, TANPA reservasi confirmed.
 * - Chat belum dibalas: definisi kanonis (pesan nyata terakhir INBOUND, bukan INTERNAL_NOTE).
 */

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

export interface NightlyWatchdogData {
  reportDateStr: string;
  unreplied: Array<{ name: string; phone: string; conversationId: string; lastInboundAt: Date | null; waitingMinutes: number }>;
  stalledInquiries: Array<{ name: string; phone: string; conversationId: string; treatment: string | null }>;
  confirmedTomorrow: Array<{ time: string; name: string; treatment: string | null; staff: string | null }>;
  summary: string;
}

function wibDayBoundsUtc(offsetDays = 0): { start: Date; end: Date } {
  const nowWib = new Date(Date.now() + WIB_OFFSET_MS);
  const y = nowWib.getUTCFullYear();
  const m = nowWib.getUTCMonth();
  const d = nowWib.getUTCDate() + offsetDays;
  const startWibAsUtc = Date.UTC(y, m, d, 0, 0, 0, 0);
  const endWibAsUtc = Date.UTC(y, m, d, 23, 59, 59, 999);
  return { start: new Date(startWibAsUtc - WIB_OFFSET_MS), end: new Date(endWibAsUtc - WIB_OFFSET_MS) };
}

function maskPhone(phone: string): string {
  const p = (phone || '').replace(/\D/g, '');
  if (p.length <= 4) return p;
  return `${p.slice(0, 4)}-${p.slice(4, 8)}-${p.slice(-4)}`;
}

function formatWibTime(date: Date | null): string {
  if (!date) return '-';
  const wib = new Date(new Date(date).getTime() + WIB_OFFSET_MS);
  return `${String(wib.getUTCHours()).padStart(2, '0')}:${String(wib.getUTCMinutes()).padStart(2, '0')}`;
}

export class NightlyWatchdogService {
  /** Agregasi 4 kategori laporan malam (state-based). */
  public async generate(tenantId: string): Promise<NightlyWatchdogData> {
    const reportDateStr = formatReportDateWib();
    const tomorrow = wibDayBoundsUtc(1);

    // 1. Jadwal terkonfirmasi besok.
    const confirmedTomorrow: NightlyWatchdogData['confirmedTomorrow'] = [];
    try {
      const rows = await prisma.reservation.findMany({
        where: {
          tenant_id: tenantId,
          status: 'confirmed',
          booking_date: { gte: tomorrow.start, lte: tomorrow.end },
        },
        include: { customer: { select: { name: true } }, assigned_staff: { select: { name: true } } },
        orderBy: { booking_date: 'asc' },
        take: 100,
      });
      for (const r of rows) {
        confirmedTomorrow.push({
          time: formatWibTime(r.booking_date),
          name: r.customer?.name || 'Bunda',
          treatment: r.treatment_detail || r.treatment_category || null,
          staff: r.assigned_staff?.name || null,
        });
      }
    } catch {
      // DB offline → kategori kosong (jangan gagalkan laporan).
    }

    // 2. Chat belum dibalas (state: pesan nyata terakhir INBOUND, belum dibalas).
    const unreplied: NightlyWatchdogData['unreplied'] = [];
    try {
      const convs = await prisma.conversation.findMany({
        where: { tenant_id: tenantId },
        include: { customer: { select: { name: true, phone: true } } },
        orderBy: { last_message_at: 'desc' },
        take: 200,
      });
      for (const c of convs) {
        const lastReal = await prisma.message
          .findFirst({
            where: { conversation_id: c.id, tenant_id: tenantId, sender_type: { not: 'INTERNAL_NOTE' } },
            orderBy: { created_at: 'desc' },
          })
          .catch(() => null);
        if (lastReal && (lastReal.direction as any) === Direction.INBOUND) {
          const waitingMinutes = Math.floor((Date.now() - new Date(lastReal.created_at).getTime()) / 60000);
          unreplied.push({
            name: c.customer?.name || 'Bunda',
            phone: c.customer?.phone || '',
            conversationId: c.id,
            lastInboundAt: lastReal.created_at as any,
            waitingMinutes,
          });
        }
      }
      unreplied.sort((a, b) => b.waitingMinutes - a.waitingMinutes);
    } catch {
      // DB offline.
    }

    // 3. Tanya jadwal belum booking (bukti minat slot, tanpa reservasi confirmed).
    const stalledInquiries: NightlyWatchdogData['stalledInquiries'] = [];
    try {
      const today = wibDayBoundsUtc(0);
      const convs = await prisma.conversation.findMany({
        where: {
          tenant_id: tenantId,
          last_message_at: { gte: today.start, lte: today.end },
        },
        include: { customer: { select: { name: true, phone: true, reservations: { select: { status: true } } } } },
        take: 200,
      });
      for (const c of convs) {
        const reservations = c.customer?.reservations || [];
        const hasConfirmed = reservations.some((r) => r.status === 'confirmed');
        if (hasConfirmed) continue;
        const hasPendingOrHold = reservations.some((r) => r.status === 'pending' || r.status === 'hold');
        const session = (c.session_data as any) || {};
        const hasInquiryEvidence = Boolean(session.inquiryDate || session.cartItems?.length) || Boolean(c.last_discussed_treatment);
        if (hasPendingOrHold || hasInquiryEvidence) {
          stalledInquiries.push({
            name: c.customer?.name || 'Bunda',
            phone: c.customer?.phone || '',
            conversationId: c.id,
            treatment: c.last_discussed_treatment || null,
          });
        }
      }
    } catch {
      // DB offline.
    }

    return {
      reportDateStr,
      unreplied,
      stalledInquiries,
      confirmedTomorrow,
      summary: this.buildSummary(unreplied.length, stalledInquiries.length, confirmedTomorrow.length),
    };
  }

  private buildSummary(unreplied: number, stalled: number, confirmed: number): string {
    return (
      `Chat belum dibalas: ${unreplied}. ` +
      `Tanya jadwal belum booking: ${stalled}. ` +
      `Jadwal terkonfirmasi besok: ${confirmed}.`
    );
  }

  /** Format pesan WhatsApp/Telegram (nomor HP di-mask — privasi). */
  public formatMessage(tenantName: string, data: NightlyWatchdogData, dashboardUrl: string): string {
    const lines: string[] = [];
    lines.push('🌙 LAPORAN MALAM OPERASIONAL KLINIK');
    lines.push(`📅 ${data.reportDateStr} (21:00 WIB) — ${tenantName}`);
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━');

    lines.push(`🚨 CHAT BELUM DIBALAS (${data.unreplied.length} Pasien)`);
    data.unreplied.slice(0, 10).forEach((u, i) => {
      lines.push(`${i + 1}. ${u.name} (${maskPhone(u.phone)}) — menunggu ${u.waitingMinutes} menit`);
      lines.push(`   🔗 ${dashboardUrl}/admin/live-chat?conversationId=${u.conversationId}`);
    });
    if (data.unreplied.length === 0) lines.push('• Tidak ada.');

    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(`⚠️ TANYA JADWAL BELUM BOOKING (${data.stalledInquiries.length} Pasien)`);
    data.stalledInquiries.slice(0, 10).forEach((s, i) => {
      lines.push(`${i + 1}. ${s.name} (${maskPhone(s.phone)})${s.treatment ? ` — ${s.treatment}` : ''}`);
      lines.push(`   🔗 ${dashboardUrl}/admin/live-chat?conversationId=${s.conversationId}`);
    });
    if (data.stalledInquiries.length === 0) lines.push('• Tidak ada.');

    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(`✅ JADWAL TERKONFIRMASI BESOK (${data.confirmedTomorrow.length} Pasien)`);
    data.confirmedTomorrow.slice(0, 20).forEach((c, i) => {
      lines.push(`${i + 1}. ${c.time} WIB — ${c.name}${c.treatment ? ` (${c.treatment})` : ''}${c.staff ? ` — ${c.staff}` : ''}`);
    });
    if (data.confirmedTomorrow.length === 0) lines.push('• Tidak ada.');

    return lines.join('\n');
  }
}

export const nightlyWatchdogService = new NightlyWatchdogService();
