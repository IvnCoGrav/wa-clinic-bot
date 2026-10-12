# Revisi-1: Fixing Plan Kebocoran Balasan AI Worker (Insiden 12 Okt 2026)

> Status: **RENCANA — BELUM DIEKSEKUSI.** Menunggu persetujuan eksplisit user
> (Confirmation Gate). Dilarang menyentuh kode/server sebelum ada kata
> "Setuju / Lanjut / Eksekusi" dari manusia di chat.

## 0. Hasil penyamaan versi & cek lingkungan (12 Okt 2026, WIB)

- **Git lokal → sudah sinkron:** `git pull --ff-only` dari `5fb57bf9` ke
  `59740811` (origin/master). Status bersih, 0 ahead / 0 behind.
  4 commit yang ditarik hanya menyentuh dashboard LiveChat mobile +
  `CHANGELOG.md` + `docs/KNOWN_ISSUES.md` — **tidak menyentuh 5 file backend
  yang dirujuk plan**, sehingga seluruh klaim `file:line` plan asli tetap valid:
  - `src/config/ai-models.config.ts:413` (`?? true`) ✅
  - `src/v3/agent/pipeline/generation-stage.ts:944-949` (Call 2 tanpa `thinking`) ✅
  - `src/services/queue.service.ts:58,187-192` (`bullProcessing` in-memory) ✅
  - `docker-compose.yml:58` (app `false`) vs `:86` (worker `true`) ✅
  - `src/worker.ts:76-90` (tanpa load DB) ✅
- **Live lokal:** tidak ada kontainer app/worker yang berjalan di mesin ini
  (`docker ps -a` hanya menampilkan `clinic-redis` + `clinic-postgres`,
  keduanya `Exited`). Kontainer `wa-clinic-bot-worker-1` yang disebut di plan
  ada di **server**, bukan di sini — cek kesehatan server butuh akses SSH
  yang tidak tersedia dari sesi ini.
- **Drift versioning (ditemukan, belum diperbaiki):** `package.json = 1.16.0`
  tetapi git tag terakhir `v1.4.0` dan tidak ada entri changelog untuk 1.5→1.16.
  Penutup drift ini menjadi **Fase 6** di bawah (tag + changelog + KNOWN_ISSUES),
  dikerjakan bersamaan eksekusi, bukan terpisah.

## 1. Ringkasan audit (adopsi dari audit 12 Okt 2026)

- Akar kebocoran **terbukti di kode**: `worker.ts:16` mengimpor `queueService`
  yang konstruktornya otomatis membuat BullMQ `Worker`; app + worker dua-duanya
  makan `message_queue_shard_*` yang sama, dan kunci `bullProcessing` hanya
  `Set` memori per proses (tidak lintas kontainer).
- Call 1 sudah `thinking: disabled` (`generation-stage.ts:651-660`), Call 2 belum
  (`:944-949`) — klaim boros ±1.022 reasoning token itu konsisten.
- **Sudah ada gerbang atomik kedua di level DB** yang luput dari plan asli:
  `turnRepository.claimForProcessing` (`src/repositories/turn.repository.ts:110`).
  Revisi ini menegaskan pembagian tugas agar Fase 4 tidak duplikat buta.
- Angka kolateral (3 customer, 28 pesan bot, ±26.300 token, CAPI valid,
  0 reservasi fiktif) **plausibel** (guard HUMAN_HANDLING + tool masking memang
  ada di kode) tetapi **belum terverifikasi independen** dari sesi ini
  (log server 12/10 + DB tidak dapat diakses). Bukti query menjadi gerbang
  sebelum Fase 5.

## 2. Perubahan dari plan asli (daftar revisi)

| # | Plan asli | Revisi-1 | Alasan |
|---|-----------|----------|--------|
| R1 | Fase 1.1: cegah pembuatan BullMQ Worker bila `SEPARATE_WORKER=true` | **Hanya skip `Worker` (konsumen), tetap buat `Queue` (produsen)** | Cron follow-up di worker butuh `queue.add()`; `return` mentah melumpuhkan enqueue terjadwal |
| R2 | Fase 4: Redis `SET lock:phone:<phone> NX EX 15`, hapus di `finally` | **TTL 60 dtk, key tenant-aware `lock:{tenant}:{phone}`, release atomik cek-UUID (Lua), fallback in-memory bila Redis offline** | TTL 15 dtk < latensi insiden 24,8 dtk (lock kedaluwarsa di tengah proses → ganda lagi); key tanpa tenant tabrakan lintas tenant; `DEL` buta bisa menghapus lock pemilik lain; jalur offline tetap butuh proteksi |
| R3 | (tidak ada) | **Tegaskan hubungan Fase 4 vs `claimForProcessing`**: Redis lock = cegah proses paralel; DB claim = cegah retry ganda. Keduanya dipertahankan, tidak saling mengganti | Mencegah penghapusan salah satu gerbang saat eksekusi |
| R4 | Fase 2: klaim balasan "tidak pernah kosong" | Tambah test regresi respons GLM tanpa field reasoning | Klaim tanpa test = keyakinan, bukan bukti |
| R5 | (tidak ada) | **Fase 6: tutup drift versi** (tag `v1.16.1` + entri changelog + baris KNOWN_ISSUES) + tanpa dependency baru | Mandat Known Issues + versioning; lock Redis memakai `ioredis` yang sudah ada |

