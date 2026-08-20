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
  VolumeX,
  Bell,
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
  Database,
  QrCode,
  Loader,
  RefreshCw,
  Sparkles,
} from 'lucide-react';

import { ROLE_LABELS, hasAccess, getCustomRoles } from '../../config/rolePermissions';
import { emitBootPhase } from '../../lib/bootProgress';
import { useLiveChatNotification } from '../../hooks/useLiveChatNotification';
import { useUiFeedback } from './UiFeedback';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuth();
  const { toast } = useUiFeedback();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const currentRole = user?.role || 'super_admin';
  const [customRoles, setCustomRoles] = useState(() => getCustomRoles());

  useBodyScrollLock(mobileMenuOpen);

  useEffect(() => {
    const handleRolesUpdate = () => {
      setCustomRoles({ ...getCustomRoles() });
    };
    window.addEventListener('roles-updated', handleRolesUpdate);
    return () => window.removeEventListener('roles-updated', handleRolesUpdate);
  }, []);

  // Global Real-time Live Chat Notification & Sound Hook (RBAC Filtered)
  const {
    incomingToast,
    dismissToast,
    openChatFromToast,
    soundActive,
    toggleSound,
    playTestSound,
    requestPushPermission,
    unreadLiveChatCount,
    canAccessLiveChat,
  } = useLiveChatNotification(currentRole);
  const [wahaStatus, setWahaStatus] = useState<string>('UNKNOWN');
  const [redisQueueFallback, setRedisQueueFallback] = useState<boolean>(false);
  const [capiPendingCount, setCapiPendingCount] = useState<number>(0);

  useEffect(() => {
    emitBootPhase('mount');
    emitBootPhase('done');
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
        { name: 'Live Chat Monitor', path: '/admin/live-chat', icon: MessageSquare, badge: unreadLiveChatCount > 0 ? unreadLiveChatCount : undefined },
        { name: 'Reservations & Calendar', path: '/admin/reservations', icon: CalendarRange },
        { name: 'Treatment Hari Ini', path: '/admin/today-treatments', icon: Sparkles },
        { name: 'Customer Database', path: '/admin/customers', icon: Users },
        { name: 'Chat Migration & Seeding', path: '/admin/chat-migration', icon: Database },
        { name: 'Customer Labels', path: '/admin/labels', icon: Tag },
        { name: 'Customer Service & CTA', path: '/admin/customer-service', icon: Headphones },
        { name: 'Follow-Up Queue', path: '/admin/follow-ups', icon: Clock },
        { name: 'Follow-Up Templates', path: '/admin/follow-up-templates', icon: MessageSquareText },
      ],
    },
    {
      title: 'Staff & Layanan',
      items: [
        { name: 'Staff & Terapis', path: '/admin/staff-management', icon: Users },
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

    const handlePopState = () => {
      setMobileMenuOpen(false);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [mobileMenuOpen]);

  const justSwipedRef = useRef(false);
  const backdropTouchStartRef = useRef(false);

  // Native DOM touch gesture listener: Right-Edge Swipe to Open Menu, Swipe Right to Close
  useEffect(() => {
    let touchStartX = 0;
    let touchStartY = 0;
    let isTracking = false;
    let wasOpenAtTouchStart = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      // Guard: Hanya aktifkan gesture pada mobile (< md breakpoint 768px)
      if (window.innerWidth >= 768) return;

      const target = e.target as HTMLElement | null;

      // Guard: Abaikan jika menyentuh area live chat kecuali jika benar-benar di zona tepi kanan 30px
      if (target?.closest('[data-no-swipe-menu]') || target?.closest('[data-chat-detail]')) {
        const touch = e.touches[0];
        if (!touch || touch.clientX < window.innerWidth - 30) {
          isTracking = false;
          return;
        }
      }

      // Guard: Abaikan jika menyentuh elemen interaktif / form
      if (target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.tagName === 'BUTTON' ||
        target.closest('button') ||
        target.closest('input') ||
        target.closest('textarea')
      )) {
        isTracking = false;
        return;
      }

      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      wasOpenAtTouchStart = mobileMenuOpen;

      // Zona tepi kanan ketat (hanya 30px dari sisi kanan layar) untuk membuka menu
      const isRightEdge = touchStartX >= window.innerWidth - 30;
      if (mobileMenuOpen || isRightEdge) {
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

      // Case 1: When sidebar was CLOSED at start -> Swipe from RIGHT edge towards LEFT to open
      if (!wasOpenAtTouchStart && touchStartX >= window.innerWidth - 24) {
        if (deltaX < -45 && absX > absY * 2.2) {
          justSwipedRef.current = true;
          setMobileMenuOpen(true);
          isTracking = false;
        }
        return;
      }

      // Case 2: When sidebar was OPEN at start -> Swipe RIGHT to close
      if (wasOpenAtTouchStart) {
        if (deltaX > 45 && absX > absY * 2.2) {
          justSwipedRef.current = true;
          setMobileMenuOpen(false);
          isTracking = false;
        }
      }
    };

    const onTouchEnd = () => {
      isTracking = false;
      setTimeout(() => {
        justSwipedRef.current = false;
      }, 400);
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [mobileMenuOpen]);

  // 🔄 Mobile Pull-to-Refresh (Swipe Down to Reload)
  const [pullDistance, setPullDistance] = useState(0);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const pullStartRef = useRef<{ y: number; x: number } | null>(null);

  useEffect(() => {
    if (window.innerWidth >= 768) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.closest('input') ||
        target?.closest('textarea') ||
        target?.closest('select') ||
        target?.closest('[data-no-ptr]')
      ) {
        return;
      }

      const scrollable = target?.closest('.overflow-y-auto') as HTMLElement | null;
      const isTop = scrollable ? scrollable.scrollTop <= 0 : window.scrollY <= 0;
      if (isTop) {
        pullStartRef.current = { y: e.touches[0].clientY, x: e.touches[0].clientX };
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!pullStartRef.current || isPullRefreshing) return;
      const touch = e.touches[0];
      const deltaY = touch.clientY - pullStartRef.current.y;
      const deltaX = touch.clientX - pullStartRef.current.x;

      if (deltaY > 8 && deltaY > Math.abs(deltaX) * 1.2) {
        if (e.cancelable) {
          e.preventDefault();
        }
        const distance = Math.min(deltaY * 0.35, 60);
        setPullDistance(distance);
      } else if (deltaY < 0) {
        setPullDistance(0);
      }
    };

    const handleTouchEnd = () => {
      if (pullDistance >= 45 && !isPullRefreshing) {
        setIsPullRefreshing(true);
        setPullDistance(45);
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try {
            navigator.vibrate(40);
          } catch (_) {}
        }
        setTimeout(() => {
          window.location.reload();
        }, 350);
      } else {
        setPullDistance(0);
      }
      pullStartRef.current = null;
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [pullDistance, isPullRefreshing]);

  const isLiveChat = location.pathname.includes('/live-chat');

  return (
    <div className={`${isLiveChat ? 'h-screen max-h-screen overflow-hidden' : 'min-h-screen'} bg-[#f0f2f5] text-[#111b21] flex flex-col md:flex-row relative`}>
      {/* 🔄 Mobile Pull-to-Refresh Floating Indicator */}
      {(pullDistance > 0 || isPullRefreshing) && (
        <div
          className="fixed top-3 left-1/2 -translate-x-1/2 z-[99999] pointer-events-none transition-all duration-100 ease-out flex items-center justify-center pt-[env(safe-area-inset-top,0px)]"
          style={{
            transform: `translate(-50%, ${pullDistance}px) scale(${Math.min(0.7 + pullDistance / 100, 1)})`,
            opacity: Math.min(pullDistance / 20, 1),
          }}
        >
          <div className="bg-white border border-[#008069]/30 rounded-full p-2.5 shadow-2xl text-[#008069] flex items-center justify-center backdrop-blur-md">
            <RefreshCw
              size={20}
              className={`${isPullRefreshing ? 'animate-spin' : ''}`}
              style={{
                transform: isPullRefreshing ? undefined : `rotate(${pullDistance * 5}deg)`,
              }}
            />
          </div>
        </div>
      )}

      {/* 🔔 Floating In-App WhatsApp-Style Incoming Chat Notification Banner */}
      {incomingToast && (
        <div
          onClick={() => openChatFromToast(incomingToast.conversationId)}
          className="fixed top-3 left-3 right-3 sm:left-auto sm:right-6 z-[9999] max-w-sm sm:max-w-md bg-white border border-[#008069]/40 rounded-2xl shadow-2xl p-3 flex items-start space-x-3 cursor-pointer hover:bg-[#f8fafc] transition-all transform animate-in slide-in-from-top-4 fade-in duration-200 select-none backdrop-blur-md mt-[env(safe-area-inset-top,0px)] ml-[env(safe-area-inset-left,0px)] mr-[env(safe-area-inset-right,0px)]"
        >
          <div className="h-10 w-10 rounded-full bg-[#008069] text-white flex items-center justify-center shrink-0 font-bold shadow-xs">
            <MessageSquare size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <p className="text-xs font-extrabold text-[#111b21] truncate">
                {incomingToast.customerName}
              </p>
              <span className="text-[10px] text-[#667781] font-mono ml-2">
                {incomingToast.createdAt}
              </span>
            </div>
            <p className="text-xs text-[#54656f] line-clamp-2 mt-0.5 font-medium leading-relaxed">
              {incomingToast.content}
            </p>
            <div className="flex items-center space-x-2 mt-1.5">
              <span className="text-[10px] font-bold text-[#008069] bg-[#e8f5f2] px-2 py-0.5 rounded-md">
                💬 Ketuk untuk Balas
              </span>
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              dismissToast();
            }}
            aria-label="Tutup notifikasi"
            className="text-[#8696a0] hover:text-[#111b21] p-1 rounded-lg hover:bg-[#f0f2f5] transition cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>
      )}
      <div
        onTouchStart={() => {
          backdropTouchStartRef.current = true;
        }}
        onTouchMove={(e) => {
          if (e.cancelable) e.preventDefault();
        }}
        onTouchEnd={() => {
          if (backdropTouchStartRef.current && !justSwipedRef.current) {
            setMobileMenuOpen(false);
          }
          backdropTouchStartRef.current = false;
        }}
        onClick={() => {
          if (justSwipedRef.current) return;
          setMobileMenuOpen(false);
        }}
        className={`fixed inset-0 bg-black/40 z-40 md:hidden backdrop-blur-xs transition-opacity duration-300 ${
          mobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Sidebar Navigation (Desktop: Left, Mobile: Slide from Right with total GPU masking when closed) */}
      <aside className={`fixed inset-y-0 right-0 md:right-auto md:left-0 z-50 w-64 bg-white border-l md:border-l-0 md:border-r border-[#e9edef] flex flex-col transform pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] ${
        mobileMenuOpen
          ? 'translate-x-0 opacity-100 visible pointer-events-auto'
          : 'translate-x-full opacity-0 invisible pointer-events-none md:opacity-100 md:visible md:pointer-events-auto md:translate-x-0'
      } transition-all duration-300 ease-out shadow-2xl md:shadow-xs`}>
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

        {/* Navigation Items (Grouped with Section Headers & Dynamic Role-Based Sorting) */}
        <nav className="flex-1 px-3 py-3 space-y-4 overflow-y-auto">
          {(() => {
            const formattedRole = (currentRole || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
            const activeRoleConfig =
              customRoles[formattedRole] ||
              customRoles[(currentRole || '').toLowerCase()] ||
              customRoles[currentRole] ||
              customRoles[formattedRole.replace(/_/g, '')];

            const roleAllowedOrder = activeRoleConfig?.allowedPaths || [];

            const getPathOrderIndex = (path: string) => {
              const idx = roleAllowedOrder.indexOf(path);
              return idx >= 0 ? idx : 999;
            };

            const sortedNavGroups = navGroups
              .map((group) => {
                const items = group.items
                  .filter((item) => hasAccess(currentRole, item.path))
                  .sort((a, b) => getPathOrderIndex(a.path) - getPathOrderIndex(b.path));
                const minIndex =
                  items.length > 0 ? Math.min(...items.map((i) => getPathOrderIndex(i.path))) : 999;
                return { ...group, items, minIndex };
              })
              .filter((group) => group.items.length > 0)
              .sort((a, b) => a.minIndex - b.minIndex);

            return sortedNavGroups.map((group) => (
              <div key={group.title} className="space-y-1">
                <div className="px-3 pt-1 pb-0.5 text-[10px] font-extrabold uppercase tracking-wider text-[#8696a0]">
                  {group.title}
                </div>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.path;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      replace={true}
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
            ));
          })()}
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
      <div className={`flex-1 md:pl-64 flex flex-col ${isLiveChat ? 'h-screen max-h-screen overflow-hidden min-h-0' : 'min-h-screen'}`}>
        
        {/* Top Header */}
        <header className="border-b border-[#e9edef] px-4 sm:px-6 flex items-center justify-between bg-white/95 backdrop-blur-sm sticky top-0 z-40 shadow-xs shrink-0 pt-[env(safe-area-inset-top,0px)] min-h-[calc(4rem+env(safe-area-inset-top,0px))] md:pt-0 md:min-h-[4rem] pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))]">
          <div className="flex items-center space-x-3">
            <h1 className="text-sm font-bold md:text-base text-[#111b21] truncate max-w-[200px] sm:max-w-none">
              {BRAND.panelName}
            </h1>
          </div>

          {/* Right Header: System Liveness Alerts & Mobile Hamburger Menu Button */}
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
                <QrCode size={14} />
                <span className="text-[11px] font-bold">Scan QR</span>
              </button>
            ) : wahaStatus === 'FAILED' ? (
              <button
                onClick={() => setShowStatusPopover(!showStatusPopover)}
                className="rounded-full bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 transition flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
              >
                <AlertCircle size={14} />
                <span className="text-[11px] font-bold">Offline</span>
              </button>
            ) : (
              <button
                onClick={() => setShowStatusPopover(!showStatusPopover)}
                className="rounded-full bg-gray-50 border border-gray-200 text-gray-600 hover:bg-gray-100 transition flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
              >
                <Loader size={14} className="animate-spin" />
                <span className="text-[11px] font-bold">Memeriksa</span>
              </button>
            )}

            {/* Live Chat Notification Sound Mute/Unmute Toggle (RBAC Filtered) */}
            {canAccessLiveChat && (
              <button
                onClick={async () => {
                  toggleSound();
                  if (!soundActive) {
                    toast('🔊 Suara notifikasi aktif! Memeriksa izin push background...', 'info');
                    try {
                      const perm = await requestPushPermission();
                      if (perm === 'granted') {
                        toast('🔔 Web Push Background Aktif! Notifikasi akan muncul saat aplikasi tertutup.', 'success');
                      } else {
                        toast('⚠️ Izin notifikasi browser belum diberikan. Silakan izinkan notifikasi di browser/HP Anda.', 'info');
                      }
                    } catch (e: any) {
                      toast(`⚠️ Gagal mendaftarkan push: ${e.message}`, 'error');
                    }
                  } else {
                    toast('🔇 Suara notifikasi chat dimatikan (Mute).', 'info');
                  }
                }}
                title={soundActive ? 'Suara & Push Notifikasi: Aktif (Klik untuk Mute)' : 'Suara & Push Notifikasi: Mati (Klik untuk Aktifkan)'}
                className={`p-1.5 sm:p-2 rounded-full border transition flex items-center justify-center cursor-pointer shadow-2xs ${
                  soundActive
                    ? 'bg-emerald-50 border-emerald-200 text-[#008069] hover:bg-emerald-100'
                    : 'bg-gray-100 border-gray-200 text-gray-400 hover:bg-gray-200'
                }`}
              >
                {soundActive ? <Volume2 size={15} /> : <VolumeX size={15} />}
              </button>
            )}

            {/* Mobile Hamburger Menu Button (Moved to Right Side) */}
            <button 
              onClick={() => setMobileMenuOpen(true)} 
              aria-label="Buka Menu"
              title="Buka Menu Navigasi"
              className="md:hidden p-2 rounded-xl bg-[#f0f2f5] text-[#54656f] hover:text-[#111b21] hover:bg-[#e9edef] transition active:scale-90 touch-manipulation cursor-pointer shadow-2xs ml-1"
            >
              <Menu size={20} />
            </button>

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

                  <div className="pt-1 space-y-2">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const { sendTestPush, subscribeToPushNotifications } = await import('../../services/pushNotification');
                          toast('Mendaftarkan & mengirim notifikasi uji coba...', 'info');
                          await subscribeToPushNotifications(currentRole);
                          const res = await sendTestPush();
                          if (res.success) {
                            toast('✅ Notifikasi uji coba berhasil dikirim dari server!', 'success');
                          } else {
                            toast('⚠️ Gagal mengirim notifikasi uji coba.', 'error');
                          }
                        } catch (err: any) {
                          toast(`⚠️ Error: ${err.message}`, 'error');
                        }
                      }}
                      className="w-full text-center py-2 px-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-semibold text-xs transition border border-emerald-200 flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                    >
                      <Volume2 size={13} />
                      Kirim Notifikasi Uji Coba (Test Push)
                    </button>
                    <Link
                      to="/admin/settings"
                      replace={true}
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
        <main
          className={`flex-1 ${
            isLiveChat
              ? 'p-0.5 sm:p-1.5 md:p-2 overflow-hidden flex flex-col min-h-0'
              : 'p-4 sm:p-5 md:p-7 space-y-6'
          } bg-[#f0f2f5]`}
        >
          {children}
        </main>
      </div>
    </div>
  );
};
