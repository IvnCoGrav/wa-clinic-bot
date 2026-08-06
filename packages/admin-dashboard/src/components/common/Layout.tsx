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
  Truck,
  Clock,
  Bug,
  Globe,
  Users
} from 'lucide-react';

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [wahaStatus, setWahaStatus] = useState<string>('UNKNOWN');
  const [redisQueueFallback, setRedisQueueFallback] = useState<boolean>(false);
  
  useEffect(() => {
    async function fetchSystemHealth() {
      try {
        const data = await apiRequest('/api/admin/health');
        setWahaStatus(data.wahaStatus || 'UNKNOWN');
        setRedisQueueFallback(data.redisQueue === 'IN_MEMORY_FALLBACK_ACTIVE');
      } catch (err) {
        console.warn('Failed to fetch system health status:', err);
      }
    }
    fetchSystemHealth();
    const interval = setInterval(fetchSystemHealth, 120000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/admin/login');
  };

  const navItems = [
    { name: 'Overview', path: '/admin/overview', icon: LayoutDashboard },
    { name: 'Customer Database', path: '/admin/customers', icon: Users },
    { name: 'Reservations & Calendar', path: '/admin/reservations', icon: CalendarRange },
    { name: 'Clinic Services', path: '/admin/services', icon: Activity },
    { name: 'Delivery Fee', path: '/admin/delivery', icon: Truck },
    { name: 'Follow-Up Queue', path: '/admin/follow-ups', icon: Clock },
    { name: 'Follow-Up Templates', path: '/admin/follow-up-templates', icon: MessageSquareText },
    { name: 'Knowledge Base', path: '/admin/knowledge-base', icon: BookOpen },
    { name: 'AI Sandbox Simulator', path: '/admin/sandbox', icon: Terminal },
    { name: 'Live Chat Monitor', path: '/admin/live-chat', icon: MessageSquare },
    { name: 'AI Persona settings', path: '/admin/persona', icon: Volume2 },
    { name: 'Landing Page', path: '/admin/landing', icon: Globe },
    { name: 'Operational Settings', path: '/admin/settings', icon: SettingsIcon },
    { name: 'System Debug', path: '/admin/debug', icon: Bug },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col md:flex-row">
      
      {/* Sidebar Navigation */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 glass-panel flex flex-col transform ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 transition-transform duration-300 ease-in-out`}>
        {/* Brand/Header */}
        <div className="h-20 border-b border-white/5 flex items-center justify-between px-6">
          <div className="flex items-center space-x-2">
            <div className="h-8 w-8 rounded-lg bg-pink-500 flex items-center justify-center font-bold text-white shadow-md">K</div>
            <span className="font-extrabold text-lg tracking-wider bg-gradient-to-r from-pink-400 to-violet-400 bg-clip-text text-transparent">KALA SPA</span>
          </div>
          <button onClick={() => setMobileMenuOpen(false)} className="md:hidden text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                  isActive 
                    ? 'bg-gradient-to-r from-pink-500/20 to-violet-500/10 border-l-4 border-pink-500 text-white font-medium shadow-sm'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
                }`}
              >
                <Icon size={18} className={isActive ? 'text-pink-400' : 'text-slate-400'} />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* User profile / Logout */}
        <div className="p-4 border-t border-white/5 bg-slate-900/40">
          <div className="flex items-center justify-between mb-2">
            <div className="truncate pr-2">
              <p className="text-xs text-slate-400 truncate">Logged in as</p>
              <p className="text-sm font-semibold text-slate-200 truncate">{user?.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg bg-white/5 hover:bg-pink-500/10 text-slate-400 hover:text-pink-400 transition-colors"
              title="Logout"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 md:pl-64 flex flex-col min-h-screen">
        
        {/* Top Header */}
        <header className="h-20 border-b border-white/5 px-6 flex items-center justify-between glass-panel sticky top-0 z-40">
          <div className="flex items-center space-x-4">
            <button 
              onClick={() => setMobileMenuOpen(true)} 
              className="md:hidden p-2 rounded-lg bg-white/5 text-slate-400 hover:text-white"
            >
              <Menu size={20} />
            </button>
            <h1 className="text-lg font-bold tracking-tight md:text-xl text-slate-100">
              {BRAND.panelName}
            </h1>
          </div>

          {/* System Liveness Alerts */}
          <div className="flex items-center space-x-3">
            {/* Redis Queue Status */}
            {redisQueueFallback && (
              <div className="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium animate-pulse">
                <AlertCircle size={12} />
                <span>Redis Fallback Mode</span>
              </div>
            )}

            {/* WAHA Session Live Status */}
            {wahaStatus === 'WORKING' ? (
              <div className="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
                <CheckCircle size={12} />
                <span>WhatsApp Connected</span>
              </div>
            ) : wahaStatus === 'SCAN_QR_CODE' ? (
              <div className="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium">
                <Activity size={12} />
                <span>WA Scan QR required</span>
              </div>
            ) : (
              <div className="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-medium animate-pulse">
                <AlertCircle size={12} />
                <span>WA Session Disconnected</span>
              </div>
            )}
          </div>
        </header>

        {/* Content Body */}
        <main className="flex-1 p-6 md:p-8 space-y-8 overflow-y-auto">
          {children}
        </main>
      </div>

    </div>
  );
};
