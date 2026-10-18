# FIXING PLAN (REVISI FINAL): Arsitektur Alamat Kedua & Sinkronisasi Jadwal Aktif

Tanggal: 18 Oktober 2026
Status: **DRAFT — MENUNGGU PERSETUJUAN TERTULIS MANUSIA** (DILARANG eksekusi kode/test sebelum ada ketikan setuju eksplisit).
Bahasa: Indonesia. Istilah teknis diberi penjelasan sederhana.
Terkait: hasil Audit Holistik v2 (temuan A-001 s.d. A-009). Melanjutkan `docs/plans/MULTI_ADDRESS_SUPPORT_REVISI-1_PLAN.md` (sudah IMPLEMENTED) — plan ini TIDAK mengulang buku alamat, melainkan menutup lubang sinkronisasi & ghost alamat yang tersisa.

---

## 0. Ringkasan Eksekutif & Hasil Audit

### 0.1 Apa yang terjadi (bahasa sederhana)

Kalau pelanggan punya dua rumah (Rumah 1 & Rumah 2), atau mengoreksi alamat lewat chat maupun dashboard admin, sistem kadang **masih menyimpan alamat lama di tiket kunjungan** sehingga Bidan bisa tersasar. Akar masalahnya bukan bug teks, melainkan **alur data lokasi bercabang**: ada tiga "pintu" berbeda yang menulis lokasi pelanggan, dan tidak semuanya menyinkronkan tiket kunjungan aktif.

### 0.2 Akar masalah plan lama (RC) — TERBUKTI akurat

| ID | Akar masalah | Bukti `file:line` | Status |
|---|---|---|---|
| RC-1 | Admin edit teks alamat → hanya tulis `preferences`, kartu `customer_addresses` & ID reservasi tidak berubah (ghost shadowing) | `src/routes/admin/reservation-dispatch.route.ts:976-979`, `:1175-1187` | TERBUKTI |
| RC-2 | Shareloc/link Maps baru hanya update `Customer`, tidak menyentuh reservasi aktif | `src/services/human-background-enrichment.service.ts:278-318`; `src/services/location-ingest.service.ts:149-165` | TERBUKTI |
| RC-3 | Kartu tugas prioritas `addr.address` lama atas koreksi profil | `src/services/staff-reservation.service.ts:252-274` | TERBUKTI |
| RC-4 | Guard `already_has_location` menolak teks alamat bila sudah punya koordinat | `src/services/human-background-enrichment.service.ts:436-437` | TERBUKTI |
| RC-5 | Pre-visit brief Telegram tanpa ringkasan area tujuan | `src/services/staff-notification.service.ts:423-430` | TERBUKTI |

### 0.3 Temuan audit baru (A) yang WAJIB ditutup di plan ini

