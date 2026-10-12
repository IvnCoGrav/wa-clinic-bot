import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

/**
 * CopilotContext — state UI shell terpusat: panel AI Copilot + menu mobile.
 *
 * Dibuat terpusat agar tombol on/off dapat diletakkan di SIDEBAR (Layout.tsx)
 * maupun di dalam scroll LiveChat (Mobile Page Header LiveChatMonitor.tsx),
 * sementara panelnya hidup di LiveChatMonitor.tsx. Preferensi copilot disimpan
 * di localStorage (preferensi UI per-browser, bukan data bisnis → tidak perlu DB).
 * State menu mobile bersifat sesi (tanpa persist) agar tidak terkunci terbuka
 * setelah reload.
 */

const STORAGE_KEY = 'wa_clinic_copilot_open';

interface CopilotContextValue {
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
  const [open, setOpenState] = useState<boolean>(() => getStoredOpen());
  const [mobileMenuOpen, setMobileMenuOpenState] = useState<boolean>(false);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'true' : 'false');
    } catch {
      // Abaikan (private mode) — state tetap berlaku untuk sesi ini.
    }
  }, []);

  const toggle = useCallback(() => {
    setOpenState((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? 'true' : 'false');
      } catch {
        // Abaikan.
      }
      return next;
    });
  }, []);

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

  return (
    <CopilotContext.Provider value={{ open, setOpen, toggle, mobileMenuOpen, setMobileMenuOpen, openMobileMenu, dismissMobileMenu }}>
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
