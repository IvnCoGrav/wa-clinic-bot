import { describe, it, expect } from 'vitest';
import { parseReservationText, extractBabyDetails } from '../../src/utils/reservation-text-parser';
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
    expect(res.bookingDate).toBeInstanceOf(Date); // Tanggal tanpa tahun otomatis di-resolve ke tahun berjalan (misal 2026-07-21)
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
    expect(result.missingFields).toContain('Nama Bunda/Bayi');
    expect(result.missingFields).toContain('Alamat');
  });

  it('6. should successfully parse multiline form text with wrapped/inline labels', () => {
    const rawText = `Berikut list untuk reservasi :   Hari dan
 tanggal :  minggu, 19 juli 2026 Nama Bunda: Bella
 Alamat & Shareloc : Desa Kedungkendo rt 07 rw 02
Kec : Candi Kota : Sidoarjo No. Hp : 089670370062
 Pilihan treatment (Moms) :   Usia Kehamilan (Jika
 hamil): 37-38weeks Treatment : induksi massage fullbody
 Mohon bisa diisi Bunda 😊  Cancel / Pembatalan Harap minimal H-3 jam
 H-1 sebelum treatment akan kami reminder kembali bunda 🥰  Terimakasih. ☺️`;

    const result = parseReservationText(rawText);
    expect(result.success).toBe(true);
    const res = result.reservation!;
    expect(res.name).toBe('Bella');
    expect(res.phone).toBe('6289670370062');
    expect(res.address).toBe('Desa Kedungkendo rt 07 rw 02');
    expect(res.kec).toBe('Candi');
    expect(res.kota).toBe('Sidoarjo');
    expect(res.treatmentCategory).toBe('MOMS');
    expect(res.treatmentDetail).toContain('induksi massage fullbody');
  });
});

