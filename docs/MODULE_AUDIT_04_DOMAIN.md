# AUDIT MODUL 4 DARI 16 — DOMAIN MURNI

**Modul:** `src/domain/*` (10 file TypeScript, 1.811 baris)
**Commit:** `c8ce5b21` (`master`), working tree bersih
**Tanggal audit:** 2026-11-07
**Sifat:** read-only. Tidak ada file source yang diubah.
**Metode:** baca seluruh 10 file, lacak pemakai via `rg`, dan periksa paritas antara fungsi domain dengan query/service yang memakainya.

---

## CAKUPAN YANG SUDAH DIBACA

**Seluruh 10 file `.ts` di `src/domain` sudah dibaca penuh (1.811 baris).**

| File | Baris | Status |
|---|---:|---|
| `address-healing.ts` | 58 | Dibaca penuh |
| `address-reconciliation.ts` | 100 | Dibaca penuh |
| `customer-address.ts` | 620 | Dibaca penuh |
| `dispatch-visit-context.ts` | 62 | Dibaca penuh |
| `location-adequacy.ts` | 200 | Dibaca penuh |
| `payment-expected.ts` | 80 | Dibaca penuh |
| `reservation-payment.ts` | 40 | Dibaca penuh |
| `reservation-status.ts` | 164 | Dibaca penuh |
| `shareloc-solicitation.ts` | 56 | Dibaca penuh |
| `staff-retention.ts` | 431 | Dibaca penuh |
| **Total** | **1.811** | **100%** |

**Dependensi yang dibaca sebagian (untuk memahami perilaku, bukan modul ini):**
`src/services/copilot/copilot-tools.ts:190-212`, `720-735`; `src/services/reservation-core.service.ts:410-435`; `src/services/customer.service.ts:1640-1650`, `1750-1765`; `src/services/reservation-address-sync.service.ts:40-60`; `src/services/live-chat.service.ts:1315-1400`; `src/scripts/heal-shareloc-split-cards.ts:131-190`; `src/scripts/reconcile-customer-addresses.ts:90-110`; test domain terkait.

**Test:** seluruh 10 file domain punya test khusus (lihat Lampiran 1). Tidak ada file domain tanpa test.

---

## A. RINGKASAN MODUL + SKOR KESEHATAN

`src/domain` adalah lapisan yang paling sehat secara arsitektur di antara modul fondasi yang sudah diaudit: seluruh fungsi murni, tanpa DB/network, deterministik, dan setiap file punya test. Modul ini berhasil menjadi seam untuk buku alamat, status reservasi, tagihan, retensi staf, adequate location, dan guard shareloc. Namun ada beberapa masalah semantik yang berpotensi menyesatkan pemanggil: `ACTIVE_RESERVATION_STATUSES` mencampur "status yang menempati slot" dengan "masih aktif dalam 2 jam", sehingga pemanggil yang memakai konstanta langsung bisa menganggap `pending`/`hold` lama sebagai aktif. `customer-address.ts` adalah God module 620 baris yang menangani skema, dedup, primary, tombstone, rekonsiliasi, label, Haversine, dan Levenshtein. `location-adequacy` menerima `staffVerified` tanpa koordinat verifikasi (fail-open), dan `dispatch-visit-context` menghitung shareloc tanpa memfilter arah pesan. Sebagian logika generik (Haversine, Levenshtein, normalisasi) juga diduplikasi dari `utils`.

**Skor kesehatan: 3.5 / 5 (baik; fungsi murni dan teruji, tetapi ada footgun semantik dan satu God module).**

Alasan skor:
- **+** Semua fungsi murni, zero I/O, deterministik; 10/10 file punya test.
- **+** `payment-expected`, `reservation-payment`, `shareloc-solicitation`, `staff-retention` kecil dan jelas kontraknya.
- **+** `location-adequacy` sudah menjadi sumber kebenaran tunggal untuk badge lokasi.
- **−** `ACTIVE_RESERVATION_STATUSES` vs `isActiveReservation` punya semantik berbeda; pemanggil langsung bisa salah.
- **−** `customer-address.ts` 620 baris, banyak aturan dedup dengan ambang dan substring matching.
- **−** `location-adequacy` fail-open saat `staffVerified` tanpa koordinat.
- **−** `dispatch-visit-context` tidak memfilter arah pesan untuk shareloc.
- **−** Duplikasi Haversine/Levenshtein/normalisasi dari `utils`.

