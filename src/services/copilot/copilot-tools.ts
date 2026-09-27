import { prisma } from '../../db/client';
import { Direction } from '@prisma/client';

/**
 * copilot-tools.ts (Fase 6r) — Tools database Copilot Admin (read-only, tenant-scoped).
 *
 * Kontrak fondasional:
 * - Grounding 100% pada hasil query DB. Tool mengembalikan array; LLM DILARANG mengarang.
 * - Window token: `take` dibatasi (default 20) agar tidak meledakkan context window.
 * - Definisi deterministik (state DB), BUKAN pencocokan kata kunci ("harga"/"penawaran").
 * - Semua query tenant-scoped (anti IDOR lintas-tenant).
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

function dayBoundsUtc(dateStr: string): { start: Date; end: Date } {
  // dateStr "YYYY-MM-DD" → batas hari WIB (UTC+7).
  const [y, m, d] = dateStr.split('-').map((n) => parseInt(n, 10));
  const startWibAsUtc = Date.UTC(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
  const endWibAsUtc = Date.UTC(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
  const offset = 7 * 60 * 60 * 1000;
  return { start: new Date(startWibAsUtc - offset), end: new Date(endWibAsUtc - offset) };
}

/** Tool 1: jadwal reservasi berdasarkan filter (tanggal/status/terapis). */
export const queryReservationsByFilter: CopilotTool = {
  name: 'query_reservations_by_filter',
  description:
    'Mengambil daftar reservasi berdasarkan filter tanggal (YYYY-MM-DD, WIB), status, atau nama terapis. ' +
    'Gunakan untuk pertanyaan "jadwal besok", "siapa terapis X hari ini", dsb.',
  parameters: {
    date: { type: 'string', description: 'Tanggal format YYYY-MM-DD (WIB). Kosong = semua tanggal.' },
    status: { type: 'string', description: 'confirmed | pending | hold | completed | cancelled. Kosong = semua.' },
    staffName: { type: 'string', description: 'Nama terapis (sebagian). Kosong = semua.' },
  },
  run: async (tenantId, args) => {
    const where: any = { tenant_id: tenantId };
    if (args.date) {
      const { start, end } = dayBoundsUtc(String(args.date));
      where.booking_date = { gte: start, lte: end };
    }
    if (args.status) where.status = String(args.status);
    if (args.staffName) {
      where.assigned_staff = { name: { contains: String(args.staffName), mode: 'insensitive' } };
    }
    const rows = await prisma.reservation.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
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
    const convs = await prisma.conversation.findMany({
      where: { tenant_id: tenantId },
      include: { customer: { select: { id: true, name: true } } },
      orderBy: { last_message_at: 'desc' },
      take: 200,
    });
    const rows: any[] = [];
    for (const c of convs) {
      if (rows.length >= take) break;
      const lastReal = await prisma.message
        .findFirst({
          where: { conversation_id: c.id, tenant_id: tenantId, sender_type: { not: 'INTERNAL_NOTE' } },
          orderBy: { created_at: 'desc' },
        })
        .catch(() => null);
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

export const COPILOT_TOOLS: CopilotTool[] = [queryReservationsByFilter, queryUnrepliedChats];

export function getCopilotTool(name: string): CopilotTool | undefined {
  return COPILOT_TOOLS.find((t) => t.name === name);
}
