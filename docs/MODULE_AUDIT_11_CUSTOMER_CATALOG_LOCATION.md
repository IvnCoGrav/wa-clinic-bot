# AUDIT MODUL 11 DARI 16 — CUSTOMER, CATALOG & LOCATION SERVICES

**Modul:** Customer, Treatment Catalog & Location Resolution (`src/services/customer.service.ts`, `src/repositories/customer.repository.ts`, `src/domain/customer-address.ts`, `src/services/location-resolver.service.ts`, `src/utils/gazetteer.ts`, `src/utils/gazetteer-zipcode-resolver.ts`, `src/services/treatment-catalog.service.ts`, `src/services/delivery.service.ts`, `src/config/landmarks.ts`, `src/utils/google-maps-url-resolver.ts`)  
**Commit:** `2ac0ecc4` (`master`), working tree bersih  
**Tanggal audit:** 2026-11-09  
**Sifat:** Read-only (Fase F1.1). Tidak ada file source code aplikasi (`src/`) yang diubah.  
**Metode:** Static code analysis, audit kepatuhan mandat repo (tenant isolation, data-driven, anti-hardcode, anti-spaghetti, single seam of truth), penelusuran dependensi lintas-lapisan, analisis memori & konkurensi, verifikasi terhadap 120 unit test Vitest, dan pemetaan FMEA.

---

## CAKUPAN YANG SUDAH DIBACA

| File | Baris | Status | Deskripsi Tanggung Jawab |
|---|---:|---|---|
| `src/services/customer.service.ts` | 3.262 | Dibaca penuh | **God Service**: identitas customer, sinkronisasi label, update lokasi/ongkir, multi-address book, preferensi JSONB, marketing MQL, profile picture sync, kalkulasi LTV & ground truth. |
| `src/repositories/customer.repository.ts` | 172 | Dibaca penuh | Seam persistensi customer (`CustomerRepository`, `PostgresCustomerRepository`, `InMemoryCustomerRepository`), fail-closed CRUD data customer. |
| `src/domain/customer-address.ts` | 621 | Dibaca penuh | **Domain Logic**: buku alamat pelanggan, skema Zod `SavedCustomerAddress`, algoritma deduplikasi alamat deterministik (`addressesMatch`), integrasi toponimi, dan manajemen tombstone. |
| `src/services/location-resolver.service.ts` | 116 | Dibaca penuh | Resolusi URL Google Maps (shortlink/shareloc), transparent geocoding fallback, dan kalkulasi ongkir awal. |
| `src/utils/gazetteer.ts` | 742 | Dibaca penuh | Single source of truth toponimi Surabaya & Sidoarjo: indeks pencarian kelurahan/kecamatan, city-scope partitioning, dan ranked phrase scan. |
| `src/utils/gazetteer-zipcode-resolver.ts` | 217 | Dibaca penuh | Resolusi kode pos instan berbasis indeks in-memory gazetteer (exact kel|kec, most-common kec, free-text match). |
| `src/services/treatment-catalog.service.ts` | 2.459 | Dibaca penuh | Pasca-S5.2: katalog 42 layanan data-driven dari tabel `clinic_services`, resolusi audiens/usia, life-stages inference, dan fallback in-memory default-tenant. |
| `src/services/delivery.service.ts` | 391 | Dibaca penuh | Multi-tier routing & ongkir: ORS Directions API, Google Distance Matrix API, circuity cap, dan Haversine 1.60x fallback. |
| `src/config/landmarks.ts` | 801 | Dibaca penuh | Kamus statis 800 baris: pemetaan Landmark, Apartemen, Mall, dan Perumahan Populer Surabaya & Sidoarjo ke kelurahan/kecamatan/koordinat. |
| `src/utils/google-maps-url-resolver.ts` | 330 | Dibaca penuh | Ekstraksi koordinat dari URL Google Maps, penanganan redirect HTTP Axios, decoding plus-code, dan parsing query tempat. |
| **Total** | **9.111** | **100%** | **Seluruh 10 file modul diinspeksi secara baris demi baris.** |

