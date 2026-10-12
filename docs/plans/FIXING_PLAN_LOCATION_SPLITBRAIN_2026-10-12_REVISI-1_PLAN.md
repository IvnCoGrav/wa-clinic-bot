# REVISI-1: Resolusi Split-Brain Lokasi, Healing Alamat Utama & Pengamanan Rute Navigasi

> Status: **RENCANA — BELUM DIEKSEKUSI.** Menunggu persetujuan eksplisit user
> ("Setuju/Lanjut/Eksekusi") — Confirmation Gate. Dilarang menyentuh kode,
> database, atau server sebelum itu.
>
> Dasar: audit read-only 12 Okt 2026 terhadap HEAD `ba615196` + SELECT live
> (tanpa tulis) ke DB produksi. Akar plan asli DINYATAKAN VALID; yang direvisi
> adalah nomor baris basi, duplikasi seam, satu solusi prompt yang DITOLAK, dan
> runbook yang terbukti gagal.

## 0. Koreksi verifikasi (yang berubah dari plan asli)

| # | Klaim plan asli | Hasil audit |
|---|---|---|
| V1 | `upsertAddressIntoList` di 210-240 | Fungsi di `:186-254`, blok merge `:194-223` |
| V2 | Endpoint `:id/location` di 1260-1280 | Endpoint di `:1085+`, update DB di `:1262-1273` |
| V3 | `getUpcomingSchedule` di 880-900 | Konstruksi task di `:946-962`; pola timpa yang sama juga di `getCompletedTasks` (`:1148-1163`, tak disebut plan) |
| V4 | LiveChatMonitor di 6750-6760 | Situs asli `:6213` (bubble shareloc) & `:6724` (panel detail) |
| V5 | Label di geoUtils 258-268 | Label di `:263`; helper `getGoogleMapsDirectionUrl` (`:296`) SUDAH persis seperti yang plan minta |
| V6 | 13 ghost / 16 desync | Kini **14 / 11** (drift wajar; rincian §1.3). Substansi valid |
| V7 | Runbook `docker exec ... npx tsx scripts/heal...` + `docker compose restart` | **GAGAL total**: image prod tanpa `tsx`/`scripts/`; `restart` tak memuat kode baru |

## TAHAP 1: Fondasi Domain & Data Healing (pertama — tanpa dependensi)

### Mikro 1.1: Test adversial domain (TDD, Red dulu)
- **File baru:** `tests/unit/customer-saved-addresses-enrichment.test.ts`
- **Kasus (varian data nyata, bukan hafalan kalimat):**
  1. Entri `{address:"", kelurahan:"Waru", kecamatan:"Waru"}` + input
     `{address:"Jl. Melati 5", kelurahan:"Waru", kecamatan:"Waru"}` → SATU
     entri (merge), `isPrimary` tetap true, teks jalan terisi.
  2. Cermin: entri ber-jalan + input area-sama-tanpa-jalan → merge, jalan lama
     TIDAK terhapus.
  3. Dua rumah beda jalan satu kecamatan (keduanya ber-teleks) → TETAP 2 entri
     (anti-regresi pemisah rumah-2).
  4. Koordinat <150 m beda teks → merge (aturan lama, kunci).
  5. `ensureSinglePrimary`: ghost (primary kosong + sekunder isi) → primary
     pindah ke entri isi.
- **Kriteria:** merah sebelum 1.2, hijau sesudah. Gate:
  `npx vitest run tests/unit/customer-saved-addresses-enrichment.test.ts tests/unit/customer-saved-addresses.test.ts`

### Mikro 1.2: Perbaikan `addressesMatch` (domain murni, tanpa DB)
- **File:** `src/domain/customer-address.ts:100-118`
- **Spesifikasi:** tambah cabang ASIMETRIS — bila tepat satu sisi kosong
  (`!aAddr !== !bAddr`) TAPI `sameKel && sameKec` → `true` (pengayaan rumah
  yang sama). Kedua sisi ber-teleks beda jalan → tetap false (rumah-2 aman).
  Kedua sisi kosong → aturan lama (116). Cabang merge `upsertAddressIntoList`
  (`:194-223`) TIDAK diubah (sudah preservasi `prev.isPrimary` + merge teks).
- **Kriteria:** gate 1.1 hijau; tidak ada perubahan perilaku untuk kasus 3-4.

### Mikro 1.3: Skrip healing + otoritas deterministik
- **File:** `src/scripts/heal-customer-addresses-split-brain.ts` (di `src/` agar
  terkompilasi ke `dist/` dan bisa jalan di image prod via `node`; flag
  `--dry-run` default / `--commit` eksplisit, sesuai konvensi `src/scripts/`)
