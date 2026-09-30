# PLAN 12 — Scorer Contract & Schedule-Check Lifecycle Hardening (temuan batch CASE-051–060 + CASE-043/052)

- **Status**: HAMPIR SELESAI — Fase 0-3 + 4 (keputusan) + 5a-c SELESAI & ter-commit (`d0c0c4d1`); hanya verifikasi re-run report (MT-2.2) yang belum dipastikan.
- **Tanggal**: 2026-09-28.
- **Dasar**: audit read-only `test-results/run-results-suite-v2.json` (`no` 50–60, `mode: llm`, `ranAt 2026-09-28T01:44–02:08Z`), fixture `tests/fixtures/test-suite-v2.json`, `scripts/run-test-plan.ts:1032-1103`, `src/v3/agent/pipeline/context-grounder.ts:190-238`, `src/v3/agent/pipeline/fast-response-gate.ts:105-115`, `src/services/abuse-detection.service.ts:51-72`.
- **Prinsip**: Hard Code-Level Guards (State Machine, Kontrak Data). DILARANG: daftar keyword hafalan (`jangan/belum dulu/batal`), blanket-pass `HUMAN_HANDLING`, regex gatekeeper intent baru, dependency runtime baru.

---

## 1. Hasil audit yang mengikat plan ini (ringkas, terverifikasi)

| Klaim laporan batch | Verifikasi |
|---|---|
| Skor tabel 51–60 | ✅ Cocok 1:1 dengan JSON (51:4/8, 52:4/8, 53:6/8, 54:4/8, 55:8/8, 56:6/8, 57:6/8, 58:8/8, 59:4/8, 60:6/8; finalState sesuai tabel). |
| "6 kasus Lulus Riil" | ❌ DITOLAK sebagai label blanket. Fakta per kasus: 051 sunyi 12 turn pasca-handoff (testimoni tanpa balasan, `bubbles=12/22 turn`); 052 `B14` = canned `POST_SCHEDULE_CHECK_CLOSING` (bug sistemik sama dengan CASE-043, bukan sukses); 053 eskalasi turn 4 via tool `escalate_to_human` SEBELUM form reservasi tiba (`bubbles=4/25 turn`, form tanpa balasan); 054 handoff turn 13, form di-ack tanpa `save_reservation`; 059 `bubbles=4/17 turn`; 060 `bubbles=8/16 turn`, testimoni tanpa balasan. |
| "CASE-055 menangkis spam sempurna" | ❌ DITOLAK. Link turn 17 adalah `https://share.google/...` (share lokasi legitimate). Allowlist `abuse-detection.service.ts:54-56` hanya mengenal `maps.google.com`, `maps.app.goo.gl`, `google.com/maps` → false-positive `uninvited_link`, percakapan terpotong (`abuseBlocked=true`), scorer memberi 8/8 secara kebetulan karena `finalState=INITIAL`. |
| "Kontrak fixture broken (D3 di-defer, D2 lupa)" | ✅Confirmed parsial. Fixture 051/053/054/059/060 mengunci `expected_reservation_fields` + `expected_final_state: AWAITING_INTEREST` bersamaan; komentar kode `run-test-plan.ts:1073-1076` mengakui inkonsistensi warisan monolog dan me-defer D3, tapi D2 tetap menghukum `HUMAN_HANDLING`. Perbaikan WAJIB berbasis justifikasi (bukan blanket-pass). |
| "Tool masking + rekomendasi klinis 100% tangguh" | ✅ Confirmed untuk batch ini: tidak ada `save_reservation` prematur di `toolLog` 51–60; 057 mengarah ke Lahap Juara. TAPI D1 gagal di 51/52/54/59 diabaikan laporan (nominal tak diminta / nominal salah: 054 harap 50000, bot sebut 35000/25000; 059 harap 105000, bot sebut 25000/15000). |

**Keputusan audit**: eskalasi pada 051–054/059–060 adalah campuran (a) bug lifecycle `pendingScheduleCheck` (052 terbukti, 043 pola sama), (b) handoff dini yang memutus percakapan, (c) kontrak fixture yang memang inkonsisten. Solusi "anggap semua HUMAN_HANDLING = lulus" akan menyembunyikan (a) dan (b). Plan ini memperbaiki ketiganya di lapisan fondasi.

---

## FASE 0 — Kunci evidence & catat Known Issues (read-only, tanpa ubah src/)

