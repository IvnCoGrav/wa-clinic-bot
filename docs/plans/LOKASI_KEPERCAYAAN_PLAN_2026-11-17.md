# PLAN — Perbaikan Fondasional Kepercayaan Lokasi (v2.2)

- **Tanggal:** 2026-11-17
- **Basis:** Audit A-001 s.d. A-018 (audit baca-saja atas perubahan uncommitted Plan v2.1)
- **Status:** **BELUM DIEKSEKUSI** — menunggu persetujuan manusia eksplisit
- **Sifat:** staged micro-task, dependency-ordered, blast-radius-ordered
- **Larangan selama plan ini:** tulis DB produksi, deploy, ubah `.env`, sentuh label WAHA, tambah dependency runtime

---

## 0. Keputusan yang sudah dikunci (jangan diubah)

| # | Keputusan | Konsekuensi teknis |
|---|---|---|
| D1 | **6.3 = YA**: titik `field_verified` (foto rumah + GPS valid, rumah sama) boleh lolos modal navigasi | `needsNavigationPreflight` tetap mengembalikan `false` untuk `isFieldVerified === true`, **tetapi** `isFieldVerified` harus berasal dari bukti lapangan nyata (F5) |
| D2 | **Quick Reply `kelurahan` TETAP meminta shareloc** (keputusan bisnis) | Dilarang menghapus ajakan shareloc; hanya ejaan yang diperbaiki |
| D3 | Tidak ada data produksi yang ditulis tanpa persetujuan terpisah + `pg_dump` | F8/F9 berdiri sendiri |
| D4 | Hierarki presisi: pin > GPS lapangan ≤50 m > DB > geocoding | Label presisi **hanya** dari entitas pemilik koordinat (F0) |
| D5 | Hierarki kepercayaan: foto+GPS+kunjungan > pin customer terkonfirmasi > pin chat mentah > estimasi | Pin **bidan** ≠ konfirmasi customer (F3) |

## 0.1 Non-goals

- Bukan refactor total `staff-reservation.service.ts` / `customer.service.ts` (keduanya masih >2.800 baris; hanya dipindah bagian yang menghambat gate).
- Bukan perubahan perilaku LLM/prompt bisnis.
- Bukan penyatuan seluruh label UI dashboard (hanya berhenti menulis label permanen + 2 titik baca).

## 0.2 Peta temuan → fase

| Temuan | Fase |
|---|---|
| A-002 (label `gps_pin` pada koordinat non-pin), A-014 (tipe `any`) | **F0** |
| A-016 (koordinat tanpa label dipaksa `estimated_area`) | **F0** |
| A-010 (siklus import), A-017 (file >1500 bertambah panjang) | **F1** |
| A-018 (register bukti S-08 basi), kontrak tes `waha-webhook` | **F2** |
| A-001 (pin bidan = konfirmasi customer) | **F3** |
| A-004 (skrip healing no-op), A-011 (tenant default) | **F4** |
| A-006 (3 definisi field-verified), A-007 (verifikasi palsu), A-005 (label permanen) | **F5** |
| A-003 (`needs_move_confirmation` mati), A-015 (`last_used_at`), A-008 (alamat pin menimpa) | **F6** |
| A-009 (import mati), A-013 (dokumen drift) | **F7** |
| Data healing (Ririn + sejenis) | **F8** |
| Deploy | **F9** |

### Koreksi audit (wajib dicatat agar plan tidak salah sasaran)

- **A-009 turun menjadi Rendah.** `StaffUpcomingCard` memakai `onNavigate` yang diteruskan ke `requestNavigation` di `StaffToday.tsx:1412-1425` — gerbang **sudah** berlaku untuk semua kartu. Masalahnya hanya import mati + gaya tombol. **Tidak ada lubang keselamatan.**
- **A-001 masih laten.** Di produksi: 0 pelanggan dengan sumber terakhir `bidan_shareloc`. Namun 39 pelanggan `share_location_sent=true` dengan sumber terakhir `manual_staff` dan 34 `FIELD_STAFF_GPS` → flag sudah tercemar tulisan staf.
- **A-016 blast radius produksi kecil hari ini** (743 pelanggan `location_source` NULL, **0** berkoordinat; 4 kartu NULL, **0** berkoordinat), tetapi kontraknya rusak dan merusak tes `staff-auth-and-reservation`.

---

## 1. Prasyarat & kondisi awal

1. Working tree berisi 16 file modified + 4 untracked (Plan v2.1) — **semua belum di-commit**.
2. Baseline gate saat plan dibuat:

| Gate | Status awal |
|---|---|
| `npm run typecheck` | LULUS |
| `npm run build` (backend) | LULUS |
| `npm run build` (dashboard) | LULUS |
| `npm test` | **GAGAL**: 6 file / 9 tes |
| `node scripts/reuse/check-reuse.mjs --warn --json` | **GAGAL**: 1 (`webhook.route.ts` 1624→1632) |
| `node scripts/reuse/check-architecture.mjs --warn --json` | **GAGAL**: 1 (`NO_NEW_CYCLE`, 36 file) |

3. Kegagalan yang **bukan** milik perubahan ini: `tests/unit/hybrid-reservation-parser.test.ts` (2 tes) — file sumber & tes tidak tersentuh, tercatat pre-existing di `docs/KNOWN_ISSUES.md:913`. Wajib dibuktikan ulang dengan revert-and-rerun saat penutupan plan.

## 1.1 Perintah gate standar (dipakai di akhir setiap fase)

```powershell
npm run typecheck
npm run build
node scripts/reuse/check-architecture.mjs --warn --json
node scripts/reuse/check-reuse.mjs --warn --json
```

Kriteria lulus universal (semua fase):
- `typecheck` exit 0
- `build` exit 0
- `check-architecture` → `summary.newViolations === 0`
- `check-reuse` → `summary.newViolations === 0`

---

# FASE 0 — Presisi hanya dari pemilik koordinat (A-002, A-014, A-016)

