# AUDIT MODUL 3 DARI 16 — SHARED UTILS / HELPERS

**Modul:** `src/utils/*` (63 file TypeScript)
**Commit:** `c8ce5b21` (`master`), working tree bersih
**Tanggal audit:** 2026-11-07
**Sifat:** read-only. Tidak ada file source yang diubah.
**Metode:** baca seluruh 63 file TypeScript, lacak pemakai via `rg`, dan uji langsung fungsi berisiko dengan `tsx` (date parser, regex stateful, media extension, peak-hour, SSE, TZ).

---

## CAKUPAN YANG SUDAH DIBACA

**Seluruh 63 file `.ts` di `src/utils` sudah dibaca penuh (10.713 baris).** Tidak ada file modul ini yang belum dibaca.

| Submodul | File | Baris | Isi |
|---|---:|---:|---|
| 3A — Security, auth, PII | 12 | 1.224 | `auth`, `bcrypt`, `encryption`, `destructive-guard`, `client-idempotency`, `auth-access-log`, `logger-sanitizer`, `staff-signature`, `pii-masker`, `prompt-injection-sanitizer`, `customer-bypass`, `dummy-filter` |
| 3B — Identity, teks, format | 10 | 1.545 | `phone-normalizer`, `jid`, `name-sanitizer`, `customer-name-healing`, `language-sanitizer`, `canonical-message-normalizer`, `whatsapp-format`, `typo-match`, `similarity`, `text-chunker` |
| 3C — Waktu, tanggal, usia | 7 | 1.295 | `time-wib`, `wib-time`, `indonesian-date-parser`, `date-confirmation`, `age-calculator`, `temporal-grounding`, `timer` |
| 3D — Geo, lokasi, alamat | 13 | 2.168 | `haversine`, `gazetteer`, `gazetteer-zipcode-resolver`, `google-maps-url-resolver`, `location-classifier`, `location-drift`, `open-location-code`, `pin-coordinates`, `reservation-address`, `toponym-normalizer`, `kelurahan-guard`, `wilayah-normalizer`, `waha-location-parser` |
| 3E — Parser transaksi | 6 | 2.081 | `reservation-text-parser`, `conversation-transaction-extractor`, `admin-chat-distance-parser`, `followup-placeholder`, `treatment-category`, `lead-greeting-detector` |
| 3F — Observability & biaya | 7 | 1.839 | `context`, `log-buffer`, `llm-audit-buffer`, `llm-execution-logger`, `stage-logger`, `cost-calculator`, `circuit-breaker` |
| 3G — Misc | 8 | 561 | `backup-file`, `env-numeric`, `json-extract`, `media-kind`, `message-cursor`, `money-contract`, `prisma-errors`, `sse-sequence` |
| **Total** | **63** | **10.713** | **100% dibaca** |

**Dependensi yang dibaca sebagian (untuk memahami perilaku, bukan modul ini):**
`src/services/capi.service.ts:41-47` (`normalizePhoneToE164`), `src/services/human-background-enrichment.service.ts:323-325` (pemanggil resolver URL), `src/services/location-resolver.service.ts:34-60`, `src/v3/tools/calculate-delivery.tool.ts:519-527`, `src/services/reservation-lifecycle.service.ts:129-143`, `src/app.ts:14-30` dan `src/worker.ts:19-23` (urutan console wrapper), `src/config/*` (brand/clinic/persona).

**Verifikasi runtime yang dilakukan (bukan klaim statis):**
- `parseIndonesianDate('besok')` dan `parseIndonesianDate('tanpa tanggal')` → `2026-07-01T02:00:00.000Z`.
- `containsForeignScripts('你好')` tiga kali → `true, true, false`.
- `resolveExtForSave('image/avif')` → `jpg`; `image/heic` → `jpg`.
- `isDeepSeekPeakHour(Sabtu 02:00 UTC)` → `true`.
- `createMonotonicSseSequencer(100).peek()` → `100` (bukan `null`).
- `tryParseIndonesianDate('senin 5 oktober 2026 jam 00.30')` dengan `TZ=UTC` → `2026-10-05T17:30:00.000Z` (Selasa 00:30 WIB, bukan Senin).
- `normalizeWahaJid('628123456789:12@s.whatsapp.net')` → `62812345678912`.
- `extractWahaLocation({ type:'location', location:{ latitude:-7.3 } })` → `hasRealLocation:true`, `rawLng:NaN`.

---

## A. RINGKASAN MODUL + SKOR KESEHATAN

`src/utils` adalah kumpulan 63 helper dengan fan-in tinggi dan campuran kualitas yang lebar. Sebagian besar adalah fungsi murni yang teruji baik: `json-extract`, `message-cursor`, `money-contract`, `similarity`, `prisma-errors`, `treatment-category`, `env-numeric`, `auth`, `staff-signature`. Namun modul ini juga menyimpan beberapa risiko serius: parser tanggal transaksi yang mengembalikan **1 Juli tahun berjalan** untuk input tanpa tanggal, empat parser tanggal Indonesia yang saling berbeda, bug zona waktu pada parser reservasi untuk jam 00:00–06:59 WIB, SSRF pada resolver Google Maps, dan regex global stateful di `language-sanitizer`. Di sisi arsitektur, ada God module `reservation-text-parser.ts` (1.148 baris), duplikasi Haversine/WIB/phone normalization, serta dead index di `gazetteer.ts`. Di sisi privasi, log buffer hanya menyensor nomor telepon, sementara `llm-execution-logger` menyimpan `promptPayload` dan `finalReply` penuh ke JSONL. Test coverage cukup luas, tetapi lima util tidak punya test khusus.

**Skor kesehatan: 2.5 / 5 (cukup untuk helper murni, tetapi belum aman untuk dipakai sebagai fondasi lintas modul tanpa perbaikan).**

Alasan skor:
- **+** Banyak helper murni, deterministik, dan sudah punya test (58 dari 63 file punya test yang menyebut modulnya).
- **+** `json-extract`, `message-cursor`, `money-contract`, `similarity`, `treatment-category`, `prisma-errors` kecil dan jelas tanggung jawabnya.
- **−** Satu bug Kritis (tanggal default) dan satu bug Tinggi (TZ parser reservasi) yang bisa mengubah jadwal.
- **−** SSRF pada resolver URL yang menerima input customer.
- **−** Empat parser tanggal dan dua implementasi WIB/Haversine/phone normalization.
- **−** God module 1.148 baris dan dead code di gazetteer.
- **−** PII/secret tidak disensor menyeluruh di log.

---

## B. TABEL TEMUAN

