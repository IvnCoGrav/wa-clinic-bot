# RE-BASELINE TRACK A (MODUL 01–05) — 2026-11-09

- **Status:** **TERVERIFIKASI & DI-RE-BASELINE** pada commit `f3c6a2c4` + S1 + S2.
- **Tujuan:** Memverifikasi ulang seluruh 96 temuan dari 5 modul Track A (`MODULE_AUDIT_01_DATA_ACCESS.md` s.d. `MODULE_AUDIT_05_INGRESS.md`) terhadap kode sumber aktual di branch `master`, memetakan korelasi terhadap perbaikan Track B (Fase 0–10, S1, S2), dan menyusun backlog bersih tanpa duplikasi.
- **Metode:** Pembacaan kode aktual (`file:baris`), verifikasi AST/grep, validasi terhadap suite test Vitest (6.724 test baseline), dan pengujian isolasi runtime.

---

## 1. Ringkasan Status Rekonsiliasi

Dari total **96 temuan Track A**:
- **FIXED (Tuntas):** **10 temuan** — telah diselesaikan secara fondasional pada Fase 1, Fase 3, Fase S1, dan Fase S2.
- **DUPLICATE (Tercakup Track B):** **2 temuan** — `CFG-06` & `CFG-07` (katalog medis dan kebijakan persona) yang dijadwalkan data-driven pada Fase 9.
- **PARTIAL (Sebagian Teratasi):** **3 temuan** — proteksi telah dipasang sebagian (mis. redaksi PII telepon di log, uji WABA-only & queue retry di S1/S2, tapi pembersihan menyeluruh belum tuntas).
- **OPEN (Backlog Sah):** **81 temuan** — terverifikasi masih ada pada kode aktual dan menjadi backlog penyempurnaan sistemik.
- **STALE (Basi/Tidak Relevan):** **0 temuan** — seluruh temuan masih relevan terhadap arsitektur berjalan.

### Ringkasan per Batch Modul

| Batch | Modul Asal | Total ID | FIXED | DUPLICATE | PARTIAL | OPEN |
|---|---|---:|---:|---:|---:|---:|
| **A1** | Modul 01: Lapisan Akses Data (`src/repositories/*`, `db`) | 18 | 0 | 0 | 0 | 18 |
| **A2** | Modul 02: Konfigurasi & Persona (`src/config/*`) | 20 | 0 | 2 | 1 | 17 |
| **A3** | Modul 03: Utilitas Sistem (`src/utils/*`) | 25 | 0 | 0 | 1 | 24 |
| **A4** | Modul 04: Logika Domain (`src/domain/*`) | 15 | 0 | 0 | 0 | 15 |
| **A5** | Modul 05: Ingress Webhook (`src/routes/webhook*.ts`, `app.ts`) | 18 | 10 | 0 | 1 | 7 |
| **TOTAL** | | **96** | **10** | **2** | **3** | **81** |

---

## 2. Register Status Temuan Track A Lengkap

### Batch A1 — Lapisan Akses Data (D-01 s.d. D-18)