## 3. Fase eksekusi berurutan (micro-task)

### Fase 1 — Isolasi worker & fail-closed (kritis, pertama)

- **1.1** `src/services/queue.service.ts` → di `initBullMQShards()`, bungkus
  **hanya pembuatan `Worker`** dengan gate:
  `if (process.env.SEPARATE_WORKER === 'true') { /* buat Queue saja, skip Worker */ }`.
  Queue produsen tetap dibuat agar cron worker bisa enqueue.
  Kriteria: string `[QUEUE BullMQ - Shard` `Processing message` hanya muncul di
  log kontainer app, tidak di worker.
- **1.2** `src/config/ai-models.config.ts:413`: `?? true` → `?? false`.
  Kriteria: proses tanpa load DB default bot MATI; setelah
  `loadConfigsFromDb` nilai DB berlaku. Pastikan boot app memuat config sebelum
  webhook terima trafik (cek `src/app.ts` saat eksekusi).
- **1.3** `src/worker.ts main()`: tambah `loadPersonaFromDb`,
  `loadServicesFromDb`, `getDeliveryTiersFromDb`,
  `AiModelConfigService.loadConfigsFromDb`, `AiEligibilityConfigService.loadConfigsFromDb`.
  Kriteria: follow-up terjadwal memakai katalog/persona DB, bukan fallback.
- Gerbang regresi: `npm run build` + `npx vitest run tests/unit/queue.test.ts tests/unit/ai-models-tenant.test.ts`.

### Fase 2 — Matikan reasoning Call 2 (kecepatan)

- **2.1** `src/v3/agent/pipeline/generation-stage.ts:944-949`: tiru pola Call 1
  (`:651-660`) — ambil `call2RouterCfg`, hitung `call2SupportsThinking =
  supportsThinkingParam(provider, model)`, tambah
  `...(call2SupportsThinking ? { thinking: { type: 'disabled' } } : {})`.
- Tambah test: payload Call 2 untuk `glm-*` memuat `thinking.disabled`;
  untuk deepseek/openai TIDAK memuat (anti-regresi insiden Wonokusumo 03/10).
  Test balasan bersih tak-kosong saat respons tanpa field reasoning.
- Kriteria: `reasoningTokens` Call 2 = 0/undefined; latensi kembali ~1-2 dtk.
- Gerbang regresi: `npx vitest run tests/unit/v3/call1-provider-payload.test.ts`
  + test baru Call 2.

### Fase 3 — Hentikan cron ganda

- **3.1** `docker-compose.yml` service app: `- SEPARATE_WORKER=${SEPARATE_WORKER:-false}`
  → `- SEPARATE_WORKER=true`. (Aman untuk dev lokal: `npm run dev` tanpa compose
  tetap default `false`/monolith.)
- Kriteria: log boot app memuat `SEPARATE_WORKER=true terdeteksi: melewati
  background crons`; tidak ada duplikat Sheets Sync / Frustration Sweep.

### Fase 4 — Kunci antrean Redis terdistribusi (revisi R2+R3)

- **4.1** `src/services/queue.service.ts`: ganti cek `bullProcessing.has/add`
  dengan kunci Redis `lock:{tenantId}:{phone}` nilai UUID,
  `SET key uuid NX EX 60`. Simpan UUID di variabel lokal job; di `finally`,
  hapus **hanya bila nilai masih milik sendiri** (skrip Lua banding-dan-hapus).
  Bila Redis offline (`!redisEnabled`), pakai `bullProcessing` lama sebagai
  fallback (jangan dihapus). `bullProcessing` tidak dihapus seluruhnya.
- Pertahankan `turnRepository.claimForProcessing` apa adanya (gerbang retry).
- Kriteria: dua pesan satu nomor dalam jeda < 2 dtk diproses sekuensial;
  tidak ada pemrosesan paralel lintas kontainer; tidak ada lock pemilik lain
  yang terhapus.
- Gerbang regresi: `npx vitest run tests/unit/queue.test.ts tests/unit/turn-recovery.test.ts`.

### Fase 5 — Penanganan pasien + verifikasi

- **5.1** CS manusia balas pertanyaan keunggulan klinik customer `6285117415425`
  via livechat (mendesak, di luar kode). Cek `6285645676686` butuh lanjut jadwal.
- **5.2** Gerbang akhir: `npm run build` + tiga suite Fase 1/4 + suite Fase 2.
  Klaim full-suite tanpa failure baru; failure yang diklaim pre-existing wajib
  dibuktikan via revert-and-rerun.

### Fase 6 — Tutup administrasi versi (baru, R5)

- Tambah baris `docs/KNOWN_ISSUES.md` untuk insiden 12/10 (bocor worker +
  latensi GLM) + tanggal perbaikan.
- Buat tag `v1.16.1` + entri `CHANGELOG.md` setelah semua fase hijau.
- Tanpa dependency runtime baru (klarifikasi: Redis lock memakai `ioredis` eksisting).

## 4. Yang TIDAK boleh dilakukan saat eksekusi

- Regex/hafalan kalimat customer; label WAHA (`addLabel`/`removeLabel`);
  `prisma generate --no-engine`; hardcode data bisnis ke TypeScript;
  instruksi "DILARANG..." di prompt sebagai pengganti gerbang kode.
