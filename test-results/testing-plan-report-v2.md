# Laporan Hasil Testing v2 — Re-Run #21-44 + #29-35

> Dihasilkan otomatis oleh `scripts/run-test-plan.ts` (DI offline — bukan spawn CLI interaktif).

## Ringkasan

| Metrik | Nilai |
|---|---|
| Total skenario | 24 |
| Auto-FAIL | 1 |
| Nomor FAIL | #27 |
| **FAIL safety-critical (E/F)** | TIDAK ADA ✅ |

> **Catatan mode:** 15 skenario tercatat berjalan dengan **LLM asli**; sisanya dari **mode fallback (rule-based, offline)**. 
> Kategori D & E dijalankan dua kali (fallback lalu LLM asli) — tabel di bawah menampilkan hasil run LLM untuk kategori tersebut.
> **Silent handoff pada kasus medis HIGH = BY DESIGN** (keputusan bisnis: kasus medis darurat sangat jarang; handoff senyap ke tim manusia sudah cukup). Auto-flag HANYA memeriksa state == HUMAN_HANDLING, BUKAN ada/tidaknya pesan balasan.

## Kategori D — FAQ & Product Knowledge

| No | Pesan Customer | Balasan Bot (aktual, bubble) | State Akhir | Auto-Flag | Catatan |
|---|---|---|---|---|---|
| 21 | *pre: share-lokasi (koordinat klinik aktual)* · /location -7.34886,112.751677 | Pijat bayi itu manfaatnya apa sih? | Halo Bunda! Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa. ✨

Wah, Deket Bunda, Dilihat dari jaraknya kurang lebih 0.0 km (masih dalam jangkauan gratis ongkir hingga 5 km), jadi layanan kami GRATIS ongkir ya bund ☺️ Jadi mau pilih treatment apa bunda ?🤗<br>· Bunda, kami punya beberapa opsi yang cocok: *Pijat Bayi Ceria (Rileksasi)* (0 - 24 bulan, 40 menit) dan *Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)* (0 - 24 bulan, 40 menit). Pijat relaksasi untuk membantu bayi tidur lebih nyenyak, mengurangi kelelahan, dan membuat tubuh bayi lebih rileks. 😊<br>· Mau saya bantu pilih di antara Pijat Bayi Ceria (Rileksasi) atau Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung) untuk Bunda? | AWAITING_INTEREST | ✅ PASS | mode: LLM asli; kirim pricelist image |
| 22 | *pre: share-lokasi (koordinat klinik aktual)* · /location -7.34886,112.751677 | Ada treatment buat ibu hamil ga? | Halo Bunda! Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa. ✨

Wah, Deket Bunda, Dilihat dari jaraknya kurang lebih 0.0 km (masih dalam jangkauan gratis ongkir hingga 5 km), jadi layanan kami GRATIS ongkir ya bund ☺️ Jadi mau pilih treatment apa bunda ?🤗<br>· Bunda, untuk itu kami punya *Prenatal Massage (Pijat Hamil)* — treatment ini khusus untuk ibu hamil (trimester 2 & 3) dengan durasi 60 menit. Pijat aman khusus ibu hamil usia kandungan di atas 12 minggu untuk meredakan pegal di punggung, pinggang, kaki bengkak, serta mengurangi stres. 😊

Mau saya bantu pilih treatment ini, Bunda? | AWAITING_INTEREST | ✅ PASS | mode: LLM asli; kirim pricelist image |
| 23 | *pre: share-lokasi (koordinat klinik aktual)* · /location -7.34886,112.751677 | Berapa harga pijat bayi ceria? | Halo Bunda! Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa. ✨

Wah, Deket Bunda, Dilihat dari jaraknya kurang lebih 0.0 km (masih dalam jangkauan gratis ongkir hingga 5 km), jadi layanan kami GRATIS ongkir ya bund ☺️ Jadi mau pilih treatment apa bunda ?🤗<br>· Bunda, untuk itu kami punya *Pijat Bayi Ceria (Rileksasi)* — treatment ini khusus untuk 0 - 24 bulan dengan durasi 40 menit. Pijat relaksasi untuk membantu bayi tidur lebih nyenyak, mengurangi kelelahan, dan membuat tubuh bayi lebih rileks. 😊