---

## B. TABEL TEMUAN

**Severity:** Kritis / Tinggi / Sedang / Rendah.
**Status:** TERVERIFIKASI = dibaca/dilacak langsung; HIPOTESIS = perlu uji data/DB.

| ID | Severity | file:baris | Masalah | Dampak | Prinsip/standar yang dilanggar | Rekomendasi spesifik + cost-benefit | Effort | Keyakinan | Status |
|---|---|---|---|---|---|---|---|---|---|
| **DOM-01** | **Sedang** | `reservation-status.ts:11-27`, `96-106`; `copilot-tools.ts:728-730` | `ACTIVE_RESERVATION_STATUSES` berisi `confirmed/en_route/pending/hold` tanpa jendela waktu. `isActiveReservation()` menambahkan jendela 2 jam untuk `pending`/`hold`. Pemanggil yang memakai konstanta langsung (mis. `copilot-tools` `includes(r.status)`) menganggap `pending`/`hold` lama tetap aktif. `isActiveReservationStatus()` (status-only) tidak punya pemanggil. | Prospek dengan hold/pending lama tidak pernah dianggap prospek; dashboard bisa menampilkan reservasi kedaluwarsa sebagai aktif. Dua fungsi dengan nama mirip memberi hasil berbeda. | Single source of truth, semantic clarity, correctness | Pisahkan nama: `OCCUPYING_STATUSES` (status set) dan `isActiveReservation`/`activeReservationWhere` (time-aware). Ganti pemakaian langsung konstanta dengan query/helper time-aware; hapus/beri nama eksplisit untuk fungsi status-only. **Cost:** S–M. **Benefit:** tidak ada lagi salah tafsir "aktif". | S–M | H | TERVERIFIKASI (dilacak ke pemanggil) |
| **DOM-02** | **Sedang** | `customer-address.ts:1-620` | Satu file menangani: skema Zod, normalisasi label, dedup (`addressesMatch`), primary (`ensureSinglePrimary`), upsert/FIFO, tombstone, rekonsiliasi, Haversine, Levenshtein, dan key alamat. | Perubahan kecil menyentuh file besar; sulit dites per tanggung jawab; risiko regresi tinggi. | Single Responsibility, modularity | Pecah menjadi `address-schema`, `address-dedup`, `address-primary`, `address-upsert`, `address-tombstones`, `address-reconcile`; re-export agar impor lama tetap. **Cost:** L. **Benefit:** modul kecil yang bisa diuji dan diubah terisolasi. | L | H | TERVERIFIKASI |
| **DOM-03** | **Sedang** | `customer-address.ts:145-232` | `addressesMatch` punya banyak cabang dengan ambang (150 m, 3 km, Levenshtein ≤2, house-number regex) dan `isWilayahSimilar` memakai substring `includes` (bisa menganggap "manunggal" bagian dari "sukomanunggal"). | Risiko over-merge (dua rumah dianggap satu) atau under-merge (satu rumah jadi dua); sulit diprediksi tanpa test matrix. | Determinism, correctness, predictability | Buat tabel keputusan eksplisit + property-based test untuk pasangan alamat; gunakan `wilayahTokenMatch` untuk token, bukan substring, kecuali kasus child-name yang terdokumentasi. **Cost:** M. **Benefit:** dedup dapat diprediksi dan diuji. | M | M–H | TERVERIFIKASI (logika), HIPOTESIS (dampak data) |
| **DOM-04** | **Sedang** | `customer-address.ts:83-119`; `location-adequacy.ts:110-126` | `haversineMeters`/`distanceMeters` menduplikasi `utils/haversine.ts` dan `utils/gazetteer.ts`; `levenshtein` menduplikasi semangat `utils/typo-match.ts`. | Empat implementasi jarak dengan pembulatan/rumus berbeda; hasil bisa tidak konsisten antar modul. | DRY, single source, numerical consistency | Sediakan satu `haversineMeters` di `utils/haversine.ts`; `customer-address` dan `location-adequacy` mengimpor. Gunakan satu util Levenshtein bersama. **Cost:** S. **Benefit:** satu perilaku jarak. | S | H | TERVERIFIKASI |
| **DOM-05** | **Sedang** | `location-adequacy.ts:170-180` | `staffVerified === true` + `candidates.includes('manual_staff')` dianggap adequate walaupun `staffVerifiedCoords` null; `samePlace` default true. | Verifikasi staf lama/stale dapat menutupi titik rumah baru; badge "tidak butuh shareloc" salah. | Fail-closed, evidence-based decision | Wajibkan `staffVerifiedCoords` valid untuk reason `staff_verified`, atau tambahkan flag eksplisit `staffVerifiedTrusted`. Tanpa koordinat → jatuh ke estimasi/unknown. **Cost:** S. **Benefit:** bukti lokasi benar-benar diverifikasi. | S | H | TERVERIFIKASI |
| **DOM-06** | **Sedang** | `dispatch-visit-context.ts:35-39` | `hasFreshSharelocToday` tidak memfilter `direction`/`sender_type`; pesan OUTBOUND yang mengandung `[LOCATION: Lat ...]` atau objek `location` dihitung sebagai shareloc customer. Bandingkan `hasFreshDispatchMediaToday` yang mensyaratkan OUTBOUND + `dispatchOrigin`/`isFieldStaff`. | Peringatan "kunjungan belum terdaftar" bisa muncul karena shareloc yang dikirim bot/staf, bukan customer. | Correctness, evidence quality | Filter `direction === 'INBOUND'` atau `sender_type === 'CUSTOMER'` untuk shareloc; atau gunakan flag `dispatchOrigin` yang sama. **Cost:** S. **Benefit:** peringatan hanya berdasarkan bukti customer. | S | H | TERVERIFIKASI |
| **DOM-07** | **Rendah** | `address-reconciliation.ts:67-99` | `buildReconciliationPlan` mencocokkan baris tabel vs JSON **hanya via `id`**. Jika rumah yang sama punya ID berbeda di tabel dan JSON, baris tabel akan diadopsi/dihapus sebagai entitas terpisah. | Duplikasi kartu alamat saat script rekonsiliasi dijalankan. Hanya script, bukan runtime. | Data integrity, identity matching | Sebelum adopsi/hapus, cek `addressesMatch`/`buildAddressKey` terhadap JSON; jika cocok, perlakukan sebagai entri yang sama. **Cost:** S–M. **Benefit:** rekonsiliasi tidak membuat kartu ganda. | S–M | H | TERVERIFIKASI |
| **DOM-08** | **Rendah** | `address-healing.ts:36-58` | `pickHealingWinner` mengembalikan `winner`/`victim` tanpa membawa koordinat GPS. Invarian "koordinat pemenang WAJIB dari kartu GPS" hanya dijaga oleh caller (`heal-shareloc-split-cards.ts:188`). | Caller baru bisa menghapus kartu GPS tanpa menyalin koordinatnya; data presisi hilang. | Contract completeness, invariants | Kembalikan `gpsCoords`/`mergePatch` di hasil, atau jadikan fungsi `buildHealingMerge()` yang menghasilkan patch final. **Cost:** S. **Benefit:** invarian dijaga oleh domain, bukan caller. | S | H | TERVERIFIKASI |
| **DOM-09** | **Rendah** | `customer-address.ts:30-50`, `338-347` | `SavedCustomerAddressSchema` mewajibkan `createdAt` dan `lastUsedAt` string. `parseSavedAddresses` membuang entri yang gagal `safeParse`; kartu lama yang belum punya field tersebut akan hilang dari daftar. | Data alamat legacy bisa “menghilang” dari tampilan setelah deploy. | Backward compatibility, data integrity | Beri default (`createdAt`/`lastUsedAt` = epoch/now) atau migrasi data lama. **Cost:** S. **Benefit:** kartu lama tetap terbaca. | S | M | HIPOTESIS (tergantung data produksi) |
| **DOM-10** | **Rendah** | `customer-address.ts:580-593` | `pruneAddressTombstones` memakai `slice(-MAX_ADDRESS_TOMBSTONES)` tanpa sort; jika daftar tidak terurut, yang dibuang bisa tombstone terbaru. | Tombstone lama menang, alamat yang sengaja dihapus bisa muncul kembali. | Determinism, ordering | Sort `deletedAt` desc lalu slice, atau simpan urutan terurut saat menulis. **Cost:** S. **Benefit:** retensi tombstone benar. | S | H | TERVERIFIKASI |
| **DOM-11** | **Rendah** | `reservation-status.ts:96-106` vs `24-27` | `isActiveReservation` membandingkan status case-sensitive (`=== 'confirmed'`), sedangkan `isActiveReservationStatus` memakai lowercase. | Status dengan kapitalisasi berbeda dianggap tidak aktif. | Consistency, robustness | Normalisasi `String(status).toLowerCase()` sebelum perbandingan. **Cost:** S. **Benefit:** konsisten dengan helper lain. | S | H | TERVERIFIKASI |
| **DOM-12** | **Rendah** | `reservation-status.ts:78-88` | `activeReservationWhere` menulis ulang daftar status (`scheduledStatuses = ['confirmed','en_route','pending']`) dan aturan window, bukan diturunkan dari konstanta/helper. | Jika status baru ditambahkan, query dan predicate bisa drift. | DRY, parity | Turunkan dari konstanta atau tambah test paritas `activeReservationWhere` vs `isActiveReservation` untuk sample tanggal. **Cost:** S. **Benefit:** query dan predicate selalu sinkron. | S | H | TERVERIFIKASI |
| **DOM-13** | **Rendah** | `reservation-payment.ts:22-29` | `getPaymentDisplayStatus` hanya menganggap `status === 'completed'` (case-sensitive) sebagai selesai; nilai `COMPLETED`/`Completed` jatuh ke `TAGIH_DI_TEMPAT`. | Label finansial salah untuk status non-lowercase. | Robustness, consistency | Normalisasi lowercase. **Cost:** S. **Benefit:** label benar. | S | H | TERVERIFIKASI |
| **DOM-14** | **Rendah** | `staff-retention.ts:303-389` | `calculateRetention` memiliki cabang `cohortN === 0` yang tidak mungkin tercapai (staffMap hanya berisi member). `isRetained` menghitung retensi customer tanpa membedakan staf, sementara modul dinamai retensi bidan; `sameStaffVisits`/`otherStaffVisits` tidak dipakai untuk keputusan. | Nama modul bisa menyesatkan; metrik “retensi bidan” sebenarnya retensi customer yang diatribusikan ke bidan asal. | Semantic clarity, dead code | Hapus cabang mati; dokumentasikan bahwa metrik = customer retention by origin staff; jika yang dimaksud retensi bidan, gunakan `sameStaffVisits`. **Cost:** S. **Benefit:** metrik tidak disalahartikan. | S | M | TERVERIFIKASI (logika) |
| **DOM-15** | **Rendah** | `address-healing.ts:44-57` | Jika GPS card tidak bertext dan ada beberapa kartu lama bertext, pemenang = `manual_staff` pertama atau `olderCandidates[0]`; tidak ada tie-break `lastUsedAt`/primary. | Merge bisa memilih kartu lama yang salah. Hanya script. | Determinism, correctness | Tambah tie-break deterministik (`is_primary`, `lastUsedAt`, `created_at`). **Cost:** S. **Benefit:** hasil healing stabil. | S | H | TERVERIFIKASI |

