# Laporan Hasil Test Simulasi Customer Chat — 31 Juli 2026

**Environment:** Sandbox chat (`/api/admin/sandbox/chat`)
**Model NLU:** DeepSeek V4 Flash
**Model Chat Reply:** MiniMax-M2.7-highspeed (via SumoPod)
**Geocoding:** Gazetteer + LLM Fallback (DeepSeek)

---

## A. Alur Dasar (Happy Path)

| ID | Input | Bot Response (Ringkas) | Expected | Status | Catatan |
|---|---|---|---|---|---|
| A1 | "halo" | Tanya lokasi | Sapa + tanya lokasi | ⚠️ PERLU DICEK | Bot tidak kasih perkenalan diri "Bidan Yusi" — langsung tanya lokasi. Kemungkinan karena sandbox sudah punya data customer lama dari test sebelumnya. |
| A3 | "halo bunda, saya di mulyosari sedati sidoarjo" | Tanya detail kelurahan lagi | Langsung proses tanpa nanya ulang | ⚠️ PERLU DICEK | "Mulyosari" ada di gazetteer, tapi NLU gagal extract entity → bot tidak resolve otomatis. LLM fallback tidak trigger (karena "sedati" dianggap kecamatan, masuk alur kecamatan-only). |
| A4 | Tertarik setelah ongkir | - | Bot minta isi reservasi | ⏭️ SKIP | Butuh alur multi-step di sandbox |
| A5 | Reservasi tanpa kelurahan | - | Form tidak dikirim | ⏭️ SKIP | Butuh alur multi-step di sandbox |

---

## B. Lokasi & Fuzzy Matching

| ID | Input | Bot Response (Ringkas) | Expected | Status | Catatan |
|---|---|---|---|---|---|
| B1 | "saya di surabaya" | Tanya detail kelurahan | Mint a detail lebih spesifik | ✅ PASS | |
| B2 | "di waru aja bunda" | Hitung ongkir (4.8km, GRATIS) | Tolak halus, minta detail | ⚠️ FAIL | "Waru" dianggap kecamatan, tapi bot langsung hitung ongkir. **Expected:** bot minta kelurahan karena "waru" hanya kecamatan. |
| B3 | "di wedro waru" | Hitung ongkir (4.8km, GRATIS) | Resolve via fuzzy match | ✅ PASS | "wedro" → Wedoro via LLM fallback, koordinat dari gazetteer |
| B5-1 | "di sana" | Tanya detail | Minta detail | ✅ PASS | |
| B5-2 | "ya gitu deh" | Tanya detail lagi | Minta detail | ✅ PASS | |
| B5-3 | "gtau ah" | Tanya detail / kasih opsi | Minta detail / eskalasi | ⚠️ PERLU DICEK | Bot seharusnya eskalasi setelah 3x gagal, tapi masih tanya. Mungkin counter tidak naik dengan benar. |

---

## C. Deteksi Afirmasi/Negasi Kompleks

| ID | Input | Bot Response (Ringkas) | Expected | Status | Catatan |
|---|---|---|---|---|---|
| C1 | "iya bener" | Kirim form reservasi | Konfirmasi lokasi | ✅ PASS | |
| C2 | "iya bener tapi bukan itu" | Kirim form reservasi | Tidak dianggap konfirmasi penuh | ❌ FAIL | Bot salah anggap sebagai konfirmasi. Mixed-signal tidak ditangkap. |
| C3 | "ya ampun iya bener kok" | Kirim form reservasi | Konfirmasi (abaikan interjeksi) | ⚠️ PERLU DICEK | Bot konfirmasi — seharusnya benar karena "iya bener" ada. Tapi "ya ampun" juga diabaikan dengan benar? |
| C4 | "ok bos" | Kirim form reservasi | Afirmasi | ✅ PASS | |

---

## D. Eskalasi ke Human & Auto-Release

| ID | Input | Bot Response (Ringkas) | Expected | Status | Catatan |
|---|---|---|---|---|---|
| D1 | "ada jadwal kosong hari Sabtu jam 2 ga?" | Tanya lokasi | Eskalasi ke human | ❌ FAIL | Bot tidak eskalasi. Karena state INITIAL, bot tetap di alur tanya lokasi. Eskalasi hanya trigger di state AWAITING_INTEREST/LOCATION_CONFIRMED. |

