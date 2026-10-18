# PLAN SEAM LOKASI_TUNGGAL v2 — Perbaikan Kebocoran Integrasi Buku Alamat (S-1..S-4 + S-UX)

- **Tanggal**: 2026-10-18 (v2 audit + keputusan user hari yang sama)
- **Status**: SIAP EKSEKUSI — **TETAP MUNGGU PERSETUJUAN EKSEKUSI MANUSIA per fase** (Confirmation Gate AGENTS.md). Keputusan desain di bawah SUDAH disetujui user; belum ada file kode yang diubah.
- **Konteks**: Tindak lanjut audit integrasi (`audit-sistem-berlapis` Tahap 0–6) atas fitur buku alamat R1–R4 (deploy `6ec49800`), plus audit UI/UX semua roles (standar `impeccable`).
- **Sifat perbaikan**: FONDASIONAL (State Machine lokasi + Tool/Service Contract + UI). Bukan tambalan prompt/regex.

## 0. Keputusan User (tercatat eksplisit, chat 2026-10-18)

| Topik | Keputusan |
|-------|-----------|
| S-1.3 sync jadwal aktif gagal di produksi | **Tanpa throw** — `console.error` + kegagalan tertutup test drift (webhook chat tak boleh 500) |
| S-2 gate `PUT /:id/location` | **Opsi A** — seam lokasi + relink HANYA saat koordinat GPS benar-benar berubah |
| S-3 semantik hapus kartu | **Opsi A** — tombstone di `preferences.address_tombstones` (tanpa migrasi DB) |
| S-UX | **Ya** — fase S-UX penuh: Esc drawer + tombol "+ Tambah Alamat" (POST + form mini) + copy konfirmasi CustomerEditForm + test |

## 1. Ringkasan Temuan Audit v1 (bukti `file:line`, semua TERBUKTI kecuali F-7)

| ID | Temuan | Bukti |
|----|--------|-------|
| **F-1** | Jalur Edit Profil Admin menulis kolom lokasi langsung (`prisma.customer.update`), melewati seam `updateCustomerLocation`, tanpa relink jadwal aktif → `Reservation.customer_address_id` drift. | `customer.service.ts:1012-1027,1055,1198-1208,1216`; sync hanya di `:473`/`:575`; pengirim field `CustomerEditForm.tsx:75-81,292-293` → `customers.subroute.ts:1123` |
| **F-1b** | Downgrade `gps_pin → manual_staff` tiap "Simpan Profil" (form prefill `:80-81` → selalu kirim lat/lng `:292-293` → `:1025-1027` tanpa guard). | `customer.service.ts:1025-1027` vs `:1147-1148` |
| **F-2** | Ubah landmark/foto saja tetap memicu `syncSavedAddressFromLocation` + relink; jadwal yang sengaja diarahkan ke Rumah 2 bisa tertarik balik ke root. Pemanggil UI: `Reservations.tsx:952`. | `customers.subroute.ts:1364-1378` → `customer.service.ts:467,473` |
| **F-3** | Hapus kartu tidak sticky: root masih menunjuk rumah itu; lokasi berikutnya re-create kartu (2 titik: `syncSavedAddressFromLocation:1511` dan `reservation-core.service.ts:540`). | `customer.service.ts:1375-1421` vs `:427-467`; `upsertAddressIntoList` (`domain/customer-address.ts:217`) |
| **F-4** | Belum ada test IDOR tenant / relink-edit-profil untuk route buku alamat. | `tests/unit/customer-address-book.test.ts` (18 test, tanpa kasus tenant-lain) |
| **F-5** | Tidak ada jalur "Tambah Alamat" (UI + POST). Gap fungsional, bukan stub. | `AddressBookDrawer.tsx`; `customers.subroute.ts` (hanya GET/PATCH/DELETE) |
| **F-6** | Konsumen tabel `customer_addresses` tipis (fallback saja). | `reservation-core.service.ts:465`; scripts |
| **F-7** | `#266.1` sheets kemungkinan basi — `row-formatter.ts` konsumsi `customerAddress` (:64,95-117,159-166,205), tapi pemanggil belum diverifikasi. **PERLU VERIFIKASI S-5 sebelum mengubah status issue.** | `src/services/sheets/row-formatter.ts` |

**Klaim anti-stub**: nihil route 501/stub pada permukaan ini. Aiuditor juga memeriksa `api.ts:359-363` → `apiRequest` passthrough `err.status`/`err.data` → penanganan 409 drawer valid.

