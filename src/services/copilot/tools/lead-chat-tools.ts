import { prisma } from '../../../db/client';
import { Direction } from '@prisma/client';
import { isDummyOrTestContact } from '../../../utils/dummy-filter';
import { maskPhoneNumber } from '../../../utils/pii-masker';
import { formatWibDateYYYYMMDD, getWibDayName, wibDayBoundsUtc } from '../../../utils/wib-time';
import {
  hasScheduleSignal,
  extractTimeHint,
  extractTimeOfDayHint,
  isScheduleCheckEngagement,
  isScheduleAvailabilityText,
} from '../../../v3/agent/pipeline/medical-signal-detector';
import { hasBookingCommitSignal } from '../../../utils/date-confirmation';
import {
  CopilotTool,
  MAX_ROWS,
  ACTIVE_RESERVATION_STATUSES,
  formatCustomerDisplayName,
  stripCommercialSpam,
} from './types';

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
        customer: { select: { id: true, name: true, phone: true } },
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
      const cust: any = c.customer;
      if (cust && cust.phone && isDummyOrTestContact(cust.phone, cust.name, false)) continue;
      const lastReal = (c as any).messages?.[0];
      if (lastReal && (lastReal.direction as any) === Direction.INBOUND) {
        const nameInfo = formatCustomerDisplayName(cust?.name, cust?.phone);
        rows.push({
          conversationId: c.id,
          customerId: c.customer?.id || null,
          customerName: nameInfo.displayName,
          rawCustomerName: nameInfo.rawName,
          lastMessage: lastReal.content,
          lastInboundAt: lastReal.created_at,
          waitingMinutes: Math.floor((Date.now() - new Date(lastReal.created_at).getTime()) / 60000),
        });
      }
    }
    const summaryFacts = {
      totalUnreplied: rows.length,
      waitingOver15Min: rows.filter((r) => (r.waitingMinutes || 0) >= 15).length,
    };
    return { tool: 'query_unreplied_chats', args, count: rows.length, summaryFacts, rows };
  },
};

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
      const nameInfo = formatCustomerDisplayName(c.name, c.phone);
      rows.push({
        customerId: c.id,
        customerName: nameInfo.displayName,
        rawCustomerName: nameInfo.rawName,
        conversationId: conv?.id || null,
        lastActivityAt: conv?.last_message_at || (c as any).updated_at || null,
      });
    }
    return { tool: 'query_unscheduled_prospects', args, count: rows.length, rows };
  },
};

/**
 * Sinyal minat jadwal dari STATE sesi (bukan keyword pesan):
 * - booking.requestedTimeHint (kata waktu dari customer: "besok", "selasa", dsb.),
 * - booking.preferredDate (tanggal yang dinegosiasikan),
 * - booking.pendingScheduleCheck (sedang menunggu cek slot admin/bidan),
 * - cartItems (layanan terkunci di keranjang yang siap dijadwalkan),
 * - backwards-compatible dengan inquiryDate lama.
 */
export function hasScheduleIntentSignal(sessionData: any, lastDiscussedTreatment: string | null): boolean {
  if (!sessionData || typeof sessionData !== 'object') {
    return Boolean(lastDiscussedTreatment && String(lastDiscussedTreatment).trim());
  }
  const booking = sessionData.booking || {};
  if (booking.requestedTimeHint && String(booking.requestedTimeHint).trim()) return true;
  if (booking.preferredDate && String(booking.preferredDate).trim()) return true;
  if (booking.pendingScheduleCheck === true) return true;
  if (sessionData.inquiryDate && String(sessionData.inquiryDate).trim()) return true;
  if (Array.isArray(sessionData.cartItems) && sessionData.cartItems.length > 0) return true;
  return false;
}

/**
 * Evaluasi kecocokan tanggal yang diminta customer pada sesi dengan filter tanggal admin.
 * Deterministik: cocokkan ISO, kata relatif ("besok"/"hari ini"), atau nama hari — BUKAN
 * substring bebas dua arah (mencegah "sen" cocok dengan "senin" secara keliru).
 */
export function matchesInquiryDate(sessionData: any, targetDate: unknown, now: Date = new Date()): boolean {
  if (!targetDate) return true;
  const target = String(targetDate).trim().toLowerCase();
  if (!target) return true;

  const booking = sessionData?.booking || {};
  const prefDate = String(booking.preferredDate || sessionData?.inquiryDate || '').trim().toLowerCase();
  const timeHint = String(booking.requestedTimeHint || '').trim().toLowerCase();

  const todayStr = formatWibDateYYYYMMDD(now);
  const tomorrowStr = formatWibDateYYYYMMDD(wibDayBoundsUtc(1, now).start);
  const todayDayName = getWibDayName(now).toLowerCase();
  const tomorrowDayName = getWibDayName(wibDayBoundsUtc(1, now).start).toLowerCase();

  // 1. Cocok persis string tanggal (YYYY-MM-DD).
  if (prefDate && prefDate === target) return true;

  // 2. Target = besok (kata / ISO besok / nama hari besok).
  if (target === 'besok' || target === tomorrowStr || target === tomorrowDayName) {
    if (prefDate === tomorrowStr) return true;
    if (matchesDayToken(timeHint, 'besok') || matchesDayToken(timeHint, tomorrowDayName)) return true;
  }

  // 3. Target = hari ini (kata / ISO hari ini / nama hari ini).
  if (target === 'hari ini' || target === todayStr || target === todayDayName) {
    if (prefDate === todayStr) return true;
    if (matchesDayToken(timeHint, 'hari ini') || matchesDayToken(timeHint, todayDayName)) return true;
  }

  // 4. Target nama hari eksplisit (mis. "senin") → cocokkan token hari pada hint.
  if (matchesDayToken(timeHint, target)) return true;

  return false;
}

