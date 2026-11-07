# AUDIT MODUL 2 DARI 16 — CONFIG & ENVIRONMENT

**Modul:** `src/config/*` (19 file TypeScript + 3 file data)
**Commit:** `c8ce5b21` (`master`), working tree bersih
**Tanggal audit:** 2026-11-07
**Sifat:** read-only. Tidak ada file source yang diubah.
**Metode:** baca seluruh file TypeScript di `src/config`, baca file data (`persona_custom.txt`, `kenari-pricing.snapshot.json`, struktur `surabaya_sidoarjo_subdistricts.json`), lacak pemakai via `rg`, verifikasi packaging di `Dockerfile` dan `dist/`, serta uji langsung gate medis dengan `tsx`.

---

## CAKUPAN YANG SUDAH DIBACA

| File | Baris | Status |
|---|---:|---|
| `src/config/tenant.ts` | 1 | Dibaca penuh |
| `src/config/llm-context.ts` | 8 | Dibaca penuh |
| `src/config/feature-flags.ts` | 22 | Dibaca penuh |
| `src/config/clinic.ts` | 25 | Dibaca penuh |
| `src/config/copilot-tenant.ts` | 48 | Dibaca penuh |
| `src/config/coverage.ts` | 54 | Dibaca penuh |
| `src/config/staff-notification-config.ts` | 62 | Dibaca penuh |
| `src/config/staff-chat-window-config.ts` | 78 | Dibaca penuh |
| `src/config/brand.ts` | 98 | Dibaca penuh |
| `src/config/clinic-location.ts` | 96 | Dibaca penuh |
| `src/config/operational-hours.ts` | 99 | Dibaca penuh |
| `src/config/staff-chat-config.ts` | 122 | Dibaca penuh |
| `src/config/ai-eligibility-config.ts` | 137 | Dibaca penuh |
| `src/config/pricelist-promo.ts` | 137 | Dibaca penuh |
| `src/config/followup-templates.ts` | 408 | Dibaca penuh |
| `src/config/medical-keywords.ts` | 420 | Dibaca penuh |
| `src/config/persona.ts` | 693 | Dibaca penuh |
| `src/config/ai-models.config.ts` | 710 | Dibaca penuh |
| `src/config/landmarks.ts` | 800 | Dibaca penuh |
| `src/config/persona_custom.txt` | 68 | Dibaca penuh |
| `src/config/kenari-pricing.snapshot.json` | 58 | Dibaca penuh |
| `src/config/surabaya_sidoarjo_subdistricts.json` | 3.922 | Struktur + 25 baris awal + 10 baris akhir + agregat 560 record; payload tidak dibaca baris-per-baris (data, bukan kode) |
| **Total file kode** | **4.018 baris TS** | **19/19 TS dibaca penuh** |

**Dependensi yang dibaca untuk memahami perilaku (bukan modul ini):**
`src/utils/context.ts` (68), `src/utils/time-wib.ts` (53), `src/utils/cost-calculator.ts` (bagian snapshot), `src/v3/tools/clinic-faq.tool.ts` (bagian fallback), `src/v3/tools/calculate-delivery.tool.ts` (bagian origin ongkir), `src/v3/tools/get-catalog.tool.ts` (bagian template), `src/services/delivery.service.ts` (bagian origin), `src/services/conversation.service.ts` (bagian timeout), `src/services/media.service.ts` (bagian brand), `src/services/tenant-prompt-config.service.ts` (bagian default config), `src/integrations/llm/llm-gateway.ts` (90), `src/integrations/llm/model-fallback.ts` (289), `src/app.ts:238-270`, `src/worker.ts:85-115`, `src/routes/admin/settings.subroute.ts:300-380`, `1325-1415`, `1460-1490`, `src/state-machine/machine.ts:808-809`.

**Verifikasi runtime yang dilakukan:**
- Menjalankan `checkMedicalKeywords()` langsung via `npx tsx` untuk membuktikan false negative.
- Memeriksa isi `dist/config/` dan `Dockerfile` untuk membuktikan file data tidak ikut image produksi.
- Tidak ada database lokal; uji yang memerlukan DB tidak dijalankan.

---

## A. RINGKASAN MODUL + SKOR KESEHATAN

`src/config` adalah lapisan fondasi dengan fan-in sangat tinggi: `tenant.ts` diimpor 321 file, `persona.ts` 50, `ai-models.config.ts` 38, `brand.ts` 34, `clinic.ts` 20, `followup-templates.ts` 16, `medical-keywords.ts` 15. Sebagian modul sudah benar-benar data-driven: `staff-notification-config`, `staff-chat-window-config`, `staff-chat-config`, `pricelist-promo`, `brand`/`clinic-location` (varian async), dan `ai-eligibility-config` (fail-closed). Namun jalur utama masih memakai nilai global/hardcoded: brand sinkron selalu default, origin ongkir memakai `clinicConfig` global, template follow-up memakai brand default, dan gate medis deterministik menyimpan katalog gejala di TypeScript. Ditemukan satu **bug safety kritis**: teks yang mengandung "step by step" mematikan seluruh deteksi keyword medis, termasuk "kejang". Ditemukan juga **persona produksi berbeda dari development** karena `persona_custom.txt` tidak ikut image, **snapshot harga Kenari tidak ikut image**, dan **33 dari 47 template persona tidak dipakai** serta menduplikasi `followup-templates.ts`. Secara keseluruhan modul ini adalah kumpulan config yang tumbuh organik: ada pola bagus, tetapi belum ada satu sumber kebenaran per domain.

**Skor kesehatan: 2.5 / 5 (di bawah cukup; ada bug safety kritis dan pelanggaran mandat data-driven yang sistemik).**

Alasan skor:
- **+** `copilot-tenant`, `ai-eligibility-config`, dan tiga `staff-*` config sudah tenant-aware, fail-closed, dan punya test.
- **+** `pricelist-promo` punya sanitizer input yang rapi; `brand`/`clinic-location` sudah punya varian async per tenant.
- **−** Gate medis punya false negative kritis dan katalog klinis hardcoded.
- **−** Brand/lokasi tenant tidak dipakai di template, follow-up, watermark, dan perhitungan ongkir.
- **−** Persona produksi ≠ development; snapshot harga tidak ikut image.
- **−** 33/47 template persona dead/duplikat; prompt default ada di dua tempat (`config/persona.ts` dan `services/tenant-prompt-config.service.ts`).
- **−** Banyak business policy (pembayaran, coverage, 30 km, 5 km, 45 menit, H-3) hardcoded di TypeScript.

