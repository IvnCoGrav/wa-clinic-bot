# PLAN 11 — Solusi Fondasional Anti-Memburu-Buru Customer (*Funnel Pacing & State-Gated Information Hiding*)

## Ringkasan Eksekutif & Bukti Lapangan
Pada pengujian sandbox live server / local simulator (misal dengan model MiniMax-M2.7 atau model lain), ketika customer baru menginfokan usia si kecil:
> **Customer:** *"usia 6 bulan bund"*  
> **Bot:** *"Ayo segera tangani ya Bund, 6 bulan itu usia yang pas untuk kami bantu 😊 ... Rencana mau kami bantu jadwalkan di hari apa ya Bund? 😊"*

Customer merasa diburu-buru (*hard-selling / pushy*) karena:
1. **Frasa desakan imperatif:** *"Ayo segera tangani ya Bund"* (memicu kecemasan/mom-guilt).
2. **Melompati tahapan konversi (*premature closing*):** Menodong hari jadwal padahal customer belum pernah menyetujui paket atau menyatakan komitmen beli (`session.lastCommitment === 'EXPLORING'`, `session.cartItems.length === 0`).

---

## Multi-Layer Root Cause Audit (Akar Masalah Sistemik)

1. **Pelanggaran Mandat Information Hiding di Prompt (`src/v3/agent/prompt/prompt-composer.ts:86-101, 268-270`)**:
   - `buildHierarchyFull` dan `buildNegativeConstraintsBlock` selalu menyertakan `SCHEDULING_HIERARCHY_BLOCK` dan `SCHEDULE_NEG_CONSTRAINTS_TAIL` di setiap turn Call 2, meskipun customer masih berada di fase `CONSULTATION`.
   - `src/v3/agent/pipeline/generation-stage.ts:666` tidak pernah mengoper `phaseInjection: { focus: derivePhaseFocus(session), slim: true }`, sehingga `composeSystemPrompt` selalu jatuh ke mode default `buildHierarchyFull` yang memuat seluruh instruksi penjadwalan.
2. **Contoh Prompt yang Menjadi "Self-Fulfilling Prophecy" (`src/v3/agent/prompt/phases/scheduling.phase.ts:55`)**:
   - Baris 55 secara eksplisit memuat contoh: `Tanyakan HANYA preferensi hari (contoh: "Rencana mau kami bantu jadwalkan di hari apa ya Bunda? 🤗")`. Model membaca contoh ini dan langsung menyalinnya ke balasan.
3. **Ketiadaan Gerbang Kode Deterministik di Output Pipeline (`generation-stage.ts`)**:
   - Tidak ada hard-gate yang memeriksa apakah LLM melompat ke pertanyaan jadwal saat `session.lastCommitment === 'EXPLORING'`.

---

## Staged Implementation Plan (Tahapan Eksekusi)

### Fase 1: State-Gated Information Hiding pada Prompt
* **File:** `src/v3/agent/prompt/phases/scheduling.phase.ts`
  - Bersihkan contoh pemicu di baris 55 yang mengajarkan LLM menodong hari.
  - Ubah dari `Tanyakan HANYA preferensi hari (contoh: "Rencana mau kami bantu jadwalkan di hari apa ya Bunda? 🤗")` menjadi instruksi netral: `Tanyakan preferensi hari HANYA JIKA customer sudah menyetujui treatment. DILARANG menanyakan jam kunjungan.`
* **File:** `src/v3/agent/prompt/prompt-composer.ts`
  - Pada `buildNegativeConstraintsBlock(session)`:
    - Cek apakah customer sudah dalam fase penjadwalan (`hasCommittedTreatment`):
      ```ts
      const hasCommittedTreatment = Boolean(
        (session as any)?.selectedTreatment != null ||
        (Array.isArray((session as any)?.cartItems) && (session as any).cartItems.length > 0) ||
        (session as any)?.booking?.preferredDate != null ||
        (session as any)?.lastCommitment === 'COMMITTED'
      );
      ```
    - Jika `!hasCommittedTreatment`:
      - Cabut `SCHEDULE_NEG_CONSTRAINTS_TAIL` (aturan 20-21) dari blok negative constraints.
      - Ganti dengan direktif konsultasi murni:
        ```ts
        '20. KONTROL PENUTUP KONSULTASI: Customer belum menyetujui paket treatment. DILARANG menanyakan hari/jadwal/tanggal kunjungan. Akhiri HANYA dengan konfirmasi minat santun (contoh: "Apakah Bunda tertarik untuk mencoba perawatan ini untuk si kecil? 🤗") atau pertanyaan medis/usia jika belum diketahui.'
        ```

