import React, { useEffect, useState, useCallback } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import {
  TrendingUp,
  DollarSign,
  Calendar,
  Users,
  ShoppingBag,
  ArrowUpRight,
  Download,
  RefreshCw,
  Search,
  CheckCircle2,
  Clock,
  ChevronDown,
  UserCheck,
  CreditCard,
  Building2,
  CalendarDays,
  FileSpreadsheet,
  Layers,
  Award,
  Wallet,
  PieChart as PieIcon,
  BarChart2,
  X,
  ExternalLink,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { stripBufferMetadata, cleanTreatmentName } from '../../utils/treatmentStringParser';
import { resolveStaffName } from '../../utils/resolveStaffName';
import { useTheme } from '../../contexts/ThemeContext';
import { chartTheme } from '../../lib/chartTheme';

interface MonthlyKpiSummary {
  totalRevenue: number;
  lunasRevenue: number;
  pendingRevenue: number;
  totalBookings: number;
  completedBookings: number;
  upcomingBookings: number;
  cancelledBookings: number;
  aov: number;
  repeatCustomersCount: number;
  newCustomersCount: number;
  repeatRatePercentage: number;
  totalDeliveryFee: number;
}

interface DailyRevenuePoint {
  day: number;
  dateStr: string;
  dayName: string;
  revenue: number;
  lunasRevenue: number;
  pendingRevenue: number;
  bookingsCount: number;
  isPastOrToday: boolean;
}

interface CategoryRevenueItem {
  category: string;
  label: string;
  revenue: number;
  count: number;
  percentage: number;
}

interface PaymentMethodItem {
  method: string;
  label: string;
  revenue: number;
  count: number;
  percentage: number;
}

interface StaffPerformanceItem {
  staffId: string;
  staffName: string;
  role: string;
  totalBookings: number;
  completedBookings: number;
  revenueGenerated: number;
}

interface TopServiceItem {
  serviceName: string;
  count: number;
  estimatedRevenue: number;
}

interface TransactionLedgerItem {
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
  paymentStatus: 'LUNAS' | 'SELESAI_BELUM_VERIFIKASI' | 'TAGIH_DI_TEMPAT';
  status: string;
  isRepeatOrder: boolean;
}

interface MonthlyAnalyticsData {
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

const CATEGORY_COLORS = chartTheme.series;
const PAYMENT_COLORS = [chartTheme.series[0], chartTheme.series[1], chartTheme.series[3], chartTheme.danger];

function formatRupiah(amount: number): string {
  return 'Rp ' + (amount || 0).toLocaleString('id-ID');
}

function formatCompactRupiah(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `Rp ${(amount / 1_000_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000_000) {
    return `Rp ${(amount / 1_000_000).toFixed(1)}jt`;
  }
  if (amount >= 1_000) {
    return `Rp ${(amount / 1_000).toFixed(0)}rb`;
  }
  return `Rp ${amount}`;
}

function getLedgerPaymentLabel(status: TransactionLedgerItem['paymentStatus']): string {
  if (status === 'LUNAS') return 'Lunas';
  if (status === 'SELESAI_BELUM_VERIFIKASI') return 'Selesai — verifikasi bayar';
  return 'Tagih di Tempat';
}

function getLedgerPaymentClass(status: TransactionLedgerItem['paymentStatus']): string {
  if (status === 'LUNAS') {
    return 'bg-bubble-out text-accent border border-accent/30';
  }
  if (status === 'SELESAI_BELUM_VERIFIKASI') {
    return 'bg-sky-100 dark:bg-fill-1/20 text-sky-800 dark:text-info border border-sky-300 dark:border-sky-800/40';
  }
  return 'bg-amber-100 dark:bg-amber-950/30 text-amber-800 dark:text-warning border border-amber-300';
}

export const FinancialAnalytics: React.FC = () => {
  const { toast } = useUiFeedback();
  const { resolved } = useTheme();
  const gridStroke = chartTheme.grid.stroke;

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1);

  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [data, setData] = useState<MonthlyAnalyticsData | null>(null);

  // Table filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'LUNAS' | 'SELESAI_BELUM_VERIFIKASI' | 'TAGIH_DI_TEMPAT'>('ALL');
  const [selectedTx, setSelectedTx] = useState<TransactionLedgerItem | null>(null);

  // Fetch monthly analytics data
  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ success: boolean; data: MonthlyAnalyticsData }>(
        `/api/admin/financial-analytics?year=${selectedYear}&month=${selectedMonth}`
      );
      if (res.success && res.data) {
        setData(res.data);
      }
    } catch (err: any) {
      toast(err.message || 'Gagal memuat data analitik transaksi.', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedYear, selectedMonth, toast]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  // Handle month selection buttons
  const setMonthOffset = (offset: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() + offset);
    setSelectedYear(d.getFullYear());
    setSelectedMonth(d.getMonth() + 1);
  };

  const isCurrentMonth = selectedYear === now.getFullYear() && selectedMonth === now.getMonth() + 1;
  const isLastMonth =
    (selectedYear === now.getFullYear() && selectedMonth === now.getMonth()) ||
    (now.getMonth() === 0 && selectedMonth === 12 && selectedYear === now.getFullYear() - 1);

  // Handle Export CSV
  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const adminKey = localStorage.getItem('adminApiKey') || '';
      const response = await fetch(
        `/api/admin/financial-analytics/export?year=${selectedYear}&month=${selectedMonth}`,
        {
          headers: {
            'x-api-key': adminKey,
          },
        }
      );

      if (!response.ok) {
        throw new Error('Gagal mengunduh rekap spreadsheet');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rekap-transaksi-kala-spa-${selectedYear}-${String(selectedMonth).padStart(2, '0')}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast('Rekap spreadsheet transaksi berhasil diunduh!', 'success');
    } catch (err: any) {
      toast(err.message || 'Gagal mengekspor data transaksi.', 'error');
    } finally {
      setExporting(false);
    }
  };

  // Filtered transactions for table
  const filteredTransactions = (data?.transactions || []).filter((tx) => {
    if (statusFilter !== 'ALL' && tx.paymentStatus !== statusFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = tx.customerName.toLowerCase().includes(q);
      const matchService = tx.treatmentDetail.toLowerCase().includes(q);
      const matchStaff = tx.assignedStaffName.toLowerCase().includes(q);
      const matchLoc = tx.location.toLowerCase().includes(q);
      const matchId = tx.id.toLowerCase().includes(q);
      if (!matchName && !matchService && !matchStaff && !matchLoc && !matchId) return false;
    }
    return true;
  });

  const kpi = data?.kpi || {
    totalRevenue: 0,
    lunasRevenue: 0,
    pendingRevenue: 0,
    totalBookings: 0,
    completedBookings: 0,
    upcomingBookings: 0,
    cancelledBookings: 0,
    aov: 0,
    repeatCustomersCount: 0,
    newCustomersCount: 0,
    repeatRatePercentage: 0,
    totalDeliveryFee: 0,
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Top Header & Time Controls */}
      <div className="bg-surface p-4 sm:p-5 rounded-2xl border border-divider shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="h-10 w-10 rounded-xl bg-accent text-accent-ink flex items-center justify-center shadow-xs">
              <TrendingUp size={22} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-ink tracking-tight">
                Transaksi & Pendapatan
              </h1>
              <p className="text-xs text-ink-2 mt-0.5">
                Rekap performa omset, tren pendapatan harian, dan buku besar reservasi klinik.
              </p>
            </div>
          </div>
        </div>

        {/* Month Selector Controls & Export */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Month Filter Pills */}
          <div className="inline-flex p-1 rounded-xl bg-fill-1 border border-divider">
            <button
              onClick={() => setMonthOffset(0)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                isCurrentMonth
                  ? 'bg-surface text-accent shadow-xs ring-1 ring-accent/20'
                  : 'text-ink-2 hover:text-ink'
              }`}
            >
              Bulan Ini
            </button>
            <button
              onClick={() => setMonthOffset(-1)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                isLastMonth
                  ? 'bg-surface text-accent shadow-xs ring-1 ring-accent/20'
                  : 'text-ink-2 hover:text-ink'
              }`}
            >
              Bulan Lalu
            </button>
          </div>

          {/* Month & Year Combined Dropdown */}
          <div className="flex items-center space-x-1.5 bg-surface border border-divider rounded-xl px-2 py-1 shadow-xs">
            <Calendar size={14} className="text-accent ml-1 shrink-0" />
            <select
              value={`${selectedYear}-${String(selectedMonth).padStart(2, '0')}`}
              onChange={(e) => {
                const [y, m] = e.target.value.split('-').map(Number);
                setSelectedYear(y);
                setSelectedMonth(m);
              }}
              className="bg-transparent text-xs font-bold text-ink focus:outline-none cursor-pointer py-1"
            >
              {Array.from({ length: 24 }, (_, i) => {
                const d = new Date();
                d.setMonth(d.getMonth() - 11 + i);
                const y = d.getFullYear();
                const m = d.getMonth() + 1;
                const label = d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
                return (
                  <option key={`${y}-${m}`} value={`${y}-${String(m).padStart(2, '0')}`}>
                    {label}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Export CSV / Excel Button */}
          <button
            onClick={handleExportCsv}
            disabled={exporting || loading}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-accent hover:bg-accent disabled:opacity-50 text-white text-xs font-bold shadow-xs transition active:scale-95 cursor-pointer"
            title="Download Spreadsheet Excel / CSV"
          >
            <FileSpreadsheet size={15} />
            <span>{exporting ? 'Mengunduh...' : 'Export Excel'}</span>
          </button>

          {/* Refresh Button */}
          <button
            onClick={fetchAnalytics}
            disabled={loading}
            className="p-2 rounded-xl bg-surface border border-divider text-ink-2 hover:text-ink dark:hover:text-ink hover:bg-fill-1 transition shadow-xs disabled:opacity-50 cursor-pointer"
            title="Muat Ulang Data"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin text-accent' : ''} />
          </button>
        </div>
      </div>

      {/* 4 Top KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Revenue */}
        <div className="bg-surface p-4 sm:p-5 rounded-2xl border border-divider shadow-xs relative overflow-hidden group hover:border-accent transition">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold text-ink-2 uppercase tracking-wider">
                Total Omset ({data?.monthName || 'Bulan Ini'})
              </p>
              <h3 className="text-2xl font-black text-ink mt-1.5 tracking-tight">
                {formatRupiah(kpi.totalRevenue)}
              </h3>
            </div>
            <div className="h-10 w-10 rounded-xl bg-success-soft text-accent border border-success-line flex items-center justify-center shadow-2xs shrink-0">
              <DollarSign size={20} />
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-divider dark:border-divider flex items-center justify-between text-xs">
            <span className="text-accent font-bold">
              ✓ Lunas: {formatRupiah(kpi.lunasRevenue)}
            </span>
            <span className="text-warning font-semibold">
              Tagih: {formatRupiah(kpi.pendingRevenue)}
            </span>
          </div>
        </div>

        {/* Card 2: Total Bookings */}
        <div className="bg-surface p-4 sm:p-5 rounded-2xl border border-divider shadow-xs relative overflow-hidden group hover:border-info transition">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold text-ink-2 uppercase tracking-wider">
                Total Reservasi
              </p>
              <h3 className="text-2xl font-black text-ink mt-1.5 tracking-tight">
                {kpi.totalBookings} <span className="text-sm font-semibold text-ink-2">Kunjungan</span>
              </h3>
            </div>
            <div className="h-10 w-10 rounded-xl bg-info-soft text-info border border-info-line flex items-center justify-center shadow-2xs shrink-0">
              <CalendarDays size={20} />
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-divider dark:border-divider flex items-center justify-between text-xs text-ink-2">
            <span className="text-accent font-semibold">
              {kpi.completedBookings} Selesai
            </span>
            <span className="text-info font-semibold">
              {kpi.upcomingBookings} Mendatang
            </span>
            {kpi.cancelledBookings > 0 && (
              <span className="text-danger font-semibold">
                {kpi.cancelledBookings} Batal
              </span>
            )}
          </div>
        </div>

        {/* Card 3: Average Order Value (AOV) */}
        <div className="bg-surface p-4 sm:p-5 rounded-2xl border border-divider shadow-xs relative overflow-hidden group hover:border-violet transition">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold text-ink-2 uppercase tracking-wider">
                Rata-rata Order (AOV)
              </p>
              <h3 className="text-2xl font-black text-ink mt-1.5 tracking-tight">
                {formatRupiah(kpi.aov)}
              </h3>
            </div>
            <div className="h-10 w-10 rounded-xl bg-violet-soft text-violet border border-violet-line flex items-center justify-center shadow-2xs shrink-0">
              <ShoppingBag size={20} />
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-divider dark:border-divider flex items-center justify-between text-xs text-ink-2">
            <span>Nominal belanja rata-rata per transaksi</span>
          </div>
        </div>

        {/* Card 4: Repeat Customer Rate */}
        <div className="bg-surface p-4 sm:p-5 rounded-2xl border border-divider shadow-xs relative overflow-hidden group hover:border-warning transition">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold text-ink-2 uppercase tracking-wider">
                Rasio Pasien Langganan
              </p>
              <h3 className="text-2xl font-black text-ink mt-1.5 tracking-tight">
                {kpi.repeatRatePercentage}% <span className="text-sm font-semibold text-ink-2">Repeat</span>
              </h3>
            </div>
            <div className="h-10 w-10 rounded-xl bg-warning-soft text-warning border border-warning-line flex items-center justify-center shadow-2xs shrink-0">
              <Users size={20} />
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-divider dark:border-divider flex items-center justify-between text-xs text-ink-2">
            <span className="text-accent font-semibold">{kpi.repeatCustomersCount} Pasien Lama</span>
            <span className="text-info font-semibold">{kpi.newCustomersCount} Pasien Baru</span>
          </div>
        </div>
      </div>

      {/* Daily Revenue History Chart */}
      <div className="bg-surface p-4 sm:p-6 rounded-2xl border border-divider shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-ink flex items-center gap-2">
              <BarChart2 size={18} className="text-accent" />
              <span>Histori Pendapatan Harian ({data?.monthName} {selectedYear})</span>
            </h2>
            <p className="text-xs text-ink-2 mt-0.5">
              Grafik persebaran omset harian (Tgl 1 s/d {data?.dailyTrend?.length || 30})
            </p>
          </div>
          <div className="flex items-center space-x-3 text-xs font-semibold text-ink-2">
            <div className="flex items-center space-x-1.5">
              <div className="w-3 h-3 rounded bg-accent" />
              <span>Lunas</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <div className="w-3 h-3 rounded bg-warning" />
              <span>Tagih di Tempat</span>
            </div>
          </div>
        </div>

        <div className="h-72 w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data?.dailyTrend || []} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
              <XAxis
                dataKey="day"
                tickLine={false}
                stroke={chartTheme.axis.stroke}
                fontSize={11}
                tickFormatter={(d) => `Tgl ${d}`}
              />
              <YAxis
                tickLine={false}
                stroke={chartTheme.axis.stroke}
                fontSize={11}
                tickFormatter={(val) => formatCompactRupiah(val)}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const item = payload[0].payload as DailyRevenuePoint;
                    return (
                      <div className="bg-surface p-3 rounded-xl shadow-lg border border-divider text-xs space-y-1.5">
                        <p className="font-bold text-ink border-b border-divider dark:border-divider pb-1">
                          {item.dayName}, {item.dateStr}
                        </p>
                        <p className="text-accent font-bold">
                          ✓ Lunas: {formatRupiah(item.lunasRevenue)}
                        </p>
                        {item.pendingRevenue > 0 && (
                          <p className="text-warning font-semibold">
                            ⏳ Tagih: {formatRupiah(item.pendingRevenue)}
                          </p>
                        )}
                        <p className="text-ink font-bold pt-1 border-t border-divider dark:border-divider">
                          Total Omset: {formatRupiah(item.revenue)} ({item.bookingsCount} Pasien)
                        </p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar dataKey="lunasRevenue" stackId="a" fill={chartTheme.accent} radius={[0, 0, 0, 0]} />
              <Bar dataKey="pendingRevenue" stackId="a" fill={chartTheme.series[3]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Grid 2 Columns: Breakdowns & Leaderboards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Category Breakdown (Donut Chart) */}
        <div className="bg-surface p-4 sm:p-5 rounded-2xl border border-divider shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-ink flex items-center gap-2">
            <PieIcon size={16} className="text-accent" />
            <span>Kategori Layanan</span>
          </h2>
          <div className="h-56 w-full">
            {data?.categoryBreakdown && data.categoryBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.categoryBreakdown}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={4}
                    dataKey="revenue"
                    nameKey="label"
                  >
                    {data.categoryBreakdown.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(val: any) => [formatRupiah(Number(val)), 'Omset']}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-ink-3">
                Belum ada transaksi di bulan ini
              </div>
            )}
          </div>
          <div className="space-y-1.5 pt-2 border-t border-divider dark:border-divider text-xs">
            {(data?.categoryBreakdown || []).map((cat, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: CATEGORY_COLORS[idx % CATEGORY_COLORS.length] }}
                  />
                  <span className="font-semibold text-ink truncate max-w-[120px]">
                    {cat.label}
                  </span>
                </div>
                <div className="text-right font-mono">
                  <span className="font-bold text-ink">{formatCompactRupiah(cat.revenue)}</span>
                  <span className="text-ink-3 ml-1.5 text-[11px]">({cat.percentage}%)</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Middle: Payment Methods & Top Services */}
        <div className="bg-surface p-4 sm:p-5 rounded-2xl border border-divider shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-ink flex items-center gap-2">
            <CreditCard size={16} className="text-accent" />
            <span>Metode Pembayaran</span>
          </h2>
          <div className="space-y-2.5">
            {(data?.paymentBreakdown || []).map((pay, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-ink">{pay.label}</span>
                  <span className="font-mono font-bold text-accent">{formatRupiah(pay.revenue)} ({pay.percentage}%)</span>
                </div>
                <div className="h-2 w-full bg-fill-1 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${pay.percentage}%`,
                      backgroundColor: PAYMENT_COLORS[idx % PAYMENT_COLORS.length],
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-divider dark:border-divider space-y-3">
            <h3 className="text-xs font-bold text-ink-2 uppercase tracking-wider">
              Top Layanan Paling Laris
            </h3>
            <div className="space-y-2">
              {(data?.topServices || []).slice(0, 4).map((s, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs bg-surface-2 p-2 rounded-xl border border-divider">
                  <div className="flex items-center space-x-2 min-w-0 pr-2">
                    <span className="h-5 w-5 rounded-full bg-accent-soft text-accent flex items-center justify-center font-bold text-[10px] shrink-0">
                      {idx + 1}
                    </span>
                    <span className="font-semibold text-ink truncate">{cleanTreatmentName(stripBufferMetadata(s.serviceName))}</span>
                  </div>
                  <span className="font-bold text-accent shrink-0 font-mono text-[11px]">
                    {s.count}x ({formatCompactRupiah(s.estimatedRevenue)})
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Staff Leaderboard */}
        <div className="bg-surface p-4 sm:p-5 rounded-2xl border border-divider shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-ink flex items-center gap-2">
            <Award size={16} className="text-accent" />
            <span>Leaderboard Terapis</span>
          </h2>
          <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
            {data?.staffPerformance && data.staffPerformance.length > 0 ? (
              data.staffPerformance.map((staff, idx) => (
                <div
                  key={staff.staffId}
                  className="flex items-center justify-between p-2.5 bg-surface-2 hover:bg-accent-soft/40 dark:hover:bg-fill-1 rounded-xl border border-divider transition"
                >
                  <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                    <div className={`h-8 w-8 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                      idx === 0
                        ? 'bg-warning-soft text-warning border border-warning-line shadow-2xs'
                        : idx === 1
                        ? 'bg-fill-2 text-ink'
                        : 'bg-fill-2 text-ink-2'
                    }`}>
                      {idx + 1}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-xs text-ink truncate">
                        {staff.staffName}
                      </h4>
                      <p className="text-[10px] text-ink-2">
                        {staff.completedBookings} / {staff.totalBookings} kunjungan
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-xs text-accent font-mono">
                      {formatCompactRupiah(staff.revenueGenerated)}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-xs text-ink-3">
                Belum ada data penugasan terapis
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Transaction Ledger Table */}
      <div className="bg-surface rounded-2xl border border-divider shadow-xs overflow-hidden space-y-4">
        {/* Table Controls */}
        <div className="p-4 sm:p-5 border-b border-divider flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-ink-3">
              <Search size={14} />
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari pasien, ID, menu, atau terapis..."
              className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-fill-1 border-0 text-ink placeholder:text-ink-3 text-xs focus:outline-none focus:ring-2 focus:ring-accent min-h-[38px]"
            />
          </div>

          <div className="flex items-center space-x-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                statusFilter === 'ALL'
                  ? 'bg-accent text-accent-ink shadow-xs'
                  : 'bg-fill-1 text-ink-2 hover:bg-fill-2 dark:hover:bg-fill-2'
              }`}
            >
              Semua ({(data?.transactions || []).length})
            </button>
            <button
              onClick={() => setStatusFilter('LUNAS')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                statusFilter === 'LUNAS'
                  ? 'bg-accent text-accent-ink shadow-xs'
                  : 'bg-fill-1 text-ink-2 hover:bg-fill-2 dark:hover:bg-fill-2'
              }`}
            >
              ✓ Lunas
            </button>
            <button
              onClick={() => setStatusFilter('TAGIH_DI_TEMPAT')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                statusFilter === 'TAGIH_DI_TEMPAT'
                  ? 'bg-accent text-accent-ink shadow-xs'
                  : 'bg-fill-1 text-ink-2 hover:bg-fill-2 dark:hover:bg-fill-2'
              }`}
            >
              ⏳ Tagih di Tempat
            </button>
            <button
              onClick={() => setStatusFilter('SELESAI_BELUM_VERIFIKASI')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                statusFilter === 'SELESAI_BELUM_VERIFIKASI'
                  ? 'bg-accent text-accent-ink shadow-xs'
                  : 'bg-fill-1 text-ink-2 hover:bg-fill-2 dark:hover:bg-fill-2'
              }`}
            >
              Selesai — Belum Verifikasi
            </button>
          </div>
        </div>

        {/* Mobile Card Stack (< md) */}
        <div className="md:hidden divide-y divide-divider">
          {loading ? (
            <div className="py-8 text-center text-ink-3 text-xs">
              <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent mb-2"></div>
              <p>Memuat buku besar transaksi...</p>
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="py-8 text-center text-ink-3 text-xs px-4">
              Tidak ada catatan transaksi yang sesuai dengan filter.
            </div>
          ) : (
            filteredTransactions.map((tx) => (
              <div
                key={`mobile-tx-${tx.id}`}
                onClick={() => setSelectedTx(tx)}
                className="p-4 space-y-2.5 bg-surface hover:bg-surface-2 transition-colors cursor-pointer active:scale-[0.99] touch-manipulation"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-[11px] text-ink-3 flex items-center gap-1">
                      <Clock size={11} className="text-accent" />
                      <span>
                        {tx.bookingDate
                          ? new Date(tx.bookingDate).toLocaleString('id-ID', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '-'}
                      </span>
                    </span>
                    <h3 className="font-bold text-sm text-ink mt-0.5 flex items-center gap-1.5">
                      <span>{tx.customerName}</span>
                      {tx.isRepeatOrder && (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-accent-soft text-accent border border-divider dark:border-accent/30">
                          Repeat
                        </span>
                      )}
                    </h3>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="font-extrabold text-sm text-accent block font-mono">
                      {formatRupiah(tx.totalFee)}
                    </span>
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-bold mt-1 ${getLedgerPaymentClass(
                        tx.paymentStatus
                      )}`}
                    >
                      {getLedgerPaymentLabel(tx.paymentStatus)}
                    </span>
                  </div>
                </div>

                <div className="text-xs text-ink-2 line-clamp-1 font-medium">
                  {(() => {
                    const clean = stripBufferMetadata(tx.treatmentDetail);
                    return clean.split(/\s*\+\s*/).map((s) => cleanTreatmentName(s)).join(' + ') || clean;
                  })()}
                </div>

                <div className="flex items-center justify-between text-[11px] text-ink-3 pt-1 border-t border-divider dark:border-divider dark:border-divider">
                  <span className="truncate">
                    Terapis: <strong className="text-ink">{resolveStaffName(tx) || 'Belum ditugaskan'}</strong>
                  </span>
                  <span className="truncate">{tx.location || '-'}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Desktop Table (>= md) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs text-ink">
            <thead className="bg-surface-2 text-ink-2 uppercase text-[10px] font-bold border-b border-divider">
              <tr>
                <th className="py-3 px-4">Tanggal & Jam</th>
                <th className="py-3 px-4">Pasien</th>
                <th className="py-3 px-4">Layanan</th>
                <th className="py-3 px-4">Terapis</th>
                <th className="py-3 px-4">Lokasi</th>
                <th className="py-3 px-4 text-right">Total Tagihan</th>
                <th className="py-3 px-4">Status Bayar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-ink-3">
                    <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent mb-2"></div>
                    <p>Memuat buku besar transaksi...</p>
                  </td>
                </tr>
              ) : filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-ink-3">
                    Tidak ada catatan transaksi yang sesuai dengan filter.
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((tx) => (
                  <tr
                    key={tx.id}
                    onClick={() => setSelectedTx(tx)}
                    className="hover:bg-surface-2 transition-colors cursor-pointer group"
                  >
                    <td className="py-3 px-4 whitespace-nowrap font-mono text-[11px]">
                      {tx.bookingDate
                        ? new Date(tx.bookingDate).toLocaleString('id-ID', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '-'}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="font-bold text-ink group-hover:text-accent transition">
                        {tx.customerName}
                      </div>
                      <div className="text-[10px] text-ink-3 font-mono">
                        {tx.customerPhoneMasked}
                        {tx.isRepeatOrder && (
                          <span className="ml-1 text-accent font-bold">● Repeat</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 max-w-xs">
                      <div className="font-semibold text-ink truncate" title={stripBufferMetadata(tx.treatmentDetail)}>
                        {(() => {
                          const clean = stripBufferMetadata(tx.treatmentDetail);
                          return clean.split(/\s*\+\s*/).map((s) => cleanTreatmentName(s)).join(' + ') || clean;
                        })()}
                      </div>
                      <div className="text-[10px] text-ink-2">
                        Kategori: {tx.category}
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="font-semibold text-accent">
                        {tx.assignedStaffName}
                      </span>
                    </td>
                    <td className="py-3 px-4 max-w-xs truncate text-ink-2">
                      {tx.location}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-right font-mono font-bold text-ink">
                      {formatRupiah(tx.totalFee)}
                      {tx.deliveryFee > 0 && (
                        <div className="text-[10px] text-ink-3 font-normal">
                          Ongkir: {formatRupiah(tx.deliveryFee)}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${getLedgerPaymentClass(
                          tx.paymentStatus
                        )}`}
                      >
                        {tx.paymentStatus === 'LUNAS'
                          ? `✓ Lunas${tx.paymentMethod ? ` (${tx.paymentMethod})` : ''}`
                          : `⏳ ${getLedgerPaymentLabel(tx.paymentStatus)}`}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Transaction Detail Modal */}
      {selectedTx && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-surface w-full max-w-lg rounded-2xl shadow-2xl border border-divider overflow-hidden animate-scaleIn">
            <div className="p-4 sm:p-5 border-b border-divider flex items-center justify-between bg-surface-2">
              <div className="flex items-center space-x-2">
                <FileSpreadsheet size={18} className="text-accent" />
                <h3 className="font-bold text-sm text-ink">
                  Rincian Transaksi
                </h3>
              </div>
              <button
                onClick={() => setSelectedTx(null)}
                className="p-1 rounded-full text-ink-3 hover:text-ink hover:bg-surface transition"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="flex justify-between items-center bg-fill-1 dark:bg-surface-2 p-3 rounded-xl">
                <div>
                  <span className="text-[10px] text-ink-2 uppercase font-bold">No. Reservasi</span>
                  <p className="font-mono font-bold text-ink">{selectedTx.id}</p>
                </div>
                <div>
                  <span
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold ${getLedgerPaymentClass(
                      selectedTx.paymentStatus
                    )}`}
                  >
                    {selectedTx.paymentStatus === 'LUNAS'
                      ? '✓ LUNAS'
                      : `⏳ ${getLedgerPaymentLabel(selectedTx.paymentStatus).toUpperCase()}`}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-surface-2 rounded-xl border border-divider">
                  <span className="text-[10px] text-ink-2 uppercase font-bold">Pasien</span>
                  <p className="font-bold text-sm text-ink mt-0.5">{selectedTx.customerName}</p>
                  <p className="text-ink-3 font-mono text-[11px]">{selectedTx.customerPhoneMasked}</p>
                </div>
                <div className="p-3 bg-surface-2 rounded-xl border border-divider">
                  <span className="text-[10px] text-ink-2 uppercase font-bold">Terapis</span>
                  <p className="font-bold text-sm text-accent mt-0.5">{selectedTx.assignedStaffName}</p>
                  <p className="text-ink-3 text-[11px]">Penanggung Jawab</p>
                </div>
              </div>

              <div className="p-3 bg-surface-2 rounded-xl border border-divider space-y-1">
                <span className="text-[10px] text-ink-2 uppercase font-bold">Menu Treatment</span>
                <p className="font-semibold text-ink">{(() => {
                  const clean = stripBufferMetadata(selectedTx.treatmentDetail);
                  return clean.split(/\s*\+\s*/).map((s) => cleanTreatmentName(s)).join(' + ') || clean;
                })()}</p>
                <p className="text-[11px] text-ink-3">Kategori: {selectedTx.category}</p>
              </div>

              <div className="p-3 bg-surface-2 rounded-xl border border-divider space-y-1">
                <span className="text-[10px] text-ink-2 uppercase font-bold">Alamat / Lokasi</span>
                <p className="text-ink">{selectedTx.location}</p>
              </div>

              <div className="p-3.5 bg-emerald-50/60 dark:bg-emerald-950/20 rounded-xl border border-emerald-200 dark:border-emerald-800/40 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-ink-2">Biaya Layanan Treatment:</span>
                  <span className="font-mono font-bold text-ink">{formatRupiah(selectedTx.treatmentFee)}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-ink-2">Ongkos Kirim (Transport):</span>
                  <span className="font-mono font-bold text-ink">{formatRupiah(selectedTx.deliveryFee)}</span>
                </div>
                <div className="flex justify-between items-center text-sm font-black text-accent pt-2 border-t border-emerald-200 dark:border-emerald-800/40">
                  <span>TOTAL PEMBAYARAN:</span>
                  <span className="font-mono">{formatRupiah(selectedTx.totalFee)}</span>
                </div>
              </div>
            </div>

            <div className="p-4 bg-surface-2 border-t border-divider flex justify-end">
              <button
                onClick={() => setSelectedTx(null)}
                className="px-4 py-2 rounded-xl bg-accent text-accent-ink text-xs font-bold hover:bg-accent transition"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