## 2. Hasil Audit v2 + Revisi terhadap v1

- **R-1 (revisi S-1.3)**: ~10 pemanggil `updateCustomerLocation` tidak konsisten terlindung try/catch (`location-ingest.service.ts:149` di `try`, `reservation-lifecycle.service.ts:95` `.catch`, `human-background-enrichment.service.ts:235/299/379/521` campuran) → **throw = risiko 500 webhook chat**. S-1.3 REVISI: **tanpa throw**.
- **R-2 (revisi S-1.1)**: jangan load customer ekstra tiap call — hanya bila `data.lat != null && data.lng != null`.
- **R-3 (revisi S-5)**: verifikasi pemanggil `formatReservationRow` menyertakan kolom kartu SEBELUM menandai `#266.1` basi.
- **Audit UI/UX (impeccable)**: `AddressBookDrawer` PASS besar (loading/error state, 44px target, aria-label, focus-visible, active:scale, useUiFeedback, 409 + activeCount); footer "Utama pindah ke rumah terakhir dipakai" AKURAT (`ensureSinglePrimary → resolveActiveAddress` lastUsedAt). Celah: **U-1** tanpa Esc-to-close, **U-2** tanpa Tambah Alamat, **U-3** copy confirm CustomerEditForm belum menjelaskan efek relink jadwal aktif, **U-4** `StaffSchedule.tsx` tanpa tampilan alamat sama sekali (gap dicatat, desain menyusul — tidak masuk fase ini).
- Role customer (WhatsApp): tidak tersentuh perilaku; tombstone invisible; tanpa teks "DILARANG..." baru. PASS.

---

## FASE S-1 — Satu Penulis Kolom Lokasi

**Blast radius**: pemanggil `updateCustomer`: `customers.subroute.ts:1123`, `reservation-crud.route.ts:994`, `human-background-enrichment.service.ts:337`, `live-chat.service.ts:844`, `reservation-lifecycle.service.ts:105`.

### S-1.1 Guard sumber lokasi (perbaiki F-1b)
- **File**: `src/services/customer.service.ts:1023-1027`.
- **Ganti** 4 baris berikut:
```ts
    if (data.lat !== undefined) updateData.lat = CustomerService.toNumberOrNull(data.lat);
    if (data.lng !== undefined) updateData.lng = CustomerService.toNumberOrNull(data.lng);
    if (data.lat != null && data.lng != null) {
      updateData.location_source = LocationSource.manual_staff;
    }
```
- **Menjadi**:
```ts
    if (data.lat !== undefined) updateData.lat = CustomerService.toNumberOrNull(data.lat);
    if (data.lng !== undefined) updateData.lng = CustomerService.toNumberOrNull(data.lng);
    // Presisi dihormati (F-1b): sumber lokasi HANYA diturunkan bila koordinat
    // benar-benar berubah ATAU admin memaksa pindah rumah. Form yang mengirim
    // ulang koordinat lama TIDAK boleh menurunkan gps_pin → manual_staff.
    if (data.lat != null && data.lng != null) {
      const prior = await this.getCustomerById(customerId, tenantId);
      const coordsChanged =
        CustomerService.toNumberOrNull(data.lat) !== prior?.lat ||
        CustomerService.toNumberOrNull(data.lng) !== prior?.lng;
      const preciseLockedLocal =
        !!prior && CustomerService.isPreciseGps(prior) && !coordsChanged && !data.forceUpdateGps;
      if (!preciseLockedLocal) {
        updateData.location_source = LocationSource.manual_staff;
      }
    }
```

