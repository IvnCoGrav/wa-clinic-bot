import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { useCopilotSession, type CopilotSessionState } from './copilot/useCopilotSession';

/**
 * CopilotContext — state UI shell & sesi terpusat: panel AI Copilot + menu mobile.
 *
 * Dibuat terpusat agar:
 * 1. Tombol on/off + status Copilot dapat diletakkan di SIDEBAR (Layout.tsx) maupun header LiveChat.
 * 2. Sesi chat & pemrosesan Copilot tetap hidup di level App saat panel ditutup atau admin berpindah halaman.
 * 3. Menu mobile terkoordinasi dengan history browser.
 */

const STORAGE_KEY = 'wa_clinic_copilot_open';

export interface CopilotContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /** Sidebar mobile terbuka/tutup — diangkat dari Layout agar tombol ☰ di dalam scroll LiveChat dapat membukanya. */
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  /** Buka sidebar + catat history (agar swipe-back menutup menu dulu, bukan keluar halaman). */
  openMobileMenu: () => void;
  /** Tutup sidebar + rapikan history. */
  dismissMobileMenu: () => void;
  /** Mesin sesi & riwayat Copilot */
  session: CopilotSessionState;
  send: (text: string, ctx?: { conversationId?: string | null; customerId?: string | null }) => Promise<void>;
  cancel: () => void;
  reset: () => void;
  markRead: () => void;
  /** Konteks percakapan/pasien aktif saat ini */
  context: { conversationId: string | null; customerId: string | null };
  setContext: (ctx: { conversationId: string | null; customerId: string | null }) => void;
}

const CopilotContext = createContext<CopilotContextValue | null>(null);

function getStoredOpen(): boolean {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export const CopilotProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [open, setOpenState] = useState<boolean>(() => getStoredOpen());
  const [mobileMenuOpen, setMobileMenuOpenState] = useState<boolean>(false);
  const [chatContext, setChatContext] = useState<{ conversationId: string | null; customerId: string | null }>({
    conversationId: null,
    customerId: null,
  });

  const session = useCopilotSession({
    tenantId: user?.tenantId ?? 'default-tenant',
    adminEmail: user?.email ?? 'anon',
    getPanelVisible: () => open && typeof document !== 'undefined' && document.visibilityState === 'visible',
  });

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      if (next) {
        session.markRead();
      }
      try {
        localStorage.setItem(STORAGE_KEY, next ? 'true' : 'false');
      } catch {
        // Abaikan (private mode) — state tetap berlaku untuk sesi ini.
      }
    },
    [session]
  );

  const toggle = useCallback(() => {
    setOpenState((prev) => {
      const next = !prev;
      if (next) {
        session.markRead();
      }
      try {
        localStorage.setItem(STORAGE_KEY, next ? 'true' : 'false');
      } catch {
        // Abaikan.
      }
      return next;
    });
  }, [session]);

  const setMobileMenuOpen = useCallback((next: boolean) => {
    setMobileMenuOpenState(next);
  }, []);

  const menuHistoryPushedRef = useRef(false);

  const openMobileMenu = useCallback(() => {
    setMobileMenuOpenState(true);
    try {
      window.history.pushState({ modal: 'mobile-menu' }, '');
      menuHistoryPushedRef.current = true;
    } catch {
      // Abaikan (SSR/tes).
    }
  }, [menuHistoryPushedRef]);

  const dismissMobileMenu = useCallback(() => {
    setMobileMenuOpenState(false);
    menuHistoryPushedRef.current = false;
    try {
      if (typeof window !== 'undefined' && (window.history.state as { modal?: string } | null)?.modal === 'mobile-menu') {
        window.history.back();
      }
    } catch {
      // Abaikan.
    }
  }, [menuHistoryPushedRef]);

  const setContext = useCallback((ctx: { conversationId: string | null; customerId: string | null }) => {
    setChatContext(ctx);
  }, []);

  return (
    <CopilotContext.Provider
      value={{
        open,
        setOpen,
        toggle,
        mobileMenuOpen,
        setMobileMenuOpen,
        openMobileMenu,
        dismissMobileMenu,
        session,
        send: session.send,
        cancel: session.cancel,
        reset: session.reset,
        markRead: session.markRead,
        context: chatContext,
        setContext,
      }}
    >
      {children}
    </CopilotContext.Provider>
  );
};

export function useCopilot(): CopilotContextValue {
  const ctx = useContext(CopilotContext);
  if (!ctx) {
    throw new Error('useCopilot must be used within CopilotProvider');
  }
  return ctx;
}

export const COPILOT_STORAGE_KEY = STORAGE_KEY;
