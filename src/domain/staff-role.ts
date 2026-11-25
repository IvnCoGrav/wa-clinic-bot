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

/**
 * Kontrak TERTUTUP peran terapis lapangan. Daftar ini sengaja eksplisit agar
 * peran semu/kontradiktif (NON_THERAPIST, ADMIN_THERAPIST, EX_THERAPIST) tidak
 * lolos. Untuk menambah role tenant baru, tambahkan kuncinya di sini DAN di
 * `tests/unit/staff-role-alert-delivery.test.ts`; jangan memakai pencocokan
 * substring karena akan meloloskan nama yang mengandung "THERAPIST".
 */
const CANONICAL_THERAPIST_ROLES = new Set([
  'THERAPIST',
  'TERAPIS',
  'SENIOR_THERAPIST',
  'JUNIOR_THERAPIST',
  'TERAPIS_SENIOR',
  'TERAPIS_JUNIOR',
  'BIDAN',
  'BIDAN_SENIOR',
  'BIDAN_JUNIOR',
]);

/**
 * Predikat peran terapis lapangan (homecare).
 * Hanya peran ini yang menjalankan tugas visit ke pasien dan dievaluasi keterlambatannya.
 * Menggunakan pencocokan whitelist kanonis eksplisit untuk mencegah lolosnya peran
 * semu/kontradiktif (mis. NON_THERAPIST, ADMIN_THERAPIST).
 *
 * Catatan kontrak: custom role tenant di luar daftar di atas TIDAK dianggap
 * terapis sampai ditambahkan secara sengaja (lihat docs/KNOWN_ISSUES.md, entri
 * "Spesialisasi Departure Watchdog").
 */
export function isStaffTherapistRole(role?: string | null): boolean {
  if (!role || typeof role !== 'string') return false;
  const normalized = role.trim().toUpperCase().replace(/\s+/g, '_');
  return CANONICAL_THERAPIST_ROLES.has(normalized);
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
