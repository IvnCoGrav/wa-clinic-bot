# IMPLEMENTATION PLAN 6: Resiliensi Geocoding Arteri, Aritmatika Kombo Multi-Layanan, & Hardening Skema Prisma (Issues #26, #16, #21, #30)

## Ringkasan Eksekutif & Status
Rencana ini adalah **paket penutup (Plan 6 dari 6)** dari seluruh audit arsitektural mendalam dan inventarisasi *tech debt* pada `docs/KNOWN_ISSUES.md`. 
Fokus Plan 6 menyentuh lapisan ketahanan operasional:
1. **Issue #26**: Menghilangkan false-positive halusinasi pada `numeric-fact-validator.ts` saat customer menanyakan kalkulasi kombo ad-hoc multi-layanan (2–3 treatment gabungan) tanpa paket promo tetap.
2. **Issue #16 & Mandat Non-Regex**: Penguraian parameter tautan Google Maps (`maps.app.goo.gl`, `share.google`, `google.com/maps`) menggunakan API standar `URL` dan `URLSearchParams` alih-alih regex manipulasi string yang rapuh.
3. **Issue #21**: Resolusi nama jalan arteri/koridor populer Surabaya & Sidoarjo (misal: "Klampis Jaya", "Bronggalan", "Kertajaya", "Mayjen Sungkono") yang diinput tanpa awalan "Jl." agar otomatis terpetakan ke kelurahan induk tanpa menodong customer berulang kali.
4. **Issue #30**: Hardening mitigasi error `PrismaClientKnownRequestError: P2022` pada kolom `tenants.settings` saat bot dijalankan di lingkungan dengan skema database yang belum termigrasi penuh.

---

## 1. User Review Required (Pertimbangan & Dampak)

> [!NOTE]
> **Kombinasi Dinamis vs Batasan Keamanan Multi-Item**:
> - Pada `numeric-fact-validator.ts`, saat keranjang memuat $\ge 2$ item aktif (`strictMultiItem = true`), aturan yang melarang kutipan parsial (misal hanya menyebut 1 layanan + ongkir padahal ada 2 layanan) **tetap dipertahankan**.
> - Yang diperluas adalah kombinasi ad-hoc turn konsultasi (saat tool `get_catalog_and_price` mengembalikan $\ge 2$ layanan atau customer menanyakan kombo 2–3 layanan): validator akan mengizinkan himpunan jumlah $\sum_{i=1}^k S_i$ ($k \le 3$) beserta variasi add-on & ongkir.

> [!IMPORTANT]
> **Kepatuhan Mandat `AGENTS.md`**:
> - Dilarang menambahkan dependency baru (`package.json`). Seluruh parser URL memanfaatkan modul bawaan Node.js (`URL`, `URLSearchParams`).
> - Tidak ada regex gatekeeper intent atau mutilasi kalimat LLM.

---

## 2. Staged-Phase & Micro-Task Implementation Plan

### FASE 1: Dynamic Multi-Treatment Combo Arithmetic di `numeric-fact-validator.ts` (Issue #26)

#### Akar Masalah
Saat ini, `validateNumericFacts` di `src/v3/guardrails/numeric-fact-validator.ts` hanya menghitung pasangan 2 elemen:
`layanan + add-on` dan `layanan + ongkir`.
Bila customer bertanya: *"Kalau ambil Pijat Ceria (75rb) + Pijat Nafsu Makan (60rb) kena berapa ya?"* atau *"Pijat Bayi Ceria (75rb) + Pijat Hamil (95rb) + Moksa (25rb) berapa?"*, model LLM yang menghitung total secara cerdas (misal 135.000 atau 195.000) akan digagalkan oleh validator dengan pelanggaran:
`Nominal Rp 135.000 tidak ditemukan di data katalog/ongkir tool resmi.` sehingga memicu reprompt atau pembisuan yang salah (*false-positive*).

#### Micro-Tasks
1. **[MODIFY] `src/v3/guardrails/numeric-fact-validator.ts`**:
   - Tambahkan fungsi pembantu kombinatorik $\mathcal{O}(N^k)$ terikat ($k \le 3, N \le 6$) untuk membangkitkan kombinasi penjumlahan layanan resmi dari `servicePromo` dan `serviceOriginal` yang dihasilkan tool `get_catalog_and_price` pada turn tersebut.
   - Izinkan kombinasi 2 hingga 3 layanan utama:
     - `S_i + S_j`
     - `S_i + S_j + Addon`
     - `S_i + S_j + Ongkir`
     - `S_i + S_j + Addon + Ongkir`
   - Pastikan jika `cartCount >= 2`, grand total resmi keranjang tetap menjadi prioritas utama untuk turn yang menyebutkan kata "total".
