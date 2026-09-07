# Rencana Implementasi: Eliminasi Phantom Cart Item & CTA Penutup Spesifik Treatment

Dokumen ini menguraikan rencana perbaikan teknis untuk mengatasi 2 masalah yang ditemukan pada sesi simulator (ID: 630992):
1. **Phantom Cart Item**: `Newborn Treatment (Rp 500.000)` otomatis masuk ke keranjang customer pada Turn 1 akibat kata *"Treatment"* pada pesan sapaan bot sendiri tertangkap sebagai token unik fuzzy match katalog.
2. **Closing CTA Mismatch**: Pada pertanyaan durasi *"Untuk pijat bayi biasanya brp menit kak"*, bot menutup dengan pertanyaan terbuka *"Ada treatment lain yang Bunda butuhkan atau mau kami bantu jadwalkan? 🤗"* alih-alih menawarkan penjadwalan spesifik: *"Mau saya bantu jadwalkan untuk treatment Pijat Bayi Ceria Bunda? 🤗"*.

---

## Prinsip Desain & Batasan Arsitektur
- **Zero Migration**: Tidak ada perubahan skema database Prisma.
- **SaaS-Readiness & AI-First**: Perbaikan di level sinkronisasi state keranjang deterministik (0 token) dan penambahan grounding SOP / Few-Shot Exemplars. Dilarang keras menggunakan pemotongan teks semantik berbasis regex.
- **Keamanan Kata Generik**: Kata-kata generik domain klinik (seperti *treatment*, *layanan*, *pijat*) tidak boleh dianggap sebagai token identitas tunggal yang memicu penambahan paket ke keranjang tanpa penyebutan nama paket secara spesifik.

---

## Detail Rencana Perubahan

### 1. Engine State Synchronization (`src/v3/state/goal-tracker.ts`)
- **Kecualikan Asisten dari Fuzzy Match Keranjang**:
  Pesan asisten (`role === 'assistant'`) hanya boleh mencocokkan `exactHits` (nama layanan resmi yang direkomendasikan secara eksplisit oleh Bidan, misal: *"kami sarankan Pijat Bayi Pulih Ceria"*), dan **DILARANG** memicu `fuzzyHits`. Hanya pesan `user` yang boleh memicu `fuzzyHits`.
- **Daftar Token Generik Domain Klinik (`GENERIC_CLINIC_TOKENS`)**:
  Definisikan set kata generik: `['treatment', 'treatments', 'layanan', 'service', 'services', 'homecare', 'perawatan', 'terapi', 'therapy', 'pijat', 'massage', 'paket', 'bunda', 'bayi', 'baby', 'anak', 'moms', 'klinik']`.
  Token dalam daftar ini **DILARANG** menjadi token tunggal unik (`t.length >= 6 && tokenOwnerCount === 1`) dalam `fuzzyMatches`. Layanan seperti `"Newborn Treatment"` hanya boleh dicocokkan jika token spesifiknya (`"newborn"`) hadir.
- **Perbaikan Deteksi Sinyal Beli di `isDurationOnlyQuestion`**:
  Ganti pemeriksaan substring `'rp'` dengan regex kata utuh / nominal (`/\brp\b/i` atau `/\brp\s*\d+/i`) agar singkatan kata tanya `'brp'` pada *"biasanya brp menit"* tidak keliru dianggap sebagai sinyal beli nominal rupiah.

---

### 2. Prompt Persona & Exemplar Bank (`src/v3/agent/persona.ts` & `src/slot-engine/few-shot-exemplars.ts`)
- **Ekstraksi Intent Cepat (`extractFastIntents`)**:
  Tambahkan intent `ask_duration` untuk kata kunci durasi: `['menit', 'durasi', 'berapa lama', 'brp lama', 'brp menit']`.
- **Panduan SOP Kondisi C (Pertanyaan Durasi / Detail Teknis Perawatan Spesifik)**:
  Tambahkan aturan jelas pada `buildSystemPrompt`:
  - Jelaskan durasi perawatan dan manfaat relaksasinya secara hangat dan ringkas.
  - **DILARANG** menanyakan pertanyaan terbuka seperti *"Ada treatment lain yang Bunda butuhkan atau mau kami bantu jadwalkan?"* atau *"Rencana mau ambil perawatan apa?"* karena treatment sudah spesifik ditanyakan.
  - **Closing CTA Mandat**: Tutup dengan menawarkan penjadwalan langsung untuk treatment tersebut:
    `"Mau saya bantu jadwalkan untuk treatment [Nama Treatment] Bunda? 🤗"` (atau *"Mau kami bantu jadwalkan untuk treatment [Nama Treatment] Bunda? 🤗"*).
- **Contoh Chat Few-Shot Statis & Dinamis**:
  - Tambahkan dialog ideal tanya durasi pijat bayi di blok contoh chat `persona.ts`.
  - Tambahkan exemplar kanonik ke `DEFAULT_FEW_SHOT_EXEMPLARS` & `GOLD_FEW_SHOT_EXEMPLARS` di `src/slot-engine/few-shot-exemplars.ts`.

---

### 3. Unit Tests (`tests/unit/`)
- Tambahkan unit test regresi di `tests/unit/v3-multi-recipient-cart.test.ts`:
  1. Memastikan sapaan awal bot yang mengandung kata *"Treatment moms & Baby"* **TIDAK** memasukkan `"Newborn Treatment"` ke keranjang.
  2. Memastikan pesan user yang hanya menanyakan durasi *"Untuk pijat bayi biasanya brp menit kak"* tidak terdistorsi oleh singkatan `'brp'`.
  3. Memastikan saat layanan `Pijat Bayi Ceria` dipilih, cart hanya berisi 1 layanan Rp 60.000 tanpa item phantom.

---

### 4. Database Sandbox Cleanup (Staging & Live)
- Bersihkan atribut `preferences.cartItems` pada sandbox customer `6289999630992` di database agar kembali bersih `[]` sebelum pengujian simulator berikutnya.

---

## Rencana Verifikasi

### Automated Tests
1. Jalankan unit test spesifik:
   ```powershell
   npx vitest run tests/unit/v3-multi-recipient-cart.test.ts tests/unit/v3-cart-summarizer-state.test.ts tests/unit/v3-persona-rules.test.ts
   ```
2. Jalankan typecheck & build:
   ```powershell
   npm run build
   ```

### Manual Verification via Simulator
1. Masuk ke Chat Simulator di Admin Dashboard.
2. Kirim pesan pengujian:
   - Turn 0: *"Hallo Bu Bidan, Saya mau booking home service. Bagaimana Caranya ?"*
   - Turn 1: *"ngingas kak"*
   - Turn 2: *"Untuk pijat bayi biasanya brp menit kak"*
3. Verifikasi:
   - Inspektor RAG/Cart hanya memuat **1 item**: `[Si Kecil] Pijat Bayi Ceria (Rileksasi) - Rp 60.000` (TIDAK ADA Newborn Treatment).
   - Jawaban bot diakhiri dengan CTA: *"Mau saya bantu jadwalkan untuk treatment Pijat Bayi Ceria Bunda? 🤗"*.
