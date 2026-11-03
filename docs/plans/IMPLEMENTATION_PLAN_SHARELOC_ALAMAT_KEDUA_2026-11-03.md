# IMPLEMENTATION PLAN — Shareloc Berubah Menjadi "Alamat Kedua"

- **Tanggal**: 2026-11-03
- **Status**: **IMPLEMENTED (2026-11-03)** — patch pasca-audit (pemenang healing, normalisasi tabel, disambiguasi multi-kartu) dieksekusi. Lihat `CHANGELOG.md` & `docs/KNOWN_ISSUES.md` #303.
- **Sumber temuan**: laporan pengguna + audit kode read-only (`docs/plans/IMPLEMENTATION_PLAN_SHARELOC_ALAMAT_KEDUA_2026-11-03.md` ini adalah tindak lanjut audit double-alamat 2026-11-03).
- **Sifat perbaikan**: fondasional (State Machine alamat + kontrak domain + integritas data). **Bukan** tambalan prompt, **bukan** regex, **bukan** pengecualian per kalimat.
- **Zero dependency baru. Zero migrasi skema.**

---

## 0. Gejala yang Dilaporkan

> "Ada orang share lokasi, padahal alamat pertama belum ada shareloc-nya, tiba-tiba shareloc-nya dijadikan alamat kedua."

Ekspektasi: shareloc **melengkapi** kartu alamat pertama (yang belum punya titik GPS).
Realita: lahir kartu **baru** ("Rumah X 2"), alamat pertama tetap tanpa GPS.

---

## 1. Root Cause (terverifikasi di kode, bukan asumsi)

| # | Fakta | Bukti |
|---|-------|-------|
| RC-1 | Shareloc masuk tanpa teks jalan | `src/services/location-ingest.service.ts:149-164` — payload hanya `kelurahan/kecamatan/kota/lat/lng/zipcode/isNativePin` |
| RC-2 | Teks jalan diambil dari satu kolom global | `src/services/customer.service.ts:473` — `prevAddress = data.address?.trim() \|\| preferences.address \|\| ''` |
| RC-3 | Kelurahan berbeda → dianggap rumah berbeda (hard-stop) | `src/domain/customer-address.ts:193` — `if (sameKec && !kelKompatibel) return false;` dijalankan sebelum cabang alamat-jalan-identik (`:208-213`) |
| RC-4 | Tidak match → entri baru dibuat | `src/domain/customer-address.ts:390-418` (`buildAutoLabel` → "Rumah X 2") |
| RC-5 | Perilaku ini dikunci test | `tests/unit/customer-saved-addresses-enrichment.test.ts:105` — `beda kelurahan → false` |
| RC-6 | Jalur booking punya perilaku sama | `src/services/reservation-core.service.ts:549-586` — `addressesMatch` gagal → `upsertSavedAddress` tanpa `isPrimary` → kartu kedua non-primary |

**Kesimpulan:** tidak ada aturan "pin GPS pertama wajib memperkaya kartu tunggal yang belum ber-GPS". Keputusan sama-rumah hanya berbasis teks wilayah yang ketat, sehingga shareloc yang reverse-geocode-nya beda tipis/gara-gara data lama kotor selalu melahirkan rumah baru.

---

## 2. Keputusan Desain (Confirmation Gate)

