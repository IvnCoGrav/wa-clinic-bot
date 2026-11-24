import { useState, useCallback, useEffect } from 'react';

/**
 * Hook untuk mengelola visibilitas seri grafik dengan persistensi di localStorage.
 */
export function useChartSeriesToggles<T extends Record<string, boolean>>(
  storageKey: string,
  defaults: T
): {
  visible: T;
  toggle: (key: string) => void;
  setAll: (next: Partial<T>) => void;
} {
  const [visible, setVisible] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          // Hanya ambil key yang ada pada defaults (whitelist)
          const sanitized: Partial<T> = {};
          for (const k of Object.keys(defaults)) {
            if (typeof parsed[k] === 'boolean') {
              (sanitized as any)[k] = parsed[k];
            } else {
              (sanitized as any)[k] = defaults[k];
            }
          }
          return sanitized as T;
        }
      }
    } catch {
      // Ignore localStorage error / private browsing
    }
    return { ...defaults };
  });

  const toggle = useCallback(
    (key: string) => {
      setVisible((prev) => {
        const next = { ...prev, [key]: !prev[key] };
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // Ignore write error
        }
        return next;
      });
    },
    [storageKey]
  );

  const setAll = useCallback(
    (nextUpdates: Partial<T>) => {
      setVisible((prev) => {
        const next = { ...prev, ...nextUpdates };
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // Ignore write error
        }
        return next;
      });
    },
    [storageKey]
  );

  return { visible, toggle, setAll };
}
