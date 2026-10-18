# REVISI-1: Penyelesaian Akar Masalah Split-Brain Alamat (Typo Toponimi) & Peringatan Palsu "Minta Shareloc"

> Status: **RENCANA — BELUM DIEKSEKUSI.** Menunggu persetujuan eksplisit user
> ("Setuju/Lanjut/Eksekusi") — Confirmation Gate. Dilarang menyentuh kode,
> database, skrip, atau server sebelum itu.
>
> Dasar: audit read-only 18 Okt 2026 terhadap HEAD `4c0bd439` + pembacaan kode
> nyata (`file:line`) dan `docs/KNOWN_ISSUES.md` (#261, #266). Plan asli
> **DITOLAK sebagian**: beberapa akar masalah sudah diperbaiki, satu micro-task
> sudah ada (redundan), satu micro-task premisnya salah, dan satu berisiko
> regresi multi-rumah. Revisi ini mengganti lima titik tersebut.

---

## 0. Koreksi Verifikasi (plan asli → hasil audit)

| # | Klaim plan asli | Hasil audit (bukti) | Status |
|---|---|---|---|
| V1 | `addressesMatch` "hanya mencocokkan string kecamatan secara kaku" | Sudah punya `sameStreet+sameKec+kelKompatibel`, kompat-NULL kelurahan, & cabang pengayaan asimetris — `src/domain/customer-address.ts:109-143`. Fix "desa NULL" sudah ada (#261). Deskripsi plan menyederhanakan. | **KOREKSI** |
| V2 | Buat skrip baru `src/scripts/heal-split-brain-gps-addresses.ts` | `src/scripts/heal-customer-addresses-split-brain.ts` (387 baris) **sudah ada, idempoten, dry-run default**, dan **sudah dijalankan di produksi** (`wa_clinic_db`, alamat 102→61) — `KNOWN_ISSUES.md:160,172-178`. | **DIBATALKAN → perluas skrip lama** |
| V3 | Skrip healing meng-hardcode UUID `29705a6a-...` (Bunda Novi) | Dilarang A-014 & Mandat Non-Hardcode; skrip saudara sudah menolak pola ini — `heal-firda-active-address.ts:39-42`. | **DILARANG** |
| V4 | MT 1.2/2.1: `locationSource === 'gps_pin'` ⇒ `isPrimary = true` otomatis | **Regresi multi-rumah**: Rumah 2 ber-`gps_pin` akan mencuri primary & menurunkan Rumah 1. Invariant diuji di `tests/unit/customer-address-rumah-kedua.test.ts:70,112-174,197-209`. | **DIPERBAIKI CAKUPAN** |
| V5 | MT 2.2: selaraskan FK reservasi aktif (belum ada) | **Sudah ada**: `customer.service.ts:593-606` → `reservation-address-sync.service.ts:70-88`, dipanggil di `customer.service.ts:478`. | **DIHAPUS (redundan)** |
| V6 | MT 3.2: `activeConfirmedReservation.customer_address.location_source` "selalu ter-hydrate" | **Salah.** `formatReservationItem` TIDAK meng-include `customer_address` — `live-chat.service.ts:1280-1334`; tipe FE tak punya field itu — `LiveChatMonitor.tsx:302-313`; endpoint detail customer juga tidak — `customers.subroute.ts:339`. | **DISKOP ULANG** |
| V7 | "7 pelanggan aktif split-brain saat ini" | Tidak ada bukti live; DB sudah di-heal (#261). Firda dry-run justru membantah premis & dibatalkan — `KNOWN_ISSUES.md:54`. Angka wajib diverifikasi ulang (Fase 0). | **PERLU VERIFIKASI** |
| V8 | Line-reference domain `291`/`265`, UI `190` | **Akurat** — `customer-address.ts:291,265`; `LiveChatDispatchWidget.tsx:190`. | **VALID** |

---

## 1. Ikhtisar Akar Masalah (yang benar)

1. **Domain (typo toponimi).** `addressesMatch` membandingkan kecamatan secara
   eksak (`src/domain/customer-address.ts:122`). Input form/chat dengan variasi
   spelling (mis. `morokrembangab` vs `Krembangan`) + selisih sentroid geocoding
   ke titik rumah > `SAME_POINT_MAX_METERS` (150 m, `:19`) ⇒ **tidak match** ⇒
   kartu baru (`:291` `isPrimary: list.length === 0` = `false`) ⇒ kartu GPS
   presisi terkunci sebagai sekunder. **Ini akar sebenarnya & fondasional.**
2. **Kontrak Dashboard.** Widget OTW memakai gerbang kaku
   `locationSource !== 'gps_pin'` (`LiveChatDispatchWidget.tsx:190`) ⇒ alarm
   oranye + tombol "Minta Shareloc" muncul walau profil sudah diverifikasi staf
   (`manual_staff`) atau sudah `gps_pin`.
3. **Hubungan data.** Split-brain vertikal `customers.location_source` vs baris
   `customer_addresses` primer — **sudah** ditangani seam kanonis
   (`reservation-address-sync.service.ts`) & healing #261, bukan celah baru.

---

## 2. Keputusan yang WAJIB dikonfirmasi user (Confirmation Gate)

- **D-1 (MT 3.2):** payload `active*Reservation` tidak membawa `customer_address`.
  Pilihan:
  - **(a) Rekomendasi:** jangan perluas payload; pakai `selectedChat.locationSource`
    yang **sudah tersedia** (`live-chat.service.ts:1390`) sebagai prioritas sumber
    di `dispatchLocationSource`. Kecil, aman, tanpa perubahan serializer.
  - (b) Perluas `formatReservationItem` + tipe FE `LiveChatReservationItem:72` +
    `customers.subroute.ts:339` agar membawa `customer_address.location_source`.
    Lebih invasif, blast-radius lebih besar.
- **D-2 (MT 3.1):** apakah `manual_staff` dianggap **presisi terverifikasi**
  (sembunyikan tombol shareloc)? atau tetap tampilkan (shareloc masih berguna
  untuk pin presisi)? Rekomendasi: anggap terverifikasi (sembunyikan peringatan),
  tombol shareloc tetap dapat dipanggil manual dari header chat.
- **D-3 (Fase 4):** bila Fase 0 membuktikan **0** kasus split-brain tersisa,
  Fase 4 **tidak dieksekusi** (tidak ada yang diheal).

---

## 3. Tahapan Eksekusi (staged, per dependency & blast radius)

### FASE 0 — Investigation Gate (READ-ONLY, tanpa perubahan apa pun)

**Tujuan:** buktikan jumlah split-brain riil sebelum mengubah kode/skrip.

- **Mikro 0.1 — Query produksi (read-only).**
  Jalankan via `server-access` (alias `klinik-server-baru`, `43.173.11.79`):
  ```sql
  -- a) pelanggan dengan >1 kartu alamat
  SELECT customer_id, count(*) FROM customer_addresses GROUP BY customer_id HAVING count(*) > 1;
  -- b) split-brain: ada kartu gps_pin tetapi primary masih estimated_area
  SELECT c.id, c.name,
         (SELECT count(*) FROM customer_addresses a WHERE a.customer_id=c.id AND a.location_source='gps_pin') AS gps_cards,
         (SELECT count(*) FROM customer_addresses a WHERE a.customer_id=c.id AND a.is_primary AND a.location_source='estimated_area') AS est_primary
  FROM customers c
  WHERE gps_cards > 0 AND est_primary > 0;
  ```
- **Kriteria:** angka riil (gantikan klaim "7"). Bila `0` → Fase 4 di-skip.
- **Gate:** laporkan hasil ke user; **berhenti** sampai user menyetujui lanjut.

### FASE 1 — Fondasi Domain `addressesMatch` + Paritas Cermin

**Blast radius:** tertinggi (semua jalur dedup buku alamat & healing). Dikerjakan
TDD (Red dulu).

- **Mikro 1.1 — Tes adversarial (Red pertama).**
  - File: `tests/unit/address-match-toponimi.test.ts` (baru).
  - Kasus (varian data nyata, **bukan hafalan kalimat**):
    1. Jalan sama persis + kecamatan beda karena typo toponimi
       (`morokrembangab` vs `Krembangan`, kelurahan `Morokrembangan`) & jarak
       sentroid-ke-rumah 680 m ⇒ **match (1 kartu)**.
    2. Jalan sama + kelurahan tertukar ke kecamatan (form intake) ⇒ **match**.
    3. Jalan **berbeda** di kecamatan sama / kota sama ⇒ **tetap 2 kartu** (anti-regresi rumah-2).
    4. Jalan beda + kota beda ⇒ **tetap 2 kartu**.
    5. Jalan sama tetapi jarak > 3.000 m ⇒ **tetap 2 kartu**.
  - **Gate:** `npx vitest run tests/unit/address-match-toponimi.test.ts` (harus MERAH kini).

- **Mikro 1.2 — Perbaikan domain (hijau).**
  - File: `src/domain/customer-address.ts`, fungsi `addressesMatch` (`:109-143`).
  - Spesifikasi **terkunci** (wajib, agar tidak over-merge):
    - Cabang baru hanya aktif bila **`sameStreet === true`** (kedua sisi
      ber-teks & identik) **DAN** `sameKota` kompatibel (sama persis atau salah
      satu kosong). Tanpa dua syarat itu, **tidak ada** fuzzy.
    - **Cross kelurahan↔kecamatan:** anggap sama bila
      `norm(a.kecamatan) === norm(b.kelurahan)` atau sebaliknya.
    - **Toponimi:** anggap sama bila salah satu mengandung yang lain
      (child-name ⊂ parent-name) **ATAU** Levenshtein ≤ 2. Fungsi Levenshtein
      ditulis lokal (murni, tanpa dependency baru).
    - **Toleransi sentroid:** `sameStreet` + `haversineMeters(a,b) ≤ 3000`.
    - `sameStreet && sameKec && kelKompatibel` (aturan lama) **tidak diubah**.
  - **DILARANG:** hardcode daftar nama kecamatan/kelurahan; hanya operasi string generik.
  - **Gate:** 1.1 hijau; suite lama tetap hijau.

- **Mikro 1.3 — Paritas cermin FE.**
  - File: `packages/admin-dashboard/src/utils/addressMatch.ts` (`:61-85`) —
    salin **persis** logika 1.2 (norm/levenshtein/haversine sudah ada).
  - Perluas vektor `tests/unit/dashboard-address-match-parity.test.ts:16-71`
    dengan 5 kasus Mikro 1.1 (wajib: kedua implementasi menjawab identik).
  - **Gate:** `npx vitest run tests/unit/dashboard-address-match-parity.test.ts` hijau.

- **Gerbang Regresi Fase 1:**
  `npx vitest run tests/unit/customer-address-book.test.ts tests/unit/customer-address-rumah-kedua.test.ts tests/unit/multi-address-fase3.test.ts tests/unit/dashboard-address-match-parity.test.ts tests/unit/address-match-toponimi.test.ts`
  + `npm run build`. Semua hijau sebelum Fase 2.

### FASE 2 — Service: Elevasi Primary yang Aman (state-gated)

**Tujuan:** kartu GPS presisi menjadi primary **hanya** saat memperkaya alamat
root aktif pelanggan — **bukan** saat membuat rumah baru (anti-regresi rumah-2).

- **Mikro 2.1 — Flag elevasi eksplisit (bukan otomatis by-source).**
  - File: `src/domain/customer-address.ts`, `upsertAddressIntoList` (`:227-307`).
  - Aturan: elevasi ke primary hanya bila `input.isPrimary === true` (sudah
    dipakai di `:265` & `:273`). **DILARANG** menambah aturan
    `if (input.locationSource === 'gps_pin') isPrimary = true` di fungsi bersama.
  - **Alasan:** `upsertAddressIntoList` dipakai semua pemanggil, termasuk
    `upsertSavedAddress` (tambah rumah-2) & intake reservasi. Elevasi by-source
    di sini = regresi rumah-2.

- **Mikro 2.2 — Kirim `isPrimary: true` HANYA di jalur lokasi-root.**
  - File: `src/services/customer.service.ts`.
  - `updateCustomerLocation` (jalur profil root): pada cabang `writeLoc`
    GPS/root (`:458-468`, saat `isNewGpsInput === true` dan **bukan**
    `preserveExactGps`), tambahkan `isPrimary: true` bila titik ini adalah
    lokasi root aktif. Cabang `savedEntry` (`:434-446`) & `preserveExactGps`
    (`:447-457`) **tidak diubah**.
    Cermin memori: `:561-571`.
  - `syncSavedAddressFromLocation` (`:1651-1664`) meneruskan `isPrimary` apa
    adanya (tidak memaksa `true`).
  - **Acceptance:** kirim pin GPS untuk **rumah yang sama** ⇒ kartu GPS jadi
    primary; kirim pin untuk **rumah baru (beda jalan)** ⇒ kartu baru
    `isPrimary === false` (Rumah 1 tetap primary). **Tidak menyentuh** MT 2.2
    plan asli (FK reservasi) — sudah ada di `:478`.
  - **Test baru:** `tests/unit/customer-address-gps-elevation.test.ts`
    (2 kasus: enrich-same-home naik primary; new-home tetap non-primary).

- **Gerbang Regresi Fase 2:** Fase 1 gate + `tests/unit/customer-address-gps-elevation.test.ts`
  + `tests/unit/reservation-address-sync.test.ts` + `npm run build`.

### FASE 3 — Kontrak Dashboard (anti-alarm palsu)

- **Mikro 3.1 — Gerbang peringatan widget (disetujui D-2).**
  - File: `packages/admin-dashboard/src/components/livechat/LiveChatDispatchWidget.tsx:190`.
  - Ubah `{locationSource && locationSource !== 'gps_pin' && onRequestShareloc && (`
    → `{locationSource === 'estimated_area' && onRequestShareloc && (`
  (bila D-2 = `manual_staff` dianggap terverifikasi; jika tidak, gunakan
  `locationSource !== 'gps_pin' && locationSource !== 'manual_staff'`).
  - **Acceptance:** `gps_pin` & `manual_staff` ⇒ tidak ada banner/tombol; hanya
    `estimated_area` yang memunculkan.

- **Mikro 3.2 — Sumber lokasi dispatch (opsi D-1 terpilih).**
  - File: `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx:3935`.
  - **Opsi (a) rekomendasi** — tanpa perluas serializer:
    ```ts
    const dispatchLocationSource =
      resolveEffectiveLocationSource(customerDetailData) ||
      resolveEffectiveLocationSource(activeConfirmedReservation) ||
      resolveEffectiveLocationSource(activeHoldReservation) ||
      resolveEffectiveLocationSource(selectedChat?.locationSource) ||
      null;
    ```
    (`selectedChat.locationSource` tersedia via `live-chat.service.ts:1390`;
    `resolveEffectiveLocationSource` menerima objek/string — `geoUtils.ts:173-211`.)
  - **Opsi (b)** — perluas `formatReservationItem` (`live-chat.service.ts:1280-1334`),
    `LiveChatReservationItem:72`, tipe FE `LiveChatMonitor.tsx:302-313`, dan
    `customers.subroute.ts:339` agar membawa `customer_address.location_source`.
  - **DILARANG** memakai `activeConfirmedReservation.customer_address...` pada
    opsi (a) — field itu tidak ada (bukti V6).
  - **Acceptance:** saat profil `gps_pin`, panel dispatch tidak lagi estimasi.
  - **Gate UI:** `cd packages/admin-dashboard; npm run build`.

### FASE 4 — Healing Data (kondisional; ganti MT 4.1 plan asli)

> Hanya dijalankan bila Fase 0 menemukan kasus nyata.

- **Mikro 4.1 — Perluas skrip lama (JANGAN buat file baru).**
  - File: `src/scripts/heal-customer-addresses-split-brain.ts` (yang sudah ada).
  - **DILARANG** hardcode UUID/nama. Target lewat `--customer=<id>` atau deteksi
    data-driven (V3).
  - Verifikasi ulang bahwa skrip sudah menangani: ghost primary, desync sumber,
    dedup via `addressesMatch` (otomatis dapat manfaat Fase 1), upgrade ke
    `gps_pin` dari `locationMessage` inbound, relink reservasi, sinkron
    `preferences.saved_addresses` (`:102-355`). Tambahkan perilaku baru **hanya**
    bila Fase 0 menunjukkan pola yang belum tercakup.
  - Pertahankan safeguard `REPORT_ONLY` untuk kasus melibatkan `gps_pin`
    (`:138-139,125`) — **dilarang** hapus paksa.
  - **Runbook prod (koreksi #261: `tsx` tidak ada di image):**
    `docker compose exec -T app node dist/scripts/heal-customer-addresses-split-brain.js --dry-run`
    → validasi → `pg_dump` manual ke host → `--commit`.
  - **Acceptance:** dry-run bersih (manual review tiap aksi); rerun `--commit`
    kedua = 0 tulis (idempoten); backup `pg_dump` ada di host.

### FASE 5 — Verifikasi, Regresi & Deploy

- **Mikro 5.1 — Full gates.**
  - `npm run build` (root, typecheck).
  - `cd packages/admin-dashboard; npm run build`.
  - `npx vitest run` untuk seluruh suite alamat (Fase 1–3) + suite pengaman
    (`reservation-address-sync`, `reservation-address-seam`, `staff-task-effective-address`).
- **Mikro 5.2 — Full suite & bukti pre-existing.**
  - `npm test`. Klaim failure pre-existing WAJIB dibuktikan revert-and-rerun
    (kembalikan file ke HEAD, test yang sama harus tetap gagal).
- **Mikro 5.3 — Catat & deploy.**
  - Perbarui `CHANGELOG.md` + `docs/KNOWN_ISSUES.md` (#261/#266 tindak lanjut).
  - Deploy standard 1-step (tidak menyentuh WAHA). Bila Fase 4 dijalankan:
    backup + urutan aman (dry-run dulu).

---

## 4. Matriks Risiko & Mitigasi (FMEA)

| Risiko | S | O | D | RPN | Mitigasi |
|---|---|---|---|---|---|
| Fuzzy over-merge 2 rumah beda jalan | 8 | 3 | 4 | 96 | Wajib `sameStreet===true` + `sameKota` (Mikro 1.2); tes anti-over-merge (1.1 kasus 3-5) |
| Elevasi primary mencuri Rumah 2 | 7 | 4 | 3 | 84 | Elevasi hanya via flag di jalur root (Mikro 2.2); tes gps-elevation |
| Healing menghapus data salah | 9 | 2 | 3 | 54 | Dry-run default + `REPORT_ONLY` + `pg_dump` host + review manual |
| Payload `customer_address` tak ada (D-1) | 4 | 5 | 3 | 60 | Opsi (a) tanpa perluas serializer; bukti V6 |
| Drift cermin FE/BE | 5 | 3 | 2 | 30 | Tes paritas 5 vektor baru (Mikro 1.3) |
| Hardcode UUID di skrip | 5 | 2 | 5 | 50 | Dilarang (V3); deteksi data-driven |

---

## 5. Urutan Aman & Rollback

1. Fase 0 (read-only, tanpa rollback).
2. Fase 1 → 2 → 3 (kode; `git revert` per-fase, zero migrasi).
3. Fase 4 hanya bila perlu; backup `pg_dump` = titik rollback data.
4. Fase 5 deploy 1-step.

---

## 6. Batasan & Asumsi

- `[ASUMSI]` Jumlah kasus split-brain (Fase 0) belum diverifikasi di run ini.
- Perbaikan domain Fase 1 mengubah perilaku dedup secara global — wajib gerbang
  regresi penuh sebelum menyentuh service/UI.
- Keputusan D-1/D-2/D-3 wajib dijawab user sebelum eksekusi Fase 2–4.

## 7. Confirmation Gate

Plan ini **BELUM DIEKSEKUSI**. Mohon balas dengan persetujuan tertulis
(mis. "Setuju, eksekusi") disertai pilihan **D-1 (a/b), D-2, D-3**. Sebelum itu
tidak ada file kode/skrip yang dibuat atau diubah, dan tidak ada perintah
eksekusi/DB dijalankan.