| # | Topik | Keputusan (rekomendasi) | Alternatif yang DITOLAK |
|---|-------|-------------------------|--------------------------|
| D-1 | Arah perbaikan | **Gerbang pengayaan deterministik** `selectEnrichmentTarget()`: pin GPS memperkaya kartu lama yang **belum punya koordinat** dan **wilayahnya kompatibel** | Melonggarkan `addressesMatch` global → berisiko menggabungkan rumah 2 yang sah |
| D-2 | Definisi "wilayah kompatibel" | kecamatan & kelurahan: kosong **atau** sama **atau** token-match **atau** typo Levenshtein ≤2 (fungsi yang sudah ada) | Pencocokan string persis (penyebab bug) |
| D-3 | Multi-kartu | Hanya 1 kandidat → perkaya. >1 kandidat → pilih `isPrimary`, jika tidak ada → `lastUsedAt` terbaru | Menebak dari kalimat / merge semua |
| D-4 | Pin di rumah lain | Wilayah tidak kompatibel → tetap buat kartu baru (rumah 2 sah) | Selalu memperkaya kartu pertama (merusak multi-rumah) |
| D-5 | Sumber teks jalan | Saat memperkaya kartu tunggal, pakai teks kartu itu, **bukan** `preferences.address` | Tetap pakai `preferences.address` (risiko campur rumah lain) |
| D-6 | Data lama | Skrip healing idempoten, **default dry-run**, `--commit` eksplisit, backup wajib | Auto-heal saat boot (blast radius tak terkendali) |

---

## 3. Fase & Micro-Task

### FASE 0 — Gerbang Verifikasi Data (READ-ONLY, wajib sebelum kode)

**Tujuan:** membuktikan pola ini benar-benar terjadi di produksi & mengukur jumlah korban.

**0.1 Query discovery (read-only, via `server-access` skill):**

```sql
-- Pasangan kartu: kartu lama tanpa GPS + kartu GPS baru (7 hari terakhir)
SELECT c.name, c.phone,
       old.id AS old_id, old.label AS old_label, old.kelurahan AS old_kel,
       old.kecamatan AS old_kec, old.address AS old_addr, old.created_at AS old_created,
       new.id AS new_id, new.label AS new_label, new.kelurahan AS new_kel,
       new.kecamatan AS new_kec, new.lat, new.lng, new.created_at AS new_created
FROM customers c
JOIN customer_addresses new
  ON new.customer_id = c.id AND new.location_source = 'gps_pin'
 AND new.created_at >= now() - interval '30 days'
JOIN customer_addresses old
  ON old.customer_id = c.id AND old.id <> new.id
 AND old.created_at < new.created_at AND old.lat IS NULL
ORDER BY new.created_at DESC;
```

**Acceptance Fase 0:**
- [ ] Daftar pelanggan terdampak + ID kartu tercatat di laporan.
- [ ] Minimal 1 kasus nyata dikonfirmasi ke pengguna (nama/nomor) sebelum lanjut.
- [ ] Jika **0 kasus** → STOP, plan direvisi (jangan koding berdasarkan asumsi).

**Regression gate:** tidak ada (read-only).

---

### FASE 1 — Test Merah (TDD, tanpa mengubah kode produksi)

**File baru:** `tests/unit/shareloc-enrichment-single-card.test.ts`

**1.1 Tulis 7 kasus adversarial:**

