# FASE 1: GOLDEN REGRESSION CORPUS & TEST HARNESS (50 KASUS EMPIRIS)

## 1. Tujuan & Filosofi
Membuat pagar pengaman mutlak (*safety net*) berupa **50 skenario percakapan riil terbobot** sebelum satu baris pun kode prompt atau regex disentuh. Test suite ini dijalankan 100% offline via Vitest (`npm test`) dan menjadi syarat mutlak (*hard gate*) sebelum commit/deploy.

---

## 2. Bobot Skenario (Berdasarkan Audit Baseline 1.258 Pesan Riil)
Proporsi 50 kasus didistribusikan secara presisi mengikuti trafik WhatsApp klinik aktual:

| No | Kategori Skenario | Kuota | Deskripsi & Fokus Pengujian |
|---|---|:---:|---|
| **1** | **Konsultasi Klinis & Treatment** | **13 Kasus** | Bayi batuk pilek grok-grok, newborn <28 hari, bayi kolik & kembung, pasca vaksin BCG/DPT, terapi laktasi & nifas. *(Wajib: empati, rekomendasi katalog akurat, dilarang silent drop, dilarang todong kelurahan di awal).* |
| **2** | **Afirmasi & Konversasi Singkat** | **13 Kasus** | Balasan pendek (*"Oke bund"*, *"Boleh onty bid"*, *"Iya kak"*, *"Siapp"*, *"Makasih ya"*, emoji). *(Wajib: bot tidak amnesia, tidak mengulang pertanyaan kelurahan, melanjutkan dialog secara natural).* |
| **3** | **Jadwal, Waktu & Form Booking** | **12 Kasus** | Negosiasi hari (*"bsk apa tdk bs d carikan waktu"*), jam (pagi/siang/sore), slot weekend, pengisian form parsial, pengisian form lengkap. *(Wajib: slot booking tercatat tanpa duplikasi).* |
| **4** | **Lokasi, Geocoding & Alamat** | **9 Kasus** | Wilayah ambigu (*Rungkut*, *Waru*, *Sedati*), patokan gang/masjid (*"lurus mentok belok lagi"*), shareloc GPS, ganti lokasi (*"gak jadi di Wonokromo, di Berbek aja"*), out of coverage (>30km). |
| **5** | **Harga, Durasi & Komparasi Layanan** | **3 Kasus** | Tanya pricelist, beda pijat ceria vs pulih ceria, durasi menit pijat. *(Wajib: transparansi harga sesuai katalog, dilarang halusinasi diskon).* |

---

## 3. Komponen Teknis yang Dibangun

### A. File Dataset Skenario
- **Path:** `tests/golden-corpus/corpus-data.ts`
- **Isi:** Array 50 skenario terstruktur dengan input multi-turn, state awal, dan assertion kriteria.
```typescript
export interface GoldenScenario {
  id: string; // misal: 'CLINICAL-01', 'ACK-04', 'LOC-02'
  category: 'CLINICAL' | 'ACK' | 'BOOKING' | 'LOCATION' | 'PRICING';
  description: string;
  turns: Array<{
    customerInput: string;
    expectedIntents?: string[];
    mustContain?: string[];
    mustNotContain?: string[];
    stateAssertions?: (slate: CustomerSlate) => void;
  }>;
}
```

### B. Test Runner Engine (Offline & Fast)
- **Path:** `tests/golden-corpus/golden-corpus.test.ts`
- **Mekanisme:**
  - Menggunakan mock offline (`WAHA_MOCK=true`, in-memory fallback stores, Haversine fallback).
  - Memanggil `slot-engine.ts` secara multi-turn.
  - Memverifikasi output balasan dan mutasi `CustomerSlate`.

### C. Assertion Otomatis Anti-Regresi
Setiap skenario wajib lolos 5 assertion ketat:
1. **No Silent Drop**: Tidak boleh ada state `HUMAN_HANDLING` dengan `shouldSendReply: false` pada kasus keluhan kolik/kembung/anak sakit biasa.
2. **No Unjustified RSQR**: Tidak boleh ada pertanyaan kelurahan jika pelanggan tidak mengubah lokasi dan lokasi sudah valid.
3. **No Regex Mutilation**: Balasan tidak boleh berawalan kata sambung gantung (seperti *"untuk hari Sabtu..."* atau typo token *"SiapBund,"*).
4. **Slate Entity Retention**: Lokasi dan keluhan yang disebut di Turn-1 wajib tetap tersimpan di `slate` pada Turn-3.
5. **No Broken Formatting**: Panjang balasan >15 karakter, markdown WhatsApp rapi (bintang tebal tertutup sempurna).

---

## 4. Checklist Pengerjaan Fase 1
- [ ] Buat direktori `tests/golden-corpus/`.
- [ ] Tulis 50 skenario riil di `tests/golden-corpus/corpus-data.ts` berdasarkan data 1.258 pesan live server.
- [ ] Tulis test harness di `tests/golden-corpus/golden-corpus.test.ts`.
- [ ] Jalankan `npx vitest run tests/golden-corpus/golden-corpus.test.ts`.
- [ ] Catat baseline pass rate saat ini (misal: 28/50 lolos) sebagai tolok ukur sebelum refactoring Fase 3.
- [ ] Tambahkan perintah ke script package.json: `"test:golden": "vitest run tests/golden-corpus"`.

---

## 5. Kriteria Sukses (Definition of Done)
- 50 skenario terdefinisi lengkap dengan data riil (bukan dummy abstrak).
- Test runner dapat dieksekusi dalam <15 detik secara offline.
- Baseline kegagalan awal tercatat rapi di `docs/BASELINE_GOLDEN_RESULTS.md`.