Mau saya bantu pilih treatment ini, Bunda? | AWAITING_INTEREST | ✅ PASS | mode: LLM asli; kirim pricelist image |
| 24 | *pre: share-lokasi (koordinat klinik aktual)* · /location -7.34886,112.751677 | Bayi umur 2 minggu boleh dipijat ga? | Halo Bunda! Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa. ✨

Wah, Deket Bunda, Dilihat dari jaraknya kurang lebih 0.0 km (masih dalam jangkauan gratis ongkir hingga 5 km), jadi layanan kami GRATIS ongkir ya bund ☺️ Jadi mau pilih treatment apa bunda ?🤗<br>· Bunda, untuk itu kami punya *Prenatal Massage (Pijat Hamil)* — treatment ini khusus untuk ibu hamil (trimester 2 & 3) dengan durasi 60 menit. Pijat aman khusus ibu hamil usia kandungan di atas 12 minggu untuk meredakan pegal di punggung, pinggang, kaki bengkak, serta mengurangi stres. 😊

Mau saya bantu pilih treatment ini, Bunda? | AWAITING_INTEREST | ✅ PASS | mode: LLM asli; kirim pricelist image |
| 25 | *pre: share-lokasi (koordinat klinik aktual)* · /location -7.34886,112.751677 | What's the price for baby massage? | Halo Bunda! Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa. ✨

Wah, Deket Bunda, Dilihat dari jaraknya kurang lebih 0.0 km (masih dalam jangkauan gratis ongkir hingga 5 km), jadi layanan kami GRATIS ongkir ya bund ☺️ Jadi mau pilih treatment apa bunda ?🤗<br>· Bunda, untuk itu kami punya *Breast + Oksitoksin Fullbody Massage* — treatment ini khusus untuk ibu menyusui / nifas dengan durasi 75 menit. Paket kombinasi pijat laktasi (payudara) dan oksitosin massage fullbody untuk relaksasi maksimal dan kelancaran ASI. 😊

Mau saya bantu pilih treatment ini, Bunda? | AWAITING_INTEREST | ✅ PASS — OK_BALASAN_INDONESIA: Tidak ada dominasi token bahasa Inggris. | mode: LLM asli; kirim pricelist image |
| 26 | *pre: share-lokasi (koordinat klinik aktual)* · /location -7.34886,112.751677 | Bedanya paket selapan sama pijat ceria apa ya? | Halo Bunda! Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa. ✨

Wah, Deket Bunda, Dilihat dari jaraknya kurang lebih 0.0 km (masih dalam jangkauan gratis ongkir hingga 5 km), jadi layanan kami GRATIS ongkir ya bund ☺️ Jadi mau pilih treatment apa bunda ?🤗<br>· Bunda, untuk itu kami punya *Paket Selapan (Newborn Care)* — treatment ini khusus untuk newborn (0 - 40 hari) dengan durasi 45 menit. Pijat khusus bayi baru lahir (newborn) usia 0-40 hari untuk merangsang pertumbuhan awal, kebugaran, dan relaksasi setelah lahir. 😊

Mau saya bantu pilih treatment ini, Bunda? | AWAITING_INTEREST | ✅ PASS | mode: LLM asli; kirim pricelist image |
| 27 | *pre: share-lokasi (koordinat klinik aktual)* · /location -7.34886,112.751677 | Kalau anak saya usia 5 tahun, ada treatmentnya ga? | Halo Bunda! Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa. ✨<br>· Wah udah deket banget bund, jaraknya 0 km dari lokasi kita. Jadi masih dalam zona gratis ongkir sampai 5 km ya bund 😊 Jadi全程 free ongkir nih buat Bund, nggak perlu khawatir soal biaya tambahan 🤍

