# Plan: Bidan Scorecard (Penilaian + Verifikasi via Admin)

- **Tanggal:** 2026-11-19
- **Status:** **F1–F6 SELESAI (2026-11-20).** F1: skema + domain nilai. F2: collector bukti + backfill. F3: policy penilaian + tab admin. F4: antrean verifikasi bukti chat. F5: agregasi + snapshot FINAL immutable. F6: endpoint `/api/staff/scorecard/me` + halaman Raport Bidan mobile. Migrasi belum diterapkan (DB lokal tidak tersedia). F7 (klasifikasi AI chat) opsional, belum dikerjakan; F8 rollout menunggu migrasi.
- **Prototipe acuan:** `docs/audit/2026-11-19/dashboard-bidan-mobile.html`, `docs/audit/2026-11-19/raport-bidan-v2.html`
- **Temuan audit:** `docs/KNOWN_ISSUES.md` #359

---

## 0. Tujuan

Mengubah prototipe dashboard bidan menjadi modul produksi:

1. **Skor per bidan** dari tiga komponen: ketepatan waktu, retensi, volume kunjungan.
2. **Pengaturan tenant** untuk bobot, ambang grade, target harian, dan sumber benchmark.
3. **Verifikasi admin** atas bukti yang bersifat inferensial (pesan customer), sebelum masuk snapshot.
4. **Satu definisi kanonis** untuk dashboard bidan, raport owner, dan payroll.

**Non-tujuan (fase ini):** perhitungan insentif/gaji, notifikasi real-time ke customer, dan perubahan pada alur chat customer.

---

## 1. Temuan verifikasi kode (wajib dibaca sebelum eksekusi)

| # | Temuan | Bukti | Dampak |
|---|---|---|---|
| T1 | Retensi kanonis sudah ada | `src/services/staff-retention.service.ts`, `RetentionPolicy` (`benchmark_pct=34.6`, `min_sample=40`, window 60 hari) | Dashboard prototipe memakai benchmark 16% dan sampel 21 → **konflik definisi** |
| T2 | `arrived_at` hanya ditulis satu tempat | `src/services/staff-reservation.service.ts:2317` (`recordArrival`) | Tidak ada jalur lain; admin dashboard belum punya tombol arrival |
| T3 | Penyelesaian kunjungan tidak digerbang | `completeTask` tidak memeriksa `arrived_at` | Bidan bisa menutup kunjungan tanpa jam |
| T4 | Bypass overdue di UI staf | `taskAction.ts:53` (`arrivedAt \|\| isScheduleOverdue → complete`) | Saat telat, tombol selesai muncul tanpa kedatangan |
| T5 | Geofence tersedia tapi dibuang | `today.subroute.ts:746-747`, radius 50 m, 2 ping, interval 25 dtk | Bisa jadi auto-arrival tanpa edukasi |
| T6 | Pola settings aman sudah ada | `src/services/tenant-settings.store.ts` (deep merge + OCC) | Konfigurasi baru sebaiknya memakai pola ini atau tabel policy versioned |
| T7 | Admin UI punya parent yang tepat | `StaffManagement.tsx` (tab STAFF \| ROLES), `Settings.tsx` (panel) | Tidak perlu page baru; cukup tab |
| T8 | Belum ada UI untuk `staff-retention` | Hanya `actionPermissions.ts` yang menyebutnya | Verifikasi/policy belum punya layar |
| T9 | Belum ada modul kanonis scorecard | `npm run find:module -- "raport kinerja bidan"` → tidak ditemukan | Perlu modul baru + registrasi `scripts/module-registry.json` |
| T10 | Presisi bukti chat | Uji 57 kunjungan: 10 sinyal >30 mnt, **10 benar, 0 salah** | Layak dipakai, tapi tetap perlu review admin untuk kasus batas |

---

## 2. Keputusan (SUDAH DIKUNCI 2026-11-19)

| # | Keputusan | Nilai |
|---|---|---|
| D1 | Definisi retensi | **Policy kanonis** (`RetentionPolicy`: benchmark 34,6%, min sampel 40, min masa kerja 4 bulan). Angka 30 hari hanya *preview* berlabel, tidak masuk nilai |
| D2 | Ambang bukti chat | **30 menit** |
| D3 | Bukti chat menurunkan nilai | **Hanya setelah disetujui admin**; sebelum itu tampil "sementara" |
| D4 | Sumber benchmark | **Policy aktif** (versi policy ikut ditampilkan) |
| D5 | Bobot & ambang | **50/30/20**, A≥90 · B 75–89 · C 60–74 · D 40–59 · E<40 |

