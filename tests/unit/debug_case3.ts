import { parseReservationText } from '../src/utils/reservation-text-parser';
function buildCase(seed) {
  const name = 'Bella', phone = '089670370062', kec = 'Candi', kota = 'Sidoarjo', treat = 'Pijat Bayi Ceria', baby = 'Kanaya', age = '6 Bulan';
  return `Berikut list untuk reservasi :   Hari dan
tanggal :  Sabtu/1-8-2026 Nama Bun
da: Bella
Alamat & Shareloc : Jl. Angg
rek No. ${seed} Kec : Candi Kota : Sidoarjo No. Hp : ${phone}
Pilihan treatment (Baby & Kids)
Nama Bayi : ${baby}
Usia Bayi/Anak : ${age}
Treatment : ${treat}
Pilihan treatment (Moms) :   Usia Keham
ilan (Jika hamil): Treatment :
Mohon bisa diisi Bunda 😊`;
}
const text = buildCase(3);
console.log('=== RAW TEXT ===');
console.log(text);
console.log('\n=== PARSED ===');
const res = parseReservationText(text);
console.log(JSON.stringify(res, null, 2));