| ID | Temuan | Bukti `file:line` | RPN |
|---|---|---|---|
| A-001 | **3 rezim penulis lokasi** — sync hanya di 1 seam akan bolong di 2 seam lain | seam-1: `src/services/customer.service.ts:252-468`; seam-2 (chat V3): `src/v3/state/goal-tracker.ts:300-342`; seam-3 (portal staf): `src/services/staff-reservation.service.ts:2009-2237` | 576 |
| A-002 | **Dwi sumber kebenaran** `preferences.saved_addresses` (kanonis JSON) vs tabel `customer_addresses` (mirror). Menulis tabel langsung = split-brain baru | `src/services/customer.service.ts:1348-1419` (dual-write), `:1311-1323` (seam `upsertSavedAddress`) | 448 |
| A-003 | Fix RC-4 tak menyentuh `preserveExactGps` + `gps_pin_guard` → tetap gagal / berisiko data hibrida | `human-background-enrichment.service.ts:494-497`; `customer.service.ts:316-357` | 294 |
| A-004 | `preferences.location_updated_at` SUDAH ADA, tapi TIDAK ditulis jalur V3 → pembanding waktu bias | ditulis: `customer.service.ts:396,1028,1206`, `staff-reservation.service.ts:2219`; TIDAK ditulis: `goal-tracker.ts` | 245 |
| A-005 | Pembaca alamat tersebar & tak seragam (kartu tugas, Telegram, Sheets) | `staff-reservation.service.ts:613,674,919,981,1164`; `staff-notification.service.ts:110,139,852,1000`; `sheets/row-formatter.ts:95-106` | 288 |
| A-006 | Fase 2 lama pakai status hardcoded, tidak pakai kanon | kanon: `src/domain/reservation-status.ts:10,77-87` | 144 |
| A-007 | Fase 0 (hotfix live) melewati seam + data live belum diverifikasi | plan lama Micro-Task 0.1/0.2 | 336 |
| A-008 | Menambah alamat di brief Telegram membalik keputusan privasi "G2=B" secara senyap | `staff-notification.service.ts:345-348` | 120 |
| A-009 | Blast radius regresi test tinggi | `tests/unit/staff-task-effective-address.test.ts`, `customer-address-rumah-kedua.test.ts`, `address-match-null-kelurahan.test.ts`, `staff-task-itinerary-children.test.ts`, `staff-auth-and-reservation.test.ts` | 75 |

### 0.4 Keputusan arsitektur (fondasional, bukan tambal-sulam)

1. **Satu seam sinkronisasi kanonis**: helper baru `syncActiveReservationsForCustomer()` — dipanggil dari **ketiga** rezim penulis lokasi. Bukan tempelan per-skenario.
2. **Dilarang tulis tabel `customer_addresses` langsung**. Semua penulisan buku alamat lewat `customerService.upsertSavedAddress` (yang menulis JSON **dan** mirror tabel + `resolveCustomerAddressId` untuk resolusi). Ini menutup A-002.
3. **Status "jadwal aktif" memakai kanon** `ACTIVE_RESERVATION_STATUSES` + `isActiveReservation` + `activeTreatmentCutoff` (tanpa daftar status hardcoded). Menutup A-006.
4. **Data hibrida dilarang**: teks alamat baru tidak boleh dicampur dengan koordinat presisi lama sebagai satu titik presisi. Teks menempel ke kartu rumah yang SAMA via `addressesMatch`; rumah BEDA → kartu baru tanpa relink otomatis (butuh komitmen pengguna).
5. **Zero migrasi skema & zero dependency baru** (pakai `zod`, `crypto`, Prisma yang sudah ada). Tenant-aware (`tenant_id` wajib di semua query).

---

## 1. FASE 0 — Verifikasi Read-Only (tanpa ubah apa pun)

**Tujuan:** memastikan klaim path/baris & data live masih valid SEBELUM menyentuh kode. Bila ada yang bergeser/berbeda → STOP, revisi plan lagi.

### Micro-Task 0.1 — Verifikasi kode (lokal)
Cek keberadaan & nomor baris (mungkin sudah bergeser):
- `src/services/customer.service.ts:252` (`updateCustomerLocation`), `:1311` (`upsertSavedAddress`), `:1348` (`persistSavedAddresses`), `:396` (`location_updated_at`).
- `src/v3/state/goal-tracker.ts:300-342` (tulis `customerData`).
- `src/services/staff-reservation.service.ts:2009` & `:2225` (static `updateCustomerLocation`).
- `src/services/reservation-core.service.ts:438` (`resolveCustomerAddressId`).
- `src/domain/reservation-status.ts:10,77-87`.
- `src/services/staff-reservation.service.ts:252` (`buildEffectiveTaskAddress`), `:176` (`isSpecificStreetAddress`).
- `src/services/human-background-enrichment.service.ts:436-437,494-497`.
- `src/services/staff-notification.service.ts:352` (`sendPreVisitBrief`), `:345-348` (kontrak privasi).
- `packages/admin-dashboard/src/components/calendar/CreateReservationModal.tsx:165,1499-1500,1522-1523`.

