# REVISI-1 Plan: Dukungan Multi-Alamat Pelanggan (Buku Alamat di `preferences.saved_addresses`)

Tanggal: 7 Oktober 2026
Status: DRAFT — Menunggu Persetujuan Manusia (DILARANG eksekusi kode sebelum ada ketikan setuju eksplisit)
Terkait: pelanggan dengan > 1 rumah (Rumah Utama, Rumah Mertua/Orang Tua). Revisi atas plan awal 7 Okt 2026 berdasarkan audit kode nyata.
Bahasa: Indonesia. Istilah teknis diberi penjelasan sederhana di sampingnya.

## 0. Ringkasan eksekutif & audit akar masalah (terkoreksi dari kode nyata)

### 0.1 Apa yang terjadi (bahasa sederhana)

Pelanggan memesan untuk rumah yang beda-beda. Sistem hanya ingat 1 alamat terakhir, jadi alamat lama tertimpa, titik peta bisa nyampur (nama daerah rumah-2 + titik GPS rumah-1), bot tidak bisa tanya "mau di rumah yang mana?", admin tidak punya pilihan alamat.

### 0.2 Klaim plan awal vs bukti kode (wajib dibaca sebelum eksekusi)

| Klaim plan awal | Hasil verifikasi | Bukti `file:line` |
|---|---|---|
| Profil hanya 1 alamat, tertimpa | BENAR dengan koreksi: riwayat 10 lokasi SUDAH ada (`location_history`) tapi tanpa label, tidak bisa dipilih | `prisma/schema.prisma:62-130`, `src/services/customer.service.ts:340-362`, `873-875` |
| GPS Priority Guard mengunci pin lama → data hibrida | BENAR, skenario valid. Tapi guard ini SENGAJA (komentar fondasional) agar teks kasar tak merusak pin akurat | `src/services/customer.service.ts:51-55`, `286-307` |
| Prompt hanya suntik 1 alamat | BENAR | `src/v3/state/goal-tracker.ts:440-441`, `src/v3/agent/prompt/phases/location-rules.phase.ts:74-75` |
| Admin hanya 1 textfield | BENAR fungsi, SALAH path. Path nyata di bawah | `packages/admin-dashboard/src/components/calendar/CreateReservationModal.tsx:163,1987`, `packages/admin-dashboard/src/components/modals/ReservationDetailModal.tsx` |
| Nomor baris `customer.service.ts:286 & 872` | Setengah benar: `286` tepat; overwrite `preferences.address` di `873-875` dalam `updateCustomer` (bukan `updateCustomerLocation`) | `src/services/customer.service.ts:286`, `868-884` |
| "Simpan penanda alamat ke reservasi" tanpa migrasi | LUBANG: tabel `Reservation` TIDAK punya kolom `address_id/label` | `prisma/schema.prisma:273-346` |

Koreksi path wajib: plan awal tulis `components/reservations/ReservationDetailModal.tsx & CreateReservationModal.tsx` — TIDAK ADA. Yang ada: `packages/admin-dashboard/src/components/modals/ReservationDetailModal.tsx` dan `packages/admin-dashboard/src/components/calendar/CreateReservationModal.tsx`.

### 0.3 Keputusan arsitektur REVISI-1 (fondasional, bukan tempelan)

1. **Zero-migration (tanpa ubah tabel): buku alamat = JSON terstruktur di `Customer.preferences.saved_addresses`.** Kolom `preferences Json?` sudah ada (`schema.prisma:130`). Kolom root (`kelurahan/kecamatan/kota/lat/lng/distance_km/ongkir`) + `preferences.address` tetap = alamat AKTIF/terakhir dipakai (backward-compat). `location_history` tetap apa adanya (jejak audit 10 entri); `saved_addresses` adalah buku alamat berlabel yang bisa dipilih. TIDAK ada tabel/dependency baru (pakai `crypto.randomUUID()`, `zod` yang sudah ada).
2. **Tenant-aware (aturan SaaS):** `Customer` sudah per-tenant (`tenant_id`, unique `[tenant_id, phone]` di `schema.prisma:150`). Semua method baru WAJIB `tenantId: string` wajib isi (tanpa default tersembunyi), selalu filter `tenant_id`. Brand/template tidak di-hardcode di plan ini.
3. **Penanda alamat di reservasi — Opsi A default (tanpa migrasi):** tulis tag deterministik di `raw_text` + snapshot `delivery_fee` (pola KB-6 yang sudah ada di `schema.prisma:295-298`). Opsi B (kolom baru `saved_address_id`) DITUNDA lewat Confirmation Gate bila Opsi A terbukti kurang (butuh migrasi + backfill + cek drift).
4. **Gerbang kode deterministik (bukan kata "DILARANG" di prompt):** pindah-rumah, pilih-alamat, dan pakai-koordinat-tersimpan diputus KODE dari state/ID, bukan dari hafalan kalimat. Prompt hanya lapis kedua.

