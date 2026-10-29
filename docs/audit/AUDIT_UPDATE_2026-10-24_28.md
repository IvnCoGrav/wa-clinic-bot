# AUDIT UPDATE KODE 2026-10-24 → 2026-10-28

**Jenis audit:** audit sistem berlapis (Tahap 0–6) atas 11 commit terakhir di `master`.
**Sifat:** baca-saja. Tidak ada file sumber yang diubah oleh audit ini.
**Tanggal audit:** 2026-10-29.

---

## 1. Ringkasan Eksekutif

Kualitas implementasi teknis **baik**: `tsc --noEmit` bersih, 121 test relevan hijau, tidak ada dependency runtime baru, tidak ada `window.confirm/alert`, migrasi DB aditif dan aman. Namun ditemukan **3 pelanggaran mandat** (hardcode data bisnis, dual-source-of-truth, kontrak yang menyalahi dokumentasinya sendiri), **1 masalah isolasi tenant**, dan **1 masalah proses** (commit "refactor" yang berisi perubahan perilaku backend).

Prioritas 3 teratas:
1. **A-013** — `customers.subroute.ts` masih memakai `DEFAULT_TENANT_ID` di 15+ titik → kebocoran data lintas tenant (keamanan).
2. **A-001** — jendela analitik & kapasitas terapis di-hardcode (`2025-08`, `2026-01`, `4 slot`) → melanggar Mandat Non-Hardcode & SaaS-readiness.
3. **A-002/A-003/A-014** — deteksi mismatch pembayaran memakai `purchase_value + ongkir` **tanpa `discount_amount`**, logikanya **diduplikasi** di frontend lewat parsing tag `raw_text`, dan `discount_amount` sendiri **tidak pernah ditulis** oleh kode mana pun.

Catatan tambahan: **A-004** — hierarki ongkir mengangkat estimasi chat (yang labelnya sendiri "bukan fakta resmi") **di atas** ongkir resmi, tanpa TTL/ikatan alamat.

---

## 2. Framework & Cakupan

| Aspek | Pilihan | Alasan |
|---|---|---|
| Arsitektur & keandalan | AWS Well-Architected (operational excellence, reliability) | perubahan menyentuh alur uang, analytics, dan data pelanggan |
| Kualitas kode | ISO/IEC 25010 (maintainability, correctness) | menilai duplikasi logika, dokumentasi, dan drift kontrak |
| Keamanan | OWASP ASVS (level subset: input, otorisasi, data exposure) | ada PII, export, dan endpoint admin |
| Kepatuhan repo | Checklist `AGENTS.md` (non-hardcode, fondasional, tenant-aware, seam kanonis, regression gate) | mandat internal |

**Ruang lingkup (11 commit, 2026-10-24 → 2026-10-28):**
`d3b9c816` (delivery), `e2ae2b86` (payment), `513275a9` (nama), `ffece481` (analytics), `aacd9cd3` (address/child), `3a34b269` (docs), `c9cbf1e1` (refactor 43 file), `1749c8f5` (dashboard), `8c1dd757` (kohort), `ddf5f8f1` (nama/pushname), `0103714a` (pindah skrip), `4e366631` (analytics).

**Celah cakupan:**
- Tidak memeriksa UI secara visual (hanya kode).
- Tidak memeriksa data produksi (tidak ada akses DB live) → semua klaim tentang isi data bertanda `[ASUMSI]`.
- Log mesin `logs/llm-*.jsonl` tidak relevan untuk perubahan ini (tidak menyentuh prompt/RAG).
- Commit sebelum 2026-10-24 tidak diaudit.

---

## 3. Status Temuan Lama (`docs/KNOWN_ISSUES.md`)

| ID | Temuan | Status klaim | Verifikasi audit |
|---|---|---|---|
| 275 | Duplikasi alamat (split-brain) & anak duplikat | RESOLVED | **SEBAGIAN** — perbaikan ada (`aacd9cd3`), tetapi dedup anak belum atomik (A-006) dan aturan merge alamat dilonggarkan (A-005) |
| 274 | Skrip backfill tidak bisa jalan di container | OPEN | **MASIH TERBUKA** — `0103714a` memindahkan *satu* skrip ke `src/scripts/`; skrip lain di `scripts/` masih tidak ikut image |
| 276 | Formula conversion rate tidak valid | OPEN | **MASIH TERBUKA** — tidak tersentuh |
| 277 | Ulasan hardcoded di landing | OPEN | **MASIH TERBUKA** |
| — | ID ganda `272` (persona RESOLVED & CAPI) | — | **BARU**: dua entri memakai nomor 272 → rujukan ambigu |