/** Cocokkan token hari/frasa utuh (word-boundary), bukan substring bebas. */
function matchesDayToken(text: string, token: string): boolean {
  if (!text || !token) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i').test(text);
}

/**
 * Sinyal minat jadwal dari TEKS pesan customer (detektor kanonik pipeline
 * produksi — single source of truth, BUKAN keyword baru):
 * - `isScheduleCheckEngagement`: ack/komitmen/pertanyaan ketersediaan, dan
 * - `hasScheduleSignal` ATAU `isScheduleAvailabilityText` ATAU `extractTimeHint`
 *   ATAU `hasBookingCommitSignal` (petunjuk waktu/hari, "bisa", verba komitmen).
 */
export function hasTextScheduleSignal(text: string): boolean {
  if (!text || !text.trim()) return false;
  const clean = stripCommercialSpam(text);
  if (!clean) return false;
  if (!isScheduleCheckEngagement(clean)) return false;
  return (
    hasScheduleSignal(clean) ||
    isScheduleAvailabilityText(clean) ||
    extractTimeHint(clean) !== null ||
    hasBookingCommitSignal(clean)
  );
}

/**
 * Tool 4: tanya jadwal yang belum booking (stalled inquiry).
 */
export const queryStalledInquiries: CopilotTool = {
  name: 'query_stalled_inquiries',
  description:
    'Daftar pasien yang menanyakan/minta jadwal tapi BELUM booking (tanpa reservasi aktif, ' +
    'belum dibalas admin setelah pesan terakhir). Mendukung filter tanggal bila admin menanyakan hari/tanggal tertentu.',
  parameters: {
    date: { type: 'string', description: 'Tanggal format YYYY-MM-DD (WIB) atau kata relatif ("besok", "hari ini"). Kosong = semua.' },
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
          take: 8,
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

      const msgs: any[] = (c as any).messages || [];
      // Saring dan bersihkan pesan dari spam komersial
      const cleanedMsgs = msgs
        .map((m) => ({
          direction: m.direction,
          content: stripCommercialSpam(m.content || ''),
          created_at: m.created_at,
        }))
        .filter((m) => m.content.length > 0);

      const lastReal = cleanedMsgs[0];
      // Pesan nyata terakhir harus INBOUND (belum dibalas admin) → menggantung.
      if (!lastReal || (lastReal.direction as any) !== Direction.INBOUND) continue;

      // Sinyal jadwal: state sesi ATAU teks pesan customer (detektor kanonik).
      const inboundTexts = cleanedMsgs
        .filter((m) => (m.direction as any) === Direction.INBOUND && typeof m.content === 'string')
        .map((m) => m.content as string);
      const textHint = inboundTexts.map((t) => extractTimeHint(t)).find((h) => h) || null;
      const textSignal = inboundTexts.some((t) => hasTextScheduleSignal(t));
      const stateSignal = hasScheduleIntentSignal(c.session_data, c.last_discussed_treatment);
      if (!stateSignal && !textSignal) continue;

      // Filter tanggal bila admin menanyakan hari/tanggal tertentu — cocokkan
      // dari state sesi ATAU petunjuk waktu teks (reuse matcher kanonik).
      if (args.date) {
        const textSessionLike = textHint ? { booking: { requestedTimeHint: textHint } } : null;
        const dateOk =
          matchesInquiryDate(c.session_data, args.date) ||
          (textSessionLike ? matchesInquiryDate(textSessionLike, args.date) : false);
        if (!dateOk) continue;
      }

      // Jam yang PERNAH ditawarkan admin (dari teks balasan OUTBOUND)
      const offeredTime =
        cleanedMsgs
          .filter((m) => (m.direction as any) === Direction.OUTBOUND && typeof m.content === 'string')
          .map((m) => extractTimeOfDayHint(m.content as string))
          .find((h) => h) || null;

      const booking = (c.session_data as any)?.booking;
      const nameInfo = formatCustomerDisplayName(cust.name, cust.phone);
      rows.push({
        customerId: cust.id,
        customerName: nameInfo.displayName,
        rawCustomerName: nameInfo.rawName,
        conversationId: c.id,
        treatment: c.last_discussed_treatment || null,
        requestedTime: booking?.requestedTimeHint || booking?.preferredDate || textHint || null,
        offeredTime,
        lastMessage: lastReal.content,
        lastInboundAt: lastReal.created_at,
        waitingMinutes: Math.floor((Date.now() - new Date(lastReal.created_at).getTime()) / 60000),
      });
    }
    return { tool: 'query_stalled_inquiries', args, count: rows.length, rows };
  },
};

