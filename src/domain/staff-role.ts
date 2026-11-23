/**
 * staff-role.ts
 *
 * Predikat peran staf dan gerbang isolasi event staf. Murni (tanpa I/O) agar
 * dapat dipakai subroute tanpa mengimpor `src/routes/staff.route.ts`
 * (memutus siklus import route).
 */

export function isStaffSupervisorRole(role?: string | null): boolean {
  const r = String(role || '').toLowerCase();
  return r === 'spv_cs' || r === 'super_admin' || r === 'tenant_admin' || r === 'admin_cs' || r === 'admin';
}

export interface StaffAlertDeliveryInput {
  isSupervisor: boolean;
  staffId?: string | null;
  alertStaffId?: string | null;
}

/**
 * Event alert staf hanya boleh diterima pemiliknya. Supervisor boleh semua.
 * Fail-closed: alert tanpa pemilik (mis. reservasi belum ditugaskan) TIDAK
 * pernah dikirim ke terapis non-supervisor.
 */
export function canReceiveStaffAlert(input: StaffAlertDeliveryInput): boolean {
  if (input.isSupervisor) return true;
  const self = String(input.staffId || '').trim();
  const owner = String(input.alertStaffId || '').trim();
  if (!self || !owner) return false;
  return owner === self;
}
