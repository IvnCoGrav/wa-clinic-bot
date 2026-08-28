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
const LAST_USER_KEY = 'last_auth_user';

function getInitialUser(): User | null {
  try {
    const raw = localStorage.getItem(LAST_USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

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
  const [user, setUser] = useState<User | null>(getInitialUser);
  const [loading, setLoading] = useState<boolean>(() => {
    return !getInitialUser() && !localStorage.getItem(TOKEN_STORAGE_KEY);
  });

  async function restoreSession(): Promise<'ok' | 'invalid' | 'network'> {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!token) return 'invalid';
    try {
      const res = await apiRequest('/api/admin/auth/restore', {
        method: 'POST',
        body: JSON.stringify({ token }),
        timeoutMs: 3000,
      });
      return res && res.success ? 'ok' : 'invalid';
    } catch {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      return 'invalid';
    }
  }

  // Check auth session on mount
  useEffect(() => {
    let cancelled = false;
    let retryTimer: any = null;
    let onlineHandler: (() => void) | null = null;
    let attempts = 0;
    let inFlight = false;

    // Hard Safety Timeout: Maksimal 2.5 detik loading auth HARUS selesai agar user tidak stuck di spinner
    const hardSafetyTimer = setTimeout(() => {
      if (!cancelled) {
        setLoading(false);
        emitBootPhase('auth');
      }
    }, 2500);

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
      if (attempts >= 3) {
        // Jangan retry terus-menerus di state loading, lepaskan loading ke UI
        setLoading(false);
        emitBootPhase('auth');
        return;
      }
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
        }, Math.max(delayMs, 5000));
        return;
      }
      retryTimer = setTimeout(checkAuth, delayMs);
    };

    async function checkAuth() {
      if (inFlight || cancelled) return;
      inFlight = true;
      try {
        const data = await apiRequest('/api/admin/auth/me', { timeoutMs: 4000 });
        if (cancelled) return;
        attempts = 0;
        clearPendingRetry();
        clearTimeout(hardSafetyTimer);
        if (data.authenticated && data.user) {
          const freshUser: User = {
            id: data.user.id,
            email: data.user.email || '',
            name: data.user.name,
            phone: data.user.phone,
            role: data.user.role || 'super_admin',
            tenantId: data.user.tenantId || 'default-tenant',
          };
          setUser(freshUser);
          try {
            localStorage.setItem(LAST_USER_KEY, JSON.stringify(freshUser));
            if (freshUser.role) localStorage.setItem(LAST_ROLE_KEY, freshUser.role);
          } catch {}
          fetchRolesFromApi().catch(() => {});
        } else {
          setUser(null);
          try {
            localStorage.removeItem(LAST_USER_KEY);
          } catch {}
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
            retryTimer = setTimeout(checkAuth, 300);
            return;
          }
          clearPendingRetry();
          clearTimeout(hardSafetyTimer);
          localStorage.removeItem(TOKEN_STORAGE_KEY);
          localStorage.removeItem(LAST_USER_KEY);
          setUser(null);
          setLoading(false);
          emitBootPhase('auth');
          return;
        }
        // Error jaringan/timeout/server
        attempts += 1;
        if (attempts >= 2) {
          clearTimeout(hardSafetyTimer);
          setLoading(false);
          emitBootPhase('auth');
        } else {
          scheduleRetry(RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)]);
        }
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
      clearTimeout(hardSafetyTimer);
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
        const authUser: User = {
          id: data.user.id,
          email: data.user.email || '',
          name: data.user.name,
          phone: data.user.phone,
          role: data.user.role,
          tenantId: data.user.tenantId || 'default-tenant',
        };
        setUser(authUser);
        const role = data.role || data.user.role;
        try {
          localStorage.setItem(LAST_USER_KEY, JSON.stringify(authUser));
          localStorage.setItem(LAST_ROLE_KEY, role);
        } catch {}
        const redirectTo = data.redirectTo || getDefaultRedirect(role);
        return { success: true, role, redirectTo };
      }
      return { success: false, role: 'super_admin', redirectTo: '/admin/overview' };
    } catch (err) {
      setUser(null);
      try {
        localStorage.removeItem(LAST_USER_KEY);
      } catch {}
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(LAST_USER_KEY);
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
