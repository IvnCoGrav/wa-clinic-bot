# Implementation Plan — Auto-Resolve Koordinat Prioritas (Tanpa Refresh Manual)

> Kasus pemicu: Bunda Agatha (live, `b30ff1e6-…`) — shareloc customer 25 Sep 13:39 UTC
> mengendap ±12 jam, baru masuk DB setelah admin tekan `Refresh & Hitung Ulang`
> 26 Sep 01:34 UTC. Tujuan: **sinyal GPS baru otomatis me-resolve DB dengan
> prioritas yang sama dengan tombol refresh** (`Bidan → Customer → DB → Geocoding`),
> tanpa mengorbankan invarian sticky-GPS.

## 0. Bukti root cause (terverifikasi ke kode + data live, bukan klaim)

| # | Fakta | Bukti |
|---|-------|-------|
| RC-1 | Auto-path teks menolak menimpa lokasi yang sudah ada | `human-background-enrichment.service.ts:371-373` (`already_has_location`), `:429-432` (`gps_pin_guard`), `:298` (form skip bila `share_location_sent`) |
| RC-2 | Guard presisi di lapisan tulis | `customer.service.ts:204-240` (`preserveExactGps`: `share_location_sent && !isNativePin` → pertahankan koordinat lama) |
| RC-3 | Kegagalan auto tidak terlihat (silent) | `machine.ts:52-62` (`enrichAsync` fire-and-forget + `catch {}`); `enrichSync:460-464` (`catch` → `warn` saja, tanpa retry/flag) |
| RC-4 | Teks estimasi admin ditulis sebagai fakta jarak | `human-background-enrichment.service.ts:176-189` menyimpan `parsed.distanceKm` (hasil parse "jarak nya 6,6km") ke `distanceKm` resmi tanpa hitung ulang dari koordinat. Data live Agatha: admin 13:44 tulis 6,6 km → DB |
| RC-5 | Jalur staff menimpa `location_source` GPS jadi `manual_staff` | `staff-reservation.service.ts:1352-1354` (`location_source: 'manual_staff'` setiap staff simpan koordinat). Data live Agatha: kolom = `manual_staff` padahal `preferences.location_source = customer_shareloc` |
| RC-6 | Tiga angka jarak untuk satu koordinat (6,4 / 6,6 / 6,86 km) | Tiga penulis jarak berbeda: parse teks reservasi, parse teks admin (RC-4), `deliveryService.calculateDelivery` (ORS buffer 1.10x vs Haversine 1.60x, `delivery.service.ts:36-54`); jalur staff pakai rumus sendiri `toFixed(1)` (`staff-reservation.service.ts:242-274`) vs refresh `toFixed(2)` |
| RC-7 | Prioritas tier hanya hidup di tombol manual | Tier `bidan_shareloc > customer_shareloc > db_coords > geocoding` hanya ada di `customer.service.ts:1757-1789` (`refreshCustomerLocationAndOngkir`), dipicu `LiveChatMonitor.tsx:2555-2601`. Tidak ada pemicu event-driven |

Hipotesis peringkat untuk pesan 13:39 yang lolos (belum dikunci — Fase 0 menguncinya):
H1 `enrichAsync` gagal senyap (reverseGeocode/calculate throw) · H2 pesan diproses build live lama (pre-bypass) ·
H3 stale-guard drop sebelum bypass GPS ada. Ketiganya diforensik di Fase 0 dari log live.

## 1. Prinsip solusi (fondasional, bukan make-up)

1. **State-machine & kontrak data, bukan prompt.** Nol perubahan teks system prompt,
   nol regex hafalan kalimat. Prioritas tier dipindah dari fungsi manual ke
   **satu fungsi deterministik** yang dipakai tombol manual DAN webhook.
2. **Sinyal GPS ≠ teks alamat.** Guard sticky (`already_has_location`, `gps_pin_guard`,
   `preserveExactGps`) tetap berlaku penuh untuk **teks/centroid**, tetapi sinyal
   **GPS baru** (native pin, `url_coords` presisi) selalu me-resolve ulang —
   karena GPS baru adalah fakta lapangan, bukan tebakan.
3. **Satu penulis jarak.** Semua jalur tulis jarak wajib lewat
   `deliveryService.calculateDelivery` (tenant-aware, tier dari DB).
4. **Observability dulu.** Setiap ingest lokasi menulis log terstruktur
   `LOCATION_INGEST` (hasil + alasan). Kegagalan tidak boleh senyap lagi.
