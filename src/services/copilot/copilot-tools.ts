import { prisma } from '../../db/client';
import { Direction } from '@prisma/client';
import { wibDayBoundsUtc, startOfTodayWib } from '../../utils/wib-time';
import { isDummyOrTestContact } from '../../utils/dummy-filter';

/**
 * copilot-tools.ts (Fase 6r + fixing plan) — Tools database Copilot Admin
 * (read-only, tenant-scoped).
 *
 * Kontrak fondasional:
 * - Grounding 100% pada hasil query DB. Tool mengembalikan array; LLM DILARANG mengarang.
 * - Window token: `take` dibatasi (default 20) agar tidak meledakkan context window.
 * - Definisi deterministik (state DB), BUKAN pencocokan kata kunci ("harga"/"penawaran").
 * - Semua query tenant-scoped (anti IDOR lintas-tenant).
 * - Default tanpa tanggal → hanya jadwal AKTIF MENDATANG (anti past-trap).
 */

export interface CopilotToolResult {
  tool: string;
  args: Record<string, any>;
  rows: any[];
  count: number;
  note?: string;
}

export interface CopilotTool {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
  run: (tenantId: string, args: Record<string, any>) => Promise<CopilotToolResult>;
}

const MAX_ROWS = 20;

/** Validasi string tanggal "YYYY-MM-DD" (bukan kalimat bebas dari LLM). */
export function isValidIsoDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return false;
  const d = new Date(`${value.trim()}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

/**
 * Resolusi filter `booking_date` untuk query reservasi (murni, mudah diuji).
 * - tanggal valid → rentang hari WIB tsb
 * - tanpa tanggal / tanggal tidak valid → hanya jadwal aktif mendatang (anti past-trap)
 */
export function resolveReservationDateFilter(
  date: unknown,
  now: Date = new Date()
): { gte: Date; lte?: Date } {
  if (isValidIsoDate(date)) {
    const { start, end } = wibDayBoundsUtc(0, new Date(`${String(date).trim()}T12:00:00Z`));
    return { gte: start, lte: end };
  }
  return { gte: startOfTodayWib(now) };
}

/** Tool 1: jadwal reservasi berdasarkan filter (tanggal/status/terapis). */
export const queryReservationsByFilter: CopilotTool = {
  name: 'query_reservations_by_filter',
  description:
    'Mengambil daftar reservasi berdasarkan filter tanggal (YYYY-MM-DD, WIB), status, atau nama terapis. ' +
    'Gunakan untuk pertanyaan "jadwal besok", "siapa terapis X hari ini", dsb.',
  parameters: {
    date: { type: 'string', description: 'Tanggal format YYYY-MM-DD (WIB). Kosong = jadwal aktif mendatang.' },
    status: { type: 'string', description: 'confirmed | pending | hold | completed | cancelled. Kosong = semua.' },
    staffName: { type: 'string', description: 'Nama terapis (sebagian). Kosong = semua.' },
  },
  run: async (tenantId, args) => {
    const where: any = { tenant_id: tenantId };
    // Default (tanpa tanggal valid) = jadwal aktif mendatang, bukan 20 baris tertua.
    where.booking_date = resolveReservationDateFilter(args.date);
    if (args.status) where.status = String(args.status);
    if (args.staffName) {
      where.assigned_staff = { name: { contains: String(args.staffName), mode: 'insensitive' } };
    }
    const rows = await prisma.reservation.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            // conversationId untuk deep-link Live Chat (1 query, tanpa N+1).
            conversations: {
              select: { id: true },
              orderBy: { last_message_at: 'desc' },
              take: 1,
            },
          },
        },
        assigned_staff: { select: { name: true } },
      },
      orderBy: { booking_date: 'asc' },
      take: MAX_ROWS,
    });
    return {
      tool: 'query_reservations_by_filter',
      args,
      count: rows.length,
      rows: rows.map((r) => ({
        id: r.id,
        customerId: r.customer?.id || null,
        customerName: r.customer?.name || 'Bunda',
        conversationId: r.customer?.conversations?.[0]?.id || null,
        treatment: r.treatment_detail || r.treatment_category,
        bookingDate: r.booking_date,
        status: r.status,
        staff: r.assigned_staff?.name || null,
      })),
    };
  },
};

/** Tool 2: chat yang belum dibalas (state: pesan nyata terakhir INBOUND). */
export const queryUnrepliedChats: CopilotTool = {
  name: 'query_unreplied_chats',
  description:
    'Mengambil daftar percakapan yang pesan terakhirnya dari customer (belum dibalas admin). ' +
    'Gunakan untuk "chat menggantung", "siapa yang belum dibalas".',
  parameters: {
    limit: { type: 'number', description: `Maksimum baris (default ${MAX_ROWS}).` },
  },
  run: async (tenantId, args) => {
    const take = Math.min(Math.max(parseInt(String(args.limit || MAX_ROWS), 10) || MAX_ROWS, 1), MAX_ROWS);
    // Anti-N+1: satu query dengan relasi messages terbatas (take 1) — bukan loop findFirst.
    const convs = await prisma.conversation.findMany({
      where: { tenant_id: tenantId },
      include: {
        customer: { select: { id: true, name: true } },
        messages: {
          where: { sender_type: { not: 'INTERNAL_NOTE' } },
          orderBy: { created_at: 'desc' },
          take: 1,
          select: { direction: true, content: true, created_at: true },
        },
      },
      orderBy: { last_message_at: 'desc' },
      take: 50,
    });
    const rows: any[] = [];
    for (const c of convs) {
      if (rows.length >= take) break;
      const lastReal = (c as any).messages?.[0];
      if (lastReal && (lastReal.direction as any) === Direction.INBOUND) {
        rows.push({
          conversationId: c.id,
          customerId: c.customer?.id || null,
          customerName: c.customer?.name || 'Bunda',
          lastMessage: lastReal.content,
          lastInboundAt: lastReal.created_at,
          waitingMinutes: Math.floor((Date.now() - new Date(lastReal.created_at).getTime()) / 60000),
        });
      }
    }
    return { tool: 'query_unreplied_chats', args, count: rows.length, rows };
  },
};

/** Status reservasi yang dihitung sebagai "jadwal aktif" (menjadwalkan pasien). */
const ACTIVE_RESERVATION_STATUSES = ['confirmed', 'pending', 'hold'];

/**
 * Tool 3: prospek yang BELUM punya jadwal aktif — customer tanpa reservasi
 * berstatus confirmed/pending/hold. Definisi state-based (bukan keyword):
 * mencakup prospek murni maupun yang reservasi lamanya sudah selesai/batal.
 * Kontak sandbox & dummy disaring; nomor HP tidak diteruskan ke LLM (privasi).
 */
export const queryUnscheduledProspects: CopilotTool = {
  name: 'query_unscheduled_prospects',
  description:
    'Daftar customer yang BELUM punya jadwal aktif (tanpa reservasi confirmed/pending/hold). ' +
    'Gunakan untuk pertanyaan "siapa yang belum terjadwal", "prospek yang belum booking", ' +
    '"siapa saja yang belum ada jadwalnya".',
  parameters: {
    limit: { type: 'number', description: `Maksimum baris (default ${MAX_ROWS}).` },
  },
  run: async (tenantId, args) => {
    const take = Math.min(Math.max(parseInt(String(args.limit || MAX_ROWS), 10) || MAX_ROWS, 1), MAX_ROWS);
    const customers = await prisma.customer.findMany({
      where: {
        tenant_id: tenantId,
        is_sandbox_test: false,
        reservations: { none: { status: { in: ACTIVE_RESERVATION_STATUSES } } },
      },
      select: {
        id: true,
        name: true,
        phone: true,
        updated_at: true,
        conversations: {
          select: { id: true, last_message_at: true },
          orderBy: { last_message_at: 'desc' },
          take: 1,
        },
      },
      orderBy: { updated_at: 'desc' },
      take: 100,
    });
    const rows: any[] = [];
    for (const c of customers) {
      if (rows.length >= take) break;
      // Saring kontak dummy/test di level aplikasi (pola nomor tak bisa diindeks DB).
      if (isDummyOrTestContact(c.phone, c.name, false)) continue;
      const conv = (c as any).conversations?.[0] || null;
      rows.push({
        customerId: c.id,
        customerName: c.name || 'Bunda',
        conversationId: conv?.id || null,
        lastActivityAt: conv?.last_message_at || (c as any).updated_at || null,
      });
    }
    return { tool: 'query_unscheduled_prospects', args, count: rows.length, rows };
  },
};

/**
 * Sinyal minat jadwal dari STATE sesi (bukan keyword pesan):
 * inquiryDate (tanggal yang sedang dinegosiasikan) atau cartItems (layanan terkunci).
 * `last_discussed_treatment` (kolom Conversation) juga dipakai sebagai bukti minat.
 */
export function hasScheduleIntentSignal(sessionData: any, lastDiscussedTreatment: string | null): boolean {
  if (lastDiscussedTreatment && String(lastDiscussedTreatment).trim()) return true;
  if (!sessionData || typeof sessionData !== 'object') return false;
  if (sessionData.inquiryDate) return true;
  if (Array.isArray(sessionData.cartItems) && sessionData.cartItems.length > 0) return true;
  return false;
}

/**
 * Tool 4: tanya jadwal yang belum booking (stalled inquiry).
 *
 * Definisi deterministik (state, bukan keyword):
 * - ada pesan INBOUND dalam `sinceDays` hari terakhir,
 * - ada sinyal minat jadwal dari state sesi (`inquiryDate`/`cartItems`/`last_discussed_treatment`),
 * - TANPA reservasi aktif (confirmed/pending/hold),
 * - TANPA balasan ADMIN setelah inbound terakhir (masih menggantung).
 *
 * Batas jujur: `session_data` JSON tak bisa diindeks DB → filter sinyal di aplikasi
 * (setelah query inbound terbatas). Tenant-scoped, tanpa phone ke LLM.
 */
export const queryStalledInquiries: CopilotTool = {
  name: 'query_stalled_inquiries',
  description:
    'Daftar pasien yang menanyakan/minta jadwal tapi BELUM booking (tanpa reservasi aktif, ' +
    'belum dibalas admin setelah pesan terakhir). Gunakan untuk "yang minta dijadwalkan", ' +
    '"belum terjadwal dan minta besok", "siapa yang tanya jadwal tapi belum booking".',
  parameters: {
    sinceDays: { type: 'number', description: 'Jendela hari ke belakang (default 7).' },
    limit: { type: 'number', description: `Maksimum baris (default ${MAX_ROWS}).` },
  },
  run: async (tenantId, args) => {
    const take = Math.min(Math.max(parseInt(String(args.limit || MAX_ROWS), 10) || MAX_ROWS, 1), MAX_ROWS);
    const sinceDays = Math.min(Math.max(parseInt(String(args.sinceDays || 7), 10) || 7, 1), 90);
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

    const convs = await prisma.conversation.findMany({
      where: { tenant_id: tenantId, last_message_at: { gte: since } },
      select: {
        id: true,
        session_data: true,
        last_discussed_treatment: true,
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            reservations: { select: { status: true } },
          },
        },
        messages: {
          where: { sender_type: { not: 'INTERNAL_NOTE' } },
          orderBy: { created_at: 'desc' },
          take: 1,
          select: { direction: true, content: true, created_at: true },
        },
      },
      orderBy: { last_message_at: 'desc' },
      take: 200,
    });

    const rows: any[] = [];
    for (const c of convs) {
      if (rows.length >= take) break;
      const cust: any = c.customer;
      if (!cust) continue;
      if (isDummyOrTestContact(cust.phone, cust.name, false)) continue;

      // Tanpa reservasi aktif → masih prospek.
      const hasActive = (cust.reservations || []).some((r: any) =>
        ACTIVE_RESERVATION_STATUSES.includes(r.status)
      );
      if (hasActive) continue;

      // Sinyal minat jadwal dari state.
      if (!hasScheduleIntentSignal(c.session_data, c.last_discussed_treatment)) continue;

      // Pesan nyata terakhir harus INBOUND (belum dibalas admin) → menggantung.
      const lastReal = (c as any).messages?.[0];
      if (!lastReal || (lastReal.direction as any) !== Direction.INBOUND) continue;

      rows.push({
        customerId: cust.id,
        customerName: cust.name || 'Bunda',
        conversationId: c.id,
        treatment: c.last_discussed_treatment || null,
        lastMessage: lastReal.content,
        lastInboundAt: lastReal.created_at,
        waitingMinutes: Math.floor((Date.now() - new Date(lastReal.created_at).getTime()) / 60000),
      });
    }
    return { tool: 'query_stalled_inquiries', args, count: rows.length, rows };
  },
};

export const COPILOT_TOOLS: CopilotTool[] = [
  queryReservationsByFilter,
  queryUnrepliedChats,
  queryUnscheduledProspects,
  queryStalledInquiries,
];

export function getCopilotTool(name: string): CopilotTool | undefined {
  return COPILOT_TOOLS.find((t) => t.name === name);
}