**Dependensi yang dibaca sebagian (konteks integrasi):**
- `src/integrations/google-maps/geocoding.ts` (reverse geocoding & text geocoding)
- `src/config/clinic.ts` (koordinat dan radius fallback klinik)
- `src/utils/haversine.ts` (kalkulasi jarak geodesik murni)
- `src/utils/toponym-normalizer.ts` (singkatan toponimi & singkatan kata jalan)
- `src/db/client.ts` (klien Prisma Postgres)

**Unit & Integration Test Suite yang relevan:**
- 120 test file mencakup domain customer, alamat, lokasi, delivery, katalog, dan gazetteer (seluruhnya hijau dalam baseline F0: 6.744 pass).

---

## (A) RINGKASAN MODUL + SKOR KESEHATAN

Modul 11 mengelola **fondasi data transaksi dan master pelanggan**: identitas pasien, katalog layanan medis, dan penentuan lokasi serta biaya pengantaran (*homecare treatment*).

### Kelebihan Arsitektural (+)
1. **Katalog Data-Driven Pasca-S5.2 (`treatment-catalog.service.ts`)**: Pengalihan katalog dari auto-seed/hardcode ke tabel basis data `clinic_services` per tenant berhasil menstandarkan pemisahan katalog multi-tenant.
2. **Deduplikasi Alamat Deterministik (`customer-address.ts`)**: Logika `addressesMatch` menggabungkan bukti fisik jarak (<150 m) dan toponimi wilayah secara cermat tanpa bergantung pada tebakan LLM, menjaga integritas multi-alamat (rumah tinggal vs rumah mertua/kedua).
3. **Arsitektur Fallback Berlapis Routing (`delivery.service.ts`)**: Penggunaan 3 lapis perhitungan jarak (ORS Motorbike → Google Distance Matrix → Haversine dengan circuity cap 1.60x) memberikan ketahanan tinggi terhadap downtime API eksternal.
4. **Indeks Toponimi Terpusat (`gazetteer.ts`)**: Pembangunan indeks in-memory tunggal saat startup memangkas I/O disk untuk resolusi wilayah di area operasional inti (Surabaya & Sidoarjo).
5. **Seam Repository Pattern (`customer.repository.ts`)**: Adanya interface eksplisit `CustomerRepository` dan implementasi `PostgresCustomerRepository` (fail-closed) serta `InMemoryCustomerRepository` untuk pengujian offline.

### Kelemahan Arsitektural (−)
1. **God Service `customer.service.ts` (3.262 baris)**: Merupakan modul backend terbesar di repositori saat ini (>2x batas maksimal 1.500 baris). File ini menampung 8 tanggung jawab domain yang berbeda tanpa dekomposisi modular.
2. **Bypass Seam Repository (19 Titik Update Langsung)**: Meskipun `CustomerRepository` telah dibuat pada Fase 5a, terdapat 19 titik di dalam `customer.service.ts` yang masih memanggil `prisma.customer.update` / `updateMany` secara langsung, membocorkan abstraksi persistensi dan mengabaikan seam.
3. **Celah Keamanan SSRF pada Pengurai Maps (`google-maps-url-resolver.ts:276`)**: Pemanggilan `axios.get(cleanUrl)` mengikuti hingga 5 redirect tanpa validasi hostname terhadap allowlist resmi Google Maps (`maps.app.goo.gl`, `goo.gl`, `google.com`), memungkinkan eksploitasi Server-Side Request Forgery ke IP internal atau AWS metadata.
4. **Asimetri Multi-Tenant pada Ongkir (`delivery.service.ts:244`)**: Nilai default origin klinik terkunci pada koordinat Kala Spa `{ lat: clinicConfig.lat, lng: clinicConfig.lng }` dan `DEFAULT_TENANT_ID`. Tenant baru tanpa koordinat eksplisit akan salah mengkalkulasi ongkir dari Surabaya/Sidoarjo.
5. **Data Bisnis Hardcode Raksasa (`landmarks.ts` 801 baris)**: Ratusan koordinat landmark statis tertulis di kode TypeScript, melanggar *Mandat Non-Hardcode & Data-Driven Architecture*.
6. **Kompilasi Regex Berulang pada Hot Path (`gazetteer.ts:406-411`)**: `boundedMatchIndex()` mengompilasi `new RegExp` pada setiap baris gazetteer di hot-path setiap pesan masuk, memboroskan siklus CPU.