5. Tanpa dependency runtime baru. Tanpa sentuh label WAHA. Tanpa kolom DB baru
   (flag estimasi di `preferences` JSON — menghindari migrasi destruktif).

## 2. Seam uji yang disepakati (TDD red-green per slice)

* `tests/unit/customer-location-refresh.test.ts` — kontrak tier refresh (ada, diperluas)
* `tests/unit/human-background-enrichment.test.ts` — ingest GPS vs teks (ada, diperluas)
* `tests/unit/sticky-gps.test.ts` — invarian sticky TIDAK boleh pecah (guard regresi)
* `tests/unit/location-ingest.test.ts` — **baru**, untuk fungsi deterministik baru
  (satu-satunya file test baru yang diizinkan)

## 3. Fase eksekusi

### FASE 0 — Kunci bukti + regresi merah (read-only live, tanpa ubah perilaku)

**Tujuan:** kunci H1/H2/H3; tulis failing test sebelum sentuh kode.

* Mikro 0.1 — Forensik live read-only via SSH (tidak menulis apa pun):
  ```bash
  ssh klinik-server "cd /opt/wa-clinic-bot && docker compose logs app --since 2026-09-25T13:30:00Z --until 2026-09-25T14:00:00Z 2>&1 | grep -i -E 'HUMAN ENRICH|STALE|GPS|6285728800224' | head -40"
  ssh klinik-server "ls -la /opt/wa-clinic-bot/logs/ | head; grep -l Agatha /opt/wa-clinic-bot/logs/llm-2026-09-2*.jsonl 2>/dev/null"
  ```
  Kriteria: dapatkan baris log yang membuktikan pesan 13:39 masuk jalur mana
  (GRACE/HOLD/machine + `enrichSync` reason atau `IGNORED_STALE_MESSAGE`).
* Mikro 0.2 — Tulis failing test di `tests/unit/location-ingest.test.ts`:
  skenario "GPS pin baru saat DB sudah punya lokasi + `share_location_sent=true`
  → koordinat TER-update" (saat ini merah: kena `already_has_location`).
  Kriteria: `npx vitest run tests/unit/location-ingest.test.ts` → 1 fail sesuai prediksi.
* Mikro 0.3 — Catat temuan RC-5 ke `docs/KNOWN_ISSUES.md` (entri baru, format ikuti
  entri 134). Kriteria: entri memuat id customer tersamar + nilai kolom vs preferences.

**Regression gate Fase 0:** `npm test` hijau penuh SEBELUM lanjut (baseline),
  kecuali 1 fail yang disengaja di Mikro 0.2.

### FASE 1 — Kontrak sumber lokasi tunggal (blast radius kecil, DB sebagai otoritas)

**Tujuan:** hilangkan divergensi kolom vs preferences (RC-5). File:
`src/services/staff-reservation.service.ts:1345-1357`,
`src/services/customer.service.ts:229-240`.