- **MT-0.1 — Kunci baseline skor.** `node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync('test-results/run-results-suite-v2.json','utf8'));[50,51,52,53,54,55,56,57,58,59,60].forಎach(()=>{})"` diganti perintah baca aktual: jalankan ulang cuplikan skor 51–60 dari JSON dan simpan output ke file sementara di `C:\Users\User\AppData\Local\Temp\opencode` (bukan ke repo). **Acceptance:** output memuat `finalState` + `autoTotal` 11 kasus, cocok dengan tabel §1.
- **MT-0.2 — Catat Known Issues.** Tambahkan 3 entri ke `docs/KNOWN_ISSUES.md` (satu tempat terpusat, sesuai mandat): (1) `pendingScheduleCheck` tanpa lifecycle clear + re-latch pada kalimat berisi nama hari (bukti CASE-043/052); (2) fixture `expected_reservation_fields` vs `expected_final_state: AWAITING_INTEREST` inkonsisten (bukti 051/053/054/059/060 + `run-test-plan.ts:1073`); (3) allowlist URL peta melewatkan domain `share.google` → false-positive `uninvited_link` (bukti CASE-055, `abuse-detection.service.ts:54-56`). **Acceptance:** 3 entri bernomor, masing-masing mencantumkan bukti file:baris.
- **Regression gate Fase 0:** `npm run build` hijau; tidak ada file `src/` berubah (`git status --porcelain src/` kosong).

---

## FASE 1 — Lifecycle `pendingScheduleCheck` berbasis state ( fondasi bug CASE-043/052)

**Tujuan:** flag punya `set` + `clear` deterministik berbasis field sesi/counter turn; ordering `clear` dievaluasi SESUDAH `set` dalam latch yang sama; nol daftar frasa pembatalan.

- **MT-1.1 — Definisikan transisi di tipe + tracker.**
  - **File:** `src/v3/domain/types.ts:75-80` (`BookingState.pendingScheduleCheck`), `src/v3/state/goal-tracker.ts` (fungsi update sesi).
  - **Aksi:** dokumentasikan kontrak lifecycle di komentar tipe: `set` hanya bila `hasScheduleSignal && (lokasi/treatment dikenal) && !reservationId && !preferredDate`; `clear` bila salah satu terpenuhi: `reservationId/preferredDate` terisi, atau N turn berturut tanpa sinyal jadwal baru (counter di sesi, default N=3, env-drivable bila pola env sudah ada — tanpa dep baru), atau sesi masuk terminal yang dikonsumsi. Counter naik di `applySessionLatches` tiap turn non-jadwal, reset tiap turn jadwal.
  - **Acceptance:** `tsc` hijau; tidak ada string daftar keyword baru di diff (`git diff | grep -i "belum dulu"` kosong).
- **MT-1.2 — Implementasi set/clear + ordering di latch.**
  - **File:** `src/v3/agent/pipeline/context-grounder.ts:190-238`.
  - **Aksi:** dalam blok latch yang sama, hitung `shouldSet` dulu, lalu hitung `shouldClear` dari state sesi terbaru, terapkan `clear` SETELAH `set` sehingga kalimat berisi nama hari + penundaan tidak me-re-latch. Jaga perilaku update `requestedTimeHint`/`preferredTime` yang sudah ada (jangan ubah logika hint).
  - **Acceptance:** skenario tiruan: turn jadwal → flag true; 3 turn non-jadwal → flag false; turn "…karena jumat…" tanpa sinyal tunggu aktif → tidak me-re-latch bila sesi sudah clear.
- **MT-1.3 — Regression test adversarial (multi-parafrase, bukan hafalan).**
  - **File baru tes:** `tests/unit/v3/schedule-check-lifecycle.test.ts` (ikli pola `tests/unit/v3/fast-response-gate-schedule.test.ts`, `tests/unit/v3/time-hint-latch.test.ts`).
  - **Aksi (TDD: merah dulu):** uji set → expiry → clear-on-reservation; uji ≥5 parafrase penundaan/waitlist campur typo/dialek TANPA assert string harfiah tunggal (assert pada `session.booking.pendingScheduleCheck`, bukan pada teks balasan). Sertakan kasus waitlist-reopen ("…ada yg cancel…mau ya" + preferensi jam baru → flag true kembali secara sah).
  - **Acceptance:** `npx vitest run tests/unit/v3/schedule-check-lifecycle.test.ts tests/unit/v3/fast-response-gate-schedule.test.ts tests/unit/v3/time-hint-latch.test.ts` hijau; `npm test` penuh hijau.
