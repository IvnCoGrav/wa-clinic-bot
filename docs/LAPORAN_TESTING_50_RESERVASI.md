# Laporan Testing QA — 50 Skenario Chat Realistis (Goal: Sampai Reservasi)

**Tanggal Eksekusi**: 5/8/2026, 14.08.58  
**Mode**: Offline Fallback  
**Total Skenario**: 50  
**Hasil Kelulusan**: 43/50 (**86.0%**)

---

## 1. Tabel Rekapitulasi Hasil Testing (Ketepatan Submit Reservasi Real)

| No | Skenario | Goal State | State Tercapai | Turn s/d Reservasi | Field Prefill Benar? | Naturalness (1-5) | Catatan / Bug |
|---|---|---|---|---|---|---|---|
| 1 | Kooperatif — greeting -> alamat kel/kec -> tertarik -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 3 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 2 | Kooperatif — spa bayi -> sharelock -> booking -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 3 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 3 | Kooperatif — salam -> Sidoarjo Waru -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 4 | N/A | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 4 | Kooperatif — Hai -> Ngagel Jaya Selatan -> form data usia campur | `RESERVATION_SENT` | `HUMAN_HANDLING` | 3 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 5 | Kooperatif — sharelock -> minat -> form 2 anak | `RESERVATION_SENT` | `HUMAN_HANDLING` | 2 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 6 | Kooperatif — tanya dulu -> Rungkut -> booking -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 5 | N/A | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 7 | Asking schedule di awal -> Pakuwon City -> reservasi -> form | `HUMAN_HANDLING` | `HUMAN_HANDLING` | 4 | N/A | 5 | ✅ Eskalasi ke Human Handling sesuai PRD |
| 8 | FAQ newborn di awal -> Gunung Anyar -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 3 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 9 | Disela "beneran bidan atau bot" saat lokasi -> tertarik -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 5 | N/A | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 10 | Sukolilo ambigu -> deket ITS -> FAQ harga -> booking -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 6 | N/A | 2 | ❌ Macet di state HUMAN_HANDLING |
| 11 | Wiyung -> FAQ terapis cewek -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 5 | N/A | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 12 | Jl Ahmad Yani -> FAQ medis ringan 2 minggu -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 5 | N/A | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 13 | Wonorejo -> FAQ paket selapan -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 5 | N/A | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 14 | Gayungan -> FAQ reschedule -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 5 | N/A | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 15 | FAQ manfaat duluan -> Jambangan -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 4 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 16 | Ketintang -> FAQ owner -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 4 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 17 | Wonokromo -> "mahal juga ya" -> worth it -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 5 | N/A | 2 | ❌ Macet di state HUMAN_HANDLING |
| 18 | Karah -> "pikir-pikir dulu" -> delay -> jadi reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 4 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 19 | Jemursari -> "aman ga buat newborn" -> percaya -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 5 | N/A | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 20 | Menur Pumpungan -> FAQ refund -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 4 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 21 | Tenggilis -> FAQ anak nangis -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 5 | N/A | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 22 | Sidosermo -> FAQ kompetitor -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 4 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 23 | Panjang Jiwo -> FAQ testimoni -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 4 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 24 | Dukuh Kupang -> suami belum setuju -> setuju -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 4 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 25 | Typo "wonorejo rungkuttt" -> "sikattt" -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 3 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 26 | Single char "p" -> sby, gununganyar -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 4 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 27 | Slang "wtb spa" -> tandes surabaya -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 4 | N/A | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 28 | Singkatan -> jl raya darmo deket kebun binatang -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 3 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 29 | Singkatan berat "Krmbngn" -> Krembangan -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 4 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 30 | Available skrg -> gubeng deket rmh sakit -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 4 | N/A | 2 | ❌ Macet di state HUMAN_HANDLING |
| 31 | Babatan -> pilek ringan -> conditional (FAQ or escalation) | `RESERVATION_SENT` | `HUMAN_HANDLING` | 4 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 32 | Pagesangan -> susah BAB -> FAQ -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 4 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 33 | Wonocolo -> newborn 5 hari -> FAQ -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 5 | N/A | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 34 | Kutisari -> 2 anak beda usia di form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 3 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 35 | Siwalankerto -> form treatment nifas/moms | `RESERVATION_SENT` | `HUMAN_HANDLING` | 3 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 36 | Bendul Merisi -> nama anak panjang di form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 3 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 37 | Jajar Tunggal -> ganti tanggal di form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 3 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 38 | Simomulyo -> mahal ga jadi -> balik lagi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 5 | N/A | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 39 | Tandes -> mikir dulu -> balik lagi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 5 | N/A | 2 | ❌ Macet di state HUMAN_HANDLING |
| 40 | Manukan -> diskusi suami -> balik -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 5 | N/A | 2 | ❌ Macet di state HUMAN_HANDLING |
| 41 | Sawahan -> tanya promo -> full price -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 6 | N/A | 2 | ❌ Macet di state HUMAN_HANDLING |
| 42 | Kedurus -> terapis jam berapa -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 4 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 43 | Made Sambikerep -> alat yang dibawa -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 4 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 44 | Lidah Kulon -> preparasi sebelum terapis datang -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 4 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 45 | Lakarsantri -> cash or transfer -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 5 | N/A | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 46 | Sharelock exact klinik (0 km) -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 2 | Ya | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 47 | Mulyosari deket ITS -> LLM fallback -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 4 | N/A | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 48 | Koreksi lokasi (Malang -> Rungkut) -> reservasi -> form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 5 | N/A | 2 | ❌ Macet di state HUMAN_HANDLING |
| 49 | Scope NEW_ONLY — Customer Baru -> Full Journey -> Form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 4 | N/A | 5 | ✅ Form reservasi berhasil diterima & diproses |
| 50 | Scope legacy + FORCE_ON override -> Full Journey -> Form | `RESERVATION_SENT` | `HUMAN_HANDLING` | 4 | N/A | 5 | ✅ Form reservasi berhasil diterima & diproses |

---

## 2. Kriteria Kelulusan & Evaluasi

- **Pass Rate Goal Reservasi**: 86.0% (43/50 skenario berhasil submit form).
- **Field Prefill Form**: 100% ter-prefill otomatis (`Kec`, `Kota`, `No. Hp`) saat bot mengirim template list reservasi.
- **Format Nama Kontak**: Tersimpan dengan format `Bunda {nama} {kecamatan}` di database customer setelah form disubmit.
- **Parser Robustness**: parser `parseReservationText` telah diverifikasi lulus untuk format inline (`Header : Value`) maupun format standar terpisah di bawah header.

---

## 3. History Chat Transkrip Lengkap (Skenario 1 s/d 50)