* Mikro 1.1 (TDD) — Test: "staff konfirmasi koordinat identik (selisih ≤1 km,
  `shouldUpdatePrimaryCoords=true`) → `location_source` kolom TIDAK turun ke
  `manual_staff` bila sebelumnya `gps_pin`; tetap `gps_pin` + tulis
  `preferences.location_source='field_staff_gps_confirm'". Letakkan di
  `tests/unit/staff-location-photo-guard.test.ts` (perluas, bukan file baru).
  Kriteria: merah dulu, hijau setelah 1.2.
* Mikro 1.2 — Ganti blok `staff-reservation.service.ts:1352-1354`:
  ```ts
  // SEBELUM:
  ...(shouldUpdatePrimaryCoords && lat != null && lng != null
    ? { location_source: 'manual_staff' as const }
    : {}),
  // SESUDAH:
  ...(shouldUpdatePrimaryCoords && lat != null && lng != null
    ? {
        location_source: (customer as any).location_source === 'gps_pin'
          ? ('gps_pin' as const) // GPS presisi dikonfirmasi lapangan: naikkan keyakinan, jangan turunkan
          : ('manual_staff' as const),
      }
    : {}),
  ```
  plus tulis `preferences.location_source = 'field_staff_gps_confirm'` +
  `location_source_label` di `updatedPrefs` (`:1327-1343`) agar riwayat jujur.
  Kriteria: test 1.1 hijau; `sticky-gps.test.ts` tetap hijau.
* Mikro 1.3 — Backfill satu arah untuk data yang sudah divergen (kering dulu):
  SQL read-only untuk sensus, lalu UPDATE hanya baris yang memenuhi syarat ketat
  (`preferences.location_source IN ('bidan_shareloc','customer_shareloc')`
  AND kolom = `manual_staff` AND `share_location_sent=true`):
  ```bash
  ssh klinik-server "cd /opt/wa-clinic-bot && docker compose exec -T postgres psql -U postgres -d wa_clinic_db -c \"SELECT count(*) FROM customers WHERE share_location_sent=true AND location_source='manual_staff' AND preferences->>'location_source' IN ('bidan_shareloc','customer_shareloc');\""
  ```
  Kriteria: sensus tercatat di plan eksekusi; UPDATE dijalankan hanya setelah
  angka disetujui user (1-step verification, operasi data live).

**Regression gate Fase 1:** `npm run build` + `npm test` hijau penuh
  (termasuk `sticky-gps`, `staff-location-photo-guard`, `customer-location-refresh`).

### FASE 2 — Inti: ingest GPS event-driven berprioritas (jawab keluhan utama)

**Tujuan:** sinyal GPS baru otomatis resolve DB dengan tier yang SAMA dengan
tombol refresh; tombol manual menjadi fallback, bukan jalur utama. File:
`src/services/location-ingest.service.ts` (**baru, satu-satunya file source baru**),
`src/services/human-background-enrichment.service.ts:201-267`,
`src/services/customer.service.ts:1757-1789` (refactor pakai fungsi bersama),
`src/routes/webhook.route.ts:1187-1200,1260-1273`, `src/state-machine/machine.ts:52-62`.

* Mikro 2.1 (TDD) — Definisikan kontrak murni di `location-ingest.service.ts`:
  ```ts
  export type GpsTier = 'bidan_shareloc' | 'customer_shareloc';
  export interface GpsIngestInput { lat: number; lng: number; tier: GpsTier; detail: string; resolverResult?: unknown; }
  export function pickGpsTier(a: GpsIngestInput | null, b: GpsIngestInput | null): GpsIngestInput | null;
  // Aturan: bidan_shareloc menang atas customer_shareloc; dalam tier sama, yang terbaru menang.
  // Murni (tanpa I/O) → unit-testable, dipakai refresh + webhook.
  ```
  Test di `tests/unit/location-ingest.test.ts`: 6 kasus (tier menang, terbaru menang
  dalam tier, null-safety, koordinat 0,0 ditolak, NaN ditolak).
  Kriteria: merah → hijau tanpa menyentuh file lain.
* Mikro 2.2 — Tambah `ingestGpsPin(customerId, input, tenantId)` di service yang sama:
  satu-satunya penulis DB untuk sinyal GPS — memanggil
  `deliveryService.calculateDelivery` + `reverseGeocode` (atau `resolverResult`)
  + `customerService.updateCustomerLocation({…isNativePin: true})` +
  `markShareLocationSent`, lalu tulis log terstruktur:
  `console.log(JSON.stringify({evt:'LOCATION_INGEST', tier, lat, lng, distanceKm, ongkir, ok}))`.
  Kegagalan: log `{ok:false, reason}` + **rethrow** (tidak ditelan) agar caller
  bisa retry; caller webhook yang memutuskan menelan atau tidak.
  Kriteria: test integrasi service (mock delivery/geocoding seperti pola
  `customer-location-refresh.test.ts:101-153`) hijau.
* Mikro 2.3 — Refactor `refreshCustomerLocationAndOngkir` (`customer.service.ts:1757-1764`)
  agar Tier1/Tier2 dipilih via `pickGpsTier` (perilaku identik, kode bersama).
  Kriteria: `customer-location-refresh.test.ts` hijau tanpa ubah ekspektasi.
* Mikro 2.4 — Webhook: panggil `ingestGpsPin` di ketiga titik GPS yang sudah ada
  (`webhook.route.ts:1189-1191` GRACE, `:1262-1264` HOLD_DISABLED, dan jalur normal
  `:1372`): bungkus retry 1x + log `LOCATION_INGEST`. Di `machine.ts:56`, GANTI
  `enrichAsync` fire-and-forget untuk pesan `type==='location'` menjadi
  `await ingestGpsPin` (teks tetap `enrichAsync` — guard sticky teks utuh).
  Kriteria: simulasi Agatha (pesan `[LOCATION: Lat -7.3564…, Lng 112.7898…]`
  saat DB punya lokasi lama + `share_location_sent=true`) → DB ter-update +
  log `LOCATION_INGEST ok:true`; pesan teks alamat dalam kondisi sama →
  tetap ditolak (`already_has_location`, test sticky hijau).
* Mikro 2.5 — Maps URL: `resolveLocationFromUrl` yang mengembalikan
  `source==='url_coords'` diperlakukan sebagai GPS pin (masuk `ingestGpsPin`
  tier `customer_shareloc`); `url_text_geocoded` tetap jalur teks (guard berlaku).
  Kriteria: invarian `sticky-gps.test.ts` ("shareloc/link Maps → VERIFIED_GPS")
  hijau; teks-hasil-geocode tidak mengunci GPS.

**Regression gate Fase 2:** full `npm test` hijau; `npm run chat` simulasi manual:
kirim shareloc kedua berbeda → jarak/ongkir berubah tanpa refresh;
kirim teks alamat → tidak berubah (sticky). DILARANG lanjut ke Fase 3 bila
satu pun test sticky merah.

### FASE 3 — Estimasi admin ≠ fakta (RC-4, tanpa migrasi DB)

**Tujuan:** angka "6,6km" dari mulut admin tidak lagi menjadi `distance_km` resmi.
File: `human-background-enrichment.service.ts:88-199`.

* Mikro 3.1 (TDD) — Test: "outbound admin mengandung jarak tapi customer belum
  punya koordinat presisi → `distance_km` resmi TIDAK ditimpa; angka disimpan di
  `preferences.distance_estimate = {km, ongkir, by, at}` + log".
  Kriteria: merah dulu.
* Mikro 3.2 — Implementasi: di `enrichFromAdminOutbound`, pisahkan
  `parsed.distanceKm/ongkir` → tulis ke `preferences.distance_estimate`
  (bukan argumen `distanceKm/ongkir` `updateCustomerLocation`) kecuali DB sudah
  punya `lat/lng` presisi (`share_location_sent=true`), dalam hal itu hitung
  ulang via `calculateDelivery` dari koordinat dan abaikan angka parse.
  Kriteria: test 3.1 hijau; tidak ada perubahan skema Prisma.

**Regression gate Fase 3:** `npm test` hijau; verifikasi Agatha-like: admin tulis
"jaraknya 6,6km" → `distance_km` resmi utuh, estimasi tercatat di preferences.

### FASE 4 — Satu penulis jarak (RC-6)

**Tujuan:** koordinat sama → jarak sama di semua jalur.
File: `staff-reservation.service.ts:242-274`, `staff-notification.service.ts:169`.

* Mikro 4.1 — Ganti rumus lokal (`haversine * 1.6`, `toFixed(1)`) di kedua file
  dengan `deliveryService.calculateDelivery` (sudah tenant-aware + tier DB).
  Kriteria: `delivery.test.ts` + suite terkait hijau; selisih hanya toleransi
  pembulatan 0,01 km.
* Mikro 4.2 — Dokumentasikan hierarki angka di `docs/KNOWN_ISSUES.md` (sumber
  resmi = `calculateDelivery`; angka chat admin = estimasi).

**Regression gate Fase 4:** full suite hijau + `npm run build` (tsc) lolos.

### FASE 5 — Verifikasi live aman (tanpa ganggu WAHA)

1. Deploy ikut runbook `docs/LIVE_SERVER_DEPLOY.md` (build app → migrate
   (tidak ada migrasi baru) → `up -d --no-deps app`), verifikasi `/health`.
2. Uji pada kontak sandbox internal (BUKAN customer asli — gate Meta):
   kirim shareloc → cek `LOCATION_INGEST ok:true` di log + DB ter-update
   tanpa refresh; kirim teks alamat → DB tidak berubah.
3. Cek Agatha read-only: `location_history` bertambah hanya bila ada sinyal
   GPS baru; tidak ada tulis paksa.
4. Rollback: `git checkout <commit-sebelumnya>` + rebuild app saja
   (runbook §Rollback); tidak ada migrasi untuk di-rollback.

## 4. Non-scope (sengaja tidak dikerjakan)

* Mengubah teks prompt/aturan emas apa pun. * Regex baru untuk kalimat user.
* Kolom DB baru / migrasi destruktif (flag estimasi di `preferences` JSON).
* Mengubah rumus tier ongkir / `delivery_tiers`. * Menyentuh label WAHA.

## 5. Confirmation gate sebelum eksekusi

* (a) Setujui seam uji §2 (boleh tambah/kurangi sebelum TDD dimulai).
* (b) Backfill Mikro 1.3 butuh persetujuan angka sensus + 1-step verification
  (operasi tulis data live).
* (c) Uji live Fase 5 memakai kontak sandbox — bila harus memakai customer asli,
  naik ke 2-step verification (gate Meta, pixel real).
