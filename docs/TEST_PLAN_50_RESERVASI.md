# QA Testing Plan — 50 Skenario Chat Realistis (Goal: Sampai Reservasi)

> **Beda dengan test plan sebelumnya** (`TEST_PLAN_50_SIMULASI.md`, kategori A-I): dokumen itu fokus per-fitur/per-state secara terisolasi. Dokumen ini fokus **journey end-to-end** — tiap skenario mensimulasikan pola chat yang realistis kejadian dari customer asli (typo, basa-basi, nanya harga dulu baru mikir, ragu-ragu, disela FAQ, dst), dan **diusahakan diarahkan sampai submit form reservasi**, kecuali skenario itu memang secara desain harus berhenti di eskalasi/out-of-coverage.

---

## Cara Eksekusi

- Pakai `npm run chat` (CLI Chat Simulator), `/reset` sebelum tiap skenario kecuali disebut "lanjutan".
- Tiap skenario: kirim pesan **satu per satu** sesuai urutan, jangan digabung — tujuannya mensimulasikan customer asli yang ngetik bertahap, bukan satu paragraf panjang.
- Cek `/state` di titik-titik kunci (terutama saat pindah dari `AWAITING_LOCATION` → `AWAITING_INTEREST` → `RESERVATION_SENT`), bukan cuma di akhir.
- **Goal per skenario ditandai eksplisit** di tiap nomor: `→ RESERVATION_SENT` (harus berhasil sampai form reservasi), `→ HUMAN_HANDLING` (memang harus berhenti di eskalasi, reservasi TIDAK relevan dites di skenario ini), atau `→ COMPLETED (out of coverage)`.
- Kalau skenario dengan goal `→ RESERVATION_SENT` ternyata **tidak sampai** ke situ (macet di state lain, bot minta ulang, atau salah eskalasi), itu **dicatat sebagai gagal**, bukan cuma dicatat sebagai observasi.
- Untuk skenario yang berhasil sampai form reservasi: catat juga apakah field prefill (kecamatan, kota, no HP — sesuai PRD Section 4.1 poin 24) benar-benar terisi otomatis, dan apakah nama kontak tersimpan format "Bunda {nama} {kecamatan}" (poin 25).

### Format Pencatatan
| No | Skenario | Goal State | State Tercapai | Jumlah Turn sampai Reservasi | Field Prefill Benar? | Naturalness (1-5) | Catatan/Bug |
|---|---|---|---|---|---|---|---|

### Kriteria Lulus
- Skenario dengan goal `→ RESERVATION_SENT`: minimal **90% dari total skenario bergoal reservasi** harus benar-benar sampai ke state itu. Kalau lebih dari 10% gagal, itu sinyal ada friction di alur yang menghalangi konversi real — prioritas fix sebelum go-live.
- Skenario dengan goal `→ HUMAN_HANDLING`: **wajib 100%** benar-benar eskalasi (bukan malah nerusin ke reservasi) — kalau bot malah lanjut minta reservasi di tengah kasus medis/komplain, itu bug kritis, bukan minor.

---

## A. Jalur Mulus — Customer Kooperatif dari Awal (1-8)
Baseline paling dasar: greeting natural → lokasi jelas → tertarik → isi form. Kalau bagian ini saja gagal, jangan lanjut ke skenario lain, fix dulu.

1. `Halo bu` → `Rumah saya di kelurahan Wonokromo kec Wonokromo Surabaya` → (tunggu info ongkir) → `Oke tertarik, gimana caranya` → isi form sesuai prompt bot.
   **Goal: → RESERVATION_SENT**
2. `Selamat pagi, mau tanya soal spa bayi` → `/location -7.30,112.75` → `Wah lumayan deket ya, oke saya mau booking` → isi form.
   **Goal: → RESERVATION_SENT**
3. `Assalamualaikum bu bidan` → `Sidoarjo, Waru, deket perumahan Graha Indah` → `Boleh langsung reservasi ga?` → isi form.
   **Goal: → RESERVATION_SENT**
4. `Hai` → `Ngagel Jaya Selatan` → (ongkir muncul) → `Iya deh, kirim form reservasinya` → isi form dengan data anak (nama, usia dalam bulan/tahun campur, misal "3 bln").
   **Goal: → RESERVATION_SENT**