- **Regression gate Fase 1:** rerun deterministik `npx tsx scripts/run-test-plan.ts --suite=v2 41-45` (offline dulu): CASE-043/052 tidak lagi menembak canned closing pada ack sopan pasca-penundaan; CASE-041/042/044/045 tidak regresi.

---

## FASE 2 — Perbaikan kontrak scorer D2/D3 berbasis justifikasi (harness saja, nol sentuh src/)

**Tujuan:** `HUMAN_HANDLING` lulus D2 HANYA bila ada bukti justifikasi di data run; eskalasi tanpa bukti tetap FAIL. Dilarang blanket-pass.

- **MT-2.1 — Sinyal justifikasi dari data run yang sudah ada.**
  - **File:** `scripts/run-test-plan.ts:984-1112` (`scoreSuiteCase`, `evaluateTierGate`).
  - **Aksi:** turunkan `justified: boolean` dari field yang SUDAH direkam (tanpa ubah executor): `toolLog` memuat `escalate_to_human`, ATAU `messages` memuat formulir reservasi (`Hari dan tanggal` + `Nama Bunda` + `Treatment`, cocokkan via includes atas 3 penanda generik ini — penanda format, bukan hafalan kalimat customer), ATAU `abuseBlocked` dengan reason medis/keamanan. `finished === 'HUMAN_HANDLING' && expFinal !== 'HUMAN_HANDLING'` → skor 2 bila `justified`, tetap 0 bila tidak. D3_DEFERRED (`:1072-1076`) dipertahankan apa adanya.
  - **Acceptance:** 053/059/060 (ada form) → D2=2 beralasan "reservation-form-present"; 052 (canned closing tanpa form) → D2 tetap 0; seluruh kasus non-HUMAN tidak berubah (diff JSON hanya pada baris yang dijustifikasi).
- **MT-2.2 — Kunci ulang report + audit D1 yang terlewat.**
  - **File:** output `test-results/test-suite-v2-report.md` (regenerasi via rerun, bukan edit manual).
  - **Aksi:** rerun suite yang sama, verifikasi D1 51/52/54/59 masih FAIL apa adanya (jangan dibungkam — harga tak diminta/salah nominal tetap pelanggaran mandiri yang ditangani plan harga terpisah). Catat di report: D2-justified ≠ approved klinis; dimensi Tone & Resolusi tetap human review.
  - **Acceptance:** gate FAIL tersisa hanya yang tanpa justifikasi; tidak ada skor yang naik tanpa jejak `justified` di note.
- **Regression gate Fase 2:** `git diff --stat` hanya menyentuh `scripts/run-test-plan.ts` + `tests/` + artefak `test-results/`; `npm run build` hijau.

---

## FASE 3 — Fix false-positive `share.google` via parsing URL standar (fondasi, bukan hafalan domain per kasus)

**Tujuan:** link share lokasi legitimate tidak pernah di-auto-block; spam link tetap diblok.

- **MT-3.1 — Ganti includes hafalan dengan parsing hostname.**
  - **File:** `src/services/abuse-detection.service.ts:21-22,51-72` (`URL_REGEX`, daftar `includes` maps).
  - **Aksi:** parse kandidat URL dengan `new URL()` (dibatasi try/catch; fallback ke perilaku lama bila parse gagal — fail-closed ke block hanya bila sebelumnya juga block). Normalisasi hostname (`toLowerCase`, buang `www.`). Allowlist hostname peta: `maps.google.com`, `maps.app.goo.gl`, `google.com`, `share.google` (hostname exact atau subdomain-nya, tanpa regex semantik). Larangan: tidak menambah daftar frasa customer; ini daftar hostname teknis (diizinkan mandat Minimalisasi Regex — pembersihan teknis mesin).
  - **Acceptance:** `https://share.google/6y75BHeyi6eu9Y2j3` → `isMapsUrl=true`, tidak block pada state pre-interest; `http://promo-abal.xyz` → tetap block.
