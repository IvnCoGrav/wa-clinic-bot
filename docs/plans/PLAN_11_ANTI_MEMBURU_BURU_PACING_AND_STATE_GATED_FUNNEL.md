# PLAN 11 (Revisi) — Solusi Fondasional Anti-Memburu-Buru Customer (*Funnel Pacing & State-Gated Information Hiding*)

- **Status**: REVISI — menunggu persetujuan eksekusi. Belum ada kode diubah.
- **Tanggal revisi**: 2026-09-22.
- **Dasar**: audit plan asli vs kode aktual (semua nomor baris di bawah dicek terhadap tree `ecaf158f`).
- **Prinsip**: Hard Code-Level Guards lintas lapisan (State Machine, Kontrak Data, RAG/Retrieval, Few-Shot). DILARANG: teks prompt "DILARANG..." baru sebagai solusi utama, regex gatekeeper intent, hafalan if-else pola kalimat, mutilasi tengah kalimat, contoh prompt baru yang menodong jadwal.

---

## 1. Temuan audit plan asli (ringkas)

| Klaim plan asli | Verifikasi |
|---|---|
| `prompt-composer.ts:86-101` selalu sertakan tail jadwal | ✅ Benar (`:86-101`, `:99` tanpa syarat). Preseden pruning sudah ada: `buildScheduleNegConstraintsHead(session)` (`:90`, audit 993955) |
| `generation-stage.ts:666` tak oper `phaseInjection` | ⚠️ Separuh basi — call aktual `:670` memang tanpa `phaseInjection`, TAPI Call 2 sudah phase-aware via `phaseDirective` ter-append (`:676-694`, `deriveConversationPhase`+`buildPhaseDirective`) |
| `scheduling.phase.ts:55` contoh pemicu | ✅ Benar verbatim (`:55-56`) |
| "Multi-layer root cause" 3 lapis | ❌ Tidak lengkap — akar OVERDETERMINED di ~15 salinan lintas 7 file (lihat §2). Plan melewatkan lapis few-shot, lapis guardrail deterministik, dan lapis bank DB |
| Fase 1 cabut seluruh TAIL aturan 20-21 | ❌ REGRESI — menghapus aturan 21 (proteksi shareloc/alamat + anti "Admin CS") untuk customer EXPLORING |
| Fase 1 tambah direktif + contoh baru | ❌ Makeup — menambah contoh yang (sesuai diagnosis plan sendiri) akan disalin LLM; menambah "DILARANG..." sebagai solusi utama |
| Fase 2 `slim:true` buang scheduling block 100% | ⚠️ Belum dianalisis — blok yang dibuang memuat blok 7 (mandat `search_knowledge_faq` medis, `scheduling.phase.ts:17-20`); konflik prompt-caching (`prompt-composer.ts:137-143`); jalur DB prompt (`composeSystemPromptAsync` + `TenantPromptConfigService`) mengabaikan slim (gap SaaS) |
| Fase 3 normalizer regex potong kalimat | ❌ DITOLAK — bertentangan dengan keputusan regresi terdokumentasi (`guardrail-pipeline.ts:758-763`, anti mid-sentence mutilation); false-positive pada template resmi; kalimat pengganti mengandung "jadwalkan" (self-trigger) |
| Fase 4 Test 1 assert tanpa frasa "Ayo segera tangani" | ❌ Overfitting — frasa tidak ada di seluruh `src/` (parametrik LLM, parafase tak terbatas) |

---

## 2. Peta akar masalah yang sebenarnya (7 titik, 1 pola kalimat)

Pola `Rencana mau kami bantu jadwalkan di hari apa ya Bunda? 🤗` hidup di:

1. `scheduling.phase.ts:55` (aturan 20 — instruksi + contoh)
2. `few-shot-exemplars.ts:32,92,102` (balasan ideal asisten — sinyal imitasi terkuat; `symptom_flu_consultation` `:26-35` ≈ skenario laporan)
3. `core-persona.layer.ts:75,87,105` (contoh asisten; catatan: `:89-93` statement-only & `:107-111` interest-closing sudah benar — pola varian sudah ada)
4. `location-rules.phase.ts:23,25,32,36`, `pricing-catalog.phase.ts:48,71,72`, `router-direct-reply.layer.ts:58,67`
5. `guardrail-pipeline.ts:735,738` (template deterministik `CATALOG/DISCUSSED_SERVICE_RECOVERY` — menodong tanpa peduli commitment; `:318` sudah state-aware, preseden benar di `:297-299`)
6. Bank DB `few_shot_exemplars` (runtime merge `few-shot-exemplars.ts:567-576`; isi DB tak terlihat dari kode —NON-GOAL plan ini, lihat §6)
7. Preseden positif: `symptom_followup_no_cta` (`few-shot-exemplars.ts:107-115`), aturan penutup `pricing-catalog.phase.ts:50`, CTA state-aware `:297-299`

Helper reuse (dilarang bikin varian ke-4): `deriveConversationPhase`/`buildPhaseDirective` (`phase-resolver.ts:26,53`), pola cek `phase-resolver.ts:58` & `booking-commit-gate.ts:24`.

---

## FASE 0 — Baseline & Reproduksi (read-only + test)

- **MT-0.1 — Baseline test:** `npm run build`; `npx vitest run tests/unit/v3-anti-todong-jadwal.test.ts tests/unit/v3/get-catalog-closing-intent.test.ts tests/unit/v3/consultation-mode-no-premature-price.test.ts tests/unit/v3/deterministic-guardrails-session-310995.test.ts` — hijau sebelum mulai.
- **MT-0.2 — Reproduksi via simulator** (`npm run chat`): `halo kak` → lokasi → keluhan+usia (`anak saya capek dan susah makan bund` → `usia 6 bulan`) → catat turn yang menodong hari + state sesi turn itu (`cartItems`, `selectedTreatment`, `booking.preferredDate`, `lastCommitment`). Jika todongan tak tereproduksi, STOP dan laporkan.
- **MT-0.3 — Inventarisasi bank DB:** cek isi tabel `few_shot_exemplars` (jumlah row + row yang `ideal_response`-nya mengandung todong-hari). Hasil menentukan debt MT-5.2. Read-only.
- **Regression gate Fase 0:** baseline + bukti reproduksi + inventaris DB tercatat.

---

## FASE 1 — State-Gated Pruning Aturan 20 (tanpa teks baru, tanpa hapus aturan 21)

**Tujuan:** informasi tanya-hari hilang total dari prompt saat belum committed (information hiding); proteksi shareloc tetap.

- **MT-1.1 — Pecah konstanta tail.**
  - **File:** `src/v3/agent/prompt/phases/scheduling.phase.ts` (`:54-56` terverifikasi).
  - **Aksi:** pecah `SCHEDULE_NEG_CONSTRAINTS_TAIL` menjadi `SCHEDULE_NEG_CONSTRAINTS_RULE20` (larang jam + tanya-hari) dan `SCHEDULE_NEG_CONSTRAINTS_RULE21` (shareloc/alamat + anti "Admin CS", isi aturan 21 verbatim tanpa ubah). Jaga export lama sebagai gabungan keduanya (kompatibilitas importir lain — cek importir via grep saat eksekusi).
  - **Acceptance:** `tsc` hijau; seluruh importir lama tetap resolve.
- **MT-1.2 — Pruning state-gated di composer.**
  - **File:** `src/v3/agent/prompt/prompt-composer.ts`, `buildNegativeConstraintsBlock` (`:86-101`).
  - **Aksi:** gunakan helper tunggal baru `isFunnelCommitted(session)` di `phase-resolver.ts` (definisi: `booking.preferredDate/reservationId != null` ATAU `selectedTreatment/cartItems` ATAU `lastCommitment === 'COMMITTED'` ATAU `bookingCommitConfirmed === true` — reuse pola cek `phase-resolver.ts:58` + `booking-commit-gate.ts:24`, JANGAN tulis formula inline ke-4). Bila `!isFunnelCommitted(session)`: ganti kalimat tanya-hari di RULE20 ("Tanyakan HANYA preferensi hari (contoh: ...)") menjadi penegasan status (contoh pola: cabang information-hiding seperti `buildScheduleNegConstraintsHead`, tanpa contoh kalimat baru, tanpa kata "DILARANG" baru — cukup HILANGKAN instruksinya; panduan fase CONSULTATION (`PHASE_FOCUS_LINES`, `:160-161`, "tunda negosiasi hari") yang tersisa sebagai arahan). RULE21 selalu disertakan. Bila committed: render kanonis lama byte-identik.
  - **Acceptance:** prompt Call 2 saat EXPLORING tanpa `selectedTreatment/cartItems/booking` tidak mengandung string contoh todong-hari DI LUAR baris larangan; saat COMMITTED byte-identik dengan sebelum perubahan.