**Blast radius:** tinggi (menentukan label presisi + gerbang navigasi + URL Maps).
**Dependency:** tidak ada. Harus pertama.

## T0.1 — Tulis tes merah dulu

**File:** `tests/unit/staff-task-location-precedence.test.ts` (append setelah baris 114, sebelum `});` penutup `describe`)

```ts
  it('A-016: koordinat ada tapi label tidak diketahui → TETAP null (bukan estimated_area)', () => {
    const cust = { lat: -7.2575, lng: 112.7521 }; // tanpa location_source, tanpa prefs
    const res = resolveTaskLocationPrecedence({ effectiveAddr: cust, customer: cust });
    expect(res.locationSource).toBeNull();
  });

  it('A-002: kartu berlabel gps_pin TANPA koordinat tidak boleh memberi label pin', () => {
    const cust = {
      lat: -7.31,
      lng: 112.72,
      location_source: 'estimated_area',
    };
    const effectiveAddr = { lat: null, lng: null, location_source: 'gps_pin' };
    const res = resolveTaskLocationPrecedence({ effectiveAddr, customer: cust });
    expect(res.locationSource).toBe('estimated_area');
  });

  it('A-002: pin customer yang menang HANYA bila titiknya sama (≤150 m)', () => {
    const cust = { lat: -7.291799, lng: 112.800239, location_source: 'gps_pin' };
    const addrJauh = { lat: -7.32, lng: 112.8, location_source: 'manual_staff' };
    const res = resolveTaskLocationPrecedence({ effectiveAddr: addrJauh, customer: cust });
    expect(res.locationSource).toBe('manual_staff');
  });

  it('A-001 (guard baca): share_location_sent TIDAK boleh menang bila ada penanda staf', () => {
    const cust = {
      lat: -7.29,
      lng: 112.8,
      share_location_sent: true,
      preferences: { location_updated_by_staff_name: 'Audit Salvage Auto-Backfill' },
    };
    const res = resolveTaskLocationPrecedence({
      effectiveAddr: { lat: -7.29, lng: 112.8 },
      customer: cust,
    });
    expect(res.locationSource).toBeNull();
  });

  it('A-001 (guard baca): share_location_sent legacy tetap gps_pin bila tanpa kontradiksi', () => {
    const cust = { lat: -7.29, lng: 112.8, share_location_sent: true, preferences: {} };
    const res = resolveTaskLocationPrecedence({
      effectiveAddr: { lat: -7.29, lng: 112.8 },
      customer: cust,
    });
    expect(res.locationSource).toBe('gps_pin');
  });
```

**Perintah:**
```powershell
npx vitest run tests/unit/staff-task-location-precedence.test.ts
```
**Acceptance:** 5 tes baru **GAGAL** (merah) sebelum T0.2.

## T0.2 — Ganti blok `resolveTaskLocationPrecedence`

**File:** `src/domain/location-adequacy.ts`
**Lokasi:** sisipkan tipe tepat sebelum fungsi (baris 283), lalu **ganti seluruh isi** fungsi baris 283–358 (sampai `return {...}` penutup) dengan blok di bawah.

Tipe baru (sisipkan sebelum doc-comment fungsi):

```ts
export interface TaskLocationLike {
  lat?: number | null;
  lng?: number | null;
  location_source?: string | null;
  source?: string | null;
  address?: string | null;
  landmark?: string | null;
  housePhotoUrl?: string | null;
  house_photo_url?: string | null;
  preferences?: Record<string, any> | null;
  share_location_sent?: boolean | null;
  purchase_count?: number | null;
}

function toCoords(entity?: TaskLocationLike | null): Coordinates {
  return {
    lat: entity?.lat != null && entity.lat !== ('' as any) ? Number(entity.lat) : null,
    lng: entity?.lng != null && entity.lng !== ('' as any) ? Number(entity.lng) : null,
  };
}
```

Isi fungsi pengganti:

```ts
export function resolveTaskLocationPrecedence(params: {
  effectiveAddr?: TaskLocationLike | null;
  customer?: TaskLocationLike | null;
}): {
  locationSource: LocationSourceKind;
  isFieldVerified: boolean;
  housePhotoUrl: string | null;
  /** Entitas yang koordinatnya benar-benar dipakai kartu tugas. */
  coordOwner: 'addr' | 'customer' | null;
} {
  const { effectiveAddr, customer } = params;

  const housePhotoUrl: string | null =
    customer?.preferences?.house_photo_url ||
    effectiveAddr?.housePhotoUrl ||
    effectiveAddr?.house_photo_url ||
    null;

  const addrCoords = toCoords(effectiveAddr);
  const custCoords = toCoords(customer);
  const hasAddrCoords = hasValidCoords(addrCoords);
  const hasCustCoords = hasValidCoords(custCoords);

  // ATURAN D4: label presisi HANYA mengikuti entitas pemilik koordinat.
  // Tanpa koordinat → null (netral). DILARANG mempromosikan/menurunkan label
  // milik entitas yang titiknya tidak dipakai (insiden "nyasar" 2026-10-11).
  const coordOwner: 'addr' | 'customer' | null = hasAddrCoords
    ? 'addr'
    : hasCustCoords
      ? 'customer'
      : null;

  const ownerEntity = coordOwner === 'addr' ? effectiveAddr : coordOwner === 'customer' ? customer : null;
  const otherEntity = coordOwner === 'addr' ? customer : coordOwner === 'customer' ? effectiveAddr : null;

  const ownerSrc = resolveEffectiveLocationSource(ownerEntity ?? null);
  const otherSrc = resolveEffectiveLocationSource(otherEntity ?? null);

  const samePoint =
    hasAddrCoords && hasCustCoords
      ? distanceMeters(addrCoords, custCoords) <= SAME_PLACE_TOLERANCE_M
      : false;

  let locationSource: LocationSourceKind = null;

  if (coordOwner) {
    if (ownerSrc === 'gps_pin') {
      locationSource = 'gps_pin';
    } else if (otherSrc === 'gps_pin' && samePoint) {
      // Titik lain yang lebih presisi pada RUMAH YANG SAMA boleh menaikkan presisi.
      locationSource = 'gps_pin';
    } else if (ownerSrc === 'manual_staff') {
      locationSource = 'manual_staff';
    } else if (ownerSrc === 'estimated_area') {
      locationSource = 'estimated_area';
    } else if (
      // Legacy sah: data lama hanya punya flag share_location_sent (belum ada
      // kolom location_source) DAN tidak ada penanda campur tangan staf.
      coordOwner === 'customer' &&
      customer?.share_location_sent === true &&
      !resolveEffectiveLocationSource(customer) &&
      !customer?.preferences?.location_updated_by_staff_name &&
      !customer?.preferences?.location_updated_by_staff_id &&
      customer?.preferences?.field_gps_lat == null
    ) {
      locationSource = 'gps_pin';
    }
    // ownerSrc === null → tetap null (netral). BUKAN estimated_area (A-016).
  }

  const hasStaffVerification = Boolean(
    customer?.preferences?.location_updated_by_staff_name ||
    customer?.preferences?.location_updated_by_staff_id ||
    customer?.preferences?.location_accuracy_m != null ||
    customer?.preferences?.location_history?.some?.(
      (h: any) => h?.source === 'manual_staff' || h?.source === 'field_verified' || h?.raw_source === 'FIELD_STAFF_GPS'
    )
  );

  const isFieldVerified = Boolean(
    housePhotoUrl &&
    coordOwner !== null &&
    (samePoint || coordOwner === 'customer') &&
    locationSource !== 'estimated_area' &&
    (hasStaffVerification || ownerSrc === 'manual_staff' || Number(customer?.purchase_count || 0) > 0)
  );

  return { locationSource, isFieldVerified, housePhotoUrl, coordOwner };
}
```

