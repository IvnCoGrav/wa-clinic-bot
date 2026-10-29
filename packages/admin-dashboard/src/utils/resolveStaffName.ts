/**
 * Resolusi nama terapis berlapis (anti "Belum ditugaskan" palsu).
 *
 * Prioritas:
 *   1. Objek relasi hasil join backend  → `assigned_staff.name`
 *   2. Lookup FK ke daftar staff di UI  → `assigned_staff_id`/`assignedStaffId`
 *   3. Field flat hasil serialisasi      → `assigned_staff_name`/`assignedStaffName`/`staffName`
 *   4. `null` (benar-benar belum ditugaskan)
 *
 * Menerima objek reservasi apa pun (Reservation, item live chat, kartu kalender)
 * sehingga tidak ada lagi duplikasi IIFE di setiap halaman.
 */
export interface StaffLike {
  id: string;
  name?: string | null;
}

export function resolveStaffName(
  source: any,
  staffList?: Array<StaffLike> | null
): string | null {
  if (!source) return null;

  const relName = source.assigned_staff?.name || source.assignedStaff?.name;
  if (relName) return relName;

  const fk = source.assigned_staff_id || source.assignedStaffId || source.staffId;
  if (fk && Array.isArray(staffList)) {
    const found = staffList.find((s) => s && s.id === fk);
    if (found?.name) return found.name;
  }

  const flat = source.assigned_staff_name || source.assignedStaffName || source.staffName;
  if (flat) return flat;

  return null;
}

/**
 * resolveStaffId — seam tunggal pembacaan ID terapis dari objek apa pun
 * (reservasi, item live chat, kartu kalender).
 *
 * Sebelumnya pola `assigned_staff_id || assignedStaffId || staffId` diduplikasi
 * di 5 tempat, sehingga warna/tag per bidan mustahil dibuat konsisten.
 *
 * Prioritas sama dengan `resolveStaffName`: relasi hasil join backend lebih
 * dipercaya daripada FK lepas.
 */
export function resolveStaffId(source: any): string | null {
  if (!source) return null;

  const relId = source.assigned_staff?.id || source.assignedStaff?.id;
  if (relId) return relId;

  const fk = source.assigned_staff_id || source.assignedStaffId || source.staffId;
  if (fk) return fk;

  return null;
}