---

## 4. Daftar Temuan

### A-001 — Data bisnis di-hardcode di mesin analitik (HORIZONTAL, **TINGGI**)

- **Lokasi:** `src/services/meta-performance-analytics.service.ts:566-568`, `:1380-1384`; test `tests/unit/meta-performance-analytics.test.ts` (test "mengecualikan outlier 2025-08").
- **Bukti:**
  ```ts
  .filter((m) => m !== '2025-08' && m >= '2026-01')
  if (!allMonths.includes(currentWibMonth) && currentWibMonth >= '2026-01')
  const dailySlotsPerTherapist = ... ?? 4;
  ```
- **Keyakinan:** TERBUKTI.
- **Pemetaan:** AGENTS.md Mandat Non-Hardcode & SaaS-readiness; ISO 25010 maintainability.
- **Akar masalah (5 Whys):** angka bulan muncul sebagai "koreksi data bentrok" → tidak ada konfigurasi periode analitik per tenant → developer menambal di kode → test mengunci tambalan → tenant kedua akan mewarisi outlier/limit klinik pertama.
- **Risiko:** dashboard tenant lain menampilkan kohort salah; kapasitas terapis dianggap 4/hari padahal bisa 6; KPI direksi salah.
- **FMEA:** S=6 O=8 D=6 → **RPN 288**.
- **Catatan:** `dailySlotsPerTherapist` **sudah** dibaca dari `tenantSettings` (baris 1381-1383); yang salah hanya fallback `4` dan ketiadaan status "belum dikonfigurasi".
- **Rekomendasi:** pindahkan ke `Tenant.settings.metaPerformanceSettings` (`cohortStartMonth`, `excludedCohortMonths[]`, `dailySlotsPerTherapist`), fallback `null` + badge `UNKNOWN` (bukan 4). Hapus test yang mengunci `'2025-08'`; ganti dengan test injeksi config.
- **Verifikasi:** unit test dengan dua tenant berbeda config menghasilkan baris kohort berbeda; grep `2026-01|2025-08` di `src/` = 0 hit.

### A-002 — `totalExpected` mengabaikan diskon & memakai kesetaraan persis (VERTIKAL, **TINGGI**)

- **Lokasi:** `src/services/customer-payment-proof.service.ts:180-200`; dashboard `packages/admin-dashboard/src/utils/paymentProof.ts`.
- **Bukti:**
  ```ts
  const totalExpected = existingPurchaseValue + deliveryFee;
  if (signal.amount !== totalExpected) isMismatch = true;
  ```
  `discount_amount` **tidak pernah** dipakai di jalur ini (satu-satunya pemakaian: `src/services/sheets/row-formatter.ts:172`).
- **Keyakinan:** TERBUKTI untuk kode; **KEMUNGKINAN BESAR** untuk dampak (tergantung apakah `purchase_value` diisi net atau gross).
- **Pemetaan:** ISO 25010 correctness; Well-Architected reliability (false alert).
- **Akar masalah:** tagihan kanonis tidak punya satu fungsi tunggal ("berapa yang harus dibayar?") → tiap modul menghitung sendiri → diskon, kode unik transfer, dan pembayaran bertahap tidak terwakili.
- **Risiko:** badge merah + `needs_staff_verification` pada pelanggan yang **sudah benar** membayar (diskon repeat order). Staf terbiasa mengabaikan badge → alarm fatigue → mismatch asli lolos.
- **Koreksi audit lanjutan:** `discount_amount` ternyata **tidak pernah ditulis** oleh kode mana pun (lihat A-014). Jadi dampak A-002 saat ini **laten** (diskon selalu 0), bukan aktif — tetapi rumusnya tetap harus diperbaiki sebelum fitur diskon dipakai.
- **FMEA:** S=7 O=6 D=5 → **RPN 210** (turun efektif selama diskon belum bisa diisi).
- **Rekomendasi:** buat seam `resolveExpectedPayment(reservation)` di `src/domain/` yang mengembalikan `{gross, discount, net, tolerance}`; `net = purchase_value - discount_amount + delivery_fee`; toleransi eksplisit (mis. ±Rp 1 untuk pembulatan, atau `receipt_amount` terpisah untuk kode unik). Backend mengirim `paymentEvaluation` ke FE.
- **Verifikasi:** 6 test: diskon 0, diskon 50k, kode unik +3, bayar dua kali (parsial), ongkir promo, bukti terbaca null.