### S-1.2 Tutup kebocoran relink (perbaiki F-1)
- **Anchor**: sisipkan tepat sebelum `return finalCustomer || updated;` (`:1216`).
```ts
      // SEAM KANONIS (fondasional): Edit Profil Admin TIDAK BOLEH jadi penulis
      // lokasi "kedua" yang lepas dari sinkronisasi (F-1). Setelah koordinat
      // tersimpan: 1) selaraskan buku alamat; 2) selaraskan jadwal aktif.
      const touchedLocation =
        data.kelurahan !== undefined || data.kecamatan !== undefined ||
        data.kota !== undefined || data.lat !== undefined || data.lng !== undefined;
      if (touchedLocation && finalCustomer) {
        try {
          await this.syncSavedAddressFromLocation(finalCustomer, tenantId, {
            address: (data.address !== undefined ? data.address : (finalCustomer.preferences as any)?.address) || '',
            kelurahan: data.kelurahan !== undefined ? data.kelurahan : finalCustomer.kelurahan,
            kecamatan: data.kecamatan !== undefined ? data.kecamatan : finalCustomer.kecamatan,
            kota: data.kota !== undefined ? data.kota : finalCustomer.kota,
            lat: data.lat !== undefined ? CustomerService.toNumberOrNull(data.lat) : finalCustomer.lat,
            lng: data.lng !== undefined ? CustomerService.toNumberOrNull(data.lng) : finalCustomer.lng,
            distanceKm: finalCustomer.distance_km,
            ongkir: finalCustomer.ongkir,
            locationSource: finalCustomer.location_source,
          } as any);
        } catch (syncErr) {
          console.warn('[CustomerService] updateCustomer saved-address sync failed (best-effort):', (syncErr as Error)?.message);
        }
        // Tanpa throw (keputusan user 2026-10-18): kegagalan relink di-log keras;
        // drift tetap tertutup test unit (S-4) dan event pengganti lokal berikutnya.
        await this.syncActiveReservationsAfterLocationChange(customerId, tenantId);
      }
```
- **Konsolidasi**: blok `upsertSavedAddress` lama di `:1120-1139` DIHAPUS (diganti `syncSavedAddressFromLocation` di atas — hindari dua penulis kartu).

### S-1.3 Non-throwing sync (keputusan user)
- **File**: `src/services/customer.service.ts:588-595`.
- **Ganti** `console.warn` + tanpa throw:
```ts
  private async syncActiveReservationsAfterLocationChange(customerId: string, tenantId: string): Promise<void> {
    try {
      const { syncActiveReservationsForCustomer } = await import('./reservation-address-sync.service');
      await syncActiveReservationsForCustomer({ tenantId, customerId });
    } catch (e) {
      // Tanpa throw (R-1, keputusan user): ~10 pemanggil tidak konsisten punya
      // try/catch; throw = risiko 500 webhook chat. Kegagalan di-log keras dan
      // ditutup test drift (S-4).
      console.error('[CustomerService] active reservation sync FAILED:', {
        customerId, message: (e as Error)?.message,
      });
    }
  }
```
- Laporkan juga kejadian ke sistem log terstruktur bila helper `logEvent`/event tersedia; kalau tidak, cukup konsol terstruktur.

**Acceptance criteria S-1**
- [ ] Edit profil customer ber-pin `gps_pin` (form kirim koordinat lama) → `location_source` TETAP `gps_pin`.
- [ ] Edit profil dengan koordinat baru + jadwal aktif ada → `Reservation.customer_address_id` ikut relink.
- [ ] Sync jadwal gagal (simulasi error) → TIDAK ada throw ke pemanggil; log error terlihat.
- [ ] `npm run build` hijau; `npx vitest run tests/unit/customer-profile-edit-drift.test.ts tests/unit/customer-saved-addresses.test.ts tests/unit/customer-address-book.test.ts` hijau.

**Test baru (TDD — tulis dulu, MERAH)** di `tests/unit/customer-profile-edit-drift.test.ts`:
```ts
it('edit profil (kelurahan) + jadwal aktif → sync relink dipanggil (anti drift)', ...)
it('form kirim ulang koordinat lama → location_source gps_pin TIDAK turun', ...)
it('sync jadwal gagal → updateCustomer tetap resolve (tanpa throw)', ...)
```

---

## FASE S-2 — Gate "Koordinat Benar-Benar Berubah" (F-2, Opsi A)

**Dependency**: S-1 selesai.
**File**: `src/routes/admin/customers.subroute.ts` (blok `PUT /api/admin/customers/:id/location`, `:1338-1383`).

1. Di atas pemanggilan `updateCustomerLocation` (`:1363`), hitung gate deterministik:
```ts
        // Gate "lokasi benar-benar berubah" (Opsi A, keputusan user): seam +
        // relink jadwal aktif hanya bila koordinat pelanggan berubah. Ubah
        // landmark/foto TIDAK memicu relink (jadwal Rumah 2 tetap aman).
        const coordsChanged =
          lat !== undefined && lng !== undefined && lat != null && lng != null &&
          (lat !== (customer as any).lat || lng !== (customer as any).lng);
```
2. Bungkus pemanggilan seam: `if (coordsChanged) { ...blok :1363-1383... } else { updatedCustomer = customer; }`.
3. Jalur media/foto-landmark (`:1385-1420`) TETAP jalan untuk semua kasus.