**Catatan implementasi:** `isFieldVerified` di sini akan **diganti total** di F5 (`deriveFieldVerification`). Untuk F0 cukup jangan melemahkan gate.

## T0.3 — Verifikasi 3 situs kartu memakai kontrak baru

**File:** `src/services/staff-reservation.service.ts`
**Lokasi:** `:782`, `:1081`, `:1255` (cari `const locPrec = resolveTaskLocationPrecedence`)

Tidak perlu ubah logika; hanya pastikan `lat/lng` yang dipakai = milik `locPrec.coordOwner`:

```ts
        const locPrec = resolveTaskLocationPrecedence({ effectiveAddr, customer: cust });
        const locationSource = locPrec.locationSource;
        const housePhotoUrl = locPrec.housePhotoUrl;
        const isFieldVerified = locPrec.isFieldVerified;
        const ownerAddr = locPrec.coordOwner === 'addr';
        const lat = ownerAddr ? effectiveAddr?.lat : cust?.lat;
        const lng = ownerAddr ? effectiveAddr?.lng : cust?.lng;
```

**Acceptance T0.3:** `rg -n "coordOwner" src/services/staff-reservation.service.ts` → ≥3 hasil.

## T0.4 — Gate Fase 0

```powershell
npx vitest run tests/unit/staff-task-location-precedence.test.ts tests/unit/staff-auth-and-reservation.test.ts tests/unit/staff-task-effective-address.test.ts tests/unit/location-adequacy.test.ts tests/unit/navigation-accuracy-preflight.test.ts tests/unit/dashboard-geo-utils.test.ts
npm run typecheck
```

**Acceptance:**
- 5 tes baru T0.1 **hijau**
- `staff-auth-and-reservation` **hijau** (navigationUrl kembali berkoordinat)
- `typecheck` exit 0
- **Rollback:** `git checkout -- src/domain/location-adequacy.ts src/services/staff-reservation.service.ts tests/unit/staff-task-location-precedence.test.ts`

---

# FASE 1 — Putus siklus import & netralkan ukuran file (A-010, A-017)

**Blast radius:** sedang (murni pemindahan simbol; perilaku wajib byte-identik).
**Dependency:** F0 selesai (agar diff perilaku tidak bercampur).

## T1.1 — Buat modul domain sumber lokasi

**File baru:** `src/domain/location-source.ts`

```ts
/**
 * location-source.ts — seam kanonis pengetahuan "sumber lokasi".
 * Dipisah dari location-adequacy agar tidak ada siklus import dengan
 * staff-reservation.service.ts (gate NO_NEW_CYCLE).
 */
export type LocationSourceKind = 'gps_pin' | 'manual_staff' | 'estimated_area' | null;

const GPS_SOURCES = new Set(['gps_pin', 'bidan_shareloc', 'customer_shareloc', 'url_coords']);
const MANUAL_SOURCES = new Set(['manual_staff', 'field_staff_gps', 'field_verified']);
const ESTIMATED_SOURCES = new Set([
  'estimated_area',
  'db_coords',
  'geocoding',
  'url_text_geocoded',
  'gazetteer',
]);

export const STAFF_VERIFIED_LOCATION_LABEL = '📍 Terverifikasi Staf';
export const FIELD_VERIFIED_LOCATION_LABEL = '📍 Terverifikasi Lapangan';

export function normalizeRaw(raw?: string | null): LocationSourceKind {
  const s = (raw || '').trim().toLowerCase();
  if (!s) return null;
  if (GPS_SOURCES.has(s)) return 'gps_pin';
  if (MANUAL_SOURCES.has(s)) return 'manual_staff';
  if (ESTIMATED_SOURCES.has(s)) return 'estimated_area';
  return null;
}

export function resolveEffectiveLocationSource(
  input?: string | { source?: string | null; location_source?: string | null } | null
): LocationSourceKind {
  if (!input) return null;
  if (typeof input === 'string') return normalizeRaw(input);
  return normalizeRaw(input.source ?? input.location_source ?? null);
}

/** Dipindah apa adanya dari staff-reservation.service.ts (perilaku identik). */
export function resolveLocationSource(
  c: any
): 'gps_pin' | 'estimated_area' | 'manual_staff' | null {
  if (!c) return null;
  const col = c.location_source;
  if (col === 'gps_pin' || col === 'estimated_area' || col === 'manual_staff') return col;

  const pref = (c.preferences as any) || {};
  const src = pref.location_source || pref.source;
  if (src === 'bidan_shareloc' || src === 'customer_shareloc' || src === 'url_coords') return 'gps_pin';
  if (src === 'geocoding' || src === 'url_text_geocoded' || src === 'gazetteer') return 'estimated_area';
  if (src === 'manual_staff' || src === 'FIELD_STAFF_GPS') return 'manual_staff';

  if (pref.location_updated_by_staff_name || pref.location_updated_by_staff_id || pref.field_gps_lat) {
    return 'manual_staff';
  }
  if (c.share_location_sent === true && c.lat != null && c.lng != null) return 'gps_pin';
  return null;
}
```

