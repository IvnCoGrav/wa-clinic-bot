# PHASE 6: DEKOMISIONING V2 & ELIMINASI TECHNICAL DEBT

> **Estimasi Total:** 1 Minggu Kerja  
> **Prasyarat:** Seluruh Phase 1 s/d Phase 5 selesai dan terbukti stabil di staging/produksi.  
> **Tujuan Strategis:** Menghapus seluruh residu pipeline legacy V2 (`src/slot-engine/**`, percabangan `USE_V3_AGENT`, mock formulir teks, dan script scratch) secara aman tanpa memutus dependency aktif.

---

## ⚠️ GERBANG VERIFIKASI WAJIB: ANALISIS DEPENDENSI STATIS (TASK 6.0)

### 1. Masalah & Resolusi Kontradiksi Audit
Laporan audit awal mencatat `shadow-engine.ts` dipanggil di `src/routes/webhook.route.ts` (baris 1102, 1175, 1283, 1348). Sementara `shadow-engine.ts` mengimpor `GroundingComposer`, `DecisionMatrix`, dan `SlateStore`.  
Jika file-file tersebut dihapus langsung, pemanggilan dinamis `import('../slot-engine/shadow-engine')` akan melempar runtime error `MODULE_NOT_FOUND` saat `SHADOW_PIPELINE_ENABLED=true`.

### 2. Langkah Eksekusi Wajib Task 6.0:
1. Hapus percabangan shadow pipeline legacy di `src/routes/webhook.route.ts` (baris 1098–1104, 1171–1177, 1279–1285, 1345–1350).
2. Jalankan tool static dependency analysis:
   ```bash
   npx madge --circular src/
   npx ts-prune | grep "slot-engine"
   ```
3. Verifikasi daftar final file yang benar-benar tidak lagi memiliki rantai import aktif sebelum melanjutkan ke Task 6.3.

---

## 🔹 MIKRO-TASK 6.1 — Eliminasi Percabangan `USE_V3_AGENT` di Machine (ID: A4-04)

### 1. Masalah & Lokasi Kode
Di `src/state-machine/machine.ts` baris 411–456:
```typescript
const useV3 = process.env.USE_V3_AGENT !== 'false';
if (useV3) {
  const { V3AgentRunner } = await import('../v3/agent/agent-runner');
  // ...
} else {
  result = await processSlotEngine(handlerCtx); // ❌ Jalur V2 slot-engine
}
```
Percabangan `else` memaksa `src/slot-engine/slot-engine.ts` tetap hidup.

### 2. Modifikasi: `src/state-machine/machine.ts`
1. Hapus baris import `processSlotEngine` di baris 13.
2. Hapus variabel `useV3` dan blok `else { result = await processSlotEngine(handlerCtx); }`.
3. Jadikan `V3AgentRunner.processMessage` sebagai eksekusi tunggal langsung:
```typescript
// Eksekusi Tunggal V3 Agent Runner
const { V3AgentRunner } = await import('../v3/agent/agent-runner');
let effectiveInboundText = incomingText;
if (hasValidLocation && loc) {
  effectiveInboundText = `[Shared Location: ${loc.latitude}, ${loc.longitude}]`;
} else if (!effectiveInboundText && inboundContent) {
  effectiveInboundText = inboundContent;
}

const v3Result = await V3AgentRunner.processMessage({
  tenantId,
  customerId: customer.id,
  conversationId: activeConversation.id,
  phone: customer.phone,
  chatId: `${customer.phone}@c.us`,
  incomingText: effectiveInboundText,
  originalText: (incomingMessage as any).originalText || inboundContent,
  history: historyFormatted,
  skipDbLogging: true,
});
```
4. Lakukan hal yang sama di `src/routes/admin/evaluations.subroute.ts` baris 235 (hapus percabangan `USE_V3_AGENT`).

---

## 🔹 MIKRO-TASK 6.2 — Porting Native V3 ConversationStateSummarizer (ID: A4-02)

### 1. Masalah & Lokasi Kode
Di `src/v3/agent/agent-runner.ts` baris 5 & 74–109:
`V3AgentRunner` masih mengimpor `ConversationStateSummarizer` dan `CustomerSlate` dari `src/slot-engine/` dan membuat fungsi jembatan `buildSlateAdapter()`.

### 2. Modifikasi:
1. Buat file baru `src/v3/state/conversation-summarizer.ts`.
2. Porting logika ringkasan teks 0-token dari `src/slot-engine/conversation-summarizer.ts` agar menerima `CustomerGoalSession` (native V3) secara langsung:
   ```typescript
   export class V3ConversationSummarizer {
     public static summarize(session: CustomerGoalSession, incomingText: string): string {
       // Susun ringkasan deterministik apa yang sudah dibahas & dilarang diulang langsung dari session V3
     }
   }
   ```