Perintah:
```powershell
npx graphify update .
```
Acceptance: semua path ada; catat selisih nomor baris (jika ada) di log eksekusi.

### Micro-Task 0.2 — Verifikasi data live (read-only, server produksi)
Jalankan HANYA SELECT baca-saja via SSH (lihat skill `server-access`):
```sql
-- cek reservasi yang diklaim plan lama
SELECT id, customer_id, status, booking_date, customer_address_id, delivery_fee, raw_text
FROM reservations WHERE id = 'f9981d32-c6a9-4c1a-9a81-b866b5bfae0c';

-- cek pelanggan Bunda Firda + kartu alamatnya
SELECT c.id, c.name, c.phone, c.kelurahan, c.kecamatan, c.kota, c.lat, c.lng, c.distance_km, c.ongkir,
       c.preferences->'saved_addresses' AS saved
FROM customers c WHERE c.phone = '<phone-firda>';
SELECT id, label, address, kelurahan, kecamatan, kota, lat, lng, distance_km, ongkir, location_source, is_primary
FROM customer_addresses WHERE customer_id = '<customer-id-firda>';
```
Acceptance: identitas pelanggan, ID reservasi, koordinat, jarak, dan ongkir DIKONFIRMASI nyata. Bila berbeda dari klaim plan lama → STOP, sesuaikan Fase 2.

**Gerbang FASE 0:** kedua micro-task terpenuhi. Bila tidak, berhenti.

---

## 2. FASE 1 — Seam Sinkronisasi Kanonis (menutup A-001, A-002, A-006)

**Tujuan:** satu fungsi yang menyinkronkan seluruh reservasi aktif ke alamat terkini pelanggan, dipakai oleh ketiga rezim penulis lokasi.