## T1.2 — Buat modul utilitas durasi

**File baru:** `src/utils/travel-duration.ts`

```ts
/**
 * Estimasi durasi tempuh sepeda motor (menit).
 * Kalibrasi: ~2.05 menit/km + buffer lampu merah/gang 2 menit.
 */
export function estimateTravelDurationMinutes(distanceKm: number | null): number | null {
  if (distanceKm == null || distanceKm <= 0) return null;
  return Math.max(3, Math.round(distanceKm * 2.05 + 2));
}
```

## T1.3 — Bersihkan `staff-reservation.service.ts`

**File:** `src/services/staff-reservation.service.ts`

1. **Hapus** baris 380 (`export const STAFF_VERIFIED_LOCATION_LABEL = ...`).
2. **Hapus** blok fungsi `resolveLocationSource` (baris 393–411).
3. **Hapus** blok fungsi `estimateTravelDurationMinutes` (baris 413–420).
4. **Tambah** di blok import atas:

```ts
import { STAFF_VERIFIED_LOCATION_LABEL, resolveLocationSource, resolveEffectiveLocationSource } from '../domain/location-source';
import { estimateTravelDurationMinutes } from '../utils/travel-duration';
```

5. **Pertahankan** `export { ... }` sementara hanya bila masih ada pemanggil (lihat T1.4) — alias DEPRECATED wajib dihapus di fase yang sama setelah semua pemanggil dimigrasikan.

## T1.4 — Migrasikan seluruh pemanggil (wajib dalam PR yang sama)

| File | Baris | Aksi |
|---|---|---|
| `src/services/customer.service.ts` | 32 | `import { STAFF_VERIFIED_LOCATION_LABEL, resolveLocationSource } from '../domain/location-source';` |
| `src/services/customer-location-refresh.service.ts` | 6 | `import { STAFF_VERIFIED_LOCATION_LABEL } from '../domain/location-source';` |
| `src/services/staff-location.service.ts` | 5 | `import { STAFF_VERIFIED_LOCATION_LABEL } from '../domain/location-source';` + `import { estimateTravelDurationMinutes } from '../utils/travel-duration';` |
| `src/scripts/reconcile-trapped-customer-locations.ts` | 26 | arahkan ke `../domain/location-source` |
| `src/routes/admin/customers.subroute.ts` | 10 | arahkan ke `../../domain/location-source` |
| `tests/unit/staff-location-sync.test.ts` | 4 | arahkan ke `../../src/domain/location-source` |

**Acceptance T1.4:** `rg -n "from './staff-reservation.service'" src/services/staff-location.service.ts src/services/customer-location-refresh.service.ts` → **kosong**.

## T1.5 — Pindahkan penyusunan payload pin ke seam ingest

**File:** `src/services/location-ingest.service.ts` — tambah sebelum `export class LocationIngestService`:

```ts
/**
 * Satu-satunya penyusun `incomingMessage.location` untuk choke point GPS.
 * Dipakai webhook WAHA & WABA (anti duplikasi + menjaga route tetap ramping).
 */
export function buildPinIncomingMessage(loc: {
  latitude: number | string | null | undefined;
  longitude: number | string | null | undefined;
  address?: string | null;
  name?: string | null;
}): { type: 'location'; location: { latitude: number; longitude: number; address?: string; name?: string } } {
  const address = typeof loc.address === 'string' && loc.address.trim() ? loc.address.trim() : undefined;
  const name = typeof loc.name === 'string' && loc.name.trim() ? loc.name.trim() : undefined;
  return {
    type: 'location',
    location: {
      latitude: Number(loc.latitude),
      longitude: Number(loc.longitude),
      ...(address ? { address } : {}),
      ...(name ? { name } : {}),
    },
  };
}
```

**File:** `src/routes/webhook.route.ts` (baris 1046–1060) — ganti blok `incomingMessage: { ... }` menjadi **satu baris**:

```ts
            incomingMessage: buildPinIncomingMessage({
              latitude: rawLat, longitude: rawLng,
              address: canonical.location?.address, name: canonical.location?.name,
            }),
```
Tambahkan import dinamis bersama `locationIngestService`:
```ts
          const { locationIngestService, buildPinIncomingMessage } = await import('../services/location-ingest.service');
```

**File:** `src/routes/waba-webhook.route.ts` (baris 299–312) — pola sama dengan `msg.location.*`.

**Acceptance T1.5:**
```powershell
(Get-Content src/routes/webhook.route.ts).Count   # harus <= 1624
node scripts/reuse/check-reuse.mjs --warn --json  # newViolations = 0
node scripts/reuse/check-architecture.mjs --warn --json  # newViolations = 0
```

## T1.6 — Gate Fase 1

```powershell
npm run typecheck
npm run build
node scripts/reuse/check-architecture.mjs --warn --json
node scripts/reuse/check-reuse.mjs --warn --json
npx vitest run tests/unit/staff-location-sync.test.ts tests/unit/location-ingest.test.ts tests/unit/customer-location-refresh.test.ts tests/unit/reconcile-trapped-locations.test.ts tests/unit/architecture-gate.test.ts tests/unit/reuse-gate.test.ts
```
**Acceptance:** semua exit 0; `newViolations = 0` di kedua gate; jumlah baris `webhook.route.ts` ≤ 1624.
**Rollback:** hapus 2 file baru, `git checkout --` 8 file yang diubah.