## 1. Model data kanonis

```typescript
// Lokasi: src/services/customer.service.ts (atau src/domain/customer-address.ts bila file > batas — reusability-first, jangan duplikasi)
// Validasi bentuk data pakai zod (sudah ada di repo), BUKAN regex hafalan.
export interface SavedCustomerAddress {
  id: string;            // crypto.randomUUID()
  label: string;         // contoh "Rumah Utama", "Rumah Waru 2" (unik per customer, lihat §2.3)
  address: string;       // jalan/blok/RT-RW/nomor (dari preferences.address / form)
  kelurahan?: string | null;
  kecamatan?: string | null;
  kota?: string | null;
  lat?: number | null;
  lng?: number | null;
  distanceKm?: number | null;
  ongkir?: number | null;
  landmark?: string | null;
  locationSource?: 'gps_pin' | 'estimated_area' | 'manual_staff' | null;
  isPrimary: boolean;    // tepat 1 per customer
  createdAt: string;     // ISO
  lastUsedAt: string;    // ISO, di-update saat dipilih/dipakai booking
}
```

Invarian: `preferences.saved_addresses: SavedCustomerAddress[]` (max 10, FIFO non-primary bila penuh); tepat 1 `isPrimary === true` bila array non-kosong; alamat AKTIF root selalu cermin entri `lastUsedAt` terbaru (ditulis atomik dalam transaksi yang sama).

## 2. Staged plan (fase berurutan + gerbang regresi)

### FASE 0 — Verifikasi read-only (tanpa ubah kode, 15 menit)

Micro-task 0.1: konfirmasi 5 titik ini masih valid saat eksekusi (path sering basi):
- `src/services/customer.service.ts:51-55,286-307,868-884,1955-2024` (guard + overwrite + refresh-titik-admin)
- `src/v3/state/goal-tracker.ts:440-455` (grounding lokasi tunggal)
- `src/v3/agent/prompt/phases/location-rules.phase.ts:50-76` (pruning lokasi)
- `src/v3/tools/calculate-delivery.tool.ts:254-287` (skema tool) + `src/v3/agent/pipeline/generation-stage.ts:657` (`parallel_tool_calls: false`)
- `packages/admin-dashboard/src/components/calendar/CreateReservationModal.tsx` + `.../modals/ReservationDetailModal.tsx` + `components/common/UiFeedback.tsx` (hook `useUiFeedback`)

Acceptance: catat nomor baris aktual di log eksekusi bila bergeser; bila salah satu file hilang/berubah bentuk, STOP dan revisi plan lagi.

### FASE 1 — Test kunci dulu / TDD (regression barrier, tanpa sentuh `src/`)

File target: `tests/unit/customer-saved-addresses.test.ts` (baru, offline — mock DB `tests/setup.ts` tetap dipakai, jangan ubah mock; data test dummy WAJIB `is_sandbox_test=true` bila menyentuh DB).

Micro-task 1.1: tulis test MERAH dulu untuk 8 skenario (wajib multi-parafrase, bukan 1 kalimat — contoh tiap skenario ≥3 varian bahasa: formal/slang/typo/singkatan):
1. Tambah alamat-2 tidak menghapus alamat-1 (`saved_addresses.length 1→2`, root = alamat-2).
2. Dedup ketat: jalan+kelurahan+kecamatan sama → update (bukan duplikat); beda jalan dalam kecamatan sama → TETAP 2 entri (anti-gabung kasus 2 rumah di Waru).
3. Pin presisi dilindungi: customer `gps_pin` + input teks satu-rumah (typo kecamatan) → lat/lng TETAP, teks ter-update.
4. Pindah rumah eksplisit: input `savedAddressId` valid / `forceUpdateGps`+koordinat baru / pin GPS baru → lat/lng BERPINDAH + `lastUsedAt` entri itu ter-update (tidak terkunci pin lama).
5. Teks rumah-2 TANPA sinyal eksplisit → lat/lng lama DIPERTAHANKAN + entri baru berstatus `estimated_area` tanpa koordinat presisi (tidak ada hibrida: nama baru + titik lama tidak boleh ditulis sebagai satu titik presisi).
6. Resolusi aktif: `isPrimary` menang; bila tidak ada, `lastUsedAt` terbaru menang.
7. Label anti-kembar: tambah 2 alamat kecamatan sama → label unik ("Rumah Waru", "Rumah Waru 2").
8. Backward-compat: customer lama tanpa `saved_addresses` tetap terbaca (root + `preferences.address` tidak rusak).