/**
 * Bentuk penjelasan deterministik dari state DB (murni — mudah diuji).
 */
export function buildConversationExplanation(customer: any, conv: any): any {
  const session = conv?.session_data && typeof conv.session_data === 'object' ? conv.session_data : {};
  const messages: any[] = (conv?.messages || []).slice(0, 5).map((m: any) => ({
    direction: m.direction,
    sender: m.sender_type || (m.direction === Direction.INBOUND ? 'CUSTOMER' : 'BOT'),
    content: typeof m.content === 'string' ? m.content.slice(0, 300) : null,
    at: m.created_at,
  }));

  let statusBot = 'BOT_AKTIF';
  if (conv?.is_human_handling === true || conv?.current_state === 'HUMAN_HANDLING') {
    statusBot = 'DIAMBIL_ALIH_MANUSIA';
  } else if (conv?.current_state === 'COMPLETED') {
    statusBot = 'SELESAI';
  }

  return {
    customerName: customer?.name || 'Bunda',
    phone: maskPhoneNumber(customer?.phone),
    conversationId: conv?.id || null,
    statusBot,
    isHumanHandling: conv?.is_human_handling === true,
    escalationReason: conv?.escalation_reason || null,
    currentState: conv?.current_state || null,
    previousState: conv?.previous_state || null,
    humanHandlingSince: conv?.human_handling_since || null,
    lastActivityAt: conv?.last_message_at || null,
    lastDiscussedTreatment: conv?.last_discussed_treatment || null,
    booking: session.booking || null,
    cartItemCount: Array.isArray(session.cartItems) ? session.cartItems.length : 0,
    pendingLocation: session.pendingLocation || null,
    lastMessages: messages,
  };
}

/**
 * Tool 7: jelaskan status percakapan (explain_conversation_state).
 */
export const explainConversationState: CopilotTool = {
  name: 'explain_conversation_state',
  description:
    'Menjelaskan status satu percakapan: apakah bot masih aktif atau sudah diambil alih manusia ' +
    '(CS/bidan), alasan eskalasi, state mesin bot, waktu, dan 5 pesan terakhir. ' +
    'Gunakan untuk "kenapa nomor X dialihkan ke CS", "kenapa bot diam", "status chat ini".',
  parameters: {
    phone: { type: 'string', description: 'Nomor HP pasien (sebagian). Opsional bila customerName diisi.' },
    customerName: { type: 'string', description: 'Nama pasien (sebagian). Opsional bila phone diisi.' },
  },
  run: async (tenantId, args) => {
    const phone = args.phone ? String(args.phone).trim() : '';
    const name = args.customerName ? String(args.customerName).trim() : '';
    if (!phone && !name) {
      return {
        tool: 'explain_conversation_state',
        args,
        count: 0,
        rows: [],
        note: 'Sebutkan nomor HP atau nama pasien untuk dijelaskan statusnya.',
      };
    }

    const where: any = { tenant_id: tenantId, is_sandbox_test: false };
    if (phone) where.phone = { contains: phone };
    if (name) where.name = { contains: name, mode: 'insensitive' };

    const customers = await prisma.customer.findMany({
      where,
      select: {
        id: true,
        name: true,
        phone: true,
        conversations: {
          orderBy: { last_message_at: 'desc' },
          take: 3,
          select: {
            id: true,
            current_state: true,
            previous_state: true,
            is_human_handling: true,
            human_handling_since: true,
            escalation_reason: true,
            last_message_at: true,
            session_data: true,
            last_discussed_treatment: true,
            messages: {
              where: { sender_type: { not: 'INTERNAL_NOTE' } },
              orderBy: { created_at: 'desc' },
              take: 5,
              select: { direction: true, sender_type: true, content: true, created_at: true },
            },
          },
        },
      },
      orderBy: { updated_at: 'desc' },
      take: 3,
    });

    const rows: any[] = [];
    for (const c of customers as any[]) {
      // Saring kontak dummy/test di level aplikasi (pola nomor tak bisa diindeks DB).
      if (isDummyOrTestContact(c.phone, c.name, false)) continue;
      const convs: any[] = c.conversations || [];
      if (convs.length === 0) {
        rows.push({
          customerName: c.name || 'Bunda',
          phone: maskPhoneNumber(c.phone),
          statusBot: 'BELUM_ADA_PERCAKAPAN',
          statusLabel: 'Belum ada percakapan tercatat.',
          escalationReason: null,
          currentState: null,
          humanHandlingSince: null,
          lastActivityAt: null,
          lastMessages: [],
        });
        continue;
      }
      for (const conv of convs) {
        rows.push(buildConversationExplanation(c, conv));
        if (rows.length >= MAX_ROWS) break;
      }
      if (rows.length >= MAX_ROWS) break;
    }

    return { tool: 'explain_conversation_state', args, count: rows.length, rows };
  },
};