2. **[NEW] `tests/unit/multi-treatment-combo-validator.test.ts`**:
   - Uji kombinasi 2 layanan utama (75k + 60k = 135k) $\rightarrow$ `isValid: true`.
   - Uji kombinasi 2 layanan utama + 1 add-on (75k + 60k + 25k = 160k) $\rightarrow$ `isValid: true`.
   - Uji kombinasi 2 layanan utama + 1 add-on + ongkir 10k (170k) $\rightarrow$ `isValid: true`.
   - Uji angka fiktif acak (misal 142k) $\rightarrow$ `isValid: false` (tetap terlindungi dari halusinasi).

---

### FASE 2: Parsing Google Maps URL Berbasis Standar `URL` / `URLSearchParams` (Issue #16)

#### Akar Masalah
Meskipun `src/utils/google-maps-url-resolver.ts` telah memiliki deteksi koordinat yang baik, ekstraksi query alamat (`extractAddressQueryFromUrlString`) dan pembersihan query parameter masih memakai pencocokan regex manual `/[?&]q=([^&#]*)/i` yang rentan terhadap encoding khusus, parameter ganda, atau format anchor `#`. Sesuai mandat `AGENTS.md`:
> *"Parsing parameter teknis (seperti URL Google Maps) WAJIB menggunakan API standar (`URL`, `URLSearchParams`) daripada regex hafalan yang rapuh."*

#### Micro-Tasks
1. **[MODIFY] `src/utils/google-maps-url-resolver.ts`**:
   - Refaktor `extractAddressQueryFromUrlString` dan parameter parsing koordinat (`?q=`, `?ll=`, `?daddr=`) untuk mem-parse string URL menggunakan `new URL(urlString, 'https://maps.google.com')`.
   - Gunakan `urlObj.searchParams.get('q')`, `urlObj.searchParams.get('ll')`, `urlObj.searchParams.get('daddr')`, `urlObj.searchParams.get('destination')` secara deterministik.
   - Tetap pertahankan fallback regex HANYA untuk pola path `/place/lat,lng` dan protobuf embed `!3d...!4d...` (yang memang berada di segmen pathname/hash, bukan query search params).
2. **[MODIFY] `tests/unit/google-maps-url-resolver.test.ts`**:
   - Verifikasi parsing tautan Google Maps pendek dan panjang dengan parameter kompleks (`q=Waterplace+Residence`, `daddr=-7.28,112.74`).

---

### FASE 3: Kamus Koridor Arteri Surabaya & Sidoarjo di Gazetteer (Issue #21)

#### Akar Masalah
Pelanggan lokal sering menyebut nama jalan arteri terkenal tanpa kata "Jl." atau "Jalan" (misal *"Saya di Klampis Jaya"*, *"Kertajaya indah"*, *"Mayjen Sungkono"*, *"Bronggalan sawahan"*). Karena tidak mengandung kata kunci penanda jalan (*"jl"*, *"gang"*, dll) dan bukan nama resmi kelurahan, gazetteer pre-validator bingung dan menanyakan kelurahan berulang kali.

#### Micro-Tasks
1. **[MODIFY] `src/config/landmarks.ts` / `src/utils/gazetteer.ts`**:
   - Daftarkan koridor jalan arteri populer utama di Surabaya dan Sidoarjo ke dalam kamus koridor/landmark gazetteer beserta kelurahan/kecamatan induknya:
     - `klampis jaya` $\rightarrow$ Kelurahan Klampis Ngasem, Kec. Sukolilo (Surabaya Timur)
     - `bronggalan` $\rightarrow$ Kelurahan Pacar Keling / Ploso, Kec. Tambaksari (Surabaya Timur)
     - `kertajaya` $\rightarrow$ Kelurahan Kertajaya, Kec. Gubeng (Surabaya Timur)
     - `mayjen sungkono` $\rightarrow$ Kelurahan Gunung Sari / Dukuh Pakis (Surabaya Barat)
     - `hr muhammad` $\rightarrow$ Kelurahan Pradah Kalikendal, Kec. Dukuh Pakis (Surabaya Barat)
     - `dharmahusada` $\rightarrow$ Kelurahan Mojo, Kec. Gubeng (Surabaya Timur)
     - `raya darmo` $\rightarrow$ Kelurahan Darmo, Kec. Wonokromo (Surabaya Selatan)
     - `tropodo` $\rightarrow$ Kelurahan Tropodo, Kec. Waru (Sidoarjo)
     - `pepelegi` $\rightarrow$ Kelurahan Pepelegi, Kec. Waru (Sidoarjo)
     - `pondok jati` $\rightarrow$ Kelurahan Pagerwojo, Kec. Buduran (Sidoarjo)
   - Saat teks lokasi customer cocok dengan koridor arteri ini, sistem otomatis mengatribusikan koordinat referensi kelurahan tersebut sehingga jarak dan ongkir dapat dihitung tanpa repot menodong customer.
