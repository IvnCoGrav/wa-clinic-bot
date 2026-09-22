# PLAN 10: Perbaikan Sistemik AI Monitoring Dashboard & Dedicated LLM Execution Tracing

- **Status**: Draft / Ready for Execution
- **Target Komponen**:
  1. `packages/admin-dashboard/src/pages/tenant/AiEvaluations.tsx` (AI Monitoring & Usage Dashboard)
  2. `packages/admin-dashboard/src/pages/tenant/Debug.tsx` (Dedicated LLM Execution Tracing)
  3. `src/utils/llm-execution-logger.ts` (LLM Execution Logger & Heuristic Grouping Engine)
  4. `src/services/entity-extractor.service.ts` (NLU Extractor Task Type Alignment)
- **Tanggal Dibuat**: 2026-09-22
- **Referensi Terkait**: `docs/KNOWN_ISSUES.md`, `docs/plans/PLAN_8_ARCHITECTURE_FIX.md`, `docs/plans/PLAN_9_INTELLIGENCE_AND_EFFICIENCY.md`

---

## 1. Latar Belakang & Ringkasan Temuan Audit

Audit komprehensif pada modul **AI Monitoring & Usage Dashboard** dan **🧠 Dedicated LLM Execution Tracing** mengungkap 7 bug teknis sistemik dan 6 kendala UI/UX:

1. **Filter Flow `NLU_EXTRACTOR` Mismatch / Panggilan Hilang**:
   Filter flow di `Debug.tsx` memfilter secara eksak `l.flowType === 'NLU_EXTRACTOR'`. Log ekstraksi yang tercatat sebagai `SLOT_EXTRACTOR` (legacy atau turn tertentu) tereliminasi dari pencarian.
2. **Bug `useEffect` Polling 6 Detik Me-reset Timer saat Accordion Diklik**:
   Fungsi `loadLogs` mendaftarkan `expandedPhones` ke dependency array-nya. Setiap kali operator membuka/menutup accordion pasien, `loadLogs` di-recreate sehingga `setInterval` 6 detik di-reset. Jika operator menutup semua accordion, auto-sync berikutnya akan secara paksa membuka kembali `data[0]`.
3. **Pemborosan Bandwidth Polling Ganda Tanpa Memandang View Mode**:
   Setiap 6 detik, dashboard memanggil `llm-grouped-logs?limit=300` dan `llm-logs?limit=150` secara bersamaan, padahal operator hanya melihat salah satu mode (`grouped` atau `flat`).
4. **Header Kartu AI Step Menyembunyikan `actualProvider` & `actualModel`**:
   `Debug.tsx` hanya menampilkan `call.modelUsed`. Saat terjadi fallback (misal dari SumoPod ke DeepSeek Direct), operator tidak dapat melihat provider aktual yang melayani request.
5. **Fragmentasi Bubble Chat pada Algoritma Heuristic Clustering**:
   `getGroupedLlmExecutionLogs()` hanya menguji heuristic merge terhadap `bubbles[0]`. Jika log tiba tidak berurutan, panggilan satu bubble terpecah menjadi beberapa bubble terpisah.
6. **Feedback JSON Mentah pada Tab Kualitas LLM-as-Judge**:
   `AiEvaluations.tsx` menampilkan string mentah `[dimensi {"warmth":true,...} gagal: ...] <teks>` tanpa di-parse ke bentuk micro-chips indikator kelulusan dimensi.
7. **Inkonsistensi Penamaan `task_type` pada Audit Buffer**:
   `entity-extractor.service.ts` mencatat `task_type: 'SLOT_EXTRACTOR'`, sementara pipeline V3 mencatat `NLU_EXTRACTOR`.

---

## 2. Rencana Implementasi Terperinci (Staged Phases & Micro-Tasks)

---

### Fase 1: Backend Logging Engine & Pipeline Correlation

Fase ini menuntaskan akar masalah data: hilangnya log saat memfilter `NLU_EXTRACTOR`, fragmentasi bubble chat pada algoritma pengelompokan heuristic, dan inkonsistensi pencatatan `task_type`.

#### [MODIFY] `src/utils/llm-execution-logger.ts`

