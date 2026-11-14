import { describe, it, expect } from 'vitest';
import { buildReservationHistorySummary } from '../../packages/admin-dashboard/src/utils/reservationHistory';

describe('buildReservationHistorySummary — label riwayat reservasi (KNOWN #337)', () => {
  it('membersihkan treatment_detail verbose menjadi nama layanan', () => {
    const out = buildReservationHistorySummary({
      treatment_detail: 'Baby: Pijat Bayi (Usia: 5 bulan) + Moms: Pijat Hamil [Total 45m]',
      booking_date: '2026-11-16T05:00:00.000Z',
    });
    expect(out.title).toBe('Pijat Bayi + Pijat Hamil');
  });

  it('memakai raw_text bila treatment_detail kosong', () => {
    const out = buildReservationHistorySummary({
      treatment_detail: null,
      raw_text: 'Berikut reservasi: Oksitosin Massage',
    });
    expect(out.title).toContain('Oksitosin');
  });

  it('menampilkan tanggal + jam WIB dari booking_date (bukan booking_time)', () => {
    const out = buildReservationHistorySummary({
      treatment_detail: 'Pijat Bayi',
      booking_date: '2026-11-16T05:00:00.000Z', // 12:00 WIB
    });
    expect(out.schedule).toContain('16 Nov 2026');
    expect(out.schedule).toContain('12:00');
  });

  it('booking_date kosong → "Tanpa jadwal", bukan string kosong', () => {
    const out = buildReservationHistorySummary({ treatment_detail: 'Pijat Bayi' });
    expect(out.schedule).toBe('Tanpa jadwal');
  });

  it('meta memuat terapis dan nominal bila tersedia', () => {
    const out = buildReservationHistorySummary({
      treatment_detail: 'Pijat Bayi',
      booking_date: '2026-11-16T05:00:00.000Z',
      assigned_staff: { name: 'Bidan Siti' },
      purchase_value: 125000,
    });
    expect(out.meta).toBe('Bidan Siti · Rp 125.000');
  });

  it('meta kosong bila terapis & nominal tidak ada', () => {
    const out = buildReservationHistorySummary({ treatment_detail: 'Pijat Bayi' });
    expect(out.meta).toBe('');
  });

  it('judul fallback "Layanan Perawatan" hanya bila semua field teks kosong', () => {
    const out = buildReservationHistorySummary({});
    expect(out.title).toBe('Layanan Perawatan');
    expect(out.schedule).toBe('Tanpa jadwal');
  });
});