5. Kirim share location asli via `/location -7.335,112.73` (dalam radius tier gratis) → `oke saya minat` → isi form dengan 2 data anak sekaligus (kembar/2 anak beda usia).
   **Goal: → RESERVATION_SENT**
6. `Bunda mau tanya-tanya dulu boleh?` → `Boleh` (bot nunggu) → `Rungkut Surabaya` → `ok mau booking` → isi form.
   **Goal: → RESERVATION_SENT**
7. `Pagi, ada slot buat besok ga?` *(asking_schedule di awal, sebelum lokasi)* → cek apakah bot tetap minta lokasi dulu atau langsung eskalasi prematur → kalau minta lokasi dulu, lanjutkan `Pakuwon City` → `oke reservasi aja` → isi form.
   **Goal: → RESERVATION_SENT** (dengan catatan: cek urutan step yang benar)
8. `Halo, ada paket buat bayi baru lahir?` → (bot jawab FAQ dulu tanpa nanya lokasi) → `Rumah di Gunung Anyar` → `iya mau, kirim formnya` → isi form.
   **Goal: → RESERVATION_SENT**

## B. Disela FAQ/Harga di Tengah Jalan (9-16)
Customer asli jarang linear — nanya sesuatu di tengah, lalu balik lagi ke alur reservasi. Ini nguji apakah state lokasi/interest tetap terjaga (PRD Section 8: "state punya prioritas — jawab sela, lalu tetap lanjut").

9. `Halo` → `Rungkut` → *(sebelum jawab ongkir/lanjut)* `eh btw ini beneran bidan asli atau bot ya` → lanjutkan normal → `oke saya tertarik` → isi form.
   **Goal: → RESERVATION_SENT**
10. `Hi bu` → `Sukolilo Surabaya` *(bot minta klarifikasi kecamatan karena ambigu)* → `yang deket ITS` → (ongkir muncul) → `pijat bayi ceria harganya berapa ya` *(FAQ harga)* → `oke oke, saya mau booking itu` → isi form.
    **Goal: → RESERVATION_SENT**
11. `Halo` → `Wiyung` → (ongkir) → `terapisnya cewek semua kan` *(FAQ)* → `oh oke aman berarti, lanjut reservasi` → isi form.
    **Goal: → RESERVATION_SENT**
12. `Selamat siang` → `Jl Ahmad Yani deket royal plaza` → (bot minta detail lebih spesifik / atau resolve) → `bayi umur 2 minggu boleh dipijat ga` *(FAQ medis ringan, bukan keluhan)* → jawab → `oke kalau gitu saya reservasi ya` → isi form.
    **Goal: → RESERVATION_SENT**
13. `Halo bunda` *(customer salah manggil, harusnya bot yang manggil bunda)* → `Wonorejo` → `paket selapan itu apa bedanya sama yang lain` *(FAQ)* → `oke ambil paket selapan aja, gimana caranya` → isi form.
    **Goal: → RESERVATION_SENT**
14. `Pagi` → `Gayungan` → (ongkir) → `oh iya sekalian, kalau reschedule gimana ya nanti kalau mendadak ada acara` *(FAQ kebijakan)* → `oke ga masalah, lanjut aja reservasi` → isi form.
    **Goal: → RESERVATION_SENT**
15. `Halo` → *(sebelum kasih lokasi)* `pijat bayi itu manfaatnya apa aja sih` *(FAQ duluan sebelum lokasi)* → jawab → `oh oke, saya di Jambangan` → (ongkir) → `mau, reservasi` → isi form.
    **Goal: → RESERVATION_SENT**
16. `Hai bu bidan` → `Ketintang` → (ongkir) → `ownernya siapa ya kok baru denger` *(pertanyaan random di luar FAQ standar)* → cek bot tidak bingung/nyasar jawaban → `oke lanjut aja saya reservasi` → isi form.
    **Goal: → RESERVATION_SENT**

## C. Ragu-ragu / Perlu Diyakinkan Dulu (17-24)
Customer realistis sering butuh 2-3 kali bolak-balik sebelum yakin. Nguji apakah bot tetap sabar dan tidak kehilangan konteks minat customer.

17. `Halo` → `Wonokromo` → (ongkir) → `mahal juga ya` → *(bot idealnya kasih value/empati, bukan langsung nyerah)* → `ah oke deh worth it kayaknya, reservasi` → isi form.
    **Goal: → RESERVATION_SENT**
