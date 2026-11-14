# Revisi Alur Alamat Reservasi + Riwayat Live Chat (2026-11-14)

> **Ruang lingkup:** dashboard `CreateReservationModal`, `LiveChatCustomerModal`, `AddressBookDrawer`, satu guard backend lifecycle reservasi.
> **Di luar lingkup:** skema DB baru, endpoint baru, perubahan WAHA, perubahan billing/series.
> **Dasar temuan:** `docs/KNOWN_ISSUES.md` #337, #338, #339.

## 0. Kontrak perilaku yang disepakati

Alamat **kartu** adalah satu-satunya sumber kebenaran saat kartu tersedia.

1. Modal dibuka → kartu default (primary, atau `customer_address_id` reservasi saat edit) otomatis terpilih → kolom alamat/landmark/ongkir **mengikuti kartu**.
2. Tidak klik apa pun → simpan memakai kartu default. **Tidak ada badge, tidak ada flag tertunda, tidak ada pilihan paksa.**
3. **“+ Tambah Alamat”** → `AddressBookDrawer` mode tambah (form lengkap) → simpan **seketika** → kartu baru otomatis terpilih.
4. **“Ubah Alamat Kartu”** → `AddressBookDrawer` mode edit kartu terpilih → simpan → kolom ikut berubah.
5. Jika customer **belum punya kartu**: kolom alamat tetap bisa diketik (jalur bootstrap), tanpa badge. Tombol “+ Tambah Alamat” tetap tersedia.
6. Teks alamat di luar dua aksi di atas tidak bisa diketik → mustahil ada “teks beda dengan kartu”.

---

## F0 — Baseline & pengaman (read-only)

| # | Aksi | Acceptance |
|---|---|---|
| 0.1 | `git rev-parse --short HEAD` (harus `484ccc42` atau lebih baru) | tercatat di log kerja |
| 0.2 | `npx tsc --noEmit` root + dashboard, `npm run verify:backlog` | 0 error / PASS sebagai baseline |
| 0.3 | Catat nomor baris anchor: `CreateReservationModal.tsx` 257-300, 348-384, 662-700, 1772-1775, 2254-2335, 3624-3659 | dipakai sebagai acuan; verifikasi ulang sebelum edit |

**Tidak ada perubahan file pada fase ini.**

---

## F1 — Riwayat reservasi Live Chat informatif (#337)

**Blast radius:** 1 komponen + 1 util baru + 1 test. Tidak menyentuh API.

| # | File | Perubahan |
|---|---|---|
| 1.1 | `packages/admin-dashboard/src/utils/reservationHistory.ts` **(baru)** | Export `buildReservationHistorySummary(r)` → `{ title, schedule, meta }`. `title = getCleanTreatmentName(r.treatment_detail \|\| r.raw_text)`; `schedule = formatWib(r.booking_date, { dateStyle: 'medium' })` + `formatWibClock(r.booking_date).replace('.', ':')`; `meta = [assigned_staff?.name, purchase_value ? Rp… : null].filter(Boolean).join(' · ')`. Tanggal kosong → `'Tanpa jadwal'`. |
| 1.2 | `tests/unit/reservation-history-label.test.ts` **(baru)** | Test: (a) `treatment_detail` kotor → judul bersih; (b) `booking_date` → jam WIB; (c) field kosong → `'Layanan Perawatan'` + `'Tanpa jadwal'`; (d) terapis + nominal muncul di `meta`. |
| 1.3 | `packages/admin-dashboard/src/components/livechat/LiveChatCustomerModal.tsx:263` | Ganti ekspresi `r.treatment_name \|\| … \|\| 'Layanan'` menjadi `history.title`. |
| 1.4 | `…LiveChatCustomerModal.tsx:271` | Ganti `formatWib(...) • {r.booking_time}` menjadi `history.schedule`. |
| 1.5 | `…LiveChatCustomerModal.tsx` setelah baris 272 | Tambah baris kecil `history.meta` (terapis · nominal) hanya bila tidak kosong. |

**Gerbang fase:** `npx vitest run tests/unit/reservation-history-label.test.ts` hijau; dashboard `tsc` 0.

---

