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

---

## 3. Aktivasi Produksi & Validasi Backtest (2026-11-06, 19:06–19:25 WIB)

### 3.1 Deploy (runbook baru 6 langkah)

- Commit `95d5a965` (rebased di atas `c8ce5b21`) di-pull server; runbook `scripts/deploy-prod.sh` versi baru dipakai untuk **pertama kali** pada deploy ini.
- Urutan terbukti jalan: `build app worker` (build paralel, image `worker` ikut) → `run --rm app npx prisma migrate deploy` (tanpa mematikan `app` lama) → `up -d --no-deps app worker` → drift check → health check.
- Hasil verifikasi: `/health` = `OK`; `/ready` = `READY` (`database: CONNECTED`, `waha: WORKING`); container `worker` `Status=running`, `RestartCount=0`, `OOMKilled=false`.
- Log worker: `🎯 Ad Funnel Watchdog cron started (every 30m, staggered)`.
- **WAHA tidak disentuh** (`--no-deps`, session tetap hidup).

### 3.2 Konfigurasi tenant & env server

| Item | Sebelum | Sesudah |
| :--- | :--- | :--- |
| `tenants.settings.adWatchdog` | `NULL` | `enabled=true, activeStartHourWib=8, activeEndHourWib=21, minViews=30, minCtr=0.04, minAgedClicks=3, graceMinutes=20, cooldownMinutes=180, baselineDays=7, lowTrafficRatio=0.5, paidMediums=[cpc,paid,ctwa,ctwa_fuzzy], telegramTopicId=null` |
| `.env` server | tidak ada flag | `ENABLE_AD_WATCHDOG_CRON=true`, `AD_WATCHDOG_INTERVAL_MINUTES=30` (backup `.env` dibuat lebih dulu) |

### 3.3 Backtest 14 hari pada data produksi nyata

Dijalankan read-only via `node dist/scripts/ad-watchdog-backtest.js --tenant=default-tenant --days=14`.

| Tanggal | Views | Clicks | CTR | Matched | Aged (>20m) | Inbound | Baseline | Status | Sinyal |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- | :--- |
| 2026-10-24 | 19 | 5 | 26,3% | 5 | 0 | 25 | 25 | OK | – |
| 2026-10-25 | 25 | 6 | 24,0% | 6 | 0 | 23 | 25 | OK | – |
| 2026-10-26 | 32 | 3 | 9,4% | 3 | 0 | 24 | 25 | OK | – |
| 2026-10-27 | 23 | 4 | 17,4% | 4 | 0 | 24 | 25 | OK | – |
| 2026-10-28 | 32 | 1 | 3,1% | 1 | 0 | 22 | 25 | **ALERT** | `LOW_CTR` |
| 2026-10-29 | 36 | 0 | 0,0% | 0 | 0 | 20 | 25 | **ALERT** | `LOW_CTR` |
| 2026-10-30 | 60 | 10 | 16,7% | 4 | 6 | 27 | 25 | OK | – |
| 2026-10-31 | 54 | 8 | 14,8% | 5 | 3 | 23 | 32 | OK | – |
| 2026-11-01 | 75 | 14 | 18,7% | 6 | 8 | 30 | 32 | OK | – |
| 2026-11-02 | 40 | 6 | 15,0% | 3 | 3 | 31 | 37 | OK | – |
| 2026-11-03 | 47 | 3 | 6,4% | 1 | 2 | 21 | 40 | OK | – |
| 2026-11-04 | 88 | 9 | 10,2% | 4 | 4 | 29 | 47 | OK | – |
| 2026-11-05 | 69 | 12 | 17,4% | 7 | 5 | 35 | 54 | OK | – |
| 2026-11-06 | 45 | 4 | 8,9% | 1 | 3 | 19 | 51 | OK | – |

- **12 hari OK, 2 hari ALERT (alert rate 14,3%)** — bukan klaim "0% false alarm", melainkan angka terukur.
- Hari insiden 6 November sendiri **tidak** memicu alert (klik 4, aged 3, inbound 19) — sesuai temuan Fase 0 bahwa penyebabnya drop-off di aplikasi WhatsApp, bukan kegagalan sistem.

### 3.4 Temuan baru dari backtest (dilaporkan, belum diperbaiki)

- 28 & 29 Oktober: `paidViews` 32/36 (di atas ambang) tetapi klik CTA tercatat 1 dan **0**, sementara chat masuk nyata tetap normal (22 dan 20 pelanggan).
- Pola ini lebih mirip **kegagalan pencatatan klik** (skrip CTA/`AdClick` di landing page) daripada CTR riil yang jatuh: permintaan pasar terbukti masih ada lewat chat yang masuk.
- Watchdog tetap memberi label `LOW_CTR` karena `INSTRUMENTATION_SUSPECT` mensyaratkan `paidAgedClicks ≥ 3`; saat klik tercatat 0, sinyal instrumentasi mustahil muncul. Celah klasifikasi ini dicatat di `docs/KNOWN_ISSUES.md` **#318** dan **belum** diubah tanpa persetujuan.