```ts
import { describe, it, expect } from 'vitest';
import { selectEnrichmentTarget, upsertAddressIntoList } from '../../src/domain/customer-address';

const NOW = '2026-11-03T10:00:00.000Z';
const card = (o: any) => ({
  id: 'c1', label: 'Rumah Karah', address: 'Jl. Karah Tama No. 10',
  kelurahan: 'Karah', kecamatan: 'Jambangan', kota: 'Surabaya',
  lat: null, lng: null, distanceKm: null, ongkir: null, landmark: null,
  locationSource: null, isPrimary: true, createdAt: NOW, lastUsedAt: NOW, ...o,
});

describe('Shareloc pertama wajib memperkaya kartu tunggal (bukan alamat kedua)', () => {
  it('S1. 1 kartu tanpa GPS + pin kelurahan BEDA se-kecamatan → 1 kartu, bukan 2', () => {
    const list = [card({})];
    const input = { kelurahan: 'Jambangan', kecamatan: 'Jambangan', kota: 'Surabaya', lat: -7.32, lng: 112.72, locationSource: 'gps_pin' as const };
    const target = selectEnrichmentTarget(list as any, input);
    expect(target?.id).toBe('c1');
    const { list: next, entry } = upsertAddressIntoList(list as any, { ...input, id: target!.id }, NOW);
    expect(next).toHaveLength(1);
    expect(entry.id).toBe('c1');
    expect(entry.address).toBe('Jl. Karah Tama No. 10'); // teks lama TIDAK hilang
    expect(entry.lat).toBe(-7.32);
    expect(entry.isPrimary).toBe(true);
  });

  it('S2. pin di kecamatan lain (rumah 2 sah) → TETAP 2 kartu', () => {
    const list = [card({})];
    const input = { kelurahan: 'Gadung', kecamatan: 'Driyorejo', kota: 'Gresik', lat: -7.35, lng: 112.62 };
    expect(selectEnrichmentTarget(list as any, input)).toBeNull();
  });

  it('S3. 2 kartu, pin cocok kartu non-primary tanpa GPS → perkaya kartu itu', () => {
    const list = [card({ id: 'a', isPrimary: true, kelurahan: 'Karah', kecamatan: 'Jambangan' }),
                  card({ id: 'b', isPrimary: false, address: 'Jl. Kenanga 8', kelurahan: 'Waru', kecamatan: 'Waru' })];
    const input = { kelurahan: 'Waru', kecamatan: 'Waru', kota: 'Sidoarjo', lat: -7.35, lng: 112.72 };
    expect(selectEnrichmentTarget(list as any, input)?.id).toBe('b');
  });

  it('S4. pin <150 m dari kartu ber-GPS → tetap 1 kartu (aturan lama)', () => {
    const list = [card({ lat: -7.3200, lng: 112.7200 })];
    const input = { kelurahan: 'Karah', kecamatan: 'Jambangan', lat: -7.3205, lng: 112.7205 };
    expect(selectEnrichmentTarget(list as any, input)).toBeNull(); // ditangani addressesMatch
  });

  it('S5. id eksplisit menang mutlak', () => {
    const list = [card({}), card({ id: 'z', isPrimary: false })];
    expect(selectEnrichmentTarget(list as any, { id: 'z' } as any)?.id).toBe('z');
  });

  it('S6. input tanpa koordinat → tidak pernah jadi target pengayaan', () => {
    expect(selectEnrichmentTarget([card({})] as any, { kelurahan: 'Karah' } as any)).toBeNull();
  });

  it('S7. wilayah kartu kosong + pin baru → perkaya (bukan kartu baru)', () => {
    const list = [card({ kelurahan: null, kecamatan: null })];
    expect(selectEnrichmentTarget(list as any, { kelurahan: 'Karah', kecamatan: 'Jambangan', lat: -7.32, lng: 112.72 })?.id).toBe('c1');
  });
});
```

**1.2 Test integrasi seam** (tambahkan ke file yang sama):

```ts
it('S8. updateCustomerLocation(isNativePin) → 1 kartu + root & kartu konsisten', async () => {
  // mock prisma + customerService seperti pola tests/unit/customer-address-book.test.ts
  // assert: getSavedAddresses(customerId).length === 1
  // assert: card.lat === root.lat && card.locationSource === 'gps_pin'
});
```

**Perintah:** `npx vitest run tests/unit/shareloc-enrichment-single-card.test.ts`
**Acceptance Fase 1:** test **MERAH** untuk S1/S3/S7/S8, hijau untuk S2/S4/S5/S6.
**Regression gate:** belum dijalankan (kode belum berubah).

---

### FASE 2 — Domain: `selectEnrichmentTarget()` + `isRegionCompatible()`

**File:** `src/domain/customer-address.ts`
**Lokasi sisip:** setelah `addressesMatch()` (setelah baris `:232`).

**2.1 Tambahkan helper + selector (fungsi murni, tanpa I/O):**

