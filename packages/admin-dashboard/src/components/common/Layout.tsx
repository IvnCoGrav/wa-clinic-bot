import React, { useState, useEffect, useRef } from 'react';
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
  Tag,
} from 'lucide-react';

import { ROLE_LABELS, hasAccess } from '../../config/rolePermissions';
import { emitBootPhase } from '../../lib/bootProgress';

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [wahaStatus, setWahaStatus] = useState<string>('UNKNOWN');
  const [redisQueueFallback, setRedisQueueFallback] = useState<boolean>(false);
  const [capiPendingCount, setCapiPendingCount] = useState<number>(0);

  useEffect(() => {
    emitBootPhase('mount');
  }, []);

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

  const [showStatusPopover, setShowStatusPopover] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/admin/login');
  };

  interface NavItem {
    name: string;
    path: string;
    icon: any;
    badge?: number;
  }

  interface NavGroup {
    title: string;
    items: NavItem[];
  }

  const navGroups: NavGroup[] = [
    {
      title: 'Operasional & Jadwal',
      items: [
        { name: 'Overview', path: '/admin/overview', icon: LayoutDashboard },
        { name: 'Live Chat Monitor', path: '/admin/live-chat', icon: MessageSquare },
        { name: 'Reservations & Calendar', path: '/admin/reservations', icon: CalendarRange },
        { name: 'Customer Database', path: '/admin/customers', icon: Users },
        { name: 'Customer Labels', path: '/admin/labels', icon: Tag },
        { name: 'Customer Service & CTA', path: '/admin/customer-service', icon: Headphones },
        { name: 'Follow-Up Queue', path: '/admin/follow-ups', icon: Clock },
        { name: 'Follow-Up Templates', path: '/admin/follow-up-templates', icon: MessageSquareText },
      ],
    },
    {
      title: 'Staff & Layanan',
      items: [
        { name: 'Staff & Terapis', path: '/admin/staff-management', icon: UserCheck },
        { name: 'Clinic Services', path: '/admin/services', icon: Activity },
      ],
    },
    {
      title: 'Marketing & Ads',
      items: [
        { name: 'Landing Page', path: '/admin/landing', icon: Globe },
        { name: 'Meta Click Catcher', path: '/admin/meta-click-catcher', icon: MousePointerClick },
        { name: 'Meta CAPI Queue', path: '/admin/meta-capi-queue', icon: BadgeCheck, badge: capiPendingCount },
      ],
    },
    {
      title: 'AI Engine & Konten',
      items: [
        { name: 'Knowledge Base', path: '/admin/knowledge-base', icon: BookOpen },
        { name: 'AI Sandbox Simulator', path: '/admin/sandbox', icon: Terminal },
        { name: 'AI Persona settings', path: '/admin/persona', icon: Volume2 },
        { name: 'AI Quality Evaluation', path: '/admin/ai-evaluations', icon: Gauge },
        { name: 'Daily Chat Export (AI)', path: '/admin/chat-export', icon: FileDown },
      ],
    },
    {
      title: 'Pengaturan & Sistem',
      items: [
        { name: 'Operational Settings', path: '/admin/settings', icon: SettingsIcon },
        { name: 'System Debug', path: '/admin/debug', icon: Bug },
      ],
    },
  ];

  // Handle browser / hardware back button so it dismisses sidebar menu instead of navigating back
  useEffect(() => {
    if (!mobileMenuOpen) return;

    // Push dummy history state when menu opens
    window.history.pushState({ adminMenuOpen: true }, '');

    const handlePopState = () => {
      setMobileMenuOpen(false);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [mobileMenuOpen]);

  // Native DOM touch gesture listener with { passive: false } to reliably prevent browser history back
  useEffect(() => {
    let touchStartX = 0;
    let touchStartY = 0;
    let isTracking = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;

      // CRITICAL (iOS Safari / Android Chrome):
      // Prevent browser system navigation gesture at Frame 0 (touchstart) when touch starts at edge (<= 30px)
      if (!mobileMenuOpen && touchStartX <= 30) {
        if (e.cancelable) {
          e.preventDefault();
        }
      }

      // Allow opening by swiping from left zone (up to 120px from left)
      // OR allow closing by swiping left anywhere on screen when menu is already open
      const maxLeftZone = Math.min(window.innerWidth * 0.35, 120);
      if (mobileMenuOpen || touchStartX <= maxLeftZone) {
        isTracking = true;
      } else {
        isTracking = false;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isTracking || e.touches.length === 0) return;
      const touch = e.touches[0];
      const deltaX = touch.clientX - touchStartX;
      const deltaY = touch.clientY - touchStartY;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      const maxLeftZone = Math.min(window.innerWidth * 0.35, 120);

      // Case 1: When sidebar is CLOSED -> User is swiping from left zone towards right
      if (!mobileMenuOpen && touchStartX <= maxLeftZone) {
        // If horizontal movement to right is detected, intercept and prevent browser back navigation!
        if (deltaX > 8 && absX > absY * 1.1) {
          if (e.cancelable) {
            e.preventDefault();
          }
        }
        // Trigger sidebar open smoothly once threshold passed
        if (deltaX > 25 && absX > absY * 1.1) {
          setMobileMenuOpen(true);
          isTracking = false;
        }
        return;
      }

      // Case 2: When sidebar is OPEN -> User is swiping left anywhere to close
      if (mobileMenuOpen) {
        if (deltaX < -8 && absX > absY * 1.1) {
          if (e.cancelable) {
            e.preventDefault();
          }
        }
        if (deltaX < -25 && absX > absY * 1.1) {
          setMobileMenuOpen(false);
          isTracking = false;
        }
      }
    };

    const onTouchEnd = () => {
      isTracking = false;
    };

    window.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [mobileMenuOpen]);

  const currentRole = user?.role || 'super_admin';

  return (
    <div className="min-h-screen bg-[#f0f2f5] text-[#111b21] flex flex-col md:flex-row">
      {/* Mobile backdrop overlay with smooth fade */}
      <div
        onClick={() => setMobileMenuOpen(false)}
        className={`fixed inset-0 bg-black/40 z-40 md:hidden backdrop-blur-xs transition-opacity duration-300 ${
          mobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Sidebar Navigation */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-[#e9edef] flex flex-col transform ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 transition-transform duration-300 ease-out shadow-lg md:shadow-xs`}>
        {/* Brand/Header */}
        <div className="h-16 border-b border-[#e9edef] bg-white flex items-center justify-between px-5">
          <div className="flex items-center space-x-2.5">
            <div className="h-8 w-8 rounded-lg bg-[#008069] flex items-center justify-center font-black text-white shadow-xs text-sm tracking-wider">K</div>
            <div className="flex flex-col">
              <span className="font-extrabold text-sm tracking-wider text-[#111b21] uppercase">KALA SPA</span>
              <span className="text-[10px] text-[#667781] font-medium leading-none">Management Bot</span>
            </div>
          </div>
          <button
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Tutup menu"
            className="md:hidden text-[#8696a0] hover:text-[#111b21] p-2 rounded-xl hover:bg-[#f0f2f5] transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation Items (Grouped with Section Headers) */}
        <nav className="flex-1 px-3 py-3 space-y-4 overflow-y-auto">
          {navGroups.map((group) => {
            const visibleItems = group.items.filter((item) => hasAccess(currentRole, item.path));
            if (visibleItems.length === 0) return null;

            return (
              <div key={group.title} className="space-y-1">
                <div className="px-3 pt-1 pb-0.5 text-[10px] font-extrabold uppercase tracking-wider text-[#8696a0]">
                  {group.title}
                </div>
                {visibleItems.map((item) => {
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
              </div>
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
              className="p-2.5 rounded-xl bg-white hover:bg-rose-50 text-[#8696a0] hover:text-rose-600 border border-[#e9edef] transition-colors shadow-xs"
              title="Logout"
              aria-label="Logout"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 md:pl-64 flex flex-col min-h-screen">
        
        {/* Top Header */}
        <header className="h-16 border-b border-[#e9edef] px-4 sm:px-6 flex items-center justify-between bg-white/95 backdrop-blur-sm sticky top-0 z-40 shadow-xs">
          <div className="flex items-center space-x-3">
            <button 
              onClick={() => setMobileMenuOpen(true)} 
              aria-label="Buka Menu"
              className="md:hidden p-2 rounded-xl bg-[#f0f2f5] text-[#54656f] hover:text-[#111b21] hover:bg-[#e9edef] transition active:scale-95"
            >
              <Menu size={20} />
            </button>
            <h1 className="text-sm font-bold md:text-base text-[#111b21] truncate max-w-[160px] sm:max-w-none">
              {BRAND.panelName}
            </h1>
          </div>

          {/* System Liveness Alerts & Interactive Popover */}
          <div className="relative flex items-center space-x-2">
            {/* Redis Queue Status */}
            {redisQueueFallback && (
              <button
                onClick={() => setShowStatusPopover(!showStatusPopover)}
                className="p-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-600 hover:bg-amber-100 transition"
                title="Redis Fallback Aktif"
              >
                <AlertCircle size={15} />
              </button>
            )}

            {/* WAHA Session Live Status */}
            {wahaStatus === 'WORKING' ? (
              <button
                onClick={() => setShowStatusPopover(!showStatusPopover)}
                className="rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600 hover:bg-emerald-100 transition flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
              >
                <CheckCircle size={14} />
                <span className="text-[11px] font-bold">Online</span>
              </button>
            ) : wahaStatus === 'SCAN_QR_CODE' ? (
              <button
                onClick={() => setShowStatusPopover(!showStatusPopover)}
                className="rounded-full bg-amber-50 border border-amber-200 text-amber-600 hover:bg-amber-100 transition flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
              >
                <Activity size={14} />
                <span className="text-[11px] font-bold">Scan QR</span>
              </button>
            ) : (
              <button
                onClick={() => setShowStatusPopover(!showStatusPopover)}
                className="rounded-full bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 transition animate-pulse flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
              >
                <AlertCircle size={14} />
                <span className="text-[11px] font-bold">Offline</span>
              </button>
            )}

            {/* Interactive Status Popover for Mobile & Desktop Touch */}
            {showStatusPopover && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowStatusPopover(false)}
                />
                <div className="absolute right-0 top-full mt-2 w-72 sm:w-80 bg-white rounded-2xl shadow-xl border border-[#e9edef] p-4 text-xs z-50 space-y-3 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-center justify-between border-b border-[#e9edef] pb-2">
                    <span className="font-bold text-[#111b21] text-sm flex items-center gap-1.5">
                      <Activity size={15} className="text-[#008069]" />
                      Status Sistem
                    </span>
                    <button
                      onClick={() => setShowStatusPopover(false)}
                      className="text-[#8696a0] hover:text-[#111b21] p-1 rounded-lg hover:bg-[#f0f2f5]"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-[#f8fafc] border border-[#e9edef]">
                      {wahaStatus === 'WORKING' ? (
                        <CheckCircle size={16} className="text-emerald-600 mt-0.5 flex-shrink-0" />
                      ) : wahaStatus === 'SCAN_QR_CODE' ? (
                        <Activity size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
                      ) : (
                        <AlertCircle size={16} className="text-rose-600 mt-0.5 flex-shrink-0" />
                      )}
                      <div>
                        <p className="font-bold text-[#111b21]">WhatsApp (WAHA)</p>
                        <p className="text-[#667781] text-[11px] mt-0.5">
                          {wahaStatus === 'WORKING'
                            ? 'Sesi WAHA terhubung dan siap kirim/terima pesan pelanggan.'
                            : wahaStatus === 'SCAN_QR_CODE'
                            ? 'Perlu scan QR code WhatsApp di Operational Settings.'
                            : 'Koneksi WhatsApp terputus. Silakan hubungkan ulang di Settings.'}
                        </p>
                      </div>
                    </div>

                    {redisQueueFallback ? (
                      <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-amber-50 border border-amber-200">
                        <AlertCircle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-bold text-amber-900">Redis Fallback Mode</p>
                          <p className="text-amber-800 text-[11px] mt-0.5">
                            Antrean pesan sementara disimpan di in-memory buffer bot karena Redis tidak terhubung.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
                        <CheckCircle size={16} className="text-emerald-600 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-bold text-emerald-900">Redis & Antrean Aktif</p>
                          <p className="text-emerald-800 text-[11px] mt-0.5">
                            Antrean pesan terdistribusi berjalan normal.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="pt-1">
                    <Link
                      to="/admin/settings"
                      onClick={() => setShowStatusPopover(false)}
                      className="block text-center py-2 px-3 rounded-xl bg-[#f0f2f5] hover:bg-[#e9edef] text-[#111b21] font-semibold text-xs transition"
                    >
                      Buka Operational Settings →
                    </Link>
                  </div>
                </div>
              </>
            )}
          </div>
        </header>

        {/* Content Body */}
        <main className="flex-1 p-4 sm:p-5 md:p-7 space-y-6 overflow-y-auto bg-[#f0f2f5]">
          {children}
        </main>
      </div>
    </div>
  );
};