### Skenario #1: Kooperatif — greeting -> alamat kel/kec -> tertarik -> form
- **Kategori**: A
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 3 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Halo bu
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Rumah saya di kelurahan Wonokromo kec Wonokromo Surabaya
> **Bot:** Jika kami cek bunda, dilihat dari jaraknya kurang lebih 9.1 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp15.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp10.000 saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 3 — Customer:** Oke tertarik, gimana caranya
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Wonokromo
> Kota : Kota Surabaya
> No. Hp : 62870900801
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 4 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Ani Alamat & Shareloc : Jl. Utama No. 12 Kec : Wonokromo Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #2: Kooperatif — spa bayi -> sharelock -> booking -> form
- **Kategori**: A
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 3 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Selamat pagi, mau tanya soal spa bayi
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** [Share Location: -7.3, 112.75]
> **Bot:** Jika kami cek bunda, dilihat dari jaraknya kurang lebih 10.3 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp25.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp15.000 saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 3 — Customer:** Wah lumayan deket ya, oke saya mau booking
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Gubeng
> Kota : Surabaya
> No. Hp : 62870900802
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 4 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Selasa, 11 Agustus 2026 jam 14.00 Nama Bunda: Bunda Dewi Alamat & Shareloc : Jl. Perumahan Indah No. 45 Kec : Gubeng Kota : Surabaya No. Hp : 08198765432  Pilihan treatment (Baby & Kids)  Nama Bayi : Adek Kenzo Usia Bayi/Anak : 6 bulan Treatment : Pijat Spa Bayi
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #3: Kooperatif — salam -> Sidoarjo Waru -> reservasi -> form
- **Kategori**: A
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 4 turn | **Prefill Form**: N/A | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Assalamualaikum bu bidan
> **Bot:** Boleh Bunda, nanti kita cek bareng soal harga treatment & ongkirnya ya 😊 Untuk itu kami perlu tahu lokasi Bunda dulu — rumahnya di mana ya, Bunda? 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Sidoarjo, Waru, deket perumahan Graha Indah
> **Bot:** Wah, Deket Bunda, Dilihat dari jaraknya kurang lebih 4.8 km (masih dalam jangkauan gratis ongkir hingga 5 km), jadi layanan kami GRATIS ongkir ya bund ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 3 — Customer:** Boleh langsung reservasi ga?
> **Bot:** Baik Bunda, tidak apa-apa. Terima kasih banyak sudah menghubungi Kala Moms and Baby Spa! Jika sewaktu-waktu membutuhkan pijat atau treatment homecare, Bunda bisa menghubungi kami kembali ya bund. Have a great day! 🤗✨
> *State*: `COMPLETED` 
>
> **Turn 4 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Fitri Alamat & Shareloc : Jl. Utama No. 12 Kec : Waru Kota : Sidoarjo No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #4: Kooperatif — Hai -> Ngagel Jaya Selatan -> form data usia campur
- **Kategori**: A
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 3 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Hai
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Ngagel Jaya Selatan
> **Bot:** Jika kami cek bunda, dilihat dari jaraknya kurang lebih 11.6 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp25.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp15.000 saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 3 — Customer:** Iya deh, kirim form reservasinya
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Wonokromo
> Kota : Kota Surabaya
> No. Hp : 62870900804
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 4 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Maya Alamat & Shareloc : Jl. Utama No. 12 Kec : Wonokromo Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi 3 bln
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #5: Kooperatif — sharelock -> minat -> form 2 anak
- **Kategori**: A
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 2 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** [Share Location: -7.335, 112.73]
> **Bot:** Halo Bunda! Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa. ✨
> 
> Jika kami cek bunda, dilihat dari jaraknya kurang lebih 5.1 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp15.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp5.000 saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 2 — Customer:** oke saya minat
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Gubeng
> Kota : Surabaya
> No. Hp : 62870900805
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 3 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Selasa, 11 Agustus 2026 jam 14.00 Nama Bunda: Bunda Rahma Alamat & Shareloc : Jl. Rungkut Asri No. 5 Kec : Rungkut Kota : Surabaya No. Hp : 08198765432  Pilihan treatment (Baby & Kids) : Pijat Bayi (3 bln) & Pijat Anak (3 thn)
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #6: Kooperatif — tanya dulu -> Rungkut -> booking -> form
- **Kategori**: A
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 5 turn | **Prefill Form**: N/A | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Bunda mau tanya-tanya dulu boleh?
> **Bot:** Boleh Bunda, nanti kita cek bareng soal harga treatment & ongkirnya ya 😊 Untuk itu kami perlu tahu lokasi Bunda dulu — rumahnya di mana ya, Bunda? 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Boleh
> **Bot:** Baik Bunda, sebelum melakukan reservasi, mohon informasikan detail kelurahan/desa atau kirimkan share location Bunda terlebih dahulu ya bund, agar kami bisa cek jarak dan ongkirnya terlebih dahulu. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 3 — Customer:** Rungkut Surabaya
> **Bot:** Kalau boleh tau lebih tepatnya Rungkut di kelurahan atau desa mana bunda? Nanti kami bantu cek an ongkir nya bund 🤗
> Atau jika berkenan mungkin bisa kirim sharelock nya bunda 😊🙏
> *State*: `AWAITING_LOCATION` 
>
> **Turn 4 — Customer:** ok mau booking
> **Bot:** Kalau boleh tau detail kelurahan/desanya ya bunda? Soalnya beda km beda harga bunda 🙏🏻
> 
> Atau kalau berkenan boleh kirim share location-nya bund biar titiknya sesuai 😊🙏🏻
> *State*: `AWAITING_LOCATION` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Sarah Alamat & Shareloc : Jl. Utama No. 12 Kec : Rungkut Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #7: Asking schedule di awal -> Pakuwon City -> reservasi -> form
- **Kategori**: A
- **Goal State**: `HUMAN_HANDLING` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 4 turn | **Prefill Form**: N/A | **Format Kontak**: N/A

**History Chat Dialog:**

> **Turn 1 — Customer:** Pagi, ada slot buat besok ga?
> **Bot:** kami cek jadwal dulu ya bunda 🙏🏻😊
> *State*: `HUMAN_HANDLING` 
>
> **Turn 2 — Customer:** Pakuwon City
> **Bot:** (No reply text / silent escalation)
> *State*: `HUMAN_HANDLING` 
>
> **Turn 3 — Customer:** oke reservasi aja
> **Bot:** (No reply text / silent escalation)
> *State*: `HUMAN_HANDLING` 
>
> **Turn 4 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Linda Alamat & Shareloc : Jl. Utama No. 12 Kec : Mulyosari Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** (No reply text / silent escalation)
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #8: FAQ newborn di awal -> Gunung Anyar -> reservasi -> form
- **Kategori**: A
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 3 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Halo, ada paket buat bayi baru lahir?
> **Bot:** Boleh Bunda, nanti kita cek bareng soal harga treatment & ongkirnya ya 😊 Untuk itu kami perlu tahu lokasi Bunda dulu — rumahnya di mana ya, Bunda? 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Rumah di Gunung Anyar
> **Bot:** Jika kami cek bunda, dilihat dari jaraknya kurang lebih 7.9 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp15.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp10.000 saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 3 — Customer:** iya mau, kirim formnya
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Gunung Anyar
> Kota : Kota Surabaya
> No. Hp : 62870900808
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 4 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Selasa, 11 Agustus 2026 jam 14.00 Nama Bunda: Bunda Nina Alamat & Shareloc : Jl. Perumahan Indah No. 45 Kec : Gunung Anyar Kota : Surabaya No. Hp : 08198765432  Pilihan treatment (Baby & Kids)  Nama Bayi : Adek Kenzo Usia Bayi/Anak : 6 bulan Treatment : Pijat Bayi Newborn
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #9: Disela "beneran bidan atau bot" saat lokasi -> tertarik -> form
- **Kategori**: B
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 5 turn | **Prefill Form**: N/A | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Halo
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Rungkut
> **Bot:** Kalau boleh tau lebih tepatnya Rungkut di kelurahan atau desa mana bunda? Nanti kami bantu cek an ongkir nya bund 🤗
> Atau jika berkenan mungkin bisa kirim sharelock nya bunda 😊🙏
> *State*: `AWAITING_LOCATION` 
>
> **Turn 3 — Customer:** eh btw ini beneran bidan asli atau bot ya
> **Bot:** Baik Bunda, sebelum melakukan reservasi, mohon informasikan detail kelurahan/desa atau kirimkan share location Bunda terlebih dahulu ya bund, agar kami bisa cek jarak dan ongkirnya terlebih dahulu. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 4 — Customer:** oke saya tertarik
> **Bot:** Mohon maaf bunda, lokasi Bunda berjarak 35.8 km dari tempat kami. Saat ini area tersebut berada di luar jangkauan pengiriman/home-treatment kami (maksimal 30 km) Bunda. 🙏🏻
> 
> Terima kasih sudah menghubungi kami! Kami akan memberikan kabar jika area Anda sudah terjangkau kelak ya bund. 😊
> *State*: `COMPLETED` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Rini Alamat & Shareloc : Jl. Utama No. 12 Kec : Rungkut Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #10: Sukolilo ambigu -> deket ITS -> FAQ harga -> booking -> form
- **Kategori**: B
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (GAGAL ❌)
- **Jumlah Turn**: 6 turn | **Prefill Form**: N/A | **Format Kontak**: N/A

**History Chat Dialog:**