```ts
function hasCoords(v: { lat?: number | null; lng?: number | null }): boolean {
  return typeof v.lat === 'number' && Number.isFinite(v.lat)
      && typeof v.lng === 'number' && Number.isFinite(v.lng);
}

/**
 * Kompatibilitas wilayah (data-driven, bukan daftar hafalan):
 * kosong di salah satu sisi, sama persis, token-match, atau typo Levenshtein <= 2.
 */
export function isRegionCompatible(
  a: { kelurahan?: string | null; kecamatan?: string | null },
  b: { kelurahan?: string | null; kecamatan?: string | null }
): boolean {
  const kecOk =
    !hasText(a.kecamatan) || !hasText(b.kecamatan) ||
    norm(a.kecamatan) === norm(b.kecamatan) ||
    wilayahTokenMatch(a.kecamatan, b.kecamatan) ||
    isWilayahSimilar(a.kecamatan, b.kecamatan);
  if (!kecOk) return false;
  return (
    !hasText(a.kelurahan) || !hasText(b.kelurahan) ||
    norm(a.kelurahan) === norm(b.kelurahan) ||
    wilayahTokenMatch(a.kelurahan, b.kelurahan) ||
    isWilayahSimilar(a.kelurahan, b.kelurahan)
  );
}

/**
 * Gerbang anti "shareloc jadi alamat kedua".
 * Pin GPS baru HANYA boleh membuat kartu baru bila tidak ada kartu lama
 * yang (a) belum berkoordinat dan (b) wilayahnya kompatibel.
 */
export function selectEnrichmentTarget(
  list: SavedCustomerAddress[],
  input: UpsertSavedAddressInput
): SavedCustomerAddress | null {
  if (input.id) return list.find((a) => a.id === input.id) || null; // eksplisit menang
  if (!hasCoords(input)) return null;
  const candidates = list.filter((a) => !hasCoords(a) && isRegionCompatible(a, input));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const primary = candidates.find((a) => a.isPrimary);
  if (primary) return primary;
  return [...candidates].sort((x, y) => (x.lastUsedAt < y.lastUsedAt ? 1 : -1))[0];
}
```

**Acceptance Fase 2:**
- [ ] `npx vitest run tests/unit/shareloc-enrichment-single-card.test.ts` → S1–S7 **hijau**.
- [ ] Test domain lama tetap hijau: `customer-saved-addresses-enrichment.test.ts`, `address-match-null-kelurahan.test.ts`, `customer-address-rumah-kedua.test.ts`.

**Regression gate Fase 2:**
```
npx vitest run tests/unit/shareloc-enrichment-single-card.test.ts tests/unit/customer-saved-addresses-enrichment.test.ts tests/unit/address-match-null-kelurahan.test.ts tests/unit/customer-address-rumah-kedua.test.ts
```
Semua hijau. Jika ada yang merah karena aturan E3 (rumah 2 sah) → **STOP**, revisi gate.

---

### FASE 3 — Service: pakai gerbang pengayaan di seam tulis

**File:** `src/services/customer.service.ts`

**3.1 `syncSavedAddressFromLocation` (`:1746-1759`) — sisipkan seleksi target:**

```ts
private async syncSavedAddressFromLocation(
  customer: any,
  tenantId: string,
  loc: UpsertSavedAddressInput & { isPrimary?: boolean }
): Promise<void> {
  const tombstones = parseAddressTombstones(customer?.preferences);
  if (tombstones.some((t) => matchesTombstone(t, loc))) return;
  const list = parseSavedAddresses(customer?.preferences);
  const nowIso = new Date().toISOString();
  // GERBANG: pin GPS memperkaya kartu lama tanpa koordinat, bukan membuat kartu baru.
  const target = selectEnrichmentTarget(list, loc);
  const { list: nextList } = upsertAddressIntoList(
    list,
    target ? { ...loc, id: target.id } : loc,
    nowIso
  );
  await this.persistSavedAddresses(customer, tenantId, nextList, nowIso);
}
```
Tambahkan `selectEnrichmentTarget` pada import dari `../domain/customer-address` di kepala file.

**3.2 `updateCustomerLocation` (`:471-473`) — teks jalan jangan dari rumah lain:**

Ganti:
```ts
const prevAddress = (data as any)?.address?.trim() || (existing.preferences as any)?.address || '';
```
Menjadi:
```ts
const existingCards = parseSavedAddresses(existing.preferences);
const singleCard = existingCards.length === 1 ? existingCards[0] : null;
const prevAddress = (data as any)?.address?.trim()
  || singleCard?.address
  || (existing.preferences as any)?.address
  || '';
```

