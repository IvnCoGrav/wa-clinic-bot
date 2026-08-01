import { describe, it, expect } from 'vitest';
import { parseReservationText } from '../../src/utils/reservation-text-parser';

/**
 * Stress test: 30 variasi acak form reservasi untuk memvalidasi parser
 * tetap bisa menangkap data meskipun format berubah-ubah (wrapping, spasi,
 * label inline, baris gabung, dll).
 */

const names = ['Bella', 'Siti', 'Dewi', 'Rina', 'Ani', 'Maya', 'Lilis', 'Putri', 'Wati', 'Ratna'];
const phones = ['081228420441', '089670370062', '081234567890', '087812345678', '081398765432', '082145678912'];
const kecs = ['Waru', 'Candi', 'Sedati', 'Gedangan', 'Taman', 'Sidoarjo', 'Buduran', 'Krian'];
const kotas = ['Sidoarjo', 'Surabaya'];
const treats = ['Pijat Bayi Ceria', 'Pijat Bayi Pulih Ceria', 'Prenatal Massage', 'Oksitosin Massage', 'Paket Laktasi', 'Sinar Moksa'];
const babies = ['Kanaya', 'Raka', 'Aisyah', 'Zayn', 'Kenzo', 'Bima'];
const ages = ['6 Bulan', '3 Bulan', '1 Tahun', '8 Bulan', '2 Tahun'];

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildCase(seed: number): { name: string; phone: string; text: string } {
  const name = rand(names);
  const phone = rand(phones);
  const kec = rand(kecs);
  const kota = rand(kotas);
  const treat = rand(treats);
  const baby = rand(babies);
  const age = rand(ages);
  const style = seed % 4;

  let form: string;

  if (style === 0) {
    form = `Berikut list untuk reservasi :
Hari dan tanggal : Sabtu/1-8-2026
Nama Bunda: ${name}
Alamat & Shareloc : Jl. Melati No. ${seed}
Kec : ${kec}
Kota : ${kota}
No. Hp : ${phone}
Pilihan treatment (Baby & Kids)
Nama Bayi : ${baby}
Usia Bayi/Anak : ${age}
Treatment : ${treat}
Pilihan treatment (Moms) :
Usia Kehamilan (Jika hamil):
Treatment :
Mohon bisa diisi Bunda 😊`;
  } else if (style === 1) {
    form = `Berikut list untuk reservasi :   Hari dan tanggal :  Sabtu/1-8-2026 Nama Bunda: ${name}
Alamat & Shareloc : Jl. Kenanga No. ${seed} Kec : ${kec} Kota : ${kota} No. Hp : ${phone}
Pilihan treatment (Baby & Kids)   Nama Bayi : ${baby}   Usia Bayi/Anak : ${age}
Treatment : ${treat}
Pilihan treatment (Moms) :   Usia Kehamilan (Jika hamil): Treatment :
Mohon bisa diisi Bunda 😊`;
  } else if (style === 2) {
    form = `Berikut list untuk reservasi :   Hari dan
tanggal :  Sabtu/1-8-2026 Nama Bun
da: ${name}
Alamat & Shareloc : Jl. Angg
rek No. ${seed} Kec : ${kec} Kota : ${kota} No. Hp : ${phone}
Pilihan treatment (Baby & Kids)
Nama Bayi : ${baby}
Usia Bayi/Anak : ${age}
Treatment : ${treat}
Pilihan treatment (Moms) :   Usia Keham
ilan (Jika hamil): Treatment :
Mohon bisa diisi Bunda 😊`;
  } else {
    form = `Berikut  list  untuk  reservasi  :
  Hari  dan  tanggal  :  Sabtu/1-8-2026
 Nama  Bunda:  ${name}
  Alamat  &  Shareloc  :  Jl.  Mawar  No.  ${seed}
 Kec  :  ${kec}    Kota  :  ${kota}    No.  Hp  :  ${phone}
  Pilihan  treatment  (Baby  &  Kids)
  Nama  Bayi  :  ${baby}
  Usia  Bayi/Anak  :  ${age}
  Treatment  :  ${treat}
  Pilihan  treatment  (Moms)  :
  Usia  Kehamilan  (Jika  hamil):
  Treatment  :
  Mohon  bisa  diisi  Bunda  😊`;
  }

  return { name, phone, text: form };
}

describe('Reservation Parser Stress Test (30 Variasi Acak)', () => {
  const cases = Array.from({ length: 30 }, (_, i) => buildCase(i + 1));

  it('harus menangkap nama & no HP di semua 30 variasi', () => {
    let passed = 0;
    let failed = 0;
    const failures: string[] = [];

    cases.forEach((tc, idx) => {
      const res = parseReservationText(tc.text);
      // Normalisasi phone: 08xx -> 628xx (parser memang menormalkan)
      const expectedPhone = tc.phone.startsWith('0') ? `62${tc.phone.slice(1)}` : tc.phone;
      const nameOk = res.success && res.reservation?.name === tc.name;
      const phoneOk = res.success && res.reservation?.phone === expectedPhone;

      if (res.success && nameOk && phoneOk) {
        passed++;
      } else {
        failed++;
        failures.push(
          `Case ${idx + 1}: expected name=${tc.name} phone=${expectedPhone}, got ${res.success ? `name=${res.reservation?.name} phone=${res.reservation?.phone}` : `err=${res.error}`}`
        );
      }
    });

    if (failures.length > 0) {
      console.log('\n=== FAILURES ===');
      failures.forEach((f) => console.log(f));
    }
    console.log(`\n=== HASIL: ${passed}/30 PASS, ${failed} FAIL ===`);
    expect(failed).toBe(0);
    expect(passed).toBe(30);
  });

  it('harus menghasilkan treatmentDetail yang valid di setiap kasus', () => {
    cases.forEach((tc, idx) => {
      const res = parseReservationText(tc.text);
      expect(res.success, `Case ${idx + 1} harus sukses`).toBe(true);
      expect(res.reservation!.treatmentDetail.length).toBeGreaterThan(0);
    });
  });
});
