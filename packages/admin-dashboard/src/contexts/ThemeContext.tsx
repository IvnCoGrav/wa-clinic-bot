import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * ThemeContext — Dual Theme Light/Dark untuk Admin Dashboard.
 *
 * - Preferensi: 'light' | 'dark' | 'system' (default: 'system').
 * - Disimpan di localStorage `wa_clinic_theme` (preferensi per-browser,
 *   BUKAN data bisnis — tidak perlu tenant-aware / DB).
 * - Mode 'system' mengikuti `prefers-color-scheme: dark` OS secara live.
 * - Menerapkan/menghapus class `.dark` pada `<html>` agar Tailwind
 *   `darkMode: 'class'` + override CSS `.dark` di index.css aktif.
 * - Anti-flicker: index.html memuat skrip inline kecil yang membaca
 *   localStorage yang sama sebelum React boot.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'wa_clinic_theme';

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (pref: ThemePreference) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getStoredPreference(): ThemePreference {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return 'system';
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // Abaikan (private mode / storage diblokir) — fallback ke system.
  }
  return 'system';
}

function resolveSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyResolvedTheme(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (resolved === 'dark') {
    root.classList.add('dark');
    root.style.colorScheme = 'dark';
  } else {
    root.classList.remove('dark');
    root.style.colorScheme = 'light';
  }
  // Sinkronkan theme-color untuk mobile browser chrome / PWA.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', resolved === 'dark' ? '#000000' : '#ffffff');
  }
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => getStoredPreference());
  const [systemDark, setSystemDark] = useState<boolean>(() => resolveSystemTheme() === 'dark');

  const resolved: ResolvedTheme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  // Pantau perubahan preferensi OS secara live (hanya relevan saat preference = 'system').
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Terapkan class .dark setiap kali hasil resolusi berubah.
  useEffect(() => {
    applyResolvedTheme(resolved);
  }, [resolved]);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    try {
      localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      // Abaikan — tema tetap berlaku untuk sesi ini.
    }
  }, []);

  const toggle = useCallback(() => {
    setPreferenceState((prev) => {
      const currentResolved: ResolvedTheme =
        prev === 'system' ? (resolveSystemTheme() === 'dark' ? 'dark' : 'light') : prev;
      const next: ResolvedTheme = currentResolved === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Abaikan.
      }
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}

export const THEME_STORAGE_KEY = STORAGE_KEY;