| ID | Severity | File:Baris Lama | File:Baris Baru | Status | Track B ID | Bukti Kode Aktual & Catatan |
|---|---|---|---|---|---|---|
| **D-01** | Tinggi | `prisma/schema.prisma:218-223`; `conversation.repository.ts:40-58` | `prisma/schema.prisma:218-250`; `conversation.repository.ts:40-60` | **OPEN** | — | Tabel `Conversation` belum memiliki kolom `closed_at`/`archived_at` dan belum ada partial unique index `(tenant_id, customer_id) WHERE closed_at IS NULL`. |
| **D-02** | Tinggi | `customer.service.ts:1246-1254`; `message.service.ts:448-460` | `customer.service.ts:435, 722, 1102, 1246, 1392`; `message.service.ts:460-475` | **OPEN** | — | `customer.service.ts` masih memiliki 12 titik pemanggilan langsung `prisma.customer.update` tanpa melalui repository seam. |
| **D-03** | Tinggi | `customer.repository.ts:37, 75-77` | `customer.repository.ts:37, 75-77` | **OPEN** | — | Signature `CustomerRepository.update(id, patch)` belum menerima `tenantId` dan masih memakai `as any`. |
| **D-04** | Sedang | `conversation.repository.ts:68-88, 90-102` | `conversation.repository.ts:68-88, 90-102` | **OPEN** | — | `updateState` dan `flagForReview` masih melakukan 3 round-trip query (`findUnique` → `updateMany` → `findUnique`). |
| **D-05** | Sedang | `turn.repository.ts:25, 31, 59` | `turn.repository.ts:25, 31, 60` | **OPEN** | — | `TurnRepository` masih berupa singleton konkret tanpa interface/DI dan memakai `(prisma as any)`. |
| **D-06** | Sedang | `turn.repository.ts:110-136` | `turn.repository.ts:112-137` | **OPEN** | — | `claimForProcessing` masih mengembalikan `true` saat `existing.status === 'PROCESSING'` dan saat DB offline (fail-open). |
| **D-07** | Sedang | `message.repository.ts:70-80` | `message.repository.ts:70-80` | **OPEN** | — | `existsByWaId` masih menggunakan `endsWith: '_${shortId}'` (leading wildcard) yang memicu scan indeks. |
| **D-08** | Sedang | `customer.repository.ts:48, 80` | `customer.repository.ts:48, 80` | **OPEN** | — | `findByPhone` dan `updateManyByPhoneTenant` mencocokkan string `phone` mentah tanpa kanonikalisasi E.164. |
| **D-09** | Rendah | `customer.repository.ts:30, 59-70` | `customer.repository.ts:30, 59-72` | **OPEN** | — | Field `is_internal_staff` ada di `CustomerCreateData` interface tetapi tidak ditulis ke `data` pada `prisma.customer.create`. |
| **D-10** | Rendah | `customer.repository.ts:52-57` | `customer.repository.ts:52-57` | **OPEN** | — | `findById` memanggil `prisma.customer.findUnique({ where: { id } })` lalu memfilter `tenant_id` di memori runtime. |
| **D-11** | Rendah | `turn.repository.ts:91-103` | `turn.repository.ts:93-105` | **OPEN** | — | `cleanupOlderThan` menelan error penghapusan dengan blok `catch {}` kosong tanpa log peringatan. |
| **D-12** | Rendah | `customer.repository.ts:34-42` | `customer.repository.ts:34-42` | **OPEN** | — | Metode interface repository masih mengembalikan `Promise<any>` dan menerima patch `Record<string, unknown>`. |
| **D-13** | Rendah | `conversation.service.ts:631-640` | `conversation.service.ts:631-641` | **OPEN** | — | Variabel `dataToUpdate` diinisialisasi dan diisi 8 properti tetapi tidak pernah digunakan (dead code). |
| **D-14** | Rendah | `turn.repository.ts:17, 28, 78, 111` | `turn.repository.ts:17, 28, 78, 113` | **OPEN** | — | Parameter `tenantId` pada method `TurnRepository` masih diberi default `DEFAULT_TENANT_ID`. |
| **D-15** | Rendah | `message.repository.ts:109-115` | `message.repository.ts:109-115` | **OPEN** | — | `InMemoryMessageRepository.existsByWaId` tidak mengimplementasikan pencocokan suffix `endsWith`. |
| **D-16** | Rendah | `turn.repository.ts:42, 131` | `turn.repository.ts:42, 133` | **OPEN** | — | `persistInbound` memakai `update: {}` sehingga turn yang pernah berstatus `FAILED` tidak bisa di-retry. |
| **D-17** | Rendah | `conversation.repository.ts:12-13` | `conversation.repository.ts:12-13` | **OPEN** | — | Komentar header menyebutkan cakupan `escalate` dan `updateLastCustomerMessageAt`, namun interface belum menyediakannya. |
| **D-18** | Rendah | `tests/unit/*-repository.test.ts` | `tests/unit/*-repository.test.ts` | **OPEN** | — | Unit test repository belum menguji kasus race condition parallel getOrCreate dan isolasi update scoped. |

---

### Batch A2 — Konfigurasi & Persona (CFG-01 s.d. CFG-20)