## F2 — Perluas `AddressBookDrawer` (reusable seam)

**Blast radius:** 1 komponen, aditif (prop opsional), tidak mengubah perilaku pemanggil lama (`CustomerDatabase`, dll).

| # | File | Perubahan |
|---|---|---|
| 2.1 | `packages/admin-dashboard/src/components/customer/AddressBookDrawer.tsx:54-59` | Tambah prop opsional: `initialNewAddress?: { address?: string; landmark?: string } \| null` dan `onSaved?: (card: SavedAddress \| null) => void`. |
| 2.2 | `…AddressBookDrawer.tsx` setelah effect `initialEditingCardId` (~baris 151-160) | Effect baru: bila `initialNewAddress` ada → `setShowAddForm(true)`, prefill `newAddress`/`newLandmark` (sekali per pembukaan, guard ref). |
| 2.3 | `…AddressBookDrawer.tsx` handler simpan alamat baru (~baris 321-355) | Tangkap respons: `const res = await apiRequest(...)` → `const savedCard = (res as any)?.entry ?? null`. Panggil `onSaved?.(savedCard)` **sebelum** `onChanged?.()`. Response POST `/customers/:id/addresses` mengembalikan `{ success, entry }`. |
| 2.4 | `…AddressBookDrawer.tsx` handler edit (~baris 392-411) | Sama: gunakan `(res as any)?.entry` (PUT mengembalikan `{ success, entry }`), lalu `onSaved?.(updatedCard)` sebelum `onChanged?.()`. |

**Gerbang fase:** dashboard `tsc` + build hijau; buka Address Book dari Customer Database tetap berfungsi (uji manual).

---

## F3 — Util kontrak pemilihan alamat (test-first)

**Blast radius:** 1 util baru + 1 test. Belum menyentuh komponen.

| # | File | Perubahan |
|---|---|---|
| 3.1 | `packages/admin-dashboard/src/utils/reservationAddressSelection.ts` **(baru)** | `resolveReservationAddress({ cards, selectedCardId, fallbackText, fallbackLandmark })` → `{ card, address, landmark, ongkir }` dengan urutan: kartu `selectedCardId` → kartu `isPrimary` → kartu pertama → fallback teks (hanya bila `cards.length === 0`). Juga `isAddressFormLocked(cards) => cards.length > 0`. |
| 3.2 | `tests/unit/reservation-address-selection.test.ts` **(baru)** | Kasus: (a) kartu terpilih menang atas teks; (b) tanpa pilihan → primary; (c) tanpa primary → kartu pertama; (d) tanpa kartu → teks fallback; (e) kartu `address` kosong → fallback teks; (f) `isAddressFormLocked` benar hanya bila ada kartu. |
| 3.3 | Jalankan test | **Harus merah** sebelum F4 (red-green). |

**Gerbang fase:** test F3 merah karena util belum dipakai; setelah F4 harus hijau.

---

## F4 — Sederhanakan `CreateReservationModal` (inti revisi)

**Blast radius:** 1 komponen besar; hapus 3 state + 1 gate, tambah 2 tombol dan 1 drawer-mode. Tidak ada perubahan API.

