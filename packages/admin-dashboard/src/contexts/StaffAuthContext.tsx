import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiRequest } from '../services/api';
import { emitBootPhase, setBootMessage } from '../lib/bootProgress';

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
const LAST_ROLE_KEY = 'last_admin_role';

// Backoff adaptif: cepat di percobaan awal (transient), melebar ke radio-wake HP.
const RETRY_BACKOFF_MS = [1000, 2500, 5000, 8000, 8000];

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
        const data = await apiRequest('/api/staff/auth/me');
        if (cancelled) return;
        attempts = 0;
        clearPendingRetry();
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
          setStaff(null);
          setLoading(false);
          emitBootPhase('auth');
          return;
        }
        // Error jaringan/timeout/server: jangan kick user (app mungkin sedang restart/deploy).
        // Tetap di state loading & retry di latar belakang sampai server pulih.
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

    checkAuth();

    return () => {
      cancelled = true;
      clearPendingRetry();
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
        localStorage.setItem(LAST_ROLE_KEY, data.staff.role || 'therapist');
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
