import { AsyncLocalStorage } from 'async_hooks';

export interface ContextData {
  correlationId?: string;
  phone?: string;
}

export const contextStorage = new AsyncLocalStorage<ContextData>();

let isInitialized = false;

/**
 * Inisialisasi wrapper global untuk console.log/warn/error agar otomatis
 * menyertakan Correlation ID ketika berjalan di dalam request context.
 */
export function initializeConsoleWrapper(): void {
  // GUARD anti double-wrap & infinite recursion: marker namespaced. Jika console.log
  // sudah di-wrap oleh installer lain (mis. installLogBuffer), wrapper TETAP chain ke
  // `.original` yang ada — jangan pernah memanggil console.log secara langsung di dalam
  // wrapper sendiri (itu source of infinite recursion).
  if ((console.log as any).__contextWrapped) return;

  const originalLog = (console.log as any).original || console.log;
  const originalWarn = (console.warn as any).original || console.warn;
  const originalError = (console.error as any).original || console.error;

  console.log = (...args: any[]) => {
    const store = contextStorage.getStore();
    const targetLog = (console.log as any).original || originalLog;
    if (store && store.correlationId) {
      targetLog(`[CorrelationID: ${store.correlationId}]`, ...args);
    } else {
      targetLog(...args);
    }
  };
  (console.log as any).__contextWrapped = true;
  (console.log as any).original = originalLog;

  console.warn = (...args: any[]) => {
    const store = contextStorage.getStore();
    const targetWarn = (console.warn as any).original || originalWarn;
    if (store && store.correlationId) {
      targetWarn(`[CorrelationID: ${store.correlationId}]`, ...args);
    } else {
      targetWarn(...args);
    }
  };
  (console.warn as any).__contextWrapped = true;
  (console.warn as any).original = originalWarn;

  console.error = (...args: any[]) => {
    const store = contextStorage.getStore();
    const targetError = (console.error as any).original || originalError;
    if (store && store.correlationId) {
      targetError(`[CorrelationID: ${store.correlationId}]`, ...args);
    } else {
      targetError(...args);
    }
  };
  (console.error as any).__contextWrapped = true;
  (console.error as any).original = originalError;
}
