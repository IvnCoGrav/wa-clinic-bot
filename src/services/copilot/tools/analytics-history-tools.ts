import { prisma } from '../../../db/client';
import { Direction } from '@prisma/client';
import { isDummyOrTestContact } from '../../../utils/dummy-filter';
import { maskPhoneNumber } from '../../../utils/pii-masker';
import { formatWibDateYYYYMMDD, formatWibTime, wibDayBoundsUtc, WIB_OFFSET_MS } from '../../../utils/wib-time';
import { isReservationPaid } from '../../../domain/reservation-payment';
import { CopilotTool, MAX_ROWS, isValidIsoDate, formatCustomerDisplayName } from './types';

/**
 * Tool 5: profil & riwayat pasien (kunjungan lampau + catatan admin).
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
      const nameInfo = formatCustomerDisplayName(c.name, c.phone);
      rows.push({
        customerId: c.id,
        customerName: nameInfo.displayName,
        rawCustomerName: nameInfo.rawName,
        phone: maskPhoneNumber(c.phone),
        kecamatan: c.kecamatan || null,
        kota: c.kota || null,
        ltvTotal: (c as any).ltv_cache || 0,
        adminNotes: c.admin_notes ? String(c.admin_notes).slice(0, 500) : null,
        preferences: (c as any).preferences || null,
        pastReservationsCount: reservations.length,
        lastVisits: reservations.slice(0, 3).map((r: any) => {
          const visitDate = r.booking_date ? new Date(r.booking_date) : null;
          return {
            dateWib: visitDate ? formatWibDateYYYYMMDD(visitDate) : null,
            timeWib: visitDate ? formatWibTime(visitDate) : null,
            treatment: r.treatment_detail || r.treatment_category,
            status: r.status,
          };
        }),
        conversationId: conv?.id || null,
      });
    }
    return { tool: 'get_customer_history', args, count: rows.length, rows };
  },
};

/**
 * Tokenisasi query bahasa alami menjadi kata kunci generik (murni, deterministik).
 */
export function extractSearchTokens(query: string, maxTokens = 8): string[] {
  const tokens = String(query || '').toLowerCase().match(/[a-z]{4,}/g) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
      if (out.length >= maxTokens) break;
    }
  }
  return out;
}

/**
 * Bangun klausa OR Prisma untuk pencarian teks.
 */
export function buildTextSearchOr(fields: string[], query: string): any[] {
  const q = String(query || '').trim();
  const likes: string[] = [];
  if (q) likes.push(q);
  for (const t of extractSearchTokens(q)) {
    if (!likes.some((l) => l.toLowerCase() === t)) likes.push(t);
  }
  const or: any[] = [];
  for (const f of fields) {
    for (const l of likes) {
      or.push({ [f]: { contains: l, mode: 'insensitive' as const } });
    }
  }
  return or;
}

export type MatchQuality = 'exact' | 'partial' | 'none';

/**
 * Peringkat deterministik katalog & kebijakan.
 */