---

## C. BEFORE / AFTER KODE

### C-1. Pisahkan “status menempati slot” dari “masih aktif”

**Before** (`reservation-status.ts:11-27`):
```ts
export const ACTIVE_RESERVATION_STATUSES = ['confirmed', 'en_route', 'pending', 'hold'];

export function isActiveReservationStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return ACTIVE_RESERVATION_STATUSES.includes(String(status).trim().toLowerCase());
}
```

**After**:
```ts
/** Status yang secara historis menempati slot; TIDAK berarti masih aktif sekarang. */
export const OCCUPYING_STATUSES = ['confirmed', 'en_route', 'pending', 'hold'] as const;

/** Time-aware: status + jendela 2 jam. Ini yang dipakai untuk “aktif”. */
export function isActiveReservation(
  r: { status?: string | null; booking_date?: Date | string | null } | null | undefined,
  nowMs: number = Date.now()
): boolean { /* existing implementation */ }

/** Query time-aware; turunkan dari OCCUPYING_STATUSES + window. */
export function activeReservationWhere(nowMs: number = Date.now()): { OR: any[] } { /* existing */ }
```
**Call site:** `copilot-tools.ts:728-730` harus memakai `isActiveReservation(r)` (atau query `activeReservationWhere`), bukan `OCCUPYING_STATUSES.includes(r.status)`.

