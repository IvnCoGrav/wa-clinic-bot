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
 *    terdeteksi pemindai Tailwind (`content: ./src/**\/*.{js,ts,jsx,tsx}`).
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
    card: 'bg-[#dcfce7] dark:bg-[#0d2e1e] border-l-4 border-[#16a34a] dark:border-l-[#4ade80] text-[#14532d] dark:text-[#dcfce7] hover:bg-[#bbf7d0] dark:hover:bg-[#14422c] border border-transparent dark:border-[#4ade80]/30',
    badge: 'bg-[#16a34a]/10 dark:bg-[#16a34a]/25 text-[#16a34a] dark:text-[#4ade80]',
    dot: 'bg-[#16a34a] dark:bg-[#4ade80]',
  },
  // 2. Biru langit
  {
    card: 'bg-[#e0f2fe] dark:bg-[#0c2438] border-l-4 border-[#0284c7] dark:border-l-[#38bdf8] text-[#0c4a6e] dark:text-[#e0f2fe] hover:bg-[#bae6fd] dark:hover:bg-[#12334e] border border-transparent dark:border-[#38bdf8]/30',
    badge: 'bg-[#0284c7]/10 dark:bg-[#0284c7]/25 text-[#0284c7] dark:text-[#38bdf8]',
    dot: 'bg-[#0284c7] dark:bg-[#38bdf8]',
  },
  // 3. Ungu
  {
    card: 'bg-[#f3e8ff] dark:bg-[#251438] border-l-4 border-[#9333ea] dark:border-l-[#c084fc] text-[#581c87] dark:text-[#f3e8ff] hover:bg-[#ebd5ff] dark:hover:bg-[#321c4a] border border-transparent dark:border-[#c084fc]/30',
    badge: 'bg-[#9333ea]/10 dark:bg-[#9333ea]/25 text-[#9333ea] dark:text-[#c084fc]',
    dot: 'bg-[#9333ea] dark:bg-[#c084fc]',
  },
  // 4. Amber
  {
    card: 'bg-[#fef3c7] dark:bg-[#2e2009] border-l-4 border-[#d97706] dark:border-l-[#fbbf24] text-[#78350f] dark:text-[#fef3c7] hover:bg-[#fde68a] dark:hover:bg-[#402d0d] border border-transparent dark:border-[#fbbf24]/30',
    badge: 'bg-[#d97706]/10 dark:bg-[#d97706]/25 text-[#d97706] dark:text-[#fbbf24]',
    dot: 'bg-[#d97706] dark:bg-[#fbbf24]',
  },
  // 5. Toska
  {
    card: 'bg-[#ccfbf1] dark:bg-[#0b2b28] border-l-4 border-[#0d9488] dark:border-l-[#2dd4bf] text-[#115e59] dark:text-[#ccfbf1] hover:bg-[#99f6e4] dark:hover:bg-[#123e3a] border border-transparent dark:border-[#2dd4bf]/30',
    badge: 'bg-[#0d9488]/10 dark:bg-[#0d9488]/25 text-[#0d9488] dark:text-[#2dd4bf]',
    dot: 'bg-[#0d9488] dark:bg-[#2dd4bf]',
  },
  // 6. Mawar
  {
    card: 'bg-[#ffe4e6] dark:bg-[#3a1219] border-l-4 border-[#e11d48] dark:border-l-[#fb7185] text-[#881337] dark:text-[#ffe4e6] hover:bg-[#fecdd3] dark:hover:bg-[#4a1620] border border-transparent dark:border-[#fb7185]/30',
    badge: 'bg-[#e11d48]/10 dark:bg-[#e11d48]/25 text-[#be123c] dark:text-[#fb7185]',
    dot: 'bg-[#e11d48] dark:bg-[#fb7185]',
  },
  // 7. Indigo
  {
    card: 'bg-[#e0e7ff] dark:bg-[#161a3a] border-l-4 border-[#4f46e5] dark:border-l-[#818cf8] text-[#312e81] dark:text-[#e0e7ff] hover:bg-[#c7d2fe] dark:hover:bg-[#1d2350] border border-transparent dark:border-[#818cf8]/30',
    badge: 'bg-[#4f46e5]/10 dark:bg-[#4f46e5]/25 text-[#4338ca] dark:text-[#818cf8]',
    dot: 'bg-[#4f46e5] dark:bg-[#818cf8]',
  },
  // 8. Limau
  {
    card: 'bg-[#ecfccb] dark:bg-[#1c2a0c] border-l-4 border-[#65a30d] dark:border-l-[#a3e635] text-[#365314] dark:text-[#ecfccb] hover:bg-[#d9f99d] dark:hover:bg-[#25380f] border border-transparent dark:border-[#a3e635]/30',
    badge: 'bg-[#65a30d]/10 dark:bg-[#65a30d]/25 text-[#4d7c0f] dark:text-[#a3e635]',
    dot: 'bg-[#65a30d] dark:bg-[#a3e635]',
  },
  // 9. Sian
  {
    card: 'bg-[#cffafe] dark:bg-[#0a2830] border-l-4 border-[#0891b2] dark:border-l-[#22d3ee] text-[#164e63] dark:text-[#cffafe] hover:bg-[#a5f3fc] dark:hover:bg-[#0f3540] border border-transparent dark:border-[#22d3ee]/30',
    badge: 'bg-[#0891b2]/10 dark:bg-[#0891b2]/25 text-[#0e7490] dark:text-[#22d3ee]',
    dot: 'bg-[#0891b2] dark:bg-[#22d3ee]',
  },
  // 10. Fuchsia
  {
    card: 'bg-[#fae8ff] dark:bg-[#2f1038] border-l-4 border-[#c026d3] dark:border-l-[#e879f9] text-[#701a75] dark:text-[#fae8ff] hover:bg-[#f5d0fe] dark:hover:bg-[#3d1647] border border-transparent dark:border-[#e879f9]/30',
    badge: 'bg-[#c026d3]/10 dark:bg-[#c026d3]/25 text-[#a21caf] dark:text-[#e879f9]',
    dot: 'bg-[#c026d3] dark:bg-[#e879f9]',
  },
];

/** Warna netral untuk reservasi yang belum punya bidan. */
export const UNASSIGNED_STAFF_COLOR: StaffColorTheme = {
  card: 'bg-[#f0f2f5] dark:bg-[#202c33] border-l-4 border-[#8696a0] dark:border-l-[#8696a0] text-[#3b4a54] dark:text-[#e9edef] hover:bg-[#e9edef] dark:hover:bg-[#2a3942] border border-transparent dark:border-[#8696a0]/30',
  badge: 'bg-[#8696a0]/15 dark:bg-[#8696a0]/25 text-[#54656f] dark:text-[#aebac1]',
  dot: 'bg-[#8696a0] dark:bg-[#aebac1]',
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
