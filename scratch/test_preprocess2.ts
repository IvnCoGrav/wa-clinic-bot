const { parseReservationText } = require('C:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/src/utils/reservation-text-parser');

const origText = `Berikut list untuk reservasi :   Hari dan
 tanggal :  minggu, 19 juli 2026 Nama Bunda: Bella
 Alamat & Shareloc : Desa Kedungkendo rt 07 rw 02
Kec : Candi Kota : Sidoarjo No. Hp : 089670370062
 Pilihan treatment (Moms) :   Usia Kehamilan (Jika
 hamil): 37-38weeks Treatment : induksi massage fu
llbody   Mohon bisa diisi Bunda 😊  Cancel / Pembat
alan Harap minimal H-3 jam  H-1 sebelum treatment
akan kami reminder kembali bunda 🥰  Terimakasih.
☺️ `;

let cleaned = origText.replace(/[*_~]/g, '').replace(/\r\n/g, '\n');
const inlineLabelRegex = /(\s+)(Nama Bunda\s*:|Alamat & Shareloc\s*:|Alamat\s*:|Kec\s*:|Kota\s*:|No\.?\s*Hp\s*:|Nama Bayi\s*:|Usia Bayi\/Anak\s*:|Usia Bayi\s*:|Usia Kehamilan[^\n:]*:|Treatment\s*:|Pilihan treatment)/gi;
const preprocessed = cleaned.replace(inlineLabelRegex, '\n$2');

const res = parseReservationText(preprocessed);
console.log('Result:', JSON.stringify(res, null, 2));