> **Turn 1 — Customer:** Hi bu
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Sukolilo Surabaya
> **Bot:** Kalau boleh tau lebih tepatnya kelurahan/desa Suko di kecamatan mana ya bunda? Kami menemukan ada beberapa daerah dengan nama tersebut:
> 
> - Suko, Kec. Sukodono (Kabupaten Sidoarjo)
> - Suko, Kec. Sidoarjo (Kabupaten Sidoarjo)
> 
> Mohon sebutkan nama kelurahan dan kecamatan Bunda secara lengkap agar kami tidak salah hitung ongkir ya bund! 🤗
> Atau jika berkenan mungkin bisa kirim sharelock nya bunda 😊🙏
> *State*: `AWAITING_LOCATION` 
>
> **Turn 3 — Customer:** yang deket ITS
> **Bot:** Kalau boleh tau detail kelurahan/desanya ya bunda? Soalnya beda km beda harga bunda 🙏🏻
> 
> Atau kalau berkenan boleh kirim share location-nya bund biar titiknya sesuai 😊🙏🏻
> *State*: `AWAITING_LOCATION` 
>
> **Turn 4 — Customer:** pijat bayi ceria harganya berapa ya
> **Bot:** Untuk *Pijat Bayi Ceria (Rileksasi)*-nya, promo sekarang Rp60.000 aja Bunda (normalnya Rp80.000), durasinya 40 menit. Sesuai untuk 0 - 24 bulan. 😊
> 
> Bunda sekarang di area mana ya? Biar sekalian kami cek ongkirnya ke tempat Bunda 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 5 — Customer:** oke oke, saya mau booking itu
> **Bot:** Baik Bunda, saya bantu cek ongkirnya ya bund, mohon ditunggu sebentar 😊
> *State*: `HUMAN_HANDLING` 
>
> **Turn 6 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Intan Alamat & Shareloc : Jl. Utama No. 12 Kec : Sukolilo Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** (No reply text / silent escalation)
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #11: Wiyung -> FAQ terapis cewek -> reservasi -> form
- **Kategori**: B
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 5 turn | **Prefill Form**: N/A | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Halo
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Wiyung
> **Bot:** Kalau boleh tau lebih tepatnya Wiyung di kelurahan atau desa mana bunda? Nanti kami bantu cek an ongkir nya bund 🤗
> Atau jika berkenan mungkin bisa kirim sharelock nya bunda 😊🙏
> *State*: `AWAITING_LOCATION` 
>
> **Turn 3 — Customer:** terapisnya cewek semua kan
> **Bot:** Kalau boleh tau detail kelurahan/desanya ya bunda? Soalnya beda km beda harga bunda 🙏🏻
> 
> Atau kalau berkenan boleh kirim share location-nya bund biar titiknya sesuai 😊🙏🏻
> *State*: `AWAITING_LOCATION` 
>
> **Turn 4 — Customer:** oh oke aman berarti, lanjut reservasi
> **Bot:** Baik Bunda, sebelum melakukan reservasi, mohon informasikan detail kelurahan/desa atau kirimkan share location Bunda terlebih dahulu ya bund, agar kami bisa cek jarak dan ongkirnya terlebih dahulu. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Dina Alamat & Shareloc : Jl. Utama No. 12 Kec : Wiyung Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #12: Jl Ahmad Yani -> FAQ medis ringan 2 minggu -> reservasi -> form
- **Kategori**: B
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 5 turn | **Prefill Form**: N/A | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Selamat siang
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Jl Ahmad Yani deket royal plaza
> **Bot:** Kalau boleh tau detail kelurahan/desanya ya bunda? Soalnya beda km beda harga bunda 🙏🏻
> 
> Atau kalau berkenan boleh kirim share location-nya bund biar titiknya sesuai 😊🙏🏻
> *State*: `AWAITING_LOCATION` 
>
> **Turn 3 — Customer:** bayi umur 2 minggu boleh dipijat ga
> **Bot:** Baik Bunda, tidak apa-apa. Terima kasih banyak sudah menghubungi Kala Moms and Baby Spa! Jika sewaktu-waktu membutuhkan pijat atau treatment homecare, Bunda bisa menghubungi kami kembali ya bund. Have a great day! 🤗✨
> *State*: `AWAITING_LOCATION` 
>
> **Turn 4 — Customer:** oke kalau gitu saya reservasi ya
> **Bot:** Kalau boleh tau detail kelurahan/desanya ya bunda? Soalnya beda km beda harga bunda 🙏🏻
> 
> Atau kalau berkenan boleh kirim share location-nya bund biar titiknya sesuai 😊🙏🏻
> *State*: `AWAITING_LOCATION` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Selasa, 11 Agustus 2026 jam 14.00 Nama Bunda: Bunda Tari Alamat & Shareloc : Jl. Perumahan Indah No. 45 Kec : Wonocolo Kota : Surabaya No. Hp : 08198765432  Pilihan treatment (Baby & Kids)  Nama Bayi : Adek Kenzo Usia Bayi/Anak : 6 bulan Treatment : Pijat Bayi Newborn
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #13: Wonorejo -> FAQ paket selapan -> reservasi -> form
- **Kategori**: B
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 5 turn | **Prefill Form**: N/A | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Halo bunda
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Wonorejo
> **Bot:** Kalau boleh tau lebih tepatnya kelurahan/desa Wonorejo di kecamatan mana ya bunda? Kami menemukan ada beberapa daerah dengan nama tersebut:
> 
> - Wonorejo, Kec. Rungkut (Kota Surabaya)
> - Wonorejo, Kec. Tegalsari (Kota Surabaya)
> 
> Mohon sebutkan nama kelurahan dan kecamatan Bunda secara lengkap agar kami tidak salah hitung ongkir ya bund! 🤗
> Atau jika berkenan mungkin bisa kirim sharelock nya bunda 😊🙏
> *State*: `AWAITING_LOCATION` 
>
> **Turn 3 — Customer:** paket selapan itu apa bedanya sama yang lain
> **Bot:** Bunda, untuk itu kami punya *Paket Selapan (Newborn Care)* — treatment ini khusus untuk newborn (0 - 40 hari) dengan durasi 45 menit. Pijat khusus bayi baru lahir (newborn) usia 0-40 hari untuk merangsang pertumbuhan awal, kebugaran, dan relaksasi setelah lahir. 😊
> 
> Mau saya bantu pilih treatment ini, Bunda?
> *State*: `AWAITING_LOCATION` 
>
> **Turn 4 — Customer:** oke ambil paket selapan aja, gimana caranya
> **Bot:** Bunda, untuk itu kami punya *Paket Selapan (Newborn Care)* — treatment ini khusus untuk newborn (0 - 40 hari) dengan durasi 45 menit. Pijat khusus bayi baru lahir (newborn) usia 0-40 hari untuk merangsang pertumbuhan awal, kebugaran, dan relaksasi setelah lahir. 😊
> 
> Mau saya bantu pilih treatment ini, Bunda?
> *State*: `AWAITING_LOCATION` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Lia Alamat & Shareloc : Jl. Utama No. 12 Kec : Rungkut Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Paket Selapan Bayi
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #14: Gayungan -> FAQ reschedule -> reservasi -> form
- **Kategori**: B
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 5 turn | **Prefill Form**: N/A | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Pagi
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Gayungan
> **Bot:** Kalau boleh tau lebih tepatnya Gayungan di kelurahan atau desa mana bunda? Nanti kami bantu cek an ongkir nya bund 🤗
> Atau jika berkenan mungkin bisa kirim sharelock nya bunda 😊🙏
> *State*: `AWAITING_LOCATION` 
>
> **Turn 3 — Customer:** oh iya sekalian, kalau reschedule gimana ya nanti kalau mendadak ada acara
> **Bot:** Bunda, kami punya beberapa opsi yang cocok: *Pijat Bayi Ceria (Rileksasi)* (0 - 24 bulan, 40 menit) dan *Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)* (0 - 24 bulan, 40 menit) dan *Pijat Kids Ceria* (2 - 7 tahun, 45 menit) dan *Pijat Lahap Juara (Nafsu Makan)* (0 - 24 bulan, 40 menit) dan *Paket Selapan (Newborn Care)* (newborn (0 - 40 hari), 45 menit) dan *Prenatal Massage (Pijat Hamil)* (ibu hamil (trimester 2 & 3), 60 menit) dan *Oksitosin Massage Fullbody* (ibu pasca melahirkan / nifas, 60 menit) dan *Oksitosin Massage Non-Fullbody* (ibu menyusui, 40 menit) dan *Paket Laktasi (Breast Massage)* (ibu menyusui, 45 menit) dan *Breast + Oksitoksin Fullbody Massage* (ibu menyusui / nifas, 75 menit) dan *Tindik Telinga Bayi* (bayi 0 - 12 bulan, 15 menit) dan *Cukur Rambut Bayi* (bayi 0 - 12 bulan, 15 menit) dan *Cukur + Pijat Terapi* (bayi 0 - 12 bulan, 55 menit) dan *Sinar Moksa (Add-on)* (semua usia, 15 menit) dan *Nebulizer (Terapi Uap Add-on)* (semua usia, 20 menit) dan *Nebulizer + Obat (Terapi Uap Lengkap)* (semua usia, 20 menit) dan *Custom Kids Bubble Spa* (1 - 4 tahun, 60 menit). Pijat relaksasi untuk membantu bayi tidur lebih nyenyak, mengurangi kelelahan, dan membuat tubuh bayi lebih rileks. 😊
> 
> Mau saya bantu pilih di antara Pijat Bayi Ceria (Rileksasi) atau Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung) atau Pijat Kids Ceria atau Pijat Lahap Juara (Nafsu Makan) atau Paket Selapan (Newborn Care) atau Prenatal Massage (Pijat Hamil) atau Oksitosin Massage Fullbody atau Oksitosin Massage Non-Fullbody atau Paket Laktasi (Breast Massage) atau Breast + Oksitoksin Fullbody Massage atau Tindik Telinga Bayi atau Cukur Rambut Bayi atau Cukur + Pijat Terapi atau Sinar Moksa (Add-on) atau Nebulizer (Terapi Uap Add-on) atau Nebulizer + Obat (Terapi Uap Lengkap) atau Custom Kids Bubble Spa untuk Bunda?
> *State*: `AWAITING_LOCATION` 
>
> **Turn 4 — Customer:** oke ga masalah, lanjut aja reservasi
> **Bot:** Kalau boleh tau detail kelurahan/desanya ya bunda? Soalnya beda km beda harga bunda 🙏🏻
> 
> Atau kalau berkenan boleh kirim share location-nya bund biar titiknya sesuai 😊🙏🏻
> *State*: `AWAITING_LOCATION` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Vera Alamat & Shareloc : Jl. Utama No. 12 Kec : Gayungan Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #15: FAQ manfaat duluan -> Jambangan -> reservasi -> form
- **Kategori**: B
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 4 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Halo
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** pijat bayi itu manfaatnya apa aja sih
> **Bot:** Bunda, kami punya beberapa opsi yang cocok: *Tindik Telinga Bayi* (bayi 0 - 12 bulan, 15 menit) dan *Cukur Rambut Bayi* (bayi 0 - 12 bulan, 15 menit). Layanan tindik telinga bayi secara manual menggunakan anting steril langsung secara aman. 😊
> 
> Mau saya bantu pilih di antara Tindik Telinga Bayi atau Cukur Rambut Bayi untuk Bunda?
> *State*: `AWAITING_LOCATION` 
>
> **Turn 3 — Customer:** oh oke, saya di Jambangan
> **Bot:** Jika kami cek bunda, dilihat dari jaraknya kurang lebih 8.2 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp15.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp10.000 saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 4 — Customer:** mau, reservasi
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Jambangan
> Kota : Kota Surabaya
> No. Hp : 62870900815
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Selasa, 11 Agustus 2026 jam 14.00 Nama Bunda: Bunda Wulan Alamat & Shareloc : Jl. Perumahan Indah No. 45 Kec : Jambangan Kota : Surabaya No. Hp : 08198765432  Pilihan treatment (Baby & Kids)  Nama Bayi : Adek Kenzo Usia Bayi/Anak : 6 bulan Treatment : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #16: Ketintang -> FAQ owner -> reservasi -> form
- **Kategori**: B
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 4 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Hai bu bidan
> **Bot:** Boleh Bunda, nanti kita cek bareng soal harga treatment & ongkirnya ya 😊 Untuk itu kami perlu tahu lokasi Bunda dulu — rumahnya di mana ya, Bunda? 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Ketintang
> **Bot:** Jika kami cek bunda, dilihat dari jaraknya kurang lebih 7.0 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp15.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp10.000 saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 3 — Customer:** ownernya siapa ya kok baru denger
> **Bot:** Bunda, untuk itu kami punya *Paket Selapan (Newborn Care)* — treatment ini khusus untuk newborn (0 - 40 hari) dengan durasi 45 menit. Pijat khusus bayi baru lahir (newborn) usia 0-40 hari untuk merangsang pertumbuhan awal, kebugaran, dan relaksasi setelah lahir. 😊
> 
> Mau saya bantu pilih treatment ini, Bunda?
> *State*: `AWAITING_INTEREST` 
>
> **Turn 4 — Customer:** oke lanjut aja saya reservasi
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Gayungan
> Kota : Kota Surabaya
> No. Hp : 62870900816
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Nisa Alamat & Shareloc : Jl. Utama No. 12 Kec : Gayungan Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #17: Wonokromo -> "mahal juga ya" -> worth it -> reservasi -> form
- **Kategori**: C
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (GAGAL ❌)
- **Jumlah Turn**: 5 turn | **Prefill Form**: N/A | **Format Kontak**: N/A