describe('Reservation Text Parser — Baby Details (Single & Multi)', () => {
  it('single bayi terstruktur: name + age', () => {
    const rawText = `Nama Bunda: Sendy
Alamat & Shareloc : Jl. Mawar
No. Hp : 08123456789
Pilihan treatment (Baby & Kids)
Nama Bayi : Adek Kenzo
Usia Bayi/Anak : 6 bulan
Treatment : Pijat Bayi`;

    const res = parseReservationText(rawText);
    expect(res.success).toBe(true);
    expect(res.reservation!.babies).toEqual([{ name: 'Adek Kenzo', age: '6 bulan' }]);
  });

  it('dua bayi dalam satu baris (nama & usia dipisah koma)', () => {
    const rawText = `Nama Bunda: Sendy
Alamat & Shareloc : Jl. Mawar
No. Hp : 08123456789
Pilihan treatment (Baby & Kids)
Nama Bayi : Rara, Riri
Usia Bayi/Anak : 6 bulan, 2 tahun
Treatment : Pijat Bayi`;

    const res = parseReservationText(rawText);
    expect(res.success).toBe(true);
    expect(res.reservation!.babies).toEqual([
      { name: 'Rara', age: '6 bulan' },
      { name: 'Riri', age: '2 tahun' },
    ]);
    // treatmentDetail memuat kedua bayi
    expect(res.reservation!.treatmentDetail).toContain('Rara');
    expect(res.reservation!.treatmentDetail).toContain('Riri');
  });

  it('dua bayi blok berulang (Nama Bayi / Usia diulang)', () => {
    const rawText = `Nama Bunda: Sendy
Alamat & Shareloc : Jl. Mawar
No. Hp : 08123456789
Pilihan treatment (Baby & Kids)
Nama Bayi : Kanaya
Usia Bayi/Anak : 6 bulan
Nama Bayi : Kenshin
Usia Bayi/Anak : 3 tahun
Treatment : Pijat Bayi`;

    const res = parseReservationText(rawText);
    expect(res.success).toBe(true);
    expect(res.reservation!.babies).toEqual([
      { name: 'Kanaya', age: '6 bulan' },
      { name: 'Kenshin', age: '3 tahun' },
    ]);
  });

  it('dua bayi dengan usia dalam kurung di kolom nama', () => {
    const rawText = `Nama Bunda: Sendy
Alamat & Shareloc : Jl. Mawar
No. Hp : 08123456789
Pilihan treatment (Baby & Kids)
Nama Bayi : Rara (6 bulan) & Riri (2 tahun)
Usia Bayi/Anak :
Treatment : Pijat Bayi`;

    const res = parseReservationText(rawText);
    expect(res.success).toBe(true);
    expect(res.reservation!.babies).toEqual([
      { name: 'Rara', age: '6 bulan' },
      { name: 'Riri', age: '2 tahun' },
    ]);
  });

  it('extractBabyDetails berdiri sendiri dari raw_text mentah (inline label)', () => {
    const rawText = `Pilihan treatment (Baby & Kids)   Nama Bayi : Zayn   Usia Bayi/Anak : 8 bulan
Treatment : Pijat Bayi`;

    const babies = extractBabyDetails(rawText);
    expect(babies).toEqual([{ name: 'Zayn', age: '8 bulan' }]);
  });

  it('extractBabyDetails: dua bayi inline', () => {
    const rawText = `Pilihan treatment (Baby & Kids)
Nama Bayi : Zayn, Zara
Usia Bayi/Anak : 8 bulan, 4 tahun
Treatment : Pijat Bayi`;

    const babies = extractBabyDetails(rawText);
    expect(babies).toEqual([
      { name: 'Zayn', age: '8 bulan' },
      { name: 'Zara', age: '4 tahun' },
    ]);
  });

  it('extractBabyDetails: raw_text kosong/null → []', () => {
    expect(extractBabyDetails(null)).toEqual([]);
    expect(extractBabyDetails('')).toEqual([]);
  });

  it('inline treatment parsing: Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria', () => {
    const rawText = `Berikut list untuk reservasi :

Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00
Nama Bunda: Bunda Ani
Alamat & Shareloc : Jl. Wonokromo No. 12
Kec : Wonokromo
Kota : Surabaya
No. Hp : 08123456789

Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria`;

    const res = parseReservationText(rawText);
    expect(res.success).toBe(true);
    expect(res.reservation).toBeDefined();
    expect(res.reservation!.treatmentCategory).toBe(TreatmentCategory.BABY);
    expect(res.reservation!.treatmentDetail).toContain('Pijat Bayi Ceria');
  });

  it('inline treatment parsing for Moms: Pilihan treatment (Moms & Nifas) : Pijat Postpartum Nifas', () => {
    const rawText = `Berikut list untuk reservasi :

Hari dan tanggal : Rabu, 12 Agustus 2026 jam 09.00
Nama Bunda: Bunda Siti
Alamat & Shareloc : Jl. Siwalankerto No. 88
Kec : Wonocolo
Kota : Surabaya
No. Hp : 08111222333

Pilihan treatment (Moms & Nifas) : Pijat Postpartum Nifas`;

    const res = parseReservationText(rawText);
    expect(res.success).toBe(true);
    expect(res.reservation).toBeDefined();
    expect(res.reservation!.treatmentCategory).toBe(TreatmentCategory.MOMS);
    expect(res.reservation!.treatmentDetail).toContain('Pijat Postpartum Nifas');
  });

  it('7. should successfully parse customer Rosita Elvina reservation text', () => {
    const rawText = `Berikut list untuk reservasi :

Hari dan tanggal : Sabtu 11 Juni 2026
Nama Bunda: Rosita Elvina
Alamat & Shareloc : jalan Manukan krido X blok 5j no 3
Kec : Tandes
Kota : Surabaya
No. Hp : 08123456789

Pilihan treatment (Baby & Kids)

Nama Bayi : Kian Alvino Yafie
Usia Bayi/Anak : 35 hari
Treatment : Paket bundling cukur rambut dan pijat ceria

Pilihan treatment (Moms) :

Usia Kehamilan (Jika hamil):
Treatment :`;

    const res = parseReservationText(rawText);
    expect(res.success).toBe(true);
    expect(res.reservation).toBeDefined();
    expect(res.reservation!.name).toBe('Rosita Elvina');
    expect(res.reservation!.kec).toBe('Tandes');
    expect(res.reservation!.kota).toBe('Surabaya');
    expect(res.reservation!.treatmentCategory).toBe(TreatmentCategory.BABY);
    expect(res.reservation!.treatmentDetail).toContain('Paket bundling cukur rambut dan pijat ceria');
    expect(res.reservation!.treatmentDetail).toContain('Kian Alvino Yafie');
  });

  it('8. should successfully parse reservation with 2-digit year, time range, and payment block (Bunda Siska case)', () => {
    const rawText = `Selamat Malam bunda Siska! 😊

Kami ingin mengingatkan untuk besok ada jadwal treatment dengan Kala 🤗

Kami besok kemungkinan akan tiba di jam 09.00-09.30. Mohon ditunggu ya bund 🤗

Oh ya bunda boleh izin kirim sharelock nya bund untuk titik pastinya 🙏😊

Berikut reservasi 🐣

Hari dan tanggal :  sbtu 29 agt 26 jam 09.00-09.30
Nama Bunda:  siska
Alamat & Shareloc : grand alana regency d1 no 23
Kec : gunung anyar
Kota : sby
No. Hp :

Pilihan treatment (Baby & Kids) 

Nama Bayi : gifton
Usia Bayi/Anak : 13bln
Treatment : ceria

Payment : 
Treatment = 60.000
Ongkir 10km = 15.000
Promo ongkir = - 5.000
*Total = 70.000*

Terimakasih.  ☺️`;

    const res = parseReservationText(rawText);
    expect(res.success).toBe(true);
    expect(res.reservation).toBeDefined();
    expect(res.reservation!.name).toBe('siska');
    expect(res.reservation!.kec).toBe('gunung anyar');
    expect(res.reservation!.kota).toBe('sby');
    expect(res.reservation!.treatmentCategory).toBe(TreatmentCategory.BABY);
    expect(res.reservation!.treatmentDetail).toContain('ceria');
    expect(res.reservation!.babies).toHaveLength(1);
    expect(res.reservation!.babies[0].name).toBe('gifton');
    expect(res.reservation!.babies[0].age).toBe('13bln');
    
    // Validasi booking date & time
    expect(res.reservation!.bookingDate).toBeInstanceOf(Date);
    expect(res.reservation!.bookingDate!.getFullYear()).toBe(2026);
    expect(res.reservation!.bookingDate!.getMonth()).toBe(7); // Agustus (0-indexed -> 7)
    expect(res.reservation!.bookingDate!.getDate()).toBe(29);
    expect(res.reservation!.bookingDate!.getHours()).toBe(9);
    expect(res.reservation!.bookingDate!.getMinutes()).toBe(0);

    // Validasi payment
    expect(res.reservation!.payment).toBeDefined();
    expect(res.reservation!.payment!.treatmentPrice).toBe(60000);
    expect(res.reservation!.payment!.ongkir).toBe(15000);
    expect(res.reservation!.payment!.promo).toBe(5000);
    expect(res.reservation!.payment!.totalPrice).toBe(70000);
  });
});


