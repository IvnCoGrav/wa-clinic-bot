/**
 * calendarViewMode.ts — kontrak tunggal pemilih mode tampilan Reservasi.
 *
 * Kenapa file ini ada (F-46, F-47):
 * - **F-47**: aturan "reset status saat ganti view" ditulis **lima kali** di
 *   halaman (1 di `<select>` mobile + 4 di tombol desktop) dengan logika yang
 *   sedikit berbeda. Salinan ganda = kelas bug yang sama dengan F-42.
 * - **F-46**: tombol `Bulan` memakai `hidden md:flex` di dalam container
 *   `hidden sm:flex`, sehingga di lebar 640–767px view Bulan **tidak bisa
 *   dipilih sama sekali**. Daftar mode di sini membuat satu sumber urutan &
 *   label, sehingga tidak ada tombol yang bisa "hilang" karena kelas sendiri.
 *
 * Tanpa React & tanpa ikon: ikon dipetakan di komponen agar util tetap murni
 * dan bisa diuji di node.
 */

import { CalendarViewMode } from '../components/calendar/types';

export interface ViewModeOption {
  mode: CalendarViewMode;
  /** Label penuh (dipakai tooltip / aria-label / teks desktop). */
  label: string;
}

export const VIEW_MODE_OPTIONS: ViewModeOption[] = [
  { mode: 'table', label: 'Tabel' },
  { mode: 'day', label: 'Hari' },
  { mode: 'week', label: 'Minggu' },
  { mode: 'month', label: 'Bulan' },
];

/**
 * Status filter yang masuk akal setelah berpindah mode.
 *
 * - Masuk mode **tabel**: `all` tidak berguna (tabel menampilkan semua status
 *   termasuk yang sudah lewat) → jadikan `upcoming`.
 * - Masuk mode **kalender**: `upcoming` memotong reservasi lampau di server
 *   (`booking_date >= now - 3j`), sehingga grid tanggal lampau tampak kosong
 *   padahal ada data → jadikan `all`.
 * - Status spesifik yang dipilih admin (`hold`, `confirmed`, …) **tidak
 *   diubah**: itu keputusan sadar, bukan efek samping pindah mode.
 */
export function nextStatusForView(mode: CalendarViewMode, currentStatus: string): string {
  if (mode === 'table') {
    return currentStatus === 'all' ? 'upcoming' : currentStatus;
  }
  return currentStatus === 'upcoming' ? 'all' : currentStatus;
}

/** True untuk mode yang menggambar grid kalender (bukan tabel). */
export function isCalendarView(mode: CalendarViewMode): boolean {
  return mode !== 'table';
}