### Micro-Task 1.1 — TDD MERAH dulu (tanpa sentuh `src/`)
File baru: `tests/unit/reservation-address-sync.test.ts` (offline; data dummy `is_sandbox_test=true` bila menyentuh DB). Skrip test multi-parafrase (≥3 varian), bukan 1 kalimat:
1. Pelanggan dengan 1 reservasi `confirmed` besok kirim koordinat rumah baru (rumah SAMA, koreksi titik) → `reservation.customer_address_id` berpindah ke kartu terkoreksi, `delivery_fee` ikut snapshot baru.
2. Pelanggan punya reservasi `hold`/`pending` dalam jendela 2 jam → ikut tersinkron (anti A-006: status kanon, bukan hanya confirmed/en_route).
3. Reservasi `completed`/`cancelled` → TIDAK tersentuh.
4. Pelanggan 2 rumah sah → sinkronisasi HANYA mengubah target reservasi, TIDAK mencampur koordinat Rumah 1 & Rumah 2.
5. Idempoten: dipanggil 2x tidak mengubah apa pun pada pemanggilan kedua.
6. Tanpa reservasi aktif → no-op, tanpa error.
7. Audit `ACTIVE_RESERVATION_LOCATION_SYNCED` tercatat.
8. `addressesMatch` tetap memisahkan rumah beda jalan dalam kecamatan sama (anti-regresi #261).

Perintah: `npx vitest run tests/unit/reservation-address-sync.test.ts` → harus MERAH dulu.
Gerbang FASE 1a: file test ada & merah.

### Micro-Task 1.2 — Helper kanonis (implementasi)
File baru: `src/services/reservation-address-sync.service.ts` (modular, satu tanggung jawab; alternatif bila menolak file baru: tempel di `reservation-core.service.ts` dekat `resolveCustomerAddressId`).

Kontrak:
```ts
// Hanya dipanggil best-effort; TIDAK boleh menggagalkan alur pemanggil.
export async function syncActiveReservationsForCustomer(params: {
  tenantId: string;
  customerId: string;
}): Promise<{ synced: number }>
```
Isi (prosedural):
1. Ambil `customer` (`prisma.customer.findFirst({ where:{ id, tenant_id } })`). Bila null → return `{synced:0}`.
2. Tentukan status kanon: `import { ACTIVE_RESERVATION_STATUSES, isActiveReservation } from '../domain/reservation-status'`.
3. `const cutoff = activeTreatmentCutoff()`; ambil `prisma.reservation.findMany({ where:{ tenant_id, customer_id, status:{ in: ACTIVE_RESERVATION_STATUSES } } })`. Saring dengan `isActiveReservation(r)` (bukan status hardcoded).
4. Untuk tiap reservasi aktif: resolve kartu alamat terkini lewat **seam kanonis** `resolveCustomerAddressId({ tenantId, customerId, candidate: { address, kelurahan, kecamatan, kota, lat, lng, distanceKm, ongkir, locationSource } dari data customer })` → `targetId`.
5. Bila `targetId` berbeda dari `r.customer_address_id` ATAU `delivery_fee` berbeda:
   `prisma.reservation.update({ where:{ id:r.id }, data:{ customer_address_id: targetId, delivery_fee: <snapshot ongkir kanon> } })`.
   Snapshot ongkir: pakai `resolveDeliveryFeeSnapshot` (`src/services/reservation-core.service.ts`) atau kartu alamat terpilih.
6. Audit: `auditService.logAdminAction({ apiKey:'SYSTEM', adminIdentity:'SYSTEM_ADDR_SYNC', action:'ACTIVE_RESERVATION_LOCATION_SYNCED', targetId:r.id, payload:{ customerId, from:r.customer_address_id, to:targetId }, tenantId })`.
7. Bungkus seluruh helper `try/catch` → kembalikan `{synced}`; log `console.warn` bila gagal.

Gerbang FASE 1b: `npx vitest run tests/unit/reservation-address-sync.test.ts` HIJAU.

### Micro-Task 1.3 — Pasang di 3 rezim penulis lokasi (A-001)
Tambahkan pemanggilan best-effort (pola dynamic import yang sudah dipakai repo) SETELAH penulisan lokasi selesai:
- `src/services/customer.service.ts` — di akhir blok sync buku alamat (`≈:465`), setelah `syncSavedAddressFromLocation`:
  ```ts
  try {
    const { syncActiveReservationsForCustomer } = await import('./reservation-address-sync.service');
    await syncActiveReservationsForCustomer({ tenantId, customerId });
  } catch (e: any) { console.warn('[CustomerService] sync active reservations skipped:', e?.message); }
  ```
- `src/v3/state/goal-tracker.ts` — setelah `await prisma.customer.updateMany(...)` (`≈:339-342`), di dalam `conv` scope:
  ```ts
  try {
    const { syncActiveReservationsForCustomer } = await import('../../services/reservation-address-sync.service');
    await syncActiveReservationsForCustomer({ tenantId, customerId: conv.customer_id });
  } catch (e: any) { console.warn(JSON.stringify({ event:'ACTIVE_ADDR_SYNC_SKIPPED', customerId: conv.customer_id, error: e?.message })); }
  ```
- `src/services/staff-reservation.service.ts` — setelah `await prisma.customer.update(...)` (`≈:2225-2237`) dan audit (`≈:2259`):
  ```ts
  try {
    const { syncActiveReservationsForCustomer } = await import('./reservation-address-sync.service');
    await syncActiveReservationsForCustomer({ tenantId, customerId: customer.id });
  } catch (e: any) { console.warn('[STAFF] active addr sync skipped:', e?.message); }
  ```

### Micro-Task 1.4 — RC-1 backend anti-ghost (admin edit)
File: `src/routes/admin/reservation-dispatch.route.ts`, handler PATCH `/:id`.
Ubah perilaku (saat `address` dikirim & berbeda dari kartu `existing.customer_address.address`):
1. Import domain: `const { addressesMatch } = await import('../../domain/customer-address');`
2. Bila `addressesMatch(existing.customer_address, { address, kelurahan, kecamatan, kota })` → samakan (rumah sama), cukup update teks kartu via seam.
3. Bila TIDAK match → tetapkan `isPrimary:true` HANYA bila ini benar-benar rumah pindah eksplisit; jika tidak, buat kartu sekunder (rumah kedua) dan relink reservasi ke kartu baru.
4. Terapkan hasil lewat seam: `customerService.upsertSavedAddress(customerId, {...}, tenantId)` → dapatkan `entry.id`; SET `updateData.customer_address_id = entry.id` (menggantikan `:976-979` yang buta).
5. Sinkronkan `delivery_fee` reservasi dengan ongkir kartu baru (pola KB-6) & `raw_text` (Micro-Task plan lama 1.2).
6. DILARANG menulis `prisma.customerAddress.*` langsung.

Gerbang FASE 1: `npm run build` hijau + `npx vitest run tests/unit/reservation-address-sync.test.ts` hijau + suite alamat/rumah-kedua hijau. DILARANG lanjut bila merah.

---

## 3. FASE 2 — Pemulihan Data Live Bunda Firda (A-007) — via Seam, bukan SQL mentah

**Tujuan:** memperbaiki data operasional hari ini tanpa memicu split-brain baru.

### Micro-Task 2.1 — Skrip pemulihan idempoten
File baru: `src/scripts/heal-firda-active-address.ts` (mengikuti gaya `src/scripts/heal-customer-addresses-split-brain.ts`, mendukung `--dry-run`/`--commit`).
1. `--dry-run`: tampilkan rencana (kartu lama → kartu baru, ongkir, reservasi terkait). Tidak menulis.
2. `--commit`: panggil `customerService.upsertSavedAddress(customerId, { address:'Perumdos ITS Jl. Teknik Sipil Blok W no.18', kelurahan:'Gebang Putih', kecamatan:'Sukolilo', kota:'Kota Surabaya', lat:-7.289199, lng:112.7970673, distanceKm:13.3, ongkir:15000, locationSource:'gps_pin' }, tenantId)` → lalu `syncActiveReservationsForCustomer({ tenantId, customerId })`.
3. Backup baris (customer + customer_addresses + reservasi terkait) ke CSV/JSON sebelum commit.

Perintah:
```powershell
npx tsx src/scripts/heal-firda-active-address.ts --dry-run
npx tsx src/scripts/heal-firda-active-address.ts --commit
```
Acceptance:
- `SELECT customer_address_id, delivery_fee, raw_text FROM reservations WHERE id='f9981d32-...'` → kartu baru + ongkir 15000 + teks Perumdos ITS.
- `preferences.saved_addresses` JSON DAN tabel `customer_addresses` **konsisten** (jumlah & isi sama).
- Portal `/admin/staff/today` Bidan Thabita menampilkan Perumdos ITS + tombol peta ke -7.289199, 112.7970673.

**Gerbang FASE 2:** drift check tetap bersih:
```powershell
npx prisma migrate diff --from-url "$env:DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
```
Harus `-- This is an empty migration.`

---

## 4. FASE 3 — Perbaikan RC-4: Attachment Teks Alamat (A-003, A-004)

**Tujuan:** teks jalan spesifik menempel ke rumah yang benar TANPA data hibrida dan TANPA menimpa pin presisi.

### Micro-Task 3.1 — Ganti guard (bukan hanya hapus)
File: `src/services/human-background-enrichment.service.ts`.
- Ganti blok `:436-438` dan :494-497: daripada `return already_has_location`, lakukan:
  1. `const specific = isSpecificStreetAddress(incomingText)` (import dari `./staff-reservation.service`).
  2. Bila `specific` DAN `addressesMatch(kartuProfilTerkini, {address: incomingText})` → **rumah sama**: panggil `customerService.upsertSavedAddress(customerId, { address: incomingText, lat: customer.lat, lng: customer.lng, kelurahan: customer.kelurahan, kecamatan: customer.kecamatan, kota: customer.kota, locationSource: customer.location_source }, tid)` → hanya memperbarui TEKS, koordinat dipertahankan oleh domain (`upsertAddressIntoList:212-213`). TIDAK memanggil `updateCustomerLocation` dengan kelurahan hasil geocode teks (cegah data hibrida).
  3. Bila `specific` DAN TIDAK match → **rumah beda**: buat kartu sekunder (`isPrimary:false`) TANPA relink reservasi aktif (relink hanya via komitmen eksplisit pengguna). 
  4. Bila bukan teks jalan spesifik → kembali seperti perilaku lama.

### Micro-Task 3.2 — `location_updated_at` wajib di V3 (A-004)
File: `src/v3/state/goal-tracker.ts` — tambahkan `location_updated_at: new Date().toISOString()` pada `durablePrefs` **hanya bila** `customerData.lat/lng/kelurahan` benar-benar berubah (bukan setiap turn, agar tidak memalsukan waktu).

Gerbang FASE 3: `npm run build` hijau + test enrichment/lokasi hijau + tidak ada perubahan perilaku pada pelanggan tanpa GPS.

---

## 5. FASE 4 — RC-3 (Read-Side) + Unifikasi Pembaca (A-005) + RC-5 Telegram (A-008)

### Micro-Task 4.1 — `buildEffectiveTaskAddress` prioritaskan data terbaru untuk rumah yang SAMA
File: `src/services/staff-reservation.service.ts:252`.
- Import statis (pure, tanpa DB): `import { addressesMatch } from '../domain/customer-address';`
- Tambah cabang: bila `addr` dan profil `cust` merujuk rumah yang SAMA (`addressesMatch`) DAN `cust.preferences.location_updated_at` lebih baru dari `addr.last_used_at || addr.created_at` → pakai teks+koordinat dari profil (koreksi terbaru). Bila rumah BEDA → tetap pakai `addr` (alamat yang disepakati booking). Bila tak ada timestamp → perilaku lama byte-identik (anti-regresi).

### Micro-Task 4.2 — Unifikasi pembaca (A-005)
- Notifikasi Telegram (`src/services/staff-notification.service.ts:110-139, 852`) → gunakan `buildEffectiveTaskAddress` yang sama (import dari `staff-reservation.service`).
- Sheets `src/services/sheets/row-formatter.ts:95-106` → terapkan prioritas yang konsisten dengan kanon (kartu reservasi = alamat booking; bila rumah sama & profil lebih baru → profil). Catat di komentar bahwa ini cermin dari kanon.
- DILARANG membuat builder alamat baru/duplikat.

### Micro-Task 4.3 — RC-5 Pre-visit brief + catat revisi privasi (A-008)
File: `src/services/staff-notification.service.ts:352`.
- Tambah satu baris: `📍 Area Kunjungan: ${kelurahan/kecamatan terkini atau nama perumahan dari effective address}` (HANYA ringkas area, BUKAN alamat lengkap/no HP — tetap hormati privasi).
- Perbarui komentar-kontrak `:345-348` (dari "tanpa alamat" → "area ringkas saja") dan catat di `CHANGELOG.md`.

Gerbang FASE 4: `npm run build` hijau + `npx vitest run tests/unit/staff-task-effective-address.test.ts tests/unit/staff-task-itinerary-children.test.ts` hijau.

---

## 6. FASE 5 — UI Dashboard (Explicit Address Change Warning)

File: `packages/admin-dashboard/src/components/calendar/CreateReservationModal.tsx`.
- Micro-Task 5.1: bila teks `address` tidak cocok dengan kartu `customerAddressId` terpilih → tampilkan badge `⚠️ Teks alamat berbeda dengan kartu terpilih` + tombol `[+ Simpan Sebagai Rumah Baru]`.
- Micro-Task 5.2: gunakan `useUiFeedback` (DILARANG `window.confirm/alert`).
- Micro-Task 5.3: rebuild `npm run build` di `packages/admin-dashboard`; restart bot agar `dist/` terbarui.

Acceptance: build dashboard EXIT 0; tidak ada page baru (modal/tab eksisting).

---

## 7. FASE 6 — Test Adversarial & Gerbang Regresi (A-009)

### Micro-Task 6.1 — Perluas test
File `tests/unit/reservation-address-sync.test.ts` + `tests/unit/multi-address-reservation-sync.test.ts`:
1. Chat ganti alamat (rumah sama) saat ada reservasi aktif → tersinkron (semua status kanon).
2. Admin edit teks alamat dengan ID kartu lama → auto-relink (anti ghost-shadowing).
3. Portal tugas saat diskrepansi → prioritaskan koreksi terbaru (rumah sama).
4. Pre-visit brief memuat baris area.
5. 2 rumah sah → tidak mencampur koordinat.
6. Adversarial multi-parafrase untuk tiap skenario (formal/slang/typo).
7. Regresi #261: dedup Rumah-2 tetap benar.
8. Regresi: re-run 3 rezim penulis lokasi → sync terpanggil dari ketiganya.

### Micro-Task 6.2 — Gerbang regresi
```powershell
npx vitest run tests/unit/reservation-address-sync.test.ts tests/unit/multi-address-reservation-sync.test.ts
npm run build
npm test
```
- Failure yang diklaim "pre-existing" WAJIB dibuktikan (revert-and-rerun ke HEAD, jalankan test yang sama, harus tetap gagal).
- Full suite tanpa failure baru.

**Gerbang FASE 6:** semua hijau.

---

## 8. Rencana Rollback

- **DB:** snapshot baris (customer, customer_addresses, reservations terkait) sebelum Fase 2 (CSV/JSON backup di skrip `--dry-run`).
- **Kode:** seluruh perubahan backward-compatible, zero migrasi skema; rollback = `git revert` commit per-fase (setiap fase = 1 commit).
- **WAHA Safety:** rebuild/restart HANYA container app (`docker compose up -d --no-deps app`). Container WAHA tidak tersentuh.
- **Confirmation gate:** bila perlu menyentuh WAHA / deploy produksi dengan risiko Meta → 2-step verification + WARNING eksplisit (lihat AGENTS.md).

---

## 9. Checklist Kepatuhan AGENTS.md

- [x] Tenant-aware: semua query `tenant_id`; data bisnis dari DB (tidak ada hardcode alamat/kata kunci).
- [x] Fondasional: menyentuh seam data (DB/state), bukan larangan prompt.
- [x] Zero dependency baru; zero migrasi skema.
- [x] Satu seam kanonis per operasi (`upsertSavedAddress`, `resolveCustomerAddressId`, `syncActiveReservationsForCustomer`).
- [x] Anti-bloat: tidak ada halaman baru; modal eksisting; hindari God Object (file baru kecil & fokus).
- [x] Uji adversarial + gerbang regresi + revert-and-rerun.
- [x] Temuan tertunda → catat di `docs/KNOWN_ISSUES.md`; perubahan → `CHANGELOG.md`.
- [x] Human-in-the-Loop: plan ini DILARANG dieksekusi sebelum persetujuan tertulis.

---

## 10. Batasan & Asumsi

- Data live Fase 2 (`[ASUMSI]`) WAJIB diverifikasi via Micro-Task 0.2 sebelum eksekusi.
- Nomor baris dapat bergeser; verifikasi di Fase 0.
- Test belum dijalankan (plan disusun read-only).
- Nama file helper (`reservation-address-sync.service.ts`) dapat disesuaikan — bila menolak file baru, tempel di `reservation-core.service.ts` dekat `resolveCustomerAddressId`.

---

**STATUS AKHIR: MENUNGGU PERSETUJUAN TERTULIS PENGGUNA.** Saya berhenti di sini dan tidak mengeksekusi apa pun sampai Anda mengetikkan persetujuan eksplisit (mis. "Setuju, eksekusi").
