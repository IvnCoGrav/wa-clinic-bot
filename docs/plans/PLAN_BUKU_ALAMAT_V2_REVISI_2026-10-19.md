# PLAN BUKU ALAMAT v2 — REVISI PASCA-AUDIT (Alamat ke-2 & Pengalaman Admin)

- **Tanggal**: 2026-10-19 (revisi atas plan v2 "Penyempurnaan Alamat ke-2 & Pengalaman Admin" setelah audit validasi read-only)
- **Status**: SIAP DIEKSAKUSI — **WAJIB MUNGGU PERSETUJUAN EKSEKUSI MANUSIA** (Confirmation Gate AGENTS.md). Belum ada file kode yang diubah.
- **Akar perbaikan**: fondasional (Service Contract + State Machine frontend + Data integrity), bukan tambalan prompt/regex.
- **Zero dependency baru; zero migrasi skema.**

## 0. Hasil Audit Plan v2 Asli (klaim yang dikoreksi)

| ID | Klaim plan asli | Status | Bukti aktual |
|----|-----------------|--------|--------------|
| A1 | `customer-address-book.test.ts` & `admin-create-reservation.test.ts` akan "dibuat" | ❌ SUDAH ADA | `tests/unit/customer-address-book.test.ts` (582 baris, 18+ test) & `tests/unit/admin-create-reservation.test.ts` (632 baris, RC-1 + IDOR). Semua Fase yang menyentuh keduanya = **PERLUAS, bukan buat**. |
| A2 | Fungsi `calculateSlotRecommendations` @1303-1304 | ⚠️ Nama salah | Nama aktual **`handleGenerateRecommendations`** (`CreateReservationModal.tsx:1279`); baris 1303-1304 benar (`custLat/custLng` dari `selectedCustomerInfo`). |
| A3 | `geocodeAddressWithNominatim` "di CustomerEditForm" | ⚠️ Path salah | Helper ada di `packages/admin-dashboard/src/utils/geoUtils.ts:474`. `useMapsShortlinkResolver` ✓ (`hooks/useMapsShortlinkResolver.ts`), `calculateOngkirFromTiers` ✓ (`utils/deliveryTierCalculator.ts:33`). |
| A4 | "Teks alamat baru dibuang diam-diam" | ⚠️ Framing salah | Deteksi mismatch + badge `⚠️ Teks alamat berbeda…` + tombol `+ Simpan Sebagai Rumah Baru` SUDAH ADA (`CreateReservationModal.tsx:2076-2122`). Bug nyata: bila admin **lupa klik**, payload tetap membawa `customerAddressId` kartu lama → `explicitAddressId` menang mutlak (`reservation-core.service.ts:456`) → jadwal menunjuk rumah lama. Bisa terjadi di PATCH **DAN CREATE** (`reservation-crud.route.ts:870,940` → `saveReservation`). |
| B1 | Micro-Task 1.2 menambah method `updateSavedAddress` baru | ❌ Melanggar mandat | **Kontrak Kanonis Tunggal**: seam tulis = `upsertSavedAddress` (`customer.service.ts:1446`, dipakai route PATCH label `customers.subroute.ts:640`). Dilarang membuat jalur tulis paralel. |
| C1 | Hardcode `DEFAULT_TENANT_ID` hanya `:474` | ⚠️ Sebagian | 27 kemunculan di `customers.subroute.ts` (716, 728, 767, 825, 843, 884, 910, 952, 994, 1026, 1047, 1197, 1206, 1245, 1293, 1327, 1393, 1408, 1463…). Perbaiki 474 di fase ini; sisanya ditulis debt di KNOWN_ISSUES. |
| C2 | (tidak disebut) | ⚠️ Warisan laten | Fallback detail route `getCustomerById(id)` **tanpa tenant** (`customers.subroute.ts:362`) — dicatat sebagai debt. |

