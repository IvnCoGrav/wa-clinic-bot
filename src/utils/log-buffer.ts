/**
 * Log Buffer — ring buffer di memori yang menangkap console.log/warn/error/info.
 * Dipakai halaman Debug (observability/tracing). Data TIDAK persisten (in-memory),
 * buffer terbatas (MAX_ENTRIES) dan direplace dari yang paling lama.
 * Fungsionalitas hanya aktif setelah installLogBuffer() dipanggil (saat app start).
 */

import { hashPiiPhone } from './logger-sanitizer';

export type LogLevel = 'log' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  ts: string; // ISO
  level: LogLevel;
  msg: string;
}

const MAX_ENTRIES = 500;
const buffer: LogEntry[] = [];
let nextId = 1;
let installed = false;

// Match phone number patterns (e.g. 628123456789, 08123456789, +628123456789)
const PHONE_PATTERN = /(?:\+?62|0)8[1-9]\d{6,11}/g;

function sanitizeStringPii(str: string): string {
  if (!str) return str;
  return str.replace(PHONE_PATTERN, (match) => hashPiiPhone(match));
}

function safeStringify(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === 'string') return v;
  try {
    if (typeof v === 'object' && v !== null) {
      const s = JSON.stringify(v);
      return s || String(v);
    }
    return String(v);
  } catch {
    return String(v);
  }
}

function capture(level: LogLevel, args: unknown[]): void {
  const rawMsg = args.map((a) => safeStringify(a)).join(' ');
  const msg = sanitizeStringPii(rawMsg);
  buffer.push({ id: nextId++, ts: new Date().toISOString(), level, msg });
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES);
  }
}

export function installLogBuffer(): void {
  if (installed) return;
  installed = true;

  const orig = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  console.log = (...args: unknown[]) => {
    capture('log', args);
    orig.log(...args);
  };
  console.info = (...args: unknown[]) => {
    capture('info', args);
    orig.info(...args);
  };
  console.warn = (...args: unknown[]) => {
    capture('warn', args);
    orig.warn(...args);
  };
  console.error = (...args: unknown[]) => {
    capture('error', args);
    orig.error(...args);
  };
}

export function getLogBuffer(limit = 200, level?: LogLevel | 'all'): LogEntry[] {
  const filtered = level && level !== 'all' ? buffer.filter((e) => e.level === level) : buffer;
  return filtered.slice(-limit).reverse();
}

export function getLogBufferStats(): Record<LogLevel, number> {
  const stats: Record<LogLevel, number> = { log: 0, info: 0, warn: 0, error: 0 };
  for (const e of buffer) stats[e.level] += 1;
  return stats;
}

export function isLogBufferInstalled(): boolean {
  return installed;
}