3. Di `src/v3/agent/agent-runner.ts`:
   - Ganti import `ConversationStateSummarizer` ke `src/v3/state/conversation-summarizer`.
   - Hapus method adapter usang `V3AgentRunner.buildSlateAdapter`.

---

## 🔹 MIKRO-TASK 6.3 & 6.4 — Pemindahan Bank Few-Shot & Penghapusan File Dead (ID: A4-01 & A1-06)

### 1. Pindahkan Modul Shared yang Masih Dipakai:
Pindahkan bank contoh chat dari folder `slot-engine` ke folder `src/v3/agent/`:
- Pindahkan `src/slot-engine/few-shot-exemplars.ts` -> `src/v3/agent/few-shot-exemplars.ts`.
- Pindahkan `src/slot-engine/gold-few-shot-exemplars.ts` -> `src/v3/agent/gold-few-shot-exemplars.ts`.
- Update path import di `src/v3/agent/persona.ts` dan `src/routes/admin/settings.subroute.ts`.

### 2. Eksekusi Penghapusan File 100% Dead Code di `src/slot-engine/`:
Hapus file-file berikut yang sudah terbukti tidak memiliki import aktif:
```bash
git rm src/slot-engine/decision-matrix.ts
git rm src/slot-engine/adaptive-model-selector.ts
git rm src/slot-engine/persona-composer.ts
git rm src/slot-engine/dynamic-closer.service.ts
git rm src/slot-engine/fast-faq-detector.ts
git rm src/slot-engine/fast-faq-generator.ts
git rm src/slot-engine/grounding-composer.ts
git rm src/slot-engine/reply-generator.ts
git rm src/slot-engine/response-validator.ts
git rm src/slot-engine/slate-store.ts
git rm src/slot-engine/slot-engine.ts
git rm src/slot-engine/shadow-engine.ts
```
Jika `entity-extractor.ts` diimpor oleh `human-background-enrichment.service.ts`, pindahkan ke `src/services/entity-extractor.service.ts` sebelum menghapus sisa folder `src/slot-engine/`.

---

## 🔹 MIKRO-TASK 6.5 — Pembersihan Artefak Formulir Teks Simulasi (ID: A4-03)

### 1. Masalah & Lokasi Kode
Di `src/v3/tools/save-reservation.tool.ts` baris 121:
```typescript
const rawFormText = `[V3 RESERVATION]\nNama: ${customerName || '-]'.replace(']', '')}\nTreatment: ${treatmentDetail}\nJadwal: ${bookingDate} ${bookingTime || ''}\nAnak: ${childLabel}\nCatatan: ${notes || '-'}`;
```
V3 yang sudah menerima JSON bersih dipaksa menyusun string teks formulir simulasi demi memuaskan `upsertReservationForm`.

### 2. Modifikasi: `src/services/reservation-lifecycle.service.ts`
1. Pada `upsertReservationForm`: Jadikan `rawText` opsional (`rawText?: string`). Jika tidak disediakan, fungsi otomatis mengisi `raw_text` dengan format audit ringkas.
2. Di `src/v3/tools/save-reservation.tool.ts`: Hapus perakitan string formulir teks manual, kirimkan langsung field terstruktur (`treatmentDetail`, `bookingDate`, `customerName`, `babies`, `notes`).

---

## 🔹 MIKRO-TASK 6.6 — Pembersihan Script Scratch Ad-hoc (ID: A4-05)

### 1. Lokasi File
`scripts/add-remaining-v3.sh`

### 2. Aksi:
Hapus file script skrap:
```bash
git rm scripts/add-remaining-v3.sh
```

---

## 📋 Checklist Validasi & Verifikasi Akhir Phase 6
- [ ] Task 6.0: Analisis statis `madge` mengonfirmasi 0 import aktif ke file-file yang akan dihapus.
- [ ] Task 6.1: Percabangan `USE_V3_AGENT` telah dihapus total.
- [ ] Task 6.2: `V3ConversationSummarizer` native V3 aktif; `buildSlateAdapter` terhapus.
- [ ] Task 6.3 & 6.4: Seluruh modul dead code V2 terhapus bersih dari git.
- [ ] Task 6.5: `save_reservation` tidak lagi merakit string simulasi teks form.
- [ ] Task 6.6: `scripts/add-remaining-v3.sh` terhapus.
- [ ] Jalankan Full Build:
  ```bash
  npm run build
  ```
  **Kriteria Lolos:** Typecheck `tsc` berhasil tanpa error missing module (`Exit Code 0`).
- [ ] Jalankan Full Test Suite:
  ```bash
  npm test
  ```
  **Kriteria Lolos:** 100% test vitest pass.
- [ ] Jalankan Eval Harness Numerik:
  ```bash
  npm run eval:numeric
  ```
  **Kriteria Lolos:** 100% pass rate.
