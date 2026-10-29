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
  CalendarDays,
  Bot,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Send,
  TrendingUp,
  Zap,
  WifiOff,
} from 'lucide-react';

import { ROLE_LABELS, hasAccess, getCustomRoles } from '../../config/rolePermissions';
import { emitBootPhase } from '../../lib/bootProgress';
import { useLiveChatNotification } from '../../hooks/useLiveChatNotification';
import { useUiFeedback } from './UiFeedback';
import { ThemeToggle } from './ThemeToggle';
import { AppErrorBoundary } from './AppErrorBoundary';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useCopilot } from '../../contexts/CopilotContext';

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuth();
  const { toast } = useUiFeedback();
  const { open: copilotOpen, setOpen: setCopilotOpen, mobileMenuOpen, setMobileMenuOpen, openMobileMenu, dismissMobileMenu } = useCopilot();
  const navigate = useNavigate();
  const location = useLocation();

  const handleNavClick = () => {
    setMobileMenuOpen(false);
    if (typeof window !== 'undefined' && window.history.state?.modal === 'mobile-menu') {
      window.history.replaceState(null, '');
    }
  };

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

  // 📱 iPhone / iOS Safari Dynamic Keyboard & Visual Viewport Height Tracker
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateVvh = () => {
      const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      document.documentElement.style.setProperty('--vvh', `${vh}px`);
      const isKbOpen = window.visualViewport ? window.visualViewport.height < window.innerHeight - 80 : false;
      document.documentElement.setAttribute('data-keyboard-open', isKbOpen ? 'true' : 'false');
    };
    updateVvh();
    window.visualViewport?.addEventListener('resize', updateVvh);
    window.visualViewport?.addEventListener('scroll', updateVvh);
    window.addEventListener('resize', updateVvh);
    return () => {
      window.visualViewport?.removeEventListener('resize', updateVvh);
      window.visualViewport?.removeEventListener('scroll', updateVvh);
      window.removeEventListener('resize', updateVvh);
    };
  }, []);

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
        { name: 'Transaksi & Pendapatan', path: '/admin/financial-analytics', icon: TrendingUp },
        { name: 'Reservations & Calendar', path: '/admin/reservations', icon: CalendarRange },
        { name: 'Treatment Hari Ini', path: '/admin/today-treatments', icon: CalendarDays },
        { name: 'Customer Database', path: '/admin/customers', icon: Users },
        { name: 'Chat Migration & Seeding', path: '/admin/chat-migration', icon: Database },
        { name: 'Follow-Up Queue', path: '/admin/follow-ups', icon: Clock },
        { name: 'Balasan Cepat', path: '/admin/quick-replies', icon: Zap },
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
        { name: 'CTA & Greetings WA', path: '/admin/customer-service', icon: Headphones },
      ],
    },
    {
      title: 'AI Engine & Konten',
      items: [
        { name: 'Knowledge Base', path: '/admin/knowledge-base', icon: BookOpen },
        { name: 'AI Sandbox Simulator', path: '/admin/sandbox', icon: Terminal },
        { name: 'AI Persona settings', path: '/admin/persona', icon: Volume2 },
        { name: 'AI Quality Evaluation', path: '/admin/ai-evaluations', icon: Gauge },
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

  // Tutup menu saat navigasi halaman (history dirapikan oleh context saat dismiss)
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname, setMobileMenuOpen]);

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
  }, [mobileMenuOpen, setMobileMenuOpen]);

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
          openMobileMenu();
          isTracking = false;
        }
        return;
      }

      // Case 2: When sidebar was OPEN at start -> Swipe RIGHT to close
      if (wasOpenAtTouchStart) {
        if (deltaX > 45 && absX > absY * 2.2) {
          justSwipedRef.current = true;
          dismissMobileMenu();
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

  // ⬅️ Mobile Edge Swipe-Back Gesture Navigation (Left to Right from Edge)
  const [swipeBackDistance, setSwipeBackDistance] = useState(0);
  const swipeBackStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (window.innerWidth >= 768) return;

    const handleEdgeTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.closest('input') ||
        target?.closest('textarea') ||
        target?.closest('select') ||
        target?.closest('[data-no-swipe-back]') ||
        target?.closest('[data-horizontal-scroll]')
      ) {
        return;
      }

      // Trigger only when touch starts within 35px of left screen edge
      const touch = e.touches[0];
      if (touch.clientX <= 35) {
        swipeBackStartRef.current = { x: touch.clientX, y: touch.clientY };
      }
    };

    const handleEdgeTouchMove = (e: TouchEvent) => {
      if (!swipeBackStartRef.current) return;
      const touch = e.touches[0];
      const deltaX = touch.clientX - swipeBackStartRef.current.x;
      const deltaY = touch.clientY - swipeBackStartRef.current.y;

      // Jika pergerakan dominan vertikal, segera batalkan pelacakan gestur swipe tepi
      if (Math.abs(deltaY) > 12 && Math.abs(deltaY) > deltaX) {
        swipeBackStartRef.current = null;
        setSwipeBackDistance(0);
        return;
      }

      if (deltaX > 8 && deltaX > Math.abs(deltaY) * 1.2) {
        if (e.cancelable) {
          e.preventDefault();
        }
        // Kurva peredam (resistance curve / rubber-band damping):
        // Maksimal range 100px (100%), semakin ke kanan pergerakan semakin berkurang/lambat
        const maxRangePx = 100;
        const dist = maxRangePx * (1 - Math.exp(-deltaX / 100));
        setSwipeBackDistance(dist);
      } else if (deltaX < 0) {
        setSwipeBackDistance(0);
      }
    };

    const handleEdgeTouchEnd = () => {
      // Threshold aktivasi (mencapai 50% dari kurva maksimum 100px)
      if (swipeBackDistance >= 50) {
        const backEvent = new CustomEvent('app-swipe-back', { cancelable: true });
        const notHandled = window.dispatchEvent(backEvent);
        if (notHandled) {
          // Prioritas proteksi data: jika ada modal aktif, tutup modal terlebih dahulu daripada unmount halaman
          const activeModal = document.querySelector('[data-modal-active="true"]');
          if (activeModal) {
            const closeBtn = activeModal.querySelector<HTMLElement>('[data-modal-close="true"]') ||
              activeModal.querySelector<HTMLElement>('button[aria-label*="Tutup"], button[aria-label*="tutup"], button[title*="Tutup"], button[title*="tutup"]');
            if (closeBtn) {
              closeBtn.click();
            }
          } else if (window.history.length > 1) {
            window.history.back();
          }
        }
      }
      setSwipeBackDistance(0);
      swipeBackStartRef.current = null;
    };

    window.addEventListener('touchstart', handleEdgeTouchStart, { passive: true });
    window.addEventListener('touchmove', handleEdgeTouchMove, { passive: false });
    window.addEventListener('touchend', handleEdgeTouchEnd, { passive: true });
    window.addEventListener('touchcancel', handleEdgeTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleEdgeTouchStart);
      window.removeEventListener('touchmove', handleEdgeTouchMove);
      window.removeEventListener('touchend', handleEdgeTouchEnd);
      window.removeEventListener('touchcancel', handleEdgeTouchEnd);
    };
  }, [swipeBackDistance]);

  const isLiveChat = location.pathname.includes('/live-chat');

  // 🔒 Lock outer window scroll strictly when on LiveChat, preventing iOS Safari from scrolling window on input focus
  useEffect(() => {
    if (isLiveChat) {
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
      window.scrollTo(0, 0);
      return () => {
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
      };
    }
  }, [isLiveChat]);

  return (
    <div
      style={{ height: isLiveChat ? 'var(--vvh, 100dvh)' : undefined, maxHeight: isLiveChat ? 'var(--vvh, 100dvh)' : undefined }}
      className={`${isLiveChat ? 'h-[100dvh] max-h-[100dvh] overflow-hidden touch-pan-y' : 'min-h-screen'} bg-app text-ink flex flex-col md:flex-row relative overscroll-y-contain`}
    >
      {/* ⬅️ Mobile Edge Swipe-Back Floating Indicator (Max 100px with resistance physics) */}
      {swipeBackDistance > 0 && (
        <div
          className="fixed left-2 top-1/2 -translate-y-1/2 z-[99999] pointer-events-none transition-all duration-75 ease-out flex items-center justify-center"
          style={{
            transform: `translate(${swipeBackDistance}px, -50%) scale(${0.8 + (swipeBackDistance / 100) * 0.35})`,
            opacity: Math.min(swipeBackDistance / 20, 1),
          }}
        >
          <div
            className={`p-3 rounded-full shadow-2xl backdrop-blur-md border transition-all flex items-center justify-center ${
              swipeBackDistance >= 50
                ? 'bg-accent text-white border-white/40 ring-4 ring-accent/25 shadow-accent/30'
                : 'bg-surface/95 text-accent border-accent/30 shadow-lg'
            }`}
          >
            <ChevronLeft
              size={22}
              className={`transition-transform duration-100 ${swipeBackDistance >= 50 ? 'scale-115 stroke-[2.5]' : ''}`}
            />
          </div>
        </div>
      )}

      {/* 🔔 Floating In-App WhatsApp-Style Incoming Chat Notification Banner */}
      {incomingToast && (
        <div
          onClick={() => openChatFromToast(incomingToast.conversationId)}
          className="fixed top-3 left-3 right-3 sm:left-auto sm:right-6 z-[9999] max-w-sm sm:max-w-md bg-surface-2 border border-accent/40 rounded-2xl shadow-2xl p-3 flex items-start space-x-3 cursor-pointer hover:bg-fill-1 transition-all transform animate-in slide-in-from-top-4 fade-in duration-200 select-none backdrop-blur-md mt-[env(safe-area-inset-top,0px)] ml-[env(safe-area-inset-left,0px)] mr-[env(safe-area-inset-right,0px)]"
        >
          <div className="h-10 w-10 rounded-full bg-accent text-accent-ink flex items-center justify-center shrink-0 font-bold shadow-xs">
            <MessageSquare size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <p className="text-xs font-extrabold text-ink truncate">
                {incomingToast.customerName}
              </p>
              <span className="text-[10px] text-ink-3 font-mono ml-2">
                {incomingToast.createdAt}
              </span>
            </div>
            <p className="text-xs text-ink-2 line-clamp-2 mt-0.5 font-medium leading-relaxed">
              {incomingToast.content}
            </p>
            <div className="flex items-center space-x-2 mt-1.5">
              <span className="text-[10px] font-bold text-accent bg-accent-soft px-2 py-0.5 rounded-md">
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
            className="text-ink-3 hover:text-ink p-1 rounded-lg hover:bg-fill-1 transition cursor-pointer"
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
            dismissMobileMenu();
          }
          backdropTouchStartRef.current = false;
        }}
        onClick={() => {
          if (justSwipedRef.current) return;
          dismissMobileMenu();
        }}
        className={`fixed inset-0 bg-black/40 z-40 md:hidden backdrop-blur-xs transition-opacity duration-300 ${
          mobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Sidebar Navigation (Desktop: Left, Mobile: Slide from Right with total GPU masking when closed) */}
      <aside className={`fixed inset-y-0 right-0 md:right-auto md:left-0 z-50 w-64 bg-sidebar border-l md:border-l-0 md:border-r border-divider flex flex-col transform pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] ${
        mobileMenuOpen
          ? 'translate-x-0 opacity-100 visible pointer-events-auto'
          : 'translate-x-full opacity-0 invisible pointer-events-none md:opacity-100 md:visible md:pointer-events-auto md:translate-x-0'
      } transition-all duration-300 ease-out shadow-2xl md:shadow-xs`}>
        {/* Brand/Header */}
        <div className="h-16 border-b border-divider bg-surface flex items-center justify-between px-5">
          <div className="flex items-center space-x-2.5">
            <img
              src="/admin/apple-touch-icon.png"
              alt="Kala Logo"
              className="h-8 w-8 rounded-lg object-contain shadow-2xs border border-divider shrink-0"
            />
            <div className="flex flex-col">
              <span className="font-extrabold text-sm tracking-wider text-ink uppercase">KALA SPA</span>
              <span className="text-[10px] text-ink-3 font-medium leading-none">Management Bot</span>
            </div>
          </div>
          <button
            onClick={dismissMobileMenu}
            aria-label="Tutup menu"
            className="md:hidden text-ink-3 hover:text-ink p-2 rounded-xl hover:bg-fill-1 transition"
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
                <div className="px-3 pt-1 pb-0.5 text-[10px] font-extrabold uppercase tracking-wider text-ink-3">
                  {group.title}
                </div>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.path;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={handleNavClick}
                      className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl transition-all duration-150 text-xs ${
                        isActive 
                          ? 'bg-accent-soft border-l-4 border-accent text-accent font-bold shadow-xs'
                          : 'text-ink-2 hover:bg-fill-1 hover:text-ink font-medium'
                      }`}
                    >
                      <Icon size={17} className={isActive ? 'text-accent' : 'text-ink-3'} />
                      <span className="flex-1 truncate">{item.name}</span>
                      {!!item.badge && (
                        <span
                          title={`${item.badge} percakapan butuh respons / unread`}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            isActive ? 'bg-accent text-accent-ink' : 'bg-warning-soft text-warning border border-warning-line'
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

        {/* Quick Controls (Online Status, Sound, & Mode UI) — dipindah dari header mobile */}
        <div className="px-3 pt-3 pb-2 border-t border-divider bg-surface-2 space-y-2">
          {/* Status WAHA / Online */}
          <button
            type="button"
            onClick={() => setShowStatusPopover(true)}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border text-xs font-semibold transition active:scale-98 cursor-pointer shadow-2xs ${
              wahaStatus === 'WORKING'
                ? 'bg-success-soft border-success-line text-success hover:bg-success-soft/80'
                : wahaStatus === 'SCAN_QR_CODE'
                ? 'bg-warning-soft border-warning-line text-warning hover:bg-warning-soft/80'
                : 'bg-danger-soft border-danger-line text-danger hover:bg-danger-soft/80'
            }`}
            title="Klik untuk melihat status sistem WhatsApp & Server"
          >
            <span className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  wahaStatus === 'WORKING' ? 'bg-success' : 'bg-danger'
                }`} />
                <span className={`relative inline-flex rounded-full h-2 w-2 ${
                  wahaStatus === 'WORKING' ? 'bg-success' : 'bg-danger'
                }`} />
              </span>
              <span className="text-[11px] font-bold">
                {wahaStatus === 'WORKING' ? 'WhatsApp Online' : wahaStatus === 'SCAN_QR_CODE' ? 'Scan QR WA' : 'WhatsApp Offline'}
              </span>
            </span>
            <ChevronRight size={14} className="opacity-60" />
          </button>

          {/* Dual Buttons: Sound & Theme */}
          <div className="flex items-center gap-2">
            {canAccessLiveChat && (
              <button
                type="button"
                onClick={async () => {
                  toggleSound();
                  if (!soundActive) {
                    toast('🔊 Suara notifikasi aktif!', 'info');
                    try {
                      const perm = await requestPushPermission();
                      if (perm === 'granted') {
                        toast('🔔 Web Push Background Aktif!', 'success');
                      }
                    } catch (_) {}
                  } else {
                    toast('🔇 Suara notifikasi dimatikan (Mute).', 'info');
                  }
                }}
                className={`flex-1 min-h-[38px] flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-xl border text-xs font-semibold transition active:scale-95 cursor-pointer shadow-2xs ${
                  soundActive
                    ? 'bg-success-soft border-success-line text-accent'
                    : 'bg-surface-2 border-divider text-ink-3 hover:text-ink'
                }`}
                title={soundActive ? 'Suara & Push: Aktif (Klik untuk Mute)' : 'Suara & Push: Mati (Klik untuk Aktifkan)'}
              >
                {soundActive ? <Volume2 size={14} className="text-accent" /> : <VolumeX size={14} />}
                <span className="text-[11px] font-bold">{soundActive ? 'Suara On' : 'Mute'}</span>
              </button>
            )}

            {/* Mode UI Theme Button */}
            <div className="flex-1 min-h-[38px] flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-xl border border-divider bg-surface-2 text-xs font-semibold shadow-2xs">
              <ThemeToggle size={14} className="!w-6 !h-6 !min-w-[24px] !min-h-[24px] !border-none !bg-transparent !shadow-none" />
              <span className="text-[11px] font-bold text-ink-2">Mode UI</span>
            </div>
          </div>
        </div>

        {/* User profile / Logout */}
        <div className="p-3.5 border-t border-divider bg-surface-2 space-y-2">
          <div className="flex items-center justify-between">
            <div className="truncate pr-2">
              <p className="text-xs font-bold text-ink truncate">
                {user?.name || user?.email || 'Admin'}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-accent-soft text-accent border border-accent/30">
                  {ROLE_LABELS[currentRole as keyof typeof ROLE_LABELS] || currentRole}
                </span>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="p-2.5 rounded-xl bg-surface hover:bg-danger-soft text-ink-3 hover:text-danger border border-divider transition-colors shadow-xs cursor-pointer"
              title="Logout"
              aria-label="Logout"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div
        style={{ height: isLiveChat ? 'var(--vvh, 100dvh)' : undefined, maxHeight: isLiveChat ? 'var(--vvh, 100dvh)' : undefined }}
        className={`flex-1 md:pl-64 flex flex-col ${isLiveChat ? 'h-[100dvh] max-h-[100dvh] overflow-hidden min-h-0' : 'min-h-screen'}`}
      >
        
        {/* Top Header — iPhone safe-area: notch/Dynamic Island.
            LiveChat mobile: disembunyikan (hidden) agar benar-benar ikut scroll —
            header global adalah sibling flex di luar satu-satunya scroll-container
            (chatListContainerRef di LiveChatMonitor), sehingga `static` pun tetap
            pinned permanen. Mobile memakai Mobile Page Header di dalam scroll
            (LiveChatMonitor) + Quick Controls di sidebar (status WAHA, suara,
            tema, user); menu/copilot dibuka via tombol di Mobile Page Header
            dalam scroll (openMobileMenu/setCopilotOpen via CopilotContext).
            Modal Status Sistem dirender di luar <header> agar tetap tampil
            saat header hidden di mobile livechat. Desktop & halaman lain
            tetap sticky z-40. */}
        <header className={`${isLiveChat ? 'hidden lg:block lg:sticky lg:top-0 z-40' : 'sticky top-0 z-40'} border-b border-divider bg-surface shadow-2xs shrink-0 pt-[env(safe-area-inset-top,0px)] pl-[max(0.75rem,env(safe-area-inset-left,0px))] pr-[max(0.75rem,env(safe-area-inset-right,0px))]`}>
          <div className="h-12 md:h-13 px-3 sm:px-5 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <img
                src="/admin/apple-touch-icon.png"
                alt="Kala Logo"
                className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg object-contain shadow-2xs border border-divider shrink-0"
              />
              <span className="font-extrabold text-xs sm:text-sm tracking-wide text-ink">
                KALA SPA
              </span>
            </div>

          {/* Right Header: System Liveness Alerts & Mobile Hamburger Menu Button */}
          <div className="relative flex items-center space-x-2">
            {/* Redis Queue Status */}
            {redisQueueFallback && (
              <button
                onClick={() => setShowStatusPopover(!showStatusPopover)}
                className="hidden md:flex p-1.5 rounded-full bg-warning-soft border border-warning-line text-warning hover:bg-warning-line transition"
                title="Redis Fallback Aktif"
              >
                <AlertCircle size={15} />
              </button>
            )}

            {/* WAHA Session Live Status (Desktop only, mobile dipindah ke sidebar) */}
            {wahaStatus === 'WORKING' ? (
              <button
                onClick={() => setShowStatusPopover(!showStatusPopover)}
                className="hidden md:flex rounded-full bg-success-soft border border-success-line text-success hover:bg-success-line transition items-center gap-1.5 px-3 py-1.5 text-xs font-semibold h-8 min-h-[34px] cursor-pointer touch-manipulation active:scale-95"
              >
                <CheckCircle size={14} />
                <span className="text-[11px] font-bold">Online</span>
              </button>
            ) : wahaStatus === 'SCAN_QR_CODE' ? (
              <button
                onClick={() => setShowStatusPopover(!showStatusPopover)}
                className="hidden md:flex rounded-full bg-warning-soft border border-warning-line text-warning hover:bg-warning-line transition items-center gap-1.5 px-3 py-1.5 text-xs font-semibold h-8 min-h-[34px] cursor-pointer touch-manipulation active:scale-95"
              >
                <QrCode size={14} />
                <span className="text-[11px] font-bold">Scan QR</span>
              </button>
            ) : wahaStatus === 'FAILED' ? (
              <button
                onClick={() => setShowStatusPopover(!showStatusPopover)}
                className="hidden md:flex rounded-full bg-danger-soft border border-danger-line text-danger hover:bg-danger-line transition items-center gap-1.5 px-3 py-1.5 text-xs font-semibold h-8 min-h-[34px] cursor-pointer touch-manipulation active:scale-95"
              >
                <AlertCircle size={14} />
                <span className="text-[11px] font-bold">Offline</span>
              </button>
            ) : wahaStatus === 'DISCONNECTED' ? (
              <button
                onClick={() => setShowStatusPopover(!showStatusPopover)}
                title="Status Server WhatsApp: Terputus. Klik untuk membuka panel status"
                className="hidden md:flex rounded-full bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/40 text-rose-600 dark:text-danger hover:bg-rose-100 dark:hover:bg-rose-900/50 transition items-center gap-1.5 px-3 py-1.5 text-xs font-semibold h-8 min-h-[34px] cursor-pointer touch-manipulation active:scale-95"
              >
                <WifiOff size={14} />
                <span className="text-[11px] font-bold">Terputus</span>
                <ChevronDown size={11} className="opacity-50" />
              </button>
            ) : (
              <button
                onClick={() => setShowStatusPopover(!showStatusPopover)}
                title="Status Server WhatsApp: Sedang memeriksa koneksi server... Klik untuk membuka panel status"
                className="hidden md:flex rounded-full bg-surface-2 border border-divider text-ink-2 hover:bg-fill-2 transition items-center gap-1.5 px-3 py-1.5 text-xs font-semibold h-8 min-h-[34px] cursor-pointer touch-manipulation active:scale-95"
              >
                <Loader size={14} className="animate-spin" />
                <span className="text-[11px] font-bold">WA: Memeriksa...</span>
                <ChevronDown size={11} className="opacity-50" />
              </button>
            )}

            {/* Live Chat Notification Sound Mute/Unmute Toggle (Desktop only, mobile dipindah ke sidebar) */}
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
                className={`hidden md:flex w-9 h-9 sm:w-8 sm:h-8 min-w-[36px] min-h-[36px] rounded-full border transition items-center justify-center cursor-pointer shadow-2xs aspect-square active:scale-95 touch-manipulation ${
                  soundActive
                    ? 'bg-success-soft border-success-line text-accent hover:bg-success-line'
                    : 'bg-fill-1 border-divider text-ink-3 hover:bg-fill-2'
                }`}
              >
                {soundActive ? <Volume2 size={15} /> : <VolumeX size={15} />}
              </button>
            )}

            {/* Theme Switcher Toggle (☀️/🌙) — desktop only, mobile dipindah ke sidebar */}
            <div className="hidden md:flex items-center">
              <ThemeToggle />
            </div>

            {/* AI Copilot Toggle Button (Icon Only) — Aktif di Live Chat untuk mobile & desktop.
                ADR-001: disembunyikan untuk tenant non-owner (copilotEnabled=false). */}
            {isLiveChat && user?.copilotEnabled !== false && (
              <button
                type="button"
                onClick={() => setCopilotOpen(!copilotOpen)}
                title={copilotOpen ? 'Sembunyikan AI Copilot' : 'Buka AI Copilot'}
                aria-label={copilotOpen ? 'Sembunyikan AI Copilot' : 'Buka AI Copilot'}
                aria-pressed={copilotOpen}
                className={`w-9 h-9 sm:w-8 sm:h-8 min-w-[36px] min-h-[36px] rounded-full border transition flex items-center justify-center cursor-pointer shadow-2xs aspect-square active:scale-95 touch-manipulation ${
                  copilotOpen
                    ? 'bg-bubble-out dark:bg-accent/20 border-accent/40 text-accent ring-2 ring-accent/30'
                    : 'bg-fill-1 dark:bg-fill-2 border-divider dark:border-strong text-ink-3 hover:text-ink'
                }`}
              >
                <Bot size={16} />
              </button>
            )}

            {/* Mobile Hamburger Menu Button (Moved to Right Side) */}
            <button 
              onClick={openMobileMenu} 
              aria-label="Buka Menu"
              title="Buka Menu Navigasi"
              className="md:hidden w-10 h-10 min-w-[40px] min-h-[40px] sm:w-9 sm:h-9 rounded-xl bg-fill-1 dark:bg-fill-2 text-ink-2 hover:text-ink hover:bg-fill-2 dark:hover:bg-strong transition active:scale-95 touch-manipulation cursor-pointer shadow-2xs ml-0.5 flex items-center justify-center aspect-square"
            >
              <Menu size={20} />
            </button>

            {/* Status Popover dipindah ke luar <header> (lihat bawah) agar tampil saat header hidden di mobile livechat */}
          </div>
          </div>
        </header>

        {/* Interactive Status Popover / Modal — di luar <header> agar tidak ikut hidden di mobile livechat */}
        {showStatusPopover && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div
                  className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity duration-200"
                  onClick={() => setShowStatusPopover(false)}
                />
                <div className="relative w-full max-w-sm bg-surface rounded-2xl shadow-2xl border border-divider p-4 text-xs z-10 space-y-3 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-center justify-between border-b border-divider pb-2">
                    <span className="font-bold text-ink text-sm flex items-center gap-1.5">
                      <Activity size={15} className="text-accent" />
                      Status Sistem
                    </span>
                    <button
                      onClick={() => setShowStatusPopover(false)}
                      className="text-ink-3 hover:text-ink p-1 rounded-lg hover:bg-fill-1"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-surface-2 border border-divider">
                      {wahaStatus === 'WORKING' ? (
                        <CheckCircle size={16} className="text-success mt-0.5 flex-shrink-0" />
                      ) : wahaStatus === 'SCAN_QR_CODE' ? (
                        <Activity size={16} className="text-warning mt-0.5 flex-shrink-0" />
                      ) : (
                        <AlertCircle size={16} className="text-danger mt-0.5 flex-shrink-0" />
                      )}
                      <div>
                        <p className="font-bold text-ink">WhatsApp (WAHA)</p>
                        <p className="text-ink-2 text-[11px] mt-0.5">
                          {wahaStatus === 'WORKING'
                            ? 'Sesi WAHA terhubung dan siap kirim/terima pesan pelanggan.'
                            : wahaStatus === 'SCAN_QR_CODE'
                            ? 'Perlu scan QR code WhatsApp di Operational Settings.'
                            : 'Koneksi WhatsApp terputus. Silakan hubungkan ulang di Settings.'}
                        </p>
                      </div>
                    </div>

                    {redisQueueFallback ? (
                      <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-warning-soft border border-warning-line">
                        <AlertCircle size={16} className="text-warning mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-bold text-warning">Redis Fallback Mode</p>
                          <p className="text-warning text-[11px] mt-0.5">
                            Antrean pesan sementara disimpan di in-memory buffer bot karena Redis tidak terhubung.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-success-soft border border-success-line">
                        <CheckCircle size={16} className="text-success mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-bold text-success">Redis & Antrean Aktif</p>
                          <p className="text-success text-[11px] mt-0.5">
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
                      className="w-full text-center py-2 px-3 rounded-xl bg-success-soft hover:bg-success-line text-success font-semibold text-xs transition border border-success-line flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                    >
                      <Volume2 size={13} />
                      Kirim Notifikasi Uji Coba (Test Push)
                    </button>
                    <Link
                      to="/admin/settings"
                      replace={true}
                      onClick={() => setShowStatusPopover(false)}
                      className="block text-center py-2 px-3 rounded-xl bg-fill-1 dark:bg-fill-2 hover:bg-fill-2 dark:hover:bg-strong text-ink font-semibold text-xs transition"
                    >
                      Buka Operational Settings →
                    </Link>
                  </div>
                </div>
              </div>
            )}

        {/* Content Body — isolated page ErrorBoundary (Fase 1: blank-page guard) */}
        <main
          className={`flex-1 ${
            isLiveChat
              ? 'p-0 overflow-hidden flex flex-col min-h-0'
              : '[--page-pad:1rem] sm:[--page-pad:1.25rem] md:[--page-pad:1.75rem] p-[var(--page-pad)] space-y-6'
          } bg-app`}
        >
          <AppErrorBoundary scopeLabel="page">{children}</AppErrorBoundary>
        </main>
      </div>
    </div>
  );
};