**Severity:** Kritis / Tinggi / Sedang / Rendah.
**Status:** TERVERIFIKASI = dibaca/diuji langsung; HIPOTESIS = perlu uji runtime/DB.

| ID | Severity | file:baris | Masalah | Dampak | Prinsip/standar yang dilanggar | Rekomendasi spesifik + cost-benefit | Effort | Keyakinan | Status |
|---|---|---|---|---|---|---|---|---|---|
| **UTL-01** | **Kritis** | `conversation-transaction-extractor.ts:208-293` | `parseIndonesianDate()` memakai default `day=1`, `month=6` (Juli), `year=current` dan tetap membangun `Date` walau tidak ada komponen tanggal yang cocok. `parseIndonesianDate('besok')` dan `('tanpa tanggal')` → `2026-07-01T02:00:00.000Z`. | Tanggal booking pada ekstraksi transkrip/backfill bisa salah total (1 Juli), bukan `null`. Data transaksi/histori menjadi korup. | Correctness, fail-closed, data integrity | Kembalikan `null` bila tidak ada `numericMatch`/`textMatch` yang valid; jangan memakai default tanggal. Reuse parser kanonis. **Cost:** S. **Benefit:** menghilangkan tanggal fiktif. | S | H | TERVERIFIKASI (diuji runtime) |
| **UTL-02** | **Tinggi** | `indonesian-date-parser.ts:61-143`; `reservation-text-parser.ts:795-958`; `conversation-transaction-extractor.ts:208-293`; `date-confirmation.ts:386-399` | Ada empat parser/peta tanggal Indonesia yang berbeda: `parseIndonesianDate`, `tryParseIndonesianDate`, `parseIndonesianDate` (extractor), dan `MONTH_INDEX`/`DAY_NAME` di `date-confirmation`. `reservation-text-parser` memakai `candidate.getDay()` (TZ server) untuk reconcile nama hari; dengan `TZ=UTC`, "senin 5 oktober 2026 jam 00.30" menjadi Selasa 00:30 WIB. | Input yang sama dapat menghasilkan tanggal berbeda antar jalur; booking dini hari bisa bergeser satu hari. | Single source of truth, timezone correctness, determinism | Jadikan `indonesian-date-parser` satu-satunya parser tanggal; `applyBookingTimeToDate` untuk jam; semua cek hari memakai helper WIB (`getWibNow`/`getUTCDay`). **Cost:** L. **Benefit:** satu perilaku tanggal di seluruh sistem. | L | H | TERVERIFIKASI (diuji runtime untuk TZ) |
| **UTL-03** | **Tinggi** | `reservation-text-parser.ts:1-1148` | Satu file 1.148 baris menangani form parsing, conversational parsing, parsing tanggal, baby details, notes, dan payment (`parsePaymentSection` diimpor). Banyak label/fallback treatment hardcoded (mis. `1053`). | Perubahan kecil menyentuh file besar; sulit dites per tanggung jawab; risiko shotgun surgery. | Single Responsibility, modularity, testability | Pecah menjadi `reservation-form-parser`, `conversational-reservation-parser`, `baby-detail-parser`, `reservation-notes`; reuse `indonesian-date-parser` dan `parsePaymentSection`. **Cost:** L. **Benefit:** modul kecil yang bisa dites dan diubah terisolasi. | L | H | TERVERIFIKASI |
| **UTL-04** | **Tinggi** | `google-maps-url-resolver.ts:255-329`; `human-background-enrichment.service.ts:323-325` | `resolveGoogleMapsUrl()` memanggil `axios.get(cleanUrl)` tanpa allowlist host. `human-background-enrichment` meneruskan `incomingText` mentah dari customer, bukan hasil `extractGoogleMapsUrls()`. Redirect diikuti hingga 5 tanpa validasi host akhir. | SSRF: customer dapat memancing server mengambil URL internal/cloud metadata (`169.254.169.254`, service internal). | Security, SSRF prevention, least privilege | Validasi host awal dan host akhir terhadap allowlist Google Maps (`maps.app.goo.gl`, `goo.gl`, `share.google`, `*.google.com/maps`); hanya resolve URL hasil ekstraksi. **Cost:** S–M. **Benefit:** menutup vektor SSRF dari input publik. | S–M | H | TERVERIFIKASI |
| **UTL-05** | **Tinggi** | `language-sanitizer.ts:23-42` | `FOREIGN_SCRIPT_RE` memakai flag `g`, lalu `containsForeignScripts()` memanggil `.test()`. Regex global menyimpan `lastIndex`, sehingga pemanggilan berulang memberi hasil tidak konsisten: `true, true, false` untuk teks yang sama. | Deteksi aksara asing bisa false negative/positive tergantung urutan panggilan; log dan gate tidak deterministik. | Determinism, correctness, regex hygiene | Hilangkan flag `g` dari regex yang dipakai `.test()`, atau reset `lastIndex = 0` sebelum test, atau buat regex non-global terpisah. **Cost:** S. **Benefit:** hasil stabil. | S | H | TERVERIFIKASI (diuji runtime) |
| **UTL-06** | **Tinggi** | `date-confirmation.ts:170-185`; `lead-greeting-detector.ts:18-34`; `reservation-text-parser.ts:91-136` | Gate intent memakai daftar frasa literal panjang: 18 varian "mau yang itu"/"boleh deh yang itu" di `hasBookingCommitSignal`, regex `GREETINGS`/`INQUIRY_ACTIONS` raksasa di lead detector, dan header form literal di reservation parser. | Melanggar mandat anti-overfitting; parafrasa baru mudah lolos; setiap varian baru menambah baris. | Anti-overfitting, data-driven, maintainability | Pertahankan kelas token/deiksis yang sudah ada (`hasDeixisCommit`) dan perluas secara gramatikal; pindahkan leksikon domain ke data/DB; tambah test parafrase adversarial. **Cost:** M–L. **Benefit:** gate lebih tahan variasi bahasa. | M–L | H | TERVERIFIKASI |
| **UTL-07** | **Sedang** | `media-kind.ts:116-167` | Komentar menyatakan default aman `'bin'` dan "DILARANG default jpg", tetapi `resolveExtForSave()` mengembalikan `jpg` untuk semua `image/*` yang tidak dikenal. `image/avif`/`image/heic` → `.jpg` (dibuktikan). | File AVIF/HEIC disimpan dengan ekstensi jpg dan byte bukan JPEG; gambar rusak / MIME salah. | Correctness, fail-safe, security | Deteksi magic AVIF/HEIC (`ftyp` brand) atau kembalikan `bin`; selaraskan komentar. **Cost:** S. **Benefit:** tidak ada file dengan ekstensi palsu. | S | H | TERVERIFIKASI (diuji runtime) |
| **UTL-08** | **Sedang** | `cost-calculator.ts:380-388` | `isDeepSeekPeakHour()` mengembalikan true untuk 00:30–12:30 UTC **setiap hari**, sedangkan komentar menyebut peak 01:00–04:00 & 06:00–10:00 UTC **Senin–Jumat**. Sabtu 02:00 UTC → `true`. | Biaya LLM akhir pekan/di luar window dihitung peak (overestimate); laporan biaya tidak akurat. | Correctness, financial accuracy | Implementasikan window + weekday sesuai dokumentasi; tambah test Sabtu/Minggu. **Cost:** S. **Benefit:** biaya sesuai tarif provider. | S | H | TERVERIFIKASI (diuji runtime) |
| **UTL-09** | **Sedang** | `gazetteer.ts:406-411`, `427-492`, `174-175`, `43-45`, `730-732` | `boundedMatchIndex()` membuat `new RegExp` untuk setiap baris × kecamatan/kelurahan pada setiap query (hingga ±1.120 regex). `sortedByKelLengthDesc`, `sortedByKecLengthDesc`, dan `coordByKelKecKey` hanya di-assign/reset, tidak pernah dipakai. | Query lokasi yang tidak exact menjadi mahal; init menyimpan data mati. | Efficiency, dead code, index usability | Precompile regex/index saat init; hapus struktur mati atau pakai untuk scan. **Cost:** M (perf) / S (dead). **Benefit:** latency lokasi turun dan memori init lebih kecil. | M | H | TERVERIFIKASI |
| **UTL-10** | **Sedang** | `name-sanitizer.ts:121-125`, `205-241` | `getEffectiveDistrictLexicon()` membangun `Set` + `sort` setiap panggilan; `stripLocationNoise`/`stripTrailingLocationTag` mengompilasi `new RegExp` per distrik per iterasi. Name sanitization dipanggil di jalur pesan/nama. | CPU berulang di hot path; latency naik seiring ukuran leksikon. | Efficiency, caching | Cache leksikon + regex precompiled; invalidasi saat `setNameSanitizerDistrictLexicon`. **Cost:** M. **Benefit:** sanitasi nama lebih murah dan deterministik. | M | H | TERVERIFIKASI |
| **UTL-11** | **Sedang** | `wib-time.ts:9-55`; `time-wib.ts:24-52` | Dua modul WIB paralel dengan fungsi tumpang tindih (`getWibNow` vs `getWibTimeInfo`, `wibDayBoundsUtc` vs `wibDayRangeToUtc`, `formatWibDateYYYYMMDD`). Modul lain (config) juga punya implementasi sendiri. | Perbedaan edge case dan duplikasi test; perubahan aturan WIB harus diedit di banyak tempat. | DRY, single source, consistency | Satukan di satu `time-wib.ts`; re-export nama lama agar migrasi bertahap. **Cost:** S–M. **Benefit:** satu implementasi WIB. | S–M | H | TERVERIFIKASI |
| **UTL-12** | **Sedang** | `prompt-injection-sanitizer.ts:54-66`, `74-77` | `INSTRUCTION_PATTERNS` hanya menambahkan label ke `blockedPatterns`; teks "ignore previous instructions" tidak dihapus/dinetralkan. `wrapCustomerMessage()` membuang `blockedPatterns` dan hanya memakai `clean`. | Deteksi tanpa penegakan: instruksi injeksi tetap sampai ke LLM. | Defense in depth, prompt safety | Netralkan frasa yang match (ganti dengan penanda) atau blokir turn; teruskan `blockedPatterns` ke caller untuk logging/gate. **Cost:** S–M. **Benefit:** sanitizer benar-benar mencegah, bukan hanya mencatat. | S–M | H | TERVERIFIKASI |
| **UTL-13** | **Sedang** | `log-buffer.ts:90-93`; `llm-execution-logger.ts:214-219`; `logger-sanitizer.ts:15-38` | `log-buffer` hanya menyensor nomor telepon dalam string; object payload tidak melewati `sanitizeLogPayload`. `llm-execution-logger` menyimpan `promptPayload` dan `finalReply` penuh ke JSONL (hanya phone/nama yang di-mask). `sanitizeLogPayload` tidak meredaksi nama/alamat/email meski doc menyebutnya. | PII dan rahasia (API key/token di prompt/payload) dapat tersimpan di log/JSONL. | Privacy, secret hygiene, observability | Jalankan `sanitizeLogPayload` pada object; redaksi key `name/address/email/token/secret`; sanitasi `promptPayload` sebelum persist. **Cost:** M. **Benefit:** log aman dibagikan/diarsipkan. | M | H | TERVERIFIKASI |
| **UTL-14** | **Sedang** | `log-buffer.ts:169-241`; `llm-execution-logger.ts:238-296` | `rehydrateLogBuffer`/`rehydrateLlmBuffer` membaca **seluruh** file log dengan `readFile` lalu mengambil 500 baris terakhir. File `logs/` di repo mencapai puluhan MB. | Memory spike dan boot lambat saat file besar. | Efficiency, startup performance | Baca tail berbasis byte/stream (mis. `fs.createReadStream` dari offset akhir) atau rotasi lebih agresif. **Cost:** M. **Benefit:** boot cepat dan memory stabil. | M | H | TERVERIFIKASI |
| **UTL-15** | **Sedang** | `client-idempotency.ts:20-74` | Store idempotensi `clientTempId` hanya `Map` in-memory per proses. App dan worker (atau beberapa replika) tidak berbagi. | Retry "Coba Kirim Lagi" setelah timeout dapat menggandakan bubble jika request jatuh ke proses lain. | Distributed idempotency, correctness | Gunakan Redis/DB dengan TTL dan kunci `tenant:clientTempId`; fallback memory hanya untuk test. **Cost:** M. **Benefit:** idempotensi lintas proses. | M | H | TERVERIFIKASI |
| **UTL-16** | **Sedang** | `llm-audit-buffer.ts:130-179` | `flushLlmAuditBuffer()` melakukan `buffer.splice(0)` sebelum insert DB; jika insert gagal, record hilang. `timerId` tidak `.unref()`. | Audit LLM hilang saat DB down; proses shutdown bisa tertahan timer 10 detik. | Reliability, observability | Requeue chunk saat gagal; `.unref()` timer; batasi retry. **Cost:** S. **Benefit:** audit tidak hilang dan shutdown bersih. | S | H | TERVERIFIKASI |
| **UTL-17** | **Sedang** | `gazetteer-zipcode-resolver.ts:32-36`, `141-158`, `199-210` | `kelToZip` menyimpan kemunculan pertama untuk nama kelurahan yang duplikat lintas kota; fallback `kelDirect` dapat mengembalikan kode pos kota yang salah. `kecamatanSet` diisi tetapi tidak dipakai. | Kode pos salah untuk nama kelurahan homonim; data mati. | Correctness, data integrity | Wajibkan kombinasi kelurahan+kecamatan/kota; hapus `kecamatanSet`. **Cost:** S–M. **Benefit:** kode pos akurat. | S–M | M | TERVERIFIKASI |
| **UTL-18** | **Rendah** | `sse-sequence.ts:21-31` | `peek()` mengembalikan `String(current)` (seed) sebelum `next()` dipanggil, padahal interface menjanjikan `null` bila belum ada. | Klien SSE mengira sudah ada event/ID sebelum event pertama; gap detection bisa salah. | Contract honesty, correctness | Kembalikan `null` sampai `next()` pertama; tambah test. **Cost:** S. **Benefit:** kontrak sesuai. | S | H | TERVERIFIKASI (diuji runtime) |
| **UTL-19** | **Rendah** | `waha-location-parser.ts:55-78`; `jid.ts:23-33` | `hasRealLocation` true bila latitude valid tetapi longitude NaN; tidak ada validasi range (-90..90/-180..180). `normalizeWahaJid('628...:12@s.whatsapp.net')` menggabungkan suffix device `:12` menjadi `628...12`. | Koordinat NaN/out-of-range dapat tersimpan; nomor telepon salah untuk JID ber-device. | Validation, data integrity | Wajibkan kedua koordinat finite + range; strip `:\d+` sebelum digit. **Cost:** S. **Benefit:** data lokasi/phone bersih. | S | H | TERVERIFIKASI (diuji runtime) |
| **UTL-20** | **Rendah** | `text-chunker.ts:5-9` | Parameter `minChunkSize` diterima tetapi tidak pernah dipakai; chunk bisa jauh di bawah 400 karakter. | API menyesatkan; chunk RAG terlalu kecil/tidak seimbang. | Contract honesty, RAG quality | Gabungkan chunk kecil atau hapus parameter. **Cost:** S. **Benefit:** chunk sesuai kontrak. | S | H | TERVERIFIKASI |
| **UTL-21** | **Rendah** | `backup-file.ts:48-59` | `isValidGzipHeader()` membuka file lalu `readSync`/`closeSync` tanpa `finally`; jika `readSync` throw, file descriptor tidak ditutup. | FD leak pada file rusak/IO error. | Resource safety | `try { ... } finally { closeSync(fd) }`. **Cost:** S. **Benefit:** tidak ada fd leak. | S | H | TERVERIFIKASI |
| **UTL-22** | **Rendah** | `encryption.ts:6-20`, `57-79` | Jika `WABA_TOKEN_ENCRYPTION_KEY` absen, key diturunkan dari `ADMIN_API_KEY`/`APP_SECRET`. `encryptSecretIfPossible` menyimpan plaintext diam-diam bila key tidak ada; `decryptSecretCompat` memperlakukan gagal dekripsi sebagai plaintext. | Rotasi admin key merusak dekripsi; secret bisa tersimpan plaintext tanpa alarm; data terenkripsi lama diperlakukan sebagai plaintext. | Security, key management, fail-closed | Wajibkan key khusus di produksi; untuk penyimpanan baru fail-closed; tandai legacy plaintext secara eksplisit. **Cost:** S–M. **Benefit:** enkripsi konsisten dan aman. | S–M | H | TERVERIFIKASI |
| **UTL-23** | **Rendah** | `wilayah-normalizer.ts:90-147`; `open-location-code.ts:87-89`; `circuit-breaker.ts:36-37` | `splitWilayahComposite('Pacar Keling, Tambaksari, Surabaya')` mengembalikan kecamatan/kelurahan tetapi **membuang** `kota`. `decodePlusCode` memakai koordinat klinik hardcoded. `isInfrastructureError` menganggap error tak dikenal sebagai infrastruktur. | Data kota hilang; Plus Code salah bila klinik pindah; bug kode dianggap kegagalan infrastruktur dan memicu fallback. | Data integrity, configurability, error classification | Tangani 3 bagian; inject koordinat klinik dari config/tenant; error tak dikenal diteruskan. **Cost:** S. **Benefit:** data lengkap dan error tidak tersamarkan. | S | H | TERVERIFIKASI |
| **UTL-24** | **Rendah** | `phone-normalizer.ts:2-9`; `jid.ts:23-33`; `capi.service.ts:41-47`; `reservation-text-parser.ts:511-516` | Normalisasi nomor HP Indonesia ditulis empat kali dengan perilaku berbeda (panjang tidak divalidasi; `jid` menggabungkan device suffix; reservation parser punya logika sendiri). | Format nomor tidak konsisten; duplikasi customer/lookup gagal. | DRY, canonical identity | Satu `normalizePhoneID` yang dipakai semua jalur; validasi panjang 10–15 digit. **Cost:** S–M. **Benefit:** identitas phone konsisten. | S–M | H | TERVERIFIKASI |
| **UTL-25** | **Rendah** | `tests/` | Lima util tidak punya test khusus: `destructive-guard`, `env-numeric`, `location-classifier`, `pin-coordinates`, `stage-logger`. | Regresi pada helper keamanan/parsing tidak tertangkap. | Testability, regression safety | Tambah unit test per util (guard produksi/nonlocal, parse env invalid, klasifikasi pertanyaan lokasi, pin vs harga, mode log). **Cost:** S. **Benefit:** perilaku terkunci. | S | H | TERVERIFIKASI |

