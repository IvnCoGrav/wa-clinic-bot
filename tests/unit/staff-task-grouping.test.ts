import { describe, expect, it } from 'vitest';
import {
  filterTasksByQuery,
  formatTaskDateGroup,
  groupTasksByDate,
} from '../../packages/admin-dashboard/src/pages/staff/staffTaskGrouping';
import type { StaffTask } from '../../packages/admin-dashboard/src/pages/staff/staffTaskTypes';

function task(partial: Partial<StaffTask> & { reservationId: string }): StaffTask {
  return {
    customerName: null,
    treatmentDetail: null,
    treatmentCategory: null,
    bookingDate: null,
    status: 'confirmed',
    conversationId: null,
    mapsUrl: null,
    navigationUrl: null,
    address: { kelurahan: null, kecamatan: null, kota: null, distanceKm: null, fullText: '' },
    children: [],
    pricing: {
      treatmentFee: 0,
      deliveryFee: 0,
      totalFee: 0,
      paymentStatus: 'TAGIH_DI_TEMPAT',
      paymentStatusLabel: 'Tagih di tempat',
    },
    shareLocationText: null,
    ...partial,
  };
}

describe('Staff task grouping', () => {
  it('mengembalikan semua tugas saat query kosong', () => {
    const tasks = [task({ reservationId: 'a' }), task({ reservationId: 'b' })];
    expect(filterTasksByQuery(tasks, '   ')).toBe(tasks);
  });

  it('mencari berdasarkan nama, alamat, dan treatment tanpa peduli huruf besar', () => {
    const tasks = [
      task({ reservationId: 'a', customerName: 'Bunda Sari' }),
      task({ reservationId: 'b', address: { ...task({ reservationId: 'x' }).address, fullText: 'Jl. Rungkut' } }),
      task({ reservationId: 'c', treatmentDetail: 'Pijat Bayi Ceria' }),
      task({ reservationId: 'd', customerName: 'Lain' }),
    ];
    expect(filterTasksByQuery(tasks, 'sari').map((t) => t.reservationId)).toEqual(['a']);
    expect(filterTasksByQuery(tasks, 'rungkut').map((t) => t.reservationId)).toEqual(['b']);
    expect(filterTasksByQuery(tasks, 'pijat').map((t) => t.reservationId)).toEqual(['c']);
  });

  it('mengelompokkan berdasarkan tanggal dan mempertahankan urutan', () => {
    const tasks = [
      task({ reservationId: 'a', bookingDate: '2026-11-12T03:00:00.000Z' }),
      task({ reservationId: 'b', bookingDate: '2026-11-13T03:00:00.000Z' }),
      task({ reservationId: 'c', bookingDate: '2026-11-12T05:00:00.000Z' }),
      task({ reservationId: 'd', bookingDate: null }),
    ];
    const grouped = groupTasksByDate(tasks);
    const keys = Object.keys(grouped);
    expect(keys).toHaveLength(3);
    expect(grouped['Jadwal Mendatang'].map((t) => t.reservationId)).toEqual(['d']);
    const firstDateKey = keys.find((k) => k !== 'Jadwal Mendatang');
    expect(firstDateKey).toBeTruthy();
  });

  it('memberi fallback untuk tanggal kosong', () => {
    expect(formatTaskDateGroup(null)).toBe('Jadwal Mendatang');
    expect(formatTaskDateGroup('2026-11-12T03:00:00.000Z')).toContain('2026');
  });
});