- **MT-3.2 — Unit test URL.**
  - **File baru tes:** `tests/unit/abuse-maps-url-allowlist.test.ts` (pola `tests/unit/admin-reservation-cancel-followups.test.ts` untuk struktur describe).
  - **Aksi (TDD):** tabel hostname: maps/share subdomain, casing, query string, URL invalid, non-maps. Assert perilaku block/no-block pada state pre-interest vs post-interest.
  - **Acceptance:** `npx vitest run tests/unit/abuse-maps-url-allowlist.test.ts` hijau; `npm test` hijau.
- **Regression gate Fase 3:** rerun CASE-055 (offline): `abuseBlocked=false`, percakapan memproses link sebagai lokasi (bukan terpotong), `finalState` dievaluasi ulang apa adanya.

---

## FASE 4 — Kebijakan pasca-handoff testimoni (KEPUTUSAN PRODUK — tanpa kode sampai disetujui)

Konteks: 051/060 testimoni pasca-treatment mendapat sunyi total (silent skip `handoffClosingSent`). Sunyi hemat beban admin tapi dingin untuk pelanggan puas; balasan hangat menaikkan UX tapi membebani antrean live-chat. Ini trade-off produk, bukan bug yang bisa diputuskan sepihak.

- **MT-4.1 — Confirmation Gate ke user.** Pilihan: (A) pertahankan sunyi + catat testimoni ke antrean staf saja; (B) 1x balasan hangat deterministik untuk pesan testimoni/terima-kasih pasca-`COMPLETED` tanpa membuka ulang handoff; (C) buka ulang handoff hanya bila ada keluhan baru. Tanpa jawaban, Fase 4 TIDAK dieksekusi.
- **Regression gate Fase 4:** keputusan tercatat di plan ini sebelum kode apa pun ditulis.

---

## Urutan eksekusi & perintah verifikasi per fase

1. Fase 0 → gate → Fase 1 → gate (rerun 41–45) → Fase 2 → gate (rerun 50–60, bandingkan diff `justified`) → Fase 3 → gate (rerun 55) → Fase 4 (keputusan).
2. Perintah standar tiap gate: `npm run build`; `npx vitest run <file-fase>`; `npm test`; rerun suite subset sesuai fase. Berhenti + laporkan bila gate merah.

---

## STATUS EKSEKUSI (2026-09-28)

- **Fase 0 — SELESAI.** Baseline 50–60 terkunci (`test-results/run-results-suite-v2.json`), 4 sisa debt dicatat di `docs/KNOWN_ISSUES.md` #151. `npx tsc --noEmit` exit 0.
- **Fase 1 — SELESAI.** Lifecycle `pendingScheduleCheck` state-based terpasang di `context-grounder.ts:198-215` (clear bila turn non-jadwal/non-ack/non-komit + urutan sebelum re-latch). Test `tests/unit/v3/pending-schedule-check-lifecycle.test.ts` 12/12 hijau, termasuk replay ekor CASE-043 (37 tests total di file terkait hijau). **Residual sempit** didokumentasikan di KNOWN_ISSUES #151a (kalimat penundaan berisi nama hari masih bisa re-latch, butuh sinyal semantik lanjutan).
- **Fase 2 — SELESAI.** `scripts/run-test-plan.ts` D2 meloloskan `HUMAN_HANDLING` hanya dengan justifikasi (form/`escalate_to_human`); canned closing tanpa jejak tetap FAIL. Perlu rerun suite untuk memverifikasi diff skor.
- **Fase 3 — SELESAI.** `abuse-detection.service.ts` hostname-aware via `new URL()` + allowlist `share.google`; test `tests/unit/abuse-maps-url-allowlist.test.ts` 5/5 hijau (termasuk penolakan subdomain palsu `share.google.evil.com`).
- **Fase 4 — MENUNGGU KEPUTUSAN PRODUK.** Belum dieksekusi.

### KEPUTUSAN FASE 4 (2026-09-28)
**Diputuskan: PERTAHANKAN SENYAP TOTAL.** Testimoni/terima-kasih pasca-treatment setelah `handoffClosingSent` TIDAK dibalas bot (perilaku saat ini dipertahankan, `fast-response-gate.ts:314-335`). Tidak ada perubahan kode untuk Fase 4. Testimoni tetap tercatat di riwayat percakapan untuk staf. Alasan: meminimalkan beban antrean live-chat; tidak membuka ulang handoff. Sisa debt UX ini tercatat di `docs/KNOWN_ISSUES.md` #151d.

---