### A-003 — Logika mismatch diduplikasi FE↔BE; FE bergantung pada tag `raw_text` (HORIZONTAL, **SEDANG-TINGGI**)

- **Lokasi:** `src/services/customer-payment-proof.service.ts` vs `packages/admin-dashboard/src/utils/paymentProof.ts` (baru, 118 baris).
- **Bukti:** FE menghitung ulang `isMismatch` dari `receipt_amount` **atau** regex `/\[RECEIPT_AMOUNT:(\d+)\]/` atas `raw_text`; BE punya definisi sendiri (`signal.amount !== totalExpected`). Perbedaan yang sudah ada: BE menandai mismatch walau `totalExpected <= 0`, FE tidak.
- **Keyakinan:** TERBUKTI.
- **Pemetaan:** AGENTS.md "satu seam kanonis per operasi".
- **Akar masalah:** API detail reservasi tidak menyertakan hasil evaluasi, sehingga FE terpaksa menyimpulkan sendiri.
- **Risiko:** badge di dashboard dan keputusan backend bisa berbeda; perubahan format tag `raw_text` memecah FE tanpa test backend.
- **FMEA:** S=5 O=7 D=6 → **RPN 210**.
- **Rekomendasi:** backend mengirim `paymentEvaluation: {expected, receipt, status, difference}`; FE hanya merender. Hapus parsing `raw_text` di FE.
- **Verifikasi:** test kontrak: satu fixture reservasi → payload API memuat `paymentEvaluation`; FE test merender badge dari payload, bukan hitung sendiri.

### A-004 — Hierarki ongkir menaikkan estimasi chat di atas ongkir resmi (VERTIKAL, **SEDANG-TINGGI**)

- **Lokasi:** `src/services/customer.service.ts:2755-2795` (`getLastDeliveryFee`), penulis estimasi `src/services/human-background-enrichment.service.ts:214-219`.
- **Bukti:** doc-comment fungsi menyatakan prioritas "snapshot reservasi → `Customer.ongkir`", tetapi kode menyisipkan `preferences.distance_estimate.ongkir` **sebelum** `Customer.ongkir` (komentar penomoran mulai dari "Prioritas Kedua" tanpa "Pertama"). Penulis estimasi sendiri menulis log: *"angka chat admin, bukan fakta resmi"*, dan menyimpan `at` (timestamp) yang **tidak** dicek saat dibaca. `addrs.find(a => a.isPrimary) || addrs[0]` tidak memakai `resolveActiveAddress` yang sudah ada di `src/domain/customer-address.ts`.
- **Keyakinan:** TERBUKTI (kode & komentar bertentangan); **KEMUNGKINAN BESAR** (dampak).
- **Pemetaan:** AGENTS.md seam kanonis; Well-Architected reliability/cost.
- **Akar masalah:** "promo ongkir" butuh kanal penyimpanan sementara, lalu dipakai sebagai sumber otoritatif tanpa masa berlaku dan tanpa ikatan ke alamat.
- **Risiko:** booking baru ke alamat berbeda memakai ongkir promo lama → klinik rugi atau pasien ditagih salah; `addrs[0]` bisa kartu alamat non-aktif.
- **FMEA:** S=7 O=5 D=6 → **RPN 210**.
- **Rekomendasi:** `distance_estimate` diberi `expires_at` + `address_key` (hash alamat/koordinat); hanya dipakai bila cocok alamat & belum kedaluwarsa; gunakan `resolveActiveAddress`; perbaiki doc-comment.
- **Verifikasi:** test: estimasi 30 hari lalu → diabaikan; estimasi alamat A dipakai untuk booking alamat B → diabaikan.

