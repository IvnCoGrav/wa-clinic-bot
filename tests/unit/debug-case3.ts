import { parseReservationText } from '../src/utils/reservation-text-parser';

function buildCase(seed: number): string {
  const phone = '089670370062';
  return `Berikut list untuk reservasi :   Hari dan
tanggal :  Sabtu/1-8-2026 Nama Bun
da: Bella
Alamat & Shareloc : Jl. Angg
rek No. ${seed} Kec : Candi Kota : Sidoarjo No. Hp : ${phone}
Pilihan treatment (Baby & Kids)
Nama Bayi : Kanaya
Usia Bayi/Anak : 6 Bulan
Treatment : Pijat Bayi Ceria
Pilihan treatment (Moms) :   Usia Keham
ilan (Jika hamil): Treatment :
Mohon bisa diisi Bunda 😊`;
}

const text = buildCase(3);
const res = parseReservationText(text);
console.log('Success:', res.success);
console.log('Name:', res.reservation?.name);
console.log('Phone:', res.reservation?.phone);
console.log('Kec:', res.reservation?.kec);
console.log('Treatment:', res.reservation?.treatmentDetail);