### Implikasi D1 yang harus diterima

`StaffRetentionService.computeForPeriod` menandai staf dengan masa kerja < `min_tenure_months` (4) sebagai `SKIPPED / TENURE`.

- Thabita mulai **2026-09-26** → per Oktober 2026 masa kerja **1 bulan** → **tidak dinilai**.
- Kohort kanonis Oktober juga **0** (pool Maret–September), karena kunjungan pertamanya baru akhir September.
- Hanifah mulai **2026-09-22** → juga **< 4 bulan** → **tidak dinilai**.

Konsekuensi pada grade:

| Komponen | Nilai | Bobot asli | Status |
|---|---|---|---|
| Ketepatan | 19% | 50 | dipakai |
| Retensi | — | 30 | **dikeluarkan** (tenure) |
| Kunjungan | 79% | 20 | dipakai |

Bobot dinormalisasi: ketepatan **71,4%**, kunjungan **28,6%**.

```
(0,5 × 19) + (0,2 × 79) = 25,3 ; 25,3 ÷ 0,7 = 36,1 → E
```

Prototipe dashboard sudah disesuaikan: kartu retensi menjadi **indikator awal**, bukan grade:

- **3 pasien kembali** dari 21 pasien baru Oktober (14,3%)
- **Progres sampel 21 / 40**
- **Benchmark policy 34,6%** (20 poin di atas angka saat ini)
- **11 kunjungan ulang November** (1 sendiri, 10 limpahan)

Syarat backend tetap dua: sampel ≥40 **dan** masa kerja ≥4 bulan. Namun di kartu dashboard hanya progres sampel yang ditampilkan; syarat masa kerja tidak ditampilkan atas permintaan pengguna.

Dua syarat harus terpenuhi sebelum retensi masuk nilai:

1. Sampel kanonis ≥ `min_sample` (40).
2. Masa kerja ≥ `min_tenure_months` (4 bulan).

Selama salah satu belum terpenuhi, retensi tetap ditampilkan sebagai indikator (untuk deteksi dini off-target), tetapi **tidak masuk komposisi nilai** dan tidak diberi grade.

> **Gate:** F1 tidak boleh dimulai sebelum pengguna memberi aba-aba eksekusi.

---

## 3. Arsitektur target

```
[Reservations] ──> visit-evidence.service ──> VisitArrivalEvidence
   [Messages]  ─┘         (deterministik)          │
                                                   ▼
[RetentionPolicy] ──> staff-scorecard.service ──> StaffScorecardSnapshot
[ScorecardPolicy] ─┘         (domain murni)             │
                                                        ▼
                                     /api/admin/staff-scorecard/*
                                     /api/staff/scorecard/me
                                                        │
                                    StaffManagement (tab) + Dashboard HP
```

### Modul baru

| Modul | File | Isi |
|---|---|---|
| `staff.scorecard.domain` | `src/domain/staff-scorecard.ts` | fungsi murni: ketepatan, volume, komposisi, grade |
| `staff.scorecard.service` | `src/services/staff-scorecard.service.ts` | agregasi + snapshot + policy |
| `staff.visit_evidence` | `src/services/visit-evidence.service.ts` | jendela waktu, sumber bukti, status review |
| `staff.arrival_intent` (F7) | `src/services/arrival-intent-classifier.service.ts` | klasifikasi maksud pesan (batch) |
| `staff.scorecard.routes` | `src/routes/admin/staff-scorecard.subroute.ts` | endpoint admin |
| `staff.scorecard.mobile` | `src/routes/staff/scorecard.subroute.ts` | endpoint dashboard bidan |

---

## 4. Skema database

### 4.1 `StaffScorecardPolicy` (versioned, seperti `RetentionPolicy`)

