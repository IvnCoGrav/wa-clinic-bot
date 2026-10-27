import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { refreshApi, getCachedApiResponse } from '../../services/api';
import { 
  MessageSquare, 
  Calendar, 
  DollarSign, 
  TrendingUp, 
  Server, 
  Activity, 
  Layers, 
  RefreshCw,
  AlertTriangle
} from 'lucide-react';
import { 
  ComposedChart,
  Area, 
  Line,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer
} from 'recharts';
import { emitBootPhase } from '../../lib/bootProgress';
import { useTheme } from '../../contexts/ThemeContext';
import { APP_VERSION, BUILD_DATE, BUILD_TIME } from '../../config/version';
import { pickNumber, hasChartData, formatRupiah } from '../../lib/dashboard-metrics';

export const Overview: React.FC = () => {
  const { resolved } = useTheme();
  const isDark = resolved === 'dark';
  const gridStroke = isDark ? '#2a3942' : '#e9edef';
  const tooltipStyle = isDark
    ? { background: '#202c33', border: '1px solid #374248', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.4)', color: '#e9edef' }
    : { background: '#ffffff', border: '1px solid #e9edef', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', color: '#111b21' };
  
  const cachedHealth = getCachedApiResponse('/api/admin/health');

  const [loading, setLoading] = useState(!cachedHealth);
  const [error, setError] = useState<string | null>(null);
  const [healthData, setHealthData] = useState<any>(() => cachedHealth);
  const [chats, setChats] = useState<number | null>(null);
  const [reservationsToday, setReservationsToday] = useState<number | null>(null);
  const [revenueMonth, setRevenueMonth] = useState<number | null>(null);
  const [aovMonth, setAovMonth] = useState<number | null>(null);
  const [chartData, setChartData] = useState<{ name: string; revenue: number; bookings: number }[]>([]);
  const [chartLabel, setChartLabel] = useState('');

  const fetchStatus = async () => {
    try {
      setError(null);
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const todayWib = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

      const [health, resCount, analytics, chatList] = await Promise.all([
        refreshApi<any>('/api/admin/health'),
        refreshApi<any>(`/api/admin/reservations/count?date=${todayWib}&refresh=1`),
        refreshApi<any>(`/api/admin/financial-analytics?year=${year}&month=${month}`),
        refreshApi<any>('/api/admin/live-chat/conversations?limit=1'),
      ]);

      setHealthData(health);
      setReservationsToday(pickNumber(resCount?.count));
      setChats(pickNumber(chatList?.total));

      const d = analytics?.data;
      setRevenueMonth(pickNumber(d?.kpi?.totalRevenue));
      setAovMonth(pickNumber(d?.kpi?.aov));
      setChartLabel(d?.monthName ? `${d.monthName} ${d.year}` : '');
      setChartData(
        Array.isArray(d?.dailyTrend)
          ? d.dailyTrend.map((x: any) => ({
              name: String(x.day),
              revenue: x.revenue || 0,
              bookings: x.bookingsCount || 0,
            }))
          : []
      );
    } catch (err: any) {
      console.error('Failed to load dashboard overview metrics:', err);
      setError('Gagal memuat metrik. Angka tidak ditampilkan agar tidak menyesatkan.');
    } finally {
      setLoading(false);
      emitBootPhase('data');
    }
  };

  useEffect(() => {
    fetchStatus();
    // Heartbeat: count & health tiap 60 detik
    const countInterval = setInterval(async () => {
      try {
        const todayWib = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
        const [health, resCount, chatList] = await Promise.all([
          refreshApi<any>('/api/admin/health'),
          refreshApi<any>(`/api/admin/reservations/count?date=${todayWib}&refresh=1`),
          refreshApi<any>('/api/admin/live-chat/conversations?limit=1'),
        ]);
        setHealthData(health);
        setReservationsToday(pickNumber(resCount?.count));
        setChats(pickNumber(chatList?.total));
      } catch (err) {
        console.warn('Silent refresh metrics failed:', err);
      }
    }, 60000);

    // Refresh analitik bulanan tiap 5 menit (hindari query berat tiap menit)
    const analyticsInterval = setInterval(async () => {
      try {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const analytics = await refreshApi<any>(`/api/admin/financial-analytics?year=${year}&month=${month}`);
        const d = analytics?.data;
        setRevenueMonth(pickNumber(d?.kpi?.totalRevenue));
        setAovMonth(pickNumber(d?.kpi?.aov));
        setChartLabel(d?.monthName ? `${d.monthName} ${d.year}` : '');
        setChartData(
          Array.isArray(d?.dailyTrend)
            ? d.dailyTrend.map((x: any) => ({
                name: String(x.day),
                revenue: x.revenue || 0,
                bookings: x.bookingsCount || 0,
              }))
            : []
        );
      } catch (err) {
        console.warn('Silent analytics refresh failed:', err);
      }
    }, 300000);

    return () => {
      clearInterval(countInterval);
      clearInterval(analyticsInterval);
    };
  }, []);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-[#111b21] dark:text-[#e9edef]">Overview</h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#e8f5f2] text-[#008069] border border-[#c2e7e0]">
              {APP_VERSION}
            </span>
          </div>
          <p className="text-xs text-[#667781] mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span>Statistik operasional riil & metrik konektivitas</span>
            <span className="text-[#d1d7db]">·</span>
            <span className="text-[10px] text-[#8696a0] font-mono bg-white dark:bg-[#202c33] px-1.5 py-0.5 rounded border border-[#e9edef] dark:border-[#374248]">
              Update: {BUILD_DATE}, {BUILD_TIME}
            </span>
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Link
            to="/admin/financial-analytics"
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-bold shadow-xs transition-colors"
          >
            <TrendingUp size={14} />
            <span>Dashboard Transaksi & Omset →</span>
          </Link>
          <button 
            onClick={() => { setLoading(true); fetchStatus(); }}
            className="flex items-center space-x-2 px-3.5 py-2 bg-white dark:bg-[#202c33] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] border border-[#d1d7db] dark:border-[#374248] rounded-xl text-xs font-semibold text-[#111b21] dark:text-[#e9edef] shadow-xs transition-colors"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin text-[#008069]' : 'text-[#667781]'} />
            <span>Refresh Metrics</span>
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-800 dark:text-rose-300">
          <span className="flex items-center gap-2"><AlertTriangle size={14} /> {error}</span>
          <button onClick={() => { setLoading(true); fetchStatus(); }} className="font-bold underline">Coba lagi</button>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {/* Chat Masuk */}
        <Link to="/admin/live-chat" className="bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] hover:border-[#008069] rounded-2xl p-5 shadow-xs transition block group">
          <div className="flex justify-between items-start mb-3">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-[#667781] uppercase tracking-wider group-hover:text-[#008069] transition">Total Percakapan</span>
              <p className="text-2xl font-black text-[#111b21] dark:text-[#e9edef]">
                {chats !== null ? chats : <span className="text-gray-400 font-normal text-xl" title="Data tidak tersedia">—</span>}
              </p>
            </div>
            <div className="p-2.5 rounded-xl bg-[#e8f5f2] dark:bg-emerald-950/50 text-[#008069]">
              <MessageSquare size={18} />
            </div>
          </div>
          <div className="flex items-center text-xs text-[#667781]">
            <span>Seluruh percakapan tercatat</span>
          </div>
        </Link>

        {/* Reservasi Masuk Hari Ini */}
        <Link to="/admin/reservations" className="bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] hover:border-purple-500 rounded-2xl p-5 shadow-xs transition block group">
          <div className="flex justify-between items-start mb-3">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-[#667781] uppercase tracking-wider group-hover:text-purple-700 transition">Reservasi Masuk Hari Ini</span>
              <p className="text-2xl font-black text-[#111b21] dark:text-[#e9edef]">
                {reservationsToday !== null ? reservationsToday : <span className="text-gray-400 font-normal text-xl" title="Data tidak tersedia">—</span>}
              </p>
            </div>
            <div className="p-2.5 rounded-xl bg-purple-50 dark:bg-purple-950/50 text-purple-700">
              <Calendar size={18} />
            </div>
          </div>
          <div className="flex items-center text-xs text-[#667781]">
            <span>Dihitung dari waktu masuk (WIB)</span>
          </div>
        </Link>

        {/* Omset Bulan Ini */}
        <Link to="/admin/financial-analytics" className="bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] hover:border-[#008069] rounded-2xl p-5 shadow-xs transition block group">
          <div className="flex justify-between items-start mb-3">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-[#667781] uppercase tracking-wider group-hover:text-[#008069] transition">Omset Bulan Ini</span>
              <p className="text-2xl font-black text-[#111b21] dark:text-[#e9edef] truncate">
                {formatRupiah(revenueMonth)}
              </p>
            </div>
            <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700">
              <DollarSign size={18} />
            </div>
          </div>
          <div className="flex items-center text-xs text-[#667781]">
            <span>{chartLabel ? `Bulan ${chartLabel}` : 'Bulan berjalan'}</span>
          </div>
        </Link>

        {/* Rata-rata Nilai Reservasi (AOV) */}
        <div className="bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] rounded-2xl p-5 shadow-xs">
          <div className="flex justify-between items-start mb-3">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-[#667781] uppercase tracking-wider">Rata-rata Nilai (AOV)</span>
              <p className="text-2xl font-black text-[#111b21] dark:text-[#e9edef]">
                {formatRupiah(aovMonth)}
              </p>
            </div>
            <div className="p-2.5 rounded-xl bg-sky-50 dark:bg-sky-950/50 text-sky-700">
              <TrendingUp size={18} />
            </div>
          </div>
          <div className="flex items-center text-xs text-[#667781]">
            <span>Bulan berjalan (AOV)</span>
          </div>
        </div>
      </div>

      {/* Analytics Chart Block */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Composed Chart */}
        <div className="bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] rounded-2xl p-5 lg:col-span-2 space-y-4 shadow-xs">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-sm font-bold text-[#111b21] dark:text-[#e9edef]">Omset & Reservasi Harian</h3>
              <p className="text-xs text-[#667781]">
                {chartLabel ? `Tren transaksi bulan ${chartLabel}` : 'Tren transaksi harian bulan berjalan'}
              </p>
            </div>
            <Link to="/admin/financial-analytics" className="text-xs font-bold text-[#008069] hover:underline">
              Detail Transaksi →
            </Link>
          </div>

          <div className="h-72">
            {hasChartData(chartData) ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#008069" stopOpacity={0.25}/>
                      <stop offset="95%" stopColor="#008069" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis dataKey="name" stroke="#8696a0" fontSize={11} tickFormatter={(val) => `Tgl ${val}`} />
                  <YAxis yAxisId="left" stroke="#008069" fontSize={11} tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`} />
                  <YAxis yAxisId="right" orientation="right" stroke="#0284c7" fontSize={11} allowDecimals={false} />
                  <Tooltip 
                    contentStyle={tooltipStyle}
                    formatter={(value: any, name: string) => {
                      if (name === 'Omset (Rp)') return [formatRupiah(Number(value)), name];
                      return [value, name];
                    }}
                  />
                  <Area yAxisId="left" type="monotone" dataKey="revenue" name="Omset (Rp)" stroke="#008069" strokeWidth={2.5} fillOpacity={1} fill="url(#colorRevenue)" />
                  <Line yAxisId="right" type="monotone" dataKey="bookings" name="Reservasi" stroke="#0284c7" strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center gap-2">
                <Activity size={28} className="text-[#8696a0]" />
                <p className="text-sm font-bold text-[#111b21] dark:text-[#e9edef]">Belum ada transaksi tercatat bulan ini</p>
                <p className="text-xs text-[#667781]">Grafik akan terisi otomatis setelah reservasi pertama pada bulan berjalan.</p>
                <Link to="/admin/financial-analytics" className="text-xs font-bold text-[#008069]">Buka Dashboard Transaksi →</Link>
              </div>
            )}
          </div>
        </div>

        {/* BullMQ & Queue System Monitor */}
        <div className="bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] rounded-2xl p-5 flex flex-col justify-between shadow-xs">
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Layers size={18} className="text-[#008069]" />
              <h3 className="text-sm font-bold text-[#111b21] dark:text-[#e9edef]">Status Antrean System</h3>
            </div>
            <p className="text-xs text-[#667781]">
              Pemantauan engine antrean BullMQ dan liveness engine WhatsApp
            </p>

            <div className="space-y-3 mt-4">
              {/* Queue Mode indicator */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-[#f8fafc] dark:bg-[#202c33] border border-[#e9edef] dark:border-[#374248]">
                <div className="flex items-center space-x-3">
                  <Server size={16} className="text-[#8696a0]" />
                  <div>
                    <p className="text-[11px] text-[#667781]">Database Queue Mode</p>
                    <p className="text-xs font-bold text-[#111b21] dark:text-[#e9edef]">
                      {healthData?.redisQueue === 'BULLMQ_ACTIVE' ? 'BullMQ (Active Redis)' : 'In-Memory Fallback'}
                    </p>
                  </div>
                </div>
                <div className={`h-2.5 w-2.5 rounded-full ${healthData?.redisQueue === 'BULLMQ_ACTIVE' ? 'bg-emerald-500 shadow-xs' : 'bg-amber-500 shadow-xs'}`}></div>
              </div>

              {/* WAHA Engine Status */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-[#f8fafc] dark:bg-[#202c33] border border-[#e9edef] dark:border-[#374248]">
                <div className="flex items-center space-x-3">
                  <Activity size={16} className="text-[#8696a0]" />
                  <div>
                    <p className="text-[11px] text-[#667781]">WhatsApp Engine (WAHA)</p>
                    <p className="text-xs font-bold text-[#111b21] dark:text-[#e9edef]">
                      {healthData?.wahaStatus || 'OFFLINE'}
                    </p>
                  </div>
                </div>
                <div className={`h-2.5 w-2.5 rounded-full ${healthData?.wahaStatus === 'WORKING' ? 'bg-emerald-500 shadow-xs' : healthData?.wahaStatus === 'SCAN_QR_CODE' ? 'bg-amber-500 shadow-xs' : 'bg-rose-500 shadow-xs'}`}></div>
              </div>

              {/* Haversine distance engine */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-[#f8fafc] dark:bg-[#202c33] border border-[#e9edef] dark:border-[#374248]">
                <div className="flex items-center space-x-3">
                  <Server size={16} className="text-[#8696a0]" />
                  <div>
                    <p className="text-[11px] text-[#667781]">Location Engine</p>
                    <p className="text-xs font-bold text-[#111b21] dark:text-[#e9edef]">
                      Haversine (Fallback Active)
                    </p>
                  </div>
                </div>
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-xs"></div>
              </div>
            </div>
          </div>

          <div className="pt-3.5 border-t border-[#e9edef] dark:border-[#374248] text-[11px] text-[#667781] flex flex-wrap justify-between items-center gap-2">
            <span>Uptime: {healthData ? `${(healthData.systemUptimeSeconds / 3600).toFixed(2)} hours` : 'loading...'}</span>
            <span className="text-[10px] text-[#8696a0]">
              Status server operasional aktif
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
