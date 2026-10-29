/**
 * staffColors.ts — palet warna kartu kalender **per bidan**.
 *
 * Latar belakang: sebelumnya warna kartu mengikuti `treatment_category`
 * (MOMS/KIDS/BABY/BOTH/BUNDLE). Akibatnya admin tidak bisa melihat pembagian
 * beban kerja antar bidan sekilas — dua bidan berbeda di jam yang sama tampak
 * sewarna bila kategorinya sama.
 *
 * Prinsip desain:
 * 1. **Turunan, bukan data bisnis.** Tabel `staff` tidak punya kolom warna dan
 *    penambahan kolom berarti migrasi DB + UI pengaturan baru. Warna dihitung
 *    dari urutan daftar staff tenant (`GET /api/admin/staff`), sehingga:
 *    - tidak butuh migrasi, tidak butuh dependency baru;
 *    - bidan ke-1 selalu dapat warna ke-1 (stabil antar sesi);
 *    - **dijamin berbeda** antar bidan sampai 10 orang (hash bisa tabrakan).
 * 2. **Aman dark mode.** Setiap entri punya pasangan latar gelap + aksen
 *    terang, mengikuti palet teduh anti-neon yang sudah dipakai dashboard.
 * 3. **Kelas Tailwind literal.** Semua kelas ditulis utuh di file ini agar
 *    terdeteksi pemindai Tailwind (lihat tailwind.config.js).
 */

import { staffDisplayName } from './resolveStaffName';

export interface StaffColorTheme {
  /** Kelas penuh untuk kartu event (latar + aksen kiri + teks + hover). */
  card: string;
  /** Kelas badge kecil di dalam kartu (tinta aksen transparan). */
  badge: string;
  /** Kelas titik warna untuk legenda. */
  dot: string;
}

/** Palet 10 warna. Urutan = urutan staff pada daftar tenant. */
export const STAFF_COLOR_PALETTE: StaffColorTheme[] = [
  // 1. Hijau — warna utama WhatsApp Clinic
  {
    card: 'bg-emerald-100 dark:bg-emerald-950/70 border-l-4 border-emerald-600 dark:border-l-emerald-400 text-emerald-900 dark:text-emerald-100 hover:bg-emerald-200 dark:hover:bg-emerald-900/80 border border-transparent dark:border-emerald-400/30',
    badge: 'bg-emerald-600/10 dark:bg-emerald-500/25 text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-600 dark:bg-emerald-400',
  },
  // 2. Biru langit
  {
    card: 'bg-sky-100 dark:bg-sky-950/70 border-l-4 border-sky-600 dark:border-l-sky-400 text-sky-900 dark:text-sky-100 hover:bg-sky-200 dark:hover:bg-sky-900/80 border border-transparent dark:border-sky-400/30',
    badge: 'bg-sky-600/10 dark:bg-sky-500/25 text-sky-700 dark:text-sky-300',
    dot: 'bg-sky-600 dark:bg-sky-400',
  },
  // 3. Ungu
  {
    card: 'bg-purple-100 dark:bg-purple-950/70 border-l-4 border-purple-600 dark:border-l-purple-400 text-purple-900 dark:text-purple-100 hover:bg-purple-200 dark:hover:bg-purple-900/80 border border-transparent dark:border-purple-400/30',
    badge: 'bg-purple-600/10 dark:bg-purple-500/25 text-purple-700 dark:text-purple-300',
    dot: 'bg-purple-600 dark:bg-purple-400',
  },
  // 4. Amber
  {
    card: 'bg-amber-100 dark:bg-amber-950/70 border-l-4 border-amber-600 dark:border-l-amber-400 text-amber-900 dark:text-amber-100 hover:bg-amber-200 dark:hover:bg-amber-900/80 border border-transparent dark:border-amber-400/30',
    badge: 'bg-amber-600/10 dark:bg-amber-500/25 text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-600 dark:bg-amber-400',
  },
  // 5. Toska
  {
    card: 'bg-teal-100 dark:bg-teal-950/70 border-l-4 border-teal-600 dark:border-l-teal-400 text-teal-900 dark:text-teal-100 hover:bg-teal-200 dark:hover:bg-teal-900/80 border border-transparent dark:border-teal-400/30',
    badge: 'bg-teal-600/10 dark:bg-teal-500/25 text-teal-700 dark:text-teal-300',
    dot: 'bg-teal-600 dark:bg-teal-400',
  },
  // 6. Mawar
  {
    card: 'bg-rose-100 dark:bg-rose-950/70 border-l-4 border-rose-600 dark:border-l-rose-400 text-rose-900 dark:text-rose-100 hover:bg-rose-200 dark:hover:bg-rose-900/80 border border-transparent dark:border-rose-400/30',
    badge: 'bg-rose-600/10 dark:bg-rose-500/25 text-rose-700 dark:text-rose-300',
    dot: 'bg-rose-600 dark:bg-rose-400',
  },
  // 7. Indigo
  {
    card: 'bg-indigo-100 dark:bg-indigo-950/70 border-l-4 border-indigo-600 dark:border-l-indigo-400 text-indigo-900 dark:text-indigo-100 hover:bg-indigo-200 dark:hover:bg-indigo-900/80 border border-transparent dark:border-indigo-400/30',
    badge: 'bg-indigo-600/10 dark:bg-indigo-500/25 text-indigo-700 dark:text-indigo-300',
    dot: 'bg-indigo-600 dark:bg-indigo-400',
  },
  // 8. Limau
  {
    card: 'bg-lime-100 dark:bg-lime-950/70 border-l-4 border-lime-600 dark:border-l-lime-400 text-lime-900 dark:text-lime-100 hover:bg-lime-200 dark:hover:bg-lime-900/80 border border-transparent dark:border-lime-400/30',
    badge: 'bg-lime-600/10 dark:bg-lime-500/25 text-lime-700 dark:text-lime-300',
    dot: 'bg-lime-600 dark:bg-lime-400',
  },
  // 9. Sian
  {
    card: 'bg-cyan-100 dark:bg-cyan-950/70 border-l-4 border-cyan-600 dark:border-l-cyan-400 text-cyan-900 dark:text-cyan-100 hover:bg-cyan-200 dark:hover:bg-cyan-900/80 border border-transparent dark:border-cyan-400/30',
    badge: 'bg-cyan-600/10 dark:bg-cyan-500/25 text-cyan-700 dark:text-cyan-300',
    dot: 'bg-cyan-600 dark:bg-cyan-400',
  },
  // 10. Fuchsia
  {
    card: 'bg-fuchsia-100 dark:bg-fuchsia-950/70 border-l-4 border-fuchsia-600 dark:border-l-fuchsia-400 text-fuchsia-900 dark:text-fuchsia-100 hover:bg-fuchsia-200 dark:hover:bg-fuchsia-900/80 border border-transparent dark:border-fuchsia-400/30',
    badge: 'bg-fuchsia-600/10 dark:bg-fuchsia-500/25 text-fuchsia-700 dark:text-fuchsia-300',
    dot: 'bg-fuchsia-600 dark:bg-fuchsia-400',
  },
];