| Kolom | Tipe | Default | Keterangan |
|---|---|---|---|
| id | String | uuid | |
| tenant_id | String | default-tenant | |
| weight_punctuality | Int | 50 | |
| weight_retention | Int | 30 | |
| weight_volume | Int | 20 | |
| tolerance_minutes | Int | 30 | toleransi keterlambatan |
| chat_evidence_minutes | Int | 30 | ambang bukti chat |
| target_visits_per_day | Int | 3 | standar harian |
| working_days_per_month | Int | 26 | |
| min_sample_punctuality | Int | 10 | minimal kunjungan dinilai |
| min_sample_retention | Int | 40 | ikut policy retensi kanonis |
| grade_a_min … grade_d_min | Int | 90/75/60/40 | ambang grade |
| formula_version | String | `v1` | |
| effective_from / effective_to | DateTime | — | versioning |
| created_at / updated_at | DateTime | — | |

### 4.2 `VisitArrivalEvidence`

| Kolom | Tipe | Keterangan |
|---|---|---|
| id | String | uuid |
| tenant_id | String | |
| reservation_id | String | FK reservations |
| source | Enum | `TAP` `GEOFENCE` `PHOTO` `CHAT` `OTW` `ESTIMATE` |
| evidence_at | DateTime? | waktu bukti |
| observed_minutes | Int? | menit setelah jadwal |
| confidence | Float? | 0–1 (khusus `CHAT`) |
| message_id | String? | pesan rujukan (FK messages) |
| model | String? | versi model classifier |
| review_status | String | `AUTO` `NEEDS_REVIEW` `APPROVED` `REJECTED` |
| reviewed_by / reviewed_at | String? / DateTime? | audit |
| review_note | String? | alasan |
| created_at | DateTime | |

Unique: `(tenant_id, reservation_id, source, evidence_at)`; index `(tenant_id, review_status)`.

### 4.3 `StaffScorecardSnapshot`

| Kolom | Tipe | Keterangan |
|---|---|---|
| id | String | uuid |
| tenant_id / staff_id / staff_name | String | snapshot nama |
| period_year / period_month | Int | |
| policy_id | String | versi policy |
| punctuality_pct / retention_pct / volume_pct | Float? | komponen mentah |
| weighted_score | Float? | 0–100 |
| grade | String? | A–E |
| coverage_pct | Float? | (terukur + bukti) / total |
| evidence_chat_n / evidence_measured_n / unknown_n | Int | transparansi |
| status | String | `DRAFT` `PREVIEW` `FINAL` |
| computed_at / computed_by | DateTime / String | |
| notes | String? | |

Unique: `(tenant_id, staff_id, period_year, period_month)`.

> **Catatan:** jangan menambah kolom ke `reservations` untuk bukti. Satu kunjungan bisa punya beberapa bukti; tabel terpisah lebih auditabel.

---

## 5. Kontrak domain (murni, tanpa I/O)

```ts
// src/domain/staff-scorecard.ts
type PunctualityInput = { measured: number; onTime: number; viaChatLate: number; unknown: number; tolerance: number };
type VolumeInput = { visits: number; target: number };
type ScoreInput = { punctualityPct: number | null; retentionPct: number | null; volumePct: number | null; weights: Weights; minimums: Minimums };
type Grade = 'A' | 'B' | 'C' | 'D' | 'E';

computePunctuality(input): { pct: number | null; assessed: number; breakdown }
computeVolumeTarget(days, perDay, workingDaysPerMonth): number
composeScore(input): { score: number | null; grade: Grade | null; usedWeights; excluded: string[] }
gradeFromScore(score, thresholds): Grade
```

Aturan:
- Komponen dengan sampel di bawah minimum **dikeluarkan** dan bobotnya dinormalisasi ulang.
- Tidak ada komponen → grade `null` (bukan `E`).
- `unknown` tidak pernah dianggap tepat waktu.

---

## 6. Endpoint admin

| Method | Path | Hak akses | Fungsi |
|---|---|---|---|
| GET | `/api/admin/staff-scorecard/policy` | ADMIN_CS baca | policy aktif |
| PUT | `/api/admin/staff-scorecard/policy` | SUPER_ADMIN | versi baru |
| GET | `/api/admin/staff-scorecard/report` | ADMIN_CS | `?year&month&staffId`, preview |
| POST | `/api/admin/staff-scorecard/recalculate` | SUPER_ADMIN | hitung ulang draft |
| POST | `/api/admin/staff-scorecard/snapshot` | SUPER_ADMIN | bekukan FINAL |
| GET | `/api/admin/staff-scorecard/evidence` | ADMIN_CS | antrean `NEEDS_REVIEW` |
| POST | `/api/admin/staff-scorecard/evidence/:id/review` | ADMIN_CS | `{ action: 'APPROVE' \| 'REJECT', note }` |
| GET | `/api/staff/scorecard/me` | staff session | dashboard HP |