| # | Anchor (baris saat plan disusun) | Perubahan |
|---|---|---|
| 4.1 | state 255-259 | Hapus `savedAsNewHouse`, `correctingCardId`; ganti `showAddressDrawer: boolean` → `addressDrawerMode: 'add' \| 'edit' \| null`. |
| 4.2 | memo 282-300 | Hapus `mismatchComputed` & `mismatchActive` (badge tidak dipakai lagi). |
| 4.3 | effect prefill 348-371 | Pakai `resolveReservationAddress(...)`: tentukan kartu target lebih dulu (`initialReservation?.customer_address_id` → primary → pertama), lalu isi `address`/`landmark`/`ongkir` dari kartu. Teks chat/root hanya dipakai bila `cards.length === 0`. |
| 4.4 | effect kartu 374-384 | Reset `customerAddressId` saat `customerId` berubah (`setCustomerAddressId(null)` sebelum memilih), lalu pilih kartu default. Setelah `authoritativeAddresses` tiba, sinkronkan ulang alamat (tambah dep `savedAddresses`). |
| 4.5 | reset 662-700 | Hapus reset `savedAsNewHouse`/`correctingCardId`, ganti reset `addressDrawerMode = null`. |
| 4.6 | gate submit 1772-1775 | Hapus total. Ganti dengan guard defensif: bila `savedAddresses.length > 0 && !customerAddressId` → `toast('Pilih alamat dulu', 'error')` + buka drawer mode `add`. |
| 4.7 | UI 2254-2335 | Bila `savedAddresses.length > 0`: input alamat/landmark menjadi `readOnly` (gaya `bg-surface-2`), tombol **“+ Tambah Alamat”** dan **“Ubah Alamat Kartu”** (aktif bila ada kartu terpilih). Bila tidak ada kartu: input tetap editable + tombol **“+ Tambah Alamat”**. Hapus chip “Akan disimpan sebagai rumah baru”, “Kartu sedang diperbarui”, dan badge mismatch. |
| 4.8 | daftar kartu 2183-2199 | Ganti handler “+ Alamat Baru Untuk Jadwal Ini” → `setAddressDrawerMode('add')` (tidak lagi menyetel flag). |
| 4.9 | kartu 2213-2224 | Tetap: klik kartu → set `customerAddressId` + salin alamat/landmark/ongkir (sudah benar). |
| 4.10 | drawer 3624-3659 | Kirim `initialNewAddress` saat mode `add`, `initialEditingCardId` saat mode `edit`; `onSaved(card)` → refetch `/customers/:id`, set `selectedCustomerInfo`, pilih `card.id`, salin alamat/landmark/ongkir, tutup drawer. |
| 4.11 | draft restore 643-645 | Setelah `setCustomerAddressId`, jika kartu ditemukan → alamat/landmark dari kartu (mencegah draft membawa teks stale). |

**Acceptance criteria (wajib):**
1. Customer 2 kartu, root ≠ kartu → kolom berisi alamat kartu primary, **tidak ada badge**.
2. Klik simpan tanpa menyentuh alamat → payload `customerAddressId` = kartu primary.
3. Klik “+ Tambah Alamat” → drawer terbuka dengan form tambah; simpan → kartu baru muncul & terpilih; kolom ikut berubah.
4. Klik “Ubah Alamat Kartu” → form edit kartu; simpan → kolom ikut berubah.
5. Ganti customer di modal yang sama → pilihan kartu ter-reset ke kartu customer baru.
6. Customer tanpa kartu → kolom bisa diketik, tidak ada badge, simpan tetap jalan.

**Gerbang fase:** test F3 hijau, dashboard `tsc` 0, `npm run build` OK, `npm run check:design` hijau.

---

## F5 — Guard backend anti kartu duplikat/parsial (#339)

**Blast radius:** 1 service + test. Tidak mengubah kontrak route.

| # | File | Perubahan |
|---|---|---|
| 5.1 | `src/services/reservation-lifecycle.service.ts` import | Tambah `import { normalizeAddressText } from '../domain/customer-address/matching';` |
| 5.2 | `…reservation-lifecycle.service.ts:80-125` | Sebelum `upsertSavedAddress`: hitung `sameAsRoot = normalizeAddressText(address) === normalizeAddressText(currentCust.preferences?.address)`. Bila `sameAsRoot` → **skip upsert** (root sudah memegang alamat itu), lanjut ke blok zipcode/distance seperti biasa. |
| 5.3 | idem | Guard kedua: bila `!kecamatan && !kelurahan && !kota` **dan** customer sudah punya kartu/alamat → skip upsert + `console.warn('[RESERVATION LIFECYCLE] tolak kartu parsial tanpa wilayah')`. Mencegah kartu “teks jalan saja” (ongkir/jarak 0). |
| 5.4 | `tests/unit/reservation-lifecycle-address-guard.test.ts` | Tambah 2 kasus: (a) teks alamat == root → `upsertSavedAddress` TIDAK dipanggil; (b) tanpa kartu + alamat beda + wilayah kosong + root ada → TIDAK dipanggil; (c) regresi: alamat beda + wilayah lengkap → tetap dipanggil. |

