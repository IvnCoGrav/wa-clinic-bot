import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * CopilotContext — state buka/tutup panel AI Copilot LiveChat.
 *
 * Dibuat terpusat agar tombol on/off dapat diletakkan di SIDEBAR (Layout.tsx)
 * sementara panelnya hidup di LiveChatMonitor.tsx. Preferensi disimpan di
 * localStorage (preferensi UI per-browser, bukan data bisnis → tidak perlu DB).
 */

const STORAGE_KEY = 'wa_clinic_copilot_open';

interface CopilotContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
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

  return (
    <CopilotContext.Provider value={{ open, setOpen, toggle }}>
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