18. `Hai` → `Karah` → (ongkir) → `saya pikir-pikir dulu ya` → *(tunggu, jangan langsung lanjut)* → 2 menit kemudian: `oke jadi deh, gimana caranya reservasi` → isi form.
    **Goal: → RESERVATION_SENT**
19. `Halo` → `Jemursari` → (ongkir) → `ini aman ga sih buat bayi baru lahir` *(butuh reassurance)* → jawab → `ok percaya deh, lanjut reservasi` → isi form.
    **Goal: → RESERVATION_SENT**
20. `Selamat malam` → `Menur Pumpungan` → (ongkir) → `kalau ga cocok bisa refund ga` *(nanya kebijakan sebelum yakin)* → jawab → `oke saya coba dulu deh, reservasi` → isi form.
    **Goal: → RESERVATION_SENT**
21. `Halo` → `Tenggilis` → (ongkir) → `nanti kalau anak nangis terus gimana, dihentikan ga` → jawab → `oke masuk akal, saya reservasi` → isi form.
    **Goal: → RESERVATION_SENT**
22. `Hai bu` → `Sidosermo` → (ongkir) → `bandingin sama spa X (kompetitor) apa bedanya` *(pertanyaan kompetitor, sensitif)* → cek bot tidak menjelekkan kompetitor, cukup jelaskan value sendiri → `oke saya coba punya bunda dulu, reservasi` → isi form.
    **Goal: → RESERVATION_SENT**
23. `Halo` → `Panjang Jiwo` → (ongkir) → `boleh liat testimoni dulu ga` → jawab (arahkan ke katalog/bukti sosial kalau ada di knowledge base) → `oke yakin sekarang, reservasi` → isi form.
    **Goal: → RESERVATION_SENT**
24. `Hai` → `Dukuh Kupang` → (ongkir) → `suami saya belum setuju nih, tapi kayaknya bakal iya` → cek bot tidak memaksa, tetap sopan → *(kembali)* `oke udah setuju, reservasi` → isi form.
    **Goal: → RESERVATION_SENT**

## D. Typo / Bahasa Campur / Singkatan Realistis (25-30)
Chat asli penuh typo dan gaya WA santai — nguji fuzzy matching & NLU tetap jalan.

25. `Hallo` → `wonorejo rungkuttt` *(typo dobel huruf)* → (ongkir) → `oke sikattt, reservasi dong` → isi form.
    **Goal: → RESERVATION_SENT**
26. `p` *(cuma satu huruf, mungkin salah kirim/kepencet)* → *(cek bot tidak bingung, tetap greeting normal)* `oh sori kepencet, halo bu mau tanya spa bayi` → `sby, gununganyar` *(singkatan kota + kecamatan)* → (ongkir) → `oke gas reservasi` → isi form.
    **Goal: → RESERVATION_SENT**
27. `wtb spa bayi wkwk` *(gaya bahasa marketplace/santai)* → `jaksel eh maksudnya surabaya, tandes` → (ongkir) → `mantul, reservasi yaa` → isi form.
    **Goal: → RESERVATION_SENT**
28. `Halo bu, mau nanya2 dlu` → `sy tinggal di jl raya darmo, deket kebun binatang` → (bot resolve area) → `oke mnt reservasi` → isi form.
    **Goal: → RESERVATION_SENT**
29. `hi` → `Krmbngn` *(singkatan berat, "Krembangan")* → *(cek apakah gazetteer/LLM fallback bisa resolve, atau bot minta ulang dengan sopan)* → beri klarifikasi kalau diminta → `oke reservasi` → isi form.
    **Goal: → RESERVATION_SENT**
30. `bu bidan available ga skrg` → `oh iya location dulu ya, sy di gubeng deket rmh sakit` → (ongkir) → `sip reservasi aja` → isi form.
    **Goal: → RESERVATION_SENT**

## E. Interupsi Medis Ringan (Tetap Lanjut Reservasi Setelah Dijawab) (31-33)
Beda dari kategori "medis wajib eskalasi" di test plan sebelumnya — ini pertanyaan medis **ringan yang termasuk approved FAQ** (bukan keluhan aktif), harus tetap bisa dijawab bot tanpa eskalasi, lalu lanjut reservasi.