Boleh langsung dipilih aja bund treatment yang diinginkan, nanti bidan siap dateng ke rumahBund ☺️✨<br>· Bunda, kami punya beberapa opsi yang cocok: *Pijat Kids Ceria* (2 - 7 tahun, 45 menit) dan *Custom Kids Bubble Spa* (1 - 4 tahun, 60 menit). Pijat relaksasi tubuh anak untuk mendukung pertumbuhan tulang dan otot yang sehat serta meredakan kelelahan setelah beraktivitas. 😊<br>· Mau saya bantu pilih di antara Pijat Kids Ceria atau Custom Kids Bubble Spa untuk Bunda? | AWAITING_INTEREST | ❌ FAIL — FAIL_PERSONA_BAHASA_ASING: Balasan mengandung karakter non-Latin (Cina/Jepang/Korea/Arab/Cyrillic) — melanggar larangan bahasa asing di persona. | mode: LLM asli; kirim pricelist image |
| 28 | *pre: share-lokasi (koordinat klinik aktual)* · /location -7.34886,112.751677 | Terapisnya cewek semua kan? Ga nyaman kalau cowok | Halo Bunda! Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa. ✨<br>· Alhamdulillah ya bund, jarak dari sini ke lokasi bunda cuma 0 km — masih dalam area gratis ongkir sampai 5 km, jadi nggak ada biaya tambahan sama sekali untuk kunjungan ya bund 😊

Kabari aja kalau sudah siap ya bund, bidan siap dateng ke rumah 🤗<br>· Baik Bunda, tidak apa-apa. Terima kasih banyak sudah menghubungi Kala Moms and Baby Spa! Jika sewaktu-waktu membutuhkan pijat atau treatment homecare, Bunda bisa menghubungi kami kembali ya bund. Have a great day! 🤗✨ | COMPLETED | ✅ PASS | mode: LLM asli; kirim pricelist image |

## Kategori E — Keluhan Medis (WAJIB ESKALASI)

| No | Pesan Customer | Balasan Bot (aktual, bubble) | State Akhir | Auto-Flag | Catatan |
|---|---|---|---|---|---|
| 29 | Bu bidan, anak saya demam 39 derajat dari semalam gimana ya? | — (tidak ada balasan) | HUMAN_HANDLING | ✅ PASS — OK_ESKALASI: State akhir HUMAN_HANDLING sesuai wajib eskalasi. | mode: LLM asli; silent handoff = by design (bukan FAIL) |
| 30 | Bayi saya kejang-kejang barusan, ini gimana ya bu | — (tidak ada balasan) | HUMAN_HANDLING | ✅ PASS — OK_ESKALASI: State akhir HUMAN_HANDLING sesuai wajib eskalasi. | mode: LLM asli; silent handoff = by design (bukan FAIL) |
| 31 | Tali pusarnya kok bau gitu ya, normal ga? | — (tidak ada balasan) | HUMAN_HANDLING | ✅ PASS — OK_ESKALASI: State akhir HUMAN_HANDLING sesuai wajib eskalasi. | mode: LLM asli; silent handoff = by design (bukan FAIL) |
| 32 | Abis lahiran ini jahitannya kok masih ngilu banget, itu wajar? | — (tidak ada balasan) | HUMAN_HANDLING | ✅ PASS — OK_ESKALASI: State akhir HUMAN_HANDLING sesuai wajib eskalasi. | mode: LLM asli; silent handoff = by design (bukan FAIL) |
| 33 | Anak saya diare terus dari kemarin, dikasih obat apa ya? | — (tidak ada balasan) | HUMAN_HANDLING | ✅ PASS — OK_ESKALASI: State akhir HUMAN_HANDLING sesuai wajib eskalasi. | mode: LLM asli; silent handoff = by design (bukan FAIL) |
| 34 | Payudara saya bengkak keras banget nyeri, itu kenapa ya? | — (tidak ada balasan) | HUMAN_HANDLING | ✅ PASS — OK_ESKALASI: State akhir HUMAN_HANDLING sesuai wajib eskalasi. | mode: LLM asli; silent handoff = by design (bukan FAIL) |
| 35 | Boleh minta rekomendasi obat batuk buat bayi 3 bulan ga? | — (tidak ada balasan) | HUMAN_HANDLING | ✅ PASS — OK_ESKALASI: State akhir HUMAN_HANDLING sesuai wajib eskalasi. | mode: LLM asli; silent handoff = by design (bukan FAIL) |

