import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, getCachedApiResponse } from '../../services/api';
import { 
  MessageSquare, 
  Calendar, 
  DollarSign, 
  TrendingUp, 
  Server, 
  Activity, 
  Layers, 
  RefreshCw 
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar
} from 'recharts';
import { emitBootPhase } from '../../lib/bootProgress';
import { useTheme } from '../../contexts/ThemeContext';
import { APP_VERSION, BUILD_DATE, BUILD_TIME } from '../../config/version';

export const Overview: React.FC = () => {
  const { resolved } = useTheme();
  const isDark = resolved === 'dark';
  const gridStroke = isDark ? '#2a3942' : '#e9edef';
  const tooltipStyle = isDark
    ? { background: '#202c33', border: '1px solid #374248', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.4)', color: '#e9edef' }
    : { background: '#ffffff', border: '1px solid #e9edef', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', color: '#111b21' };
  const cachedHealth = getCachedApiResponse('/api/admin/health');
  const cachedResCount = getCachedApiResponse('/api/admin/reservations/count');

  const [loading, setLoading] = useState(!cachedHealth);
  const [healthData, setHealthData] = useState<any>(() => cachedHealth);
  const [stats, setStats] = useState(() => {
    const count = cachedResCount?.count ?? 12;
    return {
      incomingChats: 142,
      reservations: count,
      revenue: 3600000,
      conversionRate: count > 0 ? parseFloat(((count / 142) * 100).toFixed(2)) : 8.45,
    };
  });

  const chartData = [
    { name: '09:00', chats: 12, reservations: 1 },
    { name: '10:00', chats: 24, reservations: 2 },
    { name: '11:00', chats: 18, reservations: 1 },
    { name: '12:00', chats: 35, reservations: 3 },
    { name: '13:00', chats: 22, reservations: 2 },
    { name: '14:00', chats: 15, reservations: 1 },
    { name: '15:00', chats: 16, reservations: 2 },
  ];

  const fetchStatus = async () => {
    try {
      const [data, reservations] = await Promise.all([
        apiRequest('/api/admin/health'),
        apiRequest('/api/admin/reservations/count'),
      ]);
      setHealthData(data);
      
      // Load recent reservations to update stats count dynamically
      const count = reservations?.count ?? 0;
      setStats(prev => ({
        ...prev,
        reservations: count,
        conversionRate: count > 0 ? parseFloat(((count / prev.incomingChats) * 100).toFixed(2)) : 0
      }));
    } catch (err) {
      console.error('Failed to load dashboard overview health metrics:', err);
    } finally {
      setLoading(false);
      emitBootPhase('data');
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  const formatRevenue = (value: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0
    }).format(value);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-[#111b21]">Overview</h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#e8f5f2] text-[#008069] border border-[#c2e7e0]">
              {APP_VERSION}
            </span>
          </div>
          <p className="text-xs text-[#667781] mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span>Real-time statistics & operational liveness metrics</span>
            <span className="text-[#d1d7db]">·</span>
            <span className="text-[10px] text-[#8696a0] font-mono bg-white px-1.5 py-0.5 rounded border border-[#e9edef]">
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
            className="flex items-center space-x-2 px-3.5 py-2 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] rounded-xl text-xs font-semibold text-[#111b21] shadow-xs transition-colors"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin text-[#008069]' : 'text-[#667781]'} />
            <span>Refresh Metrics</span>
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {/* Chat Masuk */}
        <Link to="/admin/live-chat" className="bg-white border border-[#e9edef] hover:border-[#008069] rounded-2xl p-5 shadow-xs transition block group">
          <div className="flex justify-between items-start mb-3">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-[#667781] uppercase tracking-wider group-hover:text-[#008069] transition">Chat Masuk</span>
              <p className="text-2xl font-black text-[#111b21]">{stats.incomingChats}</p>
            </div>
            <div className="p-2.5 rounded-xl bg-[#e8f5f2] text-[#008069]">
              <MessageSquare size={18} />
            </div>
          </div>
          <div className="flex items-center text-xs text-emerald-700 font-semibold">
            <TrendingUp size={13} className="mr-1" />
            <span>+14.2% dari kemarin</span>
          </div>
        </Link>

        {/* Reservasi */}
        <Link to="/admin/reservations" className="bg-white border border-[#e9edef] hover:border-purple-500 rounded-2xl p-5 shadow-xs transition block group">
          <div className="flex justify-between items-start mb-3">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-[#667781] uppercase tracking-wider group-hover:text-purple-700 transition">Reservasi</span>
              <p className="text-2xl font-black text-[#111b21]">{stats.reservations}</p>
            </div>
            <div className="p-2.5 rounded-xl bg-purple-50 text-purple-700">
              <Calendar size={18} />
            </div>
          </div>
          <div className="flex items-center text-xs text-emerald-700 font-semibold">
            <TrendingUp size={13} className="mr-1" />
            <span>Reservasi masuk hari ini</span>
          </div>
        </Link>

        {/* Est. Omset */}
        <Link to="/admin/financial-analytics" className="bg-white border border-[#e9edef] hover:border-[#008069] rounded-2xl p-5 shadow-xs transition block group">
          <div className="flex justify-between items-start mb-3">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-[#667781] uppercase tracking-wider group-hover:text-[#008069] transition">Est. Omset</span>
              <p className="text-2xl font-black text-[#111b21] truncate">{formatRevenue(stats.revenue)}</p>
            </div>
            <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-700">
              <DollarSign size={18} />
            </div>
          </div>
          <div className="flex items-center text-xs text-emerald-700 font-semibold">
            <TrendingUp size={13} className="mr-1" />
            <span>Lihat laporan omset & histori →</span>
          </div>
        </Link>

        {/* Conversion Rate */}
        <div className="bg-white border border-[#e9edef] rounded-2xl p-5 shadow-xs">
          <div className="flex justify-between items-start mb-3">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-[#667781] uppercase tracking-wider">Conversion Rate</span>
              <p className="text-2xl font-black text-[#111b21]">{stats.conversionRate}%</p>
            </div>
            <div className="p-2.5 rounded-xl bg-sky-50 text-sky-700">
              <TrendingUp size={18} />
            </div>
          </div>
          <div className="flex items-center text-xs text-[#667781]">
            <span>Rasio leads menjadi reservasi</span>
          </div>
        </div>
      </div>

      {/* Analytics Chart Block */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Area Chart */}
        <div className="bg-white border border-[#e9edef] rounded-2xl p-5 lg:col-span-2 space-y-4 shadow-xs">
          <div>
            <h3 className="text-sm font-bold text-[#111b21]">Lalu Lintas Pesan & Konversi</h3>
            <p className="text-xs text-[#667781]">Perbandingan pesan masuk dan reservasi hari ini</p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorChats" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#008069" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="#008069" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorRes" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0284c7" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="#0284c7" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="name" stroke="#8696a0" fontSize={11} />
                <YAxis stroke="#8696a0" fontSize={11} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="chats" name="Chat Masuk" stroke="#008069" strokeWidth={2.5} fillOpacity={1} fill="url(#colorChats)" />
                <Area type="monotone" dataKey="reservations" name="Reservasi" stroke="#0284c7" strokeWidth={2.5} fillOpacity={1} fill="url(#colorRes)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* BullMQ & Queue System Monitor */}
        <div className="bg-white border border-[#e9edef] rounded-2xl p-5 flex flex-col justify-between shadow-xs">
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Layers size={18} className="text-[#008069]" />
              <h3 className="text-sm font-bold text-[#111b21]">Status Antrean System</h3>
            </div>
            <p className="text-xs text-[#667781]">
              Pemantauan engine antrean BullMQ dan liveness engine WhatsApp
            </p>

            <div className="space-y-3 mt-4">
              {/* Queue Mode indicator */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-[#f8fafc] border border-[#e9edef]">
                <div className="flex items-center space-x-3">
                  <Server size={16} className="text-[#8696a0]" />
                  <div>
                    <p className="text-[11px] text-[#667781]">Database Queue Mode</p>
                    <p className="text-xs font-bold text-[#111b21]">
                      {healthData?.redisQueue === 'BULLMQ_ACTIVE' ? 'BullMQ (Active Redis)' : 'In-Memory Fallback'}
                    </p>
                  </div>
                </div>
                <div className={`h-2.5 w-2.5 rounded-full ${healthData?.redisQueue === 'BULLMQ_ACTIVE' ? 'bg-emerald-500 shadow-xs' : 'bg-amber-500 shadow-xs'}`}></div>
              </div>

              {/* WAHA Engine Status */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-[#f8fafc] border border-[#e9edef]">
                <div className="flex items-center space-x-3">
                  <Activity size={16} className="text-[#8696a0]" />
                  <div>
                    <p className="text-[11px] text-[#667781]">WhatsApp Engine (WAHA)</p>
                    <p className="text-xs font-bold text-[#111b21]">
                      {healthData?.wahaStatus || 'OFFLINE'}
                    </p>
                  </div>
                </div>
                <div className={`h-2.5 w-2.5 rounded-full ${healthData?.wahaStatus === 'WORKING' ? 'bg-emerald-500 shadow-xs' : healthData?.wahaStatus === 'SCAN_QR_CODE' ? 'bg-amber-500 shadow-xs' : 'bg-rose-500 shadow-xs'}`}></div>
              </div>

              {/* Haversine distance engine */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-[#f8fafc] border border-[#e9edef]">
                <div className="flex items-center space-x-3">
                  <Server size={16} className="text-[#8696a0]" />
                  <div>
                    <p className="text-[11px] text-[#667781]">Location Engine</p>
                    <p className="text-xs font-bold text-[#111b21]">
                      Haversine (Fallback Active)
                    </p>
                  </div>
                </div>
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-xs"></div>
              </div>
            </div>
          </div>

          <div className="pt-3.5 border-t border-[#e9edef] text-[11px] text-[#667781] flex flex-wrap justify-between items-center gap-2">
            <span>Uptime: {healthData ? `${(healthData.systemUptimeSeconds / 3600).toFixed(2)} hours` : 'loading...'}</span>
            <span className="font-mono text-[10px] bg-white px-2 py-0.5 rounded border border-[#e9edef] text-[#8696a0]">
              Dashboard {APP_VERSION} ({BUILD_DATE} {BUILD_TIME})
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