## 1. Klaim yang TERVERIFIKASI (anchor eksekusi — sudah diverifikasi langsung)

| # | Fakta | Lokasi terverifikasi |
|---|-------|----------------------|
| V1 | Belum ada rute `PUT /api/admin/customers/:id/addresses/:addressId` (ada GET/POST/PATCH default/PATCH label/DELETE) | `customers.subroute.ts:501,519,590,617,674` |
| V2 | `upsertSavedAddress(customerId, input, tenantId)` menerima `id` (update) ATAU tanpa `id` (create baru), memanggil `persistSavedAddresses` (dual-write JSON + tabel), dan membersihkan tombstone yang cocok | `customer.service.ts:1446-1460` |
| V3 | Modal mengunci kartu primary otomatis saat dibuka | `CreateReservationModal.tsx:203-214` |
| V4 | Selector alamat hanya muncul bila `savedAddresses.length > 1` | `CreateReservationModal.tsx:1999` |
| V5 | `AddressBookDrawer` hanya dipasang di `CustomerDatabase.tsx:1562` | — |
| V6 | `ReservationDetailModal`: lat/lng/alamat Maps ambil dari `customer` (Rumah 1), bukan kartu | `ReservationDetailModal.tsx:563-573`; baris label kartu sudah ada `:546-560` |
| V7 | Drawer: pensil hanya rename label; form Tambah tanpa lat/lng/landmark/Maps/geocode | `AddressBookDrawer.tsx:33-58,265-362` |
| V8 | Rute POST addresses sudah menerima `lat/lng/landmark` (UI saja yang belum mengirim) | `customers.subroute.ts:530-532,551-552,568-570` |
| V9 | `POST /api/admin/reservation` (create) meneruskan `customerAddressId` + `address` ke `saveReservation` (explicit menang) | `reservation-crud.route.ts:845,870,940,958` |
| V10 | `customer_address` sudah di-include detail reservasi (warisan v1) | `reservation-dispatch.route.ts:400-414` |

## 2. Keputusan Desain (Confirmation Gate — default di beri tanda ➡️; user boleh mengganti sebelum eksekusi)

| # | Topik | Default (rekomendasi) | Alternatif yang ditolak/ditunda |
|---|-------|----------------------|-------------------------------|
| D-1 | Rute ubah alamat lengkap | ➡️ **PUT via seam kanonis `upsertSavedAddress`** (pola PATCH label: teruskan field kartu lama + field baru). TANPA method service baru. | Method `updateSavedAddress` baru = patchwork, ditolak. |
| D-2 | Teks alamat berbeda di modal booking | ➡️ **Komitmen eksplisit dengan 2 jalur**: badge mismatch + tombol "+ Simpan Sebagai Rumah Baru" (eksisting) **+ tombol baru "Perbarui Kartu Ini"** (open drawer edit / PUT kartu terpilih). Bila admin lupa aksi → **submit DIBLOKIR** dengan toast "Pilih: jadikan rumah baru / perbarui kartu ini" (anti silent-ignore deterministik, state-gated: `mismatch && !savedAsNewHouse && !correctingCardId`). | Auto-set `savedAsNewHouse=true` tanpa klik → risiko duplikat rumah saat admin hanya koreksi typo. DITOLAK. |
| D-3 | Selector alamat 1-kartu | ➡️ Tampilkan bila `savedAddresses.length >= 1` (kartu + tombol "+ Alamat Baru Untuk Jadwal Ini"). | Status quo `> 1`. |
| D-4 | Rekomendasi slot membaca koordinat kartu terpilih | ➡️YA: `selectedCard?.lat ?? selectedCustomerInfo?.lat ?? CLINIC_COORDS.lat`, dan kartu tanpa koordinat fallback rantai. Logika diekstrak ke util murni agar dapat diuji. | Kosong/menanam CLINIC_COORDS mentah tanpa fallback. |
| D-5 | Sapu `DEFAULT_TENANT_ID` seluruh file | ➡️ Tunda — perbaiki `:474` saja di fase ini; sisanya (termasuk fallback `:362`) ditulis debt di KNOWN_ISSUES. | Sapu 27 lokasi = blast radius besar, butuh Confirmation Gate tersendiri. |