| ID | Severity | File:Baris Lama | File:Baris Baru | Status | Track B ID | Bukti Kode Aktual & Catatan |
|---|---|---|---|---|---|---|
| **CFG-01** | Kritis | `medical-keywords.ts:153-167` | `medical-keywords.ts:155-172` | **OPEN** | — | `NON_MEDICAL_PHRASES` diperiksa secara global di dalam `matchesKeyword`. Jika teks mengandung "step by step", seluruh keyword medis (termasuk `kejang`) diabaikan. |
| **CFG-02** | Tinggi | `persona.ts:12, 101-107`; `Dockerfile:50-51` | `persona.ts:12, 101-107`; `Dockerfile:50-51` | **OPEN** | — | `persona_custom.txt` tidak disalin ke image Docker di tahap build, menyebabkan drift persona antara environment development dan production. |
| **CFG-03** | Tinggi | `persona.ts:109, 166-190` | `persona.ts:109, 166-190` | **PARTIAL** | Fase 3 | `BOT_PERSONA_PROMPT` masih diekspor sebagai variabel global mutable (`export let BOT_PERSONA_PROMPT`), meskipun `loadPersonaFromDb` sudah menerima `tenantId`. |
| **CFG-04** | Tinggi | `brand.ts:27-38`; `followup-templates.ts:80-334` | `brand.ts:27-38`; `followup-templates.ts:80-334` | **OPEN** | Fase 3 | `getBrandIdentity()` sinkron selalu mengembalikan default Kala Spa; fungsi ini masih dipakai di `followup-templates.ts` dan watermark media. |
| **CFG-05** | Tinggi | `delivery.service.ts:237, 325` | `delivery.service.ts:244, 335` | **OPEN** | — | Perhitungan ongkir pada `calculateDelivery` masih memakai koordinat fallback global `{ lat: clinicConfig.lat, lng: clinicConfig.lng }` dan `DEFAULT_TENANT_ID`. |
| **CFG-06** | Tinggi | `medical-keywords.ts:7-135` | `medical-keywords.ts:7-135` | **DUPLICATE** | Fase 9 | Kosakata gejala medis (High/Medium) masih hardcoded di array TypeScript; dijadwalkan menjadi data-driven pada Fase 9 (Task S5.2). |
| **CFG-07** | Tinggi | `persona.ts:322, 350, 432` | `persona.ts:322, 350, 432` | **DUPLICATE** | Fase 9 | Business policies (BCA/Mandiri, Waru, 30 km, H-3) masih tercantum di prompt default persona; dijadwalkan data-driven di Fase 9. |
| **CFG-08** | Sedang | `persona.ts:238-693` | `persona.ts:238-693` | **OPEN** | — | Dari 47 key di `TEMPLATES`, 33 key tidak memiliki pemanggil runtime (tergantikan oleh `followup-templates.ts`). |
| **CFG-09** | Sedang | `landmarks.ts:17-722` | `landmarks.ts:17-722` | **OPEN** | — | 800 baris data landmark, perumahan, dan apartemen Surabaya/Sidoarjo masih tertulis di file TypeScript statis. |
| **CFG-10** | Sedang | `operational-hours.ts:80-83`; `time-wib.ts` | `operational-hours.ts:80-83`; `time-wib.ts` | **OPEN** | — | Terdapat modul paralel penanganan waktu WIB (`src/utils/time-wib.ts` vs `src/utils/wib-time.ts`). |
| **CFG-11** | Sedang | `operational-hours.ts:62` | `operational-hours.ts:62` | **OPEN** | — | Ekstraksi jam operasional dari summary teks kebijakan memakai regex kaku dan fallback diam-diam bila format berbeda. |
| **CFG-12** | Sedang | `ai-models.config.ts:400-422` | `ai-models.config.ts:400-422` | **OPEN** | — | UI mencantumkan 9 provider AI, namun runtime hanya benar-benar memproses endpoint KENARI dan SUMOPOD. |
| **CFG-13** | Sedang | `ai-models.config.ts:39-48` | `ai-models.config.ts:39-48` | **OPEN** | — | Komentar menyebut `SUMOPOD_CATALOG` berisi 5 model, tetapi Set aktual memuat 7 entri. |
| **CFG-14** | Sedang | `brand.ts:44-48`; `pricelist-promo.ts:96` | `brand.ts:44-48`; `pricelist-promo.ts:96` | **OPEN** | — | Cache in-memory untuk brand, clinic location, dan promo tidak memiliki TTL (hanya di-clear saat mutasi settings). |
| **CFG-15** | Sedang | `ai-eligibility-config.ts:26-35` | `ai-eligibility-config.ts:26-35` | **OPEN** | — | `buildFailClosedConfig()` membaca env `AI_CUSTOMER_SCOPE` yang jika bernilai `ALL` membuat fallback menjadi fail-open. |
| **CFG-16** | Sedang | `followup-templates.ts:73-340` | `followup-templates.ts:73-340` | **OPEN** | — | Render pesan follow-up memakai `getBrandIdentity()` sinkron dan regex mutilasi pasca-render. |
| **CFG-17** | Sedang | `ai-models.config.ts:507-521` | `ai-models.config.ts:507-521` | **OPEN** | — | `saveQueue` hanya menserialkan penyimpanan konfigurasi per proses Node, bukan lintas proses worker vs app. |
| **CFG-18** | Sedang | `Dockerfile:50-51`; `cost-calculator.ts` | `Dockerfile:50-51`; `cost-calculator.ts` | **OPEN** | — | `kenari-pricing.snapshot.json` tidak disalin ke image Docker pada tahap multi-stage build. |
| **CFG-19** | Rendah | `settings.subroute.ts:1469` | `settings.subroute.ts:1490` | **OPEN** | — | `oldConfig` dibaca via `AiModelConfigService.getModelConfig(upperTask as any)` tanpa menyertakan `tenantId`. |
| **CFG-20** | Rendah | `feature-flags.ts:1-2`; `clinic.ts:1-2` | `feature-flags.ts:1-2`; `clinic.ts:1-2` | **OPEN** | — | Pemanggilan `dotenv.config()` masih terulang di level modul util/config individual. |

