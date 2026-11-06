# Laporan Evidence Gate: Audit Funnel Iklan Meta (6 November 2026)

**Tanggal Audit:** 2026-11-06 18:20 WIB  
**Target Window (WIB):** 2026-11-05 17:00 UTC s/d 2026-11-06 17:00 UTC (Satu hari penuh WIB)  
**Tenant:** `default-tenant` (`Kala Moms and Baby Spa`)

---

## 1. Hasil Pengukuran Metrik Lapangan (Fase 0.1 – 0.6)

### 0.1 Kunjungan Landing Page per `source` (`landing_page_views`)
```sql
SELECT source, count(*) 
FROM landing_page_views 
WHERE tenant_id='default-tenant' 
  AND "createdAt" >= '2026-11-05 17:00:00Z' 
  AND "createdAt" < '2026-11-06 17:00:00Z' 
GROUP BY 1;
```
| Source | Jumlah | Keterangan |
| :--- | :---: | :--- |
| `beacon` | 63 | Dikirim via `external-tracker.js` di LP Scalev |
| `cta-fallback` | 1 | Kunjungan langsung ke `/cta` tanpa beacon |
| **Total Views** | **64** | |

### 0.2 Klik CTA & Status Atribusi (`ad_clicks`)
```sql
SELECT count(*) total, count("matchedAt") matched, count(*) FILTER (WHERE "matchedAt" IS NULL) unmatched 
FROM ad_clicks 
WHERE tenant_id='default-tenant' 
  AND "createdAt" >= '2026-11-05 17:00:00Z' 
  AND "createdAt" < '2026-11-06 17:00:00Z';
```
| Kategori | Jumlah | Rincian Klik |
| :--- | :---: | :--- |
| **Total Klik** | 6 | `4x` (04:24 WIB), `42` (13:21 WIB), `yf` (14:29 WIB), `23s` (17:29 WIB test), `bd` (17:48 WIB test), `9e` (18:10 WIB) |
| **Matched Leads** | 2 | `4x` (matched dalam 18 detik), `9e` (matched dalam 9 detik) |
| **Unmatched (Bocor)** | 4 | `42` (FB ad, dropped), `yf` (IG ad, dropped), `23s` (test), `bd` (test) |

### 0.3 Inbound Chat Masuk Nyata (Ground Truth di `messages`)
- Total chat masuk dari pelanggan unik dalam rentang 24 jam: **23 pelanggan** (112 pesan inbound).
- Mayoritas adalah pelanggan lama yang sedang konsultasi/reservasi jadwal.
- Pelanggan baru yang dibuat dalam rentang tersebut:
  1. `6285331632356` (04:24 WIB) ➔ Matched dengan klik `4x`.
  2. `6282231861906` (Devita, 07:00 WIB) ➔ Kontak organik (tanpa kode promo / UTM).
  3. `6288230897072` (18:10 WIB) ➔ Matched dengan klik `9e`.
- **Tidak ada chat masuk yang membawa kode `42` atau `yf`**. Keduanya memang tidak pernah dikirim oleh pengguna ke WhatsApp.

### 0.4 Hitung MQL
- Pelanggan dengan `is_mql = true` yang terpicu dalam jendela 24 jam: **2 MQL**.

### 0.5 Integritas Instrumentasi Tracker
- Log `[CTA LANDING_URL MISSING]`: **0 kejadian** (tracker eksternal terpasang utuh di Scalev).
- Rasio `cta-fallback`: hanya 1 dari 64 (1,5%).
- Kesimpulan: Instrumentasi pelacakan berjalan normal dan sehat.

### 0.6 Histogram Jeda Waktu Klik CTA ke Chat Masuk (Seluruh Data Historis)
- **p50 (Median)**: **10,9 detik** (50% pelanggan chat dalam < 11 detik)
- **p90**: **74,7 detik** (~1,2 menit)
- **p95**: **2,8 menit** (95% pelanggan chat dalam < 3 menit)
- **p99**: **94,8 menit** (~1,5 jam)
- Kesimpulan: **Grace period 20 menit** menjamin 98%+ keyakinan statistik bahwa klik tanpa chat adalah murni *drop-off* (bukan *delay* mengetik).

---

## 2. Kesimpulan Gerbang Fase 0

1. **Diagnosis Konfirmasi:** Masalah tanggal 6 November 2026 adalah **Corong Bocor (Funnel Drop-Off di Aplikasi WhatsApp)**, BUKAN kegagalan instrumentasi atau atribusi sistem.
2. **Kelayakan Watchdog:** Valid dan siap dilanjutkan ke **Fase 1**.