---

### C-2. `location-adequacy` — jangan fail-open tanpa koordinat verifikasi

**Before** (`location-adequacy.ts:170-180`):
```ts
if (input.staffVerified && coordsOk && candidates.includes('manual_staff')) {
  const verifiedCoords = input.staffVerifiedCoords || null;
  const samePlace =
    !verifiedCoords || !hasValidCoords(verifiedCoords)
      ? true
      : distanceMeters(verifiedCoords, coords) <= SAME_PLACE_TOLERANCE_M;
  if (samePlace) return { source: 'manual_staff', isAdequate: true, needsShareloc: false, reason: 'staff_verified' };
}
```

**After**:
```ts
if (input.staffVerified && coordsOk && candidates.includes('manual_staff')) {
  const verifiedCoords = input.staffVerifiedCoords || null;
  if (hasValidCoords(verifiedCoords) &&
      distanceMeters(verifiedCoords, coords) <= SAME_PLACE_TOLERANCE_M) {
    return { source: 'manual_staff', isAdequate: true, needsShareloc: false, reason: 'staff_verified' };
  }
  // Tanpa koordinat verifikasi → jangan klaim staff_verified; lanjut ke bukti lapangan/estimasi.
}
```

---

### C-3. `dispatch-visit-context` — shareloc hanya dari customer

