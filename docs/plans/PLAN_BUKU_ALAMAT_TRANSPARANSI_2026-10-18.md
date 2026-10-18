# Plan Mikro — Buku Alamat & Transparansi Alamat (R1–R4)

Tanggal: 2026-10-18 · Objek: eksekusi temuan audit UI/UX R1-R4 (F1-F6) atas arsitektur Alamat Kedua
Status: **IMPLEMENTED 2026-10-18 (F0–F4 hijau; F5 dokumentasi selesai; menunggu keputusan commit user)**

Hasil eksekusi:
- F0: `tests/unit/customer-address-book.test.ts` 18/18 hijau; gate 74/74; `tsc --noEmit` 0.
- F1: `AddressBookDrawer.tsx` (BARU) + hook `CustomerDatabase.tsx`; dashboard build hijau.
- F2: `address_source`/`address_updated_at` di `buildEffectiveTaskAddress` + 3 serializer + chip StaffToday; 7/7 test hijau.
- F3: cermin `utils/addressMatch.ts` + paritas drift 10/10 hijau + chip persisten modal.
- F4: `customer_address` di include detail + baris kartu di ReservationDetailModal.
- Gerbang full suite: rerun = 7 file / 14 test gagal (**baseline pre-existing persis**, #266.5); 687 pass files (+2 file tes baru). Run pertama (8/15) = flaky pre-existing, tidak reprodusibel.
- Zero migrasi skema; zero dependency baru.

## Keputusan Gate (default yang saya rekomendasikan; dapat diganti sebelum eksekusi)

| # | Keputusan | Nilai default | Alasan |
|---|---|---|---|
| P-1 | Hapus kartu yang dipakai jadwal **aktif** | **DILARANG → HTTP 409** + payload `activeCount` | FK `Reservation.customer_address_id` = `onDelete: SetNull` (`prisma/schema.prisma:330-331`); hapus sembarangan = ghost-address kembali. Kartu tanpa jadwal aktif boleh dihapus (reservasi historis → SetNull, riwayat selamat di `raw_text`). |
| P-2 | Rename label kartu manual | **YA** via seam `upsertSavedAddress` (domain sudah mendukung label (`customer-address.ts:238`), tak perlu jalur tulis baru — anti-patchwork) | |

## Fase 0 — Fondasi backend buku alamat (TDD, prasyarat R1)

### T0.1 Domain `removeAddressFromList` — `src/domain/customer-address.ts`
- Lokasi sisip: setelah `resolveActiveAddress` (baris 190).
- Blok baru:
```ts
export function removeAddressFromList(
  list: SavedCustomerAddress[],
  addressId: string
): { list: SavedCustomerAddress[]; removed: SavedCustomerAddress | null } {
  const removed = list.find((a) => a.id === addressId) || null;
  const next = list.filter((a) => a.id !== addressId);
  return { list: next.length ? ensureSinglePrimary(next) : next, removed };
}
```
- Catatan deteksi: penghapusan kartu primary → `ensureSinglePrimary` otomatis menyumbang primary ke kartu paling terpakai (logic sudah ada di `ensureSinglePrimary:171-182` via `resolveActiveAddress`).

### T0.2 Service `deleteSavedAddress` — `src/services/customer.service.ts`
- Lokasi sisip: setelah `setDefaultAddress` (baris 1355).
- Kontrak:
```ts
public async deleteSavedAddress(customerId: string, addressId: string, tenantId: string):
  Promise<{ deleted: boolean; activeCount: number }>
```
- Langkah (mengikuti pola `reservation-address-sync.service.ts:40-53`):
  1. `getCustomerById`; null → `{deleted:false, activeCount:0}`.
  2. Hitung jadwal aktif yang menunjuk kartu: `prisma.reservation.findMany({ where: { tenant_id, customer_id, customer_address_id: addressId, status: { in: ACTIVE_RESERVATION_STATUSES } } })` → filter `isActiveReservation`.
  3. `activeCount > 0` → return `{deleted:false, activeCount}` (route → 409).
  4. `activeCount === 0` → `removeAddressFromList` + `persistSavedAddresses` + **pembersihan baris tabel** `prisma.customerAddress.deleteMany({ where: { id: addressId, customer_id, tenant_id } })` (menutup celah split-brain JSON↔tabel yang saat ini tak pernah dihapus; fail-safe `.catch` + event terstruktur `ADDR_BOOK_DELETE_TABLE_FAILED`).

### T0.3 Routes — `src/routes/admin/customers.subroute.ts` (sisip setelah baris 512)
Semua `tenantOf(request)` (pola GET addresses baris 500-512):
1. `PATCH /api/admin/customers/:id/addresses/:addressId/default` → verifikasi kartu ada (`getSavedAddresses`) → `customerService.setDefaultAddress(...)` → 200; 404 bila kartu tak ada.
2. `PATCH /api/admin/customers/:id/addresses/:addressId/label` body `{ label: string }` → ambil kartu lama dari daftar → `upsertSavedAddress(customerId, { …field kartu lama, label: label.trim() }, tenantId)` → 200 `{ entry }`; 404/400 validasi.
3. `DELETE /api/admin/customers/:id/addresses/:addressId` → `deleteSavedAddress` → 200 `{ success:true, deleted:true }` / **409** `{ success:false, error:'Kartu dipakai N jadwal aktif.', activeCount }` / 404 bila kartu tak ada.

### T0.4 Test — `tests/unit/customer-address-book.test.ts` (BARU, adversarial)
1. Domain: hapus kartu sekunder → daftar utuh; hapus kartu primary → primary pindah ke `resolveActiveAddress`; hapus 1-satunya kartu → daftar kosong tanpa error.
2. Service DELETE: `activeCount>0` → `deleted:false` (BEFORE penuh, ZERO tulis); 0 → JSON diperbarui + `deleteMany` dipanggil; customer tak ada → aman.
3. Route: DELETE 200 / 409 / 404; PATCH default 200/404; PATCH label 200 (pola `buildApp().inject` seperti `tests/unit/admin-create-reservation.test.ts`).
- **Gerbang regresi F0**: `npm run build` + `npx vitest run tests/unit/customer-address-book.test.ts tests/unit/reservation-address-sync.test.ts tests/unit/multi-address-fase3.test.ts` hijau; full tanpa failure baru.

## Fase 1 — UI Buku Alamat (R1, drawer, anti-bloat)

### T1.1 Komponen BARU `packages/admin-dashboard/src/components/customer/AddressBookDrawer.tsx`
- Pola wadah mengikuti `CustomerEditForm` (full overlay, tanpa page baru).
- Data: `GET /api/admin/customers/:id/addresses`; refresh pasca-aksi.
- Daftar kartu: label + badge `Primary`, teks alamat, `ongkir`/km, `text-[11px]` microcopy.
- Aksi per kartu (SEMUA via `useUiFeedback`, DILARANG `window.confirm`):
  - `Jadikan Utama` → `PATCH .../default` (confirm modal).
  - `Ubah Label` → input inline (toggle kecil, min 44px target) → `PATCH .../label`.
  - `Hapus` → `confirm({ danger: true })` → `DELETE`; bila 409 → tampilkan pesan "Dipakai N jadwal aktif" + saran alihkan.
- Patuh `impeccable`: tombol `min-h-[44px] inline-flex active:scale-[0.98] focus-visible:ring-2`; tanpa kartu-dalam-kartu (flat list + divider `border-t border-[#e9edef]`); state loading/error/kosong ("Belum ada alamat tersimpan").

### T1.2 Kaitkan di `CustomerDatabase.tsx`
- Import + state `addrBookCustomer`.
- Tombol `Buku Alamat` di panel detail di dekat tombol `Edit Profil & Data Anak` (baris 1531, `onClick={() => setDetailEditMode(true)}`) — susun berdampingan.
- Gate: `packages/admin-dashboard` `npm run build`; uji manual 375px (drawer tap-friendly).

## Fase 2 — Transparansi alamat staf (R2 revisi + backend truth)

### T2.1 `buildEffectiveTaskAddress` — `src/services/staff-reservation.service.ts:279-295`
Tambah di return: `source: useProfile ? 'profile' : 'card'` dan `updatedAt: useProfile ? (prefs.location_updated_at ?? null) : ((addr.last_used_at ?? addr.created_at) ?? null)`.

### T2.2 Tiga titik serialisasi kartu terapis (baris 759-774, 1063-1078, 1245-1260)
Tambah 2 field: `addressProvenance: effectiveAddr.source ?? null`, `addressUpdatedAt: effectiveAddr.updatedAt ?? null`.

### T2.3 UI `StaffToday.tsx` (area alamat tugas, ~3293-3300)
Chip tunggal `📍 Alamat terakhir diperbarui Xj lalu` HANYA bila `addressUpdatedAt` < 24 jam (else — tidak tampil). `text-[11px]`, token amber; tidak memakai istilah "kartu" ke bidan.

### T2.4 Test
Extensi `tests/unit/staff-task-effective-address.test.ts`: fixture dengan `location_updated_at` segar → chip data ada; basi → null.
- Gerbang: build + `npx vitest run tests/unit/staff-task-effective-address.test.ts`.

## Fase 3 — Util cermin FE + tes paritas drift (R3 revisi)

### T3.1 BARU `packages/admin-dashboard/src/utils/addressMatch.ts`
Cermin murni `addressesMatch` domain (`src/domain/customer-address.ts:100-134` + helper `norm/hasText/bothCoords/haversineMeters` di `:60-91`) — tanpa React, tanpa zod. Komentar **"Sinkron 1:1 dengan src/domain/customer-address.ts"** (pola `utils/reservationStatus.ts`).

### T3.2 Tes paritas BARU `tests/unit/dashboard-address-match-parity.test.ts` (root vitest)
Impor KEDUA berkas (domain + util cermin), jalankan vektor yang sama (pin <150 m; jalan+kota sama; wilayah tanpa jalan; sisi kosong satuan; jalan beda dalam 1 kecamatan → false) → assert output identik. Menutup risiko drift cermin.

### T3.3 `CreateReservationModal.tsx` (~baris 2062-2076)
- Badge mismatch memakai `addressesMatch` cermin (mencocokkan kelurahan/kecamatan → badge palsu turun).
- Setelah tombol `+ Simpan Sebagai Rumah Baru` ditekan: badge berubah menjadi **chip status permanen** "Akan disimpan sebagai rumah baru" (tidak menghilang; toast tetap dipertahankan).
- Gate: tes paritas hijau + build dashboard.

## Fase 4 — Baris kartu alamat di detail reservasi (R4 revisi: detail dulu, list ditunda)
1. Add `customer_address: true` ke `include` `GET /api/admin/reservation/:id` (`reservation-dispatch.route.ts:400-414`).
2. `ReservationDetailModal.tsx`: baris `🗺️ Alamat Terkait: [label] · Ongkir Rp…` di sekitar bagian alamat (~baris 556); hilang bila kartu tak ada (CERDAS, bukan tebakan).
- Gate: build + snapshot manual.

## Fase 5 — Dokumentasi & tanam
- CHANGELOG entri baru (format Keep a Changelog). KNOWN_ISSUES #266 diperbarui (R1-R4 IMPLEMENTED; sisa lintas: list reservasi tetap ikut di-tracing di masa depan, staff provenance data primitif tetap di-live).
- `graphify update .` selesai.
- **Commit HANYA setelah persetujuan eksplisit user** (terpisah dari eksekusi).

## Urutan eksekusi & rollback
Fase 0 → gate sukses → Fase 1 → Fase 2 → Fase 3 → Fase 4 → Fase 5. Setiap fase = unit commit (rollback `git revert` per fase; migration schema TIDAK ada — zero schema change).

## Risiko dan plan pre-mortem (FMEA ringkas)
| Risiko | S×O×D | Mitigasi |
|---|---|---|
| DELETE ghost (set FK null) | 8×3×7=168 | 409 + `activeCount` + test penuh (F0#2) |
| Split-brain JSON↔tabel | 6×3×6=108 | `deleteMany` dual-write + tes |
| Promosi primary tersimpul | 5×3×5=75 | `ensureSinglePrimary` + tes domain |
| Drift cermin FE | 4×2×5=40 | tes paritas T3.2 |
| Badge overload admin | 3×4×4=48 | chip hanya `<24 jam`, ubah minimal |
| UI mock `prisma` bocor (pattern A-017) | 2×4×5=40 | `afterEach` restore di semua file test baru |