**Skor Kesehatan: 2.8 / 5.0 (Fungsionalitas delivery dan deduplikasi alamat sangat matang, namun terbebani God Object 3.262 baris, 19 titik bypass repository seam, celah SSRF, dan data landmark statis).**

---

## (B) TABEL TEMUAN LENGKAP

| ID | Severity | File:Baris | Masalah | Dampak Sistemik | Prinsip yang Dilanggar | Solusi Fondasional | Effort | Keyakinan | Status |
|---|---|---|---|---|---|---|---|---|---|
| **CCL-01** | **Tinggi** | `src/services/customer.service.ts:1-3262` | God Object 3.262 baris menggabungkan identitas, multi-address book, location refresh, marketing MQL, profile sync, dan LTV. | Blast radius sangat luas saat refaktor; sulit diuji secara terisolasi; rawan regresi pada alur transaksi. | Batas Modul Jelas (<1.500 baris), Modularity-First Mandate | Pecah per domain: `customerAddressService`, `customerLocationService`, `customerLifecycleService`, `customerMarketingService`. | L | H | TERVERIFIKASI |
| **CCL-02** | **Tinggi** | `src/services/customer.service.ts:104, 435, 468, 725, 772, 813, 876, 1054, 1081, 1152, 1296, 1442, 1563, 2142, 2631, 2941, 3111` | 19 titik pemanggilan `prisma.customer.update` / `updateMany` langsung membypass `CustomerRepository` seam. | Dual-path persistensi; pengujian in-memory tidak konsisten; audit logging dan validasi mutasi terlewati. | Single Canonical Contract Mandate, Repository Scoping Mandate | Alihkan seluruh 19 mutasi agar menggunakan `CustomerRepository` seam resmi. | M | H | TERVERIFIKASI (Track A D-02) |
| **CCL-03** | **Tinggi** | `src/utils/google-maps-url-resolver.ts:276` | `axios.get(cleanUrl)` mengikuti 5 redirect HTTP tanpa validasi host allowlist resmi Google Maps dan tanpa blokir IP private. | Penyerang dapat menyuntikkan URL yang me-redirect bot ke IP internal (SSRF / Cloud Metadata 169.254.169.254). | Secure Coding Standards, OWASP SSRF Prevention | Pasang hostname allowlist (`maps.app.goo.gl`, `goo.gl`, `*.google.com`), cegah redirect ke private subnet, pakai `URL` API. | S | H | TERVERIFIKASI (Track A UTL-04) |
| **CCL-04** | **Tinggi** | `src/services/delivery.service.ts:244-245, 335` | Signature `calculateDelivery` menetapkan default `clinicCoords` ke koordinat hardcoded Kala Spa dan `DEFAULT_TENANT_ID`. | Tenant lain yang memanggil kalkulasi ongkir tanpa parameter klinik akan memakai koordinat Surabaya/Sidoarjo (ongkir ngawur). | Multi-Tenant & SaaS-Readiness Mandate | Ambil origin koordinat klinik dari `getClinicLocationAsync(tenantId)` di basis data. | S | H | TERVERIFIKASI (Track A CFG-05) |
| **CCL-05** | **Tinggi** | `src/repositories/customer.repository.ts:37, 75-77` | Signature `CustomerRepository.update(id, patch)` tidak menerima `tenantId` dan mengeksekusi `prisma.customer.update({ where: { id }, data: patch as any })`. | Celah IDOR / modifikasi data lintas-tenant jika ID pelanggan milik tenant lain dikirimkan. | Tenant Isolation Mandate, Defensive Programming | Tambahkan parameter `tenantId: string` dan terapkan scoped update: `update(id, patch, tenantId)`. | S | H | TERVERIFIKASI (Track A D-03) |
| **CCL-06** | **Sedang** | `src/config/landmarks.ts:1-801` | 800 baris data landmark, apartemen, dan perumahan Surabaya/Sidoarjo hardcoded di file TypeScript statis. | Menambah ukuran bundel runtime; mustahil disesuaikan per tenant tanpa deployment ulang; tidak portabel ke kota lain. | Non-Hardcode & Data-Driven Architecture | Pindahkan data landmark ke tabel `clinic_landmarks` per-tenant atau gazetteer terstruktur dengan skrip migrasi. | M | H | TERVERIFIKASI (Track A CFG-09) |
| **CCL-07** | **Sedang** | `src/utils/gazetteer.ts:406-411` | `boundedMatchIndex()` mengompilasi `new RegExp` berulang kali per kandidat per baris di hot-path setiap pencarian lokasi. | Pemborosan alokasi memori RAM dan siklus CPU yang signifikan saat parsing ribuan pesan chat. | Performance & Resource Efficiency Mandate | Kompilasi regex satu kali di awal (*pre-compiled regex cache*) atau gunakan pencocokan substring berbatas spasi/tanda baca. | S | H | TERVERIFIKASI (Track A UTL-09) |
| **CCL-08** | **Sedang** | `src/utils/gazetteer-zipcode-resolver.ts:94-96` | `kelToZip` menyimpan entri pertama untuk nama kelurahan yang identik di kota/kecamatan berbeda (homonim). | Resolusi kode pos salah kota jika ada nama desa yang sama (misal 'Sidomulyo' di berbagai kabupaten). | Correctness & Data Integrity | Simpan daftar komposit `kelurahan + kecamatan` atau kembalikan kode pos representatif bila terjadi ambiguitas homonim. | S | H | TERVERIFIKASI (Track A UTL-17) |
| **CCL-09** | **Sedang** | `src/domain/customer-address.ts:1-621` | File domain 621 baris mencampuradukkan skema Zod, algoritma deduplikasi 150m, Levenshtein, dan tombstone pruning. | Kompleksitas tinggi; sulit dipelihara dan diuji secara independen. | Single Responsibility Principle, Modularity-First | Ekstrak ke sub-modul: `customer-address.schema.ts`, `address-dedup.ts`, dan `address-tombstone.ts`. | S-M | H | TERVERIFIKASI (Track A DOM-02) |
| **CCL-10** | **Sedang** | `src/domain/customer-address.ts:83-144` | Fungsi `haversineMeters` dan `levenshtein` ditulis inline dan menduplikasi modul utilitas bersama `haversine.ts`. | Redundansi kode; potensi inkonsistensi formula matematis jarak antar-modul. | DRY (Don't Repeat Yourself), Single Canonical Seam | Impor dan gunakan `calculateHaversineDistance` dari `src/utils/haversine.ts` dan utilitas string resmi. | S | H | TERVERIFIKASI (Track A DOM-04) |
| **CCL-11** | **Rendah** | `src/repositories/customer.repository.ts:30, 60-70` | Properti `is_internal_staff` ada di interface `CustomerCreateData` tetapi tidak disimpan ke `data` pada `prisma.customer.create`. | Penanda staf internal pada customer baru hilang saat pembuatan data, memerlukan update susulan terpisah. | Data Completeness & Schema Contract | Sertakan `is_internal_staff: data.is_internal_staff ?? false` pada blok data `prisma.customer.create`. | S | H | TERVERIFIKASI (Track A D-09) |
| **CCL-12** | **Rendah** | `src/services/location-resolver.service.ts:36` | Parameter `tenantId: string = 'default-tenant'` menggunakan string literal default. | Pemanggil tanpa parameter eksplisit rentan membocorkan kalkulasi ongkir ke tenant default. | Multi-Tenant Data Isolation Mandate | Wajibkan parameter `tenantId` tanpa nilai default. | S | H | TERVERIFIKASI |

---

## (C) BEFORE / AFTER KODE

### C-1. Pencegahan Server-Side Request Forgery (SSRF) pada Google Maps URL Resolver (CCL-03)

**Before** (`src/utils/google-maps-url-resolver.ts:275-284`):
```typescript
try {
  // Rentan SSRF: tidak ada allowlist hostname, mengikuti redirect bebas ke jaringan lokal/internal
  const response = await axios.get(cleanUrl, {
    maxRedirects: 5,
    timeout: timeoutMs,
    validateStatus: (status) => status >= 200 && status < 400,
    headers: {
      'User-Agent': 'Mozilla/5.0...',
    },
  });
```

**After**:
```typescript
import { URL } from 'url';

const ALLOWED_MAPS_HOSTS = new Set([
  'maps.app.goo.gl',
  'goo.gl',
  'maps.google.com',
  'www.google.com',
  'google.com',
  'maps.google.co.id'
]);

function isAllowedMapsUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    // Cegah loopback, IPv4 private (10/8, 172.16/12, 192.168/16), dan link-local (169.254/16)
    if (/^(localhost|127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.)/.test(host)) return false;
    return ALLOWED_MAPS_HOSTS.has(host) || host.endsWith('.google.com') || host.endsWith('.google.co.id');
  } catch {
    return false;
  }
}

// Pada resolveGoogleMapsUrl:
if (!isAllowedMapsUrl(cleanUrl)) {
  return { success: false, error: 'URL hostname bukan domain resmi Google Maps yang diizinkan' };
}

const response = await axios.get(cleanUrl, {
  maxRedirects: 5,
  timeout: timeoutMs,
  beforeRedirect: (options) => {
    const redirectUrl = options.href;
    if (!isAllowedMapsUrl(redirectUrl)) {
      throw new Error(`SSRF Blocked: redirect to non-whitelisted host ${redirectUrl}`);
    }
  },
  validateStatus: (status) => status >= 200 && status < 400,
  headers: { 'User-Agent': 'Mozilla/5.0...' }
});
```

---

### C-2. Pengamanan Tenant Scoping pada `CustomerRepository.update` (CCL-05)

**Before** (`src/repositories/customer.repository.ts:75-77`):
```typescript
async update(id: string, patch: Record<string, unknown>): Promise<any> {
  // Rentan IDOR: mutasi hanya berdasarkan `id`, tanpa predikat `tenant_id`
  return await prisma.customer.update({ where: { id }, data: patch as any });
}
```

**After**:
```typescript
async update(id: string, patch: Record<string, unknown>, tenantId?: string): Promise<any> {
  if (tenantId) {
    // Validasi tenant kepemilikan sebelum update untuk memastikan isolasi multi-tenant
    const count = await prisma.customer.count({ where: { id, tenant_id: tenantId } });
    if (count === 0) {
      throw new Error(`CustomerRepository.update: customer ${id} tidak ditemukan pada tenant ${tenantId}`);
    }
  }
  return await prisma.customer.update({
    where: { id },
    data: patch as any,
  });
}
```

---

### C-3. Origin Ongkir Dinamis Berbasis Konfigurasi Tenant (CCL-04)

**Before** (`src/services/delivery.service.ts:242-246`):
```typescript
public async calculateDelivery(
  customerCoords: Coordinates,
  clinicCoords: Coordinates = { lat: clinicConfig.lat, lng: clinicConfig.lng },
  tenantId: string = DEFAULT_TENANT_ID
): Promise<DeliveryCalculationResult> {
  // clinicCoords selalu jatuh ke default Kala Spa Surabaya jika pemanggil tidak memasoknya
```

**After**:
```typescript
public async calculateDelivery(
  customerCoords: Coordinates,
  clinicCoords?: Coordinates,
  tenantId: string = DEFAULT_TENANT_ID
): Promise<DeliveryCalculationResult> {
  // Ambil koordinat klinik resmi dari database Tenant bila tidak disuplai pemanggil
  let resolvedClinicCoords = clinicCoords;
  if (!resolvedClinicCoords) {
    const { getClinicLocationAsync } = await import('../config/clinic-location');
    const tenantLocation = await getClinicLocationAsync(tenantId);
    resolvedClinicCoords = {
      lat: tenantLocation.lat,
      lng: tenantLocation.lng,
    };
  }

  // Lanjutkan perhitungan menggunakan resolvedClinicCoords
  const orsResult = await this.orsClient.calculateRoute(
    resolvedClinicCoords.lat,
    resolvedClinicCoords.lng,
    customerCoords.lat,
    customerCoords.lng
  );
  // ...
```

---

## (D) ANALISIS FMEA & PRIORITAS

| ID | Masalah Utama | Severity (S) | Occurrence (O) | Detection (D) | **RPN** | Prioritas |
|---|---|---:|---:|---:|---:|---|
| **CCL-03** | Celah SSRF pada resolving shortlink Google Maps | 9 | 4 | 7 | **252** | P1 (Tinggi) |
| **CCL-05** | IDOR / Unscoped update pada `CustomerRepository.update` | 8 | 5 | 6 | **240** | P1 (Tinggi) |
| **CCL-04** | Origin ongkir hardcoded Kala Spa pada tenant lain | 8 | 5 | 5 | **200** | P1 (Tinggi) |
| **CCL-01** | God Object `customer.service.ts` 3.262 baris | 7 | 7 | 4 | **196** | P1 (Tinggi) |
| **CCL-02** | 19 titik bypass persistensi seam `CustomerRepository` | 7 | 6 | 4 | **168** | P1 (Tinggi) |
| **CCL-06** | Data landmark 800 baris hardcoded di TypeScript | 6 | 6 | 4 | **144** | P2 (Sedang) |
| **CCL-07** | Kompilasi regex berulang per baris gazetteer | 5 | 8 | 3 | **120** | P2 (Sedang) |
| **CCL-08** | Homonim kelurahan tertelan pada zipcode resolver | 6 | 4 | 5 | **120** | P2 (Sedang) |
| **CCL-09** | God Object `customer-address.ts` 621 baris | 5 | 6 | 4 | **120** | P2 (Sedang) |
| **CCL-10** | Duplikasi utilitas Haversine & Levenshtein inline | 4 | 6 | 4 | **96** | P2 (Sedang) |
| **CCL-11** | Hilangnya `is_internal_staff` pada Prisma create | 4 | 5 | 4 | **80** | P3 (Rendah) |
| **CCL-12** | Default tenant string literal pada `location-resolver` | 4 | 4 | 4 | **64** | P3 (Rendah) |

---

## (E) KORELASI TEMUAN LAMA & REGISTER BACKLOG

| ID Modul 11 | Korelasi Backlog Terpadu | Status di Master | Catatan Rekonsiliasi |
|---|---|---|---|
| **CCL-01** | God Object Modul 11 | OPEN | Target pemecahan pada Fase F3 / God Object Refactoring. |
| **CCL-02** | `D-02` (Track A) | OPEN | 19 titik bypass seam customer terverifikasi di kode aktual. Target F2B. |
| **CCL-03** | `UTL-04` (Track A) | OPEN | Host allowlist & blocking private IP terverifikasi belum ada. Target F2B. |
| **CCL-04** | `CFG-05` (Track A) | OPEN | Default origin ongkir masih memakai `clinicConfig`. Target F2C. |
| **CCL-05** | `D-03` (Track A) | OPEN | Parameter `tenantId` belum diwajibkan di `CustomerRepository.update`. Target F2B. |
| **CCL-06** | `CFG-09` (Track A) | OPEN | 800 baris data landmark masih berada di `landmarks.ts`. Target F4.1. |
| **CCL-07** | `UTL-09` (Track A) | OPEN | Kompilasi regex di `boundedMatchIndex` masih terjadi. Target F4.1. |
| **CCL-08** | `UTL-17` (Track A) | OPEN | Map `kelToZip` masih first-win. Target F4.1. |
| **CCL-09** | `DOM-02` (Track A) | OPEN | Modul 621 baris masih belum dipecah. Target F4.1. |
| **CCL-10** | `DOM-04` (Track A) | OPEN | Duplikasi formula inline masih ada di `customer-address.ts`. Target F4.1. |
| **CCL-11** | `D-09` (Track A) | OPEN | `is_internal_staff` belum diteruskan ke create. Target F4.1. |
| **CCL-12** | Multi-Tenant Scoping | OPEN | String default `'default-tenant'` masih terpasang. Target F4.1. |

---

## (F) ANALISIS RISIKO PERUBAHAN (BLAST RADIUS & PRE-MORTEM)

1. **Blast Radius Pemecahan `customer.service.ts`**:
   - `customer.service.ts` diimpor oleh lebih dari 35 modul lain di seluruh backend (state machine, routes, webhook, follow-up, admin dispatch, dll.).
   - *Mitigasi:* Pertahankan `export const customerService = new CustomerServiceFacade()` sebagai gerbang kompatibilitas mundur sehingga call-site eksisting tidak rusak saat delegasi sub-service diimplementasikan.
2. **Blast Radius Allowlist Host Maps (`google-maps-url-resolver.ts`)**:
   - URL Google Maps pengguna seringkali menggunakan domain varian regional (`maps.google.co.id`, `maps.app.goo.gl`, `goo.gl/maps`).
   - *Mitigasi:* Buat test suite dengan 20+ variasi URL nyata Google Maps dan verifikasi bahwa seluruh varian sah tetap ter-resolve dengan baik, sembari memblokir IP internal.
3. **Blast Radius Penambahan `tenantId` pada `CustomerRepository.update`**:
   - Signature yang berubah mewajibkan penyesuaian di call-site.
   - *Mitigasi:* Jadikan `tenantId` opsional terlebih dahulu dengan peringatan konsol di tahap transisi, lalu wajibkan secara penuh sebelum peluncuran produksi multi-tenant.

---

## (G) KESIMPULAN & REKOMENDASI TAHAP LANJUTAN

Audit Modul 11 mengonfirmasi bahwa fondasi domain customer dan delivery services telah berfungsi kuat di lingkungan single-tenant, namun membutuhkan 3 intervensi kritis:
1. **Keamanan SSRF (CCL-03 / UTL-04)**: Wajib diamankan di Fase F2B sebelum sistem membuka integrasi peta publik.
2. **Isolasi Mutasi Multi-Tenant (CCL-02 & CCL-05 / D-02 & D-03)**: Menyatukan seluruh mutasi customer ke seam `CustomerRepository` dengan parameter `tenantId` wajib.
3. **Dekomposisi God Object `customer.service.ts` (CCL-01)**: Memecah service raksasa 3.262 baris menjadi modul-modul sub-domain terisolasi pada Fase F3.

Laporan ini melengkapi **16 dari 16 audit modul sistem secara penuh** (Format A–G). Modul 11 resmi memiliki dokumentasi gap audit granular yang siap ditindaklanjuti pada Fase F2 dan F3.