- **Aturan otoritas (final, tanpa "atau sebaliknya" kabur):** sumber kebenaran =
  sisi yang memegang `manual_staff` **BESERTA koordinat**; ghost primary =
  baris `is_primary` + `address` kosong → pindahkan ke baris terisi
  (skor: ada teks jalan + ada koordinat + `last_used_at` terbaru).
- **Pasangan di luar tabel di bawah → MODE LAPOR SAJA (read-only):**

  | customers | address primer | Aksi |
  |---|---|---|
  | manual_staff + koordinat | estimated/NULL | tulis koordinat+sumber customers → baris address |
  | estimated | manual_staff + koordinat | tulis koordinat+sumber address → baris customers |
  | keduanya tanpa koordinat | apa pun | LAPOR SAJA, tanpa tulis |
  | ghost primary, ada baris isi | — | pindahkan `is_primary` ke baris isi |
  | ghost primary, semua kosong | — | LAPOR SAJA |
- **Wajib:** flag `--dry-run` (default; cetak aksi per baris), `--apply` eksplisit,
  idempoten (rerun kedua = 0 tulis), backup `pg_dump -t customer_addresses -t customers`
  sebelum apply. Hitung ulang angka (§V6) saat eksekusi karena data bergerak.
- **Eksekusi PROD (lihat Runbook):** via `node dist/...` hasil build ATAU
  container sekali-pakai dengan mount `scripts/` — BUKAN `docker exec npx tsx`.

## TAHAP 2: Atomisitas Dual-Write & Proteksi Alamat (setelah Tahap 1)

### Mikro 2.1a: Endpoint lokasi delegasi ke seam kanonis (BUKAN $transaction inline)
- **File:** `src/routes/admin/customers.subroute.ts:1085-1300`
- **Spesifikasi:** route HANYA menangani media (foto/watermark/validasi
  45 km/25 km). Seluruh tulis koordinat + preferences + tabel address
  DIDELEGASIKAN ke `customerService.updateCustomerLocation()` (`src/services/customer.service.ts:252`,
  sudah: guard GPS, history, audit, sync Google Contacts, `syncSavedAddressFromLocation`
  → dual-write tabel). DILARANG membuat implementasi `$transaction` kedua di route
  (Kontrak Kanonis Tunggal). Bila butuh field baru, perluas seam service, bukan route.
- **Kriteria:** PUT lokasi oleh admin → `customers` + `customer_addresses` berubah
  dalam satu panggilan; tidak ada tulis langsung `prisma.customerAddress` baru di route.

### Mikro 2.1b: Lubang kedua — edit profil (temuan audit, tak ada di plan asli)
- **File:** `src/services/customer.service.ts:956-1232` (`updateCustomer`)
- **Spesifikasi:** bila `address/kelurahan/kecamatan/kota/lat/lng` berubah, teruskan
  ke `syncSavedAddressFromLocation` (upsert primary) — saat ini hanya JSON
  `preferences.address` yang ditulis. Test: edit jalan via profil → baris tabel ikut.
- **Gate Tahap 2:** suite dispatch + profile-drift plan asli
  (`dispatch-visit-context-frontend-mirror`, `customer-profile-edit-drift`) + 1 test
  baru dual-write endpoint lokasi (mock prisma, assert dua tabel ditulis).

### Mikro 2.2: Helper tunggal anti-timpa (3 situs, bukan 2)
- **File:** `src/services/staff-reservation.service.ts` — `getTodayTasks` (`:620-640`),
  `getUpcomingSchedule` (`:946-962`), `getCompletedTasks` (`:1146-1164`)
- **Spesifikasi:** ekstrak `buildEffectiveTaskAddress(addr, cust)` (satu fungsi,
  anti-spaghetti): `address = trim(addr.address || cust.preferences.address || cust.address)`,
  `landmark = addr.landmark || cust.preferences.landmark`; tiga situs memanggilnya.
  Kriteria: reservasi ber-alamat-kosong tak lagi menghapus jalan profil; test mirror ada.

## TAHAP 3: Penutupan Link Mentah (setelah Tahap 2; dashboard butuh rebuild image)

### Mikro 3.1: Notifikasi staf reuse `buildMapsUrls`
- **File:** `src/services/staff-notification.service.ts` — H-30 (`:170-180`) & penugasan (`:860-870`)
- **Spesifikasi:** hapus template inline; panggil `buildMapsUrls(lat, lng, addrEntity?.location_source ?? cust?.location_source, addressText)` (sudah export).
  Test: sumber estimasi + teks → URL teks; `gps_pin` → byte-identik lama.