- **Micro-task 1.1**: Tambahkan dukungan alias `SLOT_EXTRACTOR` saat memfilter `NLU_EXTRACTOR` di `getLlmExecutionLogs()`.
  - *Lokasi*: Baris 301–318.
  - *Kode Pengganti*:
    ```ts
    if (flowFilter === 'V3_GENERATION') {
      logs = logs.filter(
        (l) =>
          l.flowType === 'V3_GENERATION' ||
          (l.flowType === 'V3_ROUTING' && (!l.toolsCalled || l.toolsCalled.length === 0) && !!l.finalReply)
      );
    } else if (flowFilter === 'NLU_EXTRACTOR') {
      logs = logs.filter((l) => l.flowType === 'NLU_EXTRACTOR' || l.flowType === 'SLOT_EXTRACTOR');
    } else {
      logs = logs.filter((l) => l.flowType === flowFilter);
    }
    ```

- **Micro-task 1.2**: Perbaiki algoritma heuristic clustering pada `getGroupedLlmExecutionLogs()`.
  - *Lokasi*: Baris 380–402.
  - *Kode Pengganti*:
    Lakukan pencarian ke seluruh `bubbles` yang masih berada dalam jendela waktu 45 detik (`Math.abs(logTime - new Date(b.timestamp).getTime()) < 45000`) dan memiliki kesamaan teks `customerInput`. Hal ini mencegah pemecahan bubble saat log asinkron tiba tidak berurutan.

- **Micro-task 1.3**: Pastikan field `actualProvider` dan `actualModel` diekspos pada interface `LlmExecutionRecord` dan dipetakan dengan benar ke memori buffer.
  - *Lokasi*: Baris 40–70 & baris 175–205.

---

#### [MODIFY] `src/services/entity-extractor.service.ts`

- **Micro-task 1.4**: Ubah pencatatan `task_type` dari `SLOT_EXTRACTOR` menjadi `NLU_EXTRACTOR`.
  - *Lokasi*: Baris 666 dan 724.
  - *Perubahan*: Ganti `task_type: 'SLOT_EXTRACTOR'` menjadi `task_type: 'NLU_EXTRACTOR'`.

---

#### 🚪 Regression Gate Fase 1
- Jalankan pemeriksaan tipe TypeScript root:
  ```powershell
  npm run build
  ```
- Jalankan unit test logging & extractor:
  ```powershell
  npx vitest run tests/unit/
  ```

---

### Fase 2: Observability & Performa Dedicated LLM Execution Tracing (`Debug.tsx`)

Fase ini memperbaiki bug siklus polling, kebocoran bandwidth ganda, kegagalan styling dark mode, dan transparansi provider aktual.

#### [MODIFY] `packages/admin-dashboard/src/pages/tenant/Debug.tsx`

- **Micro-task 2.1**: Pisahkan state `expandedPhones` dari dependency `loadLogs`.
  - *Lokasi*: Baris 759–787.
  - *Perubahan*:
    Gunakan ref `isInitialLoadedRef = useRef(false)` untuk mengontrol ekspansi awal pasien pertama. Hapus `expandedPhones` dari dependency array `loadLogs`. Mengklik buka/tutup accordion pasien **TIDAK AKAN** me-reset timer auto-sync 6 detik.

- **Micro-task 2.2**: Muat log secara selektif sesuai `viewMode` aktif.
  - *Lokasi*: Baris 762–781.
  - *Perubahan*:
    ```tsx
    if (viewMode === 'grouped') {
      const res = await apiRequest(`/api/admin/debug/llm-grouped-logs?limit=300&flow=${flowFilter}`);
      if (res?.data) setGroupedData(Array.isArray(res.data) ? res.data : []);
    } else {
      const res = await apiRequest(`/api/admin/debug/llm-logs?limit=150&flow=${flowFilter}`);
      if (res?.data) setFlatLogs(Array.isArray(res.data) ? res.data : []);
    }
    ```

- **Micro-task 2.3**: Perbaiki styling Dark Mode pada dropdown Status & input Search.
  - *Lokasi*: Baris 1070–1088.
  - *Perubahan*:
    Tambahkan varian dark mode: `dark:bg-[#202c33] dark:border-[#374248] dark:text-[#e9edef] dark:placeholder-[#8696a0]`.