### A-005 — Pelonggaran aturan merge alamat bisa menggabungkan dua rumah (VERTIKAL, **SEDANG**)

- **Lokasi:** `src/domain/customer-address.ts:192-196`, `:201`.
- **Bukti:** di dalam cabang `sameStreet && kotaKompatibel && within3km`, ditambahkan:
  ```ts
  const isSpecificStreet = norm(a.address).length >= 15 ||
    /\b(?:no|nomor|blok|gang|gg|cluster|perum|perumahan|rt|rw)\b/i.test(a.address || '');
  if (isSpecificStreet) return true;
  ```
  Efeknya: kecamatan berbeda tidak lagi menghalangi merge asalkan teks jalan identik dan sentroid ≤3 km.
- **Keyakinan:** TERBUKTI untuk perilaku; **DUGAAN** untuk frekuensi kasus.
- **Pemetaan:** ISO 25010 correctness; AGENTS.md larangan heuristik ad-hoc untuk keputusan data.
- **Akar masalah:** kasus "batas kecamatan bergeser karena reverse-geocoding" diselesaikan dengan pelonggaran aturan global, bukan dengan memisahkan *identitas alamat* dari *toponimi*.
- **Risiko:** dua rumah berbeda di perumahan yang sama (tanpa nomor blok) ter-merge → ongkir & riwayat treatment menempel ke rumah salah.
- **FMEA:** S=7 O=4 D=7 → **RPN 196**.
- **Rekomendasi:** batasi pelonggaran pada kasus **ada nomor/blok** (bukan `panjang >= 15`), atau minta konfirmasi admin saat merge lintas kecamatan; simpan `merged_by_rule` untuk audit.
- **Verifikasi:** test negatif: `"Perumahan Mutiara"` (tanpa nomor) di dua kecamatan berbeda → **tidak** match.

### A-006 — Dedup anak tidak atomik; `reservation_id` ditimpa (HORIZONTAL, **SEDANG**)

- **Lokasi:** `src/services/child.service.ts:44-76`.
- **Bukti:** `findFirst` (case-insensitive) → `update`/`upsert`; tidak dalam transaksi; `update` menulis `reservation_id: reservationId ?? existingChild.reservation_id` sehingga tautan ke reservasi pertama hilang. Ada guard `typeof prisma.child.findFirst === 'function'` yang ada hanya karena mock test.
- **Keyakinan:** TERBUKTI.
- **Pemetaan:** Well-Architected reliability (concurrency).
- **Akar masalah:** unique index `(customer_id, name)` case-sensitive, sedangkan kebutuhan bisnis case-insensitive → diselesaikan di application layer tanpa constraint DB.
- **Risiko:** webhook retry paralel tetap bisa membuat 2 baris; riwayat anak pindah ke reservasi terakhir.
- **FMEA:** S=5 O=5 D=6 → **RPN 150**.
- **Rekomendasi:** normalisasi nama anak (`lower(trim())`) ke kolom `name_norm` + unique index; pertahankan `first_reservation_id` terpisah dari `last_reservation_id`.
- **Verifikasi:** test dua panggilan konkuren (`Promise.all`) → 1 baris.

### A-007 — Commit "refactor(ui)" memuat perubahan perilaku backend (PROSES, **SEDANG**)

- **Lokasi:** `c9cbf1e1` (43 file dashboard + 8 file backend + `tests/setup.ts`).
- **Bukti:** di dalam commit berlabel *"refactor(ui): eliminate AI slop"* terdapat: `analytics.subroute.ts` pindah dari `DEFAULT_TENANT_ID` → `tenantOf(request)`; `livechat.subroute.ts` menambah `total`; `reservation-crud.route.ts` mengubah kontrak `GET /api/admin/reservations/count` (parameter `date`, `refresh`, cache key, semantik `created_at`); `conversation.service.ts` menambah `prisma.conversation.count`.
- **Keyakinan:** TERBUKTI.
- **Pemetaan:** AGENTS.md staged-phase & blast radius; code review hygiene.
- **Risiko:** `git revert` untuk masalah UI ikut membatalkan perbaikan tenant isolation; sulit di-bisect.
- **FMEA:** S=4 O=6 D=7 → **RPN 168**.
- **Rekomendasi:** (kebijakan) commit refactor tidak boleh menyentuh `src/` kecuali komentar; perubahan perilaku → commit terpisah dengan test. Untuk histori, catat di CHANGELOG bahwa `c9cbf1e1` memuat perubahan backend.
- **Verifikasi:** `git show <commit> -- src/ | grep '^[+-]' | grep -v '^[+-]\s*//'` harus kosong untuk commit berlabel refactor.