---

## C. BEFORE / AFTER KODE

### C-1. `parseIndonesianDate` — jangan mengarang 1 Juli

**Before** (`conversation-transaction-extractor.ts:241-289`):
```ts
let day = 1;
let month = 6; // default Juli
let year = new Date().getFullYear();

const numericMatch = raw.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
if (numericMatch) { /* ... */ }
else {
  const textMatch = raw.match(/(\d{1,2})\s+([a-z]+)(?:\s+(\d{2,4}))?/i) || ...;
  if (textMatch) { /* ... */ }
}

const d = new Date(Date.UTC(year, month, day, hour - 7, minute));
return isNaN(d.getTime()) ? null : d;
```

**After**:
```ts
export function parseIndonesianDate(dateStr: string): Date | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const raw = dateStr.toLowerCase().replace(/[*_~`]/g, '').trim();

  // Delegasi ke parser kanonis; jangan memakai default tanggal.
  const base = parseIndonesianDateCanonical(raw);
  if (!base) return null;

  const timeMatch = raw.match(/(?:jam|pukul)\s*(\d{1,2})[.:](\d{2})/i);
  return timeMatch
    ? applyBookingTimeToDate(base, `${timeMatch[1]}:${timeMatch[2]}`)
    : base;
}
```
**Catatan:** bila `indonesian-date-parser` belum menangani semua format lama, pertahankan fallback tetapi **return `null`** bila tidak ada komponen tanggal yang benar-benar match.

---

### C-2. `containsForeignScripts` — regex non-global untuk `.test()`

**Before** (`language-sanitizer.ts:23-42`):
```ts
const FOREIGN_SCRIPT_RE =
  /[\u3400-\u4DBF\u4E00-\u9FFF...]/g;

