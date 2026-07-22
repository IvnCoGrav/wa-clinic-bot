import { describe, it, expect } from 'vitest';
import { parseReservationText } from '../../src/utils/reservation-text-parser';
import { TreatmentCategory } from '@prisma/client';

describe('Reservation Text Parser Unit Tests', () => {
  it('1. should successfully parse standard BABY reservation list', () => {
    const rawText = `Berikut list untuk reservasi :

Hari dan tanggal : Selasa, 21 Juli 2026
Nama Bunda: Bunda Sendy
Alamat & Shareloc : Jl. Mawar No. 10
Kec : Sukolilo
Kota : Surabaya
No. Hp : 08123456789

Pilihan treatment (Baby & Kids)

Nama Bayi : Adek Kenzo
Usia Bayi/Anak : 6 bulan
Treatment : Pijat Bayi Rileks

Pilihan treatment (Moms) :

Usia Kehamilan (Jika hamil):
Treatment :`;

    const result = parseReservationText(rawText);
    expect(result.success).toBe(true);
    expect(result.reservation).toBeDefined();
    
    const res = result.reservation!;
    expect(res.name).toBe('Bunda Sendy');
    expect(res.phone).toBe('628123456789');
    expect(res.address).toBe('Jl. Mawar No. 10');
    expect(res.kec).toBe('Sukolilo');
    expect(res.kota).toBe('Surabaya');
    expect(res.treatmentCategory).toBe(TreatmentCategory.BABY);
    expect(res.treatmentDetail).toContain('Pijat Bayi Rileks');
    expect(res.bookingDate).toBeInstanceOf(Date);
    expect(res.bookingDate!.getFullYear()).toBe(2026);
    expect(res.bookingDate!.getMonth()).toBe(6); // Juli (0-indexed -> 6)
    expect(res.bookingDate!.getDate()).toBe(21);
  });

  it('2. should successfully parse BOTH category reservation list (Baby + Moms)', () => {
    const rawText = `Berikut list untuk reservasi :

Hari dan tanggal : 2026-07-22
Nama Bunda: Bunda Sendy
Alamat & Shareloc : Jl. Mawar No. 10
Kec : Sukolilo
Kota : Surabaya
No. Hp : 08123456789

Pilihan treatment (Baby & Kids)

Nama Bayi : Adek Kenzo
Usia Bayi/Anak : 6 bulan
Treatment : Pijat Bayi Pulih Ceria

Pilihan treatment (Moms) :

Usia Kehamilan (Jika hamil): 32 minggu
Treatment : Oksitosin Massage Fullbody`;

    const result = parseReservationText(rawText);
    expect(result.success).toBe(true);
    
    const res = result.reservation!;
    expect(res.treatmentCategory).toBe(TreatmentCategory.BOTH);
    expect(res.treatmentDetail).toContain('Pijat Bayi Pulih Ceria');
    expect(res.treatmentDetail).toContain('Oksitosin Massage Fullbody');
    expect(res.bookingDate).toBeInstanceOf(Date);
    expect(res.bookingDate!.getFullYear()).toBe(2026);
  });

  it('3. should fall back to bookingDate null but succeed parsing when date is invalid/ambigu (e.g. without year)', () => {
    const rawText = `Berikut list untuk reservasi :

Hari dan tanggal : selasa, 21 juli
Nama Bunda: Bunda Sendy
Alamat & Shareloc : Jl. Mawar No. 10
Kec : Sukolilo
Kota : Surabaya
No. Hp : 08123456789

Pilihan treatment (Baby & Kids)

Nama Bayi : Adek Kenzo
Usia Bayi/Anak : 6 bulan
Treatment : Pijat Bayi Rileks`;

    const result = parseReservationText(rawText);
    expect(result.success).toBe(true);
    expect(result.reservation).toBeDefined();
    
    const res = result.reservation!;
    expect(res.name).toBe('Bunda Sendy');
    expect(res.bookingDate).toBeNull(); // Tanggal tanpa tahun dibiarkan null
  });

  it('4. should successfully parse combined Kec & Kota line (e.g. Kec & Kota : Sukolilo, Surabaya)', () => {
    const rawText = `Berikut list untuk reservasi :

Hari dan tanggal : 2026-07-22
Nama Bunda: Bunda Sendy
Alamat & Shareloc : Jl. Mawar No. 10
Kec & Kota : Sukolilo, Surabaya
No. Hp : 08123456789

Pilihan treatment (Baby & Kids)

Nama Bayi : Adek Kenzo
Usia Bayi/Anak : 6 bulan
Treatment : Pijat Bayi`;

    const result = parseReservationText(rawText);
    expect(result.success).toBe(true);
    
    const res = result.reservation!;
    expect(res.kec).toBe('Sukolilo');
    expect(res.kota).toBe('Surabaya');
  });

  it('5. should fail parsing and list missing fields when crucial data is empty', () => {
    const rawText = `Berikut list untuk reservasi :

Hari dan tanggal : 2026-07-22
Nama Bunda: 
Alamat & Shareloc : 
Kec :
Kota :
No. Hp : 08123456789`;

    const result = parseReservationText(rawText);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Field berikut tidak terbaca atau kosong');
    expect(result.missingFields).toContain('Nama Bunda');
    expect(result.missingFields).toContain('Alamat & Shareloc');
    expect(result.missingFields).toContain('Treatment Detail');
  });
});
