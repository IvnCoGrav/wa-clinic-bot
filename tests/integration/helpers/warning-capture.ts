import { vi } from 'vitest';

export interface CapturedWarning {
  event: string;
  [key: string]: unknown;
}

export function captureWarningEvents() {
  const events: CapturedWarning[] = [];
  const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    for (const arg of args) {
      if (typeof arg !== 'string') continue;
      try {
        const parsed = JSON.parse(arg);
        if (parsed && typeof parsed.event === 'string') events.push(parsed);
      } catch {}
    }
  });
  return { events, restore: () => spy.mockRestore() };
}