---

# FASE 2 — Sinkronkan gerbang bukti & kontrak tes (A-018)

**Blast radius:** rendah (dokumen + tes).

## T2.1 — Perbaiki register bukti S-08

**File:** `docs/plans/REMAINING_BACKLOG_2026-11-09.md`, **baris 291**.
Ganti isi kolom bukti (bagian `` `src/services/staff-reservation.service.ts:2120,2180,2189` ``) menjadi:

```
src/services/staff-location.service.ts:105,117-121; src/services/staff-reservation.service.ts:699,997
```

Dan tambahkan di kolom bukti teks: `(dipindah dari staff-reservation.service.ts pada plan v2.2 Fase 1)`.

## T2.2 — Perbarui kontrak tes choke point WAHA

**File:** `tests/integration/waha-webhook.test.ts`, **baris 373–380**:

```ts
    expect(ingestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: DEFAULT_TENANT_ID,
        customer: expect.objectContaining({ id: customer.id }),
        incomingMessage: expect.objectContaining({
          type: 'location',
          location: expect.objectContaining({
            latitude: -7.3564516847907635,
            longitude: 112.78985794633627,
            address: 'Jl. Rungkut No. 1',
          }),
        }),
      })
    );
```

## T2.3 — Gate Fase 2

```powershell
node scripts/evidence/backlog-evidence-gate.mjs   # nama skrip: lihat tests/unit/backlog-evidence-gate.test.ts
npx vitest run tests/unit/backlog-evidence-gate.test.ts tests/integration/waha-webhook.test.ts
```
**Acceptance:** output gate berisi `PASS`; 2 file tes hijau.
**Rollback:** `git checkout -- docs/plans/REMAINING_BACKLOG_2026-11-09.md tests/integration/waha-webhook.test.ts`

---

# FASE 3 — Pisahkan pin customer vs pin bidan (A-001)

**Blast radius:** tinggi (mengubah arti state kepercayaan di 4 pembaca).

## T3.1 — Tulis tes merah

**File:** `tests/unit/customer-location-refresh.test.ts` (tambahkan kasus):

```ts
  it('A-001: pin dari BIDAN tidak boleh menandai customer sudah kirim shareloc', async () => {
    // ...fixture pesan OUTBOUND sender_type STAFF berisi payload location...
    const res = await customerService.refreshCustomerLocationAndOngkir('cust-bidan-pin', 'default-tenant');
    expect(res.success).toBe(true);
    expect(lastUpdateData.share_location_sent).toBe(false); // TIDAK dipromosikan
    expect(lastUpdateData.preferences.pin_from_staff_at).toBeTruthy();
    expect(lastUpdateData.preferences.pin_from_customer_at).toBeUndefined();
  });

  it('A-001: pin dari CUSTOMER (inbound) menandai konfirmasi customer', async () => {
    const res = await customerService.refreshCustomerLocationAndOngkir('cust-inbound-pin', 'default-tenant');
    expect(lastUpdateData.share_location_sent).toBe(true);
    expect(lastUpdateData.preferences.pin_from_customer_at).toBeTruthy();
  });
```

## T3.2 — Pisahkan flag di refresh service

**File:** `src/services/customer-location-refresh.service.ts`

Baris 252–253 (`isPinSourceChosen`) →:

```ts
    const isCustomerPin = chosen.source === 'customer_shareloc' || chosen.source === 'url_coords';
    const isStaffPin = chosen.source === 'bidan_shareloc';
    const isPinSourceChosen = isCustomerPin || isStaffPin; // tetap presisi (D4)
```

Baris 265 →:

```ts
          share_location_sent: isCustomerPin ? true : customer.share_location_sent,
```

Baris 282–292 (blok `preferences`) → tambahkan 2 field:

```ts
            ...(isCustomerPin ? { pin_from_customer_at: nowIso } : {}),
            ...(isStaffPin ? { pin_from_staff_at: nowIso } : {}),
```

Baris 323 (fallback memori) → `if (isCustomerPin) mem.share_location_sent = true;`

## T3.3 — Pembaca memakai flag baru

| File | Baris | Perubahan |
|---|---|---|
| `src/domain/location-adequacy.ts` | guard legacy F0 | tambahkan syarat `!customer?.preferences?.pin_from_staff_at` dan utamakan `pin_from_customer_at` |
| `src/services/live-chat.serializer.ts` | ~158–170 | teruskan `pinFromCustomerAt` ke payload |
| `src/services/conversation.service.ts` | ~60–75 | idem |
| `packages/admin-dashboard/src/types/livechat.ts` | ~125 | tambah `pinFromCustomerAt?: string \| null` |
| `packages/admin-dashboard/src/utils/sharelocCardStatus.ts` | 63 | ganti `Boolean(chat.shareLocationSent …)` → `Boolean(chat.pinFromCustomerAt \|\| (chat.shareLocationSent && !chat.pinFromStaffAt))` |

## T3.4 — Gate Fase 3

```powershell
npx vitest run tests/unit/customer-location-refresh.test.ts tests/unit/location-adequacy.test.ts tests/unit/conversation-location-adequacy.test.ts tests/unit/shareloc-card-status.test.ts tests/unit/staff-task-location-precedence.test.ts
npm run typecheck
```
**Acceptance:** 2 tes baru hijau; tidak ada tes lama berubah selain penyesuaian flag.
**Rollback:** `git checkout --` 6 file fase ini.

---

# FASE 4 — Skrip healing benar-benar menulis (A-004, A-011)

**Blast radius:** sedang (skrip tidak jalan otomatis; risiko hanya saat `--commit`).

## T4.1 — Perbaikan wajib

**File:** `src/scripts/heal-single-card-provenance.ts`

