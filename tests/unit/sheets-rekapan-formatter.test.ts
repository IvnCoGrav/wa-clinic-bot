import { describe, it, expect } from 'vitest';
import {
  resolveSheetTarget,
  resolveYearlyFileName,
  DEFAULT_MONTH_TAB_NAMES,
} from '../../src/services/sheets/month-resolver';
import {
  formatReservationToRow,
  EMPTY_CELL,
  SHEET_COLUMN_COUNT,
} from '../../src/services/sheets/row-formatter';

describe('month-resolver — pemetaan tanggal WIB ke tab bulan', () => {
  it('1 Okt 2026 10:00 WIB → tab okt, hari Kamis, tahun 2026', () => {
    const t = resolveSheetTarget(new Date('2026-10-01T03:00:00Z'));
    expect(t.tabName).toBe('okt');
    expect(t.dayName).toBe('Kamis');
    expect(t.year).toBe(2026);
    expect(t.monthIndex).toBe(9);
    expect(t.isoDate).toBe('2026-10-01');
  });

  it('15 Nov 2026 10:00 WIB → tab Nov, hari Minggu', () => {
    const t = resolveSheetTarget(new Date('2026-11-15T03:00:00Z'));
    expect(t.tabName).toBe('Nov');
    expect(t.dayName).toBe('Minggu');
    expect(t.monthIndex).toBe(10);
  });

  it('ganti tahun: 2 Jan 2027 10:00 WIB → tahun 2027, tab Jan, hari Sabtu', () => {
    const t = resolveSheetTarget(new Date('2027-01-02T03:00:00Z'));
    expect(t.tabName).toBe('Jan');
    expect(t.year).toBe(2027);
    expect(t.dayName).toBe('Sabtu');
    expect(resolveYearlyFileName(t.year)).toBe('Rekapan Pasien 2027');
  });

  it('EDGE akhir bulan: 31 Okt 23:59 WIB (16:59Z) tetap masuk tab okt', () => {
    const t = resolveSheetTarget(new Date('2026-10-31T16:59:00Z'));
    expect(t.tabName).toBe('okt');
    expect(t.isoDate).toBe('2026-10-31');
  });

  it('EDGE awal bulan: 1 Nov 00:01 WIB (17:01Z tanggal 31 Okt UTC) → tab Nov', () => {
    // Bukti anti-bug zona waktu: UTC masih 31 Okt, WIB sudah 1 Nov.
    const t = resolveSheetTarget(new Date('2026-10-31T17:01:00Z'));
    expect(t.tabName).toBe('Nov');
    expect(t.isoDate).toBe('2026-11-01');
  });

  it('menghormati nama tab kustom dari DB, bukan daftar hafalan', () => {
    const custom = ['Januari', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const t = resolveSheetTarget(new Date('2026-10-01T03:00:00Z'), custom);
    expect(t.tabName).toBe('Okt');
  });

  it('fallback ke nama default bila config tenant tidak 12 elemen', () => {
    const t = resolveSheetTarget(new Date('2026-05-10T03:00:00Z'), ['X', 'Y'] as any);
    expect(t.tabName).toBe(DEFAULT_MONTH_TAB_NAMES[4]);
  });

  it('ADVERSARIAL: tanggal null/invalid → throw INVALID_BOOKING_DATE (tidak diam-diam salah tab)', () => {
    expect(() => resolveSheetTarget(null)).toThrow('INVALID_BOOKING_DATE');
    expect(() => resolveSheetTarget(new Date('bukan-tanggal'))).toThrow('INVALID_BOOKING_DATE');
  });

  it('prefix nama file tetap untuk tahun apa pun', () => {
    expect(resolveYearlyFileName(2026, 'Rekapan Pasien')).toBe('Rekapan Pasien 2026');
    expect(resolveYearlyFileName(2027, '  Rekap Klinik  ')).toBe('Rekap Klinik 2027');
    expect(resolveYearlyFileName(2028, '')).toBe('Rekapan Pasien 2028');
  });
});

describe('row-formatter — 16 kolom A–P', () => {
  const base = {
    reservation: {
      booking_date: new Date('2026-10-01T03:00:00Z'),
      treatment_detail: 'Kala Baby – Pijat Pulih Ceria',
      treatment_category: 'BABY',
      purchase_value: 135000,
      delivery_fee: 15000,
      discount_amount: 0,
      payment_method: 'Transfer',
      is_repeat_order: false,
      status: 'confirmed',
      raw_text: '[RESERVATION:BOT] Pijat | 2026-10-01 | Ny. Tere\nCatatan: Batuk pilek 3 hari',
    },
    customer: {
      name: 'Bunda Tere',
      kelurahan: 'tenggilis',
      kecamatan: 'tenggilis',
      kota: 'surabaya',
      ongkir: 15000,
    },
    child: { name: 'An. Keysha', raw_age_text: '10 bulan' },
    assignedStaffName: 'Bidan Siti',
  };

  it('menghasilkan tepat 16 sel', () => {
    const row = formatReservationToRow(base);
    expect(row).toHaveLength(SHEET_COLUMN_COUNT);
  });

  it('memetakan kolom A–P sesuai spesifikasi', () => {
    const row = formatReservationToRow(base);
    expect(row[0]).toBe('2026-10-01');       // A Tanggal
    expect(row[1]).toBe('Kamis');            // B Hari
    expect(row[2]).toBe('Bunda Tere');       // C Customer
    expect(row[3]).toBe('tenggilis surabaya'); // D Lokasi (kelurahan + kota, dedupe)
    expect(row[4]).toBe('An. Keysha 10 bulan'); // E Bayi
    expect(row[5]).toBe('Baru');             // F Tipe
    expect(row[6]).toBe('Kala Baby – Pijat Pulih Ceria'); // G Layanan
    expect(row[7]).toBe(15000);              // H Ongkir
    expect(row[8]).toBe(135000);             // I Total
    expect(row[9]).toBe(0);                  // J Diskon
    expect(row[10]).toBe(150000);            // K Harga akhir (135000+15000-0)
    expect(row[11]).toBe('Transfer');        // L Metode Bayar
    expect(row[12]).toBe('Bidan Siti');      // M Bidan
    expect(row[13]).toBe(0);                 // N Tip
    expect(row[14]).toBe('Belum');           // O Follow up
    expect(row[15]).toBe('Batuk pilek 3 hari'); // P Catatan (blok Catatan:)
  });

  it('Repeat customer → kolom F "Repeat", diskon dihitung ke Harga akhir', () => {
    const row = formatReservationToRow({
      ...base,
      reservation: {
        ...base.reservation,
        is_repeat_order: true,
        discount_amount: 30000,
      },
    });
    expect(row[5]).toBe('Repeat');
    expect(row[9]).toBe(30000);
    expect(row[10]).toBe(135000 + 15000 - 30000);
  });

  it('ongkir fallback ke Customer.ongkir bila delivery_fee null', () => {
    const row = formatReservationToRow({
      ...base,
      reservation: { ...base.reservation, delivery_fee: null },
    });
    expect(row[7]).toBe(15000);
    expect(row[10]).toBe(150000);
  });

  it('EDGE data kosong: nama anak/alamat/metode/bidan kosong → "-", susunan tetap 16', () => {
    const row = formatReservationToRow({
      reservation: {
        booking_date: new Date('2026-11-15T03:00:00Z'),
        treatment_detail: null,
        purchase_value: null,
        delivery_fee: null,
        payment_method: null,
        is_repeat_order: false,
        raw_text: null,
      },
      customer: { name: null },
      child: null,
      assignedStaffName: null,
    });
    expect(row).toHaveLength(16);
    expect(row[2]).toBe(EMPTY_CELL);   // Customer
    expect(row[3]).toBe(EMPTY_CELL);   // Lokasi
    expect(row[4]).toBe(EMPTY_CELL);   // Bayi
    expect(row[6]).toBe(EMPTY_CELL);   // Layanan
    expect(row[11]).toBe(EMPTY_CELL);  // Metode bayar
    expect(row[12]).toBe(EMPTY_CELL);  // Bidan
    expect(row[15]).toBe(EMPTY_CELL);  // Catatan
    expect(row[7]).toBe(0);
    expect(row[8]).toBe(0);
    expect(row[10]).toBe(0);
  });

  it('membersihkan tag internal dari Layanan Detail', () => {
    const row = formatReservationToRow({
      ...base,
      reservation: {
        ...base.reservation,
        treatment_detail: '[SAME_DAY_REQUEST] Kala Baby – Cukur Rambut',
      },
    });
    expect(row[6]).toBe('Kala Baby – Cukur Rambut');
    expect(String(row[6])).not.toContain('[SAME_DAY_REQUEST]');
  });

  it('status completed → kolom O "Sudah"', () => {
    const row = formatReservationToRow({
      ...base,
      reservation: { ...base.reservation, status: 'completed' },
    });
    expect(row[14]).toBe('Sudah');
  });

  it('ADVERSARIAL: booking_date null → throw, bukan menulis baris salah tab', () => {
    expect(() =>
      formatReservationToRow({
        ...base,
        reservation: { ...base.reservation, booking_date: null },
      })
    ).toThrow('INVALID_BOOKING_DATE');
  });
});