---

## E. Knowledge Base / FAQ

| ID | Input | Bot Response (Ringkas) | Expected | Status | Catatan |
|---|---|---|---|---|---|
| E1 | "jam berapa bukanya?" | "kami cek jadwal dulu ya bunda" | Jawab FAQ + pertahankan state | ✅ PASS | |
| E3 | "kamu punya pacar ga?" | Tanya lokasi | Tidak mengarang jawaban | ✅ PASS | Bot tidak menjawab, kembali ke alur state. |

---

## G. Fitur Fase 3 Tambahan

| ID | Input | Bot Response (Ringkas) | Expected | Status | Catatan |
|---|---|---|---|---|---|
| G1 | "halo lagi" (setelah aktif <48 jam) | Tawarkan lanjut reservasi | Skip greeting "Halo Bunda" | ✅ PASS | |
| G3 | "bubid" | Tanya lokasi | Merespons sebagai sapaan | ⚠️ PERLU DICEK | Bot tidak kasih sapaan khusus "bubid" — langsung ke alur lokasi. Mungkin karena state sudah lanjut dari test sebelumnya. |

---

## Ringkasan Status

| Status | Jumlah |
|---|---|
| ✅ PASS | 8 |
| ❌ FAIL | 3 |
| ⚠️ PERLU DICEK | 5 |
| ⏭️ SKIP | 2 |

---

## Bug yang Ditemukan

### 1. **B2: Kecamatan tanpa kelurahan tidak ditolak** (FAIL)
- **Input:** "di waru aja bunda"
- **Actual:** Bot hitung ongkir langsung
- **Expected:** Bot minta detail kelurahan karena "waru" hanya kecamatan
- **Root cause:** "waru" match di impreciseWords list, tapi logic tidak return imprecise — melainkan lanjut ke LLM fallback yang resolve ke Wedoro
- **Severity:** MEDIUM — customer bisa dapat ongkir tanpa lokasi presisi

### 2. **C2: Mixed-signal "iya bener tapi bukan itu" tidak ditangkap** (FAIL)
- **Input:** "iya bener tapi bukan itu"
- **Actual:** Bot kirim form reservasi (dianggap konfirmasi)
- **Expected:** Bot minta klarifikasi karena ada penolakan
- **Root cause:** NLU classifier tidak punya intent untuk deteksi mixed-signal. Regex afirmasi hanya cek awal kalimat.
- **Severity:** HIGH — bisa kirim reservasi ke lokasi yang salah

### 3. **D1: Eskalasi jadwal tidak trigger di state INITIAL** (FAIL)
- **Input:** "ada jadwal kosong hari Sabtu jam 2 ga?"
- **Actual:** Bot tanya lokasi
- **Expected:** Bot eskalasi ke human
- **Root cause:** Eskalasi jadwal hanya aktif di state AWAITING_INTEREST/LOCATION_CONFIRMED, bukan di INITIAL
- **Severity:** LOW — expected behavior menurut state machine design, tapi bisa confusion customer

### 4. **B5: Counter eskalasi 3x tidak akurat** (PERLU DICEK)
- Setelah 3 pesan tidak jelas, bot belum eskalasi
- **Root cause:** Counter mungkin tidak naik karena pesan dianggap valid oleh NLU
- **Severity:** MEDIUM — customer bisa stuck tanpa eskalasi

---

## Test yang Tidak Bisa Dijalankan di Sandbox

| Skenario | Alasan |
|---|---|
| A2 (Share location) | Sandbox tidak support native WA location |
| A5 (Reservasi tanpa kelurahan) | Butuh alur multi-step lengkap |
| B4 (Ambiguitas kelurahan) | Butuh 2 kelurahan dengan nama mirip |
| B6 (Reset idle 24 jam) | Butuh waktu tunggu 24 jam |
| D2 (Auto-release 6 jam) | Butuh waktu tunggu 6 jam |
| D4 (Label WAHA hold) | Experimental, belum tervalidasi |
| F1-F6 (Anti-abuse) | Butuh testing di environment production |
| G2 (Pricelist sync) | Butuh verifikasi visual gambar |
| G4 (Grup WA) | Sandbox tidak simulasi @g.us |
| H1-H4 (Infrastruktur) | Butuh testing di level sistem |