export function containsForeignScripts(text: string): boolean {
  if (!text) return false;
  return FOREIGN_SCRIPT_RE.test(text); // stateful karena /g
}
```

**After**:
```ts
const FOREIGN_SCRIPT_SOURCE = '[\\u3400-\\u4DBF\\u4E00-\\u9FFF...]';
const FOREIGN_SCRIPT_RE = new RegExp(FOREIGN_SCRIPT_SOURCE, 'g');
const FOREIGN_SCRIPT_TEST_RE = new RegExp(FOREIGN_SCRIPT_SOURCE); // non-global

export function containsForeignScripts(text: string): boolean {
  if (!text) return false;
  return FOREIGN_SCRIPT_TEST_RE.test(text);
}
```
Atau paling sederhana: hapus flag `g` dari `FOREIGN_SCRIPT_RE` dan gunakan regex terpisah untuk `.replace()`.

---

### C-3. `resolveGoogleMapsUrl` — allowlist host sebelum HTTP

**Before** (`google-maps-url-resolver.ts:274-283`):
```ts
try {
  const response = await axios.get(cleanUrl, {
    maxRedirects: 5,
    timeout: timeoutMs,
    validateStatus: (status) => status >= 200 && status < 400,
    headers: { 'User-Agent': '...' },
  });
```

**After**:
```ts
const ALLOWED_MAPS_HOSTS = [
  'maps.app.goo.gl',
  'goo.gl',
  'share.google',
];

function isAllowedMapsHost(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return ALLOWED_MAPS_HOSTS.includes(host)
      || host === 'google.com'
      || host.endsWith('.google.com');
  } catch {
    return false;
  }
}