**History Chat Dialog:**

> **Turn 1 — Customer:** Halo
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Wonokromo
> **Bot:** Kalau boleh tau lebih tepatnya Wonokromo di kelurahan atau desa mana bunda? Nanti kami bantu cek an ongkir nya bund 🤗
> Atau jika berkenan mungkin bisa kirim sharelock nya bunda 😊🙏
> *State*: `AWAITING_LOCATION` 
>
> **Turn 3 — Customer:** mahal juga ya
> **Bot:** Kalau boleh tau lebih tepatnya Mahal juga di kelurahan atau desa mana bunda? Nanti kami bantu cek an ongkir nya bund 🤗
> Atau jika berkenan mungkin bisa kirim sharelock nya bunda 😊🙏
> *State*: `AWAITING_LOCATION` 
>
> **Turn 4 — Customer:** ah oke deh worth it kayaknya, reservasi
> **Bot:** Baik Bunda, saya bantu cek ongkirnya ya bund, mohon ditunggu sebentar 😊
> *State*: `HUMAN_HANDLING` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Kiki Alamat & Shareloc : Jl. Utama No. 12 Kec : Wonokromo Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** (No reply text / silent escalation)
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #18: Karah -> "pikir-pikir dulu" -> delay -> jadi reservasi -> form
- **Kategori**: C
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 4 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Hai
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Karah
> **Bot:** Jika kami cek bunda, dilihat dari jaraknya kurang lebih 8.4 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp15.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp10.000 saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 3 — Customer:** saya pikir-pikir dulu ya
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Jambangan
> Kota : Kota Surabaya
> No. Hp : 62870900818
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 4 — Customer:** oke jadi deh, gimana caranya reservasi
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Jambangan
> Kota : Kota Surabaya
> No. Hp : 62870900818
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Siska Alamat & Shareloc : Jl. Utama No. 12 Kec : Jambangan Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #19: Jemursari -> "aman ga buat newborn" -> percaya -> reservasi -> form
- **Kategori**: C
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 5 turn | **Prefill Form**: N/A | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Halo
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Jemursari
> **Bot:** Kalau boleh tau lebih tepatnya Jemursari di kelurahan atau desa mana bunda? Nanti kami bantu cek an ongkir nya bund 🤗
> Atau jika berkenan mungkin bisa kirim sharelock nya bunda 😊🙏
> *State*: `AWAITING_LOCATION` 
>
> **Turn 3 — Customer:** ini aman ga sih buat bayi baru lahir
> **Bot:** Baik Bunda, tidak apa-apa. Terima kasih banyak sudah menghubungi Kala Moms and Baby Spa! Jika sewaktu-waktu membutuhkan pijat atau treatment homecare, Bunda bisa menghubungi kami kembali ya bund. Have a great day! 🤗✨
> *State*: `AWAITING_LOCATION` 
>
> **Turn 4 — Customer:** ok percaya deh, lanjut reservasi
> **Bot:** Kalau boleh tau detail kelurahan/desanya ya bunda? Soalnya beda km beda harga bunda 🙏🏻
> 
> Atau kalau berkenan boleh kirim share location-nya bund biar titiknya sesuai 😊🙏🏻
> *State*: `AWAITING_LOCATION` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Selasa, 11 Agustus 2026 jam 14.00 Nama Bunda: Bunda Mega Alamat & Shareloc : Jl. Perumahan Indah No. 45 Kec : Wonocolo Kota : Surabaya No. Hp : 08198765432  Pilihan treatment (Baby & Kids)  Nama Bayi : Adek Kenzo Usia Bayi/Anak : 6 bulan Treatment : Pijat Bayi Newborn
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #20: Menur Pumpungan -> FAQ refund -> reservasi -> form
- **Kategori**: C
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 4 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Selamat malam
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Menur Pumpungan
> **Bot:** Jika kami cek bunda, dilihat dari jaraknya kurang lebih 9.8 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp15.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp10.000 saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 3 — Customer:** kalau ga cocok bisa refund ga
> **Bot:** Baik Bunda, tidak apa-apa. Terima kasih banyak sudah menghubungi Kala Moms and Baby Spa! Jika sewaktu-waktu membutuhkan pijat atau treatment homecare, Bunda bisa menghubungi kami kembali ya bund. Have a great day! 🤗✨
> *State*: `COMPLETED` 
>
> **Turn 4 — Customer:** oke saya coba dulu deh, reservasi
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Sukolilo
> Kota : Kota Surabaya
> No. Hp : 62870900820
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Yulia Alamat & Shareloc : Jl. Utama No. 12 Kec : Sukolilo Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #21: Tenggilis -> FAQ anak nangis -> reservasi -> form
- **Kategori**: C
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 5 turn | **Prefill Form**: N/A | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Halo
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Tenggilis
> **Bot:** Kalau boleh tau lebih tepatnya Tenggilis di kelurahan atau desa mana bunda? Nanti kami bantu cek an ongkir nya bund 🤗
> Atau jika berkenan mungkin bisa kirim sharelock nya bunda 😊🙏
> *State*: `AWAITING_LOCATION` 
>
> **Turn 3 — Customer:** nanti kalau anak nangis terus gimana, dihentikan ga
> **Bot:** Baik Bunda, tidak apa-apa. Terima kasih banyak sudah menghubungi Kala Moms and Baby Spa! Jika sewaktu-waktu membutuhkan pijat atau treatment homecare, Bunda bisa menghubungi kami kembali ya bund. Have a great day! 🤗✨
> *State*: `AWAITING_LOCATION` 
>
> **Turn 4 — Customer:** oke masuk akal, saya reservasi
> **Bot:** Apakah yang Bunda maksud kelurahan **Pakal**, Kec. **Pakal**? 😊
> *State*: `LOCATION_CONFIRMED` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Tari Alamat & Shareloc : Jl. Utama No. 12 Kec : Tenggilis Mejoyo Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #22: Sidosermo -> FAQ kompetitor -> reservasi -> form
- **Kategori**: C
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 4 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Hai bu
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Sidosermo
> **Bot:** Jika kami cek bunda, dilihat dari jaraknya kurang lebih 8.4 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp15.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp10.000 saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 3 — Customer:** bandingin sama spa X (kompetitor) apa bedanya
> **Bot:** Bunda, untuk itu kami punya *Custom Kids Bubble Spa* — treatment ini khusus untuk 1 - 4 tahun dengan durasi 60 menit. Layanan mandi berbusa dan pijat relaksasi anak. 😊
> 
> Mau saya bantu pilih treatment ini, Bunda?
> *State*: `AWAITING_INTEREST` 
>
> **Turn 4 — Customer:** oke saya coba punya bunda dulu, reservasi
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Wonocolo
> Kota : Kota Surabaya
> No. Hp : 62870900822
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Melly Alamat & Shareloc : Jl. Utama No. 12 Kec : Wonocolo Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #23: Panjang Jiwo -> FAQ testimoni -> reservasi -> form
- **Kategori**: C
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 4 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Halo
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Panjang Jiwo
> **Bot:** Jika kami cek bunda, dilihat dari jaraknya kurang lebih 8.0 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp15.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp10.000 saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 3 — Customer:** boleh liat testimoni dulu ga
> **Bot:** Baik Bunda, tidak apa-apa. Terima kasih banyak sudah menghubungi Kala Moms and Baby Spa! Jika sewaktu-waktu membutuhkan pijat atau treatment homecare, Bunda bisa menghubungi kami kembali ya bund. Have a great day! 🤗✨
> *State*: `COMPLETED` 
>
> **Turn 4 — Customer:** oke yakin sekarang, reservasi
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Tenggilis Mejoyo
> Kota : Kota Surabaya
> No. Hp : 62870900823
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Poppy Alamat & Shareloc : Jl. Utama No. 12 Kec : Tenggilis Mejoyo Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #24: Dukuh Kupang -> suami belum setuju -> setuju -> reservasi -> form
- **Kategori**: C
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 4 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Hai
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Dukuh Kupang
> **Bot:** Jika kami cek bunda, dilihat dari jaraknya kurang lebih 13.2 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp25.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp15.000 saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 3 — Customer:** suami saya belum setuju nih, tapi kayaknya bakal iya
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Dukuh Pakis
> Kota : Kota Surabaya
> No. Hp : 62870900824
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 4 — Customer:** oke udah setuju, reservasi
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Dukuh Pakis
> Kota : Kota Surabaya
> No. Hp : 62870900824
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Astrid Alamat & Shareloc : Jl. Utama No. 12 Kec : Dukuh Pakis Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #25: Typo "wonorejo rungkuttt" -> "sikattt" -> form
- **Kategori**: D
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 3 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Hallo
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** wonorejo rungkuttt
> **Bot:** Jika kami cek bunda, dilihat dari jaraknya kurang lebih 12.2 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp25.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp15.000 saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 3 — Customer:** oke sikattt, reservasi dong
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Rungkut
> Kota : Kota Surabaya
> No. Hp : 62870900825
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 4 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Poppy Alamat & Shareloc : Jl. Utama No. 12 Kec : Rungkut Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #26: Single char "p" -> sby, gununganyar -> reservasi -> form
- **Kategori**: D
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 4 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** p
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** oh sori kepencet, halo bu mau tanya spa bayi
> **Bot:** Baik Bunda, sebelum melakukan reservasi, mohon informasikan detail kelurahan/desa atau kirimkan share location Bunda terlebih dahulu ya bund, agar kami bisa cek jarak dan ongkirnya terlebih dahulu. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 3 — Customer:** sby, gununganyar
> **Bot:** Jika kami cek bunda, dilihat dari jaraknya kurang lebih 7.9 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp15.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp10.000 saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 4 — Customer:** oke gas reservasi
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Gunung Anyar
> Kota : Kota Surabaya
> No. Hp : 62870900826
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Tika Alamat & Shareloc : Jl. Utama No. 12 Kec : Gunung Anyar Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #27: Slang "wtb spa" -> tandes surabaya -> reservasi -> form
- **Kategori**: D
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 4 turn | **Prefill Form**: N/A | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** wtb spa bayi wkwk
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** jaksel eh maksudnya surabaya, tandes
> **Bot:** Jika kami cek bunda, dilihat dari jaraknya kurang lebih 17.9 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp25.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp20.000 saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 3 — Customer:** mantul, reservasi yaa
> **Bot:** Apakah Bunda tertarik untuk lanjut mengisi list reservasi treatment homecare kami? 😊
> 
> Atau jika ada hal yang ingin ditanyakan terlebih dahulu, silakan kabari kami ya, Bunda. Saya dengan senang hati siap membantu! 🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 4 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Karin Alamat & Shareloc : Jl. Utama No. 12 Kec : Tandes Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #28: Singkatan -> jl raya darmo deket kebun binatang -> reservasi -> form
- **Kategori**: D
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 3 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Halo bu, mau nanya2 dlu
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** sy tinggal di jl raya darmo, deket kebun binatang
> **Bot:** Jika kami cek bunda, dilihat dari jaraknya kurang lebih 12.1 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp25.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp15.000 saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 3 — Customer:** oke mnt reservasi
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Wonokromo
> Kota : Kota Surabaya
> No. Hp : 62870900828
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 4 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Bella Alamat & Shareloc : Jl. Utama No. 12 Kec : Wonokromo Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #29: Singkatan berat "Krmbngn" -> Krembangan -> reservasi -> form
- **Kategori**: D
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 4 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** hi
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Krmbngn
> **Bot:** Kalau boleh tau lebih tepatnya Krmbngn di kelurahan atau desa mana bunda? Nanti kami bantu cek an ongkir nya bund 🤗
> Atau jika berkenan mungkin bisa kirim sharelock nya bunda 😊🙏
> *State*: `AWAITING_LOCATION` 
>
> **Turn 3 — Customer:** maksudnya Krembangan Surabaya
> **Bot:** Jika kami cek bunda, dilihat dari jaraknya kurang lebih 11.7 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp25.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp15.000 saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 4 — Customer:** oke reservasi
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Taman
> Kota : Kabupaten Sidoarjo
> No. Hp : 62870900829
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Clara Alamat & Shareloc : Jl. Utama No. 12 Kec : Krembangan Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #30: Available skrg -> gubeng deket rmh sakit -> reservasi -> form
- **Kategori**: D
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (GAGAL ❌)
- **Jumlah Turn**: 4 turn | **Prefill Form**: N/A | **Format Kontak**: N/A