- **Regression gate Fase 1:** `npm run build` + test MT-4.1 (pruning assertions). Rollback: revert commit Fase 1.

---

## FASE 2 — State-Gated Few-Shot (lapis imitasi, bukan lapis instruksi)

**Tujuan:** LLM tak lagi melihat contoh asisten yang menodong saat customer belum committed; tanpa menghapus pengetahuan contoh.

- **MT-2.1 — Tag penutup pada exemplar statis.**
  - **File:** `src/v3/agent/few-shot-exemplars.ts` (tiga `idealResponse` `:32,92,102` terverifikasi) + `src/v3/agent/gold-few-shot-exemplars.ts` (`:86,146` + grep ulang `jadwalkan di hari apa` untuk daftar final saat eksekusi).
  - **Aksi:** tambah tag `closing_schedule_ask` pada setiap exemplar yang `idealResponse`-nya menutup dengan todongan hari. Tag = data (skema `tags` sudah ada, `mapRowToExemplar` `:130-141`), bukan logika baru. JANGAN ubah isi `idealResponse` (varian committed tetap butuh contoh ini).
  - **Acceptance:** daftar id bertag = tepat himpunan exemplar penodong (diverifikasi grep pre/post).
- **MT-2.2 — Skoring sadar-state di seleksi.**
  - **File:** `src/v3/agent/few-shot-exemplars.ts`, `selectRelevantExemplars` (`:581-586`).
  - **Aksi:** tambah param opsional `funnelCommitted?: boolean` (default `undefined` = perilaku lama, aditif). Bila `false`: exemplar bertag `closing_schedule_ask` kena penalti skor (mis. −10) KECUALI intent `ask_schedule` eksplisit (customer yang bertanya jadwal tetap boleh dicontohkan jawaban jadwal — hormati intent aktif). Komentar: penalti, bukan eliminasi (guard fase lampau tetap tersedia).
  - **Acceptance:** input gejala+usia tanpa `ask_schedule`, state uncommitted → exemplar `symptom_flu_consultation` tidak terpilih / kalah dari varian `no_cta`; input `ask_schedule` → exemplar jadwal tetap menang.
- **MT-2.3 — Threading state dari composer.**
  - **File:** `src/v3/agent/prompt/prompt-composer.ts`, call `:375-380`.
  - **Aksi:** teruskan `funnelCommitted: isFunnelCommitted(session)` (session tersedia di `composeSystemPromptAsync`). Jalur DB prompt ikut dapat manfaat karena seleksi exemplar dipakai kedua jalur (`:375` sebelum split DB/statis — verifikasi saat eksekusi).
  - **Acceptance:** prompt dengan bank aktif: turn EXPLORING tak memuat `idealResponse` penodong; turn COMMITTED/ask_schedule tak berubah.
- **MT-2.4 — Bersihkan salinan statis di lapis prompt (satu pola, semua salinan).**
  - **File:** `core-persona.layer.ts:75,87,105`, `location-rules.phase.ts:23,25,32,36`, `pricing-catalog.phase.ts:48,71,72`, `router-direct-reply.layer.ts:58,67` (daftar dari grep; verifikasi ulang konteks tiap baris saat eksekusi — hanya ubah yang merupakan CONTOH/ILUSTRASI, bukan kalimat larangan).
  - **Aksi:** ganti penutup contoh penodong dengan penutup bervarian sesuai preseden yang sudah ada di file yang sama (`core-persona.layer.ts:89-93` statement-only, `:107-111` interest-closing; `pricing-catalog.phase.ts:50`). Prinsip: contoh konsultasi → statement-only atau tanya-minat; contoh penjadwalan/komitmen (mis. `post_delivery_treatment_continuation`, `pricing-catalog.phase.ts:71-72` skenario 2-anak/ibu+bayi yang sudah memilih) BOLEH tetap menutup jadwal — bedakan berdasar skenario contoh, bukan hapus massal.
  - **Acceptance:** grep `jadwalkan di hari apa` di `src/v3/agent/prompt/` hanya tersisa di (a) baris larangan, (b) contoh skenario committed/schedule yang ditandai, (c) aturan 20 kanonis untuk committed.