**Gerbang fase:** `npx vitest run tests/unit/reservation-lifecycle-address-guard.test.ts` hijau; `npx tsc --noEmit` root 0.

---

## F6 — Dokumentasi & gerbang akhir

| # | Aksi |
|---|---|
| 6.1 | `docs/KNOWN_ISSUES.md`: #337, #338, #339 → **RESOLVED** + commit/migrasi/bukti test. |
| 6.2 | `docs/FEATURE_INVENTORY.md`: baris changelog 2026-11-14 (alur alamat kartu-first + riwayat LiveChat). |
| 6.3 | `CHANGELOG.md` + regenerate `docs/changelog/INDEX.md` (`node scripts/make-changelog-index.mjs --write`). |
| 6.4 | `docs/audit/2026-11-10/backlog-evidence.json`: geser `line` yang terdampak (`verify:backlog` akan menunjukkannya). |

**Gerbang akhir (wajib sebelum commit):**

```bash
npx tsc --noEmit                                  # root
npm run build                                     # root
npm run verify:backlog                            # PASS
npx vitest run tests/unit/reservation-history-label.test.ts \
  tests/unit/reservation-address-selection.test.ts \
  tests/unit/reservation-lifecycle-address-guard.test.ts \
  tests/unit/admin-rbac-guard.test.ts \
  tests/unit/tenant-settings-endpoint.test.ts     # hijau
cd packages/admin-dashboard && npx tsc --noEmit && npm run build && npm run check:design
npm test                                          # full suite: 2 gagal pre-existing #287 saja
```

---

## F7 — Deploy (butuh izin terpisah)

**Catatan:** perubahan dashboard dibangun ke dalam image (tidak ada dist terpisah di server), dan migrasi RBAC #324/#325 (`20261114160000_seed_staff_operational_read_scopes`) belum diterapkan.

| # | Aksi | Verifikasi |
|---|---|---|
| 7.1 | `pg_dump` + tag image `wa-clinic-bot-app:pre-addressfix` | file dump + tag ada |
| 7.2 | `git pull` server ke commit revisi | `git rev-parse` cocok |
| 7.3 | `prisma migrate deploy` (1 migrasi RBAC) | `migrate status` up to date, drift hanya objek pre-existing |
| 7.4 | `docker compose build app worker` + `up -d app worker` | app healthy |
| 7.5 | Uji live: buka modal customer 2 kartu (root ≠ kartu) | kolom = alamat kartu, **tanpa badge**; simpan tanpa klik → reservasi memakai kartu |
| 7.6 | Uji live: “+ Tambah Alamat” → simpan → kartu baru terpilih | kartu muncul + kolom berubah |
| 7.7 | Uji live: riwayat di Live Chat | nama treatment + jam + terapis tampil |
| 7.8 | Cek log 10 menit | tidak ada `[RBAC SCOPE GUARD] Blocked … /roles` maupun `/tenant-settings` |

**Rollback:** `docker tag wa-clinic-bot-app:pre-addressfix wa-clinic-bot-app:latest` + `docker compose up -d app`; migrasi RBAC bersifat aditif (5 baris izin baca) dan aman dibiarkan.

---

## Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Komponen form besar (3.6k baris) — salah hapus state memutus fitur lain | Hapus bertahap + `tsc`; draft restore & multi-sesi diuji manual |
| Drawer dipakai halaman lain | Perubahan hanya prop opsional + callback; pemanggil lama tidak berubah |
| Guard lifecycle menolak kartu sah | Guard hanya aktif bila wilayah kosong **dan** root sudah ada; kasus wilayah lengkap tetap di-upsert (test regresi) |
| Backlog evidence bergeser lagi (#334) | Dijalankan di F6, bukan setelah deploy |

## Estimasi

| Fase | File | Perkiraan |
|---|---|---|
| F1 | 1 util + 1 test + 1 komponen | ~90 LOC |
| F2 | 1 komponen | ~35 LOC |
| F3 | 1 util + 1 test | ~120 LOC |
| F4 | 1 komponen | ~200 LOC (net −60 karena state/gate dihapus) |
| F5 | 1 service + test | ~40 LOC |
| F6 | dokumen | ~60 baris |
