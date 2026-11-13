// Helper pemulihan sesi. S-011: token TIDAK lagi disimpan di localStorage —
// sesi dipulihkan lewat cookie HttpOnly `admin_session`/`staff_session`.
// Token body dipertahankan hanya untuk kompatibilitas perangkat lama yang
// masih menyimpan token cadangan; perangkat baru mengirim tanpa token.
import { apiRequest } from './api';

export type SessionRestoreResult = 'ok' | 'invalid' | 'network';

const EXPLICIT_REJECT_STATUSES = new Set([400, 401, 403]);

export async function restoreSessionToken(
  url: string,
  storageKey: string,
  timeoutMs = 8000
): Promise<SessionRestoreResult> {
  const legacyToken = localStorage.getItem(storageKey);
  try {
    const res = await apiRequest(url, {
      method: 'POST',
      ...(legacyToken ? { body: JSON.stringify({ token: legacyToken }) } : {}),
      timeoutMs,
    });
    return res && res.success ? 'ok' : 'invalid';
  } catch (err: any) {
    const status: number | undefined = err?.status;
    // Hanya penolakan tegas dari server = sesi mati. Sisanya (timeout, 5xx,
    // 503 session-store) = gangguan sementara → jangan buang sesi.
    if (status !== undefined && EXPLICIT_REJECT_STATUSES.has(status)) return 'invalid';
    return 'network';
  }
}