- **Regression gate Fase 2:** `npm run build` + suite anti-todong eksisting + test MT-4.2. Rollback: revert commit Fase 2.

---

## FASE 3 — Guardrail Recovery State-Aware + Funnel Reprompt (ganti normalizer mutilasi)

**Tujuan:** template yang di-emit KODE tidak menodong saat belum committed; draf LLM yang lolos dikoreksi via tulis-ulang penuh, bukan potong kalimat.

- **MT-3.1 — Template recovery state-aware.**
  - **File:** `src/v3/agent/pipeline/guardrail-pipeline.ts` (`:732-739` terverifikasi; `:316-319` preseden).
  - **Aksi:** cabangkan `CATALOG_RECOVERY` (`:735`) & `DISCUSSED_SERVICE_RECOVERY` (`:738`): bila `isFunnelCommitted(session)` → template lama (tetap); bila tidak → tutup dengan rekomendasi murni + konfirmasi minat (tanpa tanya hari; tanpa memutus info katalog). Ikuti pola komentar CTA state-aware (`:297-299`). Event log recovery tetap ditulis (tambah flag `funnelCommitted`).
  - **Acceptance:** sesi EXPLORING + `get_catalog_and_price` tereksekusi + draf invalid → balasan berisi rekomendasi katalog TANPA tanya hari; sesi committed → template lama persis.
- **MT-3.2 — Funnel reprompt tulis-ulang (reuse pola, bukan mutilasi).**
  - **Lokasi:** `guardrail-pipeline.ts`, pola `attemptFactualReprompt` (`:795-809`).
  - **Aksi:** tambah detektor ringan "draf menanyakan hari padahal `!isFunnelCommitted`" di level TURN (bukan regex intent user — yang dideteksi adalah draf output, dan hasilnya BUKAN potong/ganti string melainkan SATU reprompt tulis-ulang penuh dengan konteks ter-prune (tanpa blok scheduling), memakai `buildIsolatedRepromptMessages` seperti `:803`). Gagal → jatuh ke fallback generik yang sudah ada (`:751-754`), bukan template kaleng baru. Koreksi note berisi fakta state ("customer belum menyetujui treatment; tulis ulang TANPA menanyakan hari/jadwal; tutup dengan konfirmasi minat"), tanpa contoh kalimat.
  - **Acceptance:** draf todong + EXPLORING → tepat 1 reprompt; hasil valid → dipakai; hasil tetap todong → fallback generik (tidak pernah kirim todongan). Turn committed/normal: nol overhead (detektor hanya jalan saat `!committed`).
- **Regression gate Fase 3:** `npm run build` + test MT-4.3 + suite guardrail/sanitizer eksisting. Rollback: revert commit Fase 3.

---

## FASE 4 — Pengujian Adversarial & Multi-Parafrase

**Tujuan:** bukti ketahanan lintas variasi bahasa nyata, bukan 1 kalimat hafalan. Perluas file eksisting (dilarang duplikasi suite).