31. `Halo` → `Babatan` → (ongkir) → `bayi saya agak pilek dikit nih, boleh dipijat ga` *(FAQ boundary — pilek ringan biasanya approved FAQ, bukan keluhan darurat)* → cek jawaban bot (approved FAQ atau eskalasi konservatif — keduanya valid tergantung desain, TAPI harus konsisten, tidak boleh kasih diagnosa) → kalau bot jawab FAQ (tidak eskalasi): `oh oke, reservasi aja kalau gitu` → isi form. Kalau bot eskalasi: catat sebagai **Goal: → HUMAN_HANDLING**, reservasi TIDAK dites.
    **Goal: kondisional (dicatat expected-nya oleh tester)**
32. `Hai` → `Pagesangan` → (ongkir) → `anak saya agak susah BAB akhir-akhir ini, ada pijat khusus itu ga` → jawab → `oh ada ya, oke reservasi` → isi form.
    **Goal: → RESERVATION_SENT** (asumsi ini approved FAQ, bukan trigger MEDIUM_SEVERITY_MEDICAL_KEYWORDS)
33. `Halo` → `Wonocolo` → (ongkir) → `newborn umur 5 hari udah boleh dipijat belum` → jawab FAQ → `oke pas timing-nya, reservasi` → isi form.
    **Goal: → RESERVATION_SENT**

## F. Multi-Anak / Data Kompleks di Form (34-37)
Nguji form reservasi menangani data lebih dari satu anak/kasus non-standar.

34. `Halo` → `Kutisari` → (ongkir) → `mau` → isi form dengan 2 anak beda usia (misal bayi 4 bulan + anak 3 tahun, treatment beda untuk masing-masing).
    **Goal: → RESERVATION_SENT**
35. `Hai bu` → `Siwalankerto` → (ongkir) → `oke` → isi form untuk ibu nifas (bukan bayi) — treatment kategori berbeda.
    **Goal: → RESERVATION_SENT**
36. `Halo` → `Bendul Merisi` → (ongkir) → `mau reservasi` → di form, customer kasih nama anak dengan ejaan tidak umum/nama panjang → cek tidak ada validasi yang menolak nama wajar.
    **Goal: → RESERVATION_SENT**
37. `Hai` → `Jajar Tunggal` → (ongkir) → `oke lanjut` → di tengah isi form, customer ganti pikiran soal tanggal yang diminta ("eh ganti hari senin aja deh") sebelum submit → cek bot bisa update sebelum final submit.
    **Goal: → RESERVATION_SENT**

## G. Sempat Hampir Batal, Lalu Balik Lagi (38-41)
Nguji recovery — customer bilang batal/pikir-pikir, lalu balik chat lagi di hari yang sama atau nanti.

38. `Halo` → `Simomulyo` → (ongkir) → `ga jadi deh mahal` → *(bot idle)* beberapa saat kemudian: `eh jadi deh, gimana reservasi` → cek state masih inget lokasi/ongkir, tidak minta ulang dari awal.
    **Goal: → RESERVATION_SENT**
39. `Hai` → `Tandes` → (ongkir) → `nanti aja deh mikir dulu` → *(lanjutan chat)* `oke jadi, reservasi` → isi form.
    **Goal: → RESERVATION_SENT**
40. `Halo` → `Manukan` → (ongkir) → `oke tunggu bentar ya lagi diskusi sama suami` → *(delay singkat, bukan 24 jam)* `oke acc, lanjut reservasi` → isi form.
    **Goal: → RESERVATION_SENT**
41. `Hai bu` → `Sawahan` → (ongkir) → `mau tapi budget masih mikir` → *(delay)* `bu, ada promo ga biar jadi murah dikit` → jawab realistis (kalau ada info promo di knowledge base, atau bilang tidak ada) → `oke ga papa full price aja, reservasi` → isi form.
    **Goal: → RESERVATION_SENT**

## H. Kondisi Layanan Ekstra Sebelum Reservasi (42-45)
Pertanyaan operasional yang sering ditanya sebelum benar-benar commit reservasi.

42. `Halo` → `Kedurus` → (ongkir) → `terapisnya kesini jam berapa biasanya` *(bukan asking_schedule spesifik, lebih general operasional)* → jawab wajar tanpa janji slot pasti → `oke ngerti, reservasi` → isi form.
    **Goal: → RESERVATION_SENT**