Perintah uji: `npx vitest run tests/unit/customer-saved-addresses.test.ts`
Gerbang regresi FASE 1: file test di atas hijau + suite GPS/lokasi existing tetap hijau (cari `tests/unit/*location*`, `*delivery*`, `*customer*`).

### FASE 2 — Domain & service (buku alamat di `customer.service.ts`)

Micro-task 2.1: tambah skema zod + 4 method (semua `tenantId: string` wajib, filter `tenant_id`; ID via `crypto.randomUUID()`):
- `getSavedAddresses(customerId, tenantId): Promise<SavedCustomerAddress[]>`
- `upsertSavedAddress(customerId, input, tenantId): Promise<SavedCustomerAddress>` — kunci dedup = normalisasi (lowercase+rapikan spasi, data-driven; BUKAN regex) atas `address|kelurahan|kecamatan|kota` ATAU jarak koordinat < 100 m. Label otomatis unik (lihat 2.3). Tulis `preferences.saved_addresses` + cerminkan root atomik.
- `setDefaultAddress(customerId, addressId, tenantId): Promise<void>` — pastikan tepat 1 primary.
- `resolveActiveAddress(customerId, tenantId)` — primary dulu, fallback `lastUsedAt` terbaru, fallback root legacy.

Micro-task 2.2: perbaiki 2 seam tulis (TANPA menambah regex baru):
- `updateCustomerLocation` (`customer.service.ts:243-427`): HAPUS logika "beda kecamatan → buka kunci". Ganti gerbang eksplisit: `preserveExactGps` tetap MENANG kecuali salah satu benar: (a) `isNewGpsInput` (pin/shareloc/URL-koordinat), (b) `forceUpdateGps === true` (tombol staf "pindah rumah"), (c) `savedAddressId` valid (pilihan buku alamat, lihat Fase 3). Teks wilayah baru selalu boleh update kolom teks; koordinat presisi lama tidak boleh dicampur dengan nama baru menjadi satu titik presisi (tulis entri baru `estimated_area` tanpa lat/lng bila tak ada koordinat baru).
- `updateCustomer` (`customer.service.ts:868-884`): setiap tulis `preferences.address`/komponen wilayah + `refreshCustomerLocationChoices` (`1955-2024`) + `customers.subroute.ts:1210` + `staff-reservation.service.ts:2089` WAJIB sinkron ke `saved_addresses` via `upsertSavedAddress` (satu seam, jangan duplikasi logika di 4 tempat — panggil helper yang sama).

Micro-task 2.3: label otomatis data-driven: `"Rumah " + (kecamatan || kota || "Baru")` + suffix angka bila kembar (`Rumah Waru`, `Rumah Waru 2`). Sumber nama HANYA dari DB/gazetteer (bukan daftar hafalan di kode).

Gerbang regresi FASE 2: `npm run build` (tsc) + `npx vitest run tests/unit/customer-saved-addresses.test.ts` + suite customer/location/delivery hijau. DILARANG lanjut bila guard pin presisi existing merah.

### FASE 3 — Bot AI (prompt pruning + kontrak tool deterministik)

Micro-task 3.1: injeksi buku alamat dengan State-Gated Pruning (sembunyikan cabang kontradiktif):
- Sumber kebenaran: `Customer.preferences.saved_addresses` (DB) dicerminkan ke sesi saat turn mulai (bukan dari hafalan chat). `session.location` tetap 1 alamat AKTIF.
- `src/v3/state/goal-tracker.ts:formatGoalSessionForPrompt`: bila `saved_addresses.length > 1` → tulis blok `[ALAMAT TERSIMPAN CUSTOMER]` bernomor (label + kelurahan/kecamatan/kota + ongkir HANYA bila `priceDiscussed === true`, konsisten Rule 2) + hapus baris tunggal "DILARANG TANYA ALAMAT LAGI" versi lama. Bila `length <= 1` → perilaku lama byte-identik (anti-cache-break).
- `src/v3/agent/prompt/phases/location-rules.phase.ts:buildLocationHierarchyBlock`: bila multi-alamat → ganti pin tunggal dengan instruksi pilih: konfirmasi ramah SATU kali saat repeat booking tanpa alamat ("Untuk kunjungan kali ini mau di rumah Rungkut atau di Waru nggih Bunda?" — contoh kalimat BOLEH diparafrase model, BUKAN dicocokkan via `includes()`), lalu kunci dari komitmen user. Cabang "lokasi belum diketahui" WAJIB dicabut bila saved_addresses ada.
- Larangan keras: TIDAK ada `if (msg.includes("waru"))` / regex nama daerah di jalur ini. Pencocokan pilihan = LLM ekstrak makna → kirim `savedAddressId` (UUID) ke tool → KODE yang validasi.