**Before** (`dispatch-visit-context.ts:35-39`):
```ts
export function hasFreshSharelocToday(msgs: VisitMessageLike[], s: Date, e: Date): boolean {
  return (msgs || []).some(
    (m) => isWithinWibDay(m.created_at, s, e) && Boolean((m as any).location || (m.content && LOCATION_TAG_RE.test(m.content)))
  );
}
```

**After**:
```ts
export function hasFreshSharelocToday(msgs: VisitMessageLike[], s: Date, e: Date): boolean {
  return (msgs || []).some((m) => {
    if (!isWithinWibDay(m.created_at, s, e)) return false;
    const direction = String(m.direction || '').toUpperCase();
    const sender = String(m.sender_type || '').toUpperCase();
    const fromCustomer = direction === 'INBOUND' || sender === 'CUSTOMER';
    if (!fromCustomer) return false;
    return Boolean((m as any).location || (m.content && LOCATION_TAG_RE.test(m.content)));
  });
}
```

---

### C-4. `customer-address` — reuse Haversine, jangan duplikasi

**Before** (`customer-address.ts:82-93`):
```ts
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  // ...
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
```

**After** (`utils/haversine.ts` ditambah fungsi meter):
```ts
// utils/haversine.ts
export function calculateHaversineMeters(a: Coordinates, b: Coordinates): number {
  return calculateHaversineDistance(a, b) * 1000;
}

// customer-address.ts
import { calculateHaversineMeters as haversineMeters } from '../utils/haversine';
```
**Catatan:** `calculateHaversineDistance` membulatkan ke 2 desimal km (10 m); untuk toleransi 150 m, sebaiknya tambahkan versi meter tanpa pembulatan atau pakai `atan2` langsung.

---

### C-5. `parseSavedAddresses` — default timestamp agar kartu legacy tidak hilang

**Before** (`customer-address.ts:30-50`, `338-347`):
```ts
createdAt: z.string(),
lastUsedAt: z.string(),
// ...
const parsed = SavedCustomerAddressSchema.safeParse(item);
if (parsed.success) out.push(parsed.data);
```

**After**:
```ts
createdAt: z.string().default(() => new Date(0).toISOString()),
lastUsedAt: z.string().default(() => new Date(0).toISOString()),
// ...
const parsed = SavedCustomerAddressSchema.safeParse(item);
if (parsed.success) out.push(parsed.data);
```
Atau lakukan migrasi satu kali untuk mengisi timestamp yang hilang.

---

## D. KATALOG REUSE