---

## B. TABEL TEMUAN

**Severity:** Kritis / Tinggi / Sedang / Rendah.
**Status:** TERVERIFIKASI = dibaca/diuji langsung; HIPOTESIS = perlu uji runtime/DB.

| ID | Severity | file:baris | Masalah | Dampak | Prinsip/standar yang dilanggar | Rekomendasi spesifik + cost-benefit | Effort | Keyakinan | Status |
|---|---|---|---|---|---|---|---|---|---|
| **CFG-01** | **Kritis** | `medical-keywords.ts:153-167` | `NON_MEDICAL_PHRASES` dicek secara global di dalam `matchesKeyword()`. Jika teks mengandung "step by step", **semua** keyword (termasuk `kejang`) dianggap tidak match. | False negative fatal: "step by step aja, tapi anak kejang" → `{isMedical:false, severity:'NONE'}` (dibuktikan via `tsx`). Pasien berisiko tidak dieskalasi. | Keselamatan klinis, deterministik guardrail, correctness | Scope pengecualian hanya ke keyword `step`, bukan seluruh teks. Tambah regression test untuk "step by step + kejang". **Cost:** 5 baris. **Benefit:** menutup false negative yang bisa membahayakan pasien. | S | H | TERVERIFIKASI (diuji runtime) |
| **CFG-02** | **Tinggi** | `persona.ts:12`, `101-107`, `196-233`; `Dockerfile:50-51`; `dist/config/` | `persona_custom.txt` dibaca dari `__dirname` (`src/config` di dev, `dist/config` di prod). File ini **tidak disalin** ke `dist`/image (runner hanya menyalin `dist` + `surabaya_sidoarjo_subdistricts.json`). Selain itu `savePersonaToDb` mengembalikan `true` saat DB gagal dan hanya menulis file; di container file itu ephemeral. | Persona produksi memakai `DEFAULT_PERSONA_PROMPT` (80 baris), sedangkan dev memakai `persona_custom.txt` (68 baris) yang berbeda aturan (mis. 500 karakter vs 2–3 kalimat). Prompt yang diuji di dev bukan prompt produksi. Saat DB gagal, admin melihat "saved" padahal setelah restart persona kembali. | Environment parity, reproducibility, prompt correctness, fail-closed | Jadikan DB (`TenantPersona`/`TenantPromptConfig`) satu-satunya sumber; file hanya untuk dev. Bila file tetap dipakai, salin eksplisit di Dockerfile dan tambah build check. Kembalikan `false`/lempar saat DB gagal. **Cost:** S–M. **Benefit:** menghilangkan drift perilaku AI dev vs prod dan silent save. | S–M | H | TERVERIFIKASI |
| **CFG-03** | **Tinggi** | `persona.ts:109`, `166-190`; `self-learning.service.ts:3`; `app.ts:256-259`; `worker.ts:104-107` | `BOT_PERSONA_PROMPT` adalah variabel global. Boot mengiterasi **semua tenant** dan `loadPersonaFromDb(tid)` mengubah global itu; bila tenant tidak punya row, ia meng-`upsert` persona tenant sebelumnya ke tenant tersebut. `BOT_PERSONA_PROMPT` juga hanya diimpor tanpa dipakai di `self-learning.service.ts:3`, menandakan global ini sudah legacy. | Kebocoran persona lintas tenant: tenant B yang belum punya persona dapat di-seed dengan persona tenant A. Global juga membuat hasil bergantung urutan iterasi. | Tenant isolation, idempotensi, SRP (read path menulis DB) | Hapus global; simpan `Map<tenantId, persona>` atau langsung baca DB per tenant. Jangan menulis saat load; seed dari default netral, bukan dari tenant lain. **Cost:** M. **Benefit:** mencegah kontaminasi persona antar tenant. | M | H | TERVERIFIKASI (jalur kode) |
| **CFG-04** | **Tinggi** | `brand.ts:27-38`, `85-88`; `persona.ts:251,262,265,287,473,481`; `followup-templates.ts:80-334`; `media.service.ts:32,57` | `getBrandIdentity()` sinkron selalu mengembalikan `DEFAULT_BRAND_IDENTITY` karena `setBrandIdentity()` **tidak pernah dipanggil** di `src`. Template tetap, follow-up, dan watermark memakai varian sinkron ini, bukan `getBrandIdentityAsync(tenantId)`. | Tenant B melihat nama "Kala Moms and Baby Spa"/"Bidan Yusi", sementara prompt LLM (yang memakai async) bisa menyebut brand tenant B. Terjadi split-brain brand dalam satu percakapan. | Tenant awareness, single source of truth, data-driven branding | Beri template parameter `brand: BrandIdentity` atau resolve brand sekali di awal request lalu inject; ganti pemakaian `getBrandIdentity()` di template/follow-up/media dengan hasil async. **Cost:** M–L (34 importer). **Benefit:** branding konsisten per tenant. | M–L | H | TERVERIFIKASI |
| **CFG-05** | **Tinggi** | `delivery.service.ts:237`, `325`; `calculate-delivery.tool.ts:619`, `864`; `clinic-location.ts:45-85` | Perhitungan ongkir memakai `clinicConfig.lat/lng` global sebagai origin. `getClinicLocationAsync(tenantId)` yang sudah ada **tidak dipakai** di jalur utama; `calculate-delivery.tool` bahkan mengirim koordinat global secara eksplisit. Nama klinik di pesan juga memakai `clinicConfig.name`. | Tenant B dihitung jaraknya dari homebase tenant A/default. Ongkir, coverage, dan pesan "dari klinik" salah. Fitur override `Tenant.settings.clinicLocation` tidak berfungsi di core delivery. | Tenant isolation, correctness, single source of truth | Ganti origin global dengan `const clinic = await getClinicLocationAsync(tenantId)` di `calculateDelivery`/tool; gunakan `clinic.name` untuk pesan. Tambah test dua tenant dengan lokasi berbeda. **Cost:** M. **Benefit:** ongkir per tenant benar; fitur yang sudah ada jadi terpakai. | M | H | TERVERIFIKASI |
| **CFG-06** | **Tinggi** | `medical-keywords.ts:7-135`, `233-243`; komentar `28-31` | Katalog gejala HIGH/MEDIUM, regex emergency, konteks obat, dan satuan dosis ditulis sebagai array/regex TypeScript. Komentar mengakui "pengecualian hardcode sementara (gate user 2026-09-17); sinonim klinis DB = tech debt". | Staf medis tidak bisa menambah sinonim/varian tanpa deploy; katalog mudah drift; audit klinis sulit. Melanggar mandat non-hardcode dan anti-overfitting. | Data-driven architecture, clinical governance, maintainability | Pindahkan kosakata klinis ke tabel DB (mis. `ClinicalSymptom` dengan `tenant_id`, `keyword`, `severity`, `synonym_of`, `active`, `version`), load ke cache saat boot, matcher tetap deterministik. Jangan ganti dengan LLM. **Cost:** L (migrasi + seed + admin). **Benefit:** perubahan klinis tanpa deploy + jejak audit. | L | H | TERVERIFIKASI |
| **CFG-07** | **Tinggi** | `persona.ts:322`, `350`, `369`, `432`, `470`, `473`, `529-531`; `clinic-faq.tool.ts:93`, `101`, `125-126`, `133` | Business policy hardcoded: pembayaran "BCA/Mandiri", coverage "Sidoarjo & Surabaya", homebase "Waru", maks 30 km, gratis ongkir 5 km, durasi default 45 menit, pembatalan H-3, reminder H-1, kualifikasi "STR". `clinic-faq` static fallback menambahkan "BRI" dan "maksimal 30 km". | Tenant B menerima kebijakan tenant A. Perubahan kebijakan mengharuskan deploy. Coverage di `coverage.ts` mencakup Gresik, tetapi template mengatakan hanya Surabaya/Sidoarjo. | Data-driven business rules, tenant awareness, consistency | Sumber kanonis: `ClinicPolicy`/`TenantPromptConfig`/`Tenant.settings`; template hanya format. Fallback harus netral atau fail-closed, bukan kebijakan tenant A. **Cost:** L. **Benefit:** kebijakan dapat diubah admin; tidak ada kontradiksi antar modul. | L | H | TERVERIFIKASI |
| **CFG-08** | **Sedang** | `persona.ts:238-693`; `followup-templates.ts:73-340` | Dari 47 key `TEMPLATES`, **33 tidak punya pemanggil runtime** (daftar di Lampiran 2), termasuk seluruh template follow-up (`followUpNoPurchaseDay3/7/14`, `nextTreatmentFollowUp`, `paymentFollowUp`, `followUpReviewBaby/Moms`, `morningReminder`) yang sudah digantikan `followup-templates.ts`. | ±330 baris dead code; dua sumber template follow-up; editor bisa mengubah template yang tidak pernah dikirim; bundle membesar. | Dead code, DRY, single source of truth | Hapus key yang tidak dipakai; pertahankan satu engine (`followup-templates.ts`); tambah test yang memastikan setiap template punya pemanggil. **Cost:** M. **Benefit:** mengurangi risiko salah edit dan ukuran bundle. | M | H | TERVERIFIKASI (grep; beberapa key masih diuji) |
| **CFG-09** | **Sedang** | `landmarks.ts:17-722`, `727-740`, `759-777`; `surabaya_sidoarjo_subdistricts.json` | 800 baris data landmark/apartemen/perumahan + regex + koordinat ditulis di TypeScript. `findPopularLandmark` memakai **first-match-wins** sehingga urutan array adalah logika bisnis (komentar 517-521 mengakui klaster harus di atas gerbang). Data geo kedua ada di JSON 560 record. | Update landmark harus deploy; menyisipkan entri bisa mengubah hasil resolve; dua sumber koordinat bisa drift. | Data-driven, maintainability, determinism | Pindahkan ke tabel/JSON data dengan kolom `priority` eksplisit; loader + validasi; satukan dengan gazetteer. **Cost:** L. **Benefit:** update tanpa deploy dan urutan tidak lagi implicit. | L | H | TERVERIFIKASI |
| **CFG-10** | **Sedang** | `operational-hours.ts:80-83`; `staff-chat-config.ts:93-111`; `followup-templates.ts:392-397`; `utils/time-wib.ts:24-52` | Ada empat implementasi konversi WIB: manual `+7h` + `getUTCHours`, `toLocaleTimeString('Asia/Jakarta')` dengan fallback manual, `+7h` untuk date key, dan `getWibTimeInfo`. | Perbedaan edge case (locale vs offset), duplikasi test, dan risiko drift jika aturan WIB berubah. | DRY, consistency, timezone correctness | Satukan di `utils/time-wib.ts`: `getWibHour`, `getWibDateKey`, `isWithinWibHourRange`; semua modul mengimpor dari sana. **Cost:** S. **Benefit:** satu implementasi, satu set test. | S | H | TERVERIFIKASI |
| **CFG-11** | **Sedang** | `operational-hours.ts:62`; `staff-chat-config.ts:68` | Ekstraksi jam dari `ClinicPolicy.factual_summary` memakai regex `/(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})/` yang sama di dua tempat. Format "08.00 s/d 17.00", "8 pagi–5 sore", atau "pukul 08.00 sampai 17.00" tidak match dan silently fallback ke default. | Jam operasional/notifikasi bisa salah tanpa error; dua modul bisa menafsirkan policy yang sama secara berbeda (staff-chat menambah toleransi -1/+4). | Robust parsing, single source, observability | Prioritaskan field terstruktur `Tenant.settings.operationalHours`; bila tetap parsing teks, pakai satu parser bersama + test variasi format + log saat gagal parse. **Cost:** S–M. **Benefit:** menghilangkan silent fallback. | S–M | H | TERVERIFIKASI (bentuk regex) |
| **CFG-12** | **Sedang** | `ai-models.config.ts:251`, `400-422`, `565-595`; `llm-gateway.ts:33-41` | `SUPPORTED_PROVIDERS` mencantumkan 9 provider (MiniMax, OpenAI, DeepSeek, Groq, Anthropic, Alibaba, Qwen, Kenari, SumoPod), tetapi `getActiveEndpointConfig()` hanya mengembalikan endpoint KENARI/SUMOPOD. `getLlmEndpointConfig()` selalu memakai baseUrl provider aktif, lalu `sanitizeModelForProvider()` me-remap model task ke katalog provider aktif. | Admin bisa memilih "Anthropic"/"Groq" untuk sebuah task, tetapi request tetap dikirim ke SumoPod/Kenari dan modelnya di-remap diam-diam. UI menyesatkan; model yang benar-benar dipakai tidak sama dengan yang dipilih. | Contract honesty, least surprise, correctness | Batasi pilihan provider ke endpoint yang benar-benar didukung, atau route per-provider (baseUrl+key per task). Tampilkan model efektif setelah sanitasi. **Cost:** M. **Benefit:** konfigurasi UI = perilaku runtime. | M | H | TERVERIFIKASI |
| **CFG-13** | **Sedang** | `ai-models.config.ts:39-48`, `30-34`, `158-249`, `263-299`, `691-693` | Komentar `SUMOPOD_CATALOG` mengatakan "hanya 5 model", tetapi Set berisi 7 entri. Nama model diulang di konstanta, default registry, preset, `resetToGoldenDefaults`, dan `cost-calculator`. | Komentar menyesatkan; perubahan nama model harus diedit di banyak tempat dan mudah ada yang terlewat. | DRY, single source of truth, documentation accuracy | Jadikan satu array katalog + konstanta; preset/registry merujuk konstanta, bukan literal. Perbaiki komentar. **Cost:** S. **Benefit:** mengurangi drift model. | S | H | TERVERIFIKASI |
| **CFG-14** | **Sedang** | `brand.ts:44-48`, `81-82`; `clinic-location.ts:34`, `48-49`, `83-84`; `pricelist-promo.ts:96`, `105-106`, `124`; `operational-hours.ts:96`; `staff-chat-config.ts:116`; `staff-chat-window-config.ts:72`; `staff-notification-config.ts:56` | Cache brand/clinic/promo tidak punya TTL. Jika panggilan pertama terjadi saat DB down, default di-cache **selamanya** sampai restart. Fungsi clear untuk clinic/operational/staff tidak punya pemanggil produksi; hanya brand/promo yang di-clear di `settings.subroute.ts:367-368`. | Setelah DB pulih, tenant tetap melihat brand/lokasi/promo default. Setelah admin mengubah setting selain brand/promo, perubahan tidak terlihat sampai restart/TTL. | Cache correctness, observability, tenant settings freshness | Cache hanya hasil DB yang sukses, atau beri TTL; panggil clear function di setiap endpoint yang menulis setting terkait. **Cost:** S–M. **Benefit:** setting admin langsung berlaku dan tidak ada default “lengket”. | S–M | H | TERVERIFIKASI |
| **CFG-15** | **Sedang** | `ai-eligibility-config.ts:26-35`, `67-73` | Fallback `buildFailClosedConfig()` membaca `process.env.AI_CUSTOMER_SCOPE`; bila env berisi `ALL`, fallback menjadi **ALL** (fail-open), bertentangan dengan komentar "JANGAN ubah ini jadi fail-open (ALL)". `legacy_bypass_bot` dan `repeat_patient_bypass_bot` juga env-global, bukan per-tenant DB. | Saat DB/config tenant tidak tersedia, AI bisa aktif ke semua customer lama jika env `ALL` disetel. Kebijakan bypass tidak bisa berbeda per tenant. | Fail-closed, tenant awareness, safety | Fallback selalu `NEW_ONLY` kecuali override eksplisit yang terdokumentasi; pindahkan bypass flags ke `Tenant`/config DB. **Cost:** S–M. **Benefit:** menjamin perilaku konservatif saat outage. | S–M | H | TERVERIFIKASI (kondisional env) |
| **CFG-16** | **Sedang** | `followup-templates.ts:73-340`, `346-389`, `299-338` | Template follow-up memakai `getBrandIdentity()` sinkron (default) dan `Math.random()` saat `index` tidak diberikan; setelah render, teks dimutilasi regex (`Bunda Bunda`, `Bunda !`, `dek dek`, whitespace). Parameter `STAFF_OTW`/`ARRIVAL` memakai `any` karena interface tidak memuat `therapistName`/`clinicName`. | Brand tenant B salah; pemilihan varian tidak deterministik (test/flaky, sulit replay); cleanup regex bisa mengubah teks yang sah; type safety hilang. | Determinism, tenant awareness, type safety, minimal regex | Terima `brand`/`tenantId` di parameter; gunakan `getRollingVariant()` untuk variasi deterministik; hapus/scope regex cleanup; lengkapi interface. **Cost:** M. **Benefit:** follow-up konsisten dan dapat diuji. | M | H | TERVERIFIKASI |
| **CFG-17** | **Sedang** | `ai-models.config.ts:507-521`, `541-554` | `saveQueue` hanya menserialkan save **per proses**. App dan worker adalah proses terpisah; keduanya bisa menjalankan `deleteMany` + `createMany` secara bersamaan. | Salah satu proses bisa gagal unique violation dan melaporkan `persisted:false`, meskipun UI sudah menerapkan perubahan di memori. | Concurrency control, distributed consistency | Gunakan DB advisory lock per tenant atau upsert per task (tanpa delete-all), sehingga aman lintas proses. **Cost:** M. **Benefit:** save AI config tidak balapan app vs worker. | M | M | HIPOTESIS (tergantung apakah worker menulis config) |
| **CFG-18** | **Sedang** | `cost-calculator.ts:304`; `Dockerfile:50-51`; `scripts/sync-pricing.ts:29` | `kenari-pricing.snapshot.json` dibaca dari `dist/config` di produksi, tetapi tidak disalin ke image (runner hanya menyalin `dist` + `surabaya_sidoarjo_subdistricts.json`). `sync-pricing.ts` menulis ke `src/config`, bukan `dist`. | Produksi selalu memakai `KENARI_PRICING_LAST_KNOWN` hardcoded; update tarif dari script tidak pernah sampai ke runtime. Analitik biaya bisa salah. | Build reproducibility, data freshness, observability | Salin snapshot ke `dist/config` saat build, atau simpan tarif di DB/env dan baca dari sana; tambah health check `fetchedAt`. **Cost:** S. **Benefit:** biaya LLM akurat. | S | H | TERVERIFIKASI |
| **CFG-19** | **Rendah** | `settings.subroute.ts:1469` | `const oldConfig = AiModelConfigService.getModelConfig(upperTask as any);` tidak meneruskan `tenantId`, sehingga audit log `oldConfig` membaca config tenant default untuk perubahan tenant lain. | Audit trail perubahan model tenant B menampilkan nilai tenant default. | Audit integrity, tenant awareness | Teruskan `tenantId` ke `getModelConfig`. **Cost:** 1 baris. **Benefit:** audit akurat. | S | H | TERVERIFIKASI |
| **CFG-20** | **Rendah** | `feature-flags.ts:1-2`; `clinic.ts:1-2`; `ai-models.config.ts:9-10`; `brand.ts:85-92`; `clinic-location.ts:88-90`; `llm-context.ts` | `dotenv.config()` dipanggil berulang di module load; `setBrandIdentity`/`resetBrandIdentity`/`getClinicLocation` sinkron tidak dipakai; `llm-context.ts` tidak punya test khusus. | Duplikasi initialization, dead code, test gap kecil. | DRY, dead code, testability | Panggil dotenv sekali di entrypoint; hapus fungsi dead atau dokumentasikan sebagai API test; tambah test `LLM_HISTORY_LIMIT`. **Cost:** S. **Benefit:** boot path lebih jelas. | S | H | TERVERIFIKASI |