### A-008 — Definisi metrik MQL/CAC/kampanye berubah tanpa dokumentasi definisi (VERTIKAL, **SEDANG**)

- **Lokasi:** `src/services/meta-performance-analytics.service.ts:1049-1120` (`isMqlInPeriod`, `rangeMatchedCustomerIds` dipakai untuk `campaignDetail`).
- **Bukti:** MQL periode kini = `mql_triggered_at` dalam rentang **atau** customer yang match di rentang; atribusi kampanye kini hanya atas `rangeMatchedCustomerIds` (sebelumnya `cohortCustomerIds`).
- **Keyakinan:** TERBUKTI untuk perubahan; **KEMUNGKINAN BESAR** untuk perubahan angka historis.
- **Pemetaan:** ISO 25010 correctness; tata kelola KPI.
- **Risiko:** angka CAC/konversi bulan lalu berubah setelah deploy → laporan ke pemilik klinik tidak konsisten antar-waktu.
- **FMEA:** S=5 O=6 D=7 → **RPN 210**.
- **Rekomendasi:** tulis definisi metrik di `docs/` (versi + tanggal berlaku) dan tampilkan tooltip definisi di UI; simpan snapshot KPI bulanan bila dipakai untuk keputusan.
- **Verifikasi:** test yang mengunci definisi + satu test "periode sebelum perubahan" memakai fixture tetap.

### A-009 — CHANGELOG/INDEX tidak mencatat 5 commit fitur (PROSES, **RENDAH-SEDANG**)

- **Bukti:** `docs/changelog/INDEX.md` hanya memuat 2026-10-25 dan 2026-10-28; `e2ae2b86` (payment), `d3b9c816` (delivery), `aacd9cd3` (address/child), `ffece481`/`8c1dd757`/`4e366631` (analytics), `c9cbf1e1` (refactor) tidak tercatat.
- **Keyakinan:** TERBUKTI.
- **Rekomendasi:** tambahkan entri retroaktif (tanggal commit asli) + 1 baris "definisi metrik berubah" untuk A-008.
- **FMEA:** S=3 O=7 D=4 → **RPN 84**.

### A-010 — Nomor `KNOWN_ISSUES` ganda (PROSES, **RENDAH**)

- **Bukti:** entri `## 272` muncul dua kali (persona RESOLVED dan CAPI).
- **Rekomendasi:** renumber entri CAPI menjadi 272b/278 dan perbarui rujukan.
- **FMEA:** S=2 O=6 D=4 → **RPN 48**.

### A-011 — Blacklist kata klinis di validator nama anak (HORIZONTAL, **RENDAH**)

- **Lokasi:** `src/utils/name-sanitizer.ts` (`isValidChildName`: `hamil|nifas|nebul|pasca vaksin`).
- **Catatan:** masih berupa daftar kata (bukan state/relasi), tetapi berfungsi sebagai filter label formulir — **bukan** penentu intent. Diterima dengan catatan: harus diuji adversarial agar tidak menolak nama anak sah.
- **FMEA:** S=4 O=2 D=3 → **RPN 24**.

### A-012 — Kontrak identitas pelanggan belum ditegakkan di semua penulis (HORIZONTAL, **SEDANG**)

- **Lokasi:** `src/services/customer.service.ts:1076` (`updateCustomer`) dan `src/routes/admin/reservation-dispatch.route.ts:1245` (`custUpdate.name = customerName`) menulis `Customer.name` tanpa provenance/shield.
- **Keyakinan:** TERBUKTI.
- **Risiko:** perbaikan `ddf5f8f1` bisa dibobol dari jalur edit reservasi admin.
- **FMEA:** S=5 O=5 D=6 → **RPN 150**.
- **Rekomendasi:** lihat `docs/plans/PLAN_OTORITAS_IDENTITAS_PELANGGAN_2026-10-29.md` Phase 4.

