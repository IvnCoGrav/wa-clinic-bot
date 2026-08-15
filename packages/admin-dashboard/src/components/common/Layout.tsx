import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { apiRequest } from '../../services/api';
import { BRAND } from '../../config/brand';
import { 
  LayoutDashboard, 
  CalendarRange, 
  BookOpen, 
  Terminal, 
  Settings as SettingsIcon, 
  LogOut, 
  Activity, 
  AlertCircle, 
  CheckCircle,
  Menu,
  X,
  MessageSquare,
  MessageSquareText,
  Volume2,
  Clock,
  Bug,
  Globe,
  Users,
  Headphones,
  Gauge,
  MousePointerClick,
  BadgeCheck,
  FileDown,
  UserCheck,
} from 'lucide-react';

import { ROLE_LABELS, hasAccess } from '../../config/rolePermissions';

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [wahaStatus, setWahaStatus] = useState<string>('UNKNOWN');
  const [redisQueueFallback, setRedisQueueFallback] = useState<boolean>(false);
  const [capiPendingCount, setCapiPendingCount] = useState<number>(0);

  useEffect(() => {
    async function fetchSystemHealth() {
      try {
        const data = await apiRequest('/api/admin/health');
        if (data && data.wahaStatus) {
          setWahaStatus(data.wahaStatus);
        }
        if (data && data.redisQueue === 'IN_MEMORY_FALLBACK_ACTIVE') {
          setRedisQueueFallback(true);
        } else {
          setRedisQueueFallback(false);
        }
      } catch (err) {
        setWahaStatus('DISCONNECTED');
      }
    }
    fetchSystemHealth();
    const interval = setInterval(fetchSystemHealth, 120000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    async function fetchCapiPending() {
      try {
        const data = await apiRequest('/api/admin/capi-queue');
        if (data && typeof data.pending === 'number') {
          setCapiPendingCount(data.pending);
        }
      } catch {
        // Silently ignore
      }
    }
    fetchCapiPending();
  }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    navigate('/admin/login');
  };

  const allNavItems: { name: string; path: string; icon: any; badge?: number }[] = [
    { name: 'Overview', path: '/admin/overview', icon: LayoutDashboard },
    { name: 'Customer Database', path: '/admin/customers', icon: Users },
    { name: 'Customer Service & CTA', path: '/admin/customer-service', icon: Headphones },
    { name: 'Reservations & Calendar', path: '/admin/reservations', icon: CalendarRange },
    { name: 'Staff & Terapis', path: '/admin/staff-management', icon: UserCheck },
    { name: 'Clinic Services', path: '/admin/services', icon: Activity },
    { name: 'Follow-Up Queue', path: '/admin/follow-ups', icon: Clock },
    { name: 'Follow-Up Templates', path: '/admin/follow-up-templates', icon: MessageSquareText },
    { name: 'Knowledge Base', path: '/admin/knowledge-base', icon: BookOpen },
    { name: 'AI Sandbox Simulator', path: '/admin/sandbox', icon: Terminal },
    { name: 'Live Chat Monitor', path: '/admin/live-chat', icon: MessageSquare },
    { name: 'AI Persona settings', path: '/admin/persona', icon: Volume2 },
    { name: 'Landing Page', path: '/admin/landing', icon: Globe },
    { name: 'Meta Click Catcher', path: '/admin/meta-click-catcher', icon: MousePointerClick },
    { name: 'Meta CAPI Queue', path: '/admin/meta-capi-queue', icon: BadgeCheck, badge: capiPendingCount },
    { name: 'Operational Settings', path: '/admin/settings', icon: SettingsIcon },
    { name: 'AI Quality Evaluation', path: '/admin/ai-evaluations', icon: Gauge },
    { name: 'Daily Chat Export (AI)', path: '/admin/chat-export', icon: FileDown },
    { name: 'System Debug', path: '/admin/debug', icon: Bug },
  ];

  const currentRole = user?.role || 'super_admin';
  const visibleNavItems = allNavItems.filter((item) => hasAccess(currentRole, item.path));

  return (
    <div className="min-h-screen bg-[#f0f2f5] text-[#111b21] flex flex-col md:flex-row">
      
      {/* Sidebar Navigation */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-[#e9edef] flex flex-col transform ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 transition-transform duration-300 ease-in-out shadow-xs`}>
        {/* Brand/Header */}
        <div className="h-16 border-b border-[#e9edef] bg-white flex items-center justify-between px-5">
          <div className="flex items-center space-x-2.5">
            <div className="h-8 w-8 rounded-lg bg-[#008069] flex items-center justify-center font-black text-white shadow-xs text-sm tracking-wider">K</div>
            <div className="flex flex-col">
              <span className="font-extrabold text-sm tracking-wider text-[#111b21] uppercase">KALA SPA</span>
              <span className="text-[10px] text-[#667781] font-medium leading-none">Management Bot</span>
            </div>
          </div>
          <button onClick={() => setMobileMenuOpen(false)} className="md:hidden text-[#8696a0] hover:text-[#111b21] p-1.5 rounded-lg hover:bg-[#f0f2f5]">
            <X size={18} />
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl transition-all duration-150 text-xs ${
                  isActive 
                    ? 'bg-[#e8f5f2] border-l-4 border-[#008069] text-[#008069] font-bold shadow-xs'
                    : 'text-[#54656f] hover:bg-[#f0f2f5] hover:text-[#111b21] font-medium'
                }`}
              >
                <Icon size={17} className={isActive ? 'text-[#008069]' : 'text-[#8696a0]'} />
                <span className="flex-1 truncate">{item.name}</span>
                {!!item.badge && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      isActive ? 'bg-[#008069] text-white' : 'bg-amber-100 text-amber-700 border border-amber-200'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* User profile / Logout */}
        <div className="p-3.5 border-t border-[#e9edef] bg-[#f8fafc] space-y-2">
          <div className="flex items-center justify-between">
            <div className="truncate pr-2">
              <p className="text-xs font-bold text-[#111b21] truncate">
                {user?.name || user?.email || 'Admin'}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-[#e8f5f2] text-[#008069] border border-[#c2e7e0]">
                  {ROLE_LABELS[currentRole as keyof typeof ROLE_LABELS] || currentRole}
                </span>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 rounded-xl bg-white hover:bg-rose-50 text-[#8696a0] hover:text-rose-600 border border-[#e9edef] transition-colors shadow-xs"
              title="Logout"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 md:pl-64 flex flex-col min-h-screen">
        
        {/* Top Header */}
        <header className="h-16 border-b border-[#e9edef] px-6 flex items-center justify-between bg-white/95 backdrop-blur-sm sticky top-0 z-40 shadow-xs">
          <div className="flex items-center space-x-3.5">
            <button 
              onClick={() => setMobileMenuOpen(true)} 
              className="md:hidden p-2 rounded-xl bg-[#f0f2f5] text-[#54656f] hover:text-[#111b21] hover:bg-[#e9edef]"
            >
              <Menu size={18} />
            </button>
            <h1 className="text-sm font-bold md:text-base text-[#111b21]">
              {BRAND.panelName}
            </h1>
          </div>

          {/* System Liveness Alerts */}
          <div className="flex items-center space-x-2">

            {/* Redis Queue Status — ikon saja + tooltip hover */}
            {redisQueueFallback && (
              <button
                title="Redis Fallback Mode: antrian pesan sementara disimpan di memori (DB/Redis tidak tersedia)."
                className="p-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-600 hover:bg-amber-100 transition"
              >
                <AlertCircle size={14} />
              </button>
            )}

            {/* WAHA Session Live Status — ikon saja + tooltip hover */}
            {wahaStatus === 'WORKING' ? (
              <button
                title="WhatsApp Connected — session WAHA aktif dan siap menerima/mengirim pesan."
                className="p-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600 hover:bg-emerald-100 transition flex items-center gap-1.5 px-2.5 text-xs font-semibold"
              >
                <CheckCircle size={13} />
                <span className="text-[11px]">Online</span>
              </button>
            ) : wahaStatus === 'SCAN_QR_CODE' ? (
              <button
                title="WA Scan QR diperlukan — perlu pindai QR untuk menghubungkan session WhatsApp. Buka Operational Settings."
                className="p-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-600 hover:bg-amber-100 transition flex items-center gap-1.5 px-2.5 text-xs font-semibold"
              >
                <Activity size={13} />
                <span className="text-[11px]">Scan QR</span>
              </button>
            ) : (
              <button
                title="WA Session Disconnected — koneksi WhatsApp terputus. Buka Operational Settings untuk menghubungkan ulang."
                className="p-1.5 rounded-full bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 transition animate-pulse flex items-center gap-1.5 px-2.5 text-xs font-semibold"
              >
                <AlertCircle size={13} />
                <span className="text-[11px]">Offline</span>
              </button>
            )}
          </div>
        </header>

        {/* Content Body */}
        <main className="flex-1 p-5 md:p-7 space-y-6 overflow-y-auto bg-[#f0f2f5]">
          {children}
        </main>
      </div>
    </div>
  );
};
