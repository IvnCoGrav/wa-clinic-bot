import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from '../types';
import { apiRequest } from '../services/api';
import { getDefaultRedirect, fetchRolesFromApi } from '../config/rolePermissions';
import { emitBootPhase, setBootMessage } from '../lib/bootProgress';

interface LoginResult {
  success: boolean;
  role: string;
  redirectTo: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Token cadangan untuk fallback PWA (cookie bisa hilang saat aplikasi Android ditutup,
// sesi server tetap valid — token ini dipakai untuk me-issue ulang cookie via /restore).
const TOKEN_STORAGE_KEY = 'admin_session_token';
const LAST_ROLE_KEY = 'last_admin_role';

// Backoff adaptif: cepat di percobaan awal (transient), melebar ke radio-wake HP.
const RETRY_BACKOFF_MS = [1000, 2500, 5000, 8000, 8000];

// Preload chunk halaman tujuan paling mungkin — paralel dengan cek sesi (hemat 1 RTT
// saat buka PWA; chunk di-cache browser pada bukaan berikutnya).
function preloadLikelyPage(): void {
  const lastRole = localStorage.getItem(LAST_ROLE_KEY);
  const load = lastRole === 'therapist'
    ? () => import('../pages/staff/StaffToday')
    : () => import('../pages/tenant/Overview');
  load()
    .then(() => emitBootPhase('chunk'))
    .catch(() => {});
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  async function restoreSession(): Promise<'ok' | 'invalid' | 'network'> {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!token) return 'invalid';
    try {
      const res = await apiRequest('/api/admin/auth/restore', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      return res && res.success ? 'ok' : 'invalid';
    } catch (err: any) {
      const status = (err as any)?.status;
      if (status === 401 || status === 403) return 'invalid';
      return 'network';
    }
  }

  // Check auth session on mount
  useEffect(() => {
    let cancelled = false;
    let retryTimer: any = null;
    let onlineHandler: (() => void) | null = null;
    let attempts = 0;
    let inFlight = false;

    const clearPendingRetry = () => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      if (onlineHandler) {
        window.removeEventListener('online', onlineHandler);
        onlineHandler = null;
      }
    };

    const scheduleRetry = (delayMs: number) => {
      if (cancelled) return;
      if (!navigator.onLine) {
        // Radio seluler belum siap — tunggu event online, fallback timer supaya tidak macet
        onlineHandler = () => {
          window.removeEventListener('online', onlineHandler!);
          onlineHandler = null;
          retryTimer = setTimeout(checkAuth, 300);
        };
        window.addEventListener('online', onlineHandler);
        retryTimer = setTimeout(() => {
          if (onlineHandler) {
            window.removeEventListener('online', onlineHandler);
            onlineHandler = null;
          }
          checkAuth();
        }, Math.max(delayMs, 10000));
        return;
      }
      retryTimer = setTimeout(checkAuth, delayMs);
    };

    async function checkAuth() {
      if (inFlight || cancelled) return;
      inFlight = true;
      try {
        const data = await apiRequest('/api/admin/auth/me');
        if (cancelled) return;
        attempts = 0;
        clearPendingRetry();
        if (data.authenticated && data.user) {
          setUser({
            id: data.user.id,
            email: data.user.email || '',
            name: data.user.name,
            phone: data.user.phone,
            role: data.user.role || 'super_admin',
            tenantId: data.user.tenantId || 'default-tenant',
          });
          fetchRolesFromApi().catch(() => {});
        } else {
          setUser(null);
        }
        setLoading(false);
        emitBootPhase('auth');
      } catch (err: any) {
        if (cancelled) return;
        const status = (err as any)?.status;
        if (status === 401 || status === 403) {
          attempts = 0;
          // Cookie hilang/tidak valid — coba pulihkan dari token cadangan (PWA fallback)
          const restoreResult = await restoreSession();
          if (cancelled) return;
          if (restoreResult === 'ok') {
            clearPendingRetry();
            retryTimer = setTimeout(checkAuth, 500);
            return;
          }
          if (restoreResult === 'network') {
            scheduleRetry(RETRY_BACKOFF_MS[Math.min(attempts, RETRY_BACKOFF_MS.length - 1)]);
            return;
          }
          clearPendingRetry();
          localStorage.removeItem(TOKEN_STORAGE_KEY);
          setUser(null);
          setLoading(false);
          emitBootPhase('auth');
          return;
        }
        // Error jaringan/timeout/server: jangan kick user (app mungkin sedang restart/deploy).
        attempts += 1;
        if (attempts >= 3) setBootMessage('Koneksi bermasalah — mencoba lagi…');
        scheduleRetry(RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)]);
      } finally {
        inFlight = false;
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') checkAuth();
    };
    window.addEventListener('visibilitychange', onVisibility);

    preloadLikelyPage();
    checkAuth();

    return () => {
      cancelled = true;
      clearPendingRetry();
      window.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const login = async (identifier: string, password: string): Promise<LoginResult> => {
    setLoading(true);
    try {
      const data = await apiRequest('/api/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      });
      if (data.success && data.user) {
        if (data.token) localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
        await fetchRolesFromApi().catch(() => {});
        setUser({
          id: data.user.id,
          email: data.user.email || '',
          name: data.user.name,
          phone: data.user.phone,
          role: data.user.role,
          tenantId: data.user.tenantId || 'default-tenant',
        });
        const role = data.role || data.user.role;
        localStorage.setItem(LAST_ROLE_KEY, role);
        const redirectTo = data.redirectTo || getDefaultRedirect(role);
        return { success: true, role, redirectTo };
      }
      return { success: false, role: 'super_admin', redirectTo: '/admin/overview' };
    } catch (err) {
      setUser(null);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    try {
      await apiRequest('/api/admin/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setUser(null);
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