---

### Batch A3 — Utilitas Sistem (UTL-01 s.d. UTL-25)

| ID | Severity | File:Baris Lama | File:Baris Baru | Status | Track B ID | Bukti Kode Aktual & Catatan |
|---|---|---|---|---|---|---|
| **UTL-01** | Kritis | `conversation-transaction-extractor.ts:208-293` | `conversation-transaction-extractor.ts:208-293` | **OPEN** | — | `parseIndonesianDate()` menetapkan default `month = 6` (Juli) dan `day = 1`, sehingga teks tanpa tanggal menghasilkan `2026-07-01`. |
| **UTL-02** | Tinggi | `reservation-text-parser.ts:795-958` | `reservation-text-parser.ts:795-958` | **OPEN** | — | `candidate.getDay()` dievaluasi pada timezone proses server (UTC), berisiko menggeser tanggal pemesanan dini hari (WIB). |
| **UTL-03** | Tinggi | `reservation-text-parser.ts:1-1148` | `reservation-text-parser.ts:1-1148` | **OPEN** | — | File `reservation-text-parser.ts` berukuran 1.148 baris mencampuradukkan parsing form, conversational, dan payment. |
| **UTL-04** | Tinggi | `google-maps-url-resolver.ts:255-329` | `google-maps-url-resolver.ts:276` | **OPEN** | — | `axios.get(cleanUrl)` mengikuti hingga 5 redirect tanpa validasi hostname terhadap allowlist resmi Google Maps. |
| **UTL-05** | Tinggi | `language-sanitizer.ts:23-42` | `language-sanitizer.ts:23-42` | **OPEN** | — | `FOREIGN_SCRIPT_RE` didefinisikan dengan flag `/g`, sehingga pemanggilan `.test()` menyimpan state `lastIndex`. |
| **UTL-06** | Tinggi | `date-confirmation.ts:170-185` | `date-confirmation.ts:170-185` | **OPEN** | — | Deteksi komitmen memakai daftar frasa hafalan ("mau yang itu", "boleh deh yang itu") alih-alih grammar deiksis semantik. |
| **UTL-07** | Sedang | `media-kind.ts:116-167` | `media-kind.ts:162` | **OPEN** | — | `resolveExtForSave()` mengembalikan ekstensi `.jpg` untuk seluruh MIME `image/*` yang tidak dikenal (mis. AVIF/HEIC). |
| **UTL-08** | Sedang | `cost-calculator.ts:380-388` | `cost-calculator.ts:380-388` | **OPEN** | — | `isDeepSeekPeakHour()` mengembalikan `true` setiap hari tanpa memeriksa apakah hari saat ini adalah hari kerja (weekday). |
| **UTL-09** | Sedang | `gazetteer.ts:406-411` | `gazetteer.ts:406-411` | **OPEN** | — | `boundedMatchIndex()` mengompilasi `new RegExp` berulang kali per baris per distrik pada setiap query lokasi. |
| **UTL-10** | Sedang | `name-sanitizer.ts:121-125` | `name-sanitizer.ts:121-125` | **OPEN** | — | Sanitasi nama mengompilasi regex baru per distrik pada hot path pesan masuk. |
| **UTL-11** | Sedang | `wib-time.ts:9-55`; `time-wib.ts:24-52` | `wib-time.ts`; `time-wib.ts` | **OPEN** | — | Duplikasi dua modul pembantu zona waktu WIB dengan utilitas konversi yang saling tumpang tindih. |
| **UTL-12** | Sedang | `prompt-injection-sanitizer.ts:54-66` | `prompt-injection-sanitizer.ts:54-66` | **OPEN** | — | Sanitizer mencatat frasa injeksi ke `blockedPatterns` tetapi `wrapCustomerMessage` tidak menetralisir teks input. |
| **UTL-13** | Sedang | `llm-execution-logger.ts:214-219` | `llm-execution-logger.ts:214-230` | **PARTIAL** | Fase 8 | Nomor telepon pasien telah disamarkan (`[PHONE_REDACTED]`), namun field `promptPayload` mentah masih tersimpan lengkap. |
| **UTL-14** | Sedang | `log-buffer.ts:169-241` | `log-buffer.ts:169-241` | **OPEN** | — | `rehydrateLogBuffer` membaca seluruh file log menggunakan `readFile` ke memori sebelum mengambil 500 baris terakhir. |
| **UTL-15** | Sedang | `client-idempotency.ts:20-74` | `client-idempotency.ts:20-74` | **OPEN** | — | Cache idempotensi client temp ID hanya berbasis `Map` memori lokal, tidak tersinkronisasi lintas node/worker. |
| **UTL-16** | Sedang | `llm-audit-buffer.ts:130-179` | `llm-audit-buffer.ts:133-179` | **OPEN** | — | `buffer.splice(0)` dilakukan sebelum insert DB; jika `prisma.llmAuditLog.createMany` gagal, data audit hilang permanen. |
| **UTL-17** | Sedang | `gazetteer-zipcode-resolver.ts:32-36` | `gazetteer-zipcode-resolver.ts:32-36` | **OPEN** | — | `kelToZip` menyimpan entri pertama untuk nama kelurahan yang identik di kota berbeda (homonim). |
| **UTL-18** | Rendah | `sse-sequence.ts:21-31` | `sse-sequence.ts:28-30` | **OPEN** | — | `peek()` mengembalikan `String(current)` (berisi seed) sebelum method `next()` dipanggil untuk pertama kali. |
| **UTL-19** | Rendah | `waha-location-parser.ts:55-78` | `waha-location-parser.ts:55-78` | **OPEN** | — | Lokasi dianggap valid bila latitude angka valid tetapi longitude `NaN`; tidak ada validasi rentang koordinat. |
| **UTL-20** | Rendah | `text-chunker.ts:5-9` | `text-chunker.ts:5-9` | **OPEN** | — | Parameter `minChunkSize` diterima pada fungsi chunker namun tidak pernah digunakan dalam pembagian teks. |
| **UTL-21** | Rendah | `backup-file.ts:48-59` | `backup-file.ts:48-59` | **OPEN** | Fase 0 | `isValidGzipHeader()` membuka file descriptor tanpa blok `finally` untuk menutup fd bila terjadi error pembacaan. |
| **UTL-22** | Rendah | `encryption.ts:6-20` | `encryption.ts:6-20` | **OPEN** | — | Jika key enkripsi WABA tidak disetel, enkripsi diturunkan dari `ADMIN_API_KEY` dan menyimpan plaintext bila gagal. |
| **UTL-23** | Rendah | `wilayah-normalizer.ts:90-147` | `wilayah-normalizer.ts:90-147` | **OPEN** | — | `splitWilayahComposite` mengekstrak kecamatan dan kelurahan namun membuang komponen nama kota/kabupaten. |
| **UTL-24** | Rendah | `phone-normalizer.ts:2-9` | `phone-normalizer.ts:2-9` | **OPEN** | — | Terdapat empat implementasi normalisasi nomor HP dengan penanganan sufiks device WhatsApp yang berbeda. |
| **UTL-25** | Rendah | `tests/` (cakupan utilitas) | `tests/` | **OPEN** | — | Helper keamanan dan parsing (`destructive-guard`, `env-numeric`, `pin-coordinates`) belum memiliki unit test khusus. |