### Catatan severity
- **CFG-01** adalah satu-satunya temuan **Kritis** dan harus diperbaiki lebih dulu, terlepas dari prioritas lain.
- **CFG-02–CFG-07** adalah temuan **Tinggi** yang menyangkut keselamatan, tenant isolation, dan integritas perilaku AI.
- **CFG-08–CFG-18** adalah **Sedang**: dead code, duplikasi, cache, dan build packaging.
- **CFG-19–CFG-20** adalah kebersihan.

---

## C. BEFORE / AFTER KODE

### C-1. Gate medis — scope pengecualian, bukan mematikan semua keyword

**Before** (`src/config/medical-keywords.ts:153-167`):
```ts
const NON_MEDICAL_PHRASES: RegExp[] = [
  /\bstep\s+by\s+step\b/i,
];

const matchesKeyword = (keyword: string): boolean => {
  const kw = keyword.toLowerCase();
  if (NON_MEDICAL_PHRASES.some((re) => re.test(normalizedText))) {
    return false;
  }
  if (kw.length <= 6 && !/\s/.test(kw)) {
    return new RegExp(`(^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(normalizedText);
  }
  return normalizedText.includes(kw);
};
```

**After**:
```ts
const NON_MEDICAL_PHRASE_BY_KEYWORD = new Map<string, RegExp>([
  // Hanya frasa "step by step" yang menetralkan keyword "step" (kejang).
  // Jangan mematikan keyword lain seperti "kejang" / "sesak".
  ['step', /\bstep\s+by\s+step\b/i],
]);

