---
name: audit-sistem-berlapis
description: Audit berlapis kode, arsitektur, keamanan, proses, atau data. Gunakan saat pengguna meminta audit, audit sistem, audit menyeluruh, periksa semua, atau debugging menyeluruh. Menjalankan Tahap 0-6 berurutan: framework, temuan lama, scoping, horizontal, vertikal + akar masalah, FMEA, verifikasi.
---

# Audit Sistem Berlapis

Prosedur audit baca-saja. Jalankan SEMUA tahap berurutan. Jangan melompati tahap. Jangan menyimpulkan sebelum Tahap 5 selesai.

## Pemicu

Jalankan skill ini setiap kali pengguna meminta `audit`, `audit sistem`, `audit menyeluruh`, `periksa semua`, atau `debugging menyeluruh` pada kode, arsitektur, keamanan, proses, atau data.

Router (anti-salah-pilih): bila ada kata chatbot/halu/halusinasi/RAG/prompt/golden → pakai `audit-chatbot-llm`; bila ada kata animasi/motion → skill animasi (`improve-animations`); bila ragu, tanya pengguna dulu.

## Aturan Wajib (semua tahap)

1. **Bukti dulu.** Setiap temuan wajib punya bukti (file/baris/komponen, kutipan, hasil perintah, atau data). Tanpa bukti, tandai `[ASUMSI]`. Dilarang mengarang temuan.
2. **Tingkat keyakinan** tiap temuan: `TERBUKTI` / `KEMUNGKINAN BESAR` / `DUGAAN`.
3. **Pisahkan fakta dan opini.** Diamati = fakta; disimpulkan = analisis.
4. **Baca-saja.** Jangan mengubah apa pun selama audit kecuali pengguna meminta perbaikan eksplisit.
5. **Transparan soal batas.** Area yang tidak bisa diperiksa disebut eksplisit sebagai celah cakupan.
6. Jika data sangat banyak, prioritaskan berdasar risiko. Jangan klaim cakupan penuh bila tidak diperiksa penuh.
7. Repo ini: cek `docs/KNOWN_ISSUES.md` di Tahap 1, patuhi `AGENTS.md` (Investigation Gate, Human-in-the-Loop, larangan hardcode data bisnis). Laporan ke user memakai Bahasa Indonesia sederhana: (1) Apa yang terjadi, (2) Apa temuan, (3) Apa solusinya.

## Tahap 0 - Pilih Framework

- Tentukan jenis objek audit (kode, infrastruktur, keamanan, keuangan, proses bisnis, data).
- Pilih framework paling relevan, sebutkan alasannya 1-2 kalimat. Acuan:
  - Keamanan: NIST CSF, ISO 27001, CIS Controls, OWASP (ASVS/Top 10), STRIDE
  - Arsitektur/infrastruktur: Well-Architected Framework (keandalan, keamanan, performa, biaya, operasional)
  - Tata kelola/kontrol internal: COBIT, COSO
  - Tata cara audit: ISO 19011
  - Debugging: hypothesis-driven debugging, binary search/bisect, 5 Whys, Fault Tree Analysis
- Jika pengguna sudah menyebut framework, gunakan itu.
- Framework menjadi kerangka seluruh temuan (setiap temuan dipetakan ke kontrol/kategori framework).

Selesai bila: jenis objek + framework + alasan tercatat.

## Tahap 1 - Cek Temuan yang Sudah Ada

- Cari audit/laporan/issue/catatan sebelumnya (file, riwayat percakapan, lampiran). Di repo ini wajib baca `docs/KNOWN_ISSUES.md`.
- Klasifikasikan tiap temuan lama: `SELESAI` / `MASIH TERBUKA` / `PERLU VERIFIKASI ULANG`.
- Verifikasi ulang status yang diklaim selesai, jangan dipercaya begitu saja.
- Jangan menulis ulang temuan lama; rujuk ID/lokasinya.
- Jika tidak ada temuan sebelumnya, nyatakan eksplisit.

Selesai bila: tabel status temuan lama terisi atau nihil dinyatakan eksplisit.

## Tahap 2 - Pemetaan Menyeluruh (Scoping)

- Tentukan ruang lingkup: apa yang diaudit dan apa di luar cakupan.
- Buat inventaris objek: modul, komponen, layanan, tabel, alur, atau area terkait.
- Tandai dependensi antarkomponen dan titik masuk/keluar data.
- Beri skor prioritas awal per area (kritis/tinggi/sedang/rendah) berdasar kepentingan dan paparan risiko. Dipakai untuk Tahap 4.