### A-013 — `customers.subroute.ts` masih bocor lintas tenant (HORIZONTAL, **TINGGI**)

- **Lokasi:** `src/routes/admin/customers.subroute.ts` — **26 pemakaian** `DEFAULT_TENANT_ID` (di luar baris import): 229, 260, 312, 339, 436, 606, 961, 973, 1012, 1071, 1092, 1136, 1162, 1204, 1246, 1278, 1284, 1299, 1449, 1458, 1497, 1545, 1579, 1645, 1660, 1715.
- **Bukti:** hook admin sudah menetapkan `request.tenantId` dari `x-tenant-id` (`src/routes/admin.route.ts:114,157`), dan handler lain di file yang sama memakai `tenantOf(request)` (baris 34, 82, 156, 462, 637, …). Namun endpoint pesan, jadwal aktif, event Meta, blokir, label, AI override, dan audience export tetap membaca `DEFAULT_TENANT_ID`.
- **Keyakinan:** TERBUKTI.
- **Dampak:** tenant kedua dapat membaca pesan/alamat/riwayat customer tenant pertama, dan event Meta dapat dikirim dengan `tenant_id` salah.
- **Rekomendasi:** Phase 1 di `docs/plans/PLAN_REMEDIASI_AUDIT_2026-10-29.md`.
- **FMEA:** S=8 O=6 D=4 → **RPN 192**.

### A-014 — `discount_amount` adalah kolom mati (VERTIKAL, **SEDANG**)

- **Lokasi:** `prisma/schema.prisma:303`; hanya dibaca di `src/services/sheets/row-formatter.ts:172` dan `sheets-sync.service.ts:49`.
- **Bukti:** pencarian seluruh repo (`*.ts`, `*.tsx`, `*.prisma`, di luar `node_modules`) tidak menemukan **satu pun** penulis `discount_amount` — tidak di route admin, tidak di service, tidak di form. `InvoiceGeneratorModal.tsx` menghitung diskon untuk tampilan invoice, tetapi tidak menyimpannya.
- **Keyakinan:** TERBUKTI.
- **Dampak:** diskon repeat order tidak pernah tersimpan; Sheets selalu menampilkan kolom diskon kosong; A-002 saat ini tidak berdampak pada data nyata (diskon selalu 0), tetapi akan berdampak begitu fitur diskon dipakai.
- **Rekomendasi:** Phase 2.6 — tambah `discountAmount` di `PATCH /api/admin/reservation/:id` + field di modal edit.
- **FMEA:** S=5 O=5 D=4 → **RPN 100**.

### A-015 — FE masih mem-parse `raw_text` untuk nominal struk (HORIZONTAL, **RENDAH-SEDANG**)

- **Lokasi:** `packages/admin-dashboard/src/utils/paymentProof.ts:53-61`; `src/services/live-chat.service.ts:13,1304`.
- **Bukti:** keduanya memiliki fallback regex `[RECEIPT_AMOUNT:(\d+)]` atas `raw_text` ketika `receipt_amount` null. Artinya format tag internal menjadi kontrak tersembunyi antara backend dan frontend.
- **Keyakinan:** TERBUKTI.
- **Dampak:** perubahan format tag (atau pembersihan `raw_text`) memecah badge dashboard tanpa test backend.
- **Rekomendasi:** Phase 2 — hapus fallback, kirim `paymentEvaluation` dari backend.

---

## 5. Temuan Positif (kepatuhan yang sudah benar)