Semua aksi tulis memakai `auditService.logAdminAction` dan `tenant_id` dari sesi, bukan dari body.

---

## 7. UI admin (tanpa page baru)

**Parent:** `packages/admin-dashboard/src/pages/tenant/StaffManagement.tsx`
Tambah tab ketiga: `PENILAIAN` (di samping `STAFF` dan `ROLES`).

Isi tab:

1. **Policy card** (`ScorecardPolicyPanel.tsx`)
   - bobot 50/30/20 (validasi total 100)
   - toleransi 30 menit, ambang chat 30 menit
   - target 3/hari, 26 hari kerja
   - ambang grade A–E
   - indikator "menggunakan RetentionPolicy vX, benchmark 34,6%"
   - tombol Simpan (Super Admin), konfirmasi via `useUiFeedback`
2. **Preview scorecard** (`ScorecardPreviewTable.tsx`)
   - kolom: bidan, ketepatan, retensi, volume, nilai, grade, cakupan
   - chip "sample kurang" bila di bawah minimum
   - klik baris → drawer rincian (komponen + evidensi)
3. **Antrean verifikasi** (`ScorecardVerificationQueue.tsx`)
   - daftar kunjungan `NEEDS_REVIEW`
   - tampilkan: nama, tanggal, jam, kutipan pesan, selisih menit, confidence
   - aksi: Setujui / Tolak + catatan
   - filter periode & bidan
   - indikator jumlah antrean di header tab

Komponen baru wajib didaftarkan di `packages/admin-dashboard/src/ui-registry.json`. Tidak ada route/page baru.

---

## 8. Klasifikasi bukti chat (F7, opsional)

- **Input:** jendela `[jadwal, min(tiba, jadwal + durasi + 30 mnt)]`, maksimum 10 pesan terakhir, nama disamarkan.
- **Output JSON:** `{ label: WAITING | NOT_WAITING | CUSTOMER_NOT_READY | UNCLEAR, evidence_at, confidence, reason }`.
- **Threshold:** `confidence ≥ 0.8` → `AUTO`; `0.5–0.8` → `NEEDS_REVIEW`; `<0.5` → tidak disimpan.
- **Model:** `FAST_ECONOMICAL` (`glm-5.3-flash`), temperature 0, batch (cron malam).
- **Gate presisi:** pada 57 kunjungan ber-`arrived_at`, presisi ≥95% dan nol salah tuduh "tepat waktu". Jika gagal, rilis tanpa F7 (tetap memakai sinyal deterministik).
- **Larangan:** classifier tidak pernah menulis `arrived_at`.

---

## 9. Fase eksekusi (micro-task)

### F0 — Definisi & golden set (0,5 hari, tanpa kode)

- [ ] Jawab D1–D5, tulis di plan ini.
- [ ] Ekspor 57 kunjungan ber-`arrived_at` + jendela pesan ke `docs/audit/bidan-scorecard/golden-set.json`.
- [ ] Labeli 100 pesan (WAITING/ARAH/LOKASI/RESCHEDULE/ACK) sebagai uji klasifikasi.
- **Lulus jika:** daftar keputusan ditandatangani dan golden set tersimpan.

### F1 — Skema + domain (2 hari) — **SELESAI 2026-11-19**

- [x] Tambah 3 model di `prisma/schema.prisma` (`StaffScorecardPolicy`, `VisitArrivalEvidence`, `StaffScorecardSnapshot`) + 2 enum + relasi `Reservation`/`Staff`.
- [x] Migrasi dibuat: `prisma/migrations/20261119120000_add_staff_scorecard/migration.sql` (dihasilkan dari diff schema, **belum diterapkan** karena DB lokal tidak tersedia).
- [x] Implementasi `src/domain/staff-scorecard.ts`.
- [x] Tes: `tests/unit/staff-scorecard-domain.test.ts` — **36 tes hijau**.
- [x] Daftarkan modul di `scripts/module-registry.json` + regenerasi `docs/MODULE_INDEX.md`.