---

### Batch A4 — Logika Domain (DOM-01 s.d. DOM-15)

| ID | Severity | File:Baris Lama | File:Baris Baru | Status | Track B ID | Bukti Kode Aktual & Catatan |
|---|---|---|---|---|---|---|
| **DOM-01** | Sedang | `reservation-status.ts:11-27` | `reservation-status.ts:11-27` | **OPEN** | — | `ACTIVE_RESERVATION_STATUSES` memuat status `pending/hold` tanpa jendela waktu; pemanggil langsung menganggap status lama aktif. |
| **DOM-02** | Sedang | `customer-address.ts:1-620` | `customer-address.ts:1-620` | **OPEN** | — | Modul 620 baris menangani validasi Zod, deduplikasi, koordinat, rekonsiliasi, dan manipulasi tombstone dalam satu file. |
| **DOM-03** | Sedang | `customer-address.ts:145-232` | `customer-address.ts:145-232` | **OPEN** | — | `addressesMatch` menggunakan substring `includes` untuk kemiripan wilayah yang rentan over-match pada nama beririsan. |
| **DOM-04** | Sedang | `customer-address.ts:83-119` | `customer-address.ts:83-119` | **OPEN** | — | Fungsi `haversineMeters` dan `levenshtein` ditulis inline dan menduplikasi modul utilitas bersama. |
| **DOM-05** | Sedang | `location-adequacy.ts:170-180` | `location-adequacy.ts:170-180` | **OPEN** | — | Flag `staffVerified === true` dianggap memadai meskipun koordinat verifikasi fisik staf bernilai null. |
| **DOM-06** | Sedang | `dispatch-visit-context.ts:35-39` | `dispatch-visit-context.ts:35-39` | **OPEN** | — | `hasFreshSharelocToday` tidak memfilter arah pesan `direction: 'INBOUND'`, sehingga shareloc outbound staf/bot ikut terhitung. |
| **DOM-07** | Rendah | `address-reconciliation.ts:67-99` | `address-reconciliation.ts:67-99` | **OPEN** | — | Skrip rekonsiliasi alamat mencocokkan baris database vs payload JSON hanya berdasarkan `id`, bukan kemiripan teks alamat. |
| **DOM-08** | Rendah | `address-healing.ts:36-58` | `address-healing.ts:36-58` | **OPEN** | — | `pickHealingWinner` mengembalikan entitas pemenang tanpa menyertakan koordinat GPS yang wajib dipertahankan. |
| **DOM-09** | Rendah | `customer-address.ts:30-50` | `customer-address.ts:30-50` | **OPEN** | — | Skema Zod mewajibkan field `createdAt` dan `lastUsedAt`, menyebabkan kartu alamat format legacy gagal diparse. |
| **DOM-10** | Rendah | `customer-address.ts:580-593` | `customer-address.ts:580-593` | **OPEN** | — | `pruneAddressTombstones` memotong array dengan `.slice(-N)` tanpa melakukan pengurutan tanggal penghapusan terlebih dahulu. |
| **DOM-11** | Rendah | `reservation-status.ts:96-106` | `reservation-status.ts:96-106` | **OPEN** | — | `isActiveReservation` membandingkan string status secara case-sensitive (`=== 'confirmed'`). |
| **DOM-12** | Rendah | `reservation-status.ts:78-88` | `reservation-status.ts:78-88` | **OPEN** | — | `activeReservationWhere` mendefinisikan ulang array status aktif secara hardcoded alih-alih menurunkan dari konstanta bersama. |
| **DOM-13** | Rendah | `reservation-payment.ts:22-29` | `reservation-payment.ts:22-29` | **OPEN** | — | `getPaymentDisplayStatus` hanya mengenali lowercase `'completed'`, nilai `'COMPLETED'` jatuh ke tagihan di tempat. |
| **DOM-14** | Rendah | `staff-retention.ts:303-389` | `staff-retention.ts:303-389` | **OPEN** | — | Terdapat cabang mati `cohortN === 0` dan perhitungan retensi pasien dihitung tanpa membedakan kesinambungan staf bidan. |
| **DOM-15** | Rendah | `address-healing.ts:44-57` | `address-healing.ts:44-57` | **OPEN** | — | Penentuan kartu pemenang pada skrip healing tidak memiliki mekanisme pemutus seri (*tie-break*) berdasarkan tanggal penggunaan. |

