/**
 * Filter dan pengelompokan daftar tugas terapis berdasarkan tanggal WIB.
 * Fungsi murni, tanpa state React.
 */
import { formatWib } from '../../utils/dateWib';
import { StaffTask } from './staffTaskTypes';

/** Judul grup tanggal, mis. "Sabtu, 15 Agustus 2026". */
export function formatTaskDateGroup(isoString: string | null): string {
  if (!isoString) return 'Jadwal Mendatang';
  try {
    return formatWib(new Date(isoString), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Jakarta',
    });
  } catch {
    return isoString;
  }
}

/** Cari nama pasien, alamat, atau detail treatment. */
export function filterTasksByQuery(tasks: StaffTask[], query: string): StaffTask[] {
  const q = query.trim().toLowerCase();
  if (!q) return tasks;
  return tasks.filter((task) => {
    const nameMatch = (task.customerName || '').toLowerCase().includes(q);
    const addressMatch = (task.address?.fullText || '').toLowerCase().includes(q);
    const treatmentMatch = (task.treatmentDetail || '').toLowerCase().includes(q);
    return nameMatch || addressMatch || treatmentMatch;
  });
}

/** Kelompokkan tugas per judul tanggal, mempertahankan urutan kemunculan. */
export function groupTasksByDate(tasks: StaffTask[]): Record<string, StaffTask[]> {
  return tasks.reduce<Record<string, StaffTask[]>>((acc, task) => {
    const key = formatTaskDateGroup(task.bookingDate);
    if (!acc[key]) acc[key] = [];
    acc[key].push(task);
    return acc;
  }, {});
}
