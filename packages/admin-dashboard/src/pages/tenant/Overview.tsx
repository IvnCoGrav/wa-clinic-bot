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
import { APP_VERSION, BUILD_DATE, BUILD_TIME } from '../../config/version';
import { pickNumber, hasChartData, formatRupiah } from '../../lib/dashboard-metrics';
import { Card } from '../../components/ui/Card';
import { KpiCard } from '../../components/ui/KpiCard';
import { Button } from '../../components/ui/Button';

export const Overview: React.FC = () => {
  const gridStroke = 'rgb(var(--c-divider))';
  const tooltipStyle = {
    background: 'rgb(var(--c-surface))',
    border: '1px solid rgb(var(--c-divider))',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    color: 'rgb(var(--c-ink))',
  };
  
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
        console.warn('Silent overview refresh failed:', err);
      }
    }, 60000);

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
            <h2 className="text-xl font-bold tracking-tight text-ink">Overview</h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-accent-soft text-accent border border-accent/30">
              {APP_VERSION}
            </span>
          </div>
          <p className="text-xs text-ink-3 mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span>Statistik operasional riil & metrik konektivitas</span>
            <span className="text-divider">·</span>
            <span className="text-[10px] text-ink-2 font-mono bg-surface-2 px-1.5 py-0.5 rounded border border-divider">
              Update: {BUILD_DATE}, {BUILD_TIME}
            </span>
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Link
            to="/admin/financial-analytics"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-accent hover:bg-accent-hover text-accent-ink rounded-xl text-xs font-bold shadow-xs transition duration-150 active:scale-[0.98]"
          >
            <TrendingUp size={14} />
            <span>Dashboard Transaksi & Omset →</span>
          </Link>
          <Button 
            variant="neutral"
            size="sm"
            onClick={() => { setLoading(true); fetchStatus(); }}
            loading={loading}
            icon={<RefreshCw size={13} className={loading ? 'animate-spin' : ''} />}
          >
            Refresh Metrics
          </Button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-danger-soft border border-danger-line text-xs text-danger">
          <span className="flex items-center gap-2"><AlertTriangle size={14} /> {error}</span>
          <button onClick={() => { setLoading(true); fetchStatus(); }} className="font-bold underline cursor-pointer">Coba lagi</button>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        <Link to="/admin/live-chat" className="block group">
          <KpiCard
            label="Total Percakapan"
            value={chats !== null ? chats : '—'}
            hint="Seluruh percakapan tercatat"
            icon={<MessageSquare size={18} className="text-accent" />}
            hoverable
          />
        </Link>

        <Link to="/admin/reservations" className="block group">
          <KpiCard
            label="Reservasi Masuk Hari Ini"
            value={reservationsToday !== null ? reservationsToday : '—'}
            hint="Dihitung dari waktu masuk (WIB)"
            icon={<Calendar size={18} className="text-info" />}
            hoverable
          />
        </Link>

        <Link to="/admin/financial-analytics" className="block group">
          <KpiCard
            label="Omset Bulan Ini"
            value={formatRupiah(revenueMonth)}
            hint={chartLabel ? `Bulan ${chartLabel}` : 'Bulan berjalan'}
            icon={<DollarSign size={18} className="text-success" />}
            hoverable
          />
        </Link>

        <KpiCard
          label="Rata-rata Nilai (AOV)"
          value={formatRupiah(aovMonth)}
          hint="Bulan berjalan (AOV)"
          icon={<TrendingUp size={18} className="text-info" />}
        />
      </div>

      {/* Analytics Chart Block */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Composed Chart */}
        <Card className="lg:col-span-2 p-5 space-y-4">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-sm font-bold text-ink">Omset & Reservasi Harian</h3>
              <p className="text-xs text-ink-3">
                {chartLabel ? `Tren transaksi bulan ${chartLabel}` : 'Tren transaksi harian bulan berjalan'}
              </p>
            </div>
            <Link to="/admin/financial-analytics" className="text-xs font-bold text-accent hover:underline">
              Detail Transaksi →
            </Link>
          </div>

          <div className="h-72">
            {hasChartData(chartData) ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="rgb(var(--c-accent))" stopOpacity={0.25}/>
                      <stop offset="95%" stopColor="rgb(var(--c-accent))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis dataKey="name" stroke="rgb(var(--c-ink-3))" fontSize={11} tickFormatter={(val) => `Tgl ${val}`} />
                  <YAxis yAxisId="left" stroke="rgb(var(--c-accent))" fontSize={11} tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`} />
                  <YAxis yAxisId="right" orientation="right" stroke="rgb(var(--c-info))" fontSize={11} allowDecimals={false} />
                  <Tooltip 
                    contentStyle={tooltipStyle}
                    formatter={(value: any, name: string) => {
                      if (name === 'Omset (Rp)') return [formatRupiah(Number(value)), name];
                      return [value, name];
                    }}
                  />
                  <Area yAxisId="left" type="monotone" dataKey="revenue" name="Omset (Rp)" stroke="rgb(var(--c-accent))" strokeWidth={2.5} fillOpacity={1} fill="url(#colorRevenue)" />
                  <Line yAxisId="right" type="monotone" dataKey="bookings" name="Reservasi" stroke="rgb(var(--c-info))" strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center gap-2">
                <Activity size={28} className="text-ink-3" />
                <p className="text-sm font-bold text-ink">Belum ada transaksi tercatat bulan ini</p>
                <p className="text-xs text-ink-3">Grafik akan terisi otomatis setelah reservasi pertama pada bulan berjalan.</p>
                <Link to="/admin/financial-analytics" className="text-xs font-bold text-accent">Buka Dashboard Transaksi →</Link>
              </div>
            )}
          </div>
        </Card>

        {/* BullMQ & Queue System Monitor */}
        <Card className="p-5 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Layers size={18} className="text-accent" />
              <h3 className="text-sm font-bold text-ink">Status Antrean System</h3>
            </div>
            <p className="text-xs text-ink-3">
              Pemantauan engine antrean BullMQ dan liveness engine WhatsApp
            </p>

            <div className="space-y-3 mt-4">
              {/* Queue Mode indicator */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-surface-2 border border-divider">
                <div className="flex items-center space-x-3">
                  <Server size={16} className="text-ink-3" />
                  <div>
                    <p className="text-[11px] text-ink-3">Database Queue Mode</p>
                    <p className="text-xs font-bold text-ink">
                      {healthData?.redisQueue === 'BULLMQ_ACTIVE' ? 'BullMQ (Active Redis)' : 'In-Memory Fallback'}
                    </p>
                  </div>
                </div>
                <div className={`h-2.5 w-2.5 rounded-full ${healthData?.redisQueue === 'BULLMQ_ACTIVE' ? 'bg-success shadow-xs' : 'bg-warning shadow-xs'}`}></div>
              </div>

              {/* WAHA Engine Status */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-surface-2 border border-divider">
                <div className="flex items-center space-x-3">
                  <Activity size={16} className="text-ink-3" />
                  <div>
                    <p className="text-[11px] text-ink-3">WhatsApp Engine (WAHA)</p>
                    <p className="text-xs font-bold text-ink">
                      {healthData?.wahaStatus || 'OFFLINE'}
                    </p>
                  </div>
                </div>
                <div className={`h-2.5 w-2.5 rounded-full ${healthData?.wahaStatus === 'WORKING' ? 'bg-success shadow-xs' : healthData?.wahaStatus === 'SCAN_QR_CODE' ? 'bg-warning shadow-xs' : 'bg-danger shadow-xs'}`}></div>
              </div>

              {/* Haversine distance engine */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-surface-2 border border-divider">
                <div className="flex items-center space-x-3">
                  <Server size={16} className="text-ink-3" />
                  <div>
                    <p className="text-[11px] text-ink-3">Location Engine</p>
                    <p className="text-xs font-bold text-ink">
                      Haversine (Fallback Active)
                    </p>
                  </div>
                </div>
                <div className="h-2.5 w-2.5 rounded-full bg-success shadow-xs"></div>
              </div>
            </div>
          </div>

          <div className="pt-3.5 border-t border-divider text-[11px] text-ink-3 flex flex-wrap justify-between items-center gap-2">
            <span>Uptime: {healthData ? `${(healthData.systemUptimeSeconds / 3600).toFixed(2)} hours` : 'loading...'}</span>
            <span className="text-[10px] text-ink-3">
              Status server operasional aktif
            </span>
          </div>
        </Card>
      </div>
    </div>
  );
};
