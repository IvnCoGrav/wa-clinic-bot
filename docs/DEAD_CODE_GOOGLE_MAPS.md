# Dead Code: Google Maps Integration

**Tanggal:** 31 Juli 2026  
**Status:** Pending keputusan untuk cleanup  
**Dokumentasi oleh:** AI Assistant

---

## Ringkasan

Integrasi Google Maps Geocoding API di `src/integrations/google-maps/geocoding.ts` **tidak aktif** karena:
- `GOOGLE_MAPS_API_KEY="mock_google_maps_key"` (bukan API key asli)
- Semua request langsung fallback ke `mockGeocodeText()` (gazetteer lokal)

Geocoding sekarang dilakukan oleh:
1. **Gazetteer fuzzy matching** — Sorensen-Dice similarity
2. **LLM fallback** — DeepSeek V4 Flash via SumoPod (baru ditambah)

---

## Kode yang TIDAK Terpakai

### 1. `src/integrations/google-maps/geocoding.ts`

| Baris | Kode | Keterangan |
|---|---|---|
| 1 | `import { Client, AddressComponent } from '@googlemaps/google-maps-services-js'` | Import library Google Maps |
| 28 | `const googleMapsClient = new Client({})` | Instance client Google Maps |
| 42-50 | `geocodeBreaker` | CircuitBreaker untuk Google Maps geocoding |
| 52-58 | `reverseGeocodeBreaker` | CircuitBreaker untuk Google Maps reverse geocoding |
| 71-126 | Google Maps logic di `geocodeText()` | Geocoding via Google Maps API |
| 143-197 | Google Maps logic di `reverseGeocode()` | Reverse geocoding via Google Maps API |
| 202-211 | `extractComponent()` | Helper ekstrak komponen alamat Google Maps |

### 2. `package.json`

| Dependency | Keterangan |
|---|---|
| `@googlemaps/google-maps-services-js` | Library Google Maps (tidak terpakai) |

### 3. `.env`

| Variable | Value | Keterangan |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | `mock_google_maps_key` | API key dummy |

---

## Kode yang MASIH Terpakai

### 1. Geocoding Aktual

| Metode | File | Status |
|---|---|---|
| Gazetteer fuzzy matching | `geocoding.ts` → `mockGeocodeText()` | ✅ Aktif |
| LLM fallback | `geocoding.ts` → `llmResolveLocation()` | ✅ Aktif (baru) |

### 2. Google Services (bukan Maps)

| Service | File | Status |
|---|---|---|
| Google Contacts | `google-contacts.service.ts` | ⚠️ Nonaktif (Fase 3) |
| Google Calendar | `google-calendar.service.ts` | ⚠️ Belum aktif (Fase 2) |
| Google Maps URL detection | `abuse-detection.service.ts` | ✅ Aktif (string match) |

---

## Pilihan Keputusan

### Opsi 1: Cleanup Total
- Hapus semua kode Google Maps dari `geocoding.ts`
- Hapus dependency `@googlemaps/google-maps-services-js` dari `package.json`
- Hapus `GOOGLE_MAPS_API_KEY` dari `.env.example`
- **Kelebihan:** Kode lebih bersih, tidak ada dead code
- **Kekurangan:** Hilang opsi untuk tambah Google Maps di masa depan

### Opsi 2: Komentari Saja
- Beri komentar `// UNUSED: Google Maps integration` pada kode yang tidak terpakai
- Pertahankan dependency
- **Kelebihan:** Bisa diaktifkan kapan saja
- **Kekurangan:** Kode tetap ribet

### Opsi 3: Pisah ke File Terpisah
- Pindahkan kode Google Maps ke `geocoding-google.ts`
- `geocoding.ts` hanya punya logic gazetteer + LLM
- **Kelebihan:** Modular, mudah diaktifkan/dinonaktifkan
- **Kekurangan:** Perlu refactor import di beberapa file

---

## Test Koordinat: LLM vs Gazetteer

| Model | Rata-rata Error | Status |
|---|---|---|
| gpt-4.1-nano | 6.6km | ❌ Tidak akurat |
| gpt-4.1-mini | 5.4km | ❌ Tidak akurat |
| deepseek-v4-flash | N/A (no output) | ❌ Gagal |
| qwen3.6-flash | 19.7km | ❌ Sangat tidak akurat |
| **Gazetteer** | **±10m** | ✅ Akurat |

**Kesimpulan:** LLM tidak bisa menggantikan gazetteer untuk koordinat. Hybrid approach (LLM untuk understanding + gazetteer untuk koordinat) adalah solusi optimal.

---

## Referensi

- PRD: `PRD.md` Section 4.1 (Fase 1)
- Geocoding: `src/integrations/google-maps/geocoding.ts`
- Gazetteer: `src/config/surabaya_sidoarjo_subdistricts.json`
- LLM Fallback: `geocoding.ts` → `llmResolveLocation()`
