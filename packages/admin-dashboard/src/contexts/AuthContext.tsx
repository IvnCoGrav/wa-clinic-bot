import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from '../types';
import { apiRequest } from '../services/api';
import { getDefaultRedirect } from '../config/rolePermissions';

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

    async function checkAuth() {
      try {
        const data = await apiRequest('/api/admin/auth/me');
        if (cancelled) return;
        if (data.authenticated && data.user) {
          setUser({
            id: data.user.id,
            email: data.user.email || '',
            name: data.user.name,
            phone: data.user.phone,
            role: data.user.role || 'super_admin',
            tenantId: data.user.tenantId || 'default-tenant',
          });
        } else {
          setUser(null);
        }
        setLoading(false);
      } catch (err: any) {
        if (cancelled) return;
        const status = (err as any)?.status;
        if (status === 401 || status === 403) {
          // Cookie hilang/tidak valid — coba pulihkan dari token cadangan (PWA fallback)
          const restoreResult = await restoreSession();
          if (cancelled) return;
          if (restoreResult === 'ok') {
            retryTimer = setTimeout(checkAuth, 500);
            return;
          }
          if (restoreResult === 'network') {
            retryTimer = setTimeout(checkAuth, 5000);
            return;
          }
          localStorage.removeItem(TOKEN_STORAGE_KEY);
          setUser(null);
          setLoading(false);
          return;
        }
        // Error jaringan/timeout/server: jangan kick user (app mungkin sedang restart/deploy).
        retryTimer = setTimeout(checkAuth, 5000);
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') checkAuth();
    };
    window.addEventListener('visibilitychange', onVisibility);

    checkAuth();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
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
        setUser({
          id: data.user.id,
          email: data.user.email || '',
          name: data.user.name,
          phone: data.user.phone,
          role: data.user.role,
          tenantId: data.user.tenantId || 'default-tenant',
        });
        const role = data.role || data.user.role;
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