43. `Hai` → `Made` *(Sambikerep area — cek fuzzy match tidak salah ke "made" sebagai kata lain)* → (ongkir, atau klarifikasi kalau ambigu) → `oke, alat2 yang dibawa apa aja` → jawab FAQ → `sip, reservasi` → isi form.
    **Goal: → RESERVATION_SENT**
44. `Halo bu` → `Lidah Kulon` → (ongkir) → `perlu siapin apa aja sebelum terapis dateng` → jawab → `noted, reservasi ya` → isi form.
    **Goal: → RESERVATION_SENT**
45. `Hai` → `Lakarsantri` → (ongkir) → `bayarnya cash apa transfer` → jawab (ingat: di luar scope payment gateway per PRD Section 4.3, pastikan jawaban bot sesuai kondisi asli, bukan ngarang metode pembayaran) → `oke paham, reservasi` → isi form.
    **Goal: → RESERVATION_SENT**

## I. Edge Lokasi yang Tetap Harus Berhasil (46-48)
Beda dari kategori "lokasi sulit" di test plan sebelumnya (yang fokus ke kegagalan/eskalasi) — ini varian lokasi yang **seharusnya tetap resolve dan lanjut ke reservasi**, bukan berhenti di eskalasi.

46. `Halo` → *(kirim share location asli, bukan `/location`, tepat di titik klinik sendiri, jarak ~0 km)* → (ongkir gratis) → `deket banget ya berarti, oke reservasi` → isi form.
    **Goal: → RESERVATION_SENT**
47. `Hai` → `Mulyosari deket ITS` *(area yang menurut PRD Section 4.1 belum ada di gazetteer — cek apakah LLM fallback berhasil resolve nama, meski cross-check koordinat exact mungkin gagal — expected: customer tetap bisa lanjut dengan estimasi ongkir, TIDAK stuck)* → (ongkir, meski estimasi) → `oke reservasi aja` → isi form.
    **Goal: → RESERVATION_SENT** (catat kalau ternyata stuck di sini — ini match temuan pending PRD, prioritas fix)
48. `Halo` → kirim teks lokasi yang salah duluan (`Malang`) → *(bot proses sebagai luar jangkauan/jauh)* → customer buru-buru koreksi: `eh sori salah ketik maksudnya Malang Jaya deket sini, Rungkut` → cek bot bisa terima koreksi tanpa customer harus `/reset` manual → (ongkir) → `oke reservasi` → isi form.
    **Goal: → RESERVATION_SENT**

## J. AI Rollout Scope — Interaksi dengan Journey Reservasi (49-50)
Menyambung fitur AI Rollout Scope yang baru selesai — pastikan gate ini tidak merusak journey reservasi customer baru, dan legacy customer yang di-FORCE_ON tetap bisa jalan sampai reservasi.

49. Set scope `NEW_ONLY`, customer **baru** (createdAt setelah cutoff) → jalankan journey lengkap ala skenario #1 (`Halo` → lokasi → tertarik → form) → **Goal: → RESERVATION_SENT**, sekaligus verifikasi tidak ada silence yang tidak seharusnya di tengah jalan.
50. Customer **legacy** (createdAt sebelum cutoff, sedang silenced) → admin set `FORCE_ON` via dashboard → lanjutkan journey dari titik itu (`Halo, jadi bisa reservasi ga`) → **Goal: → RESERVATION_SENT**, sekaligus verifikasi conversation yang tadinya silenced benar-benar ter-release dan tidak nyangkut di `human_handling=true` meski sudah `FORCE_ON`.

---

## Ringkasan Distribusi Goal
- **44 skenario** bergoal `→ RESERVATION_SENT` (kategori A, B, C, D, F, G, H, I, J, + sebagian besar E) — ini yang jadi tolok ukur utama conversion-readiness.
- **1 skenario kondisional** (#31) tergantung desain approved-FAQ boundary — tester wajib catat expected behavior yang benar menurut kamu sebagai product owner sebelum menilai pass/fail.
- Skenario yang murni `→ HUMAN_HANDLING` (medis serius, komplain, tanya jadwal spesifik) **sudah dicover di test plan sebelumnya** (kategori E, F, G nomor 29-41) — sengaja tidak diulang di sini supaya dokumen ini fokus ke jalur konversi, bukan duplikasi.