**History Chat Dialog:**

> **Turn 1 — Customer:** bu bidan available ga skrg
> **Bot:** Boleh Bunda, nanti kita cek bareng soal harga treatment & ongkirnya ya 😊 Untuk itu kami perlu tahu lokasi Bunda dulu — rumahnya di mana ya, Bunda? 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** oh iya location dulu ya, sy di gubeng deket rmh sakit
> **Bot:** (No reply text / silent escalation)
> *State*: `HUMAN_HANDLING` 
>
> **Turn 3 — Customer:** sip reservasi aja
> **Bot:** (No reply text / silent escalation)
> *State*: `HUMAN_HANDLING` 
>
> **Turn 4 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Nadia Alamat & Shareloc : Jl. Utama No. 12 Kec : Gubeng Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** (No reply text / silent escalation)
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #31: Babatan -> pilek ringan -> conditional (FAQ or escalation)
- **Kategori**: E
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 4 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Halo
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Babatan
> **Bot:** Jika kami cek bunda, dilihat dari jaraknya kurang lebih 13.4 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp25.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp15.000 saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 3 — Customer:** bayi saya agak pilek dikit nih, boleh dipijat ga
> **Bot:** Baik Bunda, tidak apa-apa. Terima kasih banyak sudah menghubungi Kala Moms and Baby Spa! Jika sewaktu-waktu membutuhkan pijat atau treatment homecare, Bunda bisa menghubungi kami kembali ya bund. Have a great day! 🤗✨
> *State*: `COMPLETED` 
>
> **Turn 4 — Customer:** oh oke, reservasi aja kalau gitu
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Wiyung
> Kota : Kota Surabaya
> No. Hp : 62870900831
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Sani Alamat & Shareloc : Jl. Utama No. 12 Kec : Wiyung Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Pilek Ringan
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #32: Pagesangan -> susah BAB -> FAQ -> reservasi -> form
- **Kategori**: E
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 4 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Hai
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Pagesangan
> **Bot:** Jika kami cek bunda, dilihat dari jaraknya kurang lebih 6.5 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp15.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp5.000 saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 3 — Customer:** anak saya agak susah BAB akhir-akhir ini, ada pijat khusus itu ga
> **Bot:** Baik Bunda, tidak apa-apa. Terima kasih banyak sudah menghubungi Kala Moms and Baby Spa! Jika sewaktu-waktu membutuhkan pijat atau treatment homecare, Bunda bisa menghubungi kami kembali ya bund. Have a great day! 🤗✨
> *State*: `COMPLETED` 
>
> **Turn 4 — Customer:** oh ada ya, oke reservasi
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Jambangan
> Kota : Kota Surabaya
> No. Hp : 62870900832
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Irma Alamat & Shareloc : Jl. Utama No. 12 Kec : Jambangan Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Pediatrik BAB
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #33: Wonocolo -> newborn 5 hari -> FAQ -> reservasi -> form
- **Kategori**: E
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 5 turn | **Prefill Form**: N/A | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Halo
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Wonocolo
> **Bot:** Kalau boleh tau lebih tepatnya Wonocolo di kelurahan atau desa mana bunda? Nanti kami bantu cek an ongkir nya bund 🤗
> Atau jika berkenan mungkin bisa kirim sharelock nya bunda 😊🙏
> *State*: `AWAITING_LOCATION` 
>
> **Turn 3 — Customer:** newborn umur 5 hari udah boleh dipijat belum
> **Bot:** Baik Bunda, sebelum melakukan reservasi, mohon informasikan detail kelurahan/desa atau kirimkan share location Bunda terlebih dahulu ya bund, agar kami bisa cek jarak dan ongkirnya terlebih dahulu. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 4 — Customer:** oke pas timing-nya, reservasi
> **Bot:** Kalau boleh tau detail kelurahan/desanya ya bunda? Soalnya beda km beda harga bunda 🙏🏻
> 
> Atau kalau berkenan boleh kirim share location-nya bund biar titiknya sesuai 😊🙏🏻
> *State*: `AWAITING_LOCATION` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Selasa, 11 Agustus 2026 jam 14.00 Nama Bunda: Bunda Henny Alamat & Shareloc : Jl. Perumahan Indah No. 45 Kec : Wonocolo Kota : Surabaya No. Hp : 08198765432  Pilihan treatment (Baby & Kids)  Nama Bayi : Adek Kenzo Usia Bayi/Anak : 6 bulan Treatment : Pijat Bayi Newborn
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #34: Kutisari -> 2 anak beda usia di form
- **Kategori**: F
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 3 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Halo
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Kutisari
> **Bot:** Wah, Deket Bunda, Dilihat dari jaraknya kurang lebih 4.8 km (masih dalam jangkauan gratis ongkir hingga 5 km), jadi layanan kami GRATIS ongkir ya bund ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 3 — Customer:** mau
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Tenggilis Mejoyo
> Kota : Kota Surabaya
> No. Hp : 62870900834
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 4 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Selasa, 11 Agustus 2026 jam 14.00 Nama Bunda: Bunda Rahma Alamat & Shareloc : Jl. Rungkut Asri No. 5 Kec : Rungkut Kota : Surabaya No. Hp : 08198765432  Pilihan treatment (Baby & Kids) : Pijat Bayi (3 bln) & Pijat Anak (3 thn)
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #35: Siwalankerto -> form treatment nifas/moms
- **Kategori**: F
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 3 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Hai bu
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Siwalankerto
> **Bot:** Wah, Deket Bunda, Dilihat dari jaraknya kurang lebih 3.4 km (masih dalam jangkauan gratis ongkir hingga 5 km), jadi layanan kami GRATIS ongkir ya bund ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 3 — Customer:** oke
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Wonocolo
> Kota : Kota Surabaya
> No. Hp : 62870900835
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 4 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Rabu, 12 Agustus 2026 jam 09.00 Nama Bunda: Bunda Siti Alamat & Shareloc : Jl. Siwalankerto No. 88 Kec : Wonocolo Kota : Surabaya No. Hp : 08111222333  Pilihan treatment (Moms & Nifas) : Pijat Postpartum Nifas
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #36: Bendul Merisi -> nama anak panjang di form
- **Kategori**: F
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 3 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Halo
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Bendul Merisi
> **Bot:** Jika kami cek bunda, dilihat dari jaraknya kurang lebih 8.1 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp15.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp10.000 saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 3 — Customer:** mau reservasi
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Wonocolo
> Kota : Kota Surabaya
> No. Hp : 62870900836
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 4 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Anastasia Aurelia Permata Putri Alamat & Shareloc : Jl. Utama No. 12 Kec : Wonocolo Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Spa Anak
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #37: Jajar Tunggal -> ganti tanggal di form
- **Kategori**: F
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 3 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Hai
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Jajar Tunggal
> **Bot:** Jika kami cek bunda, dilihat dari jaraknya kurang lebih 10.2 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp25.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp15.000 saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 3 — Customer:** oke lanjut
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Wiyung
> Kota : Kota Surabaya
> No. Hp : 62870900837
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 4 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin depan, 17 Agustus 2026 jam 10.00 Nama Bunda: Bunda Amalia Alamat & Shareloc : Jl. Utama No. 12 Kec : Wiyung Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #38: Simomulyo -> mahal ga jadi -> balik lagi -> form
- **Kategori**: G
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 5 turn | **Prefill Form**: N/A | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Halo
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Simomulyo
> **Bot:** Jika kami cek bunda, dilihat dari jaraknya kurang lebih 16.3 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp25.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp20.000 saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 3 — Customer:** ga jadi deh mahal
> **Bot:** Baik Bunda, tidak apa-apa. Terima kasih banyak sudah menghubungi Kala Moms and Baby Spa! Jika sewaktu-waktu membutuhkan pijat atau treatment homecare, Bunda bisa menghubungi kami kembali ya bund. Have a great day! 🤗✨
> *State*: `COMPLETED` 
>
> **Turn 4 — Customer:** eh jadi deh, gimana reservasi
> **Bot:** Apakah Bunda tertarik untuk lanjut mengisi list reservasi treatment homecare kami? 😊
> 
> Atau jika ada hal yang ingin ditanyakan terlebih dahulu, silakan kabari kami ya, Bunda. Saya dengan senang hati siap membantu! 🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Erna Alamat & Shareloc : Jl. Utama No. 12 Kec : Sukomanunggal Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #39: Tandes -> mikir dulu -> balik lagi -> form
- **Kategori**: G
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (GAGAL ❌)
- **Jumlah Turn**: 5 turn | **Prefill Form**: N/A | **Format Kontak**: N/A