| Baris | Sekarang | Ganti menjadi |
|---|---|---|
| 35 | `tenantFilter` null bila argumen absen | `const tenantFilter = tenantArg ? … : DEFAULT_TENANT_ID;` + import `DEFAULT_TENANT_ID` dari `../config/tenant`; tambahkan flag `--all-tenants` untuk melonggarkan |
| 157 | `$transaction(async (tx: any)` | `$transaction(async (tx)` (biarkan Prisma menyimpulkan tipe; objek tak bertipe akan ditolak `tsc`) |
| 200 | `payload: { … }` | `payload: JSON.stringify({ cardId: card.id, distanceM: d, before, after, waPin: wa ? { address: wa.address, name: wa.name } : null })` |
| 181–191 | hanya `location_source` | tambah `preferences.location_source: 'gps_pin'` dan **hapus** `location_source_label` (`const { location_source_label: _drop, ...restPrefs } = prefs;`) |
| 214–227 | `applied` tanpa exit code | `if (isCommit && applied !== actions.length) process.exitCode = 1;` |
| 209–212 | hanya cetak detail | tambah diff per field: `before/after` per baris (`console.log('  before:', JSON.stringify(a.before))`) |

## T4.2 — Tes offline (mock Prisma)

**File baru:** `tests/unit/heal-single-card-provenance.test.ts`

Kasus wajib (adversarial):
1. `payload` yang dikirim ke `auditLog.create` **bertipe string** (`expect(typeof payload).toBe('string')`).
2. `--dry-run` → 0 panggilan `customerAddress.update`.
3. `--commit` dengan 1 kandidat → 1 update kartu + 1 update customer + 1 audit; `last_used_at` **tidak** ada di `data`.
4. Kandidat dengan sumber `bidan_shareloc` saja → **ditolak** (setelah F3: hanya `share_location_sent` asli / `pin_from_customer_at`).
5. Tanpa `--tenant` → hanya tenant default (tidak menyentuh tenant lain).

## T4.3 — Gate Fase 4

```powershell
npx vitest run tests/unit/heal-single-card-provenance.test.ts
npm run typecheck
```
**Acceptance:** 5 tes hijau; `tsc` menolak bila `payload` dikembalikan menjadi objek.
**Rollback:** `git checkout -- src/scripts/heal-single-card-provenance.ts` + hapus file tes.

---

# FASE 5 — Satu kontrak `field_verified` & hentikan label permanen (A-006, A-007, A-005)

**Blast radius:** tinggi (bypass gerbang navigasi).

## T5.1 — Fungsi kanonik

**File baru:** `src/domain/location-trust.ts`

```ts
import type { TaskLocationLike } from './location-adequacy';

export interface FieldVerificationInput {
  housePhotoUrl?: string | null;
  accuracyM?: number | null;
  /** true HANYA bila sesi ini mengunci GPS lapangan baru. */
  hasFreshFieldGps: boolean;
  sameLocation: boolean;
  preferences?: Record<string, any> | null;
  purchaseCount?: number | null;
}

export interface FieldVerificationResult {
  verified: boolean;
  reason: 'no_photo' | 'no_fresh_gps' | 'accuracy_too_low' | 'different_house' | 'legacy_visit_without_fresh_gps' | 'verified';
  /** Boleh melewati modal navigasi (D1 Opsi 6.3). */
  bypassNavigationGate: boolean;
}

export function deriveFieldVerification(input: FieldVerificationInput): FieldVerificationResult {
  if (!input.housePhotoUrl) return { verified: false, reason: 'no_photo', bypassNavigationGate: false };
  if (!input.sameLocation) return { verified: false, reason: 'different_house', bypassNavigationGate: false };
  if (!input.hasFreshFieldGps) {
    return { verified: false, reason: 'legacy_visit_without_fresh_gps', bypassNavigationGate: false };
  }
  if (typeof input.accuracyM === 'number' && input.accuracyM > 50) {
    return { verified: false, reason: 'accuracy_too_low', bypassNavigationGate: false };
  }
  return { verified: true, reason: 'verified', bypassNavigationGate: true };
}
```

Aturan: `bypassNavigationGate` **hanya** dari `verified` (bukan dari `purchaseCount`). `purchaseCount` hanya boleh menaikkan `trustTier` untuk badge, bukan gerbang.

## T5.2 — Pakai di tiga tempat

1. `src/domain/location-adequacy.ts` → `resolveTaskLocationPrecedence` memanggil `deriveFieldVerification({ housePhotoUrl, accuracyM: prefs.location_accuracy_m, hasFreshFieldGps: <ada entri history field GPS pada 150 m>, sameLocation, preferences, purchaseCount })`.
2. `src/domain/location-adequacy.ts` → `resolveLocationAdequacy` step 1: `isFieldVerified` = hasil fungsi (bukan `housePhotoUrl && (staffVerified || purchaseCount>0)`).
3. `src/services/staff-location.service.ts:227-231` → ganti dengan:

```ts
      const isFieldVerified = deriveFieldVerification({
        housePhotoUrl,
        accuracyM: typeof accuracyM === 'number' ? accuracyM : null,
        hasFreshFieldGps: hasNewPhoto && lat != null && lng != null,
        sameLocation: diffFromOriginalKm == null || diffFromOriginalKm <= 0.150 || isPreviousCoordEstimated,
        preferences: currentPrefs,
        purchaseCount: (customer as any).purchase_count ?? 0,
      }).verified;
```

**Acceptance A-007:** simpan **catatan teks saja** (lat/lng null) tidak lagi menghasilkan `field_verified`.

## T5.3 — Berhenti menulis label permanen

| File | Baris | Aksi |
|---|---|---|
| `src/services/staff-location.service.ts` | 271 | hapus `location_source_label` dari `updatedPrefs` |
| `src/services/customer-location-refresh.service.ts` | 285, 314 | hapus `location_source_label` |
| `src/scripts/reconcile-trapped-customer-locations.ts` | 83, 95 | ganti perbandingan label → perbandingan `location_source` saja |
| `src/services/customer.service.ts` | 2563 | ganti `location_source_label: prefs.location_source_label` → `location_source_label: buildLocationSourceLabel(resolveEffectiveLocationSource(c))` |