**Acceptance S-2**
- [ ] Ubah landmark/foto saja aktif-Jadwal-Rumah-2 → `customer_address_id` tidak berubah.
- [ ] Ubah koordinat → kartu + jadwal aktif tersinkron.
- [ ] `npm run build` hijau; `npx vitest run tests/unit/staff-location-photo-guard.test.ts tests/unit/customer-profile-edit-drift.test.ts` hijau.

---

## FASE S-3 — Tombstone Hapus Kartu (F-3, Opsi A)

**Dependency**: S-1.
**Bentuk data** (tanpa migrasi): `preferences.address_tombstones: Array<{address,kelurahan,kecamatan,kota,deletedAt}>` — maks 20 FIFO, expired >90 hari diabaikan/dibuang saat tulis.

### Micro-task
1. **Tulis tombstone** — `deleteSavedAddress` (`:1375-1421`): setelah `removeAddressFromList`, sebelum persist: sisipkan tombstone dari kartu yang dihapus ke `prefs.address_tombstones` (slice(-20)), lalu `persistSavedAddresses` membawanya (pastikan field ikut tersimpan).
2. **Cek tombstone saat auto-create** di 2 titik:
   - `syncSavedAddressFromLocation` (`customer.service.ts:1504-1513`): sebelum `upsertAddressIntoList`, bila `loc` cocok tombstone (`addressesMatch`) **dan** belum expired → tulis HANYA root/prefs tanpa menambah kartu (return tanpa upsert).
   - `resolveCustomerAddressId` (`reservation-core.service.ts`, sebelum `customerService.upsertSavedAddress` di `:540`): bila kandidat cocok tombstone → **jangan buat kartu**; lanjut fallback primary (`:558`).
3. **Bersihkan tombstone saat penambahan manual admin** (S-UX `addSavedAddress`): buang tombstone yang cocok dengan alamat baru.
4. **Helper baru** (domain, murni + test): `pruneAddressTombstones(list, now)` dan `matchTombstone(t Tombstone, input)` di `src/domain/customer-address.ts`.

**Acceptance S-3**
- [ ] Hapus Rumah 2 → `updateCustomerLocation` (simulasi chat) → kartu Rumah 2 TIDAK muncul lagi.
- [ ] Admin tambah manual alamat sama → boleh; tombstone ikut terhapus.
- [ ] >90 hari → tombstone diabaikan.
- [ ] Test baru di `tests/unit/customer-address-book.test.ts`: "hapus kartu tidak di-recreate oleh sync berikutnya" + "tombstone expired diabaikan".

---

## FASE S-UX — Buku Alamat: Esc, Tambah Alamat, Copy (keputusan user)

### S-UX.1 Esc-to-close (impeccable 5.1)
- **File**: `packages/admin-dashboard/src/components/customer/AddressBookDrawer.tsx`
- Efek `useEffect`: bila `customer` ada → `keydown` listener `Escape` → `close()` (kecuali `editingId` muncul → tutup edit dulu). Bersihkan listener saat unmount/close.

### S-UX.2 Route + service "Tambah Alamat"
- **Service**: `addSavedAddress(customerId, input: {label, address?, kelurahan?, kecamatan?, kota?}, tenantId)` di `customer.service.ts` (delegasi `upsertSavedAddress` — aturan dedup/kapasitas/FIFO invarian tetap; label WAJIB tidak kosong) + **hapus tombstone yang cocok** (S-3.3). Bila alamat sama persis sudah ada → kembalikan kartu eksisting (dedup), bukan error.
- **Route**: `POST /api/admin/customers/:id/addresses` di `customers.subroute.ts` (setelah PATCH label, ~`:575`): 200 `{address}` / 400 label kosong / 404 customer tak ada. Auditor tenant-scoped `tenantOf(request)`.

### S-UX.3 UI Drawer "+ Tambah Alamat"
- Tombol primer (`bg-[#008069] text-white`, ≥44px) di header drawer → form mini inline (label wajib; address/kelurahan/kecamatan/kota opsional) → submit → toast sukses + `load()` + `onChanged`. State: `disabled` saat submit, validasi kosong inline.

### S-UX.4 Copy konfirmasi CustomerEditForm
- **File**: `CustomerEditForm.tsx` (`:273-279`): pesan confirm ditambah 1 kalimat: `"Perubahan alamat/lokasi dapat memperbarui alamat jadwal aktif yang belum selesai."` (teks data-driven boléh, tidak hardcode SOP).