**Verifikasi F1:**
- `npx prisma validate` → valid
- `npx prisma generate` → sukses
- `npm run typecheck` → hijau
- `npm run check:reuse` → 189 baseline, **0 pelanggaran baru**
- `npm test` → **1035 file / 8090 tes hijau**, 0 gagal
- `npm run find:module -- "penilaian bidan"` → menemukan modul baru

**Catatan:** migrasi belum di-apply. Saat DB tersedia jalankan `npx prisma migrate deploy` (jangan `--no-engine`), lalu verifikasi drift dengan `prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script` → harus `-- This is an empty migration.`

### F2 — Kolektor bukti + backfill (2 hari) — **SELESAI 2026-11-19**

- [x] `src/domain/visit-evidence.ts` — jendela deterministik, draft TAP/OTW/PHOTO/CHAT, status `MEASURED/CHAT_CANDIDATE/UNKNOWN`.
- [x] `src/services/visit-evidence.service.ts` — pengumpul + persist; melewati bukti yang sudah `APPROVED/REJECTED`.
- [x] `src/scripts/backfill-visit-evidence.ts` — default **DRY RUN**, `--commit` untuk menulis.
- [x] Tes: `tests/unit/visit-evidence.test.ts` — **20 tes hijau** (jendela, ambang 30, pesan di luar jendela, jaminan tanpa `arrived_at`).
- [x] Modul `staff.visit_evidence` terdaftar + `MODULE_INDEX.md` regenerasi.

**Jaminan yang diuji:**
- Service tidak pernah memanggil `reservation.update`/`updateMany`.
- Payload `visit_arrival_evidence` tidak memiliki `arrived_at`/`arrivedAt`.
- Bukti yang sudah direview admin tidak ditimpa backfill.

**Catatan eksekusi:** skrip belum dijalankan ke database (DB lokal tidak tersedia). Berdasarkan verifikasi SQL, hasil yang diharapkan: **20 terukur + 19 kandidat chat = 39/46 (84,8%)**, memenuhi ambang ≥39.

**Verifikasi F2:**
- `npm run typecheck` → hijau
- `npm run check:reuse` → 189 baseline, **0 pelanggaran baru**
- `npx vitest run tests/unit/visit-evidence.test.ts` → **20/20**
- `npm test` → **1036 file / 8110 tes hijau**, 0 gagal

### F3 — Policy & setting admin (1,5 hari) — **SELESAI 2026-11-19**

- [x] `src/services/staff-scorecard.service.ts` — validasi + versi policy + fallback default.
- [x] `src/routes/admin/staff-scorecard.subroute.ts` — `GET/PUT /api/admin/staff-scorecard/policy`, RBAC Super Admin untuk PUT, audit `UPDATE_STAFF_SCORECARD_POLICY`.
- [x] `packages/admin-dashboard/src/components/staff/ScorecardPolicyPanel.tsx` + tab **Penilaian Bidan** di `StaffManagement`.
- [x] Mapping scope RBAC `/admin/staff-management` → `/api/admin/staff-scorecard` (GET).
- [x] Tes integrasi `tests/integration/staff-scorecard-policy.test.ts` — **6 tes hijau** (fallback DB offline, PUT valid + audit, bobot 90 → 400, grade tidak menurun → 400, ADMIN_CS PUT → 403, ADMIN_CS GET → 200).
- [x] Komponen terdaftar di `ui-registry.json`; modul `staff.scorecard_policy` terdaftar.

**Verifikasi F3:**
- `npm run typecheck` → hijau
- `npm run check:reuse` → 189 baseline, **0 baru**
- `npm run build` di `packages/admin-dashboard` → sukses
- Tes F3 + F1 + F2 → 62/62

### F4 — Antrean verifikasi (2 hari) — **SELESAI 2026-11-20**