| Aspek | Bukti |
|---|---|
| Typecheck bersih | `npx tsc --noEmit` exit 0 (2026-10-29) |
| Test relevan hijau | 121 test / 10 file lulus (lihat §6) |
| Zero dependency baru | diff `package.json` 2026-10-20→29 hanya script eval |
| Tidak ada `window.confirm/alert` | grep dashboard: hanya komentar & komponen `UiFeedback` |
| Migrasi aman | `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, index aditif (`20261024000000_add_receipt_amount`) |
| Tenant-aware (arah benar) | `analytics.subroute.ts` pindah ke `tenantOf(request)`; `meta-performance-analytics` memfilter `tenant_id` |
| Skrip tidak duplikat | `scripts/audit/heal-non-human-customer-names.ts` sudah **tidak ada** setelah `0103714a` (tidak ada dua sumber kebenaran) |
| WAHA label tidak disentuh | tidak ada perubahan pada label WAHA di rentang audit |
| Perbaikan nama nyata | `ddf5f8f1` menutup celah `A_31`/`ay719` (terverifikasi di `name-sanitizer.ts:78-90`) |

---

## 6. Verifikasi yang Dijalankan

```
npx tsc --noEmit                          -> exit 0 (0 error)
npx vitest run tests/unit/customer-name-protection.test.ts \
  tests/unit/meta-performance-analytics.test.ts \
  tests/unit/customer-payment-proof-mismatch.test.ts \
  tests/unit/customer-delivery-fee-resolver.test.ts \
  tests/unit/child-service.test.ts \
  tests/unit/reservation-count-date.test.ts \
  tests/unit/livechat-total.test.ts \
  tests/unit/dashboard-metrics.test.ts \
  tests/unit/admin-analytics-tenant.test.ts \
  tests/unit/name-sanitizer.test.ts
  -> 10 file / 121 test PASS
```

Catatan: suite penuh (`npm test`) **tidak** dijalankan dalam audit ini (waktu). Klaim "semua hijau" pada CHANGELOG 2026-10-28 hanya mencakup 4 suite yang disebut di sana — bukan suite penuh.

---

## 7. Rencana Perbaikan Berurutan (berdasar RPN & ketergantungan)

> Detail mikro (file, baris, blok kode, perintah, acceptance criteria, FMEA per fase) ada di `docs/plans/PLAN_REMEDIASI_AUDIT_2026-10-29.md`.

| Urutan | Temuan | Aksi | Risiko | Rollback |
|---|---|---|---|---|
| 1 | A-013 | Ganti `DEFAULT_TENANT_ID` → `tenantOf(request)` di `customers.subroute.ts` | endpoint 401 massal | revert commit |
| 2 | A-002 → A-003 → A-014 | Buat `resolveExpectedPayment` (domain), pakai di backend, kirim `paymentEvaluation` ke FE, hidupkan `discountAmount` | salah hitung tagihan | feature-flag: badge fallback ke `unverified_gray` |
| 3 | A-001 | Config tenant `metaPerformanceSettings` (cohortStart, excludedMonths, dailySlots) + hapus test outlier hardcoded + seed eksplisit | dashboard tenant lama berubah angka | seed config = perilaku sekarang |
| 4 | A-004 | `expires_at` + `address_key` pada `distance_estimate`; pakai `resolveActiveAddress` | ongkir promo berhenti terpakai | kembalikan urutan via flag |
| 5 | A-005 | Batasi merge lintas kecamatan pada alamat bernomor | alamat duplikat muncul lagi | flag `strictAddressMerge` |
| 6 | A-012 | Konvergensi penulis nama (plan identitas) | nama tidak ter-update | seam fallback ke perilaku lama |
| 7 | A-006 | `name_norm` + unique index anak | migrasi | aditif |
| 8 | A-007, A-008, A-009, A-010, A-011, A-015 | Perbaikan proses/dokumentasi + hapus parsing `raw_text` | - | - |

**Pre-mortem (perbaikan gagal):** A-001 gagal karena `Tenant.settings` ditulis modul lain yang menimpa JSON penuh (`merge` bukan `replace`); A-002 gagal karena `purchase_value` ternyata **sudah net** sehingga diskon terpotong dua kali → wajib dicek dulu ke data produksi sebelum menulis rumus.

---

## 8. Batasan & Asumsi

- `[ASUMSI-1]` `purchase_value` diisi **gross** (harga katalog) dan diskon disimpan terpisah di `discount_amount` → dasar A-002. **Perlu verifikasi 3 baris data produksi** sebelum implementasi.
- `[ASUMSI-2]` `distance_estimate` ditulis untuk alamat yang sedang dibahas saat itu → dasar A-004.
- Tidak ada akses DB produksi, Meta Events Manager, maupun dashboard live pada audit ini.
- Tidak ada pemeriksaan visual UI, Lighthouse, atau performa runtime.
- Skor FMEA adalah penilaian auditor (1–10), bukan pengukuran.
