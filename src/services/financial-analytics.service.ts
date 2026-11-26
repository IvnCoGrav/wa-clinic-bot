import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { responseCacheService } from './response-cache.service';
import { resolveReservationBilling, type CatalogPriceCache } from './reservation-billing.service';
import { wibMonthBoundsUtc, shiftWibMonth, WIB_OFFSET_MS } from '../utils/wib-time';
import { getPaymentDisplayStatus, type PaymentDisplayStatus } from '../domain/reservation-payment';
import {
  getAnalyticsBaselineSettings,
  resolveBaselineSettingsForRequest,
  ALLOWED_BASELINE_MONTHS,
  type AnalyticsBaselineSettings,
  type BaselineMode,
} from '../config/analytics-baseline';
import {
  buildDailyBaseline,
  computeCumulativeAndForecast,
  type BaselineReservationInput,
  type CumulativeTrendPoint,
  type DailyBaselineResult,
  type ForecastSummary,
  type MonthPosition,
} from '../domain/daily-baseline';
function buildMonthlyAnalyticsCacheKey(
  tenantId: string,
  year: number,
  month: number,
  baselineMonths: number,
  includeBaseline: boolean
): string {
  return `analytics:monthly:${tenantId}:${year}:${month}:${baselineMonths}:${includeBaseline ? 1 : 0}`;
}

function buildBaselineCacheKey(
  tenantId: string,
  year: number,
  month: number,
  settings: AnalyticsBaselineSettings
): string {
  return `analytics:baseline:${tenantId}:${year}:${month}:${settings.months}:${settings.mode}:${settings.smoothingWindowDays}:${settings.minMonths}`;
}

const REVENUE_EXCLUDED_STATUSES = ['cancelled', 'CANCELLED'] as const;
function isCancelledStatus(status: unknown): boolean {
  const s = String(status ?? '').toLowerCase();
  return s === 'cancelled';
}

/**
 * SEC-AUDIT-12: netralkan formula injection CSV (CWE-1236). Nilai yang diawali
 * = + - @ TAB CR diberi prefix kutip tunggal agar spreadsheet memperlakukannya
 * sebagai teks murni, lalu dibungkus kutip ganda dengan escape standar.
 */