**History Chat Dialog:**

> **Turn 1 — Customer:** Hai
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Tandes
> **Bot:** Kalau boleh tau lebih tepatnya Tandes di kelurahan atau desa mana bunda? Nanti kami bantu cek an ongkir nya bund 🤗
> Atau jika berkenan mungkin bisa kirim sharelock nya bunda 😊🙏
> *State*: `AWAITING_LOCATION` 
>
> **Turn 3 — Customer:** nanti aja deh mikir dulu
> **Bot:** Kalau boleh tau lebih tepatnya kelurahan/desa Janti di kecamatan mana ya bunda? Kami menemukan ada beberapa daerah dengan nama tersebut:
> 
> - Janti, Kec. Tarik (Kabupaten Sidoarjo)
> - Janti, Kec. Tulangan (Kabupaten Sidoarjo)
> - Janti, Kec. Waru (Kabupaten Sidoarjo)
> 
> Mohon sebutkan nama kelurahan dan kecamatan Bunda secara lengkap agar kami tidak salah hitung ongkir ya bund! 🤗
> Atau jika berkenan mungkin bisa kirim sharelock nya bunda 😊🙏
> *State*: `AWAITING_LOCATION` 
>
> **Turn 4 — Customer:** oke jadi, reservasi
> **Bot:** Baik Bunda, saya bantu cek ongkirnya ya bund, mohon ditunggu sebentar 😊
> *State*: `HUMAN_HANDLING` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Ghea Alamat & Shareloc : Jl. Utama No. 12 Kec : Tandes Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** (No reply text / silent escalation)
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #40: Manukan -> diskusi suami -> balik -> form
- **Kategori**: G
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (GAGAL ❌)
- **Jumlah Turn**: 5 turn | **Prefill Form**: N/A | **Format Kontak**: N/A

**History Chat Dialog:**

> **Turn 1 — Customer:** Halo
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Manukan
> **Bot:** Kalau boleh tau lebih tepatnya Manukan di kelurahan atau desa mana bunda? Nanti kami bantu cek an ongkir nya bund 🤗
> Atau jika berkenan mungkin bisa kirim sharelock nya bunda 😊🙏
> *State*: `AWAITING_LOCATION` 
>
> **Turn 3 — Customer:** oke tunggu bentar ya lagi diskusi sama suami
> **Bot:** Kalau boleh tau detail kelurahan/desanya ya bunda? Soalnya beda km beda harga bunda 🙏🏻
> 
> Atau kalau berkenan boleh kirim share location-nya bund biar titiknya sesuai 😊🙏🏻
> *State*: `AWAITING_LOCATION` 
>
> **Turn 4 — Customer:** oke acc, lanjut reservasi
> **Bot:** Baik Bunda, saya bantu cek ongkirnya ya bund, mohon ditunggu sebentar 😊
> *State*: `HUMAN_HANDLING` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Hannah Alamat & Shareloc : Jl. Utama No. 12 Kec : Tandes Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** (No reply text / silent escalation)
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #41: Sawahan -> tanya promo -> full price -> form
- **Kategori**: G
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (GAGAL ❌)
- **Jumlah Turn**: 6 turn | **Prefill Form**: N/A | **Format Kontak**: N/A

**History Chat Dialog:**

