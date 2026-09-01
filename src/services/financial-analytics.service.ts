import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { responseCacheService } from './response-cache.service';

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
  isPastOrToday: boolean;
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
  paymentStatus: 'LUNAS' | 'TAGIH_DI_TEMPAT';
  status: string;
  isRepeatOrder: boolean;
}

export interface MonthlyAnalyticsResponse {
  year: number;
  month: number;
  monthName: string;
  kpi: MonthlyKpiSummary;
  dailyTrend: DailyRevenuePoint[];
  categoryBreakdown: CategoryRevenueItem[];
  paymentBreakdown: PaymentMethodItem[];
  staffPerformance: StaffPerformanceItem[];
  topServices: TopServiceItem[];
  transactions: TransactionLedgerItem[];
}

export class FinancialAnalyticsService {
  /**
   * Hitung rentang waktu 1 bulan penuh dalam zona waktu WIB (UTC+7)
   */
  private static getMonthDateRange(year: number, month: number) {
    // month is 1-indexed (1 = January, 12 = December)
    const daysInMonth = new Date(year, month, 0).getDate();
    
    // 00:00:00.000 WIB pada tanggal 1 dinyatakan dalam UTC adalah -7 jam
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1, -7, 0, 0, 0));
    // 23:59:59.999 WIB pada hari terakhir dinyatakan dalam UTC adalah 16:59:59.999
    const endOfMonth = new Date(Date.UTC(year, month - 1, daysInMonth, 16, 59, 59, 999));

    const dateObj = new Date(Date.UTC(year, month - 1, 1));
    const monthName = dateObj.toLocaleDateString('id-ID', { month: 'long', timeZone: 'UTC' });

    return { startOfMonth, endOfMonth, daysInMonth, monthName };
  }

  /**
   * Mengambil data analitik keuangan dan reservasi bulanan teragregasi
   */
  static async getMonthlyAnalytics(
    tenantId = DEFAULT_TENANT_ID,
    targetYear?: number,
    targetMonth?: number
  ): Promise<MonthlyAnalyticsResponse> {
    const nowWib = new Date(Date.now() + 7 * 3600 * 1000);
    const year = targetYear || nowWib.getUTCFullYear();
    const month = targetMonth || nowWib.getUTCMonth() + 1;

    const cacheKey = `analytics:monthly:${tenantId}:${year}:${month}`;
    const cached = responseCacheService.get<MonthlyAnalyticsResponse>(cacheKey);
    if (cached) return cached;

    const { startOfMonth, endOfMonth, daysInMonth, monthName } = this.getMonthDateRange(year, month);

    let rows: any[] = [];
    try {
      rows = await prisma.reservation.findMany({
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
        },
        orderBy: {
          booking_date: 'asc',
        },
      });
    } catch (err) {
      console.warn('[ANALYTICS] DB fetch fallback:', err);
      rows = [];
    }

    // Inisialisasi struktur daily trend (1..daysInMonth)
    const dailyMap = new Map<number, {
      revenue: number;
      lunasRevenue: number;
      pendingRevenue: number;
      bookingsCount: number;
    }>();

    for (let d = 1; d <= daysInMonth; d++) {
      dailyMap.set(d, { revenue: 0, lunasRevenue: 0, pendingRevenue: 0, bookingsCount: 0 });
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

    for (const r of rows) {
      const treatmentFee = r.purchase_value || 0;
      const deliveryFee = r.customer?.ongkir || 0;
      const totalFee = treatmentFee + deliveryFee;

      const isCompleted = (r.status || '').toLowerCase() === 'completed' || (r.booking_date && new Date(r.booking_date).getTime() <= nowMs);
      const isCancelled = (r.status || '').toLowerCase() === 'cancelled';
      const isLunas = Boolean(r.purchase_occurred_at || r.payment_method || (r.status || '').toLowerCase() === 'completed');

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
        const payKey = (r.payment_method || (isLunas ? 'TRANSFER' : 'TAGIH_DI_TEMPAT')).toUpperCase();
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

        // Top services parsing
        const serviceName = (r.treatment_detail || 'Treatment Homecare').split(/\r?\n|,|;/)[0].trim();
        if (serviceName) {
          const sEntry = serviceMap.get(serviceName) || { count: 0, revenue: 0 };
          sEntry.count += 1;
          sEntry.revenue += totalFee;
          serviceMap.set(serviceName, sEntry);
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
        paymentMethod: r.payment_method || (isLunas ? 'TRANSFER' : 'TAGIH_DI_TEMPAT'),
        paymentStatus: isLunas ? 'LUNAS' : 'TAGIH_DI_TEMPAT',
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
      const bucket = dailyMap.get(d) || { revenue: 0, lunasRevenue: 0, pendingRevenue: 0, bookingsCount: 0 };
      const dObj = new Date(Date.UTC(year, month - 1, d));
      const dayName = dObj.toLocaleDateString('id-ID', { weekday: 'short', timeZone: 'UTC' });
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      
      const currentDayMs = new Date(Date.UTC(year, month - 1, d, 23, 59, 59)).getTime();
      const isPastOrToday = currentDayMs <= Date.now() + 7 * 3600 * 1000;

      dailyTrend.push({
        day: d,
        dateStr,
        dayName,
        revenue: bucket.revenue,
        lunasRevenue: bucket.lunasRevenue,
        pendingRevenue: bucket.pendingRevenue,
        bookingsCount: bucket.bookingsCount,
        isPastOrToday,
      });
    }

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
      categoryBreakdown,
      paymentBreakdown,
      staffPerformance,
      topServices,
      transactions,
    };

    responseCacheService.set(cacheKey, result, 30); // Cache 30 detik
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
    const data = await this.getMonthlyAnalytics(tenantId, year, month);
    
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

    const escapeCsv = (val: any) => {
      const s = String(val ?? '').replace(/"/g, '""');
      return `"${s}"`;
    };

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