| Nama | Lokasi | Fungsi | Pemakai utama |
|---|---|---|---|
| `pickHealingWinner` / `HealingCard` / `HealingWinner` | `address-healing.ts:19-58` | Pilih pemenang/korban merge kartu GPS vs kartu lama | Script `heal-shareloc-split-cards` |
| `tableRowToSaved` / `buildReconciliationPlan` | `address-reconciliation.ts:46-100` | Rencana rekonsiliasi JSON vs tabel alamat | Script `reconcile-customer-addresses` |
| `MAX_SAVED_ADDRESSES` / `MAX_ADDRESS_LABEL_LENGTH` / `SavedCustomerAddressSchema` / `SavedCustomerAddress` | `customer-address.ts:18-52` | Kontrak & batas buku alamat | Customer service, admin, script |
| `normalizeAddressLabel` / `buildAutoLabel` | `customer-address.ts:24-28`, `350-362` | Label kartu unik | Customer service |
| `wilayahTokenMatch` / `addressesMatch` / `isRegionCompatible` | `customer-address.ts:136-271` | Dedup & kompatibilitas wilayah | Customer service, enrichment, test |
| `selectEnrichmentTarget` | `customer-address.ts:278-323` | Pilih kartu yang boleh diperkaya pin GPS | `customer.service` |
| `normalizeAddressText` / `buildAddressKey` | `customer-address.ts:330-335`, `422-439` | Normalisasi & key identitas alamat | Customer service, admin |
| `parseSavedAddresses` / `ensureSinglePrimary` / `reconcileAddressLists` / `resolveActiveAddress` | `customer-address.ts:338-419` | Baca, primary tunggal, rekonsiliasi, alamat aktif | `customer.service`, admin |
| `removeAddressFromList` / `upsertAddressIntoList` / `UpsertResult` | `customer-address.ts:448-549` | Mutasi daftar alamat murni | `customer.service` |
| `AddressTombstoneSchema` / `parseAddressTombstones` / `pruneAddressTombstones` / `matchesTombstone` / `removeMatchingTombstones` | `customer-address.ts:553-619` | Tombstone alamat yang dihapus | `customer.service` |
| `VisitMessageLike` / `VisitFieldState` / `LOCATION_TAG_RE` / `isWithinWibDay` / `hasFreshSharelocToday` / `hasFreshDispatchMediaToday` / `shouldWarnUnregisteredVisit` | `dispatch-visit-context.ts:9-62` | Deteksi kunjungan lapangan tanpa reservasi | Live chat/alert |
| `LocationSourceKind` / `LocationAdequacyReason` / `hasValidCoords` / `distanceMeters` / `extractStaffVerifiedCoords` / `resolveLocationAdequacy` / `resolveEffectiveLocationSource` | `location-adequacy.ts:27-200` | Keputusan lokasi cukup / butuh shareloc | Backend + mirror frontend |
| `PaymentStatus` / `ExpectedPayment` / `resolveExpectedPayment` | `payment-expected.ts:11-80` | Tagihan & evaluasi pembayaran | Customer payment proof, admin |
| `isReservationPaid` / `PaymentDisplayStatus` / `getPaymentDisplayStatus` / `getPaymentDisplayLabel` | `reservation-payment.ts:6-40` | Status finansial tampilan | Admin ledger/notifikasi |
| `PAUSED_STATUS` / `ACTIVE_RESERVATION_STATUSES` / `ACTIVE_HOLD_WINDOW_MS` / `isActiveReservationStatus` / `CONFIRMED_FAMILY_STATUSES` / `activeHoldCutoff` / `activeTreatmentCutoff` / `isTreatmentWithinActiveWindow` / `activeReservationWhere` / `isActiveReservation` / `isHoldActive` / `isHoldActiveByCreated` / `SLOT_BUFFER_MIN` / `canTransition` / `isPrematureCompletion` | `reservation-status.ts:1-164` | Kontrak status & transisi reservasi | Conversation, live chat, copilot, follow-up, reservation core |
| `hasShareLocationSolicitation` / `detectSharelocSolicitation` | `shareloc-solicitation.ts:27-56` | Guard output/template shareloc | Guardrail pipeline, template lint |
| `dateToEpochDays` / `epochDaysToDate` / `addDays` / `subtractMonths` / `buildVisits` / `resolveCustomerOwnerships` / `selectCohort` / `calculateRetention` / `resolveFinalTier` / `applySoftLanding` | `staff-retention.ts:74-431` | Kalkulator retensi & insentif bidan | Staff retention service/admin |

---

## E. LOGIKA YANG DITULIS SENDIRI (BERPOTENSI DUPLIKAT)

