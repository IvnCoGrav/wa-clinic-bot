# RINGKASAN STATUS HANDOVER & ROADMAP EKSEKUSI (PER TANGGAL 2026-09-12)

Dokumen ini mencatat ringkasan status terkini, hasil verifikasi pengujian, dan instruksi transisi untuk melanjutkan pekerjaan di PC lain.

---

## 🏆 1. Status Terverifikasi (Baseline Saat Ini)

- **Hasil Full Vitest Suite**:
  ```
  Test Files  266 passed (266)
  Tests       1951 passed | 19 skipped (1970)
  Duration    150.81s
  Status      100% HIJAU (ZERO FAILURES)
  ```
- **Plan 1 (Tool Registry & Test Price Drift)**: **SELESAI & HIJAU**.
  - `targetPrice: args.targetPrice` sudah aktif di `src/v3/tools/tool-registry.ts`.
  - Proteksi *sibling variant cross-swap* aktif di `GoalTracker.resolveAffirmativeSwap`.
  - 10 berkas test sinkron dengan harga katalog aktif (Pulih Ceria 75k, Moksa 25k).
- **Plan 2 (Agent Runner Decomposition & NLU Collapse)**: **SELESAI & HIJAU**.
  - Monolith `agent-runner.ts` telah tereduksi dari 1.929 LOC menjadi **258 LOC**.
  - 4 sub-modul pipeline aktif dan teruji di `src/v3/agent/pipeline/`:
    - `context-grounder.ts`
    - `tool-pipeline.ts`
    - `generation-stage.ts`
    - `guardrail-pipeline.ts`
  - Unit test pipeline (`tests/unit/v3/context-grounder.test.ts`, `tool-pipeline.test.ts`, `guardrail-pipeline.test.ts`) 15/15 passed.

---

## ⚠️ 2. Catatan Penting Sebelum Pindah PC (Known Issue #47)

- **File Tracked `services_custom.json` Terkena Efek Samping Test**:
  Saat `npm test` dijalankan, test suite memutasi status Bubble Spa (`isActive: false` -> `true`).
  **Sebelum melakukan commit/push**, bersihkan noise diff ini:
  ```bash
  git checkout -- services_custom.json
  ```

---

## 📋 3. Rencana Tindak Lanjut di PC Lain (Plans 3 — 6)

Seluruh rencana prosedural mikro telah tersimpan di direktori `docs/plans/`:

### 🎯 Pilihan Eksekusi Selanjutnya (Urutan Rekomendasi):

1. **PLAN 3 (`docs/plans/PLAN_3_GOAL_TRACKER_DECOMPOSITION_AND_SYMPTOM_SCORER.md`)**:
   - **Tujuan**: Dekomposisi `src/v3/state/goal-tracker.ts` (1.591 LOC) menjadi `CartManager` (manajemen keranjang tanpa DB) dan `PatientProfileExtractor` (parsing demografi).
   - **Fix Issue #48**: Skor semantik frasa multi-kata ("susah makan" vs "susah BAB").
   - **Fix Issue #47**: Isolasi test harness agar `npm test` tidak lagi mengotori file `services_custom.json`.

2. **PLAN 5 (`docs/plans/PLAN_5_WAHA_LABEL_BAN_ENFORCEMENT_AND_GATEWAY_DECOUPLING.md`)**:
   - **Tujuan**: Menghapus total 12 titik pemanggilan mutasi label WAHA (`wahaClient.addLabel`) ke internal database tagging murni (`customer.labels` & `conversation.is_human_handling`).
   - **Fix Issue #38**: Mengatasi flaky test #28 pada `production_edge_cases.test.ts`.

3. **PLAN 4 (`docs/plans/PLAN_4_MULTI_TENANT_PERSONA_NON_DESTRUCTIVE_RAG_AND_PHRASING.md`)**:
   - **Tujuan**: Menghubungkan Call 1 prompt ke DB `TenantPromptConfigService`.
   - **Fix Issue #46**: Mengamankan 14 artikel live FAQ kurasi admin agar tidak terhapus saat seed ulang RAG (idempotent upsert).
   - Membersihkan sisa frasa pihak ketiga (`"slot Bidan kami yang ready"`).

4. **PLAN 6 (`docs/plans/PLAN_6_GEOCODING_RESILIENCE_COMBO_ARITHMETIC_AND_BACKLOG_HARDENING.md`)**:
   - **Fix Issue #26**: Menghilangkan false-positive halusinasi pada kombo 2–3 layanan ad-hoc di `numeric-fact-validator.ts`.
   - **Fix Issue #16**: Parser standar `URL` / `URLSearchParams` untuk tautan Google Maps.
   - **Fix Issue #21**: Kamus koridor jalan arteri Surabaya & Sidoarjo di gazetteer (tanpa kata penanda "Jl.").
   - **Fix Issue #30**: Hardening mitigasi Prisma P2022 pada `tenants.settings`.

---

## 🛠️ 4. Quick Runbook untuk PC Baru

1. **Di PC Ini (Sebelum Tinggal)**:
   ```bash
   git checkout -- services_custom.json
   git status
   # Commit perubahan yang ingin dibawa
   git add src/v3/agent/pipeline/ src/v3/agent/agent-runner.ts src/v3/tools/ docs/plans/
   git commit -m "feat(v3): complete plan 1 and plan 2 runner decomposition"
   git push origin <nama-branch>
   ```

2. **Di PC Baru**:
   ```bash
   git pull origin <nama-branch>
   npm install
   npm run build     # Pastikan tsc 0 error
   npm test          # Pastikan 266 test files passed
   ```

3. **Mulai Eksekusi Plan Berikutnya**:
   Buka `docs/plans/PLAN_3_GOAL_TRACKER_DECOMPOSITION_AND_SYMPTOM_SCORER.md` dan mulai eksekusi Fase 1.