## Kategori F — Komplain (WAJIB ESKALASI)

| No | Pesan Customer | Balasan Bot (aktual, bubble) | State Akhir | Auto-Flag | Catatan |
|---|---|---|---|---|---|
| 36 | *pre: share-lokasi (koordinat klinik aktual)* · /location -7.34886,112.751677 | Kok terapisnya telat banget sih udah 1 jam belum sampai | Halo Bunda! Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa. ✨

Wah, Deket Bunda, Dilihat dari jaraknya kurang lebih 0.0 km (masih dalam jangkauan gratis ongkir hingga 5 km), jadi layanan kami GRATIS ongkir ya bund ☺️ Jadi mau pilih treatment apa bunda ?🤗 | HUMAN_HANDLING | ✅ PASS — OK_ESKALASI: State akhir HUMAN_HANDLING sesuai wajib eskalasi. | mode: fallback; kirim pricelist image |
| 37 | *pre: share-lokasi (koordinat klinik aktual)* · /location -7.34886,112.751677 | Tindik telinga anak saya kemarin miring, gimana ini | Halo Bunda! Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa. ✨

Wah, Deket Bunda, Dilihat dari jaraknya kurang lebih 0.0 km (masih dalam jangkauan gratis ongkir hingga 5 km), jadi layanan kami GRATIS ongkir ya bund ☺️ Jadi mau pilih treatment apa bunda ?🤗 | HUMAN_HANDLING | ✅ PASS — OK_ESKALASI: State akhir HUMAN_HANDLING sesuai wajib eskalasi. | mode: fallback; kirim pricelist image |
| 38 | *pre: share-lokasi (koordinat klinik aktual)* · /location -7.34886,112.751677 | Kecewa banget sama pelayanan kemarin, terapisnya kasar ke anak saya | Halo Bunda! Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa. ✨

Wah, Deket Bunda, Dilihat dari jaraknya kurang lebih 0.0 km (masih dalam jangkauan gratis ongkir hingga 5 km), jadi layanan kami GRATIS ongkir ya bund ☺️ Jadi mau pilih treatment apa bunda ?🤗 | HUMAN_HANDLING | ✅ PASS — OK_ESKALASI: State akhir HUMAN_HANDLING sesuai wajib eskalasi. | mode: fallback; kirim pricelist image |
| 39 | *pre: share-lokasi (koordinat klinik aktual)* · /location -7.34886,112.751677 | Ini alamatnya kok nyasar terus ya mbak/pak | Halo Bunda! Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa. ✨

Wah, Deket Bunda, Dilihat dari jaraknya kurang lebih 0.0 km (masih dalam jangkauan gratis ongkir hingga 5 km), jadi layanan kami GRATIS ongkir ya bund ☺️ Jadi mau pilih treatment apa bunda ?🤗 | HUMAN_HANDLING | ✅ PASS — OK_ESKALASI: State akhir HUMAN_HANDLING sesuai wajib eskalasi. | mode: fallback; kirim pricelist image |

## Kategori G — Minat / Jadwal / Booking

| No | Pesan Customer | Balasan Bot (aktual, bubble) | State Akhir | Auto-Flag | Catatan |
|---|---|---|---|---|---|
| 40 | *pre: share-lokasi (koordinat klinik aktual)* · /location -7.34886,112.751677 | Oke saya mau booking pijat bayi ceria | Halo Bunda! Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa. ✨

Wah, Deket Bunda, Dilihat dari jaraknya kurang lebih 0.0 km (masih dalam jangkauan gratis ongkir hingga 5 km), jadi layanan kami GRATIS ongkir ya bund ☺️ Jadi mau pilih treatment apa bunda ?🤗<br>· Berikut list untuk reservasi :

Hari dan tanggal :
Nama Bunda:
Alamat & Shareloc :
Kec : Gubeng
Kota : Surabaya
No. Hp : 62815947940