if (!isAllowedMapsHost(cleanUrl)) {
  return { success: false, rawUrl: cleanUrl, error: 'Host bukan Google Maps yang diizinkan' };
}

const response = await axios.get(cleanUrl, { maxRedirects: 0, ... });
const finalUrl = response.headers.location ?? cleanUrl;
if (!isAllowedMapsHost(finalUrl)) {
  return { success: false, rawUrl: cleanUrl, resolvedUrl: finalUrl, error: 'Redirect ke host tidak diizinkan' };
}
```
**Catatan:** `maxRedirects: 0` + validasi manual per hop lebih aman daripada `maxRedirects: 5` yang mengikuti redirect ke host mana pun.

---

### C-4. `media-kind` — AVIF/HEIC dan default aman

**Before** (`media-kind.ts:161-167`):
```ts
default:
  if (clean.startsWith('image/')) return 'jpg';
  if (clean.startsWith('audio/')) return 'ogg';
  if (clean.startsWith('video/')) return 'mp4';
  if (clean.startsWith('text/')) return 'txt';
  return 'bin';
```

**After**:
```ts
// Tambahkan deteksi AVIF/HEIC di detectKindFromMagic():
// AVIF: bytes 4..7 = 'ftyp', brand 'avif'/'avis'
// HEIC: bytes 4..7 = 'ftyp', brand 'heic'/'heix'/'hevc'
if (buf.length >= 12 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
  const brand = buf.subarray(8, 12).toString('ascii').trim().toLowerCase();
  if (brand === 'avif' || brand === 'avis') return { kind: 'image', ext: 'avif' };
  if (brand === 'heic' || brand === 'heix' || brand === 'hevc') return { kind: 'image', ext: 'heic' };
}

// Fallback MIME:
if (clean === 'image/avif') return 'avif';
if (clean === 'image/heic' || clean === 'image/heif') return 'heic';
if (clean.startsWith('image/')) return 'bin'; // jangan klaim jpg tanpa bukti
```

---

### C-5. Parser reservasi — delegasi tanggal + cek hari WIB

**Before** (`reservation-text-parser.ts:795-958`):
```ts
const d = new Date(Date.UTC(year, month, day, hour - 7, minute));
return isNaN(d.getTime()) ? null : d;
// ...
const diff = ((writtenDay - candidate.getDay() + 7) % 7);
```

**After**:
```ts
import { parseIndonesianDate, applyBookingTimeToDate } from './indonesian-date-parser';

export function tryParseIndonesianDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const base = parseIndonesianDate(dateStr);
  if (!base || !base.isRecognized) return null;
  return applyBookingTimeToDate(base.date, extractTimeText(dateStr));
}

