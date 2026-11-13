import { describe, it, expect } from 'vitest';
import { validateReservation } from '../../packages/admin-dashboard/src/lib/validateReservation';

describe('validateReservation', () => {
  it('mengembalikan semua kesalahan sekaligus saat draft kosong', () => {
    const issues = validateReservation({ items: [] });
    expect(issues.map((i) => i.field).sort()).toEqual([
      'bookingDate',
      'customerId',
      'items',
      'startTime',
    ]);
  });

  it('hanya menyisakan tanggal dan jam setelah pasien dan layanan diisi', () => {
    const issues = validateReservation({
      customerId: 'c1',
      items: [{ id: 't1', name: 'Pijat Bayi' }],
    });
    expect(issues.map((i) => i.field).sort()).toEqual(['bookingDate', 'startTime']);
  });

  it('draft valid menghasilkan nol kesalahan', () => {
    const issues = validateReservation({
      customerId: 'c1',
      items: [{ id: 't1', name: 'Pijat Bayi' }],
      bookingDate: '2026-11-10',
      startTime: '09:00',
    });
    expect(issues).toHaveLength(0);
  });

  it('layanan kustom tanpa nama ditandai per item', () => {
    const issues = validateReservation({
      customerId: 'c1',
      items: [{ id: 'custom-1', isCustom: true, name: '   ' }],
      bookingDate: '2026-11-10',
      startTime: '09:00',
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe('item.custom-1');
  });

  it('alamat baru yang kosong ditolak', () => {
    const issues = validateReservation({
      customerId: 'c1',
      items: [{ id: 't1', name: 'Pijat Bayi' }],
      bookingDate: '2026-11-10',
      startTime: '09:00',
      addressMode: 'new',
      newAddressText: '  ',
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe('newAddressText');
  });
});
