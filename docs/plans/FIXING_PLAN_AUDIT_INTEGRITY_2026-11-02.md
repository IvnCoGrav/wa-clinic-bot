# Implementation Plan — Perbaikan Integritas Audit & Temuan #299/#300

> **Status:** DRAFT — menunggu persetujuan eksekusi eksplisit dari pengguna.
> **Tanggal:** 2026-11-02
> **Dasar:** hasil verifikasi ulang laporan `docs/audit/2026-11-02/` (lihat `docs/KNOWN_ISSUES.md` #299 dan #300).
> **Cakupan:** memperbaiki (a) integritas laporan audit, (b) kontrak `DELETE /api/admin/reservation/:id`, (c) estimasi usia bulan, (d) cakupan gate regresi, (e) migrasi live #298.
> **Bukan cakupan:** refactor arsitektur, perubahan perilaku AI/prompt, deploy kode ke produksi, restart WAHA, rotasi kredensial.

---

## §0. Fakta Terverifikasi (dasar plan)

| # | Fakta | Bukti (`file:line` / artefak) | Implikasi |
|---|---|---|---|
| P-01 | Gate resmi gagal: baseline 31 gagal, after 35 gagal, 6 nama baru | `docs/audit/2026-11-02/baseline.json`, `after.json`, `scripts/audit-baseline-diff.mjs` (exit 1) | Klaim PASS tidak sah; baseline harus distabilkan dulu |
| P-02 | 6 kegagalan baru semuanya `Test timed out in 5000ms` dan lulus saat dijalankan ulang | `after.json` (failureMessages) + rerun 24/24 PASS | Flaky akibat beban paralel, bukan regresi → perbaiki `testTimeout` |
| P-03 | Laporan fase menyebut 96 path test, **32 tidak ada** | `LAPORAN_FASE_00..11.md` vs `Test-Path` + `fase-XX.json` (`testResults.length`) | Gate per fase harus memakai daftar kanonis plan §E |
| P-04 | Baseline 31 gagal / 19 file, sedangkan #287 mencatat 22 / 10 | `baseline.json`; `docs/KNOWN_ISSUES.md` #287 | 9 file tambahan wajib diinvestigasi, bukan dilabeli "flaky" |
| P-05 | 4 test `DELETE /api/admin/reservation/:id` gagal `expected 404 to be 200` | `tests/integration/follow-up-schedule.test.ts:249`, `tests/integration/google-calendar.test.ts:144`, `tests/unit/admin-reservation-cancel-followups.test.ts:39`, `tests/unit/reservation-silent-failure-audit.test.ts` | Kontrak DELETE berubah tanpa komentar/test ikut |
| P-06 | `DELETE` tanpa `?soft` masuk jalur **arsip**, komentar masih "soft-cancel (default)" | `src/routes/admin/reservation-dispatch.route.ts:1953-1956` vs `:1986` | Sumber konflik kontrak |
| P-07 | `catch` menelan semua error lalu membalas 404 | `src/routes/admin/reservation-dispatch.route.ts:2081-2096` | DB error menyamar jadi "data tidak ditemukan" |
| P-08 | Dashboard mengirim DELETE tanpa query untuk arsip; fallback cancel memakai DELETE juga | `packages/admin-dashboard/src/components/modals/ReservationDetailModal.tsx:295-296,316-318`, `packages/admin-dashboard/src/pages/tenant/CustomerDatabase.tsx:1703-1704` | Perlu pemisahan `?soft=true` |
| P-09 | `parseAgeTextEstimate` mengubah bulan→hari (30,44) lalu mengurangi tanggal | `src/utils/age-calculator.ts:52,182-184` | Round-trip 8 bulan → 7 bulan (off-by-one) |
| P-10 | `FEATURE_INVENTORY.md` §11 masih 117 endpoint / 43 model | `docs/FEATURE_INVENTORY.md:247-248` | Klaim "sudah diperbarui" tidak akurat |
| P-11 | PostgreSQL lokal (`localhost:5432`) mati & Docker Desktop tidak jalan | `Test-NetConnection localhost 5432` = False; `docker ps` gagal | Klaim "empty migration" tidak punya bukti lokal |
| P-12 | `check:design`, `security:scan`, `tsc --noEmit` bersih | dijalankan 2026-11-02 | Bukan bagian perbaikan, tetap dipakai sebagai gerbang |
| P-13 | Gate plan yang benar (tidak dipakai eksekutor) hijau: 124 + 159 + 85 test | rerun 2026-11-02 | Fungsi inti sehat; yang rusak adalah disiplin audit |

---

## §1. Keputusan Desain yang Dikunci Sebelum Koding

### D-01 — Kontrak `DELETE /api/admin/reservation/:id`

| Query | Perilaku | Alasan |
|---|---|---|
| _(tanpa query)_ | **ARSIP** (snapshot JSONB 60 hari → hapus baris aktif) | Sesuai teks UI "Arsipkan Reservasi?" (`ReservationDetailModal.tsx:309-311`) |
| `?archive=true` | ARSIP (eksplisit, alias) | Dipertahankan untuk kompatibilitas |
| `?hard=true` | ARSIP (bukan hard delete fisik) | Alias historis; dokumentasi diperbaiki agar tidak menyesatkan |
| `?soft=true` | **SOFT-CANCEL** (`status='cancelled'`, baris tetap ada) | Jalur cancel eksplisit; dipakai test lama & fallback UI |

### D-02 — Pemetaan error

- Data tidak ada di DB **dan** tidak ada di memory store → `404`.
- DB error/timeout, dan data juga tidak ada di memory store → **`503` `DB_UNAVAILABLE`** (bukan 404).
- DB error **tetapi** data ada di memory store → tetap diproses via memory store (resiliensi dipertahankan).

### D-03 — Presisi usia

Input dengan satuan bulan/tahun saja dihitung dengan **aritmetika kalender** (`addMonths`), bukan konversi hari (30,44). Input yang memuat `hari`/`minggu` tetap memakai jalur `totalDays`.

### D-04 — Integritas laporan

Laporan lama **tidak dihapus**. Koreksi diberi penanda `> **KOREKSI 2026-11-02:** …` agar jejak audit tetap terlihat.

---

## §2. Fase Eksekusi

### FASE 0 — Stabilkan Baseline & Bangun Gate Kanonis

**Tujuan:** memastikan baseline tidak flaky dan gate memakai daftar file yang benar.
**Blast radius:** 1 baris config + 2 skrip baru (non-runtime).
**Dependency:** tidak ada.

#### 0.1 Naikkan `testTimeout`
- **File:** `vitest.config.ts:5-12`
- **Aksi:** tambahkan `testTimeout: 15000,` di dalam `test: { ... }`.
- **Kode:**
```ts
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // Test berat (DB-fallback + arsip) butuh ~3 dtk saat sendiri dan >5 dtk saat
    // suite paralel. 5 dtk terbukti menghasilkan false-failure (lihat #299).
    testTimeout: 15000,
    include: ['tests/**/*.test.{ts,js}'],
    exclude: ['caveman/**', 'node_modules/**', 'dist/**'],
  },
```
- **Acceptance:** `npx vitest run tests/unit/command-machine-gate.test.ts tests/unit/sticky-gps.test.ts` → 2 file PASS.

#### 0.2 Baseline stabil 3×
- **Perintah:**
```powershell
foreach ($i in 1..3) {
  npx vitest run --reporter=json --outputFile=docs\audit\2026-11-02\baseline-run$i.json
}
```
- **Aksi:** buat `scripts/audit-baseline-stable.mjs` yang mengambil **irisan** nama test gagal dari 3 run → tulis `docs/audit/2026-11-02/baseline-stable.json` + cetak nama yang tidak konsisten (flaky).
- **Acceptance:** file `baseline-stable.json` ada; daftar flaky dicetak eksplisit.

#### 0.3 Skrip gate per fase (kanonis)
- **File baru:** `scripts/audit-phase-gates.mjs` (Node `fs` + `child_process`, tanpa dependency baru).
- **Isi:** peta `PHASE_FILES` persis seperti plan §E (Fase 1–11), lalu:
```js
for (const [phase, files] of Object.entries(PHASE_FILES)) {
  const missing = files.filter((f) => !fs.existsSync(f));
  if (missing.length) { console.error(`${phase} MISSING:`, missing); process.exitCode = 1; continue; }
  execFileSync('npx', ['vitest','run',...files,'--reporter=json',`--outputFile=docs/audit/2026-11-02/${phase}-recheck.json`], { stdio: 'inherit', shell: true });
}
```
- **Acceptance:** `node scripts/audit-phase-gates.mjs --list` mencetak 11 fase dan **0 missing**.

#### 0.4 Suite penuh pasca-perbaikan
- **Perintah:**
```powershell
npx vitest run --reporter=json --outputFile=docs\audit\2026-11-02\after2.json
node scripts\audit-baseline-diff.mjs docs\audit\2026-11-02\baseline-stable.json docs\audit\2026-11-02\after2.json
```
- **Acceptance:** diff **exit 0** (subset) — belum wajib, karena #300/P-05 masih gagal; gate final di Fase 6.

**Gerbang Fase 0:** `baseline-stable.json` ada; `--list` 0 missing; `tsc --noEmit` exit 0.

---

### FASE 1 — Perbaiki Kontrak & Pemetaan Error `DELETE` (#300)

**Tujuan:** hentikan 404 palsu dan selaraskan kontrak DELETE.
**Blast radius:** 1 route + 1 halaman dashboard + 4 test lama + 1 test baru.
**Dependency:** Fase 0 (testTimeout agar hasil stabil).

#### 1.1 Dokumentasi + tipe query
- **File:** `src/routes/admin/reservation-dispatch.route.ts:1953-1968`
- **Ganti:**
```ts
  /**
   * DELETE /api/admin/reservation/:id
   * Kontrak (lihat KNOWN_ISSUES #300):
   * - tanpa query   -> ARSIP (snapshot 60 hari, baris aktif dihapus)
   * - ?archive=true -> ARSIP (alias eksplisit)
   * - ?hard=true    -> ARSIP (alias historis, BUKAN hard delete fisik)
   * - ?soft=true    -> SOFT-CANCEL (status = 'cancelled', baris tetap ada)
   */
  fastify.delete(
    '/api/admin/reservation/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { hard?: string; archive?: string; soft?: string; reason?: string };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = tenantOf(request);
      const { id } = request.params;
      const isSoftCancel = request.query?.soft === 'true';
      const reason = request.query?.reason;
```

#### 1.2 Pisahkan pembacaan DB dari kegagalan operasi
- **File:** sama, ganti blok `1969-1976` menjadi:
```ts
      let existing: any = null;
      let dbUnavailable = false;
      try {
        existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: tenantId },
          include: { customer: true },
        });
      } catch (dbErr: any) {
        dbUnavailable = true;
        console.warn(`[Admin API] DELETE reservasi ${id}: DB tidak dapat diakses, cek memory store:`, dbErr?.message);
      }

      if (!existing) {
        const mem = memoryReservations.get(id);
        const memUsable = mem && mem.tenant_id === tenantId;
        if (!memUsable) {
          if (dbUnavailable) {
            return reply.status(503).send({
              success: false,
              code: 'DB_UNAVAILABLE',
              error: 'Basis data tidak dapat diakses. Reservasi TIDAK dihapus/diarsipkan. Silakan coba lagi.',
            });
          }
          return reply.status(404).send({ success: false, error: 'Reservation not found' });
        }
        if (!isSoftCancel) {
          memoryReservations.delete(id);
          await customerService.recalculateCustomerLtv(mem.customer_id, tenantId).catch(() => {});
          return reply.status(200).send({ success: true, message: 'Reservasi berhasil diarsipkan (memory).' });
        }
        mem.status = 'cancelled';
        mem.updated_at = new Date();
        memoryReservations.set(id, mem);
        await customerService.recalculateCustomerLtv(mem.customer_id, tenantId).catch(() => {});
        return reply.status(200).send({ success: true, data: mem, note: 'Fallback in-memory mode' });
      }
```

#### 1.3 Perbaiki kondisi cabang arsip
- **File:** sama, baris `1986`
- **Ganti:** `if (isHardDelete || (request.query as any)?.archive === 'true' || !(request.query as any)?.soft) {`
- **Menjadi:** `if (!isSoftCancel) {`
- **Catatan:** variabel `isHardDelete` dihapus (tidak dipakai lagi) atau dipertahankan sebagai alias terdokumentasi; hapus `const isHardDelete` pada baris `1968` bila tidak dipakai.

#### 1.4 Perbaiki `catch` (hapus memory-fallback ganda, petakan 503/500)
- **File:** sama, ganti blok `2081-2096` menjadi:
```ts
      } catch (error: any) {
        const msg = String(error?.message || error);
        const isDbDown = /Database offline|ECONNREFUSED|ETIMEDOUT|P1001|P1002|P2024|connection|timed out/i.test(msg);
        console.error(`[Admin API] DELETE reservasi ${id} gagal:`, msg);
        return reply.status(isDbDown ? 503 : 500).send({
          success: false,
          code: isDbDown ? 'DB_UNAVAILABLE' : 'DELETE_FAILED',
          error: isDbDown
            ? 'Basis data tidak dapat diakses. Reservasi TIDAK dihapus/diarsipkan. Silakan coba lagi.'
            : 'Gagal memproses penghapusan reservasi.',
        });
      }
```

#### 1.5 Selaraskan 4 test lama dengan kontrak final
| File | Baris | Perubahan |
|---|---|---|
| `tests/integration/follow-up-schedule.test.ts` | 250 | `url: '/api/admin/reservation/res-cancelled?soft=true'` |
| `tests/integration/google-calendar.test.ts` | 145 | `url: '/api/admin/reservation/res-123?soft=true'` |
| `tests/unit/admin-reservation-cancel-followups.test.ts` | 40 | `url: '/api/admin/reservation/res-cancel-1?soft=true'` |
| `tests/unit/reservation-silent-failure-audit.test.ts` | blok AUDIT 173i-d | tambahkan `?soft=true` pada URL DELETE yang mengharap notifikasi batal |

#### 1.6 Test adversarial baru (wajib, bukan happy-path)
- **File baru:** `tests/unit/reservation-delete-contract.test.ts`
- **Skenario minimum (5 test):**
  1. `DELETE` tanpa query → `200`, body `archiveId` ada, `reservation.update` **tidak** dipanggil.
  2. `DELETE ?soft=true` → `200`, `followUpService.onReservationCancelled` dipanggil, `reservation.update` dipanggil dengan `status:'cancelled'`.
  3. `DELETE` id tidak ada di DB & memory → `404`.
  4. `DELETE` saat `prisma.reservation.findFirst` reject & memory kosong → **`503`** dengan `code:'DB_UNAVAILABLE'` (bukan 404).
  5. `DELETE` saat DB reject tetapi memory punya data → `200` + semantik sesuai query.
- **Acceptance:** 5/5 PASS.

#### 1.7 Dashboard: bedakan cancel vs arsip
- **File:** `packages/admin-dashboard/src/pages/tenant/CustomerDatabase.tsx:1703`
- **Ganti:** `onDelete={async (id) => { await apiRequest(`/api/admin/reservation/${id}?soft=true`, { method: 'DELETE' }); ... }}`
- **File:** `packages/admin-dashboard/src/components/modals/ReservationDetailModal.tsx:316-318`
- **Ganti:** tambahkan `?soft=true` **hanya** pada fallback cancel (`handleCancelClick → onDelete`), bukan pada `handleDeletePermanentClick` (tetap tanpa query = arsip).
- **Acceptance:** `cd packages/admin-dashboard && npm run build` exit 0.

**Gerbang Fase 1:**
```powershell
npx vitest run tests/unit/reservation-delete-contract.test.ts tests/integration/follow-up-schedule.test.ts tests/integration/google-calendar.test.ts tests/unit/admin-reservation-cancel-followups.test.ts tests/unit/reservation-silent-failure-audit.test.ts tests/integration/reservation-archive.test.ts
npx tsc --noEmit
```
**PASS:** semua hijau; tidak ada `404` pada skenario DB error.

---

### FASE 2 — Perbaiki Estimasi Usia Bulan (#299-C)

**Tujuan:** hilangkan off-by-one "8 bulan → 7 bulan".
**Blast radius:** 1 fungsi utilitas + test.
**Dependency:** Fase 0.

#### 2.1 Presisi kalender untuk satuan bulan/tahun
- **File:** `src/utils/age-calculator.ts:180-184`
- **Ganti:**
```ts
  if (totalDays == null) return empty;

  // Presisi kalender: input bulan/tahun TIDAK boleh dikonversi ke hari (30,44),
  // karena round-trip (bulan -> hari -> monthsBetween) bisa meleset 1 bulan
  // (contoh: "anak 8 bulan" pada tanggal 2 -> terbaca 7 bulan). Lihat #299.
  const hasDayOrWeekUnit = /(\d+(?:[.,]\d+)?)\s*(hari|hr|minggu|mgg|mg)\b/i.test(lower);
  if (!hasDayOrWeekUnit) {
    const totalMonths = parseAgeTextToMonths(lower);
    if (totalMonths != null) {
      const wholeMonths = Math.floor(totalMonths);
      const fractionalDays = Math.round((totalMonths - wholeMonths) * MONTH_DAYS);
      const calendarBirth = addMonths(referenceDate, -wholeMonths);
      calendarBirth.setDate(calendarBirth.getDate() - fractionalDays);
      return { birthDate: calendarBirth, totalDays, approximate, unparseable: false, gestational: false, multiSubject: false };
    }
  }

  const birth = new Date(referenceDate);
  birth.setDate(birth.getDate() - Math.floor(totalDays));
  return { birthDate: birth, totalDays, approximate, unparseable: false, gestational: false, multiSubject: false };
```

#### 2.2 Test round-trip multi-tanggal (anti date-rot)
- **File:** `tests/unit/smart-age-matcher.test.ts:6-11`
- **Ganti test pertama menjadi:**
```ts
  it.each([
    new Date('2026-11-02T10:00:00+07:00'),
    new Date('2026-11-01T10:00:00+07:00'),
    new Date('2026-11-30T10:00:00+07:00'),
    new Date('2026-03-31T10:00:00+07:00'),
  ])('round-trip "anak 8 bulan" tepat 8 bulan pada referensi %s', (ref) => {
    const birthDate = parseAgeTextToBirthDate('Kalo untuk anak 8 bulan', ref);
    expect(birthDate).not.toBeNull();
    expect(monthsBetween(birthDate!, ref)).toBe(8);
  });
```
- **Tambahan:** `tests/unit/age-calculator.test.ts` — 3 kasus baru: `"1 tahun"` → 12, `"10 bulan kurang 6 hari"` tetap memakai jalur hari, `"8,5 bulan"` → `monthsBetween` 8.

**Gerbang Fase 2:**
```powershell
npx vitest run tests/unit/smart-age-matcher.test.ts tests/unit/age-calculator.test.ts tests/unit/dynamic-age-and-gestational-calculator.test.ts tests/unit/catalog-price-age-aware.test.ts
npx tsc --noEmit
```

---

### FASE 3 — Koreksi Dokumen Audit (tanpa menghapus jejak)

**Tujuan:** dokumen tidak lagi memuat klaim yang dibantah artefak.
**Blast radius:** docs saja.
**Dependency:** tidak ada (bisa paralel dengan Fase 1–2).

| # | File | Baris | Aksi |
|---|---|---|---|
| 3.1 | `docs/FEATURE_INVENTORY.md` | 247-248 | `117 endpoint` → `292 endpoint unik (343 pasangan method+path)`; `43 tabel/model` → `47 model Prisma`; tambahkan `16 enum` |
| 3.2 | `docs/audit/2026-11-02/fase-03/LAPORAN_FASE_03.md` | 21 | `src/v3/agent/pipeline/tool-masker.ts` → `src/v3/tools/tool-masker.ts` |
| 3.3 | `docs/audit/2026-11-02/fase-12/LAPORAN_FASE_12.md` | 6 | `SELESAI & LULUS (PASS)` → `PASS DENGAN CATATAN (lihat KOREKSI)` |
| 3.4 | sama | 38,40,41,43,44 | `(16 files…)`→`(3 files nyata; 13 path fiktif)`; `(7 files…)`→`(1 file)`; `(7)…`→`(3)`; `(7)…`→`(3)`; `(9)…`→`(5)` |
| 3.5 | sama | setelah §4 | tambahkan §4.5 `Output Gate Sebenarnya`: baseline 31 → after 35, 6 nama baru, keputusan flaky |
| 3.6 | `docs/audit/2026-11-02/RINGKASAN_AKHIR_AUDIT_SISTEM.md` | 38 | hapus/qualify `drift migrasi "empty migration"` |
| 3.7 | sama | 39 | `0 kegagalan test baru` → `6 kegagalan baru (flaky timeout), gate resmi exit 1` |
| 3.8 | `docs/audit/2026-11-02/fase-11/LAPORAN_FASE_11.md` | 23 | status `PASS (Rekomendasi Dicatat)` → `GAGAL/PARSIAL: skema live belum sinkron (#298)` |
| 3.9 | `docs/audit/2026-11-02/fase-12/LAPORAN_FASE_12.md` | baris RBAC di §2 | `0 endpoint tanpa otorisasi` → `PARSIAL: hanya hook global terverifikasi; matriks per-endpoint belum diuji` |

**Gerbang Fase 3 (grep harus 0 hasil):**
```powershell
Select-String -Path docs\FEATURE_INVENTORY.md -Pattern '117 endpoint|43 tabel/model'
Select-String -Path docs\audit\2026-11-02\**\*.md -Pattern 'agent/pipeline/tool-masker\.ts|0 kegagalan test baru|empty migration'
```

---

### FASE 4 — Tutup Cakupan Audit yang Hilang

**Tujuan:** mengganti klaim dengan bukti; menutup "0 endpoint tanpa otorisasi".
**Blast radius:** artefak audit + 1 test baru.
**Dependency:** Fase 0 (skrip), Fase 1–2 (agar gate hijau).

#### 4.1 Jalankan gate kanonis semua fase
```powershell
node scripts\audit-phase-gates.mjs
```
- **Acceptance:** 11 fase menghasilkan `fase-XX-recheck.json`; setiap fase `numFailedTests = 0` **atau** kegagalan ada di `baseline-stable.json`.

#### 4.2 Matriks otorisasi deterministik
- **File baru:** `tests/integration/admin-staff-authz-matrix.test.ts`
- **Cara:** ambil `app.printRoutes()` setelah `await app.ready()`; untuk setiap rute `GET/POST/PATCH/DELETE/PUT` di bawah `/api/admin/*` dan `/api/staff/*` (kecuali allowlist: `/api/admin/auth/login`, `/api/admin/auth/logout`, `/api/admin/auth/restore`, `/api/admin/auth/me`, `/api/staff/auth/login`), lakukan `app.inject` **tanpa** `x-api-key`/cookie → ekspektasi `401` atau `403`.
- **Allowlist wajib dideklarasikan eksplisit di test** (bukan hardcode di kode produksi).
- **Acceptance:** 100% rute non-allowlist menolak; setiap pengecualian punya komentar alasan.

#### 4.3 Laporan verifikasi ulang
- **File baru:** `docs/audit/2026-11-02/LAPORAN_VERIFIKASI_ULANG.md`
- **Isi wajib:** daftar file nyata per fase (dari `fase-XX-recheck.json`), hasil matriks otorisasi, hasil baseline stabil, dan daftar hal yang **masih** tidak dapat diverifikasi (mis. `SEPARATE_WORKER` live).

**Gerbang Fase 4:**
```powershell
node scripts\audit-phase-gates.mjs
npx vitest run tests/integration/admin-staff-authz-matrix.test.ts
npx vitest run --reporter=json --outputFile=docs\audit\2026-11-02\after3.json
node scripts\audit-baseline-diff.mjs docs\audit\2026-11-02\baseline-stable.json docs\audit\2026-11-02\after3.json
```
**PASS:** diff exit 0.

---

### FASE 5 — Migrasi Live #298 (GERBANG KHUSUS — butuh izin eksplisit)

**Tujuan:** membuat tabel `reservation_archives` di produksi.
**Blast radius:** basis data produksi (BUKAN WAHA). Wajib 2-step verification.

#### 5.1 Pratinjau status (read-only)
```bash
ssh klinik-server-baru "cd /root/wa-clinic-bot && npx prisma migrate status"
```
- **Acceptance:** daftar migrasi pending terlihat; **tidak ada** perintah tulis pada langkah ini.

#### 5.2 Backup wajib
```bash
ssh klinik-server-baru "docker exec wa-clinic-bot-postgres-1 pg_dump -U postgres -d wa_clinic_db -Fc -f /tmp/pre_archive_migration_$(date +%Y%m%d_%H%M).dump && docker exec wa-clinic-bot-postgres-1 ls -lh /tmp/pre_archive_migration_*.dump | tail -1"
```
- **Acceptance:** file dump ada dan ukurannya > 0.

#### 5.3 Terapkan migrasi
```bash
ssh klinik-server-baru "cd /root/wa-clinic-bot && npx prisma migrate deploy"
```

#### 5.4 Verifikasi
```bash
ssh klinik-server-baru "docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c '\d reservation_archives'"
ssh klinik-server-baru "docker logs --since 30m wa-clinic-bot-worker-1 2>&1 | grep -c 'reservation_archives does not exist'"
```
- **PASS:** tabel ada; hitungan error = 0 pada jendela 30 menit setelah siklus cron.

#### 5.5 Rollback (bila gagal)
- Hentikan worker → restore dump terbaru → laporkan. **Jangan** `migrate reset`.

**Gerbang Fase 5:** hanya dieksekusi setelah pengguna mengetik persetujuan eksplisit.

---

### FASE 6 — Penutupan & Gerbang Akhir

1. Update status `KNOWN_ISSUES` **#299** dan **#300** → `RESOLVED` dengan bukti (commit/artefak).
2. Update `CHANGELOG.md` + `node scripts/make-changelog-index.mjs --write`.
3. Update `docs/FEATURE_INVENTORY.md` bila ada perubahan route (reminder: rute baru tidak ada; hanya kontrak query).
4. Gerbang akhir:
```powershell
npx tsc --noEmit
npm run security:scan
cd packages\admin-dashboard; npm run check:design; npm run build; cd ..\..
node scripts\audit-phase-gates.mjs
node scripts\audit-baseline-diff.mjs docs\audit\2026-11-02\baseline-stable.json docs\audit\2026-11-02\after3.json
```
5. Tanda tangan persetujuan pengguna pada `LAPORAN_VERIFIKASI_ULANG.md`.

**DoD:** semua gate exit 0; #299/#300 RESOLVED; tidak ada klaim PASS tanpa output gate di dokumen.

---

## §3. Ringkasan Urutan & Dependency

```
Fase 0 (baseline & skrip)
   ├─> Fase 1 (#300 DELETE)  ─┐
   ├─> Fase 2 (#299 usia)     ├─> Fase 4 (tutup cakupan) ─> Fase 6 (penutupan)
   └─> Fase 3 (docs)         ─┘                              Fase 5 (migrasi live, izin khusus)
```

- Fase 3 boleh paralel dengan Fase 1–2 (tidak menyentuh kode).
- Fase 5 **tidak** memblokir Fase 6, tetapi status #298 tetap OPEN sampai dieksekusi.

---

## §4. Register Risiko (FMEA)

| ID | Risiko | S | O | D | RPN | Mitigasi |
|---|---|---:|---:|---:|---:|---|
| R-01 | Perubahan kontrak DELETE memutus integrasi lama | 7 | 4 | 4 | 112 | Default tetap ARSIP (perilaku saat ini); `?hard=true` dipertahankan sebagai alias |
| R-02 | `503` baru memicu retry berlebihan di dashboard | 5 | 4 | 3 | 60 | Dashboard sudah menampilkan toast error; tidak ada auto-retry |
| R-03 | Perbaikan usia mengubah hasil untuk input hari/minggu | 8 | 2 | 3 | 48 | Jalur `hari/minggu` tidak disentuh; 3 test regresi ditambahkan |
| R-04 | `testTimeout` 15 dtk menyembunyikan hang nyata | 6 | 4 | 4 | 96 | Batas tetap ada; test yang >5 dtk dilaporkan di laporan verifikasi |
| R-05 | Migrasi live gagal / data hilang | 10 | 2 | 2 | 40 | Backup wajib + rollback + 2-step verification |
| R-06 | Matriks otorisasi memberi false-pass pada rute ber-`preHandler` khusus | 6 | 4 | 5 | 120 | Allowlist eksplisit + review manual setiap pengecualian |
| R-07 | Koreksi dokumen menghapus jejak audit | 4 | 3 | 3 | 36 | Gunakan penanda `KOREKSI`, bukan penghapusan |

---

## §5. Requirement Traceability Matrix

| Temuan | Fase | Task | Bukti PASS |
|---|---|---|---|
| #299-A gate gagal tapi klaim PASS | 0, 4, 6 | 0.2–0.4, 4.1, 4.3 | `baseline-stable.json`, `after3.json`, diff exit 0 |
| #299-B 32 path test fiktif | 0, 4 | 0.3, 4.1 | `audit-phase-gates.mjs --list` 0 missing; `fase-XX-recheck.json` |
| #299-C 9 kegagalan baseline tak diinvestigasi | 1, 2, 4 | 1.5, 2.2, 4.1 | 5 test konsisten hijau |
| #299-D klaim empty migration | 3, 5 | 3.6, 3.8, 5.1 | Dokumen terkoreksi; `migrate status` live |
| #299-E inventaris 117/43 | 3 | 3.1 | grep 0 hasil; angka cocok skrip |
| #299-F RBAC PARSIAL | 3, 4 | 3.9, 4.2 | matriks otorisasi 100% menolak |
| #300 404 palsu | 1 | 1.1–1.7 | `reservation-delete-contract.test.ts` 5/5 |
| #298 tabel arsip live | 5 | 5.1–5.5 | `\d reservation_archives`; log error 0 |

---

## §6. Larangan Selama Eksekusi

1. Dilarang `prisma migrate dev`, `prisma migrate reset`, `prisma generate --no-engine`.
2. Dilarang menyentuh WAHA (label, restart container, kirim pesan).
3. Dilarang menghapus laporan audit lama; koreksi memakai penanda `KOREKSI`.
4. Dilarang menambah dependency runtime.
5. Dilarang menjalankan Fase 5 tanpa persetujuan tertulis pengguna.
6. Dilarang menutup #299/#300 tanpa artefak gate.