**3.3 Mirror jalur memori (`:586`)** — terapkan perubahan yang sama (agar fallback test/DB-offline konsisten).

**Acceptance Fase 3:**
- [ ] S8 (integrasi) hijau: 1 kartu, teks lama bertahan, root = kartu.
- [ ] `tests/unit/location-ingest.test.ts` tetap hijau (5 test).
- [ ] `tests/unit/customer-saved-addresses.test.ts` + `customer-address-book.test.ts` hijau.

**Regression gate Fase 3:**
```
npx vitest run tests/unit/shareloc-enrichment-single-card.test.ts tests/unit/location-ingest.test.ts tests/unit/customer-saved-addresses.test.ts tests/unit/customer-address-book.test.ts
npm run build
```

---

### FASE 4 — Jalur Booking: `resolveCustomerAddressId` ikut gerbang yang sama

**File:** `src/services/reservation-core.service.ts` (`:549-586`)

**4.1 Sebelum blok pembuatan kartu baru, sisipkan:**

```ts
// GERBANG: pin/koordinat yang melengkapi kartu lama TIDAK boleh melahirkan rumah baru.
const enrichTarget = selectEnrichmentTarget(list as any, candidate as any);
if (enrichTarget) {
  const enriched = await customerService.upsertSavedAddress(
    customerId,
    { ...(candidate as any), id: enrichTarget.id },
    tenantId
  );
  if (enriched) return enriched.id;
}
```
Tambahkan `selectEnrichmentTarget` ke destructuring import `../domain/customer-address` di fungsi tersebut (`:480-485`).

**Acceptance Fase 4:**
- [ ] Test baru: booking dengan shareloc pada pelanggan 1-kartu-tanpa-GPS → `reservation.customer_address_id` = kartu lama (bukan baru).
- [ ] `tests/unit/multi-address-fase3.test.ts` + `admin-create-reservation.test.ts` hijau.

**Regression gate Fase 4:**
```
npx vitest run tests/unit/multi-address-fase3.test.ts tests/unit/admin-create-reservation.test.ts tests/unit/customer-address-rumah-kedua.test.ts
npm run build
```

---

### FASE 5 — Healing Data Lama (dry-run dulu, `--commit` belakangan)

**File baru:** `src/scripts/heal-shareloc-split-cards.ts`

**5.1 Aturan pasangan yang digabung (deterministik):**
1. Customer punya ≥ 2 kartu.
2. Kartu A **tanpa** koordinat, punya teks jalan.
3. Kartu B **ber** koordinat `gps_pin`.
4. `isRegionCompatible(A, B) === true`.
5. `B.created_at - A.created_at <= 10 menit` (pin mengikuti intake, bukan pindah rumah).
6. Bukan tombstone.

**5.2 Aksi merge (dalam 1 `$transaction`):**
- Pemenang = A (teks jalan dipertahankan).
- Salin `lat/lng/distance_km/ongkir/location_source/share_location_sent` dari B ke A.
- `reservations.updateMany({ customer_address_id: B.id } → A.id)`.
- `customer_addresses.delete({ id: B.id })`.
- Sinkronkan `customers.preferences.saved_addresses` dari sisa kartu (pola `heal-customer-addresses-split-brain.ts:401-435`).
- Tulis audit `SHARELOC_CARD_MERGED`.

**5.3 Perintah:**
```
npx tsx src/scripts/heal-shareloc-split-cards.ts --dry-run
npx tsx src/scripts/heal-shareloc-split-cards.ts --commit --backup
```

**Acceptance Fase 5:**
- [ ] Dry-run menampilkan daftar pasangan + rencana merge (tanpa menulis).
- [ ] `pg_dump` tabel `customers`, `customer_addresses`, `reservations` dibuat sebelum `--commit`.
- [ ] Setelah commit: query "pasangan shareloc ganda" = **0**.
- [ ] Kartu hasil merge: `lat IS NOT NULL`, `address` lama tidak kosong, `is_primary` tepat 1.

