import { prisma } from '../../db/client';
import { Direction } from '@prisma/client';
import { wibDayBoundsUtc, startOfTodayWib, formatWibDateYYYYMMDD, getWibDayName } from '../../utils/wib-time';
import { isDummyOrTestContact } from '../../utils/dummy-filter';
import { maskPhoneNumber } from '../../utils/pii-masker';
import { hasScheduleSignal, extractTimeHint, isScheduleCheckEngagement, isScheduleAvailabilityText } from '../../v3/agent/pipeline/medical-signal-detector';
import { hasBookingCommitSignal } from '../../utils/date-confirmation';

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

/** Status reservasi "jadwal aktif" — Single Source of Truth di domain/reservation-status. */
import { ACTIVE_RESERVATION_STATUSES } from '../../domain/reservation-status';
export { ACTIVE_RESERVATION_STATUSES };

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
    status: { type: 'string', description: 'confirmed | pending | hold | completed | cancelled. Kosong = jadwal aktif (confirmed/pending/hold).' },
    staffName: { type: 'string', description: 'Nama terapis (sebagian). Kosong = semua.' },
  },
  run: async (tenantId, args) => {
    const where: any = { tenant_id: tenantId };
    // Default (tanpa tanggal valid) = jadwal aktif mendatang, bukan 20 baris tertua.
    where.booking_date = resolveReservationDateFilter(args.date);
    // Default status = jadwal AKTIF; tanpa ini, reservasi cancelled memcemari rekap mendatang.
    if (args.status) {
      where.status = String(args.status);
    } else {
      where.status = { in: ACTIVE_RESERVATION_STATUSES };
    }
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
 * - booking.requestedTimeHint (kata waktu dari customer: "besok", "selasa", dsb.),
 * - booking.preferredDate (tanggal yang dinegosiasikan),
 * - booking.pendingScheduleCheck (sedang menunggu cek slot admin/bidan),
 * - cartItems (layanan terkunci di keranjang yang siap dijadwalkan),
 * - backwards-compatible dengan inquiryDate lama.
 *
 * Catatan anti-overfit: `lastDiscussedTreatment` BUKAN sinyal tunggal — pernah
 * membahas nama treatment di masa lalu tidak sama dengan minat jadwal. Ia hanya
 * dipakai sebagai sinyal bila sesi sudah punya state booking/keranjang (dicek di
 * pemanggil lewat `booking`/`cartItems`), atau saat `sessionData` tak tersedia.
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
 * Menangkap varian nyata seperti "Bsk bisa pijat full body oksi tah?" (singkatan
 * "bsk" + kata ketersediaan "bisa" tanpa kata jadwal eksplisit).
 */
export function hasTextScheduleSignal(text: string): boolean {
  if (!text || !text.trim()) return false;
  if (!isScheduleCheckEngagement(text)) return false;
  return (
    hasScheduleSignal(text) ||
    isScheduleAvailabilityText(text) ||
    extractTimeHint(text) !== null ||
    hasBookingCommitSignal(text)
  );
}

/**
 * Tool 4: tanya jadwal yang belum booking (stalled inquiry).
 *
 * Definisi deterministik (state + riwayat pesan, bukan keyword hafalan):
 * - ada pesan INBOUND dalam `sinceDays` hari terakhir,
 * - ada sinyal minat jadwal — dari state sesi (`requestedTimeHint`/`preferredDate`/
 *   `pendingScheduleCheck`/`cartItems`) ATAU dari teks pesan customer itu sendiri
 *   memakai detektor kanonik `hasScheduleSignal` (dipakai pipeline produksi),
 * - TANPA reservasi aktif (confirmed/pending/hold),
 * - TANPA balasan ADMIN setelah inbound terakhir (masih menggantung),
 * - bila ada parameter `date`, hanya mengambil yang sinyal tanggalnya cocok
 *   (state sesi atau petunjuk waktu dari teks).
 *
 * Akar masalah yang ditutup (2026-09-28): di produksi `session_data.booking` NYARIS
 * TIDAK PERNAH terisi (0 dari 780 percakapan) sehingga recall tool ini = nol.
 * Bukti paling andal & selalu tersedia adalah riwayat pesan → sinyal jadwal diambil
 * dari teks inbound memakai detektor kanonik (bukan keyword baru).
 *
 * Batas jujur: `session_data` JSON tak bisa diindeks DB → filter sinyal di aplikasi
 * (setelah query inbound terbatas). Tenant-scoped, tanpa phone ke LLM.
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
          // Ambil beberapa pesan terakhir: sinyal jadwal bisa muncul di turn
          // customer sebelum balasan bot terakhir (bukan hanya pesan terakhir).
          take: 5,
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
      const lastReal = msgs[0];
      // Pesan nyata terakhir harus INBOUND (belum dibalas admin) → menggantung.
      if (!lastReal || (lastReal.direction as any) !== Direction.INBOUND) continue;

      // Sinyal jadwal: state sesi ATAU teks pesan customer (detektor kanonik).
      const inboundTexts = msgs
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

      const booking = (c.session_data as any)?.booking;
      rows.push({
        customerId: cust.id,
        customerName: cust.name || 'Bunda',
        conversationId: c.id,
        treatment: c.last_discussed_treatment || null,
        requestedTime: booking?.requestedTimeHint || booking?.preferredDate || textHint || null,
        lastMessage: lastReal.content,
        lastInboundAt: lastReal.created_at,
        waitingMinutes: Math.floor((Date.now() - new Date(lastReal.created_at).getTime()) / 60000),
      });
    }
    return { tool: 'query_stalled_inquiries', args, count: rows.length, rows };
  },
};

/**
 * Tool 5: profil & riwayat pasien (kunjungan lampau + catatan admin).
 * Tenant-scoped; nomor HP DISAMARKAN via `maskPhoneNumber` (privasi — nomor mentah
 * tidak pernah sampai ke LLM). Row berkunci `customerName` agar tercakup grounding.
 */
export const getCustomerHistory: CopilotTool = {
  name: 'get_customer_history',
  description:
    'Menarik profil pelanggan beserta riwayat kunjungan lampau dan catatan admin. ' +
    'Gunakan bila admin menanyakan riwayat/preferensi seorang pasien (mis. "Bunda X sebelumnya ambil perawatan apa").',
  parameters: {
    name: { type: 'string', description: 'Nama pelanggan (sebagian).' },
    customerId: { type: 'string', description: 'ID pelanggan bila sudah diketahui (opsional).' },
  },
  run: async (tenantId, args) => {
    const name = args.name ? String(args.name).trim() : '';
    const customerId = args.customerId ? String(args.customerId).trim() : '';
    if (!name && !customerId) {
      return { tool: 'get_customer_history', args, count: 0, rows: [], note: 'Sebutkan nama atau ID pelanggan.' };
    }

    const select = {
      id: true,
      name: true,
      phone: true,
      kecamatan: true,
      kota: true,
      ltv_cache: true,
      admin_notes: true,
      preferences: true,
      reservations: {
        select: { booking_date: true, treatment_detail: true, treatment_category: true, status: true },
        orderBy: { booking_date: 'desc' as const },
        take: 5,
      },
      conversations: { select: { id: true }, orderBy: { last_message_at: 'desc' as const }, take: 1 },
    };

    let customers: any[] = [];
    if (customerId) {
      const one = await prisma.customer.findFirst({ where: { tenant_id: tenantId, id: customerId }, select });
      customers = one ? [one] : [];
    } else {
      customers = await prisma.customer.findMany({
        where: { tenant_id: tenantId, is_sandbox_test: false, name: { contains: name, mode: 'insensitive' } },
        select,
        orderBy: { updated_at: 'desc' },
        take: 3,
      });
    }

    const rows: any[] = [];
    for (const c of customers) {
      if (isDummyOrTestContact(c.phone, c.name, false)) continue;
      const reservations = (c as any).reservations || [];
      const conv = (c as any).conversations?.[0] || null;
      rows.push({
        customerId: c.id,
        customerName: c.name || 'Bunda',
        phone: maskPhoneNumber(c.phone),
        kecamatan: c.kecamatan || null,
        kota: c.kota || null,
        ltvTotal: (c as any).ltv_cache || 0,
        adminNotes: c.admin_notes ? String(c.admin_notes).slice(0, 500) : null,
        preferences: (c as any).preferences || null,
        pastReservationsCount: reservations.length,
        lastVisits: reservations.slice(0, 3).map((r: any) => ({
          date: r.booking_date,
          treatment: r.treatment_detail || r.treatment_category,
          status: r.status,
        })),
        conversationId: conv?.id || null,
      });
    }
    return { tool: 'get_customer_history', args, count: rows.length, rows };
  },
};

/**
 * Tool 6: katalog layanan resmi & SOP/kebijakan klinik (grounding medis).
 * Sumber: `ClinicService` (harga/durasi), `ClinicPolicy` (SOP), `KnowledgeChunk` (FAQ/dokumen).
 * Semua tenant-scoped, `take` dibatasi. Row TANPA `customerName` (bukan entitas pasien).
 */
export const lookupCatalogAndPolicy: CopilotTool = {
  name: 'lookup_catalog_and_policy',
  description:
    'Mencari katalog layanan resmi (harga normal/promo, durasi, usia) dan dokumen SOP/kebijakan klinik ' +
    '(mis. jeda pasca vaksin, penanganan komplain). Gunakan untuk pertanyaan SOP/prosedur/layanan.',
  parameters: {
    query: { type: 'string', description: 'Topik SOP atau nama layanan yang dicari.' },
    type: { type: 'string', description: 'TREATMENT | POLICY | ALL (default ALL).' },
  },
  run: async (tenantId, args) => {
    const q = args.query ? String(args.query).trim() : '';
    const type = (args.type ? String(args.type).toUpperCase() : 'ALL') as 'TREATMENT' | 'POLICY' | 'ALL';
    const like = { contains: q, mode: 'insensitive' as const };

    const wantTreatments = type === 'TREATMENT' || type === 'ALL';
    const wantPolicy = type === 'POLICY' || type === 'ALL';
    const wantKnowledge = type === 'ALL';

    const [services, policies, chunks] = await Promise.all([
      wantTreatments
        ? prisma.clinicService.findMany({
            where: { tenant_id: tenantId, is_active: true, ...(q ? { OR: [{ name: like }, { description: like }] } : {}) },
            take: 8,
          })
        : Promise.resolve([] as any[]),
      wantPolicy
        ? prisma.clinicPolicy.findMany({
            where: { tenant_id: tenantId, is_active: true, ...(q ? { OR: [{ topic: like }, { title: like }, { factual_summary: like }] } : {}) },
            take: 8,
          })
        : Promise.resolve([] as any[]),
      wantKnowledge
        ? prisma.knowledgeChunk.findMany({
            where: { tenant_id: tenantId, ...(q ? { OR: [{ title: like }, { content: like }, { keywords: like }] } : {}) },
            take: 8,
          })
        : Promise.resolve([] as any[]),
    ]);

    const rows: any[] = [];
    for (const s of services as any[]) {
      rows.push({
        kind: 'TREATMENT',
        source: `ClinicService:${s.service_id}`,
        title: s.name,
        category: s.category,
        ageLabel: s.age_label,
        durationMinutes: s.duration_minutes,
        originalPrice: s.original_price,
        promoPrice: s.promo_price,
        body: s.description ? String(s.description).slice(0, 800) : null,
      });
    }
    for (const p of policies as any[]) {
      rows.push({
        kind: 'POLICY',
        source: `ClinicPolicy:${p.topic}`,
        title: p.title,
        body: String(p.factual_summary || '').slice(0, 800),
      });
    }
    for (const k of chunks as any[]) {
      rows.push({
        kind: 'KNOWLEDGE',
        source: `KnowledgeChunk:${k.title}`,
        title: k.title,
        body: String(k.content || '').slice(0, 800),
      });
    }

    return { tool: 'lookup_catalog_and_policy', args, count: Math.min(rows.length, MAX_ROWS), rows: rows.slice(0, MAX_ROWS) };
  },
};

export const COPILOT_TOOLS: CopilotTool[] = [
  queryReservationsByFilter,
  queryUnrepliedChats,
  queryUnscheduledProspects,
  queryStalledInquiries,
  getCustomerHistory,
  lookupCatalogAndPolicy,
];

export function getCopilotTool(name: string): CopilotTool | undefined {
  return COPILOT_TOOLS.find((t) => t.name === name);
}