- **Micro-task 2.4**: Tampilkan `actualProvider` & `actualModel` pada kartu AI step.
  - *Lokasi*: Baris 1272–1280.
  - *Perubahan*:
    Tampilkan pill provider aktual (misal `SumoPod` atau `DeepSeek Direct`). Jika terjadi fallback (`call.status === 'FALLBACK'`), tampilkan label penjelas jalur fallback.

---

#### 🚪 Regression Gate Fase 2
- Jalankan build dashboard:
  ```powershell
  cd "packages/admin-dashboard"; npm run build; cd "../.."
  ```

---

### Fase 3: Modernisasi Presentasi & Evaluasi AI (`AiEvaluations.tsx`)

Fase ini menuntaskan masalah penyajian JSON mentah pada tab Kualitas dan memperbaiki aksesibilitas mobile-native.

#### [MODIFY] `packages/admin-dashboard/src/pages/tenant/AiEvaluations.tsx`

- **Micro-task 3.1**: Tambahkan helper parser untuk feedback LLM-as-Judge.
  - *Lokasi*: Baris 60–70 & baris 358–365.
  - *Perubahan*:
    Ekstrak string `[dimensi {...} gagal: ...] <feedback_text>` menjadi objek terstruktur:
    - Status 5 dimensi: `warmth`, `golden_rules`, `grounding`, `format`, `pronoun`.
    - Tampilkan sebagai 5 micro-badges (hijau jika lulus, merah jika gagal).
    - Tampilkan `<feedback_text>` bersih tanpa kurung kurawal atau JSON mentah.

- **Micro-task 3.2**: Optimasi responsivitas mobile & ukuran touch target.
  - *Lokasi*: Baris 106–118 & baris 218–279.
  - *Perubahan*:
    - Tombol filter rentang hari diperbesar menjadi minimal tinggi 40px (`py-2 px-3.5`) dengan `touch-action: manipulation`.
    - Tambahkan format kartu ringkas untuk layar mobile (`block sm:hidden`) pada tabel riwayat transaksi agar tidak terjadi horizontal clipping yang menyulitkan pembacaan di smartphone.

---

#### 🚪 Regression Gate Fase 3
- Jalankan full build & typecheck kedua package:
  ```powershell
  npm run build
  cd "packages/admin-dashboard"; npm run build; cd "../.."
  ```

---

## 3. Verification Plan

### Automated Tests
1. **Type Checking**:
   ```powershell
   npm run build
   cd "packages/admin-dashboard"; npm run build; cd "../.."
   ```
2. **Unit Tests**:
   ```powershell
   npx vitest run tests/unit/
   ```

### Manual Verification
1. **Verifikasi Dedicated LLM Tracing (`Debug.tsx`)**:
   - Buka dashboard di browser pada rute `/admin/debug`.
   - Pastikan auto-sync 6s berjalan dengan indikator hijau berkedip halus.
   - Klik accordion pasien untuk membuka riwayat chat; pastikan timer 6s **tidak ter-reset** dan accordion tetap terbuka saat data baru masuk.
   - Uji filter flow `🎰 NLU Extractor`: pastikan panggilan NLU tampil sempurna tanpa terfilter hilang.
   - Ganti ke mode gelap (dark mode); pastikan dropdown Status dan kotak Search berwarna gelap alami sesuai palet tema.
2. **Verifikasi AI Monitoring Dashboard (`AiEvaluations.tsx`)**:
   - Buka rute `/admin/ai-evaluations`.
   - Pada tab **Real-Time AI Usage & Biaya (Rp)**, periksa tampilan kolom provider dan estimasi biaya per call.
   - Pada tab **Kualitas Balasan (LLM-as-Judge)**, pastikan feedback tidak lagi memunculkan string JSON mentah melainkan 5 micro-badges dimensi yang rapi dan informatif.
   - Buka via inspeksi mobile (viewport 375px); pastikan tampilan kartu audit log terbaca nyaman tanpa scroll horizontal ekstrem.