- **MT-4.1 — Perluas `tests/unit/v3-anti-todong-jadwal.test.ts`** (pola `PersonaPromptBuilder.buildSystemPrompt` + assert baris-sudah-ada, `:9-51`): prompt EXPLORING (session tanpa treatment/cart/booking) tidak memuat contoh todong-hari di luar baris larangan; prompt COMMITTED memuatnya (byte-identik). Assert pada KONDISI STATE, bukan kalimat user.
- **MT-4.2 — Test seleksi exemplar:** matriks state (uncommitted vs committed vs `ask_schedule`) × topik (gejala, usia, harga) → exemplar penodong hanya menang saat committed/ask_schedule. File: perluasan suite exemplar terdekat atau file baru `tests/unit/v3-funnel-exemplar-gating.test.ts` bila tak ada rumah yang cocok (cek saat eksekusi).
- **MT-4.3 — Test recovery + reprompt:** `CATALOG_RECOVERY` saat EXPLORING tanpa tanya-hari; saat COMMITTED template lama; reprompt tepat-1x dan fallback generik bila tetap todong.
- **MT-4.4 — Matriks parafrase end-to-end (wajib):** N cara bilang usia ("usia 6 bulan", "umur adek 6 bln", "baby 6 month", "6 bulan bund", typo "usai 6 bln") × M respons LJ (simulasi draf via prompt yang dirakit Fase 1-2, bukan live LLM) → tidak ada yang lolos todong-hari saat EXPLORING. Parafrase diuji sebagai INPUT (bukan assert kalimat output spesifik).
- **Regression gate Fase 4:** seluruh suite anti-todong/guardrail (`v3-anti-todong-jadwal`, `get-catalog-closing-intent`, `consultation-mode-no-premature-price`, `deterministic-guardrails-310995`, `response-governance`, `symptom-bypass-guard`) + `npm run build`.

---

## FASE 5 — Verifikasi Manual, CHANGELOG & Debt

- **MT-5.1 — Simulasi manual** (`npm run chat`) skenario plan asli: `halo kak` → `bungurasih` → `anak saya capek dan susah makan bund` → `usia 6 bulan` → ekspektasi: menenangkan, validasi usia, rekomendasi, tutup minat — TANPA todong hari. Ulangi varian committed (`mau coba paket pijat lahap juara dong` + hari) → boleh tanya hari.
- **MT-5.2 — Debt bank DB ke `docs/KNOWN_ISSUES.md`:** row `few_shot_exemplars` bertag/berisi todong-hari butuh migrasi data + kurasi admin (di luar plan ini; sertakan hasil inventaris MT-0.3 + skrip deteksi).
- **MT-5.3 — `CHANGELOG.md`:** entry Keep-a-Changelog merangkum Fase 1-4 + debt.
- **MT-5.4 — Gate akhir:** `npm run build` + `npx vitest run tests/unit/v3-anti-todong-jadwal.test.ts tests/unit/v3/get-catalog-closing-intent.test.ts tests/unit/v3/consultation-mode-no-premature-price.test.ts tests/unit/v3/deterministic-guardrails-session-310995.test.ts`.

---

## 3. Non-goals (dilarang dalam eksekusi plan ini)

1. Kalimat "DILARANG..." baru di prompt mana pun sebagai solusi utama (pruning = menghilangkan, bukan menambah).
2. Contoh prompt baru yang menodong/memuat todongan jadwal.
3. Regex potong/ganti kalimat output; if-else hafalan kalimat user; perubahan atomic routing, kontrak `save_reservation`, threshold guardrail lain.
4. Migrasi data bank DB `few_shot_exemplars` (debt MT-5.2); perubahan `slim:true` global (analisis caching + blok 7 belum tuntas — pertimbangkan sebagai plan lanjutan terpisah).
5. Mengklaim funnel "selesai penuh" — yang dijamin: tidak ada todongan dari state belum-committed di 6 titik kode; bank DB + model parametrik tetap butuh monitoring (`check-router-accuracy`, eval LLM-as-judge).

## 4. Estimasi & risiko

| Fase | Sifat | Risiko |
|---|---|---|
| 0 | Verifikasi | Nol (read-only + test) |
| 1 | Pruning prompt state-gated | Sedang (konstanta dipakai multi-importir; diikat test byte-identik committed) |
| 2 | Few-shot tags + skoring | Sedang (skor memengaruhi semua turn; penalti-bukan-eliminasi + default-undefined menjaga kompatibilitas) |
| 3 | Guardrail recovery + reprompt | Sedang (1 reprompt = +latensi hanya saat `!committed` + draf todong; diikat test) |
| 4-5 | Verifikasi | — |

Rollback per fase: revert commit fase terkait (independen; Fase 2→3 hanya berurutan secara bacaan, tidak secara kode).