- [x] `VisitEvidenceService.listForReview` + `reviewEvidence` — baca antrean, keputusan admin, tidak menyentuh reservasi.
- [x] `GET /api/admin/staff-scorecard/evidence` + `POST /api/admin/staff-scorecard/evidence/:id/review`.
- [x] Audit `REVIEW_ARRIVAL_EVIDENCE` pada setiap keputusan.
- [x] `ScorecardVerificationQueue.tsx` + modal catatan; ditempel di tab **Penilaian Bidan**.
- [x] Scope RBAC `/api/admin/staff-scorecard` → `GET,POST`.
- [x] Migrasi seed `20261120100000_seed_staff_scorecard_scopes` untuk ADMIN_CS (GET policy/evidence + POST review; PUT policy tetap Super Admin).
- [x] Tes integrasi `tests/integration/staff-scorecard-evidence.test.ts` — **7 tes hijau** (list + kutipan pesan, approve, reject, 409 review ulang, 400 aksi invalid, 404, 400 status invalid).

**Jaminan:** keputusan review hanya mengubah `visit_arrival_evidence`; `reservations.update` tidak pernah dipanggil.

**Verifikasi F4:**
- `npm run typecheck` → hijau
- `npm run build` dashboard → sukses
- `npm run check:reuse` → 189 baseline, **0 baru**
- Tes F4 + F1–F3 → 69/69

### F5 — Agregasi + snapshot (2 hari) — **SELESAI 2026-11-20**

- [x] `StaffScorecardService.getReport` — ketepatan (jam + bukti chat APPROVED), volume prorata, retensi bulan sebelumnya dari policy kanonis.
- [x] Retensi `SKIPPED` (tenure/sampel) tidak diberi grade; bobot dinormalisasi.
- [x] `freezePeriod` — snapshot FINAL immutable; periode yang sudah FINAL dilewati.
- [x] Endpoint `GET /api/admin/staff-scorecard/report`, `POST .../recalculate`, `POST .../snapshot` (+ audit `FREEZE_STAFF_SCORECARD`).
- [x] Tes `tests/unit/staff-scorecard-aggregate.test.ts` — **9 tes** (agregasi Thabita, hanya chat APPROVED, retensi OK, snapshot FINAL dipakai apa adanya, freeze skip/tulis, periode).

**Verifikasi F5:**
- `npm run typecheck` → hijau
- `npm run check:reuse` → 189 baseline, **0 baru**
- `npm test` → **1043 file / 8177 tes hijau**, 0 gagal

**Perbaikan prasyarat (di luar fitur, ditemukan saat gate):**
- Shebang `#!/usr/bin/env node` pada dua skrip `.mjs` membuat Vitest gagal meng-import-nya. Shebang dihapus; skrip tetap dijalankan via `node <file>`.
- Fixture tanggal tetap di `reservation-intake-contract.test.ts` diganti relatif (time-rot pada 20 Nov).

### F6 — Dashboard HP (2 hari) — **SELESAI 2026-11-20**

- [x] `GET /api/staff/scorecard/me` — `staffId` **selalu dari sesi** (query `staffId` diabaikan / anti-IDOR), tenant dari sesi, periode default bulan berjalan WIB.
- [x] Halaman `packages/admin-dashboard/src/pages/staff/StaffScorecard.tsx` — fetch ke API (bukan data hardcode), state loading/error/empty, pemilih periode, rincian per komponen + bobot terpakai, cakupan bukti, status PREVIEW/FINAL, dan penjelasan komponen yang dikecualikan.
- [x] Rute `/admin/staff/scorecard` di `App.tsx` (di dalam `StaffAuthProvider` + `StaffProtectedRoute`); pintu masuk "Raport Saya" di drawer `StaffToday`; terdaftar di `ui-registry.json`.
- [x] Tes `tests/integration/staff-scorecard-me.test.ts` — **6 tes** (401 tanpa sesi, anti-IDOR, bentuk data lengkap, periode invalid 400, item null, error 500).
- **Lulus jika:** angka dashboard = API = raport owner.

**Verifikasi F6:**
- `npm run typecheck` → hijau
- `npm run check:reuse` → 189 baseline, **0 baru**
- `npm run build` dashboard → sukses
- Suite fitur + RBAC/module registry → **45 tes hijau**
- `npm test` → **1044 file / 8183 tes hijau**, 28 skipped, 0 gagal

### F7 — Chat classifier (3 hari, opsional & bergerbang)

- [ ] Adapter + prompt + evaluasi golden set.
- [ ] Hasil hanya `VisitArrivalEvidence` (bukan `arrived_at`).
- **Lulus jika:** presisi ≥95%, nol false positive pada kunjungan tepat waktu.

### F8 — Rollout (1 hari)