---

## FASE 1 — Fondasi Backend: PUT Alamat Lengkap via Seam Kanonis (D-1)

### Micro-Task 1.1 — Perbaiki tenant ID detail route (`:474`)
- **File**: `src/routes/admin/customers.subroute.ts:474`
- **Ganti**: `getSavedAddresses(customer.id, DEFAULT_TENANT_ID)` → `getSavedAddresses(customer.id, tenantId)` (`tenantId` sudah dideklarasikan `:330`).

### Micro-Task 1.2 — Rute PUT (TANPA method service baru)
- **File**: `src/routes/admin/customers.subroute.ts` — sisip **setelah PATCH label** (`:667`).
- Kontrak: `PUT /api/admin/customers/:id/addresses/:addressId`, body opsional: `label?, address?, kelurahan?, kecamatan?, kota?, lat?, lng?, landmark?, distanceKm?, ongkir?`.
- Logika (menghormati pola PATCH label `:634-657`):
  1. `tenantId = tenantOf(request)`; validasi `label` (trim + `MAX_ADDRESS_LABEL_LENGTH` bila diisi).
  2. `list = getSavedAddresses(id, tenantId)`; kartu tidak ada → **404**; `label` > 60 char → **400**.
  3. Delegasi **satu-satunya** ke seam kanonis:
```ts
const entry = await customerService.upsertSavedAddress(
  id,
  {
    id: card.id,            // kunci update — V2
    address: body.address?.trim() || card.address,
    kelurahan: body.kelurahan?.trim() || card.kelurahan,
    kecamatan: body.kecamatan?.trim() || card.kecamatan,
    kota: body.kota?.trim() || card.kota,
    lat: typeof body.lat === 'number' && Number.isFinite(body.lat) ? body.lat : card.lat,
    lng: typeof body.lng === 'number' && Number.isFinite(body.lng) ? body.lng : card.lng,
    distanceKm: body.distanceKm ?? card.distanceKm,
    ongkir: body.ongkir ?? card.ongkir,
    landmark: body.landmark?.trim() || card.landmark,
    locationSource: (card as any).locationSource ?? (card as any).location_source ?? null,
    label: body.label?.trim() || card.label,
  },
  tenantId
);
```
  4. Status: 200 `{ success: true, entry }` / 400 (validasi) / 404 (customer atau kartu tak ada) / 500 (log + pesan generik, pola POST `:576-582`).
- **DILARANG** memanggil `syncSavedAddressFromLocation`/`refreshCustomerLocationAndOngkir` dari rute ini (otoritas teks tetap milik admin). Relink jadwal aktif HANYA bila koordinat kartu benar-benar berubah, via guard deterministik (pola gate koordinat S-2 pada plan SEAM):
```ts
const coordsChanged =
  (typeof body.lat === 'number' && body.lat !== card.lat) ||
  (typeof body.lng === 'number' && body.lng !== card.lng);
```
  Bila `coordsChanged` → panggil sync jadwal aktif **non-throwing** (`syncActiveReservationsAfterLocationChange` sudah menangguhkan error, `customer.service.ts:602`) — hanya untuk reservasi aktif yang menunjuk `card.id`.