export function escapeCsvCell(val: any): string {
  let s = String(val ?? '');
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  s = s.replace(/"/g, '""');
  return `"${s}"`;
}

export interface MonthlyKpiSummary {
  totalRevenue: number;
  lunasRevenue: number;
  pendingRevenue: number;
  totalBookings: number;
  completedBookings: number;
  upcomingBookings: number;
  cancelledBookings: number;
  aov: number; // Average Order Value
  repeatCustomersCount: number;
  newCustomersCount: number;
  repeatRatePercentage: number;
  totalDeliveryFee: number;
}

export interface DailyRevenuePoint {
  day: number;
  dateStr: string;
  dayName: string;
  revenue: number;
  lunasRevenue: number;
  pendingRevenue: number;
  bookingsCount: number;
  repeatRevenue: number;
  newRevenue: number;
  repeatBookings: number;
  newBookings: number;
  scheduledRevenue: number;
  isPastOrToday: boolean;
  lastMonthRevenue: number | null;
  lastMonthBookings: number | null;
  avg6mRevenue: number | null;
  avg6mBookings: number | null;
  baselineSamples: number;
}

export interface CategoryRevenueItem {
  category: string;
  label: string;
  revenue: number;
  count: number;
  percentage: number;
}

export interface PaymentMethodItem {
  method: string;
  label: string;
  revenue: number;
  count: number;
  percentage: number;
}

export interface StaffPerformanceItem {
  staffId: string;
  staffName: string;
  role: string;
  totalBookings: number;
  completedBookings: number;
  revenueGenerated: number;
}

export interface TopServiceItem {
  serviceName: string;
  count: number;
  estimatedRevenue: number;
}

export interface TransactionLedgerItem {
  id: string;
  bookingDate: string | null;
  customerName: string;
  customerPhoneMasked: string;
  category: string;
  treatmentDetail: string;
  assignedStaffName: string;
  location: string;
  treatmentFee: number;
  deliveryFee: number;
  totalFee: number;
  paymentMethod: string;
  paymentStatus: PaymentDisplayStatus;
  status: string;
  isRepeatOrder: boolean;
}

export interface BaselineMeta {
  available: boolean;
  reason?: 'INSUFFICIENT_HISTORY' | 'NO_HISTORY' | 'QUERY_FAILED' | 'DISABLED';
  mode: BaselineMode;
  smoothingWindowDays: number;
  monthsRequested: number;
  monthsUsed: number;
  windowStart: { year: number; month: number };
  windowEnd: { year: number; month: number };
}

export interface MonthlyAnalyticsResponse {
  year: number;
  month: number;
  monthName: string;
  kpi: MonthlyKpiSummary;
  dailyTrend: DailyRevenuePoint[];
  cumulativeTrend: CumulativeTrendPoint[];
  forecastSummary: ForecastSummary;
  categoryBreakdown: CategoryRevenueItem[];
  paymentBreakdown: PaymentMethodItem[];
  staffPerformance: StaffPerformanceItem[];
  topServices: TopServiceItem[];
  transactions: TransactionLedgerItem[];
  baseline: BaselineMeta;
}

export class FinancialAnalyticsService {
  /**
   * Hitung rentang waktu 1 bulan penuh dalam zona waktu WIB (UTC+7)
   */
  private static getMonthDateRange(year: number, month: number) {
    // CFG-10: batas bulan WIB kini satu sumber dengan modul lain.
    const bounds = wibMonthBoundsUtc(year, month);
    if (!bounds) {
      throw Object.assign(new Error(`Periode tidak valid: ${year}-${month}`), { statusCode: 400 });
    }
    const { start, end, daysInMonth } = bounds;

    const dateObj = new Date(Date.UTC(year, month - 1, 1));
    const monthName = dateObj.toLocaleDateString('id-ID', { month: 'long', timeZone: 'UTC' });

    return { startOfMonth: start, endOfMonth: end, daysInMonth, monthName };
  }

  /**
   * Memuat data baseline multi-bulan (rata-rata 6 bulan & bulan lalu) dengan caching mandiri (TTL 600s).
   */
  private static async loadDailyBaseline(
    tenantId: string,
    year: number,
    month: number,
    settings: AnalyticsBaselineSettings
  ): Promise<{ result: DailyBaselineResult | null; settings: AnalyticsBaselineSettings }> {
    const key = buildBaselineCacheKey(tenantId, year, month, settings);
    const cached = responseCacheService.get<DailyBaselineResult>(key);
    if (cached) {
      return { result: cached, settings };
    }

    const first = shiftWibMonth(year, month, -settings.months);
    const last = shiftWibMonth(year, month, -1);
    const firstBounds = wibMonthBoundsUtc(first.year, first.month);
    const lastBounds = wibMonthBoundsUtc(last.year, last.month);

    if (!firstBounds || !lastBounds) {
      return { result: null, settings };
    }

    try {
      const rows = await prisma.reservation.findMany({
        where: {
          tenant_id: tenantId,
          status: { notIn: [...REVENUE_EXCLUDED_STATUSES] },
          booking_date: { gte: firstBounds.start, lte: lastBounds.end },
        },
        select: {
          booking_date: true,
          status: true,
          purchase_value: true,
          discount_amount: true,
          delivery_fee: true,
          treatment_detail: true,
          customer: { select: { ongkir: true } },
          items: { select: { price: true } },
        },
      });

      const cache: CatalogPriceCache = new Map();
      const inputs: BaselineReservationInput[] = [];
      for (const r of rows) {
        if (isCancelledStatus(r.status)) continue;
        const { totalFee } = await resolveReservationBilling(r as any, tenantId, cache);
        inputs.push({ bookingDate: r.booking_date, revenue: totalFee, bookings: 1 });
      }

      const result = buildDailyBaseline({
        targetYear: year,
        targetMonth: month,
        settings,
        reservations: inputs,
      });

      // M3.3: Cache HANYA bila query sukses (TTL 600 detik = 10 menit)
      responseCacheService.set(key, result, 600);
      return { result, settings };
    } catch (err) {
      console.warn('[ANALYTICS] baseline fallback:', err);
      return { result: null, settings };
    }
  }

  /**
   * Mengambil data analitik keuangan dan reservasi bulanan teragregasi
   */
  static async getMonthlyAnalytics(
    tenantId = DEFAULT_TENANT_ID,
    targetYear?: number,
    targetMonth?: number,
    options?: { includeBaseline?: boolean; baselineMonths?: number }
  ): Promise<MonthlyAnalyticsResponse> {
    const nowWib = new Date(Date.now() + WIB_OFFSET_MS);
    const fallbackYear = nowWib.getUTCFullYear();
    const fallbackMonth = nowWib.getUTCMonth() + 1;
    // Input tahun/bulan parsial atau di luar rentang jangan menghasilkan rentang sampah.
    const yearInput = Number(targetYear);
    const monthInput = Number(targetMonth);
    const year = Number.isInteger(yearInput) && yearInput >= 1970 && yearInput <= 2999 ? yearInput : fallbackYear;
    const month =
      Number.isInteger(monthInput) && monthInput >= 1 && monthInput <= 12 ? monthInput : fallbackMonth;

    const tenantSettings = await getAnalyticsBaselineSettings(tenantId);
    const validBaselineMonths =
      options?.baselineMonths !== undefined && (ALLOWED_BASELINE_MONTHS as readonly number[]).includes(options.baselineMonths)
        ? options.baselineMonths
        : undefined;
    const effectiveSettings = resolveBaselineSettingsForRequest(tenantSettings, validBaselineMonths);
    const includeBaseline = options?.includeBaseline !== false;
    const cacheKey = buildMonthlyAnalyticsCacheKey(
      tenantId,
      year,
      month,
      effectiveSettings.months,
      includeBaseline
    );
    const cached = responseCacheService.get<MonthlyAnalyticsResponse>(cacheKey);
    if (cached) return cached;

    const { startOfMonth, endOfMonth, daysInMonth, monthName } = this.getMonthDateRange(year, month);

    // R-07: Jalankan loadDailyBaseline dan query transaksi bulanan secara paralel via Promise.all
    const baselinePromise = includeBaseline
      ? this.loadDailyBaseline(tenantId, year, month, effectiveSettings)
      : Promise.resolve({ result: null as DailyBaselineResult | null, settings: effectiveSettings });

    const rowsPromise = (async () => {
      try {
        return await prisma.reservation.findMany({
          where: {
            tenant_id: tenantId,
            booking_date: {
              gte: startOfMonth,
              lte: endOfMonth,
            },
          },
          include: {
            customer: {
              select: {
                id: true,
                name: true,
                phone: true,
                kelurahan: true,
                kecamatan: true,
                kota: true,
                ongkir: true,
              },
            },
            assigned_staff: {
              select: {
                id: true,
                name: true,
                role: true,
              },
            },
            items: true,
          },
          orderBy: {
            booking_date: 'asc',
          },
        });
      } catch (err) {
        console.warn('[ANALYTICS] DB fetch fallback:', err);
        return [] as any[];
      }
    })();

    const [{ result: baselineResult }, rows] = await Promise.all([
      baselinePromise,
      rowsPromise,
    ]);

    // Inisialisasi struktur daily trend (1..daysInMonth)
    const dailyMap = new Map<number, {
      revenue: number;
      lunasRevenue: number;
      pendingRevenue: number;
      bookingsCount: number;
      repeatRevenue: number;
      newRevenue: number;
      repeatBookings: number;
      newBookings: number;
    }>();

    for (let d = 1; d <= daysInMonth; d++) {
      dailyMap.set(d, {
        revenue: 0,
        lunasRevenue: 0,
        pendingRevenue: 0,
        bookingsCount: 0,
        repeatRevenue: 0,
        newRevenue: 0,
        repeatBookings: 0,
        newBookings: 0,
      });
    }

    let totalRevenue = 0;
    let lunasRevenue = 0;
    let pendingRevenue = 0;
    let completedBookings = 0;
    let upcomingBookings = 0;
    let cancelledBookings = 0;
    let repeatCount = 0;
    let totalDeliveryFee = 0;

    const categoryMap = new Map<string, { revenue: number; count: number }>();
    const paymentMap = new Map<string, { revenue: number; count: number }>();
    const staffMap = new Map<string, { name: string; role: string; total: number; completed: number; revenue: number }>();
    const serviceMap = new Map<string, { count: number; revenue: number }>();
    const transactions: TransactionLedgerItem[] = [];

    const nowMs = Date.now();
    const nowWibMs = nowMs + WIB_OFFSET_MS;
    // Satu cache per-batch: treatment_detail berulang tidak resolve katalog berkali-kali.
    const catalogPriceCache: CatalogPriceCache = new Map();

    for (const r of rows) {
      const { treatmentFee, deliveryFee, totalFee } = await resolveReservationBilling(
        r,
        tenantId,
        catalogPriceCache
      );

      const isCompleted = (r.status || '').toLowerCase() === 'completed';
      const isCancelled = isCancelledStatus(r.status);
      const isLunas = Boolean(r.purchase_occurred_at);
      // Seam kanonis: completed-tanpa-bayar ditampilkan sebagai
      // SELESAI_BELUM_VERIFIKASI, bukan "Tagih di Tempat" (menyesatkan).
      const paymentDisplayStatus = getPaymentDisplayStatus(r as any);

      if (isCancelled) {
        cancelledBookings++;
      } else {
        totalRevenue += totalFee;
        totalDeliveryFee += deliveryFee;

        if (isLunas) {
          lunasRevenue += totalFee;
        } else {
          pendingRevenue += totalFee;
        }

        if (isCompleted) {
          completedBookings++;
        } else {
          upcomingBookings++;
        }

        if (r.is_repeat_order) {
          repeatCount++;
        }

        // Daily trend bucket
        if (r.booking_date) {
          const bookingWib = new Date(new Date(r.booking_date).getTime() + 7 * 3600 * 1000);
          const dayNum = bookingWib.getUTCDate();
          const bucket = dailyMap.get(dayNum);
          if (bucket) {
            bucket.revenue += totalFee;
            bucket.bookingsCount += 1;
            if (r.is_repeat_order) {
              bucket.repeatRevenue += totalFee;
              bucket.repeatBookings += 1;
            } else {
              bucket.newRevenue += totalFee;
              bucket.newBookings += 1;
            }
            if (isLunas) {
              bucket.lunasRevenue += totalFee;
            } else {
              bucket.pendingRevenue += totalFee;
            }
          }
        }

        // Category breakdown
        const catKey = (r.treatment_category || 'OTHER').toUpperCase();
        const catEntry = categoryMap.get(catKey) || { revenue: 0, count: 0 };
        catEntry.revenue += totalFee;
        catEntry.count += 1;
        categoryMap.set(catKey, catEntry);

        // Payment method breakdown
        const payKey = (
          r.payment_method ||
          (paymentDisplayStatus === 'LUNAS'
            ? 'LUNAS_TANPA_METODE'
            : paymentDisplayStatus === 'SELESAI_BELUM_VERIFIKASI'
            ? 'SELESAI_BELUM_VERIFIKASI'
            : 'TAGIH_DI_TEMPAT')
        ).toUpperCase();
        const payEntry = paymentMap.get(payKey) || { revenue: 0, count: 0 };
        payEntry.revenue += totalFee;
        payEntry.count += 1;
        paymentMap.set(payKey, payEntry);

        // Staff leaderboard
        const staffId = r.assigned_staff?.id || 'unassigned';
        const staffName = r.assigned_staff?.name || 'Belum Ditugaskan';
        const staffRole = r.assigned_staff?.role || 'Terapis';
        const staffEntry = staffMap.get(staffId) || { name: staffName, role: staffRole, total: 0, completed: 0, revenue: 0 };
        staffEntry.total += 1;
        if (isCompleted) staffEntry.completed += 1;
        staffEntry.revenue += totalFee;
        staffMap.set(staffId, staffEntry);

        // Top services parsing (Fase 3C/3.9: prioritaskan tabel relasional reservation_items)
        if (Array.isArray(r.items) && r.items.length > 0) {
          for (const it of r.items) {
            const serviceName = it.custom_name?.trim() || 'Layanan Klinik';
            const sEntry = serviceMap.get(serviceName) || { count: 0, revenue: 0 };
            sEntry.count += 1;
            sEntry.revenue += it.price || 0;
            serviceMap.set(serviceName, sEntry);
          }
        } else {
          const serviceName = (r.treatment_detail || 'Treatment Homecare').split(/\r?\n|,|;/)[0].trim();
          if (serviceName) {
            const sEntry = serviceMap.get(serviceName) || { count: 0, revenue: 0 };
            sEntry.count += 1;
            sEntry.revenue += totalFee;
            serviceMap.set(serviceName, sEntry);
          }
        }
      }

      // Format transaction item
      const phoneRaw = r.customer?.phone || '';
      const phoneMasked = phoneRaw.length > 7 ? `${phoneRaw.slice(0, 4)}****${phoneRaw.slice(-3)}` : phoneRaw;
      const locationParts = [r.customer?.kelurahan, r.customer?.kecamatan, r.customer?.kota].filter(Boolean);

      transactions.push({
        id: r.id,
        bookingDate: r.booking_date ? new Date(r.booking_date).toISOString() : null,
        customerName: r.customer?.name || 'Pasien',
        customerPhoneMasked: phoneMasked,
        category: r.treatment_category || 'BABY',
        treatmentDetail: r.treatment_detail || 'Layanan Treatment',
        assignedStaffName: r.assigned_staff?.name || 'Belum Ditugaskan',
        location: locationParts.join(', ') || 'Alamat Belum Lengkap',
        treatmentFee,
        deliveryFee,
        totalFee,
        paymentMethod: r.payment_method || (isLunas ? '' : paymentDisplayStatus),
        paymentStatus: paymentDisplayStatus,
        status: r.status || 'pending',
        isRepeatOrder: Boolean(r.is_repeat_order),
      });
    }

    const totalBookings = rows.length;
    const aov = totalBookings > 0 ? Math.round(totalRevenue / totalBookings) : 0;
    const newCustomersCount = Math.max(0, totalBookings - repeatCount);
    const repeatRatePercentage = totalBookings > 0 ? parseFloat(((repeatCount / totalBookings) * 100).toFixed(1)) : 0;

    // Format daily trend points
    const dailyTrend: DailyRevenuePoint[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const bucket = dailyMap.get(d) || {
        revenue: 0,
        lunasRevenue: 0,
        pendingRevenue: 0,
        bookingsCount: 0,
        repeatRevenue: 0,
        newRevenue: 0,
        repeatBookings: 0,
        newBookings: 0,
      };
      const dObj = new Date(Date.UTC(year, month - 1, d));
      const dayName = dObj.toLocaleDateString('id-ID', { weekday: 'short', timeZone: 'UTC' });
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      
      // F0.1: hari ini (WIB) true sejak 00:00 WIB, bukan setelah 07:00 WIB besok.
      const dayStartWibMs = Date.UTC(year, month - 1, d);
      const isPastOrToday = dayStartWibMs <= nowWibMs;

      const baselinePoint = baselineResult?.byDay.get(d);
      const prevPoint = baselineResult?.previousMonth.byDay.get(d);

      dailyTrend.push({
        day: d,
        dateStr,
        dayName,
        revenue: bucket.revenue,
        lunasRevenue: bucket.lunasRevenue,
        pendingRevenue: bucket.pendingRevenue,
        bookingsCount: bucket.bookingsCount,
        repeatRevenue: bucket.repeatRevenue,
        newRevenue: bucket.newRevenue,
        repeatBookings: bucket.repeatBookings,
        newBookings: bucket.newBookings,
        scheduledRevenue: isPastOrToday ? 0 : bucket.revenue,
        isPastOrToday,
        lastMonthRevenue: prevPoint !== undefined ? prevPoint.revenue : null,
        lastMonthBookings: prevPoint !== undefined ? prevPoint.bookings : null,
        avg6mRevenue: baselineResult?.available ? (baselinePoint?.avg6mRevenue ?? null) : null,
        avg6mBookings: baselineResult?.available ? (baselinePoint?.avg6mBookings ?? null) : null,
        baselineSamples: baselineResult?.available ? (baselinePoint?.samples ?? 0) : 0,
      });
    }

    const currentYearWib = nowWib.getUTCFullYear();
    const currentMonthWib = nowWib.getUTCMonth() + 1;

    const monthPosition: MonthPosition =
      year < currentYearWib || (year === currentYearWib && month < currentMonthWib)
        ? 'past'
        : year === currentYearWib && month === currentMonthWib
        ? 'current'
        : 'future';

    const asOfDay =
      monthPosition === 'past'
        ? daysInMonth
        : monthPosition === 'current'
        ? nowWib.getUTCDate()
        : 0;

    const { points: cumulativeTrend, summary: forecastSummary } =
      computeCumulativeAndForecast({
        dailyPoints: dailyTrend,
        baseline: baselineResult,
        daysInMonth,
        context: { monthPosition, asOfDay },
      });

    // Format category breakdown
    const categoryLabels: Record<string, string> = {
      BABY: 'Baby Spa',
      KIDS: 'Kids Spa',
      MOM: 'Moms & Pregnancy',
      POSTPARTUM: 'Postpartum Care',
      PREGNANCY: 'Pregnancy Spa',
      LACTATION: 'Laktasi & Pijat Payudara',
      FERTILITY: 'Fertility Care',
      OTHER: 'Layanan Lainnya',
    };

    const categoryBreakdown: CategoryRevenueItem[] = Array.from(categoryMap.entries()).map(([cat, val]) => ({
      category: cat,
      label: categoryLabels[cat] || cat,
      revenue: val.revenue,
      count: val.count,
      percentage: totalRevenue > 0 ? parseFloat(((val.revenue / totalRevenue) * 100).toFixed(1)) : 0,
    })).sort((a, b) => b.revenue - a.revenue);

    // Format payment breakdown
    const paymentLabels: Record<string, string> = {
      TRANSFER: 'Transfer Bank (BCA/Mandiri/BRI)',
      QRIS: 'QRIS Realtime',
      CASH: 'Cash / Tunai di Tempat',
      TAGIH_DI_TEMPAT: 'Tagih di Tempat (Pending)',
      LUNAS_TANPA_METODE: 'Lunas (metode belum dicatat)',
      SELESAI_BELUM_VERIFIKASI: 'Selesai — belum verifikasi bayar',
    };

    const paymentBreakdown: PaymentMethodItem[] = Array.from(paymentMap.entries()).map(([method, val]) => ({
      method,
      label: paymentLabels[method] || method,
      revenue: val.revenue,
      count: val.count,
      percentage: totalRevenue > 0 ? parseFloat(((val.revenue / totalRevenue) * 100).toFixed(1)) : 0,
    })).sort((a, b) => b.revenue - a.revenue);

    // Format staff performance
    const staffPerformance: StaffPerformanceItem[] = Array.from(staffMap.entries()).map(([id, val]) => ({
      staffId: id,
      staffName: val.name,
      role: val.role,
      totalBookings: val.total,
      completedBookings: val.completed,
      revenueGenerated: val.revenue,
    })).sort((a, b) => b.revenueGenerated - a.revenueGenerated);

    // Format top services
    const topServices: TopServiceItem[] = Array.from(serviceMap.entries()).map(([serviceName, val]) => ({
      serviceName,
      count: val.count,
      estimatedRevenue: val.revenue,
    })).sort((a, b) => b.count - a.count).slice(0, 10);

    const baselineMeta: BaselineMeta = baselineResult
      ? {
          available: baselineResult.available,
          reason: baselineResult.reason,
          mode: baselineResult.mode,
          smoothingWindowDays: baselineResult.smoothingWindowDays,
          monthsRequested: baselineResult.monthsRequested,
          monthsUsed: baselineResult.monthsUsed,
          windowStart: baselineResult.windowStart,
          windowEnd: baselineResult.windowEnd,
        }
      : {
          available: false,
          reason: includeBaseline ? 'QUERY_FAILED' : 'DISABLED',
          mode: effectiveSettings.mode,
          smoothingWindowDays: effectiveSettings.smoothingWindowDays,
          monthsRequested: effectiveSettings.months,
          monthsUsed: 0,
          windowStart: shiftWibMonth(year, month, -effectiveSettings.months),
          windowEnd: shiftWibMonth(year, month, -1),
        };

    const result: MonthlyAnalyticsResponse = {
      year,
      month,
      monthName,
      kpi: {
        totalRevenue,
        lunasRevenue,
        pendingRevenue,
        totalBookings,
        completedBookings,
        upcomingBookings,
        cancelledBookings,
        aov,
        repeatCustomersCount: repeatCount,
        newCustomersCount,
        repeatRatePercentage,
        totalDeliveryFee,
      },
      dailyTrend,
      cumulativeTrend,
      forecastSummary,
      categoryBreakdown,
      paymentBreakdown,
      staffPerformance,
      topServices,
      transactions,
      baseline: baselineMeta,
    };

    if (includeBaseline) {
      responseCacheService.set(cacheKey, result, 30); // Cache 30 detik
    }
    return result;
  }

  /**
   * Generate CSV rekap transaksi bulanan
   */
  static async generateMonthlyTransactionsCsv(
    tenantId = DEFAULT_TENANT_ID,
    year: number,
    month: number
  ): Promise<string> {
    const data = await this.getMonthlyAnalytics(tenantId, year, month, { includeBaseline: false });
    
    const headers = [
      'No. Transaksi',
      'Tanggal & Jam',
      'Nama Pasien',
      'Kategori',
      'Menu Treatment',
      'Terapis Penanggung Jawab',
      'Lokasi / Alamat',
      'Tarif Layanan (Rp)',
      'Ongkir (Rp)',
      'Total Tagihan (Rp)',
      'Metode Pembayaran',
      'Status Pelunasan',
      'Status Reservasi',
      'Jenis Pasien',
    ];

    // SEC-AUDIT-12: cegah formula injection (CWE-1236). Nilai yang diawali
    // = + - @ TAB CR dipaksa menjadi teks murni dengan prefix kutip tunggal.
    const escapeCsv = escapeCsvCell;

    const rows = data.transactions.map((t) => {
      const dateFormatted = t.bookingDate
        ? new Date(t.bookingDate).toLocaleString('id-ID', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '-';

      return [
        escapeCsv(t.id),
        escapeCsv(dateFormatted),
        escapeCsv(t.customerName),
        escapeCsv(t.category),
        escapeCsv(t.treatmentDetail),
        escapeCsv(t.assignedStaffName),
        escapeCsv(t.location),
        t.treatmentFee,
        t.deliveryFee,
        t.totalFee,
        escapeCsv(t.paymentMethod),
        escapeCsv(t.paymentStatus),
        escapeCsv(t.status),
        escapeCsv(t.isRepeatOrder ? 'Repeat Order' : 'Pasien Baru'),
      ].join(',');
    });

    return [headers.join(','), ...rows].join('\r\n');
  }
}