/** Warna netral untuk reservasi yang belum punya bidan. */
export const UNASSIGNED_STAFF_COLOR: StaffColorTheme = {
  card: 'bg-fill-1 border-l-4 border-strong text-ink hover:bg-fill-2 border border-transparent dark:border-strong/30',
  badge: 'bg-strong/20 text-ink-2',
  dot: 'bg-strong',
};

const hashToIndex = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

/**
 * Warna untuk satu bidan.
 *
 * - `staffId` kosong → `UNASSIGNED_STAFF_COLOR` (netral).
 * - Ada di `staffList` → indeks urutan (dijamin unik sampai 10 bidan).
 * - Belum ada di `staffList` (daftar masih dimuat / bidan nonaktif) → hash ID,
 *   agar warna tidak berubah-ubah antar render saat daftar belum siap.
 */
export function getStaffColor(
  staffId: string | null | undefined,
  staffList?: Array<{ id: string }> | null
): StaffColorTheme {
  if (!staffId) return UNASSIGNED_STAFF_COLOR;

  if (Array.isArray(staffList) && staffList.length > 0) {
    const index = staffList.findIndex((s) => s && s.id === staffId);
    if (index >= 0) return STAFF_COLOR_PALETTE[index % STAFF_COLOR_PALETTE.length];
  }

  return STAFF_COLOR_PALETTE[hashToIndex(staffId) % STAFF_COLOR_PALETTE.length];
}

/** Nama pendek bidan untuk legenda (kata pertama dari nama yang sudah bersih). */
export function shortStaffLabel(name: string | null | undefined): string {
  const clean = staffDisplayName(name);
  return clean ? clean.split(' ')[0] : 'Tanpa nama';
}

/**
 * Staff yang masih aktif (F-35).
 *
 * `GET /api/admin/staff` mengembalikan SELURUH staff tenant — termasuk akun uji
 * yang sudah dinonaktifkan — sehingga legenda menampilkan "bidan" yang bukan
 * bidan aktif. Field `active` yang tidak dikirim dianggap aktif agar payload
 * parsial/endpoint lama tidak mengosongkan legenda.
 */
export function isActiveStaff(staff: { active?: boolean | null } | null | undefined): boolean {
  if (!staff) return false;
  return staff.active !== false;
}

/**
 * Saring daftar staff ke yang aktif, **tanpa mengubah urutan**.
 *
 * Urutan penting: warna kartu diturunkan dari indeks pada daftar penuh
 * (`getStaffColor`), jadi menyaring untuk tampilan tidak boleh menggeser warna.
 * Karena itu pemanggil tetap memakai daftar penuh saat memanggil `getStaffColor`.
 */
export function filterActiveStaff<T extends { active?: boolean | null }>(
  staffList?: T[] | null
): T[] {
  if (!Array.isArray(staffList)) return [];
  return staffList.filter(isActiveStaff);
}
