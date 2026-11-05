# Implementation Plan — Maternal Treatment Hardening (Pregnant & Non-Baby Massage)

- **Tanggal:** 2026-11-05
- **Status:** **DIEKSEKUSI (F1–F5) — 2026-11-05.** Dua item ditunda dengan keputusan pengguna:
  pengingat HPL (F4.6) dan rekonsiliasi harga/status katalog (F5.3). Lihat catatan eksekusi di bagian akhir.
- **Scope:** menutup celah skema *pregnant massage* / layanan Moms dari Database → AI → Reservasi → Follow-up → Integrasi.
- **Prinsip:** fondasional (schema, state machine, tool contract, data-driven), **bukan** tambalan prompt/regex, tanpa dependency runtime baru, tenant-aware.
- **Bukti awal:** lihat hasil audit 2026-11-05 (DB lokal `localhost:5432` mati saat audit; verifikasi via `prisma/schema.prisma`, migrasi, seed, dan kode).

---

## 0. Ringkasan Celah → Fase

| # | Celah (temuan audit) | Fase |
|---|---|---|
| 1 | Usia kehamilan hanya teks `raw_text`, tidak terstruktur | **F1** |
| 2 | Token tahap ibu tidak kanonis (`BREASTFEEDING` vs `LACTATING`) | **F1** |
| 3 | `contraindications` & `requires_screening` tidak pernah ditegakkan | **F2 + F3** |
| 4 | Ambang klinis 34/37 minggu & ID layanan hardcode (KNOWN_ISSUES #218) | **F2** |
| 5 | Admin tidak bisa mengatur kelayakan klinis layanan | **F3** |
| 6 | Follow-up Moms generik; `NO_PURCHASE` bernarasi bayi; tidak ada HPL | **F4** |
| 7 | Katalog drift (postpartum aktif/nonaktif, harga beda, `moms-relaksasi`) | **F5** |

**Urutan dependency:** F1 → F2 → F3 → F4 → F5. F3 butuh F2 (evaluator), F4 butuh F1 (`mom_stage`).

---

## 0.1 Gerbang Global (berlaku setiap fase)

```powershell
npm run typecheck
npm run build
npx prisma validate
npx vitest run <file-test-fase>
```

Regresi lengkap sebelum menutup fase:

```powershell
npx vitest run tests/unit/v3-pregnant-catalog-priority.test.ts tests/unit/v3-pregnant-both-category.test.ts tests/unit/v3-catalog-stage-filter.test.ts tests/unit/catalog-seed-drift.test.ts tests/unit/follow-up-treatment-category.test.ts tests/unit/follow-up-engine.test.ts tests/unit/follow-up-placeholder-gate.test.ts tests/unit/v3/clinical-context-mom-stage.test.ts
```

Aturan kegagalan: kegagalan yang diklaim *pre-existing* **WAJIB** dibuktikan dengan `git stash`/revert file ke HEAD lalu jalankan test yang sama (harus tetap gagal). Tanpa bukti itu, dianggap regresi.

Setiap akhir fase wajib memperbarui:
- `docs/FEATURE_INVENTORY.md`
- `docs/KNOWN_ISSUES.md`
- `CHANGELOG.md` (Bahasa Indonesia)
- `graphify update .`

---

## FASE 1 — Fondasi State Maternal Terstruktur

**Tujuan:** usia kehamilan, tahap ibu, dan HPL menjadi data first-class di `reservations`, ditulis dari satu seam kanonis, dibaca dengan fallback kompatibel.

**Blast radius:** sedang (schema + core reservation + 2 route baca + 1 tool + 1 webhook). Tidak mengubah perilaku chat.

### T1.1 Schema `Reservation`

**File:** `prisma/schema.prisma` (setelah `raw_text`, baris ±294)

Tambahkan:

```prisma
  /// Fase 1 (Maternal Structured State) — usia kehamilan saat booking (minggu).
  /// NULL = bukan pasien hamil / data lama (baca fallback raw_text).
  gestational_weeks       Int?
  /// Tahap klinis ibu kanonis: PREGNANT | POSTPARTUM | LACTATING | GENERAL.
  /// NULL = bukan pasien Moms / data lama.
  mom_stage               String?
  /// Perkiraan Hari Perkiraan Lahir = anchor + (40 - gestational_weeks) x 7 hari.
  hpl_date                DateTime?
```

Tambahkan index di blok `@@index` (setelah `@@index([customer_id, status])`):

```prisma
  @@index([tenant_id, hpl_date])
```

**Acceptance:** `npx prisma validate` sukses; `prisma format` tidak mengubah struktur lain.

### T1.2 Migrasi SQL (manual — hindari trap shadow replay)

**File baru:** `prisma/migrations/20261105120000_add_maternal_state/migration.sql`

```sql
-- Fase 1: state maternal terstruktur pada reservasi
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "gestational_weeks" INTEGER;
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "mom_stage" TEXT;
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "hpl_date" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "reservations_tenant_id_hpl_date_idx"
  ON "reservations"("tenant_id", "hpl_date");
```

Perintah:

```powershell
npx prisma generate
npx prisma migrate deploy
npx prisma migrate diff --from-url $env:DATABASE_URL --to-schema-datamodel prisma/schema.prisma --script
```

**Acceptance:** output diff terakhir **tepat** `-- This is an empty migration.`

### T1.3 Modul kanonis state maternal (pure, tanpa I/O)

**File baru:** `src/services/maternal-state.service.ts`

```ts
/**
 * Fase 1 — Deep module state maternal.
 * Satu-satunya tempat normalisasi tahap ibu, ekstraksi usia kehamilan dari
 * raw_text, dan perhitungan HPL. Murni & deterministik (zero I/O) agar mudah diuji.
 */
import { extractGestationalWeeks } from '../utils/age-calculator';

export type CanonicalMomStage = 'PREGNANT' | 'POSTPARTUM' | 'LACTATING' | 'GENERAL';

/** Kanoniskan token tahap ibu lintas lapisan (chat memakai BREASTFEEDING). */
export function canonicalMomStage(value?: string | null): CanonicalMomStage | null {
  const v = String(value || '').toUpperCase().trim();
  if (!v) return null;
  if (v === 'LACTATING' || v === 'BREASTFEEDING' || v === 'MENYUSUI') return 'LACTATING';
  if (v === 'PREGNANT' || v === 'HAMIL') return 'PREGNANT';
  if (v === 'POSTPARTUM' || v === 'NIFAS' || v === 'PASCA_SALIN') return 'POSTPARTUM';
  if (v === 'GENERAL' || v === 'UMUM') return 'GENERAL';
  return null;
}

/**
 * Ekstraksi label-first: DILARANG mengambil angka usia anak.
 * "Usia Kehamilan: 38 minggu" -> 38; "Bayi 9 bulan, Bunda hamil 38 minggu" -> 38.
 */
export function extractGestationalWeeksFromRawText(raw: string | null | undefined): number | null {
  const text = String(raw || '');
  const labelled = text.match(/(?:usia\s+kehamilan|\buk\b|kehamilan)\s*[:\-=]?\s*(\d{1,2})\s*(?:minggu|mgg|mg|week|w)?/i);
  if (labelled) {
    const w = Number(labelled[1]);
    if (Number.isFinite(w) && w >= 1 && w <= 45) return w;
  }
  return extractGestationalWeeks(text);
}

/** HPL = anchor + (40 minggu - usia kehamilan) hari. Null bila input invalid. */
export function computeHplDate(anchorAt: Date, gestationalWeeks: number): Date | null {
  if (!(anchorAt instanceof Date) || isNaN(anchorAt.getTime())) return null;
  if (!Number.isFinite(gestationalWeeks) || gestationalWeeks < 1 || gestationalWeeks > 45) return null;
  const remainingWeeks = Math.max(0, 40 - gestationalWeeks);
  return new Date(anchorAt.getTime() + remainingWeeks * 7 * 24 * 60 * 60 * 1000);
}

export interface MaternalState {
  gestationalWeeks: number | null;
  momStage: CanonicalMomStage | null;
  hplDate: Date | null;
}

export function resolveMaternalState(params: {
  rawText?: string | null;
  treatmentDetail?: string | null;
  treatmentCategory?: string | null;
  gestationalWeeks?: number | null;
  momStage?: string | null;
  anchorAt?: Date | null;
}): MaternalState {
  const cat = String(params.treatmentCategory || '').toUpperCase();
  const isMomContext = cat === 'MOMS' || cat === 'BOTH';
  if (!isMomContext && !params.gestationalWeeks && !params.momStage) {
    return { gestationalWeeks: null, momStage: null, hplDate: null };
  }

  const weeks = typeof params.gestationalWeeks === 'number' && Number.isFinite(params.gestationalWeeks)
    ? params.gestationalWeeks
    : extractGestationalWeeksFromRawText(`${params.rawText || ''} ${params.treatmentDetail || ''}`);

  let stage = canonicalMomStage(params.momStage);
  if (!stage) {
    const text = `${params.rawText || ''} ${params.treatmentDetail || ''}`.toLowerCase();
    if (weeks != null) stage = 'PREGNANT';
    else if (/nifas|pasca\s*salin|postpartum/.test(text)) stage = 'POSTPARTUM';
    else if (/menyusui|laktasi|oksitosin|breast/.test(text)) stage = 'LACTATING';
    else if (isMomContext) stage = 'GENERAL';
  }

  const anchor = params.anchorAt instanceof Date && !isNaN(params.anchorAt.getTime())
    ? params.anchorAt
    : new Date();
  const hplDate = weeks != null ? computeHplDate(anchor, weeks) : null;

  return { gestationalWeeks: weeks ?? null, momStage: stage, hplDate };
}
```

**Acceptance test:** `tests/unit/maternal-state.test.ts` (lihat T1.8).

### T1.4 Seam kanonis `saveReservation`

**File:** `src/services/reservation-core.service.ts`

1. `ReservationMutationParams` (setelah `rawText?: string;`, baris ±36):

```ts
  /** Fase 1: usia kehamilan (minggu) dari state sesi/parser. Null = bukan hamil. */
  gestationalWeeks?: number | null;
  /** Fase 1: tahap ibu (PREGNANT/POSTPARTUM/BREASTFEEDING/LACTATING/GENERAL). */
  momStage?: string | null;
  /** Fase 1: waktu jangkar saat minggu kehamilan dicatat (untuk HPL). */
  maternalAnchorAt?: Date | null;
```

2. Destructure (setelah `requestId,` baris ±782):

```ts
      gestationalWeeks,
      momStage,
      maternalAnchorAt,
```

3. Setelah `effectiveRawText` (baris ±835):

```ts
    // Fase 1 — state maternal diturunkan dari eksplisit (state sesi) atau raw_text.
    // Deep seam: semua pemanggil (bot, webhook, admin) otomatis mendapat data terstruktur.
    const maternal = resolveMaternalState({
      rawText: effectiveRawText,
      treatmentDetail,
      treatmentCategory: validCategory,
      gestationalWeeks,
      momStage,
      anchorAt: maternalAnchorAt ?? new Date(),
    });
```

Tambahkan import:

```ts
import { resolveMaternalState } from './maternal-state.service';
```

4. Tiga jalur tulis wajib menulis state maternal:

- Reactivated (baris ±872, dalam `data: {`):

```ts
                gestational_weeks: maternal.gestationalWeeks,
                mom_stage: maternal.momStage,
                hpl_date: maternal.hplDate,
```

- Merged (baris ±995, dalam `data: {`):

```ts
                gestational_weeks: maternal.gestationalWeeks ?? primary.gestational_weeks ?? null,
                mom_stage: maternal.momStage ?? primary.mom_stage ?? null,
                hpl_date: maternal.hplDate ?? primary.hpl_date ?? null,
```

- Intake merge (baris ±1056):

```ts
            gestational_weeks: maternal.gestationalWeeks ?? recentPending.gestational_weeks ?? null,
            mom_stage: maternal.momStage ?? recentPending.mom_stage ?? null,
            hpl_date: maternal.hplDate ?? recentPending.hpl_date ?? null,
```

- Create (`createData`, baris ±1079):

```ts
      gestational_weeks: maternal.gestationalWeeks,
      mom_stage: maternal.momStage,
      hpl_date: maternal.hplDate,
```

**Acceptance:** test integrasi memastikan `saveReservation` tanpa parameter eksplisit tetapi `raw_text` memuat `Usia Kehamilan: 38 minggu` menyimpan `gestational_weeks=38`, `mom_stage='PREGNANT'`, `hpl_date` terisi.

### T1.5 Teruskan state eksplisit dari tool bot

**File:** `src/v3/tools/save-reservation.tool.ts` (panggilan `saveReservation`, baris ±546)

Tambahkan sebelum `requestId`:

```ts
      gestationalWeeks: gestationalWeeks ?? undefined,
      momStage: effectiveMomStage ?? undefined,
```

`effectiveMomStage` sudah dihitung di baris ±444; `gestationalWeeks` sudah didestructure di baris ±325.

### T1.6 Teruskan state dari form webhook

**File:** `src/services/reservation-lifecycle.service.ts` (baris ±624)

Tambahkan:

```ts
    gestationalWeeks: extractGestationalWeeksFromRawText(p.momProfile?.gestationalWeeks || raw) ?? undefined,
    momStage: p.momProfile?.stage,
```

Import:

```ts
import { extractGestationalWeeksFromRawText } from './maternal-state.service';
```

### T1.7 Baca state terstruktur (fallback kompatibel)

**File:** `src/utils/age-calculator.ts` — perluas `resolveMomGestationalInfo` (baris ±386):

```ts
export function resolveMomGestationalInfo(params: {
  text?: string | null;
  treatmentCategory?: string | null;
  registeredAt?: Date | null;
  today?: Date;
  /** Fase 1: data terstruktur (diutamakan). */
  gestationalWeeks?: number | null;
  momStage?: string | null;
  hplDate?: Date | null;
}): MomGestationalInfo {
  const { text, treatmentCategory, registeredAt, today = new Date() } = params;
  const cat = String(treatmentCategory || '').toUpperCase();
  const isMomContext = cat === 'MOMS' || cat === 'BOTH' || isGestationalText(text);
  if (!isMomContext) return { isPregnant: false, stageLabel: '' };

  // Fase 1: prioritaskan kolom terstruktur bila ada.
  if (typeof params.gestationalWeeks === 'number' && params.gestationalWeeks > 0) {
    const anchor = registeredAt || today;
    const base = computeGestationalAge({ registeredAt: anchor, gestationalWeeksAtReg: params.gestationalWeeks, today });
    return params.hplDate
      ? { ...base, hplLabel: `HPL ${params.hplDate.toISOString().slice(0, 10)}` } as any
      : base;
  }
  const stage = String(params.momStage || '').toUpperCase();
  if (stage === 'POSTPARTUM') return { isPregnant: false, stageLabel: 'Pasca Salin / Nifas' };
  if (stage === 'LACTATING') return { isPregnant: false, stageLabel: 'Ibu Menyusui / Laktasi' };
  if (stage === 'GENERAL') return { isPregnant: false, stageLabel: 'Relaksasi Umum' };

  // ... sisa logika lama (text fallback) dipertahankan apa adanya ...
}
```

> Catatan: `hplLabel` opsional — bila `MomGestationalInfo` belum punya field ini, tambahkan `hplLabel?: string` pada interface. Jangan memaksa perubahan tipe yang memecah komponen lain.

**File konsumen:**
- `src/routes/admin/reservation-crud.route.ts:425`
- `src/routes/admin/reservation-dispatch.route.ts:538`

Tambah argumen:

```ts
              gestationalWeeks: (r as any).gestational_weeks,
              momStage: (r as any).mom_stage,
              hplDate: (r as any).hpl_date,
```

### T1.8 Backfill data lama

**File baru:** `src/scripts/backfill-maternal-state.ts`

Kontrak:
- default `--dry-run`; `--execute` untuk menulis.
- Ambil `reservations` dengan `gestational_weeks IS NULL` dan (`raw_text ILIKE '%kehamilan%'` OR `treatment_category IN ('MOMS','BOTH')`), batch 500.
- Hitung `resolveMaternalState` dari `raw_text` + `treatment_detail`.
- Idempoten: hanya update bila hasil non-null.
- Log ringkasan: `scanned`, `matched`, `updated`, `skipped`.

Perintah:

```powershell
npx tsx src/scripts/backfill-maternal-state.ts
npx tsx src/scripts/backfill-maternal-state.ts --execute
```

### T1.9 Test Fase 1

**File baru:** `tests/unit/maternal-state.test.ts`

Kasus wajib (adversarial):
1. `"Usia Kehamilan: 38 minggu"` → 38.
2. `"Bayi 9 bulan, Bunda hamil 38 minggu"` → **38** (bukan 9).
3. `momStage='BREASTFEEDING'` → kanonis `LACTATING`.
4. `"nifas 2 minggu"` + tanpa minggu gestasional → `POSTPARTUM`, weeks null.
5. HPL: anchor 2026-01-01 + 30 minggu → 2026-08-27 (70 hari).
6. Tanpa konteks Moms → semua null.

**File baru:** `tests/integration/reservation-maternal-state.test.ts`
- Mock prisma; panggil `saveReservation` dengan `rawText` memuat kehamilan; assert payload `create` memuat 3 kolom.
- Idempotent hit (`request_id` sama) tidak menimpa state maternal dengan null.

**Gate F1:** test di atas + regresi global hijau.

---

## FASE 2 — Mesin Kelayakan Klinis Terpusat (menggantikan hardcode)

**Tujuan:** satu seam kebenaran untuk "layanan ini boleh untuk siapa", dipakai katalog **dan** booking. Ambang 34/37 minggu pindah ke DB (menutup #218).

**Blast radius:** tinggi (tool katalog + booking). Wajib golden/regression gate.

### T2.1 Kolom klinis baru di `clinic_services`

**File:** `prisma/schema.prisma` (model `ClinicService`, baris ±526)

```prisma
  /// Fase 2: ambang usia kehamilan minimum (minggu) — null = tidak dibatasi.
  min_gestational_weeks Int?
  /// Fase 2: ambang usia kehamilan maksimum (minggu) — null = tidak dibatasi.
  max_gestational_weeks Int?
  /// Fase 2: keluarga klinis data-driven: INDUCTION | PERINEUM | PRENATAL |
  /// POSTPARTUM | LACTATION | GENERAL | null.
  clinical_family       String?
```

**Migrasi:** `prisma/migrations/20261105121000_add_clinical_service_thresholds/migration.sql`

```sql
ALTER TABLE "clinic_services" ADD COLUMN IF NOT EXISTS "min_gestational_weeks" INTEGER;
ALTER TABLE "clinic_services" ADD COLUMN IF NOT EXISTS "max_gestational_weeks" INTEGER;
ALTER TABLE "clinic_services" ADD COLUMN IF NOT EXISTS "clinical_family" TEXT;
```

**Seed nilai awal (data, bukan kode):**

```sql
UPDATE "clinic_services" SET clinical_family = 'INDUCTION', min_gestational_weeks = 37
  WHERE service_id IN ('moms-induksi-massage','moms-induksi-fullbody');
UPDATE "clinic_services" SET clinical_family = 'PERINEUM', min_gestational_weeks = 34
  WHERE service_id = 'moms-perineum-massage';
UPDATE "clinic_services" SET clinical_family = 'PRENATAL'
  WHERE service_id IN ('moms-prenatal-massage','moms-prenatal-yoga');
UPDATE "clinic_services" SET clinical_family = 'LACTATION'
  WHERE service_id IN ('moms-paket-laktasi','moms-oksitosin','moms-oksitosin-fullbody');
UPDATE "clinic_services" SET clinical_family = 'POSTPARTUM'
  WHERE service_id = 'moms-postpartum-massage';
```

**Acceptance:** tidak ada perubahan nominal/harga; diff schema bersih.

### T2.2 Perluas tipe & pemuatan katalog

**File:** `src/services/treatment-catalog.service.ts`

1. `ClinicServiceItem` (baris ±80):

```ts
  minGestationalWeeks?: number | null;
  maxGestationalWeeks?: number | null;
  clinicalFamily?: string | null;
```

2. `inferEligibleLifeStages` tetap. Tambahkan fungsi murni setelahnya:

```ts
export function inferClinicalFamily(item: {
  id?: string;
  name?: string;
  description?: string;
  eligibleLifeStages?: string[];
}): string | null {
  const text = `${item.id || ''} ${item.name || ''} ${item.description || ''}`.toLowerCase();
  if (text.includes('induksi')) return 'INDUCTION';
  if (text.includes('perineum')) return 'PERINEUM';
  if (text.includes('prenatal') || text.includes('pregnant') || text.includes('hamil')) return 'PRENATAL';
  if (text.includes('laktasi') || text.includes('oksitosin') || text.includes('breast care')) return 'LACTATION';
  if (text.includes('postpartum') || text.includes('nifas')) return 'POSTPARTUM';
  if ((item.eligibleLifeStages || []).includes('GENERAL')) return 'GENERAL';
  return null;
}
```

3. `loadServicesFromDb` (baris ±977) tambahkan:

```ts
          minGestationalWeeks: (s as any).min_gestational_weeks ?? null,
          maxGestationalWeeks: (s as any).max_gestational_weeks ?? null,
          clinicalFamily: (s as any).clinical_family ?? null,
```

4. `saveServicesToDb` (baris ±1066) tambahkan:

```ts
          min_gestational_weeks: s.minGestationalWeeks ?? null,
          max_gestational_weeks: s.maxGestationalWeeks ?? null,
          clinical_family: s.clinicalFamily ?? inferClinicalFamily(s),
```

### T2.3 Modul evaluator kelayakan

**File baru:** `src/services/clinical-eligibility.service.ts`

```ts
import type { ClinicServiceItem } from './treatment-catalog.service';
import { inferEligibleLifeStages, inferClinicalFamily } from './treatment-catalog.service';
import { canonicalMomStage } from './maternal-state.service';

export type EligibilityStatus = 'ELIGIBLE' | 'BLOCKED' | 'NEEDS_SCREENING';
export type EligibilityCode =
  | 'STAGE_MISMATCH' | 'STAGE_UNKNOWN' | 'GESTATIONAL_MIN' | 'GESTATIONAL_MAX'
  | 'CONTRAINDICATION' | 'SCREENING_REQUIRED';

export interface ClinicalContext {
  momStage?: string | null;
  gestationalWeeks?: number | null;
  childAgeMonths?: number | null;
  feverContraindication?: boolean;
  screeningConfirmed?: boolean;
}

export interface EligibilityDecision {
  status: EligibilityStatus;
  code?: EligibilityCode;
  reason?: string;
}

/** Ambang legacy = fallback bila kolom DB kosong (paritas perilaku). */
function legacyMinWeeks(service: ClinicServiceItem, family: string | null): number | null {
  if (service.minGestationalWeeks != null) return service.minGestationalWeeks;
  if (family === 'INDUCTION') return 37;
  if (family === 'PERINEUM') return 34;
  return null;
}

export function evaluateServiceEligibility(
  service: ClinicServiceItem,
  ctx: ClinicalContext
): EligibilityDecision {
  const stages = (service.eligibleLifeStages && service.eligibleLifeStages.length > 0)
    ? service.eligibleLifeStages
    : inferEligibleLifeStages(service as any);
  const family = service.clinicalFamily ?? inferClinicalFamily(service as any);
  const isStageSpecific = !stages.includes('GENERAL') && !stages.includes('UNKNOWN');

  // Kontraindikasi deterministik dari state klinis terstruktur.
  if (ctx.feverContraindication && (service.contraindications || []).includes('FEVER')) {
    return { status: 'BLOCKED', code: 'CONTRAINDICATION', reason: 'Suhu tubuh terindikasi demam' };
  }

  const momStage = canonicalMomStage(ctx.momStage);
  if (momStage === 'PREGNANT') {
    const isLactationOrPostpartum = stages.some((s) => s === 'POSTPARTUM' || s === 'LACTATING')
      && !stages.includes('PREGNANT');
    if (isLactationOrPostpartum) {
      return { status: 'BLOCKED', code: 'STAGE_MISMATCH', reason: 'Layanan untuk fase nifas/menyusui' };
    }
    const minWeeks = legacyMinWeeks(service, family);
    const maxWeeks = service.maxGestationalWeeks ?? null;
    const weeks = typeof ctx.gestationalWeeks === 'number' ? ctx.gestationalWeeks : null;
    if (minWeeks != null && (weeks == null || weeks < minWeeks)) {
      return { status: 'BLOCKED', code: 'GESTATIONAL_MIN', reason: `Minimal ${minWeeks} minggu` };
    }
    if (maxWeeks != null && weeks != null && weeks > maxWeeks) {
      return { status: 'BLOCKED', code: 'GESTATIONAL_MAX', reason: `Maksimal ${maxWeeks} minggu` };
    }
  }

  if (momStage === 'POSTPARTUM' || momStage === 'LACTATING') {
    const isPregnantOnly = stages.some((s) => s === 'PREGNANT' || s === 'PREGNANT_ATERM')
      && !stages.includes('POSTPARTUM') && !stages.includes('LACTATING');
    if (isPregnantOnly) {
      return { status: 'BLOCKED', code: 'STAGE_MISMATCH', reason: 'Layanan untuk fase kehamilan' };
    }
  }

  if (momStage === 'GENERAL' && isStageSpecific) {
    return { status: 'BLOCKED', code: 'STAGE_MISMATCH', reason: 'Perlu konfirmasi tahap hidup' };
  }

  if (!momStage && isStageSpecific) {
    return { status: 'BLOCKED', code: 'STAGE_UNKNOWN', reason: 'Tahap hidup belum diketahui' };
  }

  if (service.requiresScreening && !ctx.screeningConfirmed) {
    return { status: 'NEEDS_SCREENING', code: 'SCREENING_REQUIRED', reason: 'Wajib skrining bidan' };
  }

  return { status: 'ELIGIBLE' };
}
```

### T2.4 Ganti gerbang hardcode di katalog

**File:** `src/v3/tools/get-catalog.tool.ts`

Ganti blok `Phase 2 — Clinical linkage` (599-635) dan `Phase 1 — Clinical Safety` (637-680) dengan evaluator. Perilaku yang **wajib dipertahankan**:
- Prenatal dihapus untuk `POSTPARTUM`/`BREASTFEEDING` kecuali diminta eksplisit.
- Induksi <37 minggu & Perineum <34 minggu dihapus, kecuali diminta eksplisit (katalog saja).
- Urutan prioritas: Prenatal #1 untuk hamil; Laktasi/Oksitosin #1 untuk menyusui; induksi/perineum di ekor.

Kerangka pengganti:

```ts
    // Fase 2 — kelayakan klinis terpusat (satu seam, data-driven).
    const explicitName = (specificTreatmentName || '').toLowerCase();
    const explicitlyWants = (id: string): boolean => {
      if (!explicitName.trim()) return false;
      const hit = treatmentCatalogService.getServiceById(id, tenantId);
      return Boolean(hit && (explicitName.includes('prenatal') || explicitName.includes('hamil')
        || explicitName.includes('yoga') || explicitName.includes(hit.name.toLowerCase())));
    };

    const before = [...formattedTreatments];
    const eligiblePool = before.filter((t) => {
      const d = evaluateServiceEligibility(t as any, { momStage, gestationalWeeks, childAgeMonths });
      if (d.status !== 'BLOCKED') return true;
      // Katalog: permintaan eksplisit tetap ditampilkan agar LLM bisa mengedukasi,
      // tetapi booking tetap diblokir di Fase 2.5.
      return explicitlyWants(t.id) && d.code === 'GESTATIONAL_MIN';
    });
    if (eligiblePool.length > 0) {
      formattedTreatments.length = 0;
      formattedTreatments.push(...eligiblePool);
    }

    const priorityOf = (id: string): number => {
      const svc = before.find((t) => t.id === id) as any;
      const family = svc?.clinicalFamily ?? inferClinicalFamily(svc || {});
      if (momStage === 'PREGNANT') {
        return family === 'PRENATAL' ? 0
          : (family === 'INDUCTION' || family === 'PERINEUM') ? 3
          : 2;
      }
      if (momStage === 'POSTPARTUM' || momStage === 'BREASTFEEDING') {
        return id === 'moms-paket-laktasi' ? 0
          : id === 'moms-oksitosin-fullbody' ? 1
          : family === 'PRENATAL' ? 99
          : 2;
      }
      return 2;
    };
    formattedTreatments.sort((a, b) => priorityOf(a.id) - priorityOf(b.id));
```

Import:

```ts
import { evaluateServiceEligibility } from '../../services/clinical-eligibility.service';
import { inferClinicalFamily } from '../../services/treatment-catalog.service';
```

**Acceptance:** `tests/unit/v3-pregnant-catalog-priority.test.ts`, `v3-pregnant-both-category.test.ts`, `v3-catalog-stage-filter.test.ts` tetap hijau tanpa mengubah ekspektasi.

### T2.5 Gerbang keras di booking (tool contract)

**File:** `src/v3/tools/save-reservation.tool.ts`

Tambahkan **sebelum** `reservationCoreService.saveReservation` (baris ±546):

```ts
    // Fase 2 — gerbang kelengkapan klinis deterministik (bukan prompt).
    // DILARANG menulis reservasi yang melanggar kontraindikasi/ambang gestasional.
    const eligibility = evaluateReservationEligibility({
      tenantId,
      treatmentNames: allTreatments,
      context: {
        momStage: effectiveMomStage,
        gestationalWeeks,
        childAgeMonths: eldestChildAgeMonths ?? undefined,
        feverContraindication: Boolean((input as any).feverContraindication),
        screeningConfirmed: Boolean((input as any).screeningConfirmed),
      },
    });
    if (!eligibility.allowed) {
      console.warn(JSON.stringify({
        event: 'V3_CLINICAL_ELIGIBILITY_BLOCKED',
        tenantId,
        code: eligibility.code,
        treatments: allTreatments,
        momStage: effectiveMomStage,
        gestationalWeeks,
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        summary: 'Layanan belum dapat dipesan sesuai hasil skrining klinis',
        message: eligibility.message,
      };
    }
```

**File baru:** fungsi agregator di `src/services/clinical-eligibility.service.ts`

```ts
import { treatmentCatalogService } from './treatment-catalog.service';

export function evaluateReservationEligibility(params: {
  tenantId: string;
  treatmentNames: string[];
  context: ClinicalContext;
}): { allowed: boolean; code?: EligibilityCode; message?: string } {
  const decisions = params.treatmentNames
    .map((name) => treatmentCatalogService.matchCatalogItem(name, params.tenantId))
    .filter(Boolean)
    .map((svc) => ({ svc: svc as ClinicServiceItem, d: evaluateServiceEligibility(svc as ClinicServiceItem, params.context) }));

  const blocked = decisions.find((x) => x.d.status === 'BLOCKED');
  if (blocked) {
    return {
      allowed: false,
      code: blocked.d.code,
      message: `Untuk keamanan Bunda, layanan *${blocked.svc.name}* belum dapat dijadwalkan saat ini (${blocked.d.reason}). Bidan kami akan membantu menentukan layanan yang sesuai.`,
    };
  }
  const screening = decisions.find((x) => x.d.status === 'NEEDS_SCREENING');
  if (screening) {
    return {
      allowed: false,
      code: 'SCREENING_REQUIRED',
      message: `Sebelum menjadwalkan *${screening.svc.name}*, Bidan kami perlu melakukan skrining singkat terlebih dahulu ya Bunda.`,
    };
  }
  return { allowed: true };
}
```

### T2.6 Teruskan fakta klinis dari pipeline

**File:** `src/v3/agent/pipeline/tool-pipeline.ts` (dekat enrichment `momProfile`, baris ±448)

Saat `fnName === 'save_reservation'`, suntikkan:

```ts
        if (fnArgs.feverContraindication == null && (session as any).feverContraindication === true) {
          fnArgs.feverContraindication = true;
        }
```

**Acceptance:** test baru membuktikan `save_reservation` menolak kombinasi hamil 30 minggu + Induksi Massage, dan tetap menerima Pregnant Massage.

### T2.7 Test Fase 2

**File baru:** `tests/unit/clinical-eligibility.test.ts`
1. Hamil 30 minggu + Induksi → `BLOCKED/GESTATIONAL_MIN`.
2. Hamil 38 minggu + Induksi → `ELIGIBLE`.
3. Hamil 30 minggu + Perineum → `BLOCKED`.
4. Nifas + Pregnant Massage → `BLOCKED/STAGE_MISMATCH`.
5. Hamil + `feverContraindication` + layanan ber-kontraindikasi `FEVER` → `BLOCKED/CONTRAINDICATION`.
6. `requiresScreening` + belum skrining → `NEEDS_SCREENING`.
7. Kolom DB kosong + nama "Induksi" → tetap 37 minggu (fallback parity).

**File baru:** `tests/integration/save-reservation-clinical-gate.test.ts`
- `executeSaveReservation` dengan induksi preterm → `success:false`, `reservationCoreService.saveReservation` **tidak** dipanggil.

**Gate F2:** seluruh suite regresi katalog + booking hijau.

---

## FASE 3 — Alur Skrining, Eskalasi & Admin

**Tujuan:** keputusan `BLOCKED`/`NEEDS_SCREENING` tidak berhenti sebagai pesan — ada jejak operasional ke bidan + admin bisa mengatur data klinis.

### T3.1 Eskalasi deterministik saat blokir klinis

**File:** `src/v3/tools/save-reservation.tool.ts` (di dalam cabang `!eligibility.allowed`, sebelum `return`)

```ts
      if (eligibility.code === 'CONTRAINDICATION' || eligibility.code === 'STAGE_MISMATCH' || eligibility.code === 'GESTATIONAL_MIN') {
        try {
          const { executeEscalateHuman } = await import('./escalate-human.tool');
          await executeEscalateHuman({
            conversationId,
            phone: '',
            tenantId,
            reason: `Blokir klinis ${eligibility.code}: ${allTreatments.join(' + ')}`,
            severity: 'MEDIUM',
          });
        } catch {}
      }
```

> `severity: 'MEDIUM'` tidak memicu alert darurat; hanya handoff percakapan ke Bidan. `HIGH`/`CRITICAL_MEDICAL` tetap untuk kegawatdaruratan.

### T3.2 Badge & ringkasan bidan memakai state terstruktur

**File:** `src/services/staff-notification.service.ts` (baris ±838-846)

Ganti deteksi teks dengan prioritas kolom:

```ts
          const structuredStage = String((reservation as any).mom_stage || '').toUpperCase();
          const weeks = (reservation as any).gestational_weeks;
          if (structuredStage === 'PREGNANT' || (!structuredStage && (detail.includes('hamil') || detail.includes('prenatal')))) {
            patientDetail = weeks ? `Ibu Hamil (${weeks} minggu)` : 'Ibu Hamil';
          } else if (structuredStage === 'POSTPARTUM' || (!structuredStage && detail.includes('postpartum'))) {
            patientDetail = 'Ibu Nifas / Pasca Salin';
          } else if (structuredStage === 'LACTATING') {
            patientDetail = 'Ibu Menyusui / Laktasi';
          } else {
            patientDetail = 'Moms';
          }
```

Tambahkan baris risiko bila `reservation.hpl_date` ada:

```ts
          if ((reservation as any).hpl_date) {
            patientDetail += ` • HPL ${new Date((reservation as any).hpl_date).toISOString().slice(0, 10)}`;
          }
```

### T3.3 Admin dapat mengatur field klinis (API)

**File:** `src/routes/admin/settings.subroute.ts`

- `POST /api/admin/services` (baris ±1873): tambahkan ke objek `upsertService`:

```ts
      eligibleLifeStages: Array.isArray(serviceData.eligibleLifeStages) ? serviceData.eligibleLifeStages : [],
      contraindications: Array.isArray(serviceData.contraindications) ? serviceData.contraindications : [],
      requiresScreening: serviceData.requiresScreening === true,
      minGestationalWeeks: serviceData.minGestationalWeeks == null ? null : Number(serviceData.minGestationalWeeks),
      maxGestationalWeeks: serviceData.maxGestationalWeeks == null ? null : Number(serviceData.maxGestationalWeeks),
      clinicalFamily: serviceData.clinicalFamily || null,
```

- `PUT /api/admin/services/:id` (baris ±1946) sudah memakai spread `merged`; tambahkan normalisasi eksplisit agar tidak menerima string liar:

```ts
        eligibleLifeStages: Array.isArray(merged.eligibleLifeStages) ? merged.eligibleLifeStages : existing.eligibleLifeStages || [],
        contraindications: Array.isArray(merged.contraindications) ? merged.contraindications : existing.contraindications || [],
        requiresScreening: merged.requiresScreening === true,
```

### T3.4 Admin UI field klinis

**File:** `packages/admin-dashboard/src/pages/tenant/ClinicServices.tsx`

1. Interface (baris ±49):

```ts
  eligibleLifeStages?: string[];
  contraindications?: string[];
  requiresScreening?: boolean;
  minGestationalWeeks?: number | null;
  maxGestationalWeeks?: number | null;
  clinicalFamily?: string | null;
```

2. State form (baris ±82):

```ts
  const [formLifeStages, setFormLifeStages] = useState<string[]>([]);
  const [formContraindications, setFormContraindications] = useState<string[]>([]);
  const [formRequiresScreening, setFormRequiresScreening] = useState(false);
  const [formMinWeeks, setFormMinWeeks] = useState<number | ''>('');
  const [formMaxWeeks, setFormMaxWeeks] = useState<number | ''>('');
  const [formClinicalFamily, setFormClinicalFamily] = useState('');
```

3. `openEditModal` (baris ±205):

```ts
    setFormLifeStages(srv.eligibleLifeStages || []);
    setFormContraindications(srv.contraindications || []);
    setFormRequiresScreening(srv.requiresScreening === true);
    setFormMinWeeks(srv.minGestationalWeeks ?? '');
    setFormMaxWeeks(srv.maxGestationalWeeks ?? '');
    setFormClinicalFamily(srv.clinicalFamily || '');
```

4. Payload `handleSave` (baris ±270):

```ts
      eligibleLifeStages: formLifeStages,
      contraindications: formContraindications,
      requiresScreening: formRequiresScreening,
      minGestationalWeeks: formMinWeeks === '' ? null : Number(formMinWeeks),
      maxGestationalWeeks: formMaxWeeks === '' ? null : Number(formMaxWeeks),
      clinicalFamily: formClinicalFamily || null,
```

5. UI: tampilkan blok hanya bila `formCategory === 'MOMS' || formCategory === 'BOTH'`:
   - checkbox `PREGNANT`, `PREGNANT_ATERM`, `POSTPARTUM`, `LACTATING`, `GENERAL`;
   - checkbox kontraindikasi `FEVER`, `TRIMESTER_1`;
   - toggle `requiresScreening`;
   - number input min/max minggu;
   - select `clinicalFamily`.

**Acceptance:** create/edit layanan MOMS menyimpan field klinis dan bertahan setelah reload.

### T3.5 Test Fase 3

**File baru:** `tests/unit/admin-services-clinical-fields.test.ts`
- POST menyimpan `eligibleLifeStages`, `contraindications`, `requiresScreening`.
- PUT mempertahankan nilai lama bila body tidak mengirim field (anti-wipe).
- Nilai non-array ditolak/dinormalisasi (tidak tersimpan sebagai string).

**Gate F3:** `npm run build` (root) + `cd packages/admin-dashboard; npm run build`.

---

## FASE 4 — Follow-Up per Tahap Ibu

**Tujuan:** follow-up tidak lagi generik; ibu hamil/nifas/menyusui mendapat narasi sesuai fase; `NO_PURCHASE` tidak menawarkan "si kecil" ke prospek ibu hamil.

### T4.1 State tahap pada follow-up

**File:** `prisma/schema.prisma` (model `FollowUp`, setelah `treatment_category`, baris ±629)

```prisma
  /// Fase 4: tahap ibu saat baris dibuat (PREGNANT|POSTPARTUM|LACTATING|GENERAL).
  /// NULL = bukan Moms / data lama.
  mom_stage       String?
```

**Migrasi:** `prisma/migrations/20261105122000_add_followup_mom_stage/migration.sql`

```sql
ALTER TABLE "follow_ups" ADD COLUMN IF NOT EXISTS "mom_stage" TEXT;
```

### T4.2 Isi `mom_stage` saat membuat follow-up

**File:** `src/services/follow-up.service.ts`

- `createNextTreatmentFollowUps` (baris ±1046): tambahkan ke `data`:

```ts
              ...(reservationMomStage ? { mom_stage: reservationMomStage } : {}),
```

dengan sumber `reservationMomStage` dari `reservation.mom_stage` (select yang sudah ada di baris ±1099 ditambah `mom_stage: true`).

- `createNoPurchaseFollowUps` (baris ±443): sebelum `Promise.all`, ambil state sesi terakhir (best-effort, offline-safe):

```ts
    let audience: 'MOMS' | null = null;
    let momStage: string | null = null;
    try {
      const conv = await prisma.conversation?.findFirst?.({
        where: { customer_id: customerId, tenant_id: tenantId },
        orderBy: { last_message_at: 'desc' },
        select: { session_data: true },
      });
      const sd: any = (conv as any)?.session_data || {};
      if (sd.targetAudience === 'MOMS' || sd.momProfile?.stage) audience = 'MOMS';
      momStage = canonicalMomStage(sd.momProfile?.stage);
    } catch {}
```

lalu di `create`:

```ts
                ...(audience === 'MOMS' ? { treatment_category: 'MOMS' as any } : {}),
                ...(momStage ? { mom_stage: momStage } : {}),
```

> Catatan: bila DB offline, `audience` null → perilaku lama (anti-regresi). Ini didokumentasikan.

### T4.3 Template sadar tahap

**File:** `src/config/followup-templates.ts`

1. Perluas `FollowUpTemplateParams` (baris ±13):

```ts
  /** Fase 4: tahap ibu untuk memilih narasi (PREGNANT|POSTPARTUM|LACTATING). */
  momStage?: string | null;
```

2. Perluas union `FollowUpTemplateType` (baris ±42):

```ts
  | 'NO_PURCHASE_MOMS_1'
  | 'NO_PURCHASE_MOMS_2'
  | 'NO_PURCHASE_MOMS_3'
```

3. Buat helper narasi deterministik di atas `FOLLOWUP_ROLLING_TEMPLATES`:

```ts
function momPhaseLine(momStage?: string | null): string {
  const s = String(momStage || '').toUpperCase();
  if (s === 'PREGNANT' || s === 'PREGNANT_ATERM') return 'selama masa kehamilan';
  if (s === 'POSTPARTUM') return 'di masa nifas dan pemulihan pasca persalinan';
  if (s === 'LACTATING' || s === 'BREASTFEEDING') return 'selama masa menyusui';
  return 'untuk perawatan Bunda';
}
```

4. Sisipkan `momPhaseLine` pada 3 template `NEXT_TREATMENT_MOMS_*` (baris 163-188), contoh:

```ts
    ({ name, momStage }) =>
      `Halo Bunda ${name}! 🌸 Sudah 1 bulan sejak perawatan terakhir Bunda di ${getBrandIdentity().businessName}. Bagaimana kondisi Bunda ${momPhaseLine(momStage)} sekarang? Kami siap bantu jadwalkan sesi perawatan berikutnya kapan pun Bunda siap. 🥰`,
```

5. Tambah keluarga `NO_PURCHASE_MOMS_1..3` (tanpa `{babyName}`, tanpa "si kecil"):

```ts
  NO_PURCHASE_MOMS_1: [
    ({ name, momStage }) =>
      `Halo Bunda ${name}! ✨ Kemarin sempat tanya-tanya perawatan ${momPhaseLine(momStage)} ya bund. Apakah ada yang mau ditanyakan lagi atau mau Bidan bantu jadwalkan? 😊`,
    ({ name, momStage }) =>
      `Pagi Bunda ${name}! 🌸 Bidan siap bantu rekomendasikan perawatan yang sesuai ${momPhaseLine(momStage)}. Mau Bidan bantu pilihkan? 🤗`,
    ({ name, momStage }) =>
      `Salam Bunda ${name}! ✨ Kalau Bunda butuh informasi seputar perawatan ${momPhaseLine(momStage)}, jangan ragu tanya Bidan ya bund. Kami siap datang ke rumah! 🥰`,
  ],
  NO_PURCHASE_MOMS_2: [ /* 3 varian, pola sama, tanpa narasi bayi */ ],
  NO_PURCHASE_MOMS_3: [ /* 3 varian penutup */ ],
```

### T4.4 Pemilihan template deterministik

**File:** `src/services/follow-up.service.ts`

- Untuk `NEXT_TREATMENT`, teruskan `momStage` saat render (baris ±2147):

```ts
              momStage: (fu as any).mom_stage ?? null,
```

- Cabang `NO_PURCHASE` (baris ±2068):

```ts
        const isMomsNoPurchase = isMomsCategory(fu.treatment_category ?? fu.reservation?.treatment_category);
        templateType = isMomsNoPurchase
          ? (`NO_PURCHASE_MOMS_${Math.min(3, Math.max(1, fu.stage))}` as any)
          : (`NO_PURCHASE_${Math.min(3, Math.max(1, fu.stage))}` as any);
```

- Custom template DB (baris ±2130) tetap menang; tidak ada perubahan.

### T4.5 Kontrak placeholder & WABA & admin

- `src/utils/followup-placeholder.ts:18`: tambahkan `t.startsWith('NO_PURCHASE_MOMS_')`.
- `src/services/waba-template.service.ts:27-46`: tambahkan mapping `NO_PURCHASE_MOMS_1..3` → `followup_no_purchase_moms_{n}`, kategori `MARKETING`.
- `packages/admin-dashboard/src/pages/tenant/FollowUpTemplates.tsx:52-106`: daftarkan 3 tipe baru (label + deskripsi).
- `packages/admin-dashboard/src/components/customer/CustomerFollowUpSection.tsx:32-38`: tambahkan label `NO_PURCHASE_MOMS`.

> **Gerbang Meta:** template WABA baru WAJIB didaftarkan & disetujui di Meta sebelum dipakai produksi. Ini **bukan** perubahan kode; masukkan ke runbook deploy.

### T4.6 (Opsional — butuh keputusan Bidan) Pengingat HPL

Jika disetujui:
- Tambah `FollowUpType` `REMINDER_HPL` (migrasi enum; ikuti pola `20260840000000_add_reminder_and_review_followups`).
- Cron harian: pilih reservasi `hpl_date` = H+3/H+1, buat follow-up.
- Template `REMINDER_HPL_1..3`.

Bila tidak disetujui: **defer** dan catat di `KNOWN_ISSUES.md`.

### T4.7 Test Fase 4

**File baru:** `tests/unit/follow-up-maternal-stage.test.ts`
1. `NEXT_TREATMENT_MOMS_1` dengan `momStage='PREGNANT'` memuat "kehamilan" dan **tidak** memuat "si kecil"/`{babyName}`.
2. `momStage='POSTPARTUM'` memuat "nifas".
3. `NO_PURCHASE` kategori MOMS → `NO_PURCHASE_MOMS_n` (bukan `NO_PURCHASE_n`).
4. `NO_PURCHASE` kategori BABY → tetap `NO_PURCHASE_n` (anti-regresi).
5. DB offline → tetap memakai template default (tidak crash).

**Gate F4:** seluruh suite follow-up hijau.

---

## FASE 5 — Konsistensi Katalog & Token Kanonis

**Tujuan:** menghapus sisa referensi hardcode/legacy dan menyatukan sumber data katalog.

### T5.1 Satukan pembacaan tahap ibu

**File:** `src/services/treatment-catalog.service.ts` (baris ±1855)

Ganti perbandingan mentah dengan token kanonis:

```ts
    const stage = canonicalMomStage(effectiveMomStage);
    if (stage === 'POSTPARTUM' || stage === 'LACTATING') { ... }
```

Import `canonicalMomStage` dari `./maternal-state.service`. Dengan ini `BREASTFEEDING` dari chat tidak lagi lolos tanpa filter saat kategori `BOTH/kosong`.

> Tool schema LLM **tetap** memakai `BREASTFEEDING` (kontrak prompt stabil); kanonisasi hanya di batas data.

### T5.2 Hapus referensi layanan nonaktif

**File:** `src/v3/tools/get-catalog.tool.ts` (prioritas `moms-relaksasi`)

Karena `moms-relaksasi` tidak ada di katalog aktif (dinonaktifkan), hapus cabang id tersebut. Untuk `GENERAL`, gunakan `clinicalFamily === 'GENERAL'` (data-driven). Jika tidak ada layanan GENERAL aktif, pertahankan pesan `MOM_GENERAL_UNSUPPORTED`.

### T5.3 Rekonsiliasi drift katalog (butuh keputusan pemilik klinik)

Sumber yang berbeda saat ini:
- `src/services/treatment-catalog.service.ts` (seed default): 42 item / 38 aktif; `moms-postpartum-massage` **nonaktif**; Oksitosin Fullbody **110.000**.
- `services_custom.json` (fallback boot): postpartum nonaktif; Oksitosin Fullbody **110.000**.
- `packages/admin-dashboard/src/data/clinicServicesFallback.json`: postpartum **aktif**; Oksitosin Fullbody **105.000**.

Langkah setelah keputusan:
1. Tetapkan status & harga final.
2. Samakan `DEFAULT_CLINIC_SERVICES`, `services_custom.json`, dan DB.
3. Jalankan:

```powershell
npm run catalog:seed
npx vitest run tests/unit/catalog-seed-drift.test.ts
```

4. Verifikasi tidak ada perubahan harga tak terduga dengan `git diff --stat` + review manual.

### T5.4 Dokumentasi wajib

- `docs/KNOWN_ISSUES.md`: tutup/ubah status **#218** (ambang pindah DB), tambahkan entri `#307+` untuk sisa (HPL reminder bila defer, WABA approval).
- `docs/FEATURE_INVENTORY.md`: perbarui baris `get_catalog_and_price` (kelayakan klinis), `Follow-Up Drip Worker`, dan tabel skema.
- `CHANGELOG.md`: entri Bahasa Indonesia per fase.
- `graphify update .`

**Gate F5:** `npx vitest run tests/unit/catalog-seed-drift.test.ts` hijau; diff katalog bersih.

---

## 4. Rollback

| Fase | Rollback |
|---|---|
| F1 | Kolom nullable; kode fallback ke `raw_text`. Rollback kode cukup; kolom boleh dibiarkan. |
| F2 | `clinical-eligibility.service.ts` di-bypass dengan flag env `CLINICAL_ELIGIBILITY_ENFORCE=false` (default `true` di produksi). Wajib ada agar insiden bisa dipadamkan tanpa revert besar. |
| F3 | UI/API aditif; rollback dengan revert commit. |
| F4 | Tipe template baru aditif; fallback `getRollingFollowUpMessage` selalu ada. |
| F5 | Perubahan data; backup DB sebelum seed. |

> Flag `CLINICAL_ELIGIBILITY_ENFORCE` wajib dibaca di **satu** tempat (`clinical-eligibility.service.ts`) agar tidak tersebar.

---

## 5. Keputusan yang Membutuhkan Konfirmasi (Confirmation Gate)

1. **D1 — Induksi preterm yang diminta eksplisit:** saat ini katalog masih menampilkan bila diminta eksplisit. Plan default: **blokir booking + eskalasi** (sesuai `docs/clinical-triage-matrix.md` TR-06). Setuju?
2. **D2 — Kontraindikasi awal:** plan memakai token `FEVER` (dari `session.feverContraindication`) dan `TRIMESTER_1`. Perlu tambahan token klinis lain?
3. **D3 — Pengingat HPL:** dieksekusi di F4.6 atau ditunda?
4. **D4 — Status Postpartum Massage & harga Oksitosin Fullbody:** aktif/nonaktif dan nominal final?
5. **D5 — `requires_screening`:** layanan mana yang wajib skrining (indikasi: Induksi, Perineum, atau semua Moms)?

---

## 6. Definition of Done

- [ ] Pregnant Massage & layanan Moms lain tampil, dapat dipesan, dan tercatat dengan `gestational_weeks`/`mom_stage`/`hpl_date`.
- [ ] Booking layanan yang tidak aman **ditolak oleh kode**, bukan oleh prompt.
- [ ] Admin dapat mengubah kelayakan klinis per tenant tanpa deploy.
- [ ] Follow-up Moms tidak lagi bernarasi bayi; `NO_PURCHASE` sadar audiens.
- [ ] `npm run build`, `npm run typecheck`, dan suite regresi hijau.
- [ ] `docs/FEATURE_INVENTORY.md`, `docs/KNOWN_ISSUES.md`, `CHANGELOG.md` diperbarui.
- [ ] Tidak ada dependency runtime baru.

---

**STOP.** Dokumen ini adalah rencana. Tidak ada file kode/test yang diubah dan tidak ada perintah eksekusi yang dijalankan. Eksekusi hanya boleh dimulai setelah pengguna manusia mengetik persetujuan eksplisit (mis. "Setuju, jalankan Fase 1").

---

## 7. Catatan Eksekusi (2026-11-05)

Disetujui pengguna: **"Setuju semua fase berurutan"**, D1 = **blokir + eskalasi**, D3 = **tunda HPL**.

| Fase | Status | Verifikasi |
|---|---|---|
| F1 State maternal | SELESAI | `tests/unit/maternal-state.test.ts` (16), `tests/integration/reservation-maternal-state.test.ts` (3) |
| F2 Mesin kelayakan | SELESAI | `tests/unit/clinical-eligibility.test.ts` (15), `tests/integration/save-reservation-clinical-gate.test.ts` (5) |
| F3 Skrining & admin | SELESAI | `tests/unit/admin-services-clinical-fields.test.ts` (2); dashboard build OK |
| F4 Follow-up fase | SELESAI | `tests/unit/follow-up-maternal-stage.test.ts` (5) + suite follow-up 78 hijau |
| F5 Konsistensi | SELESAI (kecuali F5.3) | `tests/unit/v3-catalog-stage-filter.test.ts` (10) |

**Ditunda / terbuka:**
- F4.6 pengingat HPL → `KNOWN_ISSUES.md` #307.
- F5.3 rekonsiliasi harga/status katalog → `KNOWN_ISSUES.md` #307 (menunggu pemilik klinik). `catalog-seed-drift` tetap gagal seperti baseline.
- WABA `followup_no_purchase_moms_*` perlu pendaftaran/approval Meta sebelum produksi.

**Migrasi belum di-apply:** DB lokal offline saat eksekusi. Jalankan `npx prisma migrate deploy` sebelum deploy kode.