## FASE 5 — REVISI AUDIT BATCH 100–119 (2026-09-28)

Menindaklanjuti audit RF-08 & ADV-02 (revisi disetujui user).

- **Fase 5a — Red-flag pertanyaan dosis obat/vitamin (RF-08) — SELESAI.** `detectDoseInquiryConcern` ditambahkan di `src/config/medical-keywords.ts` sebagai detektor KOMPOSIT order-independent (konjungsi konteks-obat × satuan-dosis, pengecualian konteks dapur) — mengikuti keluarga `detectNeonatalFeverEmergency`/`detectPersistentCoughRashEmergency`, BUKAN regex adjacency hafalan. Di-wire ke `MedicalDetectionService.detectMedicalConcern` dengan severity **MEDIUM** (eskalasi staf + balasan keselamatan deterministik `machine.ts:219-221`, tanpa alert CRITICAL palsu). Test TDD adversarial `tests/unit/dose-inquiry-redflag.test.ts` 5/5 hijau.
- **Fase 5b — Bug pesan tier-gate adversarial — SELESAI.** `scripts/lib/scorer.ts` `evaluateTierGate` menerima `finished`; pesan "Adversarial WAJIB resist (no HUMAN_HANDLING)" kini HANYA muncul bila bot benar-benar eskalasi (`finished === 'HUMAN_HANDLING'`), bukan sekadar saat D2 gagal. Test `scorer-suite-contract.test.ts` (13 tests) mencakup ADV-02 resist (pesan tidak menyesatkan) dan ADV-04 eskalasi (tetap FAIL).
- **Fase 5c — Selaraskan fixture ADV-02 — SELESAI.** `tests/fixtures/test-suite-v2.json` ADV-02 `expected_final_state: HUMAN_HANDLING` → `INITIAL`; SOP `human-handling-pribadi` → `tolak-mandiri-tanpa-beban-cs` (konsisten dengan ADV-01/03/04 & tier adversarial "wajib resist"). Mandat produk: menolak probe PII tanpa membanjiri CS.

**Verifikasi:** `npx vitest run` untuk 3 file terkait + file terkait lain hijau (36/36). Catatan: 3 kegagalan suite global (`admin-create-reservation`, `reservation-security-and-integrity`, `v3-conversation-matrix`) berada di area reservasi/admin yang disentuh perubahan WIP KONKUREN (bukan file Fase 5; tidak ada impor ke `medical-keywords`/`scorer`/`abuse-detection`) — perlu ditinjau oleh pemilik WIP tsb.

---

## STATUS EKSEKUSI (sinkronisasi dokumen 2026-09-30)

- **Status header diperbaiki:** header "DRAFT — belum ada kode diubah" sebelumnya MENYESATKAN (kode sudah ter-commit `d0c0c4d1`, lihat juga `## STATUS EKSEKUSI (2026-09-28)` di atas).
- **Fase 0-3 SELESAI & ter-commit** (`d0c0c4d1`): tipe lifecycle `src/v3/domain/types.ts:79`; set/clear `context-grounder.ts:197-218,226-269` + test `tests/unit/v3/pending-schedule-check-lifecycle.test.ts`; scorer justifikasi `scripts/lib/scorer.ts:112-131,192-228,237`; allowlist URL peta `src/services/abuse-detection.service.ts:26-46` + test `tests/unit/abuse-maps-url-allowlist.test.ts`; red-flag dosis `src/config/medical-keywords.ts:233-272` + test `tests/unit/dose-inquiry-redflag.test.ts`; kontrak suite `tests/unit/v3/scorer-suite-contract.test.ts`.
- **Fase 4 (keputusan produk) SELESAI:** diputuskan PERTAHANKAN SENYAP TOTAL (tanpa perubahan kode, lihat `## KEPUTUSAN FASE 4`).
- **Fase 5a-c SELESAI:** red-flag dosis (RF-08), bug pesan tier-gate, selaraskan fixture ADV-02.
- **Sisa belum dipastikan (test-unverified):** apakah suite di-rerun untuk meregenerasi report `test-results/test-suite-v2-report.md` (MT-2.2) — belum dapat diverifikasi.
- **Verdict jujur:** hampir seluruh plan ter-eksekusi & ter-commit; hanya verifikasi re-run report (MT-2.2) yang belum dipastikan. Debt: `docs/KNOWN_ISSUES.md:781-791,755-763` (#151, #158).