const matchesKeyword = (keyword: string): boolean => {
  const kw = keyword.toLowerCase();
  const benign = NON_MEDICAL_PHRASE_BY_KEYWORD.get(kw);
  if (benign?.test(normalizedText)) return false;
  if (kw.length <= 6 && !/\s/.test(kw)) {
    return new RegExp(`(^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(normalizedText);
  }
  return normalizedText.includes(kw);
};
```
**Regression test wajib:**
```ts
expect(checkMedicalKeywords('step by step aja, tapi anak kejang').severity).toBe('HIGH');
expect(checkMedicalKeywords('anak step by step').severity).toBe('NONE');
```

---

### C-2. Brand tenant — inject hasil async, jangan andalkan global sinkron

**Before** (`src/config/persona.ts:247-252`, `src/v3/agent/pipeline/fast-response-gate.ts:258`):
```ts
firstContactGreetingHeader: (params?: { isIslamic?: boolean }) => {
  const greetingWord = params?.isIslamic ? 'Waalaikumsalam Bunda! ✨' : 'Halo Bunda! ✨';
  return `${greetingWord} Perkenalkan, saya ${getBrandIdentity().botDisplayName} dari ${getBrandIdentity().businessName} — layanan homecare treatment moms & baby ke rumah.`;
},
// caller
staticReply = TEMPLATES.greeting({ isIslamic });
```

**After**:
```ts
export interface TemplateBrand {
  botDisplayName: string;
  businessName: string;
}

firstContactGreetingHeader: (params?: { isIslamic?: boolean; brand?: TemplateBrand }) => {
  const brand = params?.brand ?? DEFAULT_BRAND_IDENTITY;
  const greetingWord = params?.isIslamic ? 'Waalaikumsalam Bunda! ✨' : 'Halo Bunda! ✨';
  return `${greetingWord} Perkenalkan, saya ${brand.botDisplayName} dari ${brand.businessName} — layanan homecare treatment moms & baby ke rumah.`;
},

// caller
const brand = await getBrandIdentityAsync(tenantId);
staticReply = TEMPLATES.greeting({ isIslamic, brand });
```
**Catatan:** cara yang sama berlaku untuk `followup-templates` dan `media.service` (watermark). Ini bukan abstraksi baru; hanya meneruskan data yang sudah disediakan `getBrandIdentityAsync`.

---

### C-3. Origin ongkir — pakai lokasi tenant, bukan `clinicConfig` global

**Before** (`src/v3/tools/calculate-delivery.tool.ts:619`):
```ts
deliveryService.calculateDelivery(
  { lat, lng },
  { lat: clinicConfig.lat, lng: clinicConfig.lng },
  tenantId
)
```

**After**:
```ts
const clinic = await getClinicLocationAsync(tenantId);
deliveryService.calculateDelivery(
  { lat, lng },
  { lat: clinic.lat, lng: clinic.lng },
  tenantId
)
```
**Also change** `src/services/delivery.service.ts:237` default parameter: jangan pakai `clinicConfig` sebagai default; wajibkan `clinicCoords` dari caller yang sudah tenant-aware, atau panggil `getClinicLocationAsync(tenantId)` di dalam method. `clinic.name` di baris 325 juga harus diganti `clinic.name` hasil async.

---

### C-4. Persona loader — per-tenant, tanpa global dan tanpa seed lintas tenant

**Before** (`src/config/persona.ts:166-190`):
```ts
export async function loadPersonaFromDb(tenantId: string): Promise<string> {
  try {
    const record = await prisma.tenantPersona.findUnique({ where: { tenant_id: tenantId } });
    if (record?.persona?.trim()) {
      BOT_PERSONA_PROMPT = record.persona; // global
      maxCharsByTenant.set(tenantId, record.max_chars_per_reply ?? null);
      return record.persona;
    }
    if (BOT_PERSONA_PROMPT?.trim()) {
      await prisma.tenantPersona.upsert({
        where: { tenant_id: tenantId },
        update: { persona: BOT_PERSONA_PROMPT },
        create: { tenant_id: tenantId, persona: BOT_PERSONA_PROMPT },
      });
    }
    return BOT_PERSONA_PROMPT;
  } catch (err) {
    return BOT_PERSONA_PROMPT;
  }
}
```

**After**:
```ts
const personaByTenant = new Map<string, string>();

export function getPersonaForTenant(tenantId: string): string {
  return personaByTenant.get(tenantId) ?? DEFAULT_PERSONA_PROMPT;
}

export async function loadPersonaFromDb(tenantId: string): Promise<string> {
  try {
    const record = await prisma.tenantPersona.findUnique({ where: { tenant_id: tenantId } });
    if (record?.persona?.trim()) {
      personaByTenant.set(tenantId, record.persona);
      maxCharsByTenant.set(tenantId, record.max_chars_per_reply ?? null);
      return record.persona;
    }
    // Jangan menulis saat read; jangan mewarisi persona tenant lain.
    personaByTenant.delete(tenantId);
    return DEFAULT_PERSONA_PROMPT;
  } catch (err) {
    return getPersonaForTenant(tenantId);
  }
}
```
**Catatan:** seed DB sebaiknya dilakukan sekali oleh migration/seed script, bukan di boot loop yang membaca identitas tenant lain.

---

### C-5. Jam operasional — satu parser, prioritaskan field terstruktur

**Before** (`src/config/operational-hours.ts:57-70` dan `src/config/staff-chat-config.ts:61-80`):
```ts
const match = String(policy.factual_summary).match(/(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})/);
if (match) {
  const s = parseInt(match[1], 10);
  const e = parseInt(match[3], 10);
  // ...
}
```

**After** — satu helper bersama:
```ts
// src/utils/time-range.ts
export function parseOperationalTimeRange(text: string): { startHour: number; endHour: number } | null {
  const m = text.match(/(\d{1,2})(?:[.:](\d{2}))?\s*(?:-|–|s\/d|sampai|hingga)\s*(\d{1,2})(?:[.:](\d{2}))?/i);
  if (!m) return null;
  const s = Number(m[1]);
  const e = Number(m[3]);
  if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e > 23 || s >= e) return null;
  return { startHour: s, endHour: e };
}
```
`operational-hours.ts` dan `staff-chat-config.ts` sama-sama memanggil helper ini; `Tenant.settings.operationalHours` tetap prioritas pertama. Tambah test untuk "08.00 - 17.00", "08.00 s/d 17.00", "8 pagi sampai 5 sore".

---

## D. KATALOG REUSE

| Nama | Lokasi | Fungsi | Pemakai |
|---|---|---|---|
| `DEFAULT_TENANT_ID` | `tenant.ts:1` | Konstanta tenant default | 321 file |
| `getBrandIdentity` / `getBrandIdentityAsync` / `DEFAULT_BRAND_IDENTITY` | `brand.ts:27-83` | Identitas brand global dan overlay `Tenant.settings.brand` per tenant | 34 file (prompt, pricelist, live chat, staff reservation, media) |
| `clinicConfig` | `clinic.ts:12-25` | Koordinat/nama/batas jarak/timeout dari env | 20 file (delivery, tools, conversation, scripts) |
| `getClinicLocation` / `getClinicLocationAsync` / `DEFAULT_CLINIC_LOCATION` | `clinic-location.ts:27-90` | Lokasi basecamp per tenant | `staff-reservation`, `admin/customers` (async); sync belum dipakai |
| `getCoverageCities` / `getInsideRegions` / `getOutsideCities` / `DEFAULT_COVERAGE` | `coverage.ts:37-54` | Daftar wilayah cakupan | `calculate-delivery.tool`, test coverage |
| `getOperationalHours` / `getWibHour` / `isOutsideOperationalHours` / `clearOperationalHoursCache` | `operational-hours.ts:35-99` | Jam operasional per tenant + badge di luar jam | 7 file (copilot, reservation, test) |
| `BOT_PERSONA_PROMPT` / `TEMPLATES` / `truncateToMaxChars` / `loadPersonaFromDb` / `savePersonaToDb` / `getMaxCharsPerReply` | `persona.ts:109-693` | Prompt legacy, 14 template aktif, helper truncation, CRUD persona | 50 file; `TEMPLATES` dipakai v3 tools, state machine, greeting service |
| `FOLLOWUP_ROLLING_TEMPLATES` / `getRollingFollowUpMessage` / `getRollingVariant` / `getWibDateKey` | `followup-templates.ts:73-408` | Engine template follow-up berotasi | `follow-up.service`, `staff-reservation.service` |
| `HIGH_SEVERITY_MEDICAL_KEYWORDS` / `MEDIUM_SEVERITY_MEDICAL_KEYWORDS` / `EMERGENCY_SYMPTOM_PATTERNS` / `checkMedicalKeywords` / `detectDoseInquiryConcern` / `detectNeonatalFeverEmergency` / `detectPersistentCoughRashEmergency` | `medical-keywords.ts:7-420` | Gate medis deterministik | `medical-detection.service`, `medical-signal-detector`, `treatment-catalog.service` |
| `POPULAR_LANDMARKS` / `findPopularLandmark` / `ARTERY_CORRIDORS` / `resolveArteryCorridor` | `landmarks.ts:17-800` | Resolve landmark/arteri ke kelurahan/kecamatan | `tool-masker`, `geocoding`, `gazetteer`, `staff-trip-tracking` |
| `SUMOPOD_*` / `KENARI_*` / `DEEPSEEK_DIRECT_*` / `SUMOPOD_CATALOG` / `KENARI_CATALOG` / `sanitizeModelForProvider` / `AiModelConfigService` / `AI_PRESET_PROFILES` / `supportsThinkingParam` | `ai-models.config.ts:30-710` | Registry model per task/tenant, sanitasi model, preset, status bot | 38 file (LLM gateway, admin settings, daily report, test) |
| `AiEligibilityConfig` / `AiEligibilityConfigService` | `ai-eligibility-config.ts:15-137` | Scope AI per tenant, fail-closed | `ai-scope-gate`, admin, webhook test |
| `parseCopilotAllowlist` / `isCopilotTenantAllowed` / `COPILOT_DEPRECATED_ERROR` | `copilot-tenant.ts:20-48` | Gerbang single-tenant Copilot | `copilot.service`, `copilot.subroute`, `auth.subroute` |
| `getStaffNotificationConfig` / `clearStaffNotificationConfigCache` | `staff-notification-config.ts:28-62` | Kanal notifikasi staf per tenant | `staff-notification`, test |
| `getStaffChatWindowConfig` / `clearStaffChatWindowConfigCache` | `staff-chat-window-config.ts:41-78` | Jendela chat terapis per jadwal | `inbound-notification-router`, `staff-reservation` |
| `getStaffChatNotificationConfig` / `isWithinWibHourRange` / `clearStaffChatConfigCache` | `staff-chat-config.ts:28-122` | Jam notifikasi chat staf | `inbound-notification-router` |
| `sanitizePricelistPromoConfig` / `getPricelistPromoConfigAsync` / `DISABLED_PRICELIST_PROMO` | `pricelist-promo.ts:31-137` | Promo landing page per tenant | `pricelist.service`, `settings.subroute` |
| `isToolMaskingShadowMode` / `isToolMaskingEnforced` | `feature-flags.ts:9-20` | Flag tool masking | `generation-stage`, test |
| `LLM_HISTORY_LIMIT` | `llm-context.ts:8` | Jumlah riwayat chat ke LLM | `state-machine` |
| `persona_custom.txt` | `src/config/persona_custom.txt` | Prompt persona dev (tidak ikut image) | `persona.ts` module load |
| `kenari-pricing.snapshot.json` | `src/config/kenari-pricing.snapshot.json` | Snapshot tarif Kenari | `cost-calculator` (dev), `sync-pricing` |
| `surabaya_sidoarjo_subdistricts.json` | `src/config/surabaya_sidoarjo_subdistricts.json` | 560 record wilayah + koordinat | `gazetteer`, `gazetteer-zipcode-resolver` |

---

## E. LOGIKA YANG DITULIS SENDIRI (BERPOTENSI DUPLIKAT)

| Logika generik | Lokasi di modul ini | Duplikat/kandidat di tempat lain | Catatan |
|---|---|---|---|
| Konversi WIB (jam, date key, rentang jam) | `operational-hours.ts:80-83`; `staff-chat-config.ts:93-111`; `followup-templates.ts:392-397` | `utils/time-wib.ts:24-52` | Empat implementasi; satukan. |
| Parsing rentang jam dari teks | `operational-hours.ts:62`; `staff-chat-config.ts:68` | Tidak ada util bersama | Regex identik; fragility yang sama. |
| Resolusi brand | `brand.ts:36-38` (sync), `46-83` (async) | `media.service.ts:32,57`; `persona.ts`; `followup-templates.ts`; `clinic-faq.tool.ts:87` | Jalur sync dan async bisa berbeda hasil. |
| Prompt default persona | `persona.ts:16-98` | `services/tenant-prompt-config.service.ts:137-150` (default config kanonis) | Dua sumber teks prompt; `persona.ts` legacy. |
| Template follow-up | `persona.ts:593-692` (dead) | `followup-templates.ts:73-340` (aktif) | Duplikasi ±100 baris; hanya satu yang dikirim. |
| Template salam/greeting | `persona.ts:247-267` | `services/greeting-template.service.ts` (DB first, fallback TEMPLATES) | Fallback memakai brand sync default. |
| Daftar wilayah cakupan | `coverage.ts:24-35` | `persona.ts:476` (dead), `clinic-faq.tool.ts:125` (fallback), `landmarks.ts`/`subdistricts.json` | Gresik ada di coverage, tidak di template. |
| Origin klinik | `clinic.ts:14-15`; `clinic-location.ts:27-32` | `delivery.service.ts:237`; `calculate-delivery.tool.ts:619,864`; `persona.ts:387,479` | Tiga sumber: env global, async tenant, template hardcoded. |
| Kebijakan pembayaran | `persona.ts:470` | `clinic-faq.tool.ts:101`; `ClinicPolicy` DB | Tiga versi: BCA/Mandiri, BCA/Mandiri/BRI, DB. |
| Jam operasional default | `operational-hours.ts:19-23` (8–17) | `clinic-faq.tool.ts:133` (8–17); `staff-chat-config.ts:10-14` (7–21, konteks berbeda) | Dua default 8–17; pastikan satu sumber. |
| Katalog model | `ai-models.config.ts:30-63`, `158-249`, `263-299`, `691-693` | `utils/cost-calculator.ts:341+` (nama model + tarif) | Nama model berulang; perubahan bisa tidak sinkron. |
| Sanitasi model per provider | `ai-models.config.ts:83-149` | `llm-gateway.ts:41` (sanitasi ulang) | Dua lapis sanitasi; hasil akhir bisa berbeda dari task config. |
| Truncation teks | `persona.ts:125-151` | `v3/guardrails/sanitizer.ts` (max chars) | `truncateToMaxChars` adalah util generik yang tempatnya di `utils`, bukan config. |
| Deteksi medis | `medical-keywords.ts:140-420` | `v3/agent/pipeline/medical-signal-detector.ts` (memanggil config + logika tambahan) | Bukan duplikasi penuh, tetapi dua lapis harus dijaga konsisten. |

---

## F. FILE DI MODUL INI YANG BELUM DIBACA

**File TypeScript:** tidak ada. Seluruh 19 file `.ts` di `src/config` sudah dibaca penuh.

**File non-TypeScript:**
- `persona_custom.txt` (68 baris) — dibaca penuh.
- `kenari-pricing.snapshot.json` (58 baris) — dibaca penuh.
- `surabaya_sidoarjo_subdistricts.json` (3.922 baris) — **tidak dibaca baris-per-baris**. Yang diverifikasi: struktur array 560 record, 25 baris awal, 10 baris akhir, dan contoh record `{Kabupaten_Kota, Kecamatan, Kelurahan_Desa, Kode_Pos, Koordinat}`. Ini data, bukan kode; audit kode tidak memerlukan pembacaan seluruh payload.

**Dependensi luar modul yang dibaca sebagian (bukan klaim audit penuh):**
`src/v3/tools/clinic-faq.tool.ts` (bagian fallback + execute), `src/v3/tools/calculate-delivery.tool.ts` (bagian origin/template), `src/services/delivery.service.ts` (bagian origin/pesan), `src/services/conversation.service.ts` (timeout), `src/services/media.service.ts` (brand watermark), `src/services/tenant-prompt-config.service.ts` (default config), `src/integrations/llm/llm-gateway.ts` (penuh), `src/integrations/llm/model-fallback.ts` (penuh), `src/app.ts`/`src/worker.ts` (boot tenant loop), `src/routes/admin/settings.subroute.ts` (bagian AI config + brand/promo), `src/state-machine/machine.ts` (brand async).

---

## G. PENYIMPANAN HASIL

Laporan ini disimpan di:

`docs/MODULE_AUDIT_02_CONFIG.md`

Tidak ada file source yang diubah selama audit.

---

## LAMPIRAN 1 — FAN-IN & TEST COVERAGE

| Config | Importers (`src` + tests) | Test khusus |
|---|---:|---|
| `tenant.ts` | 321 | tidak perlu (konstanta) |
| `persona.ts` | 50 | 15 file test (persona, greeting, sanitizer, template quality) |
| `ai-models.config.ts` | 38 | 11 file test (tenant, settings, provider alignment, call1/call2) |
| `brand.ts` | 34 | 6 file test (pricelist, watermark, tenant resilience, dynamic router) |
| `clinic.ts` | 20 | 5 file test (delivery, clinic location) |
| `followup-templates.ts` | 16 | 7 file test (engine, maternal, treatment, variant, winback) |
| `medical-keywords.ts` | 15 | 4 file test (dose, RF06, neonatal, cough-rash) |
| `ai-eligibility-config.ts` | 13 | 6 file test (scope gate, rollout admin) |
| `landmarks.ts` | 10 | 2 file test (artery, cluster geocoding) |
| `coverage.ts` | 7 | 2 file test |
| `operational-hours.ts` | 7 | 3 file test |
| `pricelist-promo.ts` | 6 | 3 file test |
| `clinic-location.ts` | 6 | 2 file test |
| `copilot-tenant.ts` | 5 | 1 file test |
| `staff-chat-config.ts` | 4 | 3 file test |
| `staff-chat-window-config.ts` | 4 | 1 file test |
| `staff-notification-config.ts` | 8 | 5 file test |
| `llm-context.ts` | 4 | **tidak ada test khusus** |
| `feature-flags.ts` | 3 | 1 file test |

**Catatan:** test `persona-canonical-source.test.ts` membuktikan `TenantPromptConfigService` adalah sumber kanonis; test ini **tidak** menangkap drift `persona_custom.txt` di produksi karena mem-mock `fs.writeFileSync` dan tidak memeriksa isi `dist`. Test `medical-keywords` tidak memiliki kasus "step by step + kejang", sehingga CFG-01 lolos.

---

## LAMPIRAN 2 — DAFTAR 33 TEMPLATE `persona.ts` YANG TIDAK DIPAKAI RUNTIME

`warmReopenGreeting` (272-279), `askKelurahanDetail` (281), `greetingWithLocation` (283-290), `askClarifyMixedSignal` (295-296), `confirmLocationFailedRetry` (298-299), `locationComparison` (374-388), `scheduleCheckHandoff` (390-397), `humanAgentRequest` (399-400), `rescheduleOrCancel` (402-403), `unlistedServiceHandoff` (405-406), `locationEscalation` (408), `priceCta` (411), `pricelistPrompt` (434), `pricelistIntro` (435), `promoOngoingInfo` (436-437), `askLocationFirstPrice` (441), `askLocationShort` (444), `faqFollowUp` (446-456), `interestUnrelatedFollowUp` (458), `ongkirInclusionPolicy` (462-467), `coverageAreaPolicy` (475-476), `clinicOriginPolicy` (478-479), `notInterestedReply` (481), `reservationFormRequest` (483-533), `reservationConfirmed` (535-581), `morningReminder` (583-591), `followUpReviewBaby` (593-609), `followUpReviewMoms` (611-620), `nextTreatmentFollowUp` (622-636), `paymentFollowUp` (638-643), `followUpNoPurchaseDay3` (647-661), `followUpNoPurchaseDay7` (663-677), `followUpNoPurchaseDay14` (679-692).

**Yang aktif (14):** `askDomicileNeutral`, `firstContactGreetingHeader`, `greeting`, `askShareLocation`, `priceInfo`, `therapistQualificationPolicy`, `paymentMethodPolicy`, `multiChildTransportPolicy`, `outOfCoverage`, `ongkirInfo`, `inCoverageNoFee`, `confirmFuzzyLocation`, `askKelurahanAmbiguous`, `askKelurahanRetry`.

**Catatan:** beberapa key yang tidak dipakai runtime masih dipakai test (`reservationConfirmed`, `reservationFormRequest`, `coverageAreaPolicy`). Itu berarti test menjaga dead code; putuskan apakah template akan dihidupkan kembali atau dihapus beserta test-nya.

---

## LAMPIRAN 3 — BUKTI PACKAGING

`dist/config/` hanya berisi file `.js` (hasil `tsc`); tidak ada `persona_custom.txt` maupun `kenari-pricing.snapshot.json`.

`Dockerfile` runner (baris 50-51) hanya menyalin:
```dockerfile
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/config/surabaya_sidoarjo_subdistricts.json ./src/config/surabaya_sidoarjo_subdistricts.json
```
Karena `persona.ts` membaca `path.join(__dirname, 'persona_custom.txt')` dan `cost-calculator.ts` membaca `path.resolve(__dirname, '../config/kenari-pricing.snapshot.json')`, di produksi (`dist/config`) kedua file tidak ditemukan:
- `persona.ts` → `DEFAULT_PERSONA_PROMPT`.
- `cost-calculator.ts` → `KENARI_PRICING_LAST_KNOWN`.

---

## LAMPIRAN 4 — REKOMENDASI URUTAN PERBAIKAN (TANPA EKSEKUSI)

| Urutan | Temuan | Alasan | Gate regresi |
|---:|---|---|---|
| 1 | CFG-01 | False negative medis; risiko pasien | Test "step by step + kejang" + full unit medical |
| 2 | CFG-04, CFG-05 | Tenant brand/lokasi salah di jalur customer-facing | Test dua tenant (brand & origin) |
| 3 | CFG-02, CFG-03, CFG-18 | Prod/dev drift, cross-tenant persona, biaya | Build check + test boot dua tenant |
| 4 | CFG-06, CFG-07 | Hardcode klinis/bisnis; butuh migrasi DB | Migrasi + seed + test policy |
| 5 | CFG-08, CFG-09, CFG-10, CFG-11 | Dead code & duplikasi | `npm run build` + full suite |
| 6 | CFG-12–CFG-17, CFG-19–CFG-20 | Kebersihan & efisiensi | Full suite |

**Catatan:** rekomendasi di atas belum dieksekusi. Sesuai instruksi, audit berhenti di sini dan menunggu perintah modul berikutnya.