**Helper baru di `src/domain/location-source.ts`:**

```ts
export function buildLocationSourceLabel(source: LocationSourceKind, fieldVerified = false): string | null {
  if (fieldVerified) return FIELD_VERIFIED_LOCATION_LABEL;
  if (source === 'gps_pin') return '📍 Titik Presisi';
  if (source === 'manual_staff') return STAFF_VERIFIED_LOCATION_LABEL;
  if (source === 'estimated_area') return '🟡 Estimasi';
  return null;
}
```

**Frontend (hanya 2 titik baca label):**
- `packages/admin-dashboard/src/pages/tenant/CustomerDatabase.tsx:1064,1070` → pakai `buildLocationSourceLabel(effective_location_source)` dari `geoUtils.ts` (tambahkan fungsi kembar).
- `packages/admin-dashboard/src/components/livechat/LiveChatCustomerModal.tsx:142` → idem.

## T5.4 — Gate Fase 5

```powershell
npx vitest run tests/unit/location-adequacy.test.ts tests/unit/staff-task-location-precedence.test.ts tests/unit/staff-location-sync.test.ts tests/unit/staff-location-photo-guard.test.ts tests/unit/staff-dashboard-hardening.test.ts tests/unit/dashboard-geo-utils.test.ts tests/unit/shareloc-card-status.test.ts
npm run build
cd packages/admin-dashboard; npm run build
```
**Acceptance:** hijau; `rg -n "location_source_label:" src --glob "*.ts"` → hanya 1 hasil (helper baca di `customer.service.ts`).
**Rollback:** revert 6 file + hapus `location-trust.ts`.

---

# FASE 6 — Konfirmasi pindah rumah & invarian data (A-003, A-015, A-008)

## T6.1 — Satu ambang, satu field yang dibaca

**File:** `src/services/staff-location.service.ts`

1. Tambah konstanta modul:

```ts
const MOVE_CONFIRMATION_THRESHOLD_KM = 0.150;
```

2. Ganti **semua** literal `0.150` (baris 159, 230, 256) dan **semua** `> 1.0` (baris 315, 325, 356, 387, 390-391) dengan `MOVE_CONFIRMATION_THRESHOLD_KM`.
3. Perbaiki pesan balikan baris 389–395 agar memakai ambang baru:

```ts
          message: (() => {
            if (diffFromOriginalKm != null && diffFromOriginalKm > MOVE_CONFIRMATION_THRESHOLD_KM) {
              return `Titik GPS lapangan berselisih ${Math.round(diffFromOriginalKm * 1000)} m dari titik tersimpan. Titik lama dipertahankan dan menunggu konfirmasi pindah rumah.`;
            }
            if (coordsUpdated) return 'Titik lokasi berhasil diperbarui.';
            return 'Catatan lokasi tersimpan (tanpa perubahan titik GPS).';
          })(),
```

4. Teruskan ke payload SSE **dan** ke kartu tugas (`staff-reservation.service.ts` 3 situs): `needsMoveConfirmation: Boolean(prefs.needs_move_confirmation)`.
5. Dashboard: `staffTaskTypes.ts` tambah `needsMoveConfirmation?: boolean`; `StaffTodayTaskCard.tsx` tampilkan badge "⚠️ Perlu konfirmasi pindah rumah" bila true; `StaffToday.tsx:1168` ikuti `diverged || needsMoveConfirmation`.
6. Prompt pruning (state-gated): di `src/v3/state/goal-tracker.ts`, bila `needs_move_confirmation` aktif, suntikkan instruksi konfirmasi pindah rumah **hanya** di cabang itu (jangan pernah mengirim kedua cabang).

## T6.2 — Invarian `last_used_at`

**File:** `src/services/staff-location.service.ts:294-308` — hapus `last_used_at: new Date()` dari `customerAddress.update`; sebagai gantinya pertahankan nilai lama (tidak ditulis). Bila memang perlu jejak "kapan titik kartu berubah", pakai kolom lain yang tidak dipakai resolver (`updated_at` tidak ada di schema → gunakan `preferences.address_point_updated_at` pada entitas customer).

**Acceptance:** `rg -n "last_used_at" src/services/staff-location.service.ts` → kosong.

## T6.3 — Guard konflik alamat pin (A-008)

**File:** `src/services/location-ingest.service.ts` sebelum `updateCustomerLocation`:

```ts
      const existingAddress = String((customer?.preferences as any)?.address || '').trim();
      const incomingAddress = rawAddress || '';
      const existingCoords = {
        lat: customer?.lat != null ? Number(customer.lat) : null,
        lng: customer?.lng != null ? Number(customer.lng) : null,
      };
      const pinCoords = { lat, lng };
      const sameHouse =
        hasValidCoords(existingCoords) ? distanceMeters(existingCoords, pinCoords) <= SAME_PLACE_TOLERANCE_M : false;
      const addressIsNew = incomingAddress.length > 0 && incomingAddress.toLowerCase() !== existingAddress.toLowerCase();
      const allowAddressWrite = !existingAddress || sameHouse || !hasValidCoords(existingCoords);
```

Lalu kirim `address: allowAddressWrite ? rawAddress : undefined` dan bila ditolak, simpan kandidat:

```ts
      // Kandidat alamat menunggu konfirmasi staf (tidak menimpa alamat terverifikasi)
```
lewat `customerService.updateCustomerLocation(..., { address: undefined, landmark: rawLandmark })` + tulis `preferences.address_candidate = { address: incomingAddress, at: new Date().toISOString() }` (field baru, aditif).

## T6.4 — Gate Fase 6