### Micro-Task 1.3 — Perluas test eksisting (TDD: tulis MERAH dulu)
- **File**: `tests/unit/customer-address-book.test.ts` (PERLUAS, A1) — block baru `describe('PUT: edit alamat lengkap')`:
  1. PUT teks jalan kartu sekunder → tersimpan di JSON **dan** delegasi `upsertSavedAddress` dipanggil dengan `id` kartu (spy).
  2. PUT koordinat kartu sekunder + jadwal aktif menunjuk kartu → `customer_address_id` reservasi relink; PUT landmark/foto saja → TIDAK memicu relink (gate koordinat, D-1).
  3. PUT lat/lng tak valid (string "abc") → diabaikan, nilai lama bertahan.
  4. IDOR tenant: PUT kartu customer tenant lain dengan `x-tenant-id: 'tenant-asing'` → **404** (mengikuti pola S-4 IDOR `:563-581`).
  5. Label 61 char → 400.

**Regression Gate Fase 1**: `npm run build` exit 0; `npx vitest run tests/unit/customer-address-book.test.ts` hijau; `npx vitest run tests/unit/admin-create-reservation.test.ts` tanpa failure baru.

---

## FASE 2 — AddressBookDrawer: Edit Lengkap + Alat Lokasi (SaaS anti-bloat)

### Micro-Task 2.1 — Mode Edit Alamat Lengkap
- **File**: `packages/admin-dashboard/src/components/customer/AddressBookDrawer.tsx`
- Tambah state `editingAddress: SavedAddress | null` (terpisah dari `editingId` rename-label eksisting).
- Tombol pensil (`:435-446`) → buka **form edit** (reuse & ekstensi struktur form Tambah `:265-363`): Label, Jalan, Kelurahan, Kecamatan, Kota, Landmark, Koordinat (lat/lng via Maps link).
- Submit → `PUT /api/admin/customers/${customerId}/addresses/${editingAddress.id}` (payload field sesuai Micro-Task 1.2) → toast + `load()` + `onChanged?.()`.
- Kopi konfirmasi useUiFeedback: "Perubahan koordinat kartu akan ikut memperbarui jadwal aktif yang menggunakan rumah ini."