**Acceptance S-UX**
- [ ] Esc menutup modal/pendamping; fokus terjaga.
- [ ] Tambah alamat baru dari drawer → muncul di daftar + jadwal aktif bisa dipilih; label kosong → 400 + toast.
- [ ] Dedup: alamat sama → 1 kartu (kembali kartu eksisting).
- [ ] `npm run build` + build dashboard hijau; test S-4 hijau.

---

## FASE S-4 — Test Adversarial (diperluas)

**File**: `tests/unit/customer-address-book.test.ts`
1. **IDOR tenant**: kartu tenant lain → DELETE/PATCH default/label → **404** (bukan 200).
2. **Kapasitas 10 FIFO + primary bertahan** di `upsertSavedAddress` & `addSavedAddress`.
3. **Dedup kembar** (norm text + koordinat) → 1 kartu.
4. **Hapus primary → promosi lastUsedAt** (invarian tepat 1 primary).
5. **Hapus saat jadwal aktif → 409** `activeCount`; batalkan jadwal → hapus 200.
6. **Tombstone**: hapus → tidak re-create (2 titik); manual add → tombstone hilang; expired 90 hari.

**Gate**: `npx vitest run tests/unit/customer-address-book.test.ts tests/unit/dashboard-address-match-parity.test.ts`.

---

## FASE S-5 — Dokumentasi & Gerbang Regresi Akhir

1. Verifikasi F-7 dulu: baca pemanggil `formatReservationRow` (sheets) — sertakah kolom kartu? Baru perbarui status `#266.1` di `docs/KNOWN_ISSUES.md` (+ catat S-UX.4 dst; tambah U-4 StaffSchedule sebagai gap).
2. `CHANGELOG.md` (format Keep a Changelog) — lewat skill `changelog-mandate`.
3. `graphify update .` setelah semua edit.
4. **Gerbang penuh**: `npm run build`; `npx vitest run` → vs baseline pre-existing **7 file / 14 test** (v3-conversation-matrix ×2, agent-runner ×1, adversarial-reservation-resilience ×1, catalog-seed-drift ×3, chat-schedule-extractor ×2, reservation-security-and-integrity ×4, staff-otw-chat-poison ×1). Failure baru = regresi; klaim pre-existing wajib revert-and-rerun.
5. Deploy (approval terpisah): `git pull` + `docker compose build app worker` + `up -d --no-deps app worker`; tanpa migrasi; WAHA tidak disentuh; verifikasi `/health` + probe route.

---

## 3. Risiko Regresi & Implikasi Masa Depan

| Risiko | Mitigasi |
|--------|----------|
| S-1 mengubah perilaku 5 pemanggil `updateCustomer` (termasuk live-chat `:844`) | Test regresi tiap pemanggil (`live-chat`, `human-background-enrichment`, `reservation-lifecycle-homonym-gate`) |
| S-1.2 memicu upsert kartu dari root teks kosong | `addressesMatch` + validasi candidate non-empty (warisan blok lama) |
| S-2 gate mencegah koreksi jarak setelah ubah landmark | Jarak/ongkir tetap dihitung di route (`calculateDelivery` `:1244-1250`); hanya relink yang digate |
| S-3 tombstone menghalangi pelanggan kembali ke rumah sebelumnya | Expired 90 hari + kartu manual admin menghapus tombstone; kuota 20 |
| S-UX route baru tanpa auth check? | Route hidup di subroute admin (auth diterapkan di layer admin — verifikasi 401 tanpa key saat deploy) |
| Downgrade `location_source` sudah terjadi di data produksi | Audit DB live read-only; skrip koreksi terpisah (butuh approval) |

## 4. Urutan Eksekusi (staged) & Gerbang

1. **S-1** → gate: build + 3 file test + suite pemanggil.
2. **S-2** → gate: build + staff-location-photo-guard + profile-edit-drift.
3. **S-3** → gate: build + customer-address-book.
4. **S-UX** → gate: build bot + build dashboard + customer-address-book.
5. **S-4** → gate: build + customer-address-book + parity.
6. **S-5** → docs + full-suite gate (+ deploy dengan approval terpisah).

> Setiap fase ditutup gerbang regresi sebelum lanjut. Dilarang melompat fase.

## 5. Di luar plan ini (butuh keputusan terpisah)
- Verifikasi Firda live + eksekusi heal produksi (gate 2-langkah).
- Audit/skrip koreksi `location_source` downgrade di data produksi.
- U-4: tampilan alamat di `StaffSchedule.tsx` (desain menyusul).