---

### Batch A5 — Ingress Webhook (ING-01 s.d. ING-18)

| ID | Severity | File:Baris Lama | File:Baris Baru | Status | Track B ID | Bukti Kode Aktual & Catatan |
|---|---|---|---|---|---|---|
| **ING-01** | Tinggi | `webhook.route.ts:38-63` | `webhook.route.ts:38, 134` | **FIXED** | Fase 3 | `handleLabelChatEvent(event, tenantId)` kini menerima `resolvedTenantId` dan meneruskannya ke `customerService.setLabelFlags`. |
| **ING-02** | Tinggi | `webhook.route.ts:750-762` | `webhook.route.ts:1563`; `waba-webhook.route.ts:488` | **FIXED** | W-005 (S1) | `isDuplicateMessage` diubah menjadi murni read-only; klaim `claimMessageId` dieksekusi HANYA setelah pesan sukses di-enqueue ke antrean tahan banting. |
| **ING-03** | Tinggi | `webhook.route.ts:368-379` | `webhook.route.ts:368-382` | **FIXED** | Fase S2 (S2.1) | Seluruh string literal echo bot dihapus; digantikan oleh `UNIVERSAL_BOT_ECHO_PREFIXES` dan `getTenantEchoPatterns` dari DB `Tenant` & `ClinicPolicy`. |
| **ING-04** | Sedang | `app.ts:70-71` | `app.ts:70-76` | **FIXED** | Fase 1 | `trustProxy` dibatasi ke loopback dan rentang private IP subnet yang aman (`127.0.0.1/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`). |
| **ING-05** | Sedang | `app.ts` (ketiadaan handler) | `app.ts:85-135` | **FIXED** | Fase S2 (S2.2) | Dipasang `app.setErrorHandler` terpusat (menstandarkan 400 validasi, 500 no stack leak di prod) dan `app.setNotFoundHandler` terstruktur JSON. |
| **ING-06** | Sedang | `app.ts:229-271` | `app.ts:285-300` | **FIXED** | Fase S2 (S2.4) | Inisialisasi runtime tenant dipindahkan sebelum `server.listen()`, menutup celah race condition cache kosong pada request HTTP pertama. |
| **ING-07** | Sedang | `webhook.route.ts:336, 738` | `webhook.route.ts:131, 335, 735, dll.` | **FIXED** | W-003 (S1) | Seluruh 13 titik pemanggilan `wahaClient` global di webhook dialihkan ke `tenantWaha` via `getWahaClientForTenant(resolvedTenantId)`. |
| **ING-08** | Sedang | `health.route.ts:21-58` | `health.route.ts:21-125` | **FIXED** | Fase S2 (S2.3) | Route `/ready` kini provider-aware: memeriksa WAHA hanya jika ada tenant WAHA (WABA-only aman saat WAHA down), cek token WABA, cek Redis, dan timeout 2,5s. |
| **ING-09** | Sedang | `webhook.route.ts:575-585` | `webhook.route.ts:586` | **OPEN** | — | Perekaman pesan outbound admin (`messageService.logMessage`) masih menelan error dengan `.catch((err) => console.error)` tanpa retry ke outbox. |
| **ING-10** | Sedang | `webhook.route.ts` vs `waba-webhook.route.ts` | `webhook.route.ts`; `waba-webhook.route.ts` | **OPEN** | — | Pipeline ingress WAHA dan WABA masih menduplikasi logika guard, sanitasi, dan pre-logging di dua file terpisah. |
| **ING-11** | Rendah | `app.ts:241-267`; `worker.ts:90-110` | `app.ts:290`; `worker.ts:75` | **FIXED** | Fase S2 (S2.4) | Logika inisialisasi boot disatukan di `src/lifecycle/tenant-bootstrap.ts` dan dipanggil bersama oleh app HTTP dan background worker. |
| **ING-12** | Rendah | `worker.ts:46-59` | `worker.ts:40-70` | **FIXED** | Fase S2 (S2.5) | Urutan graceful shutdown worker diselaraskan: cron stop → burst flush → queue close → LLM buffer flush → advisory lock release → DB disconnect. |
| **ING-13** | Rendah | `webhook.route.ts:60-62` | `webhook.route.ts:60-62` | **OPEN** | — | `handleLabelChatEvent` menelan error penandaan label dengan `console.warn` tanpa mekanisme outbox atau retry bila DB blip. |
| **ING-14** | Rendah | `waha-tenant.service.ts:53-57` | `waha-tenant.service.ts:53-57` | **OPEN** | — | Resolusi tenant berdasarkan session WAHA melakukan fallback ke `DEFAULT_TENANT_ID` bila basis data sedang offline. |
| **ING-15** | Rendah | `waba-webhook.route.ts:40-61` | `waba-webhook.route.ts:40-61` | **OPEN** | — | Route WABA melakukan query `prisma.tenant.findUnique` untuk mengambil app secret sebelum memvalidasi payload signature. |
| **ING-16** | Rendah | `webhook.route.ts:16` | `webhook.route.ts:16` | **OPEN** | — | `webhook.route.ts` mengimpor `memoryAdClicks` langsung dari `tracking.route.ts` (kopling antar-rute). |
| **ING-17** | Rendah | `webhook.route.ts:194` | `webhook.route.ts:196` | **OPEN** | — | Pemotongan ID pesan pada event revoke masih memakai chain `.replace()` manual alih-alih fungsi kanonis `extractShortMessageId`. |
| **ING-18** | Rendah | `tests/` (cakupan ingress) | `tests/unit/fase5-*.ts`, `readiness-probe.test.ts` | **PARTIAL** | Fase S1, S2 | Idempotensi retry saat enqueue gagal dan readiness WABA-only sudah memiliki test khusus; pengetesan event label tenant B masih perlu dilengkapi. |

