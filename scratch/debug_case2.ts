function buildCase(seed) {
  const style = seed % 4;
  if (style === 2) {
    return `Berikut list untuk reservasi :   Hari dan
tanggal :  Sabtu/1-8-2026 Nama Bun
da: Bella
Alamat & Shareloc : Jl. Angg
rek No. ${seed} Kec : Candi Kota : Sidoarjo No. Hp : 089670370062
Pilihan treatment (Baby & Kids)
Nama Bayi : Kanaya
Usia Bayi/Anak : 6 Bulan
Treatment : Pijat Bayi Ceria
Pilihan treatment (Moms) :   Usia Keham
ilan (Jika hamil): Treatment :
Mohon bisa diisi Bunda 😊`;
  }
}

// Reproduce
let cleaned = buildCase(2).replace(/[*_~`]/g, '').replace(/\r\n/g, '\n');
console.log('=== SEBELUM JOIN ===');
console.log(JSON.stringify(cleaned));
cleaned = cleaned.replace(/([a-z])\n([a-z])/g, '$1$2');
console.log('=== SESUDAH JOIN MID-WORD ===');
console.log(JSON.stringify(cleaned));