### Fase 2: Wiring Phase-Focus Slim di Generation Stage
* **File:** `src/v3/agent/pipeline/generation-stage.ts`
  - Pada baris 666 pemanggilan `PersonaPromptBuilder.buildSystemPromptAsync`:
    - Operkan `phaseInjection`:
      ```ts
      const phaseFocus = derivePhaseFocus(session);
      const refreshedPrompt = await PersonaPromptBuilder.buildSystemPromptAsync(session, isFollowUp, {
        tenantId,
        incomingText: cleanIncomingText,
        phaseInjection: {
          focus: phaseFocus,
          slim: true,
        },
      });
      ```
    - Dengan `slim: true`, saat customer belum memiliki `cartItems` dan belum ada `booking.preferredDate`, `buildHierarchySlim` **hanya memuat `LocationHierarchy` dan `PricingCatalog`**, sedangkan `SCHEDULING_HIERARCHY_BLOCK` **dibuang 100%**.

### Fase 3: Deterministic Funnel Output Normalizer (*Hard Code-Level Guard*)
* **File:** `src/v3/agent/pipeline/generation-stage.ts`
  - Tambahkan sanitizer deterministik pada hasil `assistantMessage`:
    - Jika `!hasCommittedTreatment`:
      - Deteksi apakah kalimat terakhir LLM melompat menanyakan hari/jadwal (misal pola regex akhir kalimat `/(?:jadwalkan|jadwal|hari apa|kapan mau)/i`).
      - Jika terdeteksi melompat menanyakan hari sebelum ada komitmen aktif, potong pertanyaan jadwal tersebut dan ganti secara deterministik dengan konfirmasi minat yang santun:
        > *"Apakah Bunda berminat untuk kami bantu jadwalkan perawatannya? 🤗"*
      - Hapus juga frasa imperatif desakan panik jika muncul di awal kalimat (seperti `/(?:ayo\s+segera\s+tangani|harus\s+cepat-cepat|jangan\s+tunda)\s*ya\s*bund[a]?/i`).

### Fase 4: Adversarial & Regression Unit Testing
* **File Baru:** `tests/unit/v3-funnel-pacing.test.ts`
  - **Test 1:** Input customer *"usia 6 bulan bund"*, state `EXPLORING` $\to$ Assert balasan **TIDAK BOLEH** menanyakan hari/jadwal atau memuat frasa *"Ayo segera tangani"*.
  - **Test 2:** Input customer *"mau coba paket pijat lahap juara dong"*, state `COMMITTED` $\to$ Assert prompt membuka `SCHEDULING_HIERARCHY_BLOCK` dan mengizinkan pertanyaan hari.
  - **Test 3:** Information Hiding Assertion $\to$ Pastikan string prompt Call 2 saat `EXPLORING` tidak mengandung `SCHEDULING_HIERARCHY_BLOCK`.

---

## Rencana Verifikasi
1. **Automated Tests:**
   ```bash
   npx vitest run tests/unit/v3-funnel-pacing.test.ts
   npm test
   ```
2. **Manual Simulation:**
   ```bash
   npm run chat
   ```
   Uji skenario:
   1. `halo kak` $\to$ Minta lokasi
   2. `bungurasih` $\to$ Ongkir promo
   3. `anak saya capek dan susah makan bund` $\to$ Rekomendasi Pijat Lahap Juara, tanya usia
   4. `usia 6 bulan` $\to$ **Lolos:** Menenangkan, validasi usia, tanya minat. **Bukan** todong jadwal.
