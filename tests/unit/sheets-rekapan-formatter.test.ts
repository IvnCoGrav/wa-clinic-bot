import { describe, it, expect } from 'vitest';
import {
  resolveSheetTarget,
  resolveYearlyFileName,
  DEFAULT_MONTH_TAB_NAMES,
} from '../../src/services/sheets/month-resolver';
import {
  formatReservationToRow,
  resolveCustomerType,
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
    expect(row[3]).toBe('tenggilis');        // D Lokasi (kelurahan saja)
    expect(row[4]).toBe('An. Keysha');       // E Bayi (nama saja)
    expect(row[5]).toBe('New');              // F Tipe Customer (New organik)
    expect(row[6]).toBe('Kala Baby – Pijat Pulih Ceria'); // G Layanan
    expect(row[7]).toBe(15000);              // H Ongkir
    expect(row[8]).toBe(150000);             // I Total (135000 layanan + 15000 ongkir)
    expect(row[9]).toBe('');                 // J Diskon (kosong bila 0)
    expect(row[10]).toBe('');                // K Harga akhir (selalu kosong, rumus sheet)
    expect(row[11]).toBe('Transfer');        // L Metode Bayar
    expect(row[12]).toBe('Siti');            // M Bidan (tanpa kata "Bidan")
    expect(row[13]).toBe('');                // N Tip (kosong / tulisan manual di sheet)
    expect(row[14]).toBe('');                // O Follow up (selalu kosong, tulisan manual di sheet)
    expect(row[15]).toBe('');                // P Catatan (kosong)
  });

  it('New customer dari traffic ads → kolom F "New Ads"', () => {
    const row = formatReservationToRow({
      ...base,
      customer: {
        ...base.customer,
        hasAds: true,
      },
    });
    expect(row[5]).toBe('New Ads');
  });

  it('Repeat customer → kolom F "Repeat", diskon nominal di kolom J, kolom K tetap kosong', () => {
    const row = formatReservationToRow({
      ...base,
      reservation: {
        ...base.reservation,
        is_repeat_order: true,
        discount_amount: 30000,
      },
    });
    expect(row[5]).toBe('Repeat');
    expect(row[8]).toBe(150000);             // I Total (135000 + 15000)
    expect(row[9]).toBe(30000);              // J Diskon nominal bila > 0
    expect(row[10]).toBe('');                // K Harga akhir tetap kosong
  });

  it('ongkir fallback ke Customer.ongkir bila delivery_fee null', () => {
    const row = formatReservationToRow({
      ...base,
      reservation: { ...base.reservation, delivery_fee: null },
    });
    expect(row[7]).toBe(15000);
    expect(row[10]).toBe('');
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
    expect(row[13]).toBe('');          // Tip (kosong)
    expect(row[15]).toBe('');          // Catatan (kosong)
    expect(row[7]).toBe(0);
    expect(row[8]).toBe(0);
    expect(row[9]).toBe('');
    expect(row[10]).toBe('');
    expect(row[14]).toBe('');
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

  it('kolom O selalu kosong ("") terlepas dari status (diisi manual admin di sheet)', () => {
    const rowCompleted = formatReservationToRow({
      ...base,
      reservation: { ...base.reservation, status: 'completed' },
    });
    expect(rowCompleted[14]).toBe('');

    const rowConfirmed = formatReservationToRow({
      ...base,
      reservation: { ...base.reservation, status: 'confirmed' },
    });
    expect(rowConfirmed[14]).toBe('');
  });

  it('diskon invalid (negatif, 0, NaN, null) menghasilkan string kosong ""', () => {
    for (const invalidDiscount of [0, -5000, NaN, null as any, undefined as any]) {
      const row = formatReservationToRow({
        ...base,
        reservation: { ...base.reservation, discount_amount: invalidDiscount },
      });
      expect(row[9]).toBe('');
    }
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

/**
 * ADVERSARIAL: kontaminasi historis `is_repeat_order` DB (bug follow-up lama).
 * Otoritas TUNGGAL new-vs-repeat = ordinal riwayat nyata `prior_reservations_count`.
 * Order #1 (priorCount=0) TIDAK PERNAH 'Repeat' walau flag DB bohong; order #2+
 * SELALU 'Repeat' walau flag DB stale `false` — termasuk bila punya adClick.
 */
describe('row-formatter — otoritas ordinal atas flag DB terkontaminasi', () => {
  const base = {
    reservation: {
      booking_date: new Date('2026-10-01T03:00:00Z'),
      treatment_detail: 'Pijat Bayi',
      purchase_value: 135000,
      delivery_fee: 0,
      discount_amount: 0,
      payment_method: null,
      is_repeat_order: false,
      status: 'confirmed',
      raw_text: null,
    },
    customer: { name: 'Bunda X' },
  };

  it('KASUS 1: order #1 flag DB terkontaminasi true + adClick → "New Ads"', () => {
    const row = formatReservationToRow({
      ...base,
      reservation: { ...base.reservation, is_repeat_order: true, prior_reservations_count: 0 },
      customer: { ...base.customer, adClick: { id: 'ad-1', fbclid: 'x' } },
    });
    expect(row[5]).toBe('New Ads');
  });

  it('KASUS 2: order #1 flag DB terkontaminasi true tanpa adClick → "New"', () => {
    const row = formatReservationToRow({
      ...base,
      reservation: { ...base.reservation, is_repeat_order: true, prior_reservations_count: 0 },
      customer: { ...base.customer, adClick: null },
    });
    expect(row[5]).toBe('New');
  });

  it('KASUS 3: order #2+ flag DB stale false → "Repeat"', () => {
    const row = formatReservationToRow({
      ...base,
      reservation: { ...base.reservation, is_repeat_order: false, prior_reservations_count: 2 },
      customer: { ...base.customer, adClick: null },
    });
    expect(row[5]).toBe('Repeat');
  });

  it('KASUS 4: order #2+ dengan adClick → tetap "Repeat" (ordinal menang atas ads)', () => {
    const row = formatReservationToRow({
      ...base,
      reservation: { ...base.reservation, is_repeat_order: false, prior_reservations_count: 1 },
      customer: { ...base.customer, adClick: { id: 'ad-2', fbclid: 'y' } },
    });
    expect(row[5]).toBe('Repeat');
  });

  it('KONTRAK resolveCustomerType: priorCount angka MENANG atas flag; flag hanya fallback', () => {
    // Ordinal tersedia → flag diabaikan.
    expect(resolveCustomerType(true, { adClick: { id: 'a' } }, 0)).toBe('New Ads');
    expect(resolveCustomerType(false, null, 3)).toBe('Repeat');
    // Ordinal tidak tersedia (undefined/null) → fallback ke flag DB (kompatibilitas store non-Prisma).
    expect(resolveCustomerType(true, null, null)).toBe('Repeat');
    expect(resolveCustomerType(false, { adClick: { id: 'a' } }, undefined)).toBe('New Ads');
  });

  describe('Multi-Address / Rumah Kedua — Kolom D & Ongkir', () => {
    it('Kolom D: customerAddress (Rumah 2 di Buduran) MENANG atas customer.kelurahan (Rumah 1 di Grogol)', () => {
      const row = formatReservationToRow({
        ...base,
        customer: {
          ...base.customer,
          kelurahan: 'grogol',
          kecamatan: 'tulangan',
          kota: 'sidoarjo',
        },
        customerAddress: {
          kelurahan: 'buduran',
          kecamatan: 'buduran',
          kota: 'sidoarjo',
        },
      });
      // Kolom D wajib 'buduran' (Rumah 2), bukan 'grogol' (Rumah 1)!
      expect(row[3]).toBe('buduran');
    });

    it('Kolom D: fallback ke customerAddress.kecamatan bila kelurahan customerAddress kosong', () => {
      const row = formatReservationToRow({
        ...base,
        customer: {
          ...base.customer,
          kelurahan: 'grogol',
        },
        customerAddress: {
          kelurahan: '',
          kecamatan: 'candi',
          kota: 'sidoarjo',
        },
      });
      expect(row[3]).toBe('candi');
    });

    it('Kolom D: fallback ke customer.kelurahan bila customerAddress null (backward-compatible)', () => {
      const row = formatReservationToRow({
        ...base,
        customer: {
          ...base.customer,
          kelurahan: 'grogol',
        },
        customerAddress: null,
      });
      expect(row[3]).toBe('grogol');
    });

    it('Kolom H: customerAddress.ongkir digunakan bila reservation.delivery_fee null', () => {
      const row = formatReservationToRow({
        ...base,
        reservation: {
          ...base.reservation,
          delivery_fee: null,
        },
        customer: {
          ...base.customer,
          ongkir: 10000,
        },
        customerAddress: {
          kelurahan: 'buduran',
          ongkir: 25000,
        },
      });
      expect(row[7]).toBe(25000);
    });
  });
});

