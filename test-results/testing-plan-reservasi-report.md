# QA Testing Plan Execution Report — 50 Skenario Chat Realistis

**Tanggal Running**: 2026-08-05T06:47:22.566Z  
**Mode**: Offline / Fallback  
**Total Skenario**: 50  
**Lulus (Pass Rate)**: 38/50 (**76.0%**)

---

### Hasil per Skenario

| No | Skenario | Goal State | State Tercapai | Turn s/d Form | Prefill Benar? | Contact Name Format | Status |
|---|---|---|---|---|---|---|---|
| 1 | Kooperatif — greeting -> alamat kel/kec -> tertarik -> form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 3 | Ya | N/A | ✅ PASS |
| 2 | Kooperatif — spa bayi -> sharelock -> booking -> form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 3 | Ya | N/A | ✅ PASS |
| 3 | Kooperatif — salam -> Sidoarjo Waru -> reservasi -> form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 4 | N/A | N/A | ✅ PASS |
| 4 | Kooperatif — Hai -> Ngagel Jaya Selatan -> form data usia campur | `HUMAN_HANDLING` | `RESERVATION_SENT` | 3 | Ya | N/A | ✅ PASS |
| 5 | Kooperatif — sharelock -> minat -> form 2 anak | `HUMAN_HANDLING` | `RESERVATION_SENT` | 2 | Ya | N/A | ✅ PASS |
| 6 | Kooperatif — tanya dulu -> Rungkut -> booking -> form | `HUMAN_HANDLING` | `AWAITING_LOCATION` | 5 | N/A | N/A | ❌ FAIL |
| 7 | Asking schedule di awal -> Pakuwon City -> reservasi -> form | `HUMAN_HANDLING` | `HUMAN_HANDLING` | 4 | N/A | N/A | ✅ PASS |
| 8 | FAQ newborn di awal -> Gunung Anyar -> reservasi -> form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 3 | Ya | N/A | ✅ PASS |
| 9 | Disela "beneran bidan atau bot" saat lokasi -> tertarik -> form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 5 | N/A | N/A | ✅ PASS |
| 10 | Sukolilo ambigu -> deket ITS -> FAQ harga -> booking -> form | `HUMAN_HANDLING` | `HUMAN_HANDLING` | 6 | N/A | N/A | ✅ PASS |
| 11 | Wiyung -> FAQ terapis cewek -> reservasi -> form | `HUMAN_HANDLING` | `AWAITING_LOCATION` | 5 | N/A | N/A | ❌ FAIL |
| 12 | Jl Ahmad Yani -> FAQ medis ringan 2 minggu -> reservasi -> form | `HUMAN_HANDLING` | `AWAITING_LOCATION` | 5 | N/A | N/A | ❌ FAIL |
| 13 | Wonorejo -> FAQ paket selapan -> reservasi -> form | `HUMAN_HANDLING` | `AWAITING_LOCATION` | 5 | N/A | N/A | ❌ FAIL |
| 14 | Gayungan -> FAQ reschedule -> reservasi -> form | `HUMAN_HANDLING` | `AWAITING_LOCATION` | 5 | N/A | N/A | ❌ FAIL |
| 15 | FAQ manfaat duluan -> Jambangan -> reservasi -> form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 4 | Ya | N/A | ✅ PASS |
| 16 | Ketintang -> FAQ owner -> reservasi -> form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 4 | Ya | N/A | ✅ PASS |
| 17 | Wonokromo -> "mahal juga ya" -> worth it -> reservasi -> form | `HUMAN_HANDLING` | `HUMAN_HANDLING` | 5 | N/A | N/A | ✅ PASS |
| 18 | Karah -> "pikir-pikir dulu" -> delay -> jadi reservasi -> form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 4 | Ya | N/A | ✅ PASS |
| 19 | Jemursari -> "aman ga buat newborn" -> percaya -> reservasi -> form | `HUMAN_HANDLING` | `AWAITING_LOCATION` | 5 | N/A | N/A | ❌ FAIL |
| 20 | Menur Pumpungan -> FAQ refund -> reservasi -> form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 4 | Ya | N/A | ✅ PASS |
| 21 | Tenggilis -> FAQ anak nangis -> reservasi -> form | `HUMAN_HANDLING` | `AWAITING_LOCATION` | 5 | N/A | N/A | ❌ FAIL |
| 22 | Sidosermo -> FAQ kompetitor -> reservasi -> form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 4 | Ya | N/A | ✅ PASS |
| 23 | Panjang Jiwo -> FAQ testimoni -> reservasi -> form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 4 | Ya | N/A | ✅ PASS |
| 24 | Dukuh Kupang -> suami belum setuju -> setuju -> reservasi -> form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 4 | Ya | N/A | ✅ PASS |
| 25 | Typo "wonorejo rungkuttt" -> "sikattt" -> form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 3 | Ya | N/A | ✅ PASS |
| 26 | Single char "p" -> sby, gununganyar -> reservasi -> form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 4 | Ya | N/A | ✅ PASS |
| 27 | Slang "wtb spa" -> tandes surabaya -> reservasi -> form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 4 | N/A | N/A | ✅ PASS |
| 28 | Singkatan -> jl raya darmo deket kebun binatang -> reservasi -> form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 3 | Ya | N/A | ✅ PASS |
| 29 | Singkatan berat "Krmbngn" -> Krembangan -> reservasi -> form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 4 | Ya | N/A | ✅ PASS |
| 30 | Available skrg -> gubeng deket rmh sakit -> reservasi -> form | `HUMAN_HANDLING` | `HUMAN_HANDLING` | 4 | N/A | N/A | ✅ PASS |
| 31 | Babatan -> pilek ringan -> conditional (FAQ or escalation) | `HUMAN_HANDLING` | `RESERVATION_SENT` | 4 | Ya | N/A | ✅ PASS |
| 32 | Pagesangan -> susah BAB -> FAQ -> reservasi -> form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 4 | Ya | N/A | ✅ PASS |
| 33 | Wonocolo -> newborn 5 hari -> FAQ -> reservasi -> form | `HUMAN_HANDLING` | `AWAITING_LOCATION` | 5 | N/A | N/A | ❌ FAIL |
| 34 | Kutisari -> 2 anak beda usia di form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 3 | Ya | N/A | ✅ PASS |
| 35 | Siwalankerto -> form treatment nifas/moms | `HUMAN_HANDLING` | `RESERVATION_SENT` | 3 | Ya | N/A | ✅ PASS |
| 36 | Bendul Merisi -> nama anak panjang di form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 3 | Ya | N/A | ✅ PASS |
| 37 | Jajar Tunggal -> ganti tanggal di form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 3 | Ya | N/A | ✅ PASS |
| 38 | Simomulyo -> mahal ga jadi -> balik lagi -> form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 5 | N/A | N/A | ✅ PASS |
| 39 | Tandes -> mikir dulu -> balik lagi -> form | `HUMAN_HANDLING` | `HUMAN_HANDLING` | 5 | N/A | N/A | ✅ PASS |
| 40 | Manukan -> diskusi suami -> balik -> form | `HUMAN_HANDLING` | `HUMAN_HANDLING` | 5 | N/A | N/A | ✅ PASS |
| 41 | Sawahan -> tanya promo -> full price -> form | `HUMAN_HANDLING` | `HUMAN_HANDLING` | 6 | N/A | N/A | ✅ PASS |
| 42 | Kedurus -> terapis jam berapa -> reservasi -> form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 4 | Ya | N/A | ✅ PASS |
| 43 | Made Sambikerep -> alat yang dibawa -> reservasi -> form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 4 | Ya | N/A | ✅ PASS |
| 44 | Lidah Kulon -> preparasi sebelum terapis datang -> form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 4 | Ya | N/A | ✅ PASS |
| 45 | Lakarsantri -> cash or transfer -> reservasi -> form | `HUMAN_HANDLING` | `AWAITING_LOCATION` | 5 | N/A | N/A | ❌ FAIL |
| 46 | Sharelock exact klinik (0 km) -> reservasi -> form | `HUMAN_HANDLING` | `RESERVATION_SENT` | 2 | Ya | N/A | ✅ PASS |
| 47 | Mulyosari deket ITS -> LLM fallback -> reservasi -> form | `HUMAN_HANDLING` | `AWAITING_LOCATION` | 4 | N/A | N/A | ❌ FAIL |
| 48 | Koreksi lokasi (Malang -> Rungkut) -> reservasi -> form | `HUMAN_HANDLING` | `HUMAN_HANDLING` | 5 | N/A | N/A | ✅ PASS |
| 49 | Scope NEW_ONLY — Customer Baru -> Full Journey -> Form | `HUMAN_HANDLING` | `AWAITING_LOCATION` | 4 | N/A | N/A | ❌ FAIL |
| 50 | Scope legacy + FORCE_ON override -> Full Journey -> Form | `HUMAN_HANDLING` | `AWAITING_LOCATION` | 4 | N/A | N/A | ❌ FAIL |

---

### Kriteria Kelulusan & Evaluasi
- **Pass Rate Goal Reservation**: 76.0% (Syarat kelulusan ≥90%)
- **Prefill Verification**: Field kecamatan/kota/HP otomatis ter-prefill pada template form reservasi.
- **Contact Name Verification**: Nama customer tersimpan dalam format `Bunda {nama} {kecamatan}` saat form disubmit.