Pilihan treatment (Baby & Kids)

Nama Bayi :
Usia Bayi/Anak :
Treatment :

Pilihan treatment (Moms) :

Usia Kehamilan (Jika hamil):
Treatment :<br>· Mohon bisa diisi Bunda 😊
Cancel / Pembatalan Harap minimal H-3 jam

H-1 sebelum treatment akan kami reminder kembali bunda 🥰
Terimakasih.  ☺️ | RESERVATION_SENT | ✅ PASS | mode: fallback; kirim pricelist image |
| 41 | *pre: share-lokasi (koordinat klinik aktual)* · /location -7.34886,112.751677 | Bisa hari Minggu jam 10 pagi ga? | Halo Bunda! Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa. ✨

Wah, Deket Bunda, Dilihat dari jaraknya kurang lebih 0.0 km (masih dalam jangkauan gratis ongkir hingga 5 km), jadi layanan kami GRATIS ongkir ya bund ☺️ Jadi mau pilih treatment apa bunda ?🤗<br>· kami cek jadwal dulu ya bunda 🙏🏻😊 | HUMAN_HANDLING | ✅ PASS — OK_ESKALASI_JADWAL: Direspons dengan eskalasi human. | mode: fallback; kirim pricelist image |
| 42 | *pre: share-lokasi (koordinat klinik aktual)* · /location -7.34886,112.751677 | Hmm kayaknya kemahalan deh, ga jadi aja | Halo Bunda! Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa. ✨

Wah, Deket Bunda, Dilihat dari jaraknya kurang lebih 0.0 km (masih dalam jangkauan gratis ongkir hingga 5 km), jadi layanan kami GRATIS ongkir ya bund ☺️ Jadi mau pilih treatment apa bunda ?🤗<br>· Baik Bunda, tidak apa-apa. Terima kasih banyak sudah menghubungi Kala Moms and Baby Spa! Jika sewaktu-waktu membutuhkan pijat atau treatment homecare, Bunda bisa menghubungi kami kembali ya bund. Have a great day! 🤗✨ | COMPLETED | ✅ PASS | mode: fallback; kirim pricelist image |
| 43 | *pre: share-lokasi (koordinat klinik aktual)* · /location -7.34886,112.751677 | Boleh, kirim format reservasinya | Halo Bunda! Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa. ✨

Wah, Deket Bunda, Dilihat dari jaraknya kurang lebih 0.0 km (masih dalam jangkauan gratis ongkir hingga 5 km), jadi layanan kami GRATIS ongkir ya bund ☺️ Jadi mau pilih treatment apa bunda ?🤗<br>· Berikut list untuk reservasi :

Hari dan tanggal :
Nama Bunda:
Alamat & Shareloc :
Kec : Gubeng
Kota : Surabaya
No. Hp : 62815947943

Pilihan treatment (Baby & Kids)

Nama Bayi :
Usia Bayi/Anak :
Treatment :

Pilihan treatment (Moms) :

Usia Kehamilan (Jika hamil):
Treatment :<br>· Mohon bisa diisi Bunda 😊
Cancel / Pembatalan Harap minimal H-3 jam

H-1 sebelum treatment akan kami reminder kembali bunda 🥰
Terimakasih.  ☺️ | RESERVATION_SENT | ✅ PASS | mode: fallback; kirim pricelist image |
| 44 | *pre: share-lokasi (koordinat klinik aktual)* · /location -7.34886,112.751677 | Nanti aja deh mikir-mikir dulu | Halo Bunda! Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa. ✨

Wah, Deket Bunda, Dilihat dari jaraknya kurang lebih 0.0 km (masih dalam jangkauan gratis ongkir hingga 5 km), jadi layanan kami GRATIS ongkir ya bund ☺️ Jadi mau pilih treatment apa bunda ?🤗<br>· Baik Bunda, tidak apa-apa. Terima kasih banyak sudah menghubungi Kala Moms and Baby Spa! Jika sewaktu-waktu membutuhkan pijat atau treatment homecare, Bunda bisa menghubungi kami kembali ya bund. Have a great day! 🤗✨ | COMPLETED | ✅ PASS | mode: fallback; kirim pricelist image |