```powershell
npx vitest run tests/unit/staff-location-sync.test.ts tests/unit/location-ingest.test.ts tests/unit/location-immutability.test.ts tests/unit/staff-task-location-precedence.test.ts tests/unit/location-prompt-pruning.test.ts tests/unit/dashboard-geo-utils.test.ts
npm run typecheck
cd packages/admin-dashboard; npm run build
```
**Acceptance:** tes 100 m / 200 m / 900 m / 2 km konsisten (`diverged`, audit action, pesan, badge); `last_used_at` tidak ditulis.

---

# FASE 7 — Kebersihan & dokumentasi (A-009, A-013)

1. `packages/admin-dashboard/src/pages/staff/StaffUpcomingCard.tsx:23` → hapus import mati; tambahkan label tombol "Peta Rute (Estimasi)" + warna `warning` memakai `needsNavigationPreflight(item.address)` **agar konsisten** dengan kartu lain (gerbang tetap dari `requestNavigation`).
2. `docs/KNOWN_ISSUES.md` → entri baru:
   - `#xxx Keputusan bisnis: Quick Reply kelurahan TETAP meminta shareloc` (menimpa butir 7 issue #315).
   - Daftar A-001…A-018 dengan status per fase.
3. `docs/FEATURE_INVENTORY.md` → tambahkan modul baru: `src/domain/location-source.ts`, `src/domain/location-trust.ts`, `src/utils/travel-duration.ts`, `src/services/staff-location.service.ts`, `src/services/customer-location-refresh.service.ts`, `src/scripts/heal-single-card-provenance.ts`.
4. `docs/MODULE_INDEX.md` → daftarkan 3 seam kanonis baru.
5. Perbaiki ejaan template DB `kelurahan` **hanya** bila diminta: `bund` → `Bunda`, `cek kan` → `cekkan` (D2 tetap: ajakan shareloc dipertahankan).

**Gate:** `npm run check:reuse`, `npm run typecheck`, `npm run build`.

---

# FASE 8 — Data healing (BUTUH PERSETUJUAN TERPISAH)

**Prasyarat:** Fase 0–7 hijau **dan** kode sudah ada di server (`/opt/wa-clinic-bot`).

```bash
# 1. Dry-run seluruh tenant default
npx tsx src/scripts/heal-single-card-provenance.ts --tenant=default-tenant

# 2. Dry-run per kasus yang disetujui
npx tsx src/scripts/heal-single-card-provenance.ts --tenant=default-tenant --customer=14e8b527-652b-4ae4-866b-89b2c980ede6
```

**Acceptance sebelum `--commit`:**
- diff per kandidat ditampilkan dan disetujui manusia
- `pg_dump` dibuat:
```bash
docker exec -i wa-clinic-bot-postgres-1 pg_dump -U postgres -d wa_clinic_db > /root/backup/pre-heal-$(date +%F-%H%M).sql
```
- `--commit` dijalankan **hanya** setelah 2 syarat di atas

**Verifikasi pasca-commit:**
```sql
SELECT id, location_source, address, landmark, last_used_at FROM customer_addresses WHERE id = '<card>';
SELECT location_source, preferences->>'location_source', preferences->>'location_source_label' FROM customers WHERE id = '<customer>';
```
Expected: `gps_pin`, alamat benar, `last_used_at` **tidak berubah**, label lama tidak lagi menyesatkan.

---

# FASE 9 — Deploy (BUTUH PERSETUJUAN TERPISAH)

**Gate sebelum deploy (semua wajib):**

```powershell
npm run typecheck
npm run build:all
node scripts/reuse/check-architecture.mjs --warn --json
node scripts/reuse/check-reuse.mjs --warn --json
npm test
```

**Acceptance full suite:** 0 failure **baru**. Untuk `hybrid-reservation-parser` wajib bukti revert-and-rerun:

```powershell
git stash push -- <file yang diubah>   # atau clone bersih di temp
npx vitest run tests/unit/hybrid-reservation-parser.test.ts
```
Harus tetap gagal tanpa perubahan kita → baru boleh disebut pre-existing.

**Deploy:** `app` saja, **tanpa** WAHA (1-step verification, sesuai `AGENTS.md`). Bila ada risiko menyentuh WAHA → 2-step + WARNING eksplisit.

**Rollback:** `git checkout <tag-sebelumnya> && docker compose up -d app` + restore `pg_dump` bila Fase 8 sudah dijalankan.

---

## 2. Matriks risiko fase

| Fase | Risiko utama | Mitigasi | Rollback |
|---|---|---|---|
| F0 | Label presisi berubah → gerbang navigasi muncul/hilang | Tes 5 kasus adversarial + fail-closed (`null`) | Revert 3 file |
| F1 | Simbol hilang → runtime error | Pemindahan byte-identik + grep pemanggil + build | Hapus 2 file baru |
| F2 | — | — | Revert 2 file |
| F3 | State kepercayaan berubah untuk data lama | Guard legacy `share_location_sent` + tes inbound/outbound | Revert 6 file |
| F4 | `--commit` tidak sengaja | Default dry-run + tenant default + tes mock | Revert skrip |
| F5 | Bypass gerbang hilang untuk pelanggan field-verified lama | `hasFreshFieldGps` + fallback history `field_verified` | Revert 6 file |
| F6 | Konflik rumah tidak terselesaikan otomatis | Badge + prompt state-gated + audit | Revert 3 file |
| F8 | Data produksi | `pg_dump` + dry-run + persetujuan | Restore dump |

## 3. Definisi selesai (plan-level)

1. Semua gate: `typecheck`, `build:all`, `check:architecture` (0), `check:reuse` (0), `npm test` (0 failure baru).
2. `rg -n "location_source_label:" src --glob "*.ts"` → hanya helper baca.
3. `rg -n "needs_move_confirmation" src packages` → minimal 1 penulis + 1 pembaca.
4. `rg -n "coordOwner" src` → 1 seam + 3 situs kartu.
5. `docs/KNOWN_ISSUES.md` + `docs/FEATURE_INVENTORY.md` + `docs/MODULE_INDEX.md` diperbarui.
6. Belum ada deploy/DB write sampai F8/F9 disetujui terpisah.