---

## 3. Backlog Terbuka (Open Backlog) Pasca-Rebaseline

Seluruh **81 temuan OPEN** dikelompokkan berdasarkan tingkat urgensi dan domain arsitektur untuk diprioritaskan pada tahapan selanjutnya:

### A. Prioritas Kritis & Tinggi (Safety, Integritas Data & Tenant)
1. **CFG-01**: Perbaiki `NON_MEDICAL_PHRASES` di `src/config/medical-keywords.ts` agar pengecualian frasa "step by step" tidak membungkam deteksi keyword medis darurat (`kejang`, `demam`, dsb.).
2. **UTL-01**: Hapus nilai default tanggal Juli (`let month = 6`) pada `src/utils/conversation-transaction-extractor.ts` agar input tanpa tanggal mengembalikan `null`, bukan tanggal fiktif.
3. **UTL-04**: Pasang host allowlist resmi Google Maps pada `src/utils/google-maps-url-resolver.ts` untuk mencegah celah Server-Side Request Forgery (SSRF).
4. **UTL-05**: Hapus flag `/g` dari `FOREIGN_SCRIPT_RE` pada `src/utils/language-sanitizer.ts` agar evaluasi `.test()` deterministik tanpa terpengaruh `lastIndex`.
5. **D-01**: Tambahkan partial unique index `(tenant_id, customer_id) WHERE closed_at IS NULL` dan penanda conversation aktif di `prisma/schema.prisma`.
6. **D-02**: Alihkan seluruh mutasi customer di `customer.service.ts` agar melalui `CustomerRepository` seam terpusat.
7. **D-03**: Tambahkan parameter `tenantId` pada `CustomerRepository.update` untuk mencegah penulisan data lintas tenant.
8. **CFG-02**: Salin `persona_custom.txt` ke container image pada `Dockerfile` untuk mencegah drift persona development vs produksi.
9. **CFG-04**: Migrasikan template follow-up dan media watermark dari `getBrandIdentity()` sinkron ke `getBrandIdentityAsync(tenantId)`.
10. **CFG-05**: Gunakan `getClinicLocationAsync(tenantId)` sebagai origin kalkulasi ongkir di `delivery.service.ts` menggantikan koordinat global.