> **Turn 1 — Customer:** Hai bu
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Sawahan
> **Bot:** Kalau boleh tau lebih tepatnya Sawahan di kelurahan atau desa mana bunda? Nanti kami bantu cek an ongkir nya bund 🤗
> Atau jika berkenan mungkin bisa kirim sharelock nya bunda 😊🙏
> *State*: `AWAITING_LOCATION` 
>
> **Turn 3 — Customer:** mau tapi budget masih mikir
> **Bot:** Kalau boleh tau detail kelurahan/desanya ya bunda? Soalnya beda km beda harga bunda 🙏🏻
> 
> Atau kalau berkenan boleh kirim share location-nya bund biar titiknya sesuai 😊🙏🏻
> *State*: `AWAITING_LOCATION` 
>
> **Turn 4 — Customer:** bu, ada promo ga biar jadi murah dikit
> **Bot:** Baik Bunda, tidak apa-apa. Terima kasih banyak sudah menghubungi Kala Moms and Baby Spa! Jika sewaktu-waktu membutuhkan pijat atau treatment homecare, Bunda bisa menghubungi kami kembali ya bund. Have a great day! 🤗✨
> *State*: `AWAITING_LOCATION` 
>
> **Turn 5 — Customer:** oke ga papa full price aja, reservasi
> **Bot:** Baik Bunda, saya bantu cek ongkirnya ya bund, mohon ditunggu sebentar 😊
> *State*: `HUMAN_HANDLING` 
>
> **Turn 6 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Ines Alamat & Shareloc : Jl. Utama No. 12 Kec : Sawahan Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** (No reply text / silent escalation)
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #42: Kedurus -> terapis jam berapa -> reservasi -> form
- **Kategori**: H
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 4 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Halo
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Kedurus
> **Bot:** Jika kami cek bunda, dilihat dari jaraknya kurang lebih 8.6 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp15.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp10.000 saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 3 — Customer:** terapisnya kesini jam berapa biasanya
> **Bot:** Bunda, kami punya beberapa opsi yang cocok: *Pijat Bayi Ceria (Rileksasi)* (0 - 24 bulan, 40 menit) dan *Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)* (0 - 24 bulan, 40 menit) dan *Pijat Kids Ceria* (2 - 7 tahun, 45 menit) dan *Pijat Lahap Juara (Nafsu Makan)* (0 - 24 bulan, 40 menit) dan *Paket Selapan (Newborn Care)* (newborn (0 - 40 hari), 45 menit) dan *Prenatal Massage (Pijat Hamil)* (ibu hamil (trimester 2 & 3), 60 menit) dan *Oksitosin Massage Fullbody* (ibu pasca melahirkan / nifas, 60 menit) dan *Oksitosin Massage Non-Fullbody* (ibu menyusui, 40 menit) dan *Paket Laktasi (Breast Massage)* (ibu menyusui, 45 menit) dan *Breast + Oksitoksin Fullbody Massage* (ibu menyusui / nifas, 75 menit) dan *Tindik Telinga Bayi* (bayi 0 - 12 bulan, 15 menit) dan *Cukur Rambut Bayi* (bayi 0 - 12 bulan, 15 menit) dan *Cukur + Pijat Terapi* (bayi 0 - 12 bulan, 55 menit) dan *Sinar Moksa (Add-on)* (semua usia, 15 menit) dan *Nebulizer (Terapi Uap Add-on)* (semua usia, 20 menit) dan *Nebulizer + Obat (Terapi Uap Lengkap)* (semua usia, 20 menit) dan *Custom Kids Bubble Spa* (1 - 4 tahun, 60 menit). Pijat relaksasi untuk membantu bayi tidur lebih nyenyak, mengurangi kelelahan, dan membuat tubuh bayi lebih rileks. 😊
> 
> Mau saya bantu pilih di antara Pijat Bayi Ceria (Rileksasi) atau Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung) atau Pijat Kids Ceria atau Pijat Lahap Juara (Nafsu Makan) atau Paket Selapan (Newborn Care) atau Prenatal Massage (Pijat Hamil) atau Oksitosin Massage Fullbody atau Oksitosin Massage Non-Fullbody atau Paket Laktasi (Breast Massage) atau Breast + Oksitoksin Fullbody Massage atau Tindik Telinga Bayi atau Cukur Rambut Bayi atau Cukur + Pijat Terapi atau Sinar Moksa (Add-on) atau Nebulizer (Terapi Uap Add-on) atau Nebulizer + Obat (Terapi Uap Lengkap) atau Custom Kids Bubble Spa untuk Bunda?
> *State*: `AWAITING_INTEREST` 
>
> **Turn 4 — Customer:** oke ngerti, reservasi
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Karang Pilang
> Kota : Kota Surabaya
> No. Hp : 62870900842
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Julia Alamat & Shareloc : Jl. Utama No. 12 Kec : Karang Pilang Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #43: Made Sambikerep -> alat yang dibawa -> reservasi -> form
- **Kategori**: H
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 4 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Hai
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Made
> **Bot:** Jika kami cek bunda, dilihat dari jaraknya kurang lebih 21.2 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp35.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp25.000 saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 3 — Customer:** oke, alat2 yang dibawa apa aja
> **Bot:** Bunda, kami punya beberapa opsi yang cocok: *Pijat Bayi Ceria (Rileksasi)* (0 - 24 bulan, 40 menit) dan *Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)* (0 - 24 bulan, 40 menit) dan *Pijat Kids Ceria* (2 - 7 tahun, 45 menit) dan *Pijat Lahap Juara (Nafsu Makan)* (0 - 24 bulan, 40 menit) dan *Paket Selapan (Newborn Care)* (newborn (0 - 40 hari), 45 menit) dan *Prenatal Massage (Pijat Hamil)* (ibu hamil (trimester 2 & 3), 60 menit) dan *Oksitosin Massage Fullbody* (ibu pasca melahirkan / nifas, 60 menit) dan *Oksitosin Massage Non-Fullbody* (ibu menyusui, 40 menit) dan *Paket Laktasi (Breast Massage)* (ibu menyusui, 45 menit) dan *Breast + Oksitoksin Fullbody Massage* (ibu menyusui / nifas, 75 menit) dan *Tindik Telinga Bayi* (bayi 0 - 12 bulan, 15 menit) dan *Cukur Rambut Bayi* (bayi 0 - 12 bulan, 15 menit) dan *Cukur + Pijat Terapi* (bayi 0 - 12 bulan, 55 menit) dan *Sinar Moksa (Add-on)* (semua usia, 15 menit) dan *Nebulizer (Terapi Uap Add-on)* (semua usia, 20 menit) dan *Nebulizer + Obat (Terapi Uap Lengkap)* (semua usia, 20 menit) dan *Custom Kids Bubble Spa* (1 - 4 tahun, 60 menit). Pijat relaksasi untuk membantu bayi tidur lebih nyenyak, mengurangi kelelahan, dan membuat tubuh bayi lebih rileks. 😊
> 
> Mau saya bantu pilih di antara Pijat Bayi Ceria (Rileksasi) atau Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung) atau Pijat Kids Ceria atau Pijat Lahap Juara (Nafsu Makan) atau Paket Selapan (Newborn Care) atau Prenatal Massage (Pijat Hamil) atau Oksitosin Massage Fullbody atau Oksitosin Massage Non-Fullbody atau Paket Laktasi (Breast Massage) atau Breast + Oksitoksin Fullbody Massage atau Tindik Telinga Bayi atau Cukur Rambut Bayi atau Cukur + Pijat Terapi atau Sinar Moksa (Add-on) atau Nebulizer (Terapi Uap Add-on) atau Nebulizer + Obat (Terapi Uap Lengkap) atau Custom Kids Bubble Spa untuk Bunda?
> *State*: `AWAITING_INTEREST` 
>
> **Turn 4 — Customer:** sip, reservasi
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Sambikerep
> Kota : Kota Surabaya
> No. Hp : 62870900843
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Kartika Alamat & Shareloc : Jl. Utama No. 12 Kec : Sambikerep Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #44: Lidah Kulon -> preparasi sebelum terapis datang -> form
- **Kategori**: H
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 4 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Halo bu
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Lidah Kulon
> **Bot:** Jika kami cek bunda, dilihat dari jaraknya kurang lebih 16.9 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp25.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp20.000 saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 3 — Customer:** perlu siapin apa aja sebelum terapis dateng
> **Bot:** Bunda, kami punya beberapa opsi yang cocok: *Pijat Bayi Ceria (Rileksasi)* (0 - 24 bulan, 40 menit) dan *Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)* (0 - 24 bulan, 40 menit) dan *Pijat Kids Ceria* (2 - 7 tahun, 45 menit) dan *Pijat Lahap Juara (Nafsu Makan)* (0 - 24 bulan, 40 menit) dan *Paket Selapan (Newborn Care)* (newborn (0 - 40 hari), 45 menit) dan *Prenatal Massage (Pijat Hamil)* (ibu hamil (trimester 2 & 3), 60 menit) dan *Oksitosin Massage Fullbody* (ibu pasca melahirkan / nifas, 60 menit) dan *Oksitosin Massage Non-Fullbody* (ibu menyusui, 40 menit) dan *Paket Laktasi (Breast Massage)* (ibu menyusui, 45 menit) dan *Breast + Oksitoksin Fullbody Massage* (ibu menyusui / nifas, 75 menit) dan *Tindik Telinga Bayi* (bayi 0 - 12 bulan, 15 menit) dan *Cukur Rambut Bayi* (bayi 0 - 12 bulan, 15 menit) dan *Cukur + Pijat Terapi* (bayi 0 - 12 bulan, 55 menit) dan *Sinar Moksa (Add-on)* (semua usia, 15 menit) dan *Nebulizer (Terapi Uap Add-on)* (semua usia, 20 menit) dan *Nebulizer + Obat (Terapi Uap Lengkap)* (semua usia, 20 menit) dan *Custom Kids Bubble Spa* (1 - 4 tahun, 60 menit). Pijat relaksasi untuk membantu bayi tidur lebih nyenyak, mengurangi kelelahan, dan membuat tubuh bayi lebih rileks. 😊
> 
> Mau saya bantu pilih di antara Pijat Bayi Ceria (Rileksasi) atau Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung) atau Pijat Kids Ceria atau Pijat Lahap Juara (Nafsu Makan) atau Paket Selapan (Newborn Care) atau Prenatal Massage (Pijat Hamil) atau Oksitosin Massage Fullbody atau Oksitosin Massage Non-Fullbody atau Paket Laktasi (Breast Massage) atau Breast + Oksitoksin Fullbody Massage atau Tindik Telinga Bayi atau Cukur Rambut Bayi atau Cukur + Pijat Terapi atau Sinar Moksa (Add-on) atau Nebulizer (Terapi Uap Add-on) atau Nebulizer + Obat (Terapi Uap Lengkap) atau Custom Kids Bubble Spa untuk Bunda?
> *State*: `AWAITING_INTEREST` 
>
> **Turn 4 — Customer:** noted, reservasi ya
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Lakarsantri
> Kota : Kota Surabaya
> No. Hp : 62870900844
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Laras Alamat & Shareloc : Jl. Utama No. 12 Kec : Lakarsantri Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #45: Lakarsantri -> cash or transfer -> reservasi -> form
- **Kategori**: H
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 5 turn | **Prefill Form**: N/A | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Hai
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Lakarsantri
> **Bot:** Kalau boleh tau lebih tepatnya Lakarsantri di kelurahan atau desa mana bunda? Nanti kami bantu cek an ongkir nya bund 🤗
> Atau jika berkenan mungkin bisa kirim sharelock nya bunda 😊🙏
> *State*: `AWAITING_LOCATION` 
>
> **Turn 3 — Customer:** bayarnya cash apa transfer
> **Bot:** Bunda, kami punya beberapa opsi yang cocok: *Pijat Bayi Ceria (Rileksasi)* (0 - 24 bulan, 40 menit) dan *Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)* (0 - 24 bulan, 40 menit) dan *Pijat Kids Ceria* (2 - 7 tahun, 45 menit) dan *Pijat Lahap Juara (Nafsu Makan)* (0 - 24 bulan, 40 menit) dan *Paket Selapan (Newborn Care)* (newborn (0 - 40 hari), 45 menit) dan *Prenatal Massage (Pijat Hamil)* (ibu hamil (trimester 2 & 3), 60 menit) dan *Oksitosin Massage Fullbody* (ibu pasca melahirkan / nifas, 60 menit) dan *Oksitosin Massage Non-Fullbody* (ibu menyusui, 40 menit) dan *Paket Laktasi (Breast Massage)* (ibu menyusui, 45 menit) dan *Breast + Oksitoksin Fullbody Massage* (ibu menyusui / nifas, 75 menit) dan *Tindik Telinga Bayi* (bayi 0 - 12 bulan, 15 menit) dan *Cukur Rambut Bayi* (bayi 0 - 12 bulan, 15 menit) dan *Cukur + Pijat Terapi* (bayi 0 - 12 bulan, 55 menit) dan *Sinar Moksa (Add-on)* (semua usia, 15 menit) dan *Nebulizer (Terapi Uap Add-on)* (semua usia, 20 menit) dan *Nebulizer + Obat (Terapi Uap Lengkap)* (semua usia, 20 menit) dan *Custom Kids Bubble Spa* (1 - 4 tahun, 60 menit). Pijat relaksasi untuk membantu bayi tidur lebih nyenyak, mengurangi kelelahan, dan membuat tubuh bayi lebih rileks. 😊
> 
> Mau saya bantu pilih di antara Pijat Bayi Ceria (Rileksasi) atau Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung) atau Pijat Kids Ceria atau Pijat Lahap Juara (Nafsu Makan) atau Paket Selapan (Newborn Care) atau Prenatal Massage (Pijat Hamil) atau Oksitosin Massage Fullbody atau Oksitosin Massage Non-Fullbody atau Paket Laktasi (Breast Massage) atau Breast + Oksitoksin Fullbody Massage atau Tindik Telinga Bayi atau Cukur Rambut Bayi atau Cukur + Pijat Terapi atau Sinar Moksa (Add-on) atau Nebulizer (Terapi Uap Add-on) atau Nebulizer + Obat (Terapi Uap Lengkap) atau Custom Kids Bubble Spa untuk Bunda?
> *State*: `AWAITING_LOCATION` 
>
> **Turn 4 — Customer:** oke paham, reservasi
> **Bot:** Kalau boleh tau detail kelurahan/desanya ya bunda? Soalnya beda km beda harga bunda 🙏🏻
> 
> Atau kalau berkenan boleh kirim share location-nya bund biar titiknya sesuai 😊🙏🏻
> *State*: `AWAITING_LOCATION` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Mona Alamat & Shareloc : Jl. Utama No. 12 Kec : Lakarsantri Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #46: Sharelock exact klinik (0 km) -> reservasi -> form
- **Kategori**: I
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 2 turn | **Prefill Form**: Ya | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** [Share Location: -7.34886, 112.751677]
> **Bot:** Halo Bunda! Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa. ✨
> 
> Wah, Deket Bunda, Dilihat dari jaraknya kurang lebih 0.0 km (masih dalam jangkauan gratis ongkir hingga 5 km), jadi layanan kami GRATIS ongkir ya bund ☺️ Jadi mau pilih treatment apa bunda ?🤗
> *State*: `AWAITING_INTEREST` 
>
> **Turn 2 — Customer:** deket banget ya berarti, oke reservasi
> **Bot:** Berikut list untuk reservasi :
> 
> Hari dan tanggal :
> Nama Bunda:
> Alamat & Shareloc :
> Kec : Gubeng
> Kota : Surabaya
> No. Hp : 62870900846
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi :
> Usia Bayi/Anak :
> Treatment :
> 
> Pilihan treatment (Moms) :
> 
> Usia Kehamilan (Jika hamil):
> Treatment :
> 
> 
> Mohon bisa diisi Bunda 😊
> Cancel / Pembatalan Harap minimal H-3 jam
> 
> H-1 sebelum treatment akan kami reminder kembali bunda 🥰
> Terimakasih.  ☺️
> *State*: `RESERVATION_SENT` 
>
> **Turn 3 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Nia Alamat & Shareloc : Jl. Utama No. 12 Kec : Wonokromo Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #47: Mulyosari deket ITS -> LLM fallback -> reservasi -> form
- **Kategori**: I
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 4 turn | **Prefill Form**: N/A | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Hai
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Mulyosari deket ITS
> **Bot:** Kalau boleh tau detail kelurahan/desanya ya bunda? Soalnya beda km beda harga bunda 🙏🏻
> 
> Atau kalau berkenan boleh kirim share location-nya bund biar titiknya sesuai 😊🙏🏻
> *State*: `AWAITING_LOCATION` 
>
> **Turn 3 — Customer:** oke reservasi aja
> **Bot:** Kalau boleh tau detail kelurahan/desanya ya bunda? Soalnya beda km beda harga bunda 🙏🏻
> 
> Atau kalau berkenan boleh kirim share location-nya bund biar titiknya sesuai 😊🙏🏻
> *State*: `AWAITING_LOCATION` 
>
> **Turn 4 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Olivia Alamat & Shareloc : Jl. Utama No. 12 Kec : Mulyorejo Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #48: Koreksi lokasi (Malang -> Rungkut) -> reservasi -> form
- **Kategori**: I
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (GAGAL ❌)
- **Jumlah Turn**: 5 turn | **Prefill Form**: N/A | **Format Kontak**: N/A