// Jika tetap perlu reconcile nama hari:
const wib = new Date(candidate.getTime() + 7 * 60 * 60 * 1000);
const actualWibDay = wib.getUTCDay();
const diff = ((writtenDay - actualWibDay + 7) % 7);
```
**Catatan:** `indonesian-date-parser` sudah memiliki `applyBookingTimeToDate` dan perhitungan WIB yang benar; parser reservasi tidak perlu menduplikasi.

---

## D. KATALOG REUSE

| Nama | Lokasi | Fungsi | Pemakai utama |
|---|---|---|---|
| `safeCompare` | `auth.ts:7-21` | Perbandingan string timing-safe (API key) | Route auth/admin |
| `hashPassword` / `verifyPassword` | `bcrypt.ts:8-17` | Hash/verifikasi password bcrypt 12 rounds | Staff/admin auth |
| `encryptSecret` / `decryptSecret` / `decryptSecretCompat` / `encryptSecretIfPossible` / `generateEncryptionKey` | `encryption.ts:23-80` | Enkripsi AES-256-GCM kredensial | WABA token, settings |
| `checkDestructiveSafety` / `assertSafeDestructiveRun` | `destructive-guard.ts:22-83` | Guard dry-run/host nonlocal untuk skrip destruktif | Scripts cleanup/seed |
| `ClientIdempotencyStore` | `client-idempotency.ts:20-74` | Cache hasil kirim berbasis `clientTempId` | Live chat/staff reply |
| `shouldLogAuthAccess` / `buildAuthAccessLogEntry` / `emitAuthAccessLog` | `auth-access-log.ts:48-94` | Log forensik 401/503 tanpa token mentah | `app.ts` onResponse |
| `hashPiiPhone` / `sanitizeLogPayload` | `logger-sanitizer.ts:7-39` | Hash phone / redaksi PII-secret | Log buffer, LLM logger |
| `maskPhoneNumber` / `maskPhoneInText` / `sanitizePayloadRawForStaff` / `sanitizeMessageForStaff` / `sanitizeStaffHubPayload` / `maskAddress` / `maskToolArgsForLogging` | `pii-masker.ts:11-458` | Masking PII untuk tampilan staff/log | Live chat, SSE, audit |
| `ensureStaffSignature` / `hasStaffSignature` | `staff-signature.ts:17-37` | Tanda tangan terapis idempoten | Staff reservation/OTW |
| `sanitizeCustomerInput` / `wrapCustomerMessage` | `prompt-injection-sanitizer.ts:26-77` | Netralkan delimiter/tag injeksi & bungkus pesan | `agent-runner` |
| `isBypassLabelName` / `hasBypassLabel` / `checkCustomerBypass` / `buildNonBypassCustomerWhere` / `BYPASS_LABEL_PRISMA_IN` | `customer-bypass.ts:50-196` | Deteksi kontak bypass/admin | Webhook, follow-up, CAPI |
| `isDummyOrTestContact` / `shouldExcludeFromCapiQueue` | `dummy-filter.ts:4-48` | Deteksi kontak dummy/sandbox | Webhook, CAPI queue |
| `normalizePhoneID` | `phone-normalizer.ts:2-9` | Normalisasi HP Indonesia ke 62xx | Admin export |
| `parseJidType` / `normalizeWahaJid` / `extractRealPhoneFromWahaPayload` | `jid.ts:9-90` | Klasifikasi JID & ekstraksi phone (anti-LID) | Webhook WAHA |
| `sanitizeCustomerNameForGreeting` / `sanitizeCustomerNameForStorage` / `isGenericCustomerName` / `stripLocationNoise` / `stripTrailingLocationTag` / `isValidChildName` / `cleanSingleBabyName` / `formatBabyNamesForGreeting` / `formatGreeting` / `applyHonorificGreeting` | `name-sanitizer.ts:62-597` | Sanitasi nama customer/anak & sapaan | Customer service, follow-up, reservation |
| `stripTrailingDistrict` / `toTitleCase` / `toTitleCasePreservingPrefix` / `normalizeHonorificPrefix` | `customer-name-healing.ts:18-70` | Healing nama kontak | Script sanitasi |
| `normalizeWhatsAppFormat` | `whatsapp-format.ts:26-33` | Konversi Markdown ganda ke format WA | Output sanitizer |
| `isTypoAtMostOne` / `isSkippedGeoToken` | `typo-match.ts:7-31` | Levenshtein ≤1 & skiplist geo | Gazetteer, geocoding |
| `getStringSimilarity` / `normalizeForMatch` / `tokenJaccard` / `combinedSimilarity` | `similarity.ts:5-90` | Dice/Jaccard similarity | Knowledge/FAQ matching |
| `chunkTextDocument` | `text-chunker.ts:5-49` | Chunk dokumen 400–800 char | Knowledge ingestion |
| `getWibTimeInfo` / `wibDayRangeToUtc` | `time-wib.ts:15-53` | Waktu WIB & rentang hari | State machine, reporting |
| `getWibNow` / `wibDayBoundsUtc` / `startOfTodayWib` / `formatWibDateYYYYMMDD` / `getWibDayName` / `formatWibTime` | `wib-time.ts:9-55` | Helper WIB lengkap | Admin, reservation |
| `parseIndonesianDate` / `applyBookingTimeToDate` | `indonesian-date-parser.ts:61-185` | Parser tanggal Indonesia + jam booking | Reservation intake |
| `verifyDayMentioned` / `isDateConfirmed` / `hasBookingCommitSignal` / `isAvailabilityInquiryText` / `isConsultativeUserText` / `isPastBookingDateText` | `date-confirmation.ts:43-455` | Gate komitmen jadwal | State machine, save_reservation, tool-masker |
| `parseAgeTextEstimate` / `parseAgeTextToMonths` / `parseAgeTextToBirthDate` / `computeCurrentAge` / `computeGestationalAge` / `formatClinicalAge` / `isGestationalText` / `resolveMomGestationalInfo` | `age-calculator.ts:94-435` | Usia anak & gestasional | Patient extractor, follow-up, reservation |
| `getRealTimeTemporalGrounding` | `temporal-grounding.ts:60-76` | Jangkar kalender WIB untuk prompt | Router/generation prompt |
| `measure` | `timer.ts:25-36` | Timer aman untuk eksekusi paralel | Pipeline stages |
| `calculateHaversineDistance` | `haversine.ts:18-37` | Jarak dua koordinat (km) | Delivery, geocoding |
| `getGazetteerData` / `getGazetteerAreas` / `getGazetteerCoordinates` / `findNearestSubdistrict` / `getGazetteerZipcode` / `isCrossCityDuplicate` / `isCityHomonymKecamatan` / `resolvePrefixMatches` / `getGazetteerKecamatanEntries` | `gazetteer.ts:206-741` | Dataset & lookup wilayah/koordinat | Geocoding, delivery, tool-masker, lead detector |
| `resolveZipcode` / `getKecamatanRepresentativeMap` | `gazetteer-zipcode-resolver.ts:129-216` | Kode pos dari kelurahan/kecamatan/teks | Customer address, admin |
| `extractGoogleMapsUrls` / `parseMapsUrl` / `parseLatLngPair` / `extractCoordinatesFromUrlString` / `extractAddressQueryFromUrlString` / `resolveGoogleMapsUrl` | `google-maps-url-resolver.ts:25-329` | Resolusi link/pin Google Maps | Delivery, location resolver, reservation |
| `extractWahaLocation` | `waha-location-parser.ts:39-81` | Normalisasi lokasi inbound WAHA | Canonical message normalizer |
| `decodePlusCode` / `decodeFullPlusCode` / `extractPlusCode` | `open-location-code.ts:29-168` | Decode Plus Code | Google Maps resolver |
| `findNearestSubdistrict` (hint) / `classifyLocationDrift` | `gazetteer.ts:606-717`, `location-drift.ts:50-84` | Reverse geocode lokal & drift | Location enrichment |
| `splitWilayahComposite` / `normalizeWilayahText` / `isValidAreaName` | `wilayah-normalizer.ts:40-147` | Pisah teks wilayah | Reservation parser, admin |
| `sanitizeKelurahanInput` / `isCorruptedKelurahan` | `kelurahan-guard.ts:24-43` | Guard kolom kelurahan | Customer service |
| `parseReservationText` / `isReservationFormMessage` / `preprocessReservationText` / `extractBabyDetails` / `buildBabyDetails` / `parseConversationalReservation` / `tryParseIndonesianDate` / `extractNotesFromRawText` / `mergeNotesIntoRawText` / `classifyPatientEntity` | `reservation-text-parser.ts:23-1148` | Parser form/percakapan reservasi | Reservation intake, script |
| `parseCurrencyValue` / `parsePaymentSection` / `parseIndonesianDate` / `extractTransactionsFromTranscript` | `conversation-transaction-extractor.ts:32-446` | Ekstraksi nominal/pembayaran/transaksi | Backfill, transcript |
| `parseIndonesianCurrencyText` / `parseAdminChatDistanceAndOngkir` / `parseAdminChatLocation` | `admin-chat-distance-parser.ts:22-212` | Ekstraksi jarak/ongkir/lokasi dari chat admin | Human background enrichment |
| `findUnresolvedPlaceholders` / `findForbiddenPlaceholders` / `isMomsFollowUpTemplateType` | `followup-placeholder.ts:15-46` | Gate placeholder follow-up | Follow-up service |
| `isTreatmentCategoryOverlap` / `normalizeTreatmentCategory` / `isChildCategory` / `isMomsCategory` | `treatment-category.ts:22-72` | Kontrak kategori layanan | Reservation, follow-up, UI |
| `isPureLeadGreeting` / `hasIslamicSalutation` / `stripAdTags` / `isSafeForStaticTurn0Reply` | `lead-greeting-detector.ts:36-157` | Deteksi sapaan pembuka murni | State machine/fast response |
| `recordLlmExecution` / `getLlmExecutionLogs` / `getGroupedLlmExecutionLogs` / `flushLlmExecutionLogs` / `rehydrateLlmBuffer` | `llm-execution-logger.ts:166-482` | Audit eksekusi LLM (memory + JSONL) | Admin dashboard |
| `recordLlmUsage` / `auditLlmCall` / `flushLlmAuditBuffer` | `llm-audit-buffer.ts:38-180` | Audit token/biaya LLM ke DB | LLM gateway |
| `installLogBuffer` / `getLogBuffer` / `rehydrateLogBuffer` / `cleanOldLogFiles` | `log-buffer.ts:136-286` | Ring buffer & file log aplikasi | `app.ts`/`worker.ts` |
| `stageLog` / `isSimpleLogMode` | `stage-logger.ts:36-58` | Log tahap pipeline | Agent/state machine |
| `CircuitBreaker` / `isInfrastructureError` | `circuit-breaker.ts:40-201` | Circuit breaker + fallback | CAPI/Google/LLM |
| `getModelPricing` / `calculateLlmCost` / `deriveProvider` / `isDeepSeekPeakHour` | `cost-calculator.ts:385-564` | Estimasi biaya LLM per provider | LLM audit, dashboard |
| `contextStorage` / `initializeConsoleWrapper` | `context.ts:14-68` | AsyncLocalStorage correlation ID | Webhook/queue |
| `ensureBackupDirectory` / `generateBackupFileName` / `sanitizeBackupFileName` / `isValidGzipHeader` / `formatBytes` | `backup-file.ts:9-71` | Nama & validasi file backup | Backup service |
| `parsePositiveInt` / `parseNonNegativeNumber` | `env-numeric.ts:10-23` | Parse env numerik fail-closed | Config/LLM timeout |
| `extractBalancedJson` / `repairTruncatedJson` / `extractJsonContent` | `json-extract.ts:21-174` | Pulihkan JSON dari output LLM | LLM gateway/NLU |
| `detectKindFromMagic` / `kindFromMime` / `resolveExtForSave` | `media-kind.ts:23-168` | Deteksi tipe media & ekstensi | Media service |
| `encodeMessageCursor` / `decodeMessageCursor` | `message-cursor.ts:17-46` | Cursor paginasi komposit | Live chat |
| `effectiveOf` / `totalOf` | `money-contract.ts:12-22` | Kontrak uang kanonis | Cart/reservation |
| `isMissingColumnError` | `prisma-errors.ts:10-25` | Deteksi P2022/42703 | Config/service |
| `createMonotonicSseSequencer` | `sse-sequence.ts:21-32` | ID SSE monotonik | Live chat SSE |

---

## E. LOGIKA YANG DITULIS SENDIRI (BERPOTENSI DUPLIKAT)

| Logika generik | Lokasi di modul ini | Duplikat/kandidat di tempat lain | Catatan |
|---|---|---|---|
| Parsing tanggal Indonesia | `indonesian-date-parser.ts`; `reservation-text-parser.ts:795-958`; `conversation-transaction-extractor.ts:208-293` | `date-confirmation.ts:386-399` (month map), `followup-templates.ts:392-397` (WIB date key) | Empat sumber; hasil bisa berbeda. |
| Konversi WIB | `time-wib.ts`; `wib-time.ts` | `operational-hours.ts:80-83`; `staff-chat-config.ts:93-111`; `followup-templates.ts:392-397` | Minimal enam implementasi. |
| Haversine | `haversine.ts:18-37` | `gazetteer.ts:588-598`; `location-drift.ts` memakai versi gazetteer | `atan2` + rounding vs `asin` tanpa rounding. |
| Normalisasi nomor HP | `phone-normalizer.ts:2-9`; `jid.ts:23-33` | `capi.service.ts:41-47`; `reservation-text-parser.ts:511-516`; `pii-masker.ts:51-127` | Empat implementasi, validasi panjang tidak konsisten. |
| Masking PII | `pii-masker.ts`; `logger-sanitizer.ts`; `log-buffer.ts:90-93` | `llm-execution-logger.ts:77-84` (mask nama) | Tiga kontrak berbeda; tidak ada satu `sanitizePii`. |
| Normalisasi nama/toponimi | `name-sanitizer.ts`; `toponym-normalizer.ts`; `wilayah-normalizer.ts` | `customer-name-healing.ts`; `gazetteer.ts:122-128` (injeksi leksikon) | Tiga lapisan saling bergantung; rawan drift. |
| Data wilayah/koordinat | `gazetteer.ts`; `gazetteer-zipcode-resolver.ts` | `config/landmarks.ts`; `config/surabaya_sidoarjo_subdistricts.json` | Tiga sumber geo. |
| Deteksi tipe media | `media-kind.ts` | `canonical-message-normalizer.ts:121-286` | Dua klasifikasi media (magic vs payload). |
| Parsing nominal/currency | `conversation-transaction-extractor.ts:32-89` | `admin-chat-distance-parser.ts:22-45`; `cost-calculator.ts` | Tiga parser nominal dengan cap/range berbeda. |
| Ekstraksi JSON | `json-extract.ts` | Banyak `JSON.parse` lokal di service | Util ini sudah menjadi seam; migrasikan sisa pemanggil. |
| Gate intent/sapaan | `date-confirmation.ts`; `lead-greeting-detector.ts` | `reservation-text-parser.ts:91-136`; `v3/agent/persona.ts:22-162` | Banyak regex/frasa literal; risiko overfitting. |
| Idempotensi | `client-idempotency.ts` | `message.service.ts` (memory + DB `wa_message_id`), `queue.service.ts` (bull lock) | Tiga mekanisme berbeda; tidak saling menggantikan. |
| Retry/fallback error | `circuit-breaker.ts` | `integrations/llm/model-fallback.ts`; `utils/timer.ts` | Klasifikasi error berbeda (LLM vs generic). |
| Format tanggal file/log | `backup-file.ts:19-30`; `log-buffer.ts:45-54`; `llm-execution-logger.ts:104-113` | `wib-time.ts:38-44` | Tiga `getLogDateString`/filename lokal, bukan WIB. |

---

## F. FILE DI MODUL INI YANG BELUM DIBACA

**Tidak ada.** Seluruh 63 file `.ts` di `src/utils` sudah dibaca penuh (10.713 baris).

**Dependensi luar modul yang dibaca sebagian (bukan klaim audit penuh):**
`src/services/capi.service.ts` (hanya `normalizePhoneToE164`), `src/services/human-background-enrichment.service.ts` (hanya pemanggil resolver URL), `src/services/location-resolver.service.ts` (bagian resolver), `src/services/reservation-lifecycle.service.ts` (bagian auto-distance), `src/v3/tools/calculate-delivery.tool.ts` (bagian shareloc), `src/app.ts`/`src/worker.ts` (urutan console wrapper), `src/config/*` (brand/clinic/persona), `src/domain/reservation-status.ts` (re-export kategori).

---

## G. PENYIMPANAN HASIL

Laporan ini disimpan di:

`docs/MODULE_AUDIT_03_UTILS.md`

Tidak ada file source yang diubah selama audit.

---

## LAMPIRAN 1 — FAN-IN & TEST COVERAGE

| Util | Importers (`src`) | Test khusus |
|---|---:|---|
| `name-sanitizer` | 19 | Ada (name-sanitizer, follow-up, reminder) |
| `gazetteer` | 21 | Ada (artery, cluster geocoding, lead detector) |
| `age-calculator` | 11 | Ada (age/gestational) |
| `date-confirmation` | 9 | Ada (day gate, booking commit) |
| `reservation-text-parser` | 17 | Ada (form, conversational, date) |
| `pii-masker` | 7 | Ada (PII masking) |
| `encryption` | 9 | Ada (encryption round-trip) |
| `customer-bypass` | 11 | Ada (bypass label) |
| `google-maps-url-resolver` | 5 | Ada (maps URL parsing) |
| `llm-execution-logger` | 5 | Ada (logger, PII) |
| `wib-time` | 8 | Ada (WIB) |
| `time-wib` | 2 | Ada (WIB) |
| `circuit-breaker` | 4 | Ada (circuit breaker) |
| `prompt-injection-sanitizer` | 1 | Ada (prompt injection) |
| `media-kind` | 1 | Ada (media magic) |
| `canonical-message-normalizer` | 1 | Ada (canonical message) |
| `lead-greeting-detector` | 4 | Ada (lead greeting) |
| **Tanpa test khusus** | — | `destructive-guard`, `env-numeric`, `location-classifier`, `pin-coordinates`, `stage-logger` |

---

## LAMPIRAN 2 — BUKTI RUNTIME

```text
parseIndonesianDate('besok')        -> 2026-07-01T02:00:00.000Z
parseIndonesianDate('tanpa tanggal')-> 2026-07-01T02:00:00.000Z
parseIndonesianDate('12 agustus 2026') -> 2026-08-12T02:00:00.000Z

containsForeignScripts('你好') -> true
containsForeignScripts('你好') -> true
containsForeignScripts('你好') -> false

resolveExtForSave('image/avif') -> jpg
resolveExtForSave('image/heic') -> jpg
resolveExtForSave('application/octet-stream', Buffer[1,2,3,4]) -> bin

isDeepSeekPeakHour(Sat 02:00Z) -> true
isDeepSeekPeakHour(Sat 20:00Z) -> false
isDeepSeekPeakHour(Mon 20:00Z) -> false

createMonotonicSseSequencer(100).peek() -> 100 (bukan null)
next() -> 101; peek() -> 101

TZ=UTC, tryParseIndonesianDate('senin 5 oktober 2026 jam 00.30')
-> 2026-10-05T17:30:00.000Z = Selasa 00:30 WIB (bukan Senin)

normalizeWahaJid('628123456789:12@s.whatsapp.net') -> 62812345678912
extractWahaLocation({type:'location', location:{latitude:-7.3}})
-> { rawLat:-7.3, rawLng:NaN, hasRealLocation:true }
extractWahaLocation({type:'location', location:{latitude:200, longitude:300}})
-> { rawLat:200, rawLng:300, hasRealLocation:true }
```

---

## LAMPIRAN 3 — REKOMENDASI URUTAN PERBAIKAN (TANPA EKSEKUSI)

| Urutan | Temuan | Alasan | Gate regresi |
|---:|---|---|---|
| 1 | UTL-01, UTL-02 | Tanggal salah bisa mengubah jadwal/data transaksi | Test parser canonical + TZ UTC + variasi input |
| 2 | UTL-04 | SSRF dari input customer | Test allowlist host/redirect + integration resolver |
| 3 | UTL-05 | Regex stateful membuat gate tidak deterministik | Test pemanggilan berulang |
| 4 | UTL-07, UTL-08 | Media rusak & biaya salah | Test AVIF/HEIC + peak weekend |
| 5 | UTL-09, UTL-10, UTL-11 | Efisiensi & duplikasi fondasi | Benchmark lokasi/nama + full suite |
| 6 | UTL-12–UTL-17 | Keamanan log, idempotensi, audit | Test log sanitization + retry |
| 7 | UTL-18–UTL-25 | Kebersihan & test gap | Full suite |

**Catatan:** rekomendasi di atas belum dieksekusi. Sesuai instruksi, audit berhenti di sini dan menunggu perintah modul berikutnya.
