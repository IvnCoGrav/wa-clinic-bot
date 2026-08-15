import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiRequest } from '../services/api';

export interface StaffUser {
  id: string;
  name: string;
  role: string;
  phone?: string;
}

interface StaffAuthContextType {
  staff: StaffUser | null;
  loading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const StaffAuthContext = createContext<StaffAuthContextType | undefined>(undefined);

// Token cadangan untuk fallback PWA (cookie bisa hilang saat aplikasi Android ditutup,
// sesi server tetap valid — token ini dipakai untuk me-issue ulang cookie via /restore).
const TOKEN_STORAGE_KEY = 'staff_session_token';

export const StaffAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [staff, setStaff] = useState<StaffUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function restoreSession(): Promise<'ok' | 'invalid' | 'network'> {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!token) return 'invalid';
    try {
      const res = await apiRequest('/api/staff/auth/restore', {
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
        const data = await apiRequest('/api/staff/auth/me');
        if (cancelled) return;
        if (data.authenticated && data.staff) {
          setStaff({
            id: data.staff.id,
            name: data.staff.name,
            role: data.staff.role || 'staff',
            phone: data.staff.phone,
          });
        } else {
          setStaff(null);
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
            // Server sedang bermasalah — jangan hapus token, retry nanti
            retryTimer = setTimeout(checkAuth, 5000);
            return;
          }
          localStorage.removeItem(TOKEN_STORAGE_KEY);
          setStaff(null);
          setLoading(false);
          return;
        }
        // Error jaringan/timeout/server: jangan kick user (app mungkin sedang restart/deploy).
        // Tetap di state loading & retry di latar belakang sampai server pulih.
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

  const login = async (phone: string, password: string) => {
    setLoading(true);
    try {
      const data = await apiRequest('/api/staff/auth/login', {
        method: 'POST',
        body: JSON.stringify({ phone, password }),
      });
      if (data.success && data.staff) {
        if (data.token) localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
        setStaff({
          id: data.staff.id,
          name: data.staff.name,
          role: data.staff.role || 'staff',
        });
      }
    } catch (err) {
      setStaff(null);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    try {
      await apiRequest('/api/staff/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Staff logout error:', err);
    } finally {
      setStaff(null);
      setLoading(false);
    }
  };

  return (
    <StaffAuthContext.Provider value={{ staff, loading, login, logout }}>
      {children}
    </StaffAuthContext.Provider>
  );
};

export const useStaffAuth = () => {
  const context = useContext(StaffAuthContext);
  if (!context) {
    throw new Error('useStaffAuth must be used within a StaffAuthProvider');
  }
  return context;
};