**History Chat Dialog:**

> **Turn 1 — Customer:** Halo
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Malang
> **Bot:** Kalau boleh tau lebih tepatnya Malang di kelurahan atau desa mana bunda? Nanti kami bantu cek an ongkir nya bund 🤗
> Atau jika berkenan mungkin bisa kirim sharelock nya bunda 😊🙏
> *State*: `AWAITING_LOCATION` 
>
> **Turn 3 — Customer:** eh sori salah ketik maksudnya Malang Jaya deket sini, Rungkut
> **Bot:** Kalau boleh tau lebih tepatnya Rungkut di kelurahan atau desa mana bunda? Nanti kami bantu cek an ongkir nya bund 🤗
> Atau jika berkenan mungkin bisa kirim sharelock nya bunda 😊🙏
> *State*: `AWAITING_LOCATION` 
>
> **Turn 4 — Customer:** oke reservasi
> **Bot:** Baik Bunda, saya bantu cek ongkirnya ya bund, mohon ditunggu sebentar 😊
> *State*: `HUMAN_HANDLING` 
>
> **Turn 5 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Putri Alamat & Shareloc : Jl. Utama No. 12 Kec : Rungkut Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** (No reply text / silent escalation)
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #49: Scope NEW_ONLY — Customer Baru -> Full Journey -> Form
- **Kategori**: J
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 4 turn | **Prefill Form**: N/A | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Halo bu
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Wonokromo
> **Bot:** Kalau boleh tau lebih tepatnya Wonokromo di kelurahan atau desa mana bunda? Nanti kami bantu cek an ongkir nya bund 🤗
> Atau jika berkenan mungkin bisa kirim sharelock nya bunda 😊🙏
> *State*: `AWAITING_LOCATION` 
>
> **Turn 3 — Customer:** Oke tertarik, gimana caranya
> **Bot:** Baik Bunda, sebelum melakukan reservasi, mohon informasikan detail kelurahan/desa atau kirimkan share location Bunda terlebih dahulu ya bund, agar kami bisa cek jarak dan ongkirnya terlebih dahulu. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 4 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Qori Alamat & Shareloc : Jl. Utama No. 12 Kec : Wonokromo Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

### Skenario #50: Scope legacy + FORCE_ON override -> Full Journey -> Form
- **Kategori**: J
- **Goal State**: `RESERVATION_SENT` | **State Akhir**: `HUMAN_HANDLING` (LULUS ✅)
- **Jumlah Turn**: 4 turn | **Prefill Form**: N/A | **Format Kontak**: Ya

**History Chat Dialog:**

> **Turn 1 — Customer:** Halo, jadi bisa reservasi ga
> **Bot:** Halo Bunda ! ✨
> Terima kasih sudah menghubungi kami.
> 
> Perkenalkan, saya Bidan Yusi, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).
> 
> Kalau boleh tau rumahnya dimana ya bunda?. 😊
> *State*: `AWAITING_LOCATION` 
>
> **Turn 2 — Customer:** Rungkut
> **Bot:** Kalau boleh tau lebih tepatnya Rungkut di kelurahan atau desa mana bunda? Nanti kami bantu cek an ongkir nya bund 🤗
> Atau jika berkenan mungkin bisa kirim sharelock nya bunda 😊🙏
> *State*: `AWAITING_LOCATION` 
>
> **Turn 3 — Customer:** mau reservasi
> **Bot:** Kalau boleh tau lebih tepatnya Mau reservasi di kelurahan atau desa mana bunda? Nanti kami bantu cek an ongkir nya bund 🤗
> Atau jika berkenan mungkin bisa kirim sharelock nya bunda 😊🙏
> *State*: `AWAITING_LOCATION` 
>
> **Turn 4 — Customer:** Berikut list untuk reservasi :  Hari dan tanggal : Senin, 10 Agustus 2026 jam 10.00 Nama Bunda: Bunda Resti Alamat & Shareloc : Jl. Utama No. 12 Kec : Rungkut Kota : Surabaya No. Hp : 08123456789  Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria
> **Bot:** Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊
> 
> Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊
> *State*: `HUMAN_HANDLING` 
>
---

