# Trek Terpisah P2: `isValidChildName` & Consumer (BUKAN bagian fix follow-up)

> Status: PLAN — belum dieksekusi. Dipisah dari commit follow-up agar blast radius tidak melebar.
> Bahasa: Indonesia.

## 1. Apa yang terjadi (penjelasan sederhana)

Fungsi penyaring nama anak (`isValidChildName` di `src/utils/name-sanitizer.ts:350`) memakai daftar hafalan kata + regex untuk menolak nama sampah ("Usia Bayi:", "5 tahun)", "saya sendiri"). Fungsinya benar (nama kotor memang masuk DB), tapi caranya melanggar 2 aturan repo: dilarang hafalan pola kalimat dan regex hanya untuk teknis non-semantik. Fungsi ini sudah dipakai 7+ tempat (`save-reservation.tool.ts:492-493`, `reservation-text-parser.ts:626,630,969`, `child.service.ts:30`, `customer.service.ts:1046`, `google-contacts-formatter.ts:40-41,167`, `migration.service.ts:394`, sapaan follow-up `follow-up.service.ts:2011`) plus skrip `heal-corrupted-children-and-customers.ts` + working tree tak ter-commit — makin lama makin sulit dipisah.

Sederhananya: saringan airnya bekerja, tapi dibuat dari daftar nama kotoran yang dihafal satu per satu — tiap ada kotoran baru, daftarnya tambah panjang.

## 2. Apa temuan (risiko jujur)

1. Daftar hafalan (`belakangan ini`, `saya sendiri`, `pijat`, label form) = overfitting; nama asli yang kebetulan mengandung kata itu bisa ikut ditolak (contoh kelas: nama mengandung kata umum). Belum ada test adversarial nama-asli vs sampah.
2. Bercampur di commit follow-up `7d40f5c9` (Divergent Change) + susulan tak ter-commit — riwayat kotor, revert berisiko.
3. Skrip heal (`heal-corrupted-children-and-customers.ts:269-277`) MENGHAPUS baris children berdasarkan fungsi yang sama — bila fungsi over-blokir, data riil ikut terhapus. Ini yang paling bahaya.

## 3. Apa solusinya (rencana terpisah, staged)

- **Fase P2-0 (wajib dulu):** audit daftar nama anak riil di DB (sample 200, anonim) → ukur false-positive fungsi sekarang. Tanpa data ini, dilarang ubah ambang.
- **Fase P2-1:** ganti hafalan dengan aturan data-driven: (a) validasi katalog/layanan dari DB (nama = nama layanan → tolak), (b) cek struktur ( Label + ":" , kurung tak seimbang, angka+satuan usia ) sebagai parser generik tanpa daftar kata, (c) daftar-stopword dipindah ke DB (`ClinicPolicy`) agar admin bisa ubah tanpa deploy. Tanpa dependency baru.
- **Fase P2-2:** TDD adversarial — 20+ nama asli Indonesia (termasuk yang mengandung kata umum) WAJIB lolos + 20+ sampah WAJIB ditolak; skrip heal mode `--dry-run` + backup dulu, dilarang hapus sebelum P2-0 hijau.
- **Fase P2-3:** commit-kan susulan working tree ke branch sendiri + `npm run build` + full suite + catat di `KNOWN_ISSUES` (nomor baru).
- Gate tiap fase seperti biasa. Eksekusi menunggu `Lanjut P2`.