### B. Prioritas Sedang (Efisiensi Query, Clean Code & Modularitas)
1. **D-04**: Satukan 3 round-trip query `updateState` dan `flagForReview` di `conversation.repository.ts` menjadi 1 query update bertipe.
2. **D-05 & D-06**: Buat interface kontrak `TurnRepository` dengan tipe Prisma kuat dan cegah klaim ganda worker saat Redis offline.
3. **D-07**: Optimalkan pencarian ID pesan di `message.repository.ts` agar tidak menggunakan leading wildcard `endsWith`.
4. **CFG-08**: Bersihkan 33 template mati (*dead code*) di `src/config/persona.ts`.
5. **CFG-09**: Pindahkan 800 baris data koordinat landmark dari `landmarks.ts` ke basis data atau gazetteer terstruktur.
6. **CFG-10 & UTL-11**: Satukan modul utilitas konversi waktu WIB ke satu modul kanonis tunggal `src/utils/time-wib.ts`.
7. **CFG-14**: Pasang Time-To-Live (TTL) pada cache memori brand, lokasi klinik, dan promo di modul konfigurasi.
8. **UTL-03**: Pecah modul God Object `reservation-text-parser.ts` (1.148 baris) menjadi modul-modul parser terspesialisasi.
9. **UTL-14**: Optimalkan rehidrasi log buffer agar membaca tail file berbasis byte stream daripada membaca seluruh file ke RAM.
10. **UTL-16**: Perbaiki `flushLlmAuditBuffer` agar tidak membuang record sebelum penyimpanan basis data berhasil.
11. **DOM-01**: Klarifikasi semantik `ACTIVE_RESERVATION_STATUSES` agar status pending/hold lama tidak dianggap aktif tanpa batas waktu.
12. **DOM-02**: Pecah modul God Object `customer-address.ts` (620 baris) menjadi sub-modul deduplikasi, skema, dan rekonsiliasi.
13. **ING-09**: Ganti pengabaian error log outbound di `webhook.route.ts` dengan antrean durable outbox.
14. **ING-10**: Satukan duplikasi alur pipeline pesan masuk WAHA dan WABA ke satu service `messageIngressService`.

### C. Prioritas Rendah (Pembersihan Teknis & Kelengkapan Test)
- Bersihkan dead code (D-13 `dataToUpdate`, DOM-14 `cohortN === 0`, UTL-20 `minChunkSize`).
- Tambahkan unit test khusus untuk repository seam (D-18), utilitas parsing/keamanan (UTL-25), dan skenario cross-tenant label event (ING-18).
- Standarisasi penanganan error dan fallback (D-11, ING-13, ING-14, ING-15, ING-16, ING-17).