- [ ] Feature flag `SCORECARD_ENABLED` (default off).
- [ ] Aktifkan untuk tenant uji, bandingkan 1 periode.
- [ ] Dokumentasi + Known Issues.
- **Lulus jika:** dua periode berturut-turut tanpa selisih angka.

---

## 10. Rencana pengujian

| Lapis | Isi | Gate |
|---|---|---|
| Unit | domain, evidence window, komposisi bobot | `npm test -- tests/unit/staff-scorecard*` |
| Integrasi | routes, RBAC, audit, snapshot immutability | `tests/integration/staff-scorecard.test.ts` |
| Data | bandingkan API vs SQL (37 kunjungan Nov) | selisih 0 |
| UI | policy save, review, dashboard state | manual + screenshot |
| Regresi | build + check:reuse + full suite | tanpa failure baru |

**Adversarial wajib:**
- bobot total ≠ 100
- sampel 0 dan sampel 1
- pesan di luar jendela
- `arrived_at` null tapi chat ada
- snapshot FINAL lalu `arrived_at` diedit
- staff nonaktif
- tenant lain (IDOR)

---

## 11. Rollout & rollback

- Default **off**; aktif per tenant.
- Masa preview 1 bulan: grade berlabel `PREVIEW`, tidak dipakai payroll.
- Snapshot FINAL immutable; koreksi lewat snapshot baru + catatan.
- Rollback: matikan flag (tabel tetap, tidak ada data hilang).

---

## 12. Risiko

| Risiko | Mitigasi |
|---|---|
| Dua definisi retensi (16% vs 34,6%) | D1: kanonis untuk payroll, preview berlabel |
| Grade menghukum pencatat jujur | tampilkan cakupan + status "sampel kurang" |
| Chat false positive | review admin + confidence + golden set |
| Beban admin | antrean hanya kasus 0,5–0,8; auto untuk ≥0,8 |
| Data PII di prompt | masking nama/telepon |
| Gameplay baru | snapshot + audit + cakupan terlihat |

---

## 13. Daftar file

**Baru**
- `src/domain/staff-scorecard.ts`
- `src/services/visit-evidence.service.ts`
- `src/services/staff-scorecard.service.ts`
- `src/services/arrival-intent-classifier.service.ts` (F7)
- `src/routes/admin/staff-scorecard.subroute.ts`
- `src/routes/staff/scorecard.subroute.ts`
- `src/scripts/backfill-visit-evidence.ts`
- `packages/admin-dashboard/src/components/staff/ScorecardPolicyPanel.tsx`
- `packages/admin-dashboard/src/components/staff/ScorecardPreviewTable.tsx`
- `packages/admin-dashboard/src/components/staff/ScorecardVerificationQueue.tsx`
- `tests/unit/staff-scorecard-domain.test.ts`
- `tests/unit/visit-evidence.test.ts`
- `tests/integration/staff-scorecard.test.ts`

**Diubah**
- `prisma/schema.prisma` (+3 model)
- `src/routes/admin.route.ts` (registrasi)
- `packages/admin-dashboard/src/pages/tenant/StaffManagement.tsx` (+1 tab)
- `packages/admin-dashboard/src/ui-registry.json`
- `scripts/module-registry.json`
- `docs/MODULE_INDEX.md`
- `docs/FEATURE_INVENTORY.md`
- `docs/KNOWN_ISSUES.md` (status implementasi)

---

## 14. Estimasi

| Fase | Hari |
|---|---|
| F0 | 0,5 |
| F1 | 2 |
| F2 | 2 |
| F3 | 1,5 |
| F4 | 2 |
| F5 | 2 |
| F6 | 2 |
| F7 | 3 (opsional) |
| F8 | 1 |
| **Total** | **13–16 hari** |

---

## 15. Gate persetujuan

D1–D5 **sudah dijawab** pada 2026-11-19. Yang masih dibutuhkan sebelum F1:

1. Konfirmasi bahwa tab `PENILAIAN` di `StaffManagement` adalah tempat yang disetujui (bukan page baru).
2. Konfirmasi bahwa F7 (AI chat) dikerjakan setelah F1–F6 stabil, bukan sekaligus.
3. **Aba-aba eksekusi F1** dari pengguna.

Plan ini belum mengubah kode produksi, database, atau admin.
