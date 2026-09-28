/**
 * auth-access-log.ts — Observabilitas forensik jalur autentikasi (KNOWN_ISSUES #143).
 *
 * Latar: saat investigasi live insiden logout, log tidak memuat baris status untuk
 * `/api/admin/auth/me` & `/restore` (Fastify handler diam, Caddy tak mencatat),
 * sehingga forensic "berapa kali 401 vs 503 dalam 24 jam" mustahil.
 *
 * Solusi fondasional: SATU hook deterministik (`onResponse`) yang mencatat baris
 * JSON ringkas untuk respons auth 401/503. Tanpa duplikasi per-route. Token penuh
 * DILARANG masuk log — hanya `session_hash_prefix8` (sha256, 8 hex) untuk korelasi.
 */

import crypto from 'crypto';

export interface AuthAccessLogInput {
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  /** Cookie header mentah (opsional). Hanya hash-nya yang dicatat. */
  cookieHeader?: string;
  /** IP klien — di-hash agar tidak menyimpan PII mentah. */
  ip?: string;
  /** ID request Fastify (korelasi antar-log). */
  reqId?: string;
}

export interface AuthAccessLogEntry {
  event: 'AUTH_ACCESS';
  path: string;
  method: string;
  status: number;
  signal: '401' | '503';
  latencyMs: number;
  sessionHashPrefix8?: string;
  ipHashPrefix8?: string;
  reqId?: string;
  ts: string;
}

const AUTH_PATH_RE = /^\/api\/(admin|staff)\/auth\//;

/**
 * Jalur mana yang layak dicatat. Fokus: endpoint auth eksplisit, DAN respons
 * 401/503 pada rute admin/staff (preHandler auth) — di situlah sinyal ambigu
 * 401-vs-503 muncul. Selain itu tidak dicatat (menjaga volume log tetap kecil).
 */
export function shouldLogAuthAccess(path: string, statusCode: number): boolean {
  if (statusCode !== 401 && statusCode !== 503) return false;
  if (AUTH_PATH_RE.test(path)) return true;
  if (path.startsWith('/api/admin') || path.startsWith('/api/staff')) return true;
  return false;
}

function sha8(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 8);
}

/** Ambil token sesi (admin/staff) dari cookie header tanpa mengeksposnya. */
export function extractSessionTokenPrefix8(cookieHeader?: string): string | undefined {
  if (!cookieHeader) return undefined;
  const m = cookieHeader.match(/(?:admin_session|staff_session)=([^;]+)/);
  if (!m || !m[1]) return undefined;
  return sha8(m[1]);
}

/**
 * Bangun entri log murni (deterministik, testable). Tidak melakukan I/O.
 * `now` dapat diinjeksi untuk test.
 */
export function buildAuthAccessLogEntry(
  input: AuthAccessLogInput,
  now: Date = new Date()
): AuthAccessLogEntry {
  const signal = input.statusCode === 503 ? '503' : '401';
  return {
    event: 'AUTH_ACCESS',
    path: input.path,
    method: input.method,
    status: input.statusCode,
    signal,
    latencyMs: Math.round(input.latencyMs),
    sessionHashPrefix8: extractSessionTokenPrefix8(input.cookieHeader),
    ipHashPrefix8: input.ip ? sha8(input.ip) : undefined,
    reqId: input.reqId,
    ts: now.toISOString(),
  };
}

/** Emit entri ke console (ditangkap log-buffer → file + dashboard). */
export function emitAuthAccessLog(entry: AuthAccessLogEntry): void {
  // Satu baris JSON ringkas: mudah di-grep, aman (tanpa token/IP mentah).
  console.warn(`[AUTH ACCESS] ${JSON.stringify(entry)}`);
}