**Regression gate Fase 5:**
```
npx vitest run tests/unit/customer-address-book.test.ts tests/unit/customer-address-rumah-kedua.test.ts
npm run build
```

---

### FASE 6 — Penutup Wajib (dokumen & anti-regresi)

1. `docs/KNOWN_ISSUES.md` — entri baru: *"Shareloc pertama melahirkan kartu kedua (RC-1..RC-6)"* + status IMPLEMENTED + bukti test.
2. `CHANGELOG.md` — catat di versi terbaru (Keep a Changelog) + regenerate `docs/changelog/INDEX.md`.
3. `docs/FEATURE_INVENTORY.md` — perbarui deskripsi alur buku alamat (aturan pengayaan).
4. `graphify update .` setelah edit kode.

**Regression gate akhir:**
```
npm run build
npm test
```
Baseline kegagalan pre-existing yang diketahui: **14 test / 7 file** (`KNOWN_ISSUES.md` #266 butir 5). Jumlah kegagalan **tidak boleh bertambah**. Klaim "pre-existing" wajib dibuktikan revert-and-rerun.

---

## 4. FMEA (dihitung sebelum eksekusi)

| ID | Risiko | S | O | D | RPN | Mitigasi |
|----|--------|---|---|---|-----|----------|
| R-1 | Gerbang pengayaan menggabungkan rumah 2 yang sah | 8 | 3 | 5 | 120 | Gate `isRegionCompatible` + test S2/S3 + dry-run data |
| R-2 | Healing script salah pilih pemenang | 8 | 2 | 4 | 64 | Dry-run, backup, jendela waktu 10 menit, audit log |
| R-3 | Root profil & kartu tetap divergen setelah merge | 6 | 3 | 6 | 108 | Test S8 (root = kartu) + `syncActiveReservationsForCustomer` |
| R-4 | Regresi `addressesMatch` (80+ test) | 7 | 2 | 4 | 56 | Tidak mengubah `addressesMatch`; hanya menambah fungsi baru |
| R-5 | Teks jalan lama hilang saat merge | 7 | 2 | 4 | 56 | Winner = kartu ber-teks; test S1 (`address` tetap) |

**Urutan aman:** Fase 0 → 1 → 2 → 3 → 4 → 5 → 6. Setiap fase bisa di-`git revert` mandiri.

**Rollback:** Fase 1–4 murni kode (revert). Fase 5 mengubah data → wajib `pg_dump` + backup JSON; tanpa backup, **DILARANG** `--commit`.

---

## 5. Verifikasi Keberhasilan (definisi "selesai")

| Kriteria | Cara ukur |
|---|---|
| Shareloc pertama tidak lagi membuat kartu baru | Test S1/S3/S7/S8 hijau |
| Rumah 2 yang sah tetap terpisah | Test S2/S3 + suite `customer-address-rumah-kedua` hijau |
| Root & kartu konsisten | Test S8 (lat/lng/source sama) |
| Data lama bersih | Query pasangan ganda = 0 setelah `--commit` |
| Tidak ada regresi | `npm run build` + `npm test` ≤ baseline 14 gagal |

---

## 6. Di Luar Cakupan Plan Ini (tetap terbuka dari audit 2026-11-03)

- A-001: alamat jalan identik tapi kelurahan beda → 4 pasang kartu ganda (butuh plan dedup terpisah).
- A-002: 17 baris yatim + 9 kartu JSON-only (butuh plan rekonsiliasi JSON↔tabel).
- A-003: `setDefaultAddress`/`deleteSavedAddress` tidak menyinkronkan root.
- A-004: `preferences.address` tunggal untuk banyak rumah.
- A-005: `resolveCustomerAddressId` bisa mengembalikan ID yang tidak ada di tabel.

Plan ini **hanya** menutup gejala "shareloc menjadi alamat kedua" tanpa menambah risiko pada empat temuan lain.
