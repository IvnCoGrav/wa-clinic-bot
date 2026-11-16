/**
 * Observabilitas penolakan bisnis staf di lapangan (F5).
 * Mencatat setiap penolakan HTTP 400 (seperti validasi gagal, hak akses, status ilegal)
 * ke konsol yang otomatis dialirkan oleh log-buffer.ts ke logs/app-YYYY-MM-DD.log.
 */

export interface StaffRejectionParams {
  endpoint: string;
  staffId?: string;
  staffName?: string;
  tenantId?: string;
  targetId?: string;
  reason: string;
  payload?: Record<string, unknown>;
}

export function logStaffRejection(params: StaffRejectionParams): void {
  const {
    endpoint,
    staffId = 'anonymous',
    staffName = 'unknown',
    tenantId = 'default',
    targetId = '-',
    reason,
    payload,
  } = params;

  const extra = payload ? ` payload=${JSON.stringify(payload)}` : '';
  console.warn(
    `[STAFF REJECTION] endpoint=${endpoint} staffId=${staffId} staffName=${staffName} tenantId=${tenantId} targetId=${targetId} reason="${reason}"${extra}`
  );
}
