import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
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

export const Overview: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [healthData, setHealthData] = useState<any>(null);
  const [stats, setStats] = useState({
    incomingChats: 142,
    reservations: 12,
    revenue: 3600000,
    conversionRate: 8.45,
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
      const data = await apiRequest('/api/admin/health');
      setHealthData(data);
      
      // Load recent reservations to update stats count dynamically
      const reservations = await apiRequest('/api/admin/reservations/count');
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
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white">Overview</h2>
          <p className="text-slate-400">Real-time statistics & operational liveness metrics</p>
        </div>
        <button 
          onClick={() => { setLoading(true); fetchStatus(); }}
          className="flex items-center space-x-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl text-xs font-semibold text-slate-300 transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span>Refresh Metrics</span>
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Chat Masuk */}
        <div className="glass-card rounded-2xl p-6 relative overflow-hidden">
          <div className="flex justify-between items-start mb-4">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Chat Masuk</span>
              <p className="text-3xl font-extrabold text-white">{stats.incomingChats}</p>
            </div>
            <div className="p-3 rounded-xl bg-pink-500/10 text-pink-400">
              <MessageSquare size={20} />
            </div>
          </div>
          <div className="flex items-center text-xs text-emerald-400">
            <TrendingUp size={14} className="mr-1" />
            <span>+14.2% dari kemarin</span>
          </div>
        </div>

        {/* Reservasi */}
        <div className="glass-card rounded-2xl p-6 relative overflow-hidden">
          <div className="flex justify-between items-start mb-4">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Reservasi</span>
              <p className="text-3xl font-extrabold text-white">{stats.reservations}</p>
            </div>
            <div className="p-3 rounded-xl bg-purple-500/10 text-purple-400">
              <Calendar size={20} />
            </div>
          </div>
          <div className="flex items-center text-xs text-emerald-400">
            <TrendingUp size={14} className="mr-1" />
            <span>Reservasi masuk hari ini</span>
          </div>
        </div>

        {/* Est. Omset */}
        <div className="glass-card rounded-2xl p-6 relative overflow-hidden">
          <div className="flex justify-between items-start mb-4">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Est. Omset</span>
              <p className="text-2xl font-extrabold text-white truncate">{formatRevenue(stats.revenue)}</p>
            </div>
            <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400">
              <DollarSign size={20} />
            </div>
          </div>
          <div className="flex items-center text-xs text-emerald-400">
            <TrendingUp size={14} className="mr-1" />
            <span>+8% dibanding minggu lalu</span>
          </div>
        </div>

        {/* Conversion Rate */}
        <div className="glass-card rounded-2xl p-6 relative overflow-hidden">
          <div className="flex justify-between items-start mb-4">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Conversion Rate</span>
              <p className="text-3xl font-extrabold text-white">{stats.conversionRate}%</p>
            </div>
            <div className="p-3 rounded-xl bg-blue-500/10 text-blue-400">
              <TrendingUp size={20} />
            </div>
          </div>
          <div className="flex items-center text-xs text-slate-400">
            <span>Rasio leads menjadi reservasi</span>
          </div>
        </div>
      </div>

      {/* Analytics Chart Block */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Area Chart */}
        <div className="glass-panel rounded-2xl p-6 border border-white/5 lg:col-span-2 space-y-4">
          <div>
            <h3 className="text-base font-bold text-white">Lalu Lintas Pesan & Konversi</h3>
            <p className="text-xs text-slate-400">Perbandingan pesan masuk dan reservasi hari ini</p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorChats" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ec4899" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#ec4899" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorRes" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a855f7" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} />
                <Area type="monotone" dataKey="chats" name="Chat Masuk" stroke="#ec4899" strokeWidth={2} fillOpacity={1} fill="url(#colorChats)" />
                <Area type="monotone" dataKey="reservations" name="Reservasi" stroke="#a855f7" strokeWidth={2} fillOpacity={1} fill="url(#colorRes)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* BullMQ & Queue System Monitor */}
        <div className="glass-panel rounded-2xl p-6 border border-white/5 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Layers size={18} className="text-pink-400" />
              <h3 className="text-base font-bold text-white">Status Antrean System</h3>
            </div>
            <p className="text-xs text-slate-400">
              Pemantauan engine antrean BullMQ dan liveness engine WhatsApp
            </p>

            <div className="space-y-4 mt-6">
              {/* Queue Mode indicator */}
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-900/60 border border-white/5">
                <div className="flex items-center space-x-3">
                  <Server size={16} className="text-slate-400" />
                  <div>
                    <p className="text-xs text-slate-400">Database Queue Mode</p>
                    <p className="text-sm font-semibold text-slate-200">
                      {healthData?.redisQueue === 'BULLMQ_ACTIVE' ? 'BullMQ (Active Redis)' : 'In-Memory Fallback'}
                    </p>
                  </div>
                </div>
                <div className={`h-2.5 w-2.5 rounded-full ${healthData?.redisQueue === 'BULLMQ_ACTIVE' ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-amber-500 shadow-[0_0_8px_#f59e0b]'}`}></div>
              </div>

              {/* WAHA Engine Status */}
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-900/60 border border-white/5">
                <div className="flex items-center space-x-3">
                  <Activity size={16} className="text-slate-400" />
                  <div>
                    <p className="text-xs text-slate-400">WhatsApp Engine (WAHA)</p>
                    <p className="text-sm font-semibold text-slate-200">
                      {healthData?.wahaStatus || 'OFFLINE'}
                    </p>
                  </div>
                </div>
                <div className={`h-2.5 w-2.5 rounded-full ${healthData?.wahaStatus === 'WORKING' ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : healthData?.wahaStatus === 'SCAN_QR_CODE' ? 'bg-amber-500 shadow-[0_0_8px_#f59e0b]' : 'bg-rose-500 shadow-[0_0_8px_#f43f5e]'}`}></div>
              </div>

              {/* Haversine distance engine */}
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-900/60 border border-white/5">
                <div className="flex items-center space-x-3">
                  <Server size={16} className="text-slate-400" />
                  <div>
                    <p className="text-xs text-slate-400">Location Engine</p>
                    <p className="text-sm font-semibold text-slate-200">
                      Haversine (Fallback Active)
                    </p>
                  </div>
                </div>
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]"></div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-white/5 text-[10px] text-slate-500 flex justify-between">
            <span>Uptime: {healthData ? `${(healthData.systemUptimeSeconds / 3600).toFixed(2)} hours` : 'loading...'}</span>
            <span>OS: Windows</span>
          </div>
        </div>
      </div>
    </div>
  );
};
