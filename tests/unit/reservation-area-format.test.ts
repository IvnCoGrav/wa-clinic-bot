import { describe, expect, it } from 'vitest';
import { formatReservationArea } from '../../packages/admin-dashboard/src/utils/reservationAddress';

/**
 * Kontrak `formatReservationArea` — label "daerah" untuk kartu kalender
 * (Bulanan/Mingguan/Harian). Diuji dengan data kotor yang realistis dari
 * database: field kosong, spasi, duplikasi kelurahan==kecamatan, tipe salah.
 */
describe('formatReservationArea', () => {
  it('menggabungkan kelurahan dan kecamatan yang berbeda', () => {
    expect(
      formatReservationArea({ customer: { kelurahan: 'Kalirungkut', kecamatan: 'Rungkut' } })
    ).toBe('Kalirungkut, Rungkut');
  });

  it('melebur duplikasi kelurahan == kecamatan (khas Surabaya)', () => {
    expect(
      formatReservationArea({ customer: { kelurahan: 'Mulyorejo', kecamatan: 'Mulyorejo' } })
    ).toBe('Mulyorejo');
  });

  it('melebur duplikasi tanpa peduli huruf besar/kecil', () => {
    expect(
      formatReservationArea({ customer: { kelurahan: 'MULYOREJO', kecamatan: 'mulyorejo' } })
    ).toBe('mulyorejo');
  });

  it('memangkas spasi di kedua ujung setiap bagian', () => {
    expect(
      formatReservationArea({ customer: { kelurahan: '  Kalirungkut  ', kecamatan: ' Rungkut ' } })
    ).toBe('Kalirungkut, Rungkut');
  });

  it('jatuh ke kecamatan bila kelurahan kosong', () => {
    expect(formatReservationArea({ customer: { kelurahan: null, kecamatan: 'Rungkut' } })).toBe(
      'Rungkut'
    );
  });

  it('jatuh ke kelurahan bila kecamatan kosong', () => {
    expect(formatReservationArea({ customer: { kelurahan: 'Kalirungkut', kecamatan: '' } })).toBe(
      'Kalirungkut'
    );
  });

  it('TIDAK menampilkan kota secara default (derau bila klinik satu kota)', () => {
    expect(formatReservationArea({ customer: { kota: 'Surabaya' } })).toBe('');
  });

  it('menampilkan kota hanya bila diminta eksplisit', () => {
    expect(formatReservationArea({ customer: { kota: 'Surabaya' } }, { includeKota: true })).toBe(
      'Surabaya'
    );
  });

  it('tidak menampilkan kota bila kelurahan/kecamatan sudah ada', () => {
    expect(
      formatReservationArea(
        { customer: { kelurahan: 'Kalirungkut', kecamatan: 'Rungkut', kota: 'Surabaya' } },
        { includeKota: true }
      )
    ).toBe('Kalirungkut, Rungkut');
  });

  it('mengembalikan string kosong untuk reservasi null/undefined', () => {
    expect(formatReservationArea(null)).toBe('');
    expect(formatReservationArea(undefined)).toBe('');
    expect(formatReservationArea({})).toBe('');
    expect(formatReservationArea({ customer: null })).toBe('');
  });

  it('mengabaikan string yang hanya berisi spasi', () => {
    expect(
      formatReservationArea({ customer: { kelurahan: '   ', kecamatan: '\t\n' } })
    ).toBe('');
  });

  it('tidak crash untuk tipe data salah dari API', () => {
    const dirty = { customer: { kelurahan: 123 as unknown as string, kecamatan: {} as unknown as string } };
    expect(formatReservationArea(dirty)).toBe('');
  });

  it('tidak pernah membocorkan nama treatment ke label daerah', () => {
    const res = {
      customer: { kelurahan: 'Kalirungkut', kecamatan: 'Rungkut' },
      treatment_detail: 'Pijat Laktasi 90 menit',
      treatment_category: 'PIJAT',
    };
    const label = formatReservationArea(res);
    expect(label).toBe('Kalirungkut, Rungkut');
    expect(label).not.toContain('Pijat');
  });
});
