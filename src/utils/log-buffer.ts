/**
 * Log Buffer — ring buffer di memori yang menangkap console.log/warn/error/info.
 * Dilengkapi dengan persistent background file logger (logs/app-YYYY-MM-DD.log),
 * startup rehydration (agar log tidak hilang saat update/restart), dan auto-rotation 7 hari.
 * Pembacaan di dashboard tetap MEMORY-FIRST (<1ms) tanpa blank screen / lag.
 */

import fs from 'fs';
import path from 'path';
import { hashPiiPhone } from './logger-sanitizer';

export type LogLevel = 'log' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  ts: string; // ISO
  level: LogLevel;
  msg: string;
}

const MAX_ENTRIES = 500;
const MAX_LOG_RETENTION_DAYS = 7;
const buffer: LogEntry[] = [];
let nextId = 1;
let installed = false;

// Match phone number patterns (e.g. 628123456789, 08123456789, +628123456789)
const PHONE_PATTERN = /(?:\+?62|0)8[1-9]\d{6,11}/g;

const LOGS_DIR = path.resolve(process.cwd(), 'logs');

// Background asynchronous file append queue (non-blocking)
let writeQueue: string[] = [];
let isFlushing = false;
let flushTimer: NodeJS.Timeout | null = null;

function ensureLogsDir(): void {
  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
  } catch {}
}

function getLogDateString(d = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getAppLogFilePath(d = new Date()): string {
  return path.join(LOGS_DIR, `app-${getLogDateString(d)}.log`);
}

function scheduleFlush(): void {
  if (flushTimer || writeQueue.length === 0) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushWriteQueue();
  }, 250);
  if ((flushTimer as any).unref) {
    (flushTimer as any).unref();
  }
}

async function flushWriteQueue(): Promise<void> {
  if (isFlushing || writeQueue.length === 0) return;
  if (process.env.NODE_ENV === 'test') {
    writeQueue = [];
    return;
  }

  isFlushing = true;
  const chunk = writeQueue.splice(0, writeQueue.length);
  try {
    ensureLogsDir();
    const filePath = getAppLogFilePath();
    await fs.promises.appendFile(filePath, chunk.join('\n') + '\n', 'utf8');
  } catch (_) {
    // Best-effort file writing, never throw or interrupt console
  } finally {
    isFlushing = false;
    if (writeQueue.length > 0) {
      scheduleFlush();
    }
  }
}

function sanitizeStringPii(str: string): string {
  if (!str) return str;
  return str.replace(PHONE_PATTERN, (match) => hashPiiPhone(match));
}

function safeStringify(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}${v.stack ? '\n' + v.stack : ''}`;
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
  const ts = new Date().toISOString();
  const entry: LogEntry = { id: nextId++, ts, level, msg };

  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES);
  }

  // Queue to persistent file stream
  if (process.env.NODE_ENV !== 'test') {
    const fileLine = JSON.stringify({ ts, level, msg });
    writeQueue.push(fileLine);
    if (writeQueue.length >= 20) {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      void flushWriteQueue();
    } else {
      scheduleFlush();
    }
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

/**
 * Rehydrate log buffer dari file disk saat server baru boot/restart.
 * Membaca baris terakhir dari file hari ini (+ kemarin jika kurang) ke memori.
 */
export async function rehydrateLogBuffer(): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;

  try {
    ensureLogsDir();
    const todayPath = getAppLogFilePath();
    const loadedEntries: LogEntry[] = [];

    const readEntriesFromFile = async (filePath: string) => {
      if (!fs.existsSync(filePath)) return [];
      const content = await fs.promises.readFile(filePath, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      const entries: LogEntry[] = [];
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.ts && parsed.level && parsed.msg) {
            entries.push({
              id: nextId++,
              ts: parsed.ts,
              level: parsed.level as LogLevel,
              msg: parsed.msg,
            });
          }
        } catch {
          // Format plain text fallback
          const match = line.match(/^\[(.*?)\]\s*\[(.*?)\]\s*(.*)$/);
          if (match) {
            entries.push({
              id: nextId++,
              ts: match[1],
              level: (match[2].toLowerCase() as LogLevel) || 'log',
              msg: match[3],
            });
          }
        }
      }
      return entries;
    };

    const todayEntries = await readEntriesFromFile(todayPath);
    loadedEntries.push(...todayEntries);

    // Jika hari ini baru ada sedikit log (< 150), ambil juga dari file kemarin
    if (loadedEntries.length < 150) {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const yesterdayPath = getAppLogFilePath(yesterday);
      const yesterdayEntries = await readEntriesFromFile(yesterdayPath);
      loadedEntries.unshift(...yesterdayEntries);
    }

    if (loadedEntries.length > 0) {
      const recent = loadedEntries.slice(-MAX_ENTRIES);
      // Prepend loaded entries before any current startup entries
      const existing = [...buffer];
      buffer.length = 0;
      buffer.push(...recent);
      for (const ex of existing) {
        if (!buffer.some((b) => b.ts === ex.ts && b.msg === ex.msg)) {
          buffer.push(ex);
        }
      }
      if (buffer.length > MAX_ENTRIES) {
        buffer.splice(0, buffer.length - MAX_ENTRIES);
      }
    }

    // Jalankan auto-cleanup file log lama
    void cleanOldLogFiles();
  } catch (err: any) {
    console.warn('[LOG BUFFER] Gagal rehydrate log buffer:', err.message);
  }
}

/**
 * Hapus file log yang lebih lama dari retensi yang ditentukan (default 7 hari).
 */
export async function cleanOldLogFiles(daysToKeep = MAX_LOG_RETENTION_DAYS): Promise<number> {
  if (process.env.NODE_ENV === 'test') return 0;
  let deletedCount = 0;

  try {
    if (!fs.existsSync(LOGS_DIR)) return 0;
    const files = await fs.promises.readdir(LOGS_DIR);
    const now = Date.now();
    const maxAgeMs = daysToKeep * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (!file.startsWith('app-') && !file.startsWith('llm-')) continue;
      const fullPath = path.join(LOGS_DIR, file);
      try {
        const stats = await fs.promises.stat(fullPath);
        if (now - stats.mtimeMs > maxAgeMs) {
          await fs.promises.unlink(fullPath);
          deletedCount++;
        }
      } catch {}
    }
  } catch {}

  return deletedCount;
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