export function rankCatalogAndPolicyRows(rows: any[], query: string): any[] {
  const q = String(query || '').trim().toLowerCase();
  if (!q) {
    return rows.map((r) => ({ ...r, matchQuality: 'none' as MatchQuality }));
  }

  const tokens = extractSearchTokens(q).filter((t) => t.length >= 2);

  const scored = rows.map((row) => {
    const title = String(row.title || '').toLowerCase();
    const body = String(row.body || '').toLowerCase();

    let score = 0;
    let matchQuality: MatchQuality = 'none';

    // 1. Frasa persis di judul (skor tertinggi)
    if (title.includes(q)) {
      score += 1000;
      matchQuality = 'exact';
    } else if (body.includes(q)) {
      score += 500;
      matchQuality = 'exact';
    }

    // 2. Jumlah kata cocok unik
    let matchingTokensInTitle = 0;
    let matchingTokensInBody = 0;
    for (const t of tokens) {
      if (title.includes(t)) matchingTokensInTitle++;
      else if (body.includes(t)) matchingTokensInBody++;
    }

    const totalMatchingTokens = matchingTokensInTitle + matchingTokensInBody;
    score += matchingTokensInTitle * 100 + matchingTokensInBody * 25;

    // Bonus jika SEMUA kata pencarian cocok
    if (tokens.length > 1 && totalMatchingTokens >= tokens.length) {
      score += 300;
      if (matchQuality === 'none') {
        matchQuality = matchingTokensInTitle === tokens.length ? 'exact' : 'partial';
      }
    } else if (totalMatchingTokens > 0 && matchQuality === 'none') {
      matchQuality = 'partial';
    }

    // 3. Posisi kecocokan di judul (makin di depan makin relevan)
    const titlePos = title.indexOf(q);
    if (titlePos >= 0) {
      score += Math.max(0, 50 - titlePos);
    } else if (tokens.length > 0) {
      const firstTokenPos = title.indexOf(tokens[0]);
      if (firstTokenPos >= 0) {
        score += Math.max(0, 30 - firstTokenPos);
      }
    }

    return { row: { ...row, matchQuality }, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.row);
}

/**
 * Tool 6: katalog layanan resmi & SOP/kebijakan klinik (grounding medis).
 */
export const lookupCatalogAndPolicy: CopilotTool = {
  name: 'lookup_catalog_and_policy',
  description:
    'Mencari katalog layanan resmi (harga normal/promo, durasi, usia) dan dokumen SOP/kebijakan klinik ' +
    '(mis. jeda pasca vaksin, penanganan komplain). Terima pertanyaan kalimat alami; query dipecah otomatis. ' +
    'Gunakan untuk pertanyaan SOP/prosedur/layanan.',
  parameters: {
    query: { type: 'string', description: 'Topik SOP atau nama layanan; boleh kalimat alami.' },
    type: { type: 'string', description: 'TREATMENT | POLICY | ALL (default ALL).' },
  },
  run: async (tenantId, args) => {
    const q = args.query ? String(args.query).trim() : '';
    const type = (args.type ? String(args.type).toUpperCase() : 'ALL') as 'TREATMENT' | 'POLICY' | 'ALL';

    const wantTreatments = type === 'TREATMENT' || type === 'ALL';
    const wantPolicy = type === 'POLICY' || type === 'ALL';
    const wantKnowledge = type === 'ALL';

    const [services, policies, chunks] = await Promise.all([
      wantTreatments
        ? prisma.clinicService.findMany({
            where: { tenant_id: tenantId, is_active: true, ...(q ? { OR: buildTextSearchOr(['name', 'description'], q) } : {}) },
            take: 60,
          }).catch(() => [])
        : Promise.resolve([] as any[]),
      wantPolicy
        ? prisma.clinicPolicy.findMany({
            where: { tenant_id: tenantId, is_active: true, ...(q ? { OR: buildTextSearchOr(['topic', 'title', 'factual_summary'], q) } : {}) },
            take: 30,
          }).catch(() => [])
        : Promise.resolve([] as any[]),
      wantKnowledge
        ? prisma.knowledgeChunk.findMany({
            where: { tenant_id: tenantId, ...(q ? { OR: buildTextSearchOr(['title', 'content', 'keywords'], q) } : {}) },
            take: 30,
          }).catch(() => [])
        : Promise.resolve([] as any[]),
    ]);

    const rawRows: any[] = [];
    for (const s of (services || []) as any[]) {
      rawRows.push({
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
    for (const p of (policies || []) as any[]) {
      rawRows.push({
        kind: 'POLICY',
        source: `ClinicPolicy:${p.topic}`,
        title: p.title,
        body: String(p.factual_summary || '').slice(0, 800),
      });
    }
    for (const k of (chunks || []) as any[]) {
      rawRows.push({
        kind: 'KNOWLEDGE',
        source: `KnowledgeChunk:${k.title}`,
        title: k.title,
        body: String(k.content || '').slice(0, 800),
      });
    }

    const rankedRows = rankCatalogAndPolicyRows(rawRows, q);

    return {
      tool: 'lookup_catalog_and_policy',
      args,
      count: Math.min(rankedRows.length, MAX_ROWS),
      rows: rankedRows.slice(0, MAX_ROWS),
    };
  },
};

const STATS_MESSAGE_PAGE = 5_000;
const STATS_CONV_PAGE = 2_000;
const STATS_MAX_PAGES = 20;

/**
 * Tool 8: agregasi statistik pesan chat (query_chat_stats).
 */
export const queryChatStats: CopilotTool = {
  name: 'query_chat_stats',
  description:
    'Mengambil agregasi statistik pesan chat (inbound/outbound) dan percakapan dalam rentang waktu. ' +
    'Gunakan untuk menjawab: "berapa chat hari ini", "chat per jam", "berapa percakapan baru minggu ini". ' +
    'Mengembalikan maksimal 31 bucket harian (atau 24 bucket jam) TERBARU dari rentang yang diminta. ' +
    'Bila hasil lebih dari satu bucket, baris terakhir bucket="TOTAL" berisi agregat seluruh rentang — ' +
    'pakai angka TOTAL itu untuk pertanyaan total, JANGAN menjumlahkan bucket sendiri.',
  parameters: {
    dateFrom: { type: 'string', description: 'Tanggal awal rentang WIB (YYYY-MM-DD). Default hari ini.' },
    dateTo: { type: 'string', description: 'Tanggal akhir rentang WIB (YYYY-MM-DD). Default sama dengan dateFrom.' },
    groupBy: { type: 'string', description: 'Pengelompokan: "day" (per hari) atau "hour" (per jam). Default "day".' },
  },
  run: async (tenantId, args) => {
    const todayStr = formatWibDateYYYYMMDD();
    const dFromStr = isValidIsoDate(args.dateFrom) ? String(args.dateFrom).trim() : todayStr;
    const dToStr = isValidIsoDate(args.dateTo) ? String(args.dateTo).trim() : dFromStr;

    const startUtc = wibDayBoundsUtc(0, new Date(`${dFromStr}T12:00:00Z`)).start;
    const endUtc = wibDayBoundsUtc(0, new Date(`${dToStr}T12:00:00Z`)).end;
    const groupBy = args.groupBy === 'hour' ? 'hour' : 'day';
    const maxBuckets = groupBy === 'hour' ? 24 : 31;
    const maxRangeMs = maxBuckets * 24 * 60 * 60 * 1000;
    const effectiveStartUtc =
      endUtc.getTime() - startUtc.getTime() > maxRangeMs
        ? new Date(endUtc.getTime() - maxRangeMs)
        : startUtc;

    const messages: Array<{ direction: any; created_at: Date; conversation_id: string | null }> = [];
    let messageCursor: string | undefined;
    for (let page = 0; page < STATS_MAX_PAGES; page++) {
      const batch = await prisma.message.findMany({
        where: {
          tenant_id: tenantId,
          created_at: { gte: effectiveStartUtc, lte: endUtc },
          conversation: { customer: { is_sandbox_test: false } },
        },
        select: {
          id: true,
          direction: true,
          created_at: true,
          conversation_id: true,
        },
        orderBy: { id: 'asc' },
        take: STATS_MESSAGE_PAGE,
        ...(messageCursor ? { cursor: { id: messageCursor }, skip: 1 } : {}),
      });
      messages.push(...batch);
      if (batch.length < STATS_MESSAGE_PAGE) break;
      messageCursor = batch[batch.length - 1].id;
    }

    const conversations: Array<{ id: string; created_at: Date; is_human_handling: boolean; is_frustrated: boolean }> = [];
    let convCursor: string | undefined;
    for (let page = 0; page < STATS_MAX_PAGES; page++) {
      const batch = await prisma.conversation.findMany({
        where: {
          tenant_id: tenantId,
          created_at: { gte: effectiveStartUtc, lte: endUtc },
          customer: { is_sandbox_test: false },
        },
        select: {
          id: true,
          created_at: true,
          is_human_handling: true,
          is_frustrated: true,
        },
        orderBy: { id: 'asc' },
        take: STATS_CONV_PAGE,
        ...(convCursor ? { cursor: { id: convCursor }, skip: 1 } : {}),
      });
      conversations.push(...batch);
      if (batch.length < STATS_CONV_PAGE) break;
      convCursor = batch[batch.length - 1].id;
    }

    const bucketsMap = new Map<string, {
      bucket: string;
      inboundMessages: number;
      outboundMessages: number;
      newConversations: number;
      activeConvIds: Set<string>;
      humanHandling: number;
      frustrated: number;
    }>();

    const getBucketKey = (d: Date): string => {
      if (groupBy === 'hour') {
        const wib = new Date(d.getTime() + WIB_OFFSET_MS);
        return `${formatWibDateYYYYMMDD(d)} ${String(wib.getUTCHours()).padStart(2, '0')}:00`;
      }
      return formatWibDateYYYYMMDD(d);
    };

    const getOrCreateBucket = (key: string) => {
      let b = bucketsMap.get(key);
      if (!b) {
        b = {
          bucket: key,
          inboundMessages: 0,
          outboundMessages: 0,
          newConversations: 0,
          activeConvIds: new Set<string>(),
          humanHandling: 0,
          frustrated: 0,
        };
        bucketsMap.set(key, b);
      }
      return b;
    };

    const allActiveConvIds = new Set<string>();
    for (const m of messages) {
      const b = getOrCreateBucket(getBucketKey(new Date(m.created_at)));
      if ((m.direction as any) === Direction.INBOUND) {
        b.inboundMessages++;
      } else {
        b.outboundMessages++;
      }
      if (m.conversation_id) {
        b.activeConvIds.add(m.conversation_id);
        allActiveConvIds.add(m.conversation_id);
      }
    }

    for (const c of conversations) {
      const b = getOrCreateBucket(getBucketKey(new Date(c.created_at)));
      b.newConversations++;
      if (c.is_human_handling) b.humanHandling++;
      if (c.is_frustrated) b.frustrated++;
    }

    const sortedKeys = Array.from(bucketsMap.keys()).sort();
    const keptKeys = sortedKeys.length > maxBuckets ? sortedKeys.slice(-maxBuckets) : sortedKeys;
    const rows = keptKeys.map((k) => {
      const b = bucketsMap.get(k)!;
      return {
        bucket: b.bucket,
        inboundMessages: b.inboundMessages,
        outboundMessages: b.outboundMessages,
        newConversations: b.newConversations,
        activeConversations: b.activeConvIds.size,
        humanHandling: b.humanHandling,
        frustrated: b.frustrated,
      };
    });

    if (rows.length === 0) {
      rows.push({
        bucket: dFromStr,
        inboundMessages: 0,
        outboundMessages: 0,
        newConversations: 0,
        activeConversations: 0,
        humanHandling: 0,
        frustrated: 0,
      });
    } else if (rows.length > 1) {
      rows.push({
        bucket: 'TOTAL',
        inboundMessages: rows.reduce((s, r) => s + r.inboundMessages, 0),
        outboundMessages: rows.reduce((s, r) => s + r.outboundMessages, 0),
        newConversations: rows.reduce((s, r) => s + r.newConversations, 0),
        activeConversations: allActiveConvIds.size,
        humanHandling: rows.reduce((s, r) => s + r.humanHandling, 0),
        frustrated: rows.reduce((s, r) => s + r.frustrated, 0),
      });
    }

    return { tool: 'query_chat_stats', args, count: rows.length, rows };
  },
};

/**
 * Tool 9: rekap omzet/pendapatan (query_revenue).
 */
export const queryRevenue: CopilotTool = {
  name: 'query_revenue',
  description:
    'Mengambil rekap omzet/pendapatan dari reservasi klinik (jasa, ongkir, diskon, kuitansi terpisah). ' +
    'Gunakan untuk menjawab: "omzet minggu ini", "omzet per treatment", "berapa yang sudah dibayar". ' +
    'basis = booking_date (tanggal treatment), BUKAN tanggal pembayaran. ' +
    'Bila hasil lebih dari satu bucket, baris terakhir bucket="TOTAL" berisi agregat — pakai itu untuk total.',
  parameters: {
    dateFrom: { type: 'string', description: 'Tanggal awal rentang WIB (YYYY-MM-DD).' },
    dateTo: { type: 'string', description: 'Tanggal akhir rentang WIB (YYYY-MM-DD).' },
    groupBy: { type: 'string', description: 'Pengelompokan: "day" | "treatment" | "staff". Default "day".' },
    status: { type: 'string', description: 'Status reservasi: "completed" | "confirmed" | "all". Default "completed".' },
  },
  run: async (tenantId, args) => {
    const dFromStr = isValidIsoDate(args.dateFrom) ? String(args.dateFrom).trim() : undefined;
    const dToStr = isValidIsoDate(args.dateTo) ? String(args.dateTo).trim() : dFromStr;

    const where: any = {
      tenant_id: tenantId,
      customer: { is_sandbox_test: false },
    };

    if (dFromStr) {
      const startUtc = wibDayBoundsUtc(0, new Date(`${dFromStr}T12:00:00Z`)).start;
      const endUtc = wibDayBoundsUtc(0, new Date(`${dToStr}T12:00:00Z`)).end;
      where.booking_date = { gte: startUtc, lte: endUtc };
    }

    const st = String(args.status || 'completed').toLowerCase();
    if (st === 'confirmed') {
      where.status = 'confirmed';
    } else if (st === 'all') {
      where.status = { in: ['completed', 'confirmed'] };
    } else {
      where.status = 'completed';
    }

    const reservations = await prisma.reservation.findMany({
      where,
      include: {
        assigned_staff: { select: { id: true, name: true } },
      },
      orderBy: { booking_date: 'asc' },
      take: 1000,
    });

    const groupBy = ['treatment', 'staff'].includes(String(args.groupBy || '')) ? String(args.groupBy) : 'day';

    const bucketsMap = new Map<string, {
      bucket: string;
      reservations: number;
      purchaseValue: number;
      deliveryFee: number;
      discount: number;
      receiptAmount: number;
      lunasRevenue: number;
      pendingRevenue: number;
      totalRevenue: number;
    }>();

    for (const r of reservations) {
      let key = 'Semua';
      if (groupBy === 'day') {
        key = r.booking_date ? formatWibDateYYYYMMDD(new Date(r.booking_date)) : 'Tanpa Tanggal';
      } else if (groupBy === 'treatment') {
        key = (r.treatment_detail || String(r.treatment_category || 'Lainnya')).trim();
      } else if (groupBy === 'staff') {
        key = r.assigned_staff?.name || 'Belum Ditugaskan';
      }

      let b = bucketsMap.get(key);
      if (!b) {
        b = {
          bucket: key,
          reservations: 0,
          purchaseValue: 0,
          deliveryFee: 0,
          discount: 0,
          receiptAmount: 0,
          lunasRevenue: 0,
          pendingRevenue: 0,
          totalRevenue: 0,
        };
        bucketsMap.set(key, b);
      }

      const pVal = r.purchase_value || 0;
      const dFee = r.delivery_fee || 0;
      const totalFee = pVal + dFee;
      const isLunas = isReservationPaid(r);

      b.reservations++;
      b.purchaseValue += pVal;
      b.deliveryFee += dFee;
      b.discount += r.discount_amount || 0;
      b.receiptAmount += r.receipt_amount || 0;
      b.totalRevenue += totalFee;
      if (isLunas) {
        b.lunasRevenue += totalFee;
      } else {
        b.pendingRevenue += totalFee;
      }
    }

    const allBuckets = Array.from(bucketsMap.values()).map((b) => {
      const netRevenue = (b.purchaseValue || 0) + (b.deliveryFee || 0) - (b.discount || 0);
      const paidAmount = b.lunasRevenue;
      const pendingAmount = b.pendingRevenue;
      return {
        ...b,
        netRevenue,
        paidAmount,
        pendingAmount,
        basis: 'booking_date' as const,
      };
    });

    const rows = allBuckets.slice(-60);

    const totalReservations = allBuckets.reduce((s, r) => s + r.reservations, 0);
    const totalPurchase = allBuckets.reduce((s, r) => s + r.purchaseValue, 0);
    const totalDelivery = allBuckets.reduce((s, r) => s + r.deliveryFee, 0);
    const totalDiscount = allBuckets.reduce((s, r) => s + r.discount, 0);
    const totalReceipt = allBuckets.reduce((s, r) => s + r.receiptAmount, 0);
    const totalRevenue = totalPurchase + totalDelivery;
    const totalNetRevenue = totalRevenue - totalDiscount;
    const totalLunasRevenue = allBuckets.reduce((s, r) => s + r.lunasRevenue, 0);
    const totalPendingRevenue = allBuckets.reduce((s, r) => s + r.pendingRevenue, 0);

    const summaryFacts = {
      totalReservations,
      totalPurchase,
      totalDelivery,
      totalDiscount,
      totalRevenue,
      netRevenue: totalNetRevenue,
      lunasRevenue: totalLunasRevenue,
      pendingRevenue: totalPendingRevenue,
      paidAmount: totalLunasRevenue,
      pendingAmount: totalPendingRevenue,
      receiptAmount: totalReceipt,
    };

    if (rows.length > 1) {
      rows.push({
        bucket: 'TOTAL',
        reservations: totalReservations,
        purchaseValue: totalPurchase,
        deliveryFee: totalDelivery,
        discount: totalDiscount,
        receiptAmount: totalReceipt,
        lunasRevenue: totalLunasRevenue,
        pendingRevenue: totalPendingRevenue,
        totalRevenue,
        netRevenue: totalNetRevenue,
        paidAmount: totalLunasRevenue,
        pendingAmount: totalPendingRevenue,
        basis: 'booking_date' as const,
      });
    }

    return { tool: 'query_revenue', args, count: rows.length, summaryFacts, rows };
  },
};

const FOLLOWUP_STATUS_VALUES = new Set(['PENDING', 'QUEUED', 'SENT', 'CANCELLED', 'FAILED', 'SKIPPED']);
const FOLLOWUP_STATUS_ALIASES: Record<string, string> = {
  pending: 'PENDING',
  menunggu: 'PENDING',
  queued: 'QUEUED',
  antre: 'QUEUED',
  antrian: 'QUEUED',
  sent: 'SENT',
  terkirim: 'SENT',
  cancelled: 'CANCELLED',
  canceled: 'CANCELLED',
  batal: 'CANCELLED',
  dibatalkan: 'CANCELLED',
  failed: 'FAILED',
  gagal: 'FAILED',
  skipped: 'SKIPPED',
  skip: 'SKIPPED',
  dilewati: 'SKIPPED',
};
const FOLLOWUP_TYPE_VALUES = new Set([
  'NO_PURCHASE',
  'NEXT_TREATMENT',
  'REMINDER_H1',
  'REVIEW_H1_BABY',
  'REVIEW_H1_MOMS',
  'WINBACK_60D',
]);
const FOLLOWUP_TYPE_ALIASES: Record<string, string> = {
  no_purchase: 'NO_PURCHASE',
  belum_beli: 'NO_PURCHASE',
  belum_purchase: 'NO_PURCHASE',
  next_treatment: 'NEXT_TREATMENT',
  treatment_berikutnya: 'NEXT_TREATMENT',
  reminder_h1: 'REMINDER_H1',
  pengingat_h1: 'REMINDER_H1',
  review_h1_baby: 'REVIEW_H1_BABY',
  review_h1_moms: 'REVIEW_H1_MOMS',
  winback_60d: 'WINBACK_60D',
};

function normalizeEnumArg(raw: unknown, values: Set<string>, aliases: Record<string, string>): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const key = String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!key) return undefined;
  const upper = key.toUpperCase();
  if (values.has(upper)) return upper;
  return aliases[key];
}

export function normalizeFollowUpStatus(raw: unknown): string | undefined {
  return normalizeEnumArg(raw, FOLLOWUP_STATUS_VALUES, FOLLOWUP_STATUS_ALIASES);
}

export function normalizeFollowUpType(raw: unknown): string | undefined {
  return normalizeEnumArg(raw, FOLLOWUP_TYPE_VALUES, FOLLOWUP_TYPE_ALIASES);
}

/**
 * Tool 10: antrean follow-up customer (query_followups).
 */
export const queryFollowups: CopilotTool = {
  name: 'query_followups',
  description:
    'Mengambil antrean follow-up customer berdasarkan status, tipe template, dan jatuh tempo. ' +
    'Gunakan untuk menjawab: "follow-up yang gagal", "follow-up jatuh tempo hari ini", "siapa yang belum di-follow up".',
  parameters: {
    status: { type: 'string', description: 'Status: "QUEUED" | "SENT" | "FAILED" | "CANCELLED" | "SKIPPED".' },
    type: { type: 'string', description: 'Tipe: "NO_PURCHASE" | "NEXT_TREATMENT" | "REMINDER_H1" | "REVIEW_H1_BABY" | "REVIEW_H1_MOMS" | "WINBACK_60D".' },
    dueBefore: { type: 'string', description: 'Batas tanggal jadwal WIB (YYYY-MM-DD). Kosong = seluruh antrean mendatang mulai yang paling mendesak.' },
    limit: { type: 'number', description: 'Maksimum baris (default 60, maks 60).' },
  },
  run: async (tenantId, args) => {
    const take = Math.min(Math.max(parseInt(String(args.limit || 60), 10) || 60, 1), 60);
    const where: any = {
      tenant_id: tenantId,
      customer: { is_sandbox_test: false },
    };

    const status = normalizeFollowUpStatus(args.status);
    if (status) where.status = status;
    const type = normalizeFollowUpType(args.type);
    if (type) where.type = type;
    if (isValidIsoDate(args.dueBefore)) {
      const endUtc = wibDayBoundsUtc(0, new Date(`${String(args.dueBefore).trim()}T12:00:00Z`)).end;
      where.scheduled_at = { lte: endUtc };
    }

    let totalQueued = 0;
    try {
      totalQueued = await prisma.followUp.count({ where });
    } catch {
      totalQueued = 0;
    }

    let followups: any[] = [];
    try {
      followups = await prisma.followUp.findMany({
        where,
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
              conversations: {
                select: { id: true },
                orderBy: { last_message_at: 'desc' },
                take: 1,
              },
            },
          },
        },
        orderBy: { scheduled_at: 'asc' },
        take,
      });
    } catch {
      followups = [];
    }

    if (totalQueued === 0 && followups.length > 0) {
      totalQueued = followups.length;
    }

    let rangeEarliest: string | null = null;
    let rangeLatest: string | null = null;
    if (followups.length > 0) {
      const first = followups[0].scheduled_at;
      rangeEarliest = first ? formatWibDateYYYYMMDD(new Date(first)) : null;
      const last = followups[followups.length - 1].scheduled_at;
      rangeLatest = last ? formatWibDateYYYYMMDD(new Date(last)) : null;

      if (totalQueued > followups.length) {
        try {
          const latestItem = await prisma.followUp.findFirst({
            where,
            orderBy: { scheduled_at: 'desc' },
            select: { scheduled_at: true },
          });
          if (latestItem?.scheduled_at) {
            rangeLatest = formatWibDateYYYYMMDD(new Date(latestItem.scheduled_at));
          }
        } catch {}
      }
    }

    const rows = followups.map((f: any) => {
      const nameInfo = formatCustomerDisplayName(f.customer?.name, f.customer?.phone);
      const schedDate = f.scheduled_at ? new Date(f.scheduled_at) : null;
      const sentDate = f.sent_at ? new Date(f.sent_at) : null;
      return {
        customerName: nameInfo.displayName,
        rawCustomerName: nameInfo.rawName,
        conversationId: f.customer?.conversations?.[0]?.id || null,
        type: f.type,
        status: f.status,
        scheduledDateWib: schedDate ? formatWibDateYYYYMMDD(schedDate) : null,
        scheduledTimeWib: schedDate ? formatWibTime(schedDate) : null,
        scheduledAt: schedDate ? formatWibDateYYYYMMDD(schedDate) : null,
        sentAt: sentDate ? formatWibDateYYYYMMDD(sentDate) : null,
        treatmentCategory: f.treatment_category || null,
      };
    });

    return {
      tool: 'query_followups',
      args,
      count: rows.length,
      totalQueued,
      truncated: totalQueued > rows.length,
      rangeEarliest,
      rangeLatest,
      rows,
    };
  },
};