2. **[NEW] `tests/unit/artery-corridor-gazetteer.test.ts`**:
   - Verifikasi input *"Saya di Klampis Jaya"* langsung ter-resolve ke zona Sukolilo dan menghasilkan estimasi ongkir yang valid.
   - Verifikasi input *"daerah bronggalan"* langsung ter-resolve ke zona Tambaksari.

---

### FASE 4: Prisma P2022 Schema Resilience pada `tenants.settings` (Issue #30)

#### Akar Masalah
Pada beberapa lingkungan server yang database-nya dibuat sebelum kolom `tenants.settings` ditambahkan ke skema Prisma, pemanggilan `prisma.tenant.findUnique()` tanpa klausa `select` membangkitkan error `P2022: The column tenants.settings does not exist in the current database`.

#### Micro-Tasks
1. **[MODIFY] `src/services/tenant.service.ts` / `src/services/tenant-prompt-config.service.ts`**:
   - Bungkus pembacaan kolom `settings` dengan safe-accessor atau periksa keberadaan properti via fallback jika Prisma melempar error P2022.
   - Pastikan bila kolom `settings` belum ada di tabel fisik PostgreSQL, service mengembalikan konfigurasi default kosong `{}` tanpa merusak aliran eksekusi chatbot.
2. **[NEW] `prisma/migrations/20260912000000_ensure_tenants_settings_column/migration.sql`**:
   - Sediakan skrip migrasi idempotent untuk memastikan kolom dibuat secara aman di seluruh lingkungan:
     ```sql
     -- Idempotent column creation for tenants.settings
     DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM information_schema.columns 
         WHERE table_name = 'tenants' AND column_name = 'settings'
       ) THEN
         ALTER TABLE "tenants" ADD COLUMN "settings" JSONB DEFAULT '{}'::jsonb;
       END IF;
     END $$;
     ```
3. **[NEW] `tests/unit/tenant-settings-resilience.test.ts`**:
   - Uji perilaku fallback ketika pembacaan tenant mengalami error P2022 / column undefined.

---

## 3. Matriks Verifikasi & Kriteria Keberhasilan

| Uji / Gerbang | Perintah Verifikasi | Kriteria Keberhasilan |
|---|---|---|
| Combo Validator Test | `npx vitest run tests/unit/multi-treatment-combo-validator.test.ts` | 100% Passed (kombo 2–3 layanan sah lolos, angka liar gagal) |
| URL Standard Parser | `npx vitest run tests/unit/google-maps-url-resolver.test.ts` | 100% Passed (semua parameter URL ter-parse via `URL`/`URLSearchParams`) |
| Artery Gazetteer Test | `npx vitest run tests/unit/artery-corridor-gazetteer.test.ts` | 100% Passed (nama arteri tanpa "Jl." terpetakan ke kelurahan induk) |
| Tenant Settings Fallback | `npx vitest run tests/unit/tenant-settings-resilience.test.ts` | 100% Passed (zero unhandled P2022 error) |
| Typecheck Build | `npm run build` | Exit Code 0 |
| Full Offline Vitest Suite | `npm test` | 263/263 test files passed |

---

## 4. Status Integrasi Rencana (Roadmap Akhir)

Dengan tersusunnya Plan 6 ini:
- **Plan 1**: Tool Registry & Test Price Drift $\rightarrow$ **Sedang dieksekusi di sesi lain**.
- **Plan 2**: Agent Runner Decomposition & NLU Collapse $\rightarrow$ **Siap eksekusi**.
- **Plan 3**: Goal Tracker Decomposition & Symptom Scorer $\rightarrow$ **Siap eksekusi**.
- **Plan 4**: Multi-Tenant Persona & Non-Destructive RAG $\rightarrow$ **Siap eksekusi**.
- **Plan 5**: WAHA Label Ban & Gateway Decoupling $\rightarrow$ **Siap eksekusi**.
- **Plan 6**: Geocoding Resilience, Combo Arithmetic, & Schema Hardening $\rightarrow$ **Siap eksekusi**.

**Semua temuan audit arsitektur mendalam dan seluruh tech debt di `KNOWN_ISSUES.md` kini telah 100% tuntas dibuatkan rencana implementasi proseduralnya.**