| Logika generik | Lokasi di modul ini | Duplikat/kandidat di tempat lain | Catatan |
|---|---|---|---|
| Haversine meter | `customer-address.ts:83-93`; `location-adequacy.ts:110-126` | `utils/haversine.ts`; `utils/gazetteer.ts:588-598` | Empat implementasi; pembulatan berbeda. |
| Levenshtein | `customer-address.ts:103-119` | `utils/typo-match.ts:7-19` (≤1) | Domain butuh ≤2; bisa pakai satu util umum. |
| Normalisasi teks/wilayah | `customer-address.ts:71-76`, `136-155` | `utils/similarity.ts:38-49` (`normalizeForMatch`), `utils/wilayah-normalizer.ts` | Tiga normalizer dengan aturan berbeda. |
| Status aktif reservasi | `reservation-status.ts:11-27`, `78-117` | Query di `copilot-tools.ts`, `customer.service.ts`, `reservation-core.service.ts` | Konstanta status vs predicate time-aware. |
| Rumus tagihan | `payment-expected.ts:45-80` | `packages/admin-dashboard/src/utils/paymentProof.ts` (mirror), `money-contract.ts` | Domain sudah menjadi otoritas; pastikan frontend memakai hasil yang sama. |
| Retensi/atribusi staf | `staff-retention.ts:109-388` | `services/staff-retention.service.ts` (query/persistensi) | Domain murni; service harus tidak menghitung ulang rumus. |
| Adequacy lokasi | `location-adequacy.ts:152-200` | Mirror frontend (disebut di komentar) | Parity harus dijaga test. |
| Guard shareloc | `shareloc-solicitation.ts:27-51` | `v3/agent/pipeline/guardrail-pipeline.ts` | Domain adalah pola kanonis; guardrail memakainya. |
| Deteksi kunjungan lapangan | `dispatch-visit-context.ts:35-61` | `services/live-chat.service.ts` / alert | Pastikan tidak ada cek duplikat di service. |
| WIB date key | `staff-retention.ts` memakai `utils/wib-time` | `utils/time-wib.ts`, `followup-templates.ts` | Sudah reuse; baik. |

---

## F. FILE DI MODUL INI YANG BELUM DIBACA

**Tidak ada.** Seluruh 10 file `.ts` di `src/domain` sudah dibaca penuh.

**Dependensi luar modul yang dibaca sebagian (bukan klaim audit penuh):**
`src/services/copilot/copilot-tools.ts`, `src/services/reservation-core.service.ts`, `src/services/customer.service.ts`, `src/services/reservation-address-sync.service.ts`, `src/services/live-chat.service.ts`, `src/scripts/heal-shareloc-split-cards.ts`, `src/scripts/reconcile-customer-addresses.ts`, dan test domain terkait.

---

## G. PENYIMPANAN HASIL

Laporan ini disimpan di:

`docs/MODULE_AUDIT_04_DOMAIN.md`

Tidak ada file source yang diubah selama audit.

---

## LAMPIRAN 1 — TEST COVERAGE

| Domain | Test khusus |
|---|---|
| `address-healing` | `tests/unit/address-healing-winner.test.ts` |
| `address-reconciliation` | `tests/unit/address-reconciliation.test.ts` |
| `customer-address` | 12 file (address-book, toponimi, rumah-kedua, enrichment, dashboard parity, dll.) |
| `dispatch-visit-context` | `tests/unit/dispatch-visit-context.test.ts` |
| `location-adequacy` | `tests/unit/location-adequacy.test.ts` |
| `payment-expected` | `tests/unit/payment-expected.test.ts` |
| `reservation-payment` | 3 file (payment display, overhaul P0, CAPI queue) |
| `reservation-status` | 6 file (canonical, en-route, hold sweep, conversation filter, dll.) |
| `shareloc-solicitation` | 2 file (unit + audit V3) |
| `staff-retention` | 2 file (ownership + calculator) |

**Tidak ada domain tanpa test.** Kualitas test bervariasi; `customer-address` paling banyak diuji, tetapi belum ada property-based test untuk `addressesMatch`.

---

## LAMPIRAN 2 — REKOMENDASI URUTAN PERBAIKAN (TANPA EKSEKUSI)

| Urutan | Temuan | Alasan | Gate regresi |
|---:|---|---|---|
| 1 | DOM-01, DOM-05 | Semantik “aktif” dan “staff verified” bisa menyesatkan keputusan operasional | Test time-window + test staffVerified tanpa coords |
| 2 | DOM-06 | Peringatan kunjungan palsu | Test shareloc OUTBOUND tidak dihitung |
| 3 | DOM-03, DOM-04 | Dedup alamat & duplikasi jarak | Test matrix alamat + full suite |
| 4 | DOM-02 | God module `customer-address` | Pecah bertahap + re-export |
| 5 | DOM-07–DOM-15 | Kebersihan & script healing | Full suite + script dry-run |

**Catatan:** rekomendasi di atas belum dieksekusi. Sesuai instruksi, audit berhenti di sini dan menunggu perintah modul berikutnya.