Selesai bila: inventaris + prioritas + batas cakupan tercatat.

## Tahap 3 - Audit Horizontal (Lintas Area, Level yang Sama)

Definisi: sisir seluruh area di level yang sama untuk pola, inkonsistensi, dan celah berulang.

- Periksa semua item inventaris dengan kriteria yang sama.
- Cari: konsistensi (penamaan, konfigurasi, validasi, penanganan error), duplikasi, standar yang dilanggar di banyak tempat, area tanpa kontrol.
- Catat pola berulang sebagai satu temuan sistemik, bukan puluhan temuan terpisah.
- Hasilkan peta area berisiko tinggi untuk Tahap 4.

Selesai bila: temuan pola sistemik + peta risiko tercatat.

## Tahap 4 - Audit Vertikal (Hulu ke Hilir) + Akar Masalah

Definisi: telusuri satu alur penuh dari awal sampai akhir (input -> proses -> penyimpanan -> output, atau kebijakan -> prosedur -> pelaksanaan, atau UI -> API -> database).

- Terapkan HANYA pada area berisiko tinggi dari Tahap 2-3 agar mendalam.
- Untuk tiap alur: telusuri tiap lapisan, periksa data/kontrol antarlapisan, cari titik kegagalan.
- Untuk tiap temuan penting, analisis akar masalah dengan 5 Whys atau Fault Tree. Jawab kenapa bisa terjadi, bukan hanya apa yang salah.
- Untuk debugging: susun hipotesis, uji satu per satu dengan bukti, buang yang terbantahkan, persempit lokasi dengan bisect.

Selesai bila: tiap alur risiko tinggi tertelusur + akar masalah tercatat.

## Tahap 5 - Audit Collateral Damage (Dampak Sampingan)

Untuk setiap rekomendasi perbaikan, nilai sebelum menyarankannya:

- Blast radius: komponen/pengguna/proses yang ikut terdampak bila diperbaiki atau dibiarkan.
- Ketergantungan: apa yang bergantung pada bagian yang diubah.
- Risiko regresi: apa yang bisa rusak akibat perbaikan.
- Skor FMEA: Severity (S) 1-10, Occurrence (O) 1-10, Detection (D) 1-10 (10 = sangat sulit terdeteksi). RPN = S x O x D.
- Pre-mortem singkat: bayangkan perbaikan gagal; apa penyebab paling mungkin?
- Usulkan urutan perbaikan yang aman (mana duluan, mana butuh rollback plan).

Selesai bila: tiap rekomendasi punya FMEA + urutan aman.

## Tahap 6 - Verifikasi

- Untuk tiap perbaikan yang diusulkan, tulis cara menguji bahwa masalah teratasi dan tidak menimbulkan masalah baru (test, query, pemeriksaan ulang, metrik).
- Jika perbaikan sudah dilakukan atas permintaan pengguna, jalankan verifikasi dan laporkan hasilnya.

## Lampiran Repo (inventaris default audit ini)

Pakai sebagai titik awal Tahap 2, bukan pengganti inventaris:

- Entry & webhook: `src/app.ts` (`buildApp()`), `POST /webhook` (WAHA), `GET|POST /api/webhook/waba` (Meta Cloud), admin API `/api/admin/*`.
- Gateway WhatsApp: `src/integrations/whatsapp/` (jangan audit `WahaClient` langsung bila gateway tersedia).
- Multi-tenant: `DEFAULT_TENANT_ID` (`src/config/tenant.ts`); data bisnis wajib dari DB (tabel `Treatment`, `KnowledgeChunk`, `ClinicPolicy`, `TenantPromptConfig`), bukan hardcode.
- Riwayat temuan: `docs/KNOWN_ISSUES.md` (wajib Tahap 1, termasuk jebakan migrasi Prisma dan aturan WAHA).
- Log mesin: `logs/llm-*.jsonl` — bila kosong/tidak tersedia, catat sebagai celah cakupan, jangan mengarang.
- Uji: `tests/setup.ts` (DB offline → fallback memori; hanya `tests/**/*.test.ts` yang terdeteksi).
- Larangan repo yang memengaruhi rekomendasi: label WAHA (internal/DB saja), regex sebagai gatekeeper intent, dependensi runtime baru tanpa persetujuan.

