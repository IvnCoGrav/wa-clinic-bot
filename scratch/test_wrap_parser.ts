const { parseReservationText } = require('C:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/src/utils/reservation-text-parser');

const text = `Berikut list untuk reservasi :   Hari dan
 tanggal :  minggu, 19 juli 2026 Nama Bunda: Bella
 Alamat & Shareloc : Desa Kedungkendo rt 07 rw 02
Kec : Candi Kota : Sidoarjo No. Hp : 089670370062
 Pilihan treatment (Moms) :   Usia Kehamilan (Jika
 hamil): 37-38weeks Treatment : induksi massage fu
llbody   Mohon bisa diisi Bunda 😊  Cancel / Pembat
alan Harap minimal H-3 jam  H-1 sebelum treatment
akan kami reminder kembali bunda 🥰  Terimakasih.
☺️ `;

const res = parseReservationText(text);
console.log('Result:', JSON.stringify(res, null, 2));
