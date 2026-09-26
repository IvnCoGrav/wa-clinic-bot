// Helper pemulihan sesi dari token cadangan localStorage (fallback PWA).
//
// Kontrak hasil — INI pengganti pola lama yang MEMBUNUH token pada error apapun:
// - 'ok'      → server mengesahkan ulang cookie.
// - 'invalid' → server TEGAS menolak token (400/401/403) → caller boleh menghapus
//               token cadangan dan menampilkan halaman login.
// - 'network' → server tak bisa dihubungi (timeout/5xx/503 SESSION_STORE_UNAVAILABLE)
//               → token cadangan WAJIB dipertahankan; caller hanya me-retry backoff.
//
// Akar bug yang diperbaiki: restoreSession() lama memakai timeout 3000ms lalu
// `catch { localStorage.removeItem(...); return 'invalid'; }` — timeout jaringan
// 4G lambat / DB sesi sedang down dianggap "token invalid" → logout paksa
// berulang walau sesi 30-hari di database masih sah.
import { apiRequest } from './api';

export type SessionRestoreResult = 'ok' | 'invalid' | 'network';

const EXPLICIT_REJECT_STATUSES = new Set([400, 401, 403]);

export async function restoreSessionToken(
  url: string,
  storageKey: string,
  timeoutMs = 8000
): Promise<SessionRestoreResult> {
  const token = localStorage.getItem(storageKey);
  if (!token) return 'invalid';
  try {
    const res = await apiRequest(url, {
      method: 'POST',
      body: JSON.stringify({ token }),
      timeoutMs,
    });
    return res && res.success ? 'ok' : 'invalid';
  } catch (err: any) {
    const status: number | undefined = err?.status;
    // Hanya penolakan tegas dari server = token mati. Sisanya (timeout, 5xx,
    // 503 session-store) = gangguan sementara → jangan buang token.
    if (status !== undefined && EXPLICIT_REJECT_STATUSES.has(status)) return 'invalid';
    return 'network';
  }
}