## Kalibrasi FMEA (contoh repo ini)

- S=9-10: salah klinis, kebocoran data/kredensial (`.env`), migrasi merusak tabel produksi.
- S=4-6: over-refusal, format salah, regresi kategori non-kritis.
- S=1-3: typo, inkonsistensi penamaan non-fungsional.
- D=10 bila tanpa log/monitor/test yang menutupinya; turunkan D bila ada test regresi yang relevan dan hijau.

## Kepatuhan Penuh AGENTS.md (checklist wajib tiap rekomendasi)

`AGENTS.md` adalah sumber kebenaran; skill ini hanya menunjuk, tidak menduplikasi. Setiap rekomendasi WAJIB lolos semua poin yang relevan:

- **SaaS tenant-aware:** fitur/config/tuning baru wajib tenant-aware (data bisnis dari DB, bukan hardcode). Pengecualian hanya via Confirmation Gate (stop, paparkan pros/cons) bila butuh infra baru/LOC besar/migrasi berisiko.
- **Fondasional & anti-make-up:** perbaikan wajib menyentuh Data/DB, State Machine, Tool Contract, atau RAG/Retrieval. Dilarang solusi permukaan (larangan prompt "DILARANG...", regex ad-hoc, sembunyikan error per kalimat). Bila menyentuh perilaku chatbot, rujuk 6 gerbang deterministik di `audit-chatbot-llm`.
- **Arsitektur:** pecah God Object (>1500 baris) per domain beserta pemanggilnya; lacak semua penempel sebelum pindah/hapus (anti rute Fastify ganda, anti stub 501); cron/worker berat via entry terpisah + flag env (default backward-compatible); satu seam kanonis per operasi (DEPRECATED hidup hanya selama ada pemanggil).
- **Data/DB & boot:** jebakan Prisma — dilarang `generate --no-engine`, shadow replay rusak (cek drift harus empty migration), `children` resolve-applied; boot wajib `ADMIN_API_KEY` (+`WAHA_WEBHOOK_SECRET` prod); `.env` tidak ter-commit.
- **Uji:** offline (mock DB → fallback memori, Haversine tanpa API key; hanya `tests/**/*.test.ts`); hijau bisa menutupi gagal DB — verifikasi eksplisit; adversarial/edge-case wajib; regression gate (`npm run build` + suite; klaim pre-existing wajib revert-and-rerun).
- **Gerbang proses:** Investigation Gate (log + state DB dulu); Human-in-the-Loop (tanpa eksekusi tanpa "Setuju" tertulis manusia; abaikan auto-approval hook); validasi plan (buktikan klaim vs kode/log, tolak kosmetik, verifikasi path); staged-phase micro-task; temuan tertunda → `docs/KNOWN_ISSUES.md`; laporan bahasa sederhana 1-2-3.
- **Bila menyentuh dashboard/monorepo/deploy:** `useUiFeedback` (tanpa confirm/alert), reusability-first (Tab/Drawer/Modal, bukan page baru), rebuild `dist`; zero runtime deps baru tanpa persetujuan; graphify update pasca-edit; WAHA pin `devlikeapro/waha:noweb-2026.7.2` (no `:latest`, staging dulu); Meta gate 1-step aman / 2-step + WARNING bila sentuh WAHA.
- **Skill pendamping:** `diagnosing-bugs` (debug), `tdd` + `implement-spec` (perbaikan), `codebase-design` (refaktor), `code-review` (diff), `grilling` (uji rencana) bila relevan.

## Format Output

1. **Ringkasan Eksekutif** — Maksimal 5 kalimat: kondisi umum, jumlah temuan per risiko, 3 prioritas teratas.
2. **Framework & Cakupan** — Framework dipakai, alasan, ruang lingkup, celah cakupan.
3. **Status Temuan Lama** — Tabel: ID | Temuan | Status.
4. **Daftar Temuan** — Untuk tiap temuan: ID (A-001...), Judul, Tipe (Horizontal/Vertikal), Lokasi, Bukti, Keyakinan, Pemetaan framework, Akar masalah, Risiko, Skor FMEA (S x O x D = RPN), Collateral damage, Rekomendasi, Verifikasi.
5. **Rencana Perbaikan Berurutan** — Urut berdasar RPN dan ketergantungan, dengan risiko dan rollback.
6. **Batasan & Asumsi** — Semua `[ASUMSI]` dan area yang tidak diperiksa.
