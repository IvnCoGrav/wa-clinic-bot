// Mekanisme progress boot ringan (tanpa library): komponen halaman ber-emit fase,
// BootProgress meng-consume. Hanya relevan untuk boot pertama aplikasi (PWA).

export type BootPhase = 'auth' | 'chunk' | 'mount' | 'data' | 'done';

const reached = new Set<BootPhase>();
const listeners = new Set<() => void>();
let bootFinished = false;

export const isBootFinished = (): boolean => bootFinished;

export function emitBootPhase(phase: BootPhase): void {
  if (bootFinished) return;
  reached.add(phase);
  listeners.forEach((l) => l());
}

export function hasBootPhase(phase: BootPhase): boolean {
  return reached.has(phase);
}

export function markBootFinished(): void {
  if (bootFinished) return;
  bootFinished = true;
  reached.clear();
  listeners.forEach((l) => l());
}

export function onBootProgress(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

let message = '';
const messageListeners = new Set<(m: string) => void>();

export function setBootMessage(msg: string): void {
  message = msg;
  messageListeners.forEach((l) => l(msg));
}

export function getBootMessage(): string {
  return message;
}

export function onBootMessage(fn: (m: string) => void): () => void {
  messageListeners.add(fn);
  return () => {
    messageListeners.delete(fn);
  };
}