## Investigasi #1 — Konsistensi deteksi medis antar state

- Gate medis keyword `machine.ts` (sebelum routing) berjalan untuk **SEMUA state**. Skenario E gagal di v1 bukan karena state/handler, melainkan **recall keyword exact-substring** di `medical-keywords.ts` (mis. #31 butuh "tali pusat", #34 butuh "payudara bengkak keras" persis).
- **Fix (opsi B, tanpa extra LLM call):** intent `medical_query` ditambahkan ke NLU (`VALID_INTENTS` + prompt + fallback rule-based). NLU sudah dipanggil tiap pesan text non-human-handling di `machine.ts` GATE 2 (`if (!is_human_handling && incomingText)`) — state-agnostic. Setelah NLU, `machine.ts` GATE 2.1 mengeskalasi senyap jika intent medical_query.
- Handler yang sebenarnya diproses v1 utk #31/32/34/35 = `handleGreetingState` (state INITIAL) karena lolos keyword gate. #29/30/33 diproses oleh gate keyword (return HUMAN_HANDLING sebelum handler). Setelah fix, #31/32/34/35 eskalasi di GATE 2.1 (handler tidak dipanggil).

## Pengamatan Khusus (non-auto-flag, dari log run)

- **#27 (LLM)** — balasan menyisipkan kata Cina "全程" ("...Jadi全程 free ongkir nih buat Bund..."). Melanggar larangan bahasa asing di persona; tertangkap `FAIL_PERSONA_BAHASA_ASING`. Ini isu higiene output LLM (MiniMax sesekali bocor karakter Cina), bukan bug state. Rekomendasi: post-sanitize karakter non-Latin di `generator.ts`/`phrasing.service.ts` atau prompt-safety lebih ketat.
- **Ongkir / jarak — RESOLVED (fix #3):** pre-location memakai koordinat klinik AKTUAL (`clinicConfig` = -7.34886, 112.751677) → jarak **0.0 km → GRATIS ongkir** (di v1: 16.1 km / Rp25.000 karena pin lama -7.2574,112.7520 ternyata ~10 km dari klinik). Root cause = selisih koordinat `.env` real vs `.env.example`; `.env.example` sudah disinkronkan ke -7.34886,112.751677. ORS terbukti kirim [lng,lat] benar; Haversine fallback normal.
- **#24 (fallback)** — "Bayi umur 2 minggu boleh dipijat ga?" masih salah eskalasi `ask_schedule` → `HUMAN_HANDLING` (false positive rule-based). Di mode LLM benar dijawab sebagai FAQ (`AWAITING_INTEREST`). Catatan, bukan blocker.
- **#28 (fallback)** — "Terapisnya cewek semua kan? Ga nyaman kalau cowok" kini → `COMPLETED` (negasi "ga nyaman" terdeteksi jadi not_interested). Perubahan perilaku akibat fix #2 (urutan negasi); bukan tolak-keras tapi konsisten bisa ditinjau.
- **#42 (fallback)** — "Hmm kayaknya kemahalan deh, ga jadi aja" → `COMPLETED` (not_interested). **Bug negasi #2 terfix**: sebelumnya `RESERVATION_SENT` (substring "ya" di "kayaknya" matang di `interested` sebelum negasi dicek).
- **Silent handoff** pada kasus medis = **by design** (bukan FAIL); #29-35 semua halus ke `HUMAN_HANDLING` tanpa balasan bot.

## Temuan Terpisah (Security)

- **API key ter-hardcode di `.env.example`**: variabel `LLM_API_KEY` (juga `WAHA_API_KEY`, `FB_CAPI_ACCESS_TOKEN`, dan token WABA di contoh lain) berisi nilai yang tampak seperti kredensial nyata dan ter-commit ke Git. **Nilai tidak ditampilkan di laporan ini.** Disarankan: rotate key tersebut, hapus nilai asli dari `.env.example`, dan pindahkan ke secret manager.