### Mikro 3.2: Dashboard — 8 situs, satu pola (helper 4-arg, bukan template)
- `ReservationDetailModal.tsx:~553`: link Maps → `getGoogleMapsDirectionUrl(lat, lng, addressText, locationSource)` + tambah `AccuracyBadge` di "Panduan Lokasi & Foto Rumah".
- `LiveChatMonitor.tsx:6213`: bubble shareloc → helper + teks (`locData.name/address`, source `gps_pin`).
- `LiveChatMonitor.tsx:6724`: panel detail → helper + `preferences.address` + `location_source`.
- `CustomerDatabase.tsx:1274`, `TodayTreatments.tsx:1967/2061`, `Reservations.tsx:2007`: lengkapi argumen teks+sumber yang sudah tersedia di scope.
- `CustomerMapTab.tsx:56`: HAPUS fungsi lokal bayangan, impor kanonis dari `utils/geoUtils`.
- **Kriteria:** `npx vitest run tests/unit/navigation-accuracy-preflight.test.ts` + `npm run build --prefix packages/admin-dashboard` hijau.

## TAHAP 4: Taksonomi, AI State-Gated & Contacts (terakhir)

### Mikro 4.1: Label (setuju apa adanya)
- **File:** `packages/admin-dashboard/src/utils/geoUtils.ts:~263` — `isDbCoords`:
  `"🟡 Koordinat Tersimpan"` → `"🟡 Estimasi (Titik DB)"`. Copy UI, risiko rendah.

### Mikro 4.2: REVISI TOTAL — pruning deterministik, BUKAN tukar kalimat prompt (menolak plan asli)
- **Larangan:** mengganti teks `DILARANG...` dengan teks izin = make-up (mandat).
- **File & spesifikasi (3 potong kode, tanpa hafalan kalimat):**
  1. `src/v3/domain/types.ts:18-27` — tambah `locationSource?: string | null` ke `LocationState`.
  2. `src/v3/state/goal-tracker.ts:~206` — hidrasi `locationSource: conv.customer.location_source` (kolom DB sudah ada; merge `:269` meneruskannya otomatis).
  3. `src/v3/state/goal-tracker.ts:456-460` — ganti SATU baris `locStatus` dengan cabang state ( information hiding: hanya SATU cabang terkirim per status):
     - `gps_pin` → pertahankan semantik "sudah diketahui" TANPA kata larangan absolut;
       contoh arah (prompt lapis sekunder): lokasi presisi tercatat.
     - `estimated_area`/null → JANGAN kirim blok "SUDAH DIKETAHUI"; kirim blok
       "Estimasi wilayah — bila customer sepakat booking, minta shareloc WA terkini".
     - `savedAddresses.length > 1` → pertahankan cabang konfirmasi pilihan rumah yang sudah ada.
- **Kriteria:** test state-gate (3 status × assert blok yang terkirim/ter-prune) + suite guardrail terkait hijau. Prompt hanya lapis sekunder; gerbangnya kode.

### Mikro 4.3: Alamat jalan di Google Contacts (setuju, presisi sumber)
- **File:** `src/services/google-contacts-formatter.ts:180-182` — susun
  `[customer.address || preferences.address || full_address, kelurahan, kecamatan, kota]`
  (hilangkan duplikat case-insensitive bila jalan sudah mengandung kelurahan).
  Kriteria: test formatter (jalan ada/tidak ada/duplikat).

## GERBANG REGRESI PENUH (sebelum push)

1. `npm run build` (exit 0).
2. `npm run build --prefix packages/admin-dashboard` (dist baru — WAJIB karena dibake ke image).
3. `npx vitest run tests/unit/customer-saved-addresses-enrichment.test.ts tests/unit/customer-saved-addresses.test.ts tests/unit/navigation-accuracy-preflight.test.ts tests/unit/dispatch-visit-context-frontend-mirror.test.ts tests/unit/customer-profile-edit-drift.test.ts` — 100% hijau.
4. Full suite tanpa failure baru (klaim pre-existing wajib revert-and-rerun).

## RUNBOOK DEPLOY (menggantikan runbook plan asli yang gagal)

1. `git pull` + `docker compose build app worker` (dashboard sudah termasuk via COPY dist — pastikan langkah 2 gerbang dikerjakan DULU).
2. Backup: `pg_dump -t customer_addresses -t customers` (server, simpan di `backups/`).
3. Healing: `--dry-run` → review baris → `--apply` via `node dist/scripts/...` hasil build (atau container sekali-pakai mount `scripts/`); rerun = 0 tulis.
4. `docker compose up -d --build app worker` (BUKAN `restart`; migrasi tak perlu — tanpa perubahan skema).
5. Verifikasi: `/health` OK; profil Bunda Mery & Bunda Sifa sinkron (Admin + StaffToday + link Maps); 1 pesan uji navigasi estimasi → URL teks.
6. Rollback: restore dump + `up -d --build` image sebelumnya; catat di `KNOWN_ISSUES.md`.