### Micro-Task 2.2 — Alat lokasi cerdas (reusability-first)
- **Hook yang dipakai (sudah ada, V8**: hook `useMapsShortlinkResolver` (`packages/admin-dashboard/src/hooks/useMapsShortlinkResolver.ts`) — terapkan di form Tambah **dan** Edit: tempel link Google Maps/shareloc → isi lat/lng otomatis.
- **Geocoding**: `geocodeAddressWithNominatim` dari `packages/admin-dashboard/src/utils/geoUtils.ts:474` (BUKAN "di CustomerEditForm" — koreksi A3) bila kelurahan/kecamatan/kota terisi (tombol "Cari Koordinat", ≥44px).
- **Ongkir**: `calculateOngkirFromTiers(distanceKm, deliveryTiers)` dari `deliveryTierCalculator.ts:33` (source: `GET /api/admin/delivery-tiers` — masih dipakai di modal `CreateReservationModal.tsx:252`). Bila `distanceKm` tidak diketahui, hitung Haversine via `calculateHaversineKm` (geoUtils) dari `CLINIC_COORDS` yang dipakai modal create — tanpa hardcode baru.
- Data bisnis (tier, klinik) TIDAK di-hardcode — dikonsumsi dari API endpoint eksisting (patuh Mandat Non-Hardcode).

**Regression Gate Fase 2**: `packages/admin-dashboard` `npm run build` exit 0; uji manual: edit kartu → berubah di DB drawer + jadwal active-reservations ikut.

---

## FASE 3 — Integrasi Buku Alamat ke WhatsApp Live Chat

### Micro-Task 3.1 — Pasang drawer di LiveChatMonitor
- **File**: `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx` (7.839 baris)
- Import `AddressBookDrawer`; state `addrBookCustomer: { id: string; name?: string } | null`.
- Render drawer level overlay terpisah (polа dari `CustomerDatabase.tsx:1562`), **sejajar** `CustomerEditForm` di ~`:7056` — TIDAK nested.
- Data count badge: `GET /api/admin/customers/${id}/addresses` hanya dipanggil bila sidebar customer aktif berganti (cache per-conversation; tidak mem-poll).

### Micro-Task 3.2 — Tombol + badge di sidebar detail pasien
- Lokasi: panel detail pasien dekat tombol "Edit Profil" (`:7040`) dan baris "Alamat Lengkap" (`:6875`).
- Tombol `Buku Alamat` — ikon `MapPin` (`lucide-react` sudah diimpor di file), target tap `min-h-[44px]`, class pola drawer (`inline-flex … active:scale-[0.98] focus-visible:ring-2`).
- Badge bila `addresses.length > 1`: `🏠 ${n} alamat tersimpan` clickable → membuka drawer.

**Regression Gate Fase 3**: dashboard `npm run build` exit 0; verifikasi drawer terbuka tanpa memotong konteks obrolan aktif (tidak unmount sidebar).

---

## FASE 4 — Perbaikan Alur Booking Modal (Active User Commitment, D-2/D-3/D-4)

### Micro-Task 4.1 — Selector alamat tampil bila `>= 1` (D-3)
- **File**: `CreateReservationModal.tsx:1999` — ganti kondisi `savedAddresses.length > 1` → `savedAddresses.length >= 1`.
- Bila hanya 1 kartu → render ringkas: kartu + tombol "+ Alamat Baru Untuk Jadwal Ini" (`setCustomerAddressId(null); setSavedAsNewHouse(true)`).
- Bila `0` → tetap tanpa selector (input alamat baru saja).

### Micro-Task 4.2 — Anti silent-ignore deterministik (D-2)
- **File**: `CreateReservationModal.tsx` — di sekitar blok actions badge mismatch eksisting (`:2076-2122`):
  1. Tambah state `correctingCardId: string | null` (mode "Perbarui Kartu Ini") dan tombol `Perbarui Kartu Ini` (ikon `Pencil`) di samping tombol "Rumah Baru" — membuka AddressBookDrawer dengan kartu terpilih (reuse drawer Fase 2 — **BUKAN form duplikat**, anti-bloat).
  2. **Gerbang submit di handler simpan/create** (deterministik di level state, BUKAN teks "DILARANG..."):
```ts
// ⛔ Blokir submit bila teks alamat admin belum dikomit ke rute yang jelas
if (selectedCard && address.trim() && mismatchActive) {
  toast('Teks alamat berbeda dgn kartu \u2014 pilih: Simpan sebagai Rumah Baru / Perbarui Kartu Terpilih.', 'error');
  return;
}
```
  Implikasi: silang-cek `mismatch` dipromosikan dari iife JSX (`:2077-2092`) ke **useMemo** `mismatchComputed` agar bisa dibaca handler (anti-duplikasi logika; JSX memakai memo yang sama).
  3. Setelah admin memilih salah satu jalur → blocker hilang (state-gated: `savedAsNewHouse || correctingCardId`).
  4. Chip status "Akan disimpan sebagai rumah baru" (`:2101-2105`) difungsikan ulang sebagai chip **permanen** (semantik status, bukan toast sekali-lewat).

### Micro-Task 4.3 — Rekomendasi slot baca koordinat kartu terpilih (D-4)
- **File**: `CreateReservationModal.tsx:1303-1304` (FUNGSI: `handleGenerateRecommendations`, koreksi A2):
```ts
const selectedCard = savedAddresses.find((a: any) => a.id === customerAddressId);
const custLat = selectedCard?.lat ?? selectedCustomerInfo?.lat ?? CLINIC_COORDS.lat;
const custLng = selectedCard?.lng ?? selectedCustomerInfo?.lng ?? CLINIC_COORDS.lng;
```

### Micro-Task 4.4 — Ekstraksi util murni + tes root (B3)
- **File BARU**: `packages/admin-dashboard/src/utils/slotRecommendations.ts` — ekstrak komputasi dari `handleGenerateRecommendations` (`:1307-1460`: `CANDIDATE_SLOTS`, travel minutes, arrival/departure timeline, scoring) menjadi fn murni `recommendSlots({ targetStaffList, staffBookingsForDate, custLat, custLng, bookingDate, nowWib, totalDurationMinutes, ... })` → return `SlotRecommendation[]`. Component jadi komposisi (fetch data → fn → setState). Knot guard: data struktur sama persis, tidak ada perubahan perilaku (paritas).
- **Test BARU** `tests/unit/dashboard-slot-recommendation.test.ts` (root vitest, pola `dashboard-address-match-parity.test.ts`):
  1. Koordinat dari kartu dipakai (bukan `selectedCustomerInfo`) → jarak/arrival bagi Rumah 2 melainkan Rumah 1.
  2. Kartu tanpa lat/lng → fallback `selectedCustomerInfo` → fallback `CLINIC_COORDS` (rantai D-4).
  3. Conflicts & travel guard tetap (bentrok kembali dari booking sebelumnya; keberangkatan ≥ akhir prev-booking; guard 15 menit "hari ini").
  4. Sort multi-staf (waktu terdahulu skor jarak lebih baik) + dedupe ≤6 rekomendasi per terapis-slot unik (paritas `:1446-1460`).

**Regression Gate Fase 4**: root `npm run build` + dashboard `npm run build` exit 0; `npx vitest run tests/unit/dashboard-slot-recommendation.test.ts tests/unit/admin-create-reservation.test.ts` hijau (PERLUAS A-011 & RC-1 tanpa mengubah perilaku backend: explicit ID tetap menang mutlak — front-end blocker 4.2 menjadi lapis yang mencegah payload usang).

---

## FASE 5 — Integritas Detail Reservasi & Gerbang Penuh

### Micro-Task 5.1 — Maps link kartu di ReservationDetailModal
- **File**: `packages/admin-dashboard/src/components/modals/ReservationDetailModal.tsx:563-573`
- Logika (prioritas kartu, V6 & V10):
```ts
const card = (displayReservation as any).customer_address;
const prefs = displayReservation.customer?.preferences as any;
const effectiveLat   = (card?.lat ?? displayReservation.customer?.lat) || null;
const effectiveLng   = (card?.lng ?? displayReservation.customer?.lng) || null;
const effectiveAddress = [card?.address || prefs?.address || displayReservation.customer?.address, card?.kelurahan || prefs?.kelurahan || displayReservation.customer?.kelurahan, ...].filter(Boolean).join(', ');
const effectiveLandmark = card?.landmark || prefs?.landmark;
const locSource = card?.location_source ?? (displayReservation.customer as any)?.location_source ?? null;
const mapsUrl = effectiveLat && effectiveLng ? getGoogleMapsDirectionUrl(effectiveLat, effectiveLng, effectiveAddress, locSource) : null;
```
- Badge "Status akurasi" memakai `locBadge` dari `getLocationBadgeConfig({ location_source: locSource, preferences: prefs })` (sudah diekspor di util; tidak menimpa vendor).
- Ongkir baris `:536-539`: pakai `card?.ongkir ?? displayReservation.customer?.ongkir`.
- Bila `card` tidak ada → perilaku lama tetap utuh (fallback customer) — CERDAS, bukan tebakan.

### Micro-Task 5.2 — Dokumentasi & domain graph
- `CHANGELOG.md` entri `docs/plans/PLAN_BUKU_ALAMAT_V2_REVISI_2026-10-19.md`.
- `docs/KNOWN_ISSUES.md`: (a) perbarui isu buku alamat #266.x — subitem 27 kemunculan `DEFAULT_TENANT_ID` + fallback tanpa tenant `:362` (C1/C2, D-5; butuh Confirmation Gate tersendiri); (b) gap U-4 StaffSchedule dari plan SEAM; (c) catat konvensi baru: "`explicitAddressId` menang mutlak + gerbang komitmen frontend WAJIB berpasangan" — setiap UI baru yang mengirim `customerAddressId` harus punya blok komitmen teks-alamat (mencegah ghost-shadowing berulang di permukaan lain).
- `graphify update .` (knowledge graph re-sync).

### Micro-Task 5.3 — Gerbang Regresi Penuh (Final)
```powershell
npm run build
cd packages/admin-dashboard; npm run build
npx vitest run
```
- Baseline pre-existing (`PLAN_SEAM..._2026-10-18.md` §4.4): **7 file / 14 test** — v3-conversation-matrix ×2, agent-runner ×1, adversarial-reservation-resilience ×1, catalog-seed-drift ×3, chat-schedule-extractor ×2, reservation-security-and-integrity ×4, staff-otw-chat-poison ×1.
- Failure baru = regresi; klaim pre-existing WAJIB dibuktikan revert-and-rerun.

---

## 3. Analisis Dampak Sampingan (FMEA — diperbaiki dari plan asli)

| Komponen | Risiko | S×O×D=RPN | Mitigasi fondasional |
|---|---|---|---|
| PUT kartu yang mounted jadwal aktif (prisma snake_case `is_primary/location_source` vs camelCase `SavedCustomerAddress`) | Field terbaca salah → ongkir/primary drift | 7×3×5=105 | Anchor: test fixture snake_case A-010 di `admin-create-reservation:578-609`; PUT membaca dari `list` (hasil `getSavedAddresses` — typed zod) BUKAN baris prisma mentah. |
| Modal booking: blok submit mismatch | Admin terkunci dr jadwal tak disimpan | 6×3×4=72 | 2 jalur komitensi eksplisit (D-2) + toast injak + chip status persisten. |
| Fase 4.4 refactor `handleGenerateRecommendations` | Paritas berubah diam-diam | 8×2×6=96 | Ekstraksi murni (no-state) + tes "akibat-atas" golden path: hasil komposit IDENTIK dengan snapshot data biasa (assertions: slot, departure, staff). Refactor sekali ~LOC sedang (per Mandat Staged-Phase). |
| ReservationDetailModal card fields snake_case/camelCase hibrida | `card?.location_source` tak terbaca → badge salah | 5×3×4=60 | Guard `card?.location_source ?? card?.locationSource`; fixture test mengikuti baris prisma asli (pola A-010). |
| Tenant isolation rute PUT | IDOR lintas tenant | 9×1×2=18 | `tenantOf(request)` + getCustomerById tenant-scoped + tes IDOR (1.3-4). |
| 27 lokasi DEFAULT_TENANT_ID tersisa | Debt teknik (bukan regression baru) | 5×4×7=140 | Terdaftar di KNOWN_ISSUES (D-5); di-tunjukkan untuk Confirmation Gate sapu penuh sebagai plan tersendiri. |
| Drawer fetch count di LiveChat | request ganda / noise network | 3×3×3=27 | Fetch hanya per customer-change; no polling. |

## 4. Urutan Eksekusi & Rollback

```
F1 (backend seam) → gate → F2 (drawer edit) → gate → F3 (livechat)
→ gate → F4 (modal booking) → gate → F5 (detail + docs + full gate)
```
- Dilarang melompat fase; semua fase dinyatakan "tertutup" hanya bila gerbang hijau.
- Rollback: `git revert` per fase; tanpa schema migration; `WAHA` tidak disentuh → standard safe deploy = validasi 1-step (deploy approval TETAP terpisah di akhir).
- **DILARANG commit kecuali persetujuan eksplisit user**.

## 5. Di luar plan ini (butuh keputusan/plan terpisah)
1. Sapu 27 `DEFAULT_TENANT_ID` + fallback tenant `:362` (Confirmation Gate, blast radius lintas-rute).
2. Audit/skrip heal `location_source` produksi (SEAM plan §3).
3. U-4: alamat di `StaffSchedule.tsx` (desain menyusul).
