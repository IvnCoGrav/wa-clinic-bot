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
/**
 * Gelar/jabatan yang menempel di DEPAN nama bidan pada tabel `staff`.
 *
 * Data produksi nyata: "Bidan Hanifah", "Bidan Testing Yusi", "Staff Bidan".
 * Pola wajib diikuti minimal satu kata lain (`\s+`), sehingga staff yang
 * memang bernama satu kata (mis. "Admin") tidak ikut terkupas.
 */
const STAFF_ROLE_PREFIX =
  /^(?:bidan|suster|perawat|terapis|therapist|staff|karyawan|kak|kakak|ibu|bunda|mrs\.?|ny\.?|nn\.?|sdri\.?)\s+/i;

/** Nama yang SELURUHNYA berupa gelar/jabatan — tidak informatif sebagai nama. */
const STAFF_ROLE_ONLY =
  /^(?:bidan|suster|perawat|terapis|therapist|staff|karyawan|admin|kak|kakak|ibu|bunda)$/i;

/**
 * Nama bidan siap tampil: gelar di depan dibuang.
 *
 * F-31: sebelumnya tiap layar memakai `name.split(' ')[0]`, sehingga seluruh
 * bidan tampil sebagai "Bidan" (kata pertama nama mereka). Fungsi ini menjadi
 * seam tunggal agar legenda, kartu Harian, dan kartu Mingguan konsisten.
 *
 * Bila setelah pengupasan tidak tersisa nama diri ("Staff Bidan"), nama asli
 * dikembalikan apa adanya — lebih baik jujur daripada mengarang nama.
 */
export function staffDisplayName(name: string | null | undefined): string {
  if (typeof name !== 'string') return '';
  const raw = name.replace(/\s+/g, ' ').trim();
  if (!raw) return '';

  const stripped = raw.replace(STAFF_ROLE_PREFIX, '').trim();
  if (!stripped) return raw;
  return STAFF_ROLE_ONLY.test(stripped) ? raw : stripped;
}

/**
 * Nama bidan versi pendek (satu kata) untuk ruang sempit: legenda, kartu
 * kalender. Mengembalikan string kosong bila tidak ada nama, sehingga pemanggil
 * bisa memberi fallback sendiri (mis. "Unassigned").
 */
export function staffShortName(name: string | null | undefined): string {
  const clean = staffDisplayName(name);
  return clean ? clean.split(' ')[0] : '';
}

export function resolveStaffId(source: any): string | null {
  if (!source) return null;

  const relId = source.assigned_staff?.id || source.assignedStaff?.id;
  if (relId) return relId;

  const fk = source.assigned_staff_id || source.assignedStaffId || source.staffId;
  if (fk) return fk;

  return null;
}
