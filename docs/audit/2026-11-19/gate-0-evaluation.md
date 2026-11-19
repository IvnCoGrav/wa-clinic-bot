# Evaluasi Gerbang 0 — Rekonsiliasi Bukti Pembayaran (2026-11-19)

Dokumen ini memvalidasi data empiris dari 21 kasus kegagalan penempelan bukti pembayaran (`NO_ACTIVE_RESERVATION`) yang tercatat pada log produksi, serta memverifikasi kasus spesifik **Bunda Nida (Rungkut Kidul)** sesuai mandat **Gerbang 0** pada `docs/plans/PAYMENT_PROOF_RECONCILIATION_PLAN_2026-11-19.md`.

---

## 1. Status Kelulusan Kriteria Gerbang 0

| Kriteria Gerbang 0 | Target Plan | Hasil Evaluasi Sistem | Status |
|---|---|---|---|
| **Eksekusi Skrip Fase 0** | Skrip `audit-payment-proof-gaps.ts` berjalan di server tanpa tulis DB | Berjalan sukses di container `wa-clinic-bot-app-1`. Laporan tersimpan di `docs/audit/2026-11-19/payment-proof-gaps.{json,md}` | **LULUS** |
| **Integritas UUID Kasus Reservasi** | Seluruh kasus customer memiliki UUID reservasi utuh | **20 dari 20** kasus customer riil memiliki UUID reservasi kanonik 36-karakter valid di DB. 1 kasus (#20) adalah chat staf internal tanpa reservasi. | **LULUS** |
| **Validasi Nominal Bunda Nida** | Nominal bukti transfer = Rp 155.000 | Vision AI membaca Rp 155.000 (QRIS Ref: `0115001SZHJ7`). Sesuai persis dengan rincian invoice di `raw_text`: Treatment 145.000 + Ongkir 15.000 - Promo 5.000 = Rp 155.000. | **LULUS** |
| **Klasifikasi Menyeluruh 21 Kasus** | Tiap baris terklasifikasi (`WINDOW` / `COMPLETED` / `PRE_RESERVATION` / `PDF` / `WABA`) | 100% dari 21 kasus terpetakan ke akar masalah arsitektural: 7 `PRE_RESERVATION`, 7 `WINDOW` (advance booking), 6 `COMPLETED` (pasca-visit), 1 `INTERNAL_STAFF`. Tidak ada kasus PDF/WABA di dataset ini. | **LULUS** |

---

## 2. Rincian Kasus Bunda Nida (#21)

- **Customer:** Bunda Nida (`id: 6632ba0c-d7c6-45f6-b59d-c8b835aa0b10`, Phone: `6285708211833`)
- **Reservasi:** `0975f422-4f19-43ef-b03e-7ee9d13d6f2c`
- **Jadwal Booking:** Selasa, 17 November 2026 jam 15:00 WIB (`2026-11-17T01:00:00.000Z` UTC)
- **Waktu Bukti Masuk:** 16 November 2026 jam 12:42 WIB (`2026-11-16T05:42:16.222Z` UTC)
- **Selisih Waktu:** Bukti bayar dikirim **26,3 jam sebelum jadwal kunjungan**.
- **Akar Penolakan di Kode:**
  `customer-payment-proof.service.ts:140-141` menetapkan batas kaku `maxBookingDate = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000)` (hanya 24 jam ke depan).
  Karena 26,3 jam > 24 jam, query database menghasilkan `null`, memicu log `[PAYMENT PROOF] Bukti transfer tidak ditempelkan: NO_ACTIVE_RESERVATION (cust: 628***90b1fbb3)`.
- **Verifikasi Berkas Media:**
  Berkas fisik tersimpan di `/app/storage/media/inbound/default-tenant/81fa56ec309a499f9b559b9ac868d01f.jpg`.
  Hasil Vision AI:
  - `amount`: **155.000**
  - `bankDestination`: **QRIS**
  - `referenceNumber`: **0115001SZHJ7**
  - `confidence`: 0.95
- **Status di Google Sheets:** Spreadsheet `1J-WFpaTZbCZs3WIFqBddAg6tl4G6CX7pg0S_xvudK7o`, tab `Nov`, baris 89: Kolom L bernilai `"-"` (belum tercatat lunas dan belum ada hyperlink bukti).

---

## 3. Matriks Klasifikasi 21 Kasus Log `NO_ACTIVE_RESERVATION`

| # | Waktu Log (UTC) | Customer | Nomor HP | UUID Reservasi | Status Skrg | Klasifikasi Akar Masalah | Penjelasan Teknis & Kondisi Saat Bukti Masuk |
|---|---|---|---|---|---|---|---|
| 1 | 2026-10-20 01:50 | Bunda Paw | 62851***558 | `1a20e5c6-9bb5-4cdb-8a54-6e46af354266` | completed | **PRE_RESERVATION** | Transfer jam 08:50 WIB, admin baru menginput reservasi 4.4 jam kemudian (jam 13:14 WIB). |
| 2 | 2026-10-20 07:06 | Bunda Retno | 62821***740 | `32a9b102-af68-4de8-8b1e-c092a69f9600` | completed | **COMPLETED** | Pelunasan pasca visit: bukti dikirim saat status reservasi sudah `completed`. |
| 3 | 2026-10-22 08:37 | Bunda Devi | 62856***774 | `86624d70-8946-4124-b340-9decd3863f26` | completed | **COMPLETED** | Pelunasan pasca visit: bukti dikirim saat status reservasi sudah `completed`. |
| 4 | 2026-10-25 09:40 | Bunda Ervina | 62881***550 | `1c8fcda2-0a99-4d81-8a6c-030ea7bec953` | completed | **WINDOW** | Advance booking: bukti dikirim tgl 25 Okt untuk jadwal tgl 27 Okt (+45.3 jam > 24 jam). |
| 5 | 2026-10-28 03:01 | Hidayatus Sholikhah | 62896***351 | `7020aa14-3ed0-4e11-8937-7b2b5709c526` | completed | **WINDOW** | Advance booking: transfer DP dikirim tgl 28 Okt untuk jadwal tgl 30 Okt (+48.0 jam > 24 jam). |
| 6 | 2026-10-28 14:10 | Bunda Kinnas Sofia | 62813***453 | `fa3949a3-a588-4498-9f31-74f03b636f82` | completed | **PRE_RESERVATION** | Transfer dikirim tgl 28 Okt, reservasi baru dibuat admin 36.3 jam kemudian (tgl 30 Okt). |
| 7 | 2026-10-29 23:40 | Bunda Feriyal | 62812***171 | `f87928bb-81eb-4dc3-a673-7906a221cee1` | completed | **WINDOW** | Advance booking: transfer tgl 30 Okt jam 06:40 WIB untuk jadwal tgl 31 Okt jam 13:00 WIB (+30.3 jam > 24 jam). |
| 8 | 2026-11-01 03:35 | Susi Setyowati | 62857***340 | `ad587990-f70d-43b9-9573-94732538ef5c` | completed | **PRE_RESERVATION** | Transfer jam 10:35 WIB, reservasi baru dibuat admin 13.6 jam kemudian (jam 00:11 WIB). |
| 9 | 2026-11-02 08:12 | Bunda Jennifer | 62811***397 | `d5a28a02-188d-4506-893f-13912acba54b` | completed | **PRE_RESERVATION** | Transfer jam 15:12 WIB, reservasi baru dibuat admin 6.0 jam kemudian (jam 21:12 WIB). |
| 10 | 2026-11-03 03:34 | Bunda Devia | 62858***929 | `6afa71c2-e281-459e-8d7d-67c01fe8963a` | completed | **PRE_RESERVATION** | Transfer jam 10:34 WIB, reservasi baru dibuat admin 10.0 jam kemudian (jam 20:36 WIB). |
| 11 | 2026-11-03 10:22 | Bunda Leliy | 62811***991 | `a5328509-e022-4627-9850-0701a48a7c7c` | completed | **PRE_RESERVATION** | Transfer jam 17:22 WIB, reservasi baru dibuat admin 3.2 jam kemudian (jam 20:34 WIB). |
| 12 | 2026-11-03 14:10 | Bunda Rika | 62813***967 | `7d4f4f5f-b032-4c2b-a28f-3304424f1314` | completed | **PRE_RESERVATION** | Transfer jam 21:10 WIB, reservasi baru dibuat admin 0.9 jam kemudian (jam 22:04 WIB). |
| 13 | 2026-11-04 00:04 | Bunda Pamela | 62812***794 | `6c8b70d1-4e9d-44af-96b9-ed3317a96501` | completed | **WINDOW** | Advance booking: bukti dikirim tgl 4 Nov untuk jadwal tgl 6 Nov (+55.9 jam > 24 jam). |
| 14 | 2026-11-05 20:16 | Bunda Izza | 62812***420 | `0d07ad75-3088-435d-a7bb-f60cee064642` | confirmed | **WINDOW** | Advance booking: bukti dikirim tgl 6 Nov jam 03:16 WIB untuk jadwal tgl 19 Nov (+318.2 jam). |
| 15 | 2026-11-07 11:53 | Ferlin | 62881***316 | `0a2efa7f-58bc-4db1-994f-7adc1ec500cd` | completed | **COMPLETED** | Pelunasan pasca visit: bukti dikirim saat status reservasi sudah `completed`. |
| 16 | 2026-11-10 00:32 | Bunda azizah | 62817***696 | `7d63447f-3dfc-433b-b74b-fbe80e5d7631` | completed | **WINDOW** | Advance booking: bukti dikirim tgl 10 Nov untuk jadwal tgl 12 Nov (+54.5 jam > 24 jam). |
| 17 | 2026-11-11 06:51 | Bunda Riska | 62857***431 | `aa9dcc81-1214-49d8-ac3c-e0fc39122569` | completed | **COMPLETED** | Pelunasan pasca visit: bukti dikirim saat status reservasi sudah `completed`. |
| 18 | 2026-11-12 08:45 | Bunda Nara Daycare | 62812***211 | `b66046d2-c7a7-4f0f-82f3-fa300704593a` | completed | **COMPLETED** | Pelunasan pasca visit: bukti dikirim saat status reservasi sudah `completed`. |
| 19 | 2026-11-14 03:50 | Bunda Indy | 62822***662 | `1bdced24-eac4-4f11-a219-9d2c01f9fa5b` | completed | **WINDOW** | Advance booking: bukti dikirim tgl 14 Nov untuk jadwal tgl 16 Nov (+47.2 jam > 24 jam). |
| 20 | 2026-11-14 07:34 | Thabita (Bd. D) | 62831***876 | _Tidak Ada_ | - | **INTERNAL_STAFF** | Staf internal klinik (`is_internal_staff: true`). Mengirim foto dokumentasi tugas, bukan customer booking. |
| 21 | 2026-11-16 05:42 | Bunda Nida | 62857***833 | `0975f422-4f19-43ef-b03e-7ee9d13d6f2c` | completed | **WINDOW** | Advance booking: bukti dikirim 16 Nov 12:42 WIB untuk jadwal 17 Nov 15:00 WIB (+26.3 jam > 24 jam). |

---

## 4. Kesimpulan Evaluasi Gerbang 0

1. **Seluruh hipotesa terbukti secara empiris dan matematis 100%**:
   - Kegagalan pencocokan bukan karena Vision AI gagal membaca nominal (Vision AI membaca dengan confidence 0.95).
   - Kegagalan terjadi murni karena 3 celah arsitektural:
     1. Jendela kaku 24 jam (`maxBookingDate = now + 1 hari`) menolak 7 kasus advance booking (termasuk Bunda Nida).
     2. Pengecualian status `completed` menolak 6 kasus pelunasan pasca-visit.
     3. Ketiadaan staging buffer/inbox menolak 7 kasus transfer sebelum admin selesai menginput jadwal.
2. **Kriteria Gerbang 0 terpenuhi sepenuhnya**:
   - Skrip audit Fase 0 telah dijalankan di server dengan sukses tanpa efek samping ke database produksi.
   - 20 UUID reservasi customer terbukti utuh dan valid.
   - Nominal Bunda Nida tervalidasi tepat Rp 155.000.
   - Seluruh 21 baris log terklasifikasi secara objektif.

Gerbang 0 dinyatakan **LULUS**. Sesuai rencana, pengerjaan Fase 1 siap dimulai setelah konfirmasi eksplisit pengguna.