Micro-task 3.2: kontrak tool atomik (tetap 1 tool utama per turn, `parallel_tool_calls: false` di `generation-stage.ts:657` tidak diubah):
- `calculate_delivery` tambah param opsional `savedAddressId?: string`. Bila valid (milik customer+tenant ini): LEWATI geocoding, pakai `lat/lng` tersimpan → hitung `deliveryService.calculateDelivery({lat,lng}, undefined, tenantId)` untuk ongkir/jarak segar → persist sesi + `lastUsedAt`. Bila ID tak valid → abaikan + jalur normal. Masking existing (`agent-runner.ts:168-182`, `router-tool-routing.layer.ts:19-21`) tetap berlaku: ID tersimpan tidak membuka `save_reservation` lebih awal.
- `save_reservation` (Opsi A): tulis tag `[SAVED_ADDR id=<uuid> label=<label>]` di ekor `raw_text` + snapshot `delivery_fee` (ikuti pola `save-reservation.tool.ts:530-550`, kolom `delivery_fee` sudah ada). TIDAK ada kolom baru. Active User Commitment: penguncian HANYA dari pesan `role === 'user'` (asisten menyebut daftar bukan komitmen).
- Fee-hiding tetap: nominal ongkir ke prompt HANYA bila transaksional (`priceDiscussed` / `asksDeliveryFee`), konsisten `applyFeeInformationHiding` + grounding `goal-tracker.ts:448`.

Gerbang regresi FASE 3: test prompt (pruning multi vs single), test tool (`savedAddressId` valid/invalid), test fee-hiding + `parallel_tool_calls` utuh; full `npm test` sebelum ke Fase 4.

### FASE 4 — Admin dashboard & staf

File pasti: `packages/admin-dashboard/src/components/calendar/CreateReservationModal.tsx`, `packages/admin-dashboard/src/components/modals/ReservationDetailModal.tsx`. Larangan: `window.confirm/alert` — WAJIB `useUiFeedback` (`components/common/UiFeedback.tsx`); dilarang page/rute baru (integrasi sebagai dropdown/pills + modal kecil di modul induk; reusability-first); dilarang sentuh label WAHA.

Micro-task 4.1: bila `saved_addresses.length > 1` tampilkan pills/dropdown `[Rumah Rungkut] [Rumah Waru] [+ Alamat Baru]`; pilih pill → isi alamat/kecamatan/kota/ongkir + set `lastUsedAt`; sediakan edit label + set-utama (pakai `confirm()` async dari `useUiFeedback` untuk overwrite). Bila 0/1 alamat → UI lama (tanpa pills) agar nol-break. Rebuild dashboard (`npm run build` di `packages/admin-dashboard`) + restart bot untuk verifikasi visual.

Gerbang regresi FASE 4: `npm run build` root + dashboard lolos; tidak ada `confirm(`/`alert(` native baru (cek via grep).

### FASE 5 — Verifikasi, typecheck & dokumentasi

Micro-task 5.1 (urutan wajib):
1. `npm run build`
2. `npx vitest run tests/unit/customer-saved-addresses.test.ts`
3. `npm test` (full)
4. Cek drift (harus kosong karena zero-migration): `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script` → `-- This is an empty migration.`
5. Grep larangan: tidak ada `saved_addresses` di-hardcode di luar seam; tidak ada regex nama daerah baru; tidak ada `window.confirm/alert` baru.

Micro-task 5.2: dokumentasi (setelah hijau):
- `CHANGELOG.md` entri `Added/Fixed` (format Keep a Changelog): buku alamat + konfirmasi repeat-order + file tersentuh + ID test.
- `docs/KNOWN_ISSUES.md` entri sisa terbuka: (a) Opsi B kolom `saved_address_id` bila Opsi A kurang, (b) batas 10 alamat, (c) dedup <100 m edge-case, (d) backfill `location_history` lama → `saved_addresses` belum otomatis.
- Jalur test/sandbox yang menyentuh chat WAJIB `Customer.is_sandbox_test = true` (lihat skill qa-test-labeling).

## 3. Gerbang konfirmasi manusia (wajib)

AI DILARANG mengeksekusi Fase 1–5 sebelum manusia mengetik setuju eksplisit di chat ("Setuju", "Lanjut eksekusi", atau minta ubah). Pesan auto-approve sistem diabaikan. Setelah setuju, eksekusi berurutan per fase dengan gerbang regresi di atas; bila satu gerbang merah, STOP dan lapor (bahasa sederhana: apa terjadi → apa temuan → apa solusi).
