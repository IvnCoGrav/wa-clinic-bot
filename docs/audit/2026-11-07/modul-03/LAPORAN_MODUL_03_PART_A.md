# Laporan Audit Deep-Dive — Modul 3 Bagian A: Conversational AI Engine V3

> **Tanggal audit:** 2026-11-07  
> **Mode:** AUDIT BACA-SAJA — tidak ada kode/test/config/.env yang diubah; tidak ada server, DB, WAHA, atau Meta yang disentuh. Satu-satunya file yang dibuat adalah laporan ini.  
> **Auditor:** Subagent audit (OpenCode)  
> **Commit/working tree:** `8c6ee2ea` (2026-11-06 21:10:56 +0700) + working tree yang memuat `docs/audit/2026-11-07/`  
> **Cakupan:** `src/v3/agent/**`, `src/v3/tools/**`, `src/v3/state/**`, `src/v3/guardrails/**`, `src/config/ai-models.config.ts`, `src/integrations/llm/**`, serta bagian `src/state-machine/machine.ts` yang mengonsumsi output V3.  
> **Di luar cakupan:** Modul 4 (Reservasi) dan Modul 6 (Live Chat) tidak diaudit ulang; RAG/retrieval dan isi teks prompt tidak didalami (Bagian B); dashboard admin, DB produksi, dan log produksi tidak diakses.

---

## 1. Ringkasan Eksekutif

Pipeline V3 sudah memiliki fondasi dua tahap (Call 1 Router vs Call 2 Generator), `parallel_tool_calls: false`, masking tool berbasis state, dan pemisahan cart dari pesan asisten; tetapi audit ini menemukan **13 temuan**: **3 KRITIS, 4 TINGGI, 5 SEDANG, 1 RENDAH**. Tiga risiko terbesar adalah **A-003 (RPN 324)** — skrining pasca-vaksinasi mengembalikan `SAFE` bila ada sinyal aman walau sinyal bahaya juga ada, **A-002 (RPN 315)** — gerbang komitmen dapat menyala dari kata umum seperti “booking/ambil/pesan” atau dari argumen tool yang dihasilkan LLM, dan **A-005 (RPN 280)** — reservasi yang masih menunggu verifikasi staf diturunkan menjadi state `COMPLETED`. Klaim “PASS” pada laporan Fase 03 2026-11-02 hanya akurat untuk `parallel_tool_calls: false` dan registri tool; klaim masking, guardrail, dan state management perlu dikoreksi menjadi **PARSIAL** karena temuan di laporan ini. Tidak ada perubahan kode yang dilakukan; seluruh rekomendasi diarahkan ke perbaikan fondasional (state machine, tool contract, normalizer output, isolasi tenant), bukan tambahan kalimat “DILARANG...” di prompt.

---

## 2. Framework & Cakupan

### 2.1 Framework yang dipakai

| Framework | Alasan | Dipakai untuk |
|---|---|---|
| **AWS Well-Architected** (Reliability, Security, Performance, Operational Excellence) | Modul ini adalah jalur produksi yang menentukan booking, harga, dan keselamatan klinis; kegagalan berdampak langsung ke pasien dan pendapatan | Klasifikasi temuan, desain rekomendasi, FMEA |
| **OWASP Top 10 for LLM Applications** | Permukaan input bebas (WhatsApp), tool/agency, prompt, dan output ke customer | LLM01 Prompt Injection, LLM06 Excessive Agency, LLM09 Misinformation |
| **Hypothesis-driven debugging + 5 Whys** | Klaim laporan lama dan komentar kode tidak boleh dipercaya tanpa verifikasi | Membuktikan akar masalah, bukan gejala |
| **FMEA (S × O × D = RPN)** | Prioritisasi risiko klinis, finansial, dan operasional | Urutan perbaikan dan rollback |

### 2.2 Tahapan audit

- **Tahap 0:** framework dipilih (tabel 2.1).
- **Tahap 1:** `docs/KNOWN_ISSUES.md` dibaca pada bagian relevan; laporan `2026-11-02/fase-03`, `2026-11-02/LAPORAN_VERIFIKASI_ULANG.md`, dan `2026-11-06/LAPORAN_AUDIT_RESERVASI.md` dibaca sebagai rujukan. Temuan berstatus SELESAI tidak diduplikasi; klaim yang menyangkut modul ini diverifikasi ulang (§3).
- **Tahap 2:** inventaris file dan titik masuk (§2.3), prioritas awal (§2.4), dan batas cakupan (§2.5).
- **Tahap 3:** audit horizontal — pola yang sama dicari lintas `agent-runner`, `generation-stage`, `tool-pipeline`, `tool-masker`, `guardrail-pipeline`, `medical-signal-detector`, `phase-resolver`, dan `ai-models.config` (mis. “gate dari teks asisten”, “state dari output LLM”, “normalizer tidak final”).
- **Tahap 4:** audit vertikal — alur `pesan masuk → prepareSession → triage → masking → Call 1 → tool execution → Call 2 → guardrail → state → outbound`; ditambah alur `konfigurasi model → endpoint → fallback → audit biaya`.
- **Tahap 5:** FMEA per temuan, collateral damage, pre-mortem, dan urutan perbaikan.
- **Tahap 6:** verifikasi dirancang per temuan; **belum dieksekusi** karena mode baca-saja.

### 2.3 Inventaris & prioritas awal

| Area | Titik masuk/keluar | Prioritas |
|---|---|---|
| Orkestrasi V3 | `src/v3/agent/agent-runner.ts` | **Kritis** |
| Call 1 / Call 2 | `src/v3/agent/pipeline/generation-stage.ts` | **Kritis** |
| Eksekusi tool | `src/v3/agent/pipeline/tool-pipeline.ts` | **Kritis** |
| Masking tool | `src/v3/tools/tool-masker.ts`, `src/config/feature-flags.ts` | **Kritis** |
| Kontrak tool | `src/v3/tools/tool-schemas.ts`, `save-reservation.tool.ts`, `get-catalog.tool.ts`, `calculate-delivery.tool.ts` | **Kritis** |
| Triage klinis | `src/v3/agent/pipeline/medical-signal-detector.ts`, `src/config/medical-keywords.ts` | **Kritis** |
| State & cart | `src/v3/state/goal-tracker.ts`, `cart-manager.ts` | Tinggi |
| Guardrail output | `src/v3/guardrails/*`, `guardrail-pipeline.ts` | Tinggi |
| State machine | `src/state-machine/machine.ts`, `phase-resolver.ts` | Tinggi |
| LLM plumbing | `src/integrations/llm/*`, `src/config/ai-models.config.ts` | Tinggi |
| Tenant context | `src/config/brand.ts`, `tool-masker.ts`, `guardrail-pipeline.ts` | Sedang |

### 2.4 Celah cakupan (dinyatakan eksplisit)

1. **Tidak ada akses DB produksi.** Semua kesimpulan adalah analisis kode; jumlah kejadian nyata (mis. berapa booking dari “cara booking”) tidak diukur.
2. **Tidak ada akses log produksi** (`logs/llm-*.jsonl`, `logs/app-*.log`, `docker logs`). Klaim frekuensi DSML, fallback, dan reprompt hanya mengacu pada komentar/insiden yang tercatat di kode dan `docs/KNOWN_ISSUES.md`, bukan pengukuran baru.
3. **Tidak ada eksekusi test/build.** Status hijau/merah tidak diklaim; verifikasi di §6 adalah rencana, bukan hasil.
4. **Tidak ada panggilan LLM nyata**, sehingga perilaku model (kecenderungan mengisi `commitment`, DSML, mematuhi prompt) tidak diuji langsung.
5. **Tidak menganalisis isi prompt/RAG secara mendalam** — itu Bagian B. Temuan yang menyentuh prompt hanya pada aspek kontrak/kode yang dapat dibuktikan.
6. **Tidak menganalisis semantik gambar**; apakah foto pasien menunjukkan kondisi darurat tidak dapat dinilai dari teks `[IMAGE]`.
7. **Tidak mengaudit ulang Modul 4/6**; referensi ke reservasi/live chat hanya untuk dampak silang.
8. **`docs/KNOWN_ISSUES.md` sangat besar** (892 KB, 348 heading); yang dibaca adalah heading dan bagian yang relevan dengan Modul 3, bukan seluruh isi.

---

## 3. Status Temuan Lama

### 3.1 `docs/KNOWN_ISSUES.md`

| ID | Temuan | Status setelah verifikasi audit ini |
|---|---|---|
| **#235** | Kerapuhan struktural chatbot V3 (R1–R5) | **MASIH TERBUKA.** C1–C4 menutup sebagian gejala, tetapi akar “terlalu banyak pengadil”, “state multi-penulis”, dan “aturan bisnis sebagai daftar kata” masih terlihat pada A-001, A-002, A-004, A-008, A-009. Tidak diduplikasi; laporan ini memberi instance baru yang terbukti. |
| **#233** | Prompt raksasa & latensi produksi | **MASIH TERBUKA.** Tidak diaudit teksnya; A-008/A-010/A-011 menambah risiko operasional/observability. |
| **#227** | Tool masker/DSML salvage belum diaudit tuntas | **MASIH TERBUKA dan dikonfirmasi.** A-001 membuktikan salvage DSML dapat mengeksekusi tool yang sudah di-mask karena tidak ada authorization saat eksekusi. |
| **#221** | Cart exact-match/detectAgreedTreatment by design | **MASIH TERBUKA (by design).** Tidak diubah; A-004 adalah lubang berbeda pada `save_reservation.treatmentName`, bukan duplikat. |
| **#219** | Reply contract fail-soft, reviewer AI, wordlist | **MASIH TERBUKA.** Tidak diduplikasi; A-008 menyoroti normalizer yang berjalan sebelum template deterministik ditambahkan. |
| **#218** | Ambang klinis/ID layanan hardcode | **PARSIAL.** A-003 memakai gerbang klinis DB, tetapi logika skrining pasca-vaksin masih fail-open. Sisa hardcode tidak diulang di sini. |
| **#152** | Prompt injection ADV-01 diklaim selesai | **SELESAI SEBAGIAN / KLAIM TIDAK LENGKAP.** Sanitizer hanya menetralkan delimiter dan menandai pola injeksi; teks semantik tetap lolos, dan riwayat tidak disanitasi (A-006). |
| **#64** | Booking commit bergantung judgment LLM | **DONE + tech debt.** A-002/A-005 menunjukkan debt baru: sinyal komitmen deterministik terlalu longgar dan state `COMPLETED` salah arti. |
| **#108** | NLU Netra & rollback model | **MASIH TERBUKA.** A-010 membuktikan rollback per-task ke provider lain tidak berjalan karena endpoint selalu memakai provider aktif global. |
| **#273** | Baseline eval LLM CM-07/CM-08 | **MASIH TERBUKA.** Tidak dijalankan ulang; A-003 tidak bergantung pada eval berbayar. |
| **#265** | Clinical triage deterministik | **IMPLEMENTED, tetapi A-003 adalah bug di dalamnya**: urutan evaluasi `safe → unsafe` dan deteksi demam hanya numerik. |
| **#268** | Route/UI tulis `settings.brand` belum ada | **MASIH TERBUKA.** A-009 bukan duplikat: meski DB sudah berisi override, pembaca sinkron V3 tetap memakai brand default global. |
| **#272** | Persona split-brain residual | **RESOLVED.** Tidak diubah; tidak dijadikan temuan. |
| **#301** | Test pre-existing gagal | **MASIH TERBUKA.** Tidak dijalankan pada audit ini. |
| **#299** | Integritas audit: klaim PASS tanpa gate | **RESOLVED untuk proses gate**, tetapi klaim Fase 03 yang relevan diverifikasi ulang di §3.2 dan sebagian tidak akurat. |

### 3.2 Klaim laporan `docs/audit/2026-11-02/fase-03/LAPORAN_FASE_03.md`

| Item | Klaim lama | Verifikasi audit ini | Status |
|---|---|---|---|
| **3.1** Alur 2-stage & atomic routing | `parallel_tool_calls: false` terpasang; pruning multi-call ada | `generation-stage.ts:657` memang `parallel_tool_calls: false`; pruning ada di `:790-805`. | **PASS** |
| **3.2** Dynamic tool masking fisik | `save_reservation`/`calculate_delivery` dicabut dari schema | Schema memang difilter (`generation-stage.ts:613`), tetapi **tidak ada gerbang eksekusi**; DSML salvage/halusinasi bisa memanggil tool yang sudah dicabut (A-001). | **PARSIAL** |
| **3.3** 6 canonical tools | 6 tool terdaftar dan parameter terisolasi | Registri benar (`tool-registry.ts:8-15`), tetapi identitas treatment pada argumen tidak diikat ke pesan user (A-004). | **PARSIAL** |
| **3.4** 9 hard deterministic guardrails | 9 guardrail menutup klaim fakta, angka, pronoun, tag, booking, pricelist, GPS, darurat | Modul ada, tetapi urutan triase pasca-vaksin fail-open (A-003), normalizer tidak final (A-008), dan image gate melewati triase (A-012). | **PARSIAL** |
| **3.5** Manajemen state | Cart hanya via pesan user; goal/patient/summarizer | Cart memang memisahkan pesan asisten, tetapi `bookingCommitConfirmed` dapat diisi dari argumen LLM (A-002) dan `reservationId` pending menghasilkan `COMPLETED` (A-005). | **PARSIAL** |

### 3.3 Rujukan laporan lain

- `docs/audit/2026-11-02/LAPORAN_VERIFIKASI_ULANG.md`: gate Fase 03 berisi 10 file/91 test; ini **bukan** seluruh suite. Klaim “PASS” tidak boleh dibaca sebagai cakupan penuh (lihat #301).
- `docs/audit/2026-11-06/LAPORAN_AUDIT_RESERVASI.md`: A-009 (tool masking menyerap treatment dari pesan asisten) ditutup dengan batasan “tepat satu layanan”. Audit ini **tidak mengulang A-009**; A-004 menemukan lubang berbeda: `save_reservation.treatmentName` tidak pernah dicocokkan ke pilihan user.

---

## 4. Daftar Temuan

### 4.1 Ringkasan FMEA

| ID | Severity | Tipe | S | O | D | **RPN** |
|---|---|---:|---:|---:|---:|---:|
| **A-003** | KRITIS | Horizontal | 9 | 6 | 6 | **324** |
| **A-002** | KRITIS | Horizontal | 9 | 7 | 5 | **315** |
| **A-005** | TINGGI | Vertikal | 7 | 10 | 4 | **280** |
| **A-001** | KRITIS | Horizontal | 9 | 6 | 5 | **270** |
| **A-004** | TINGGI | Vertikal | 8 | 5 | 6 | **240** |
| **A-006** | TINGGI | Horizontal | 8 | 4 | 7 | **224** |
| **A-007** | TINGGI | Horizontal | 7 | 5 | 6 | **210** |
| **A-010** | SEDANG | Horizontal | 6 | 4 | 7 | **168** |
| **A-011** | SEDANG | Vertikal | 7 | 3 | 8 | **168** |
| **A-012** | SEDANG | Vertikal | 6 | 4 | 7 | **168** |
| **A-009** | SEDANG | Horizontal | 6 | 3 | 8 | **144** |
| **A-008** | SEDANG | Horizontal | 5 | 9 | 3 | **135** |
| **A-013** | RENDAH | Horizontal | 3 | 10 | 3 | **90** |

> Kalibrasi: S=9–10 untuk salah klinis, booking/paket salah, atau bypass otorisasi; S=7–8 untuk state/keuangan/route salah; S=5–6 untuk pelanggaran gaya/tenant/brand; S=3 untuk dokumentasi. D dinaikkan bila tidak ada test/alarm yang menutupinya.

### 4.2 Kontrol yang terbukti baik (jangan dirusak saat perbaikan)

1. **`parallel_tool_calls: false`** benar-benar dikirim di payload Call 1 (`generation-stage.ts:657`), dan hasil multi-call dipangkas (`:790-805`).
2. **Masking berbasis state** cukup kaya: layanan, lokasi presisi, tanggal, komitmen, dan anti-redundansi ongkir (`tool-masker.ts:501-655`).
3. **`detectAgreedTreatment` hanya membaca `role === 'user'`** (`booking-commit-gate.ts:79-83`), tidak menyerap rekomendasi asisten sebagai persetujuan.
4. **Clinical dominance katalog**: rekomendasi gejala dihitung dari katalog penuh sebelum filter nama (`get-catalog.tool.ts:424-465`).
5. **Numeric fact validator** memeriksa nominal `Rp` terhadap tool/cart (`numeric-fact-validator.ts:45-301`), dan payload tool menyembunyikan ongkir internal (`tool-pipeline.ts:113-128`).
6. **Session/tenant scoping**: `GoalTracker` memakai `tenant_id` pada query conversation/customer (`goal-tracker.ts:320-388`).

---

### A-001 — Tool yang sudah di-mask tetap dapat dieksekusi (tidak ada otorisasi saat eksekusi)

- **Tipe:** Horizontal (masking → parsing → eksekusi tool)
- **Lokasi:** `src/v3/agent/pipeline/generation-stage.ts:123-131, 613-628, 790-805, 841-888`; `src/v3/agent/pipeline/tool-pipeline.ts:278-606, 974-991`; `src/v3/agent/pipeline/dsml-tool-salvage.ts:140-199`; `src/v3/tools/tool-schemas.ts:41-57`.
- **Bukti:**
  - Masking hanya memfilter daftar schema yang dikirim: `const baseToolsForCall1 = isToolMaskingEnforced() ? maskingEval.availableTools : ALL_V3_TOOLS;` (`generation-stage.ts:613`). Tidak ada pemeriksaan ulang terhadap `availableTools` setelah respons LLM.
  - `parseCall1Data` menerima tool call dari properti `tool_calls` **atau** hasil salvage DSML mentah: `const salvaged = salvageToolCallsFromDsml(rawContent); if (salvaged.length > 0) { toolCalls = salvaged; ... }` (`generation-stage.ts:123-131`). `salvageToolCallsFromDsml` mencocokkan `invoke name="..."` apa pun tanpa whitelist (`dsml-tool-salvage.ts:145-149`).
  - Pipeline eksekusi hanya memvalidasi schema: `const validation = validateToolArgs(fnName, fnArgs);` lalu `executeToolByName(fnName, validation.data, toolContext)` (`tool-pipeline.ts:493, 602-606`). Tidak ada parameter `allowedTools`/`maskingEval` di `ToolExecutionPipeline.execute`.
  - Setelah `save_reservation` sukses, session dimutasi: `selectedTreatment: fnArgs.treatmentName, bookingCommitConfirmed: false, booking: { preferredDate: fnArgs.bookingDate, ... reservationId: toolResult.reservationId }` (`tool-pipeline.ts:974-991`).
  - Bahkan ketika router memanggil tool yang di-mask, kode hanya mengklasifikasikan: `if (!maskingEval.isSaveReservationAllowed && isSaveCalled) { classification = 'LLM_OVER_TRIGGER'; }` (`generation-stage.ts:863-864`) — tidak memblokir.
- **Keyakinan:** **TERBUKTI** untuk mekanisme (tidak ada gerbang eksekusi); frekuensi produksi **KEMUNGKINAN BESAR** karena DSML pernah terjadi (komentar insiden `Waru`/`Wonokusumo`, `generation-stage.ts:72-99, 682-697`; #227 mencatat salvage saat tool di-mask belum diaudit).
- **Pemetaan framework:** Security — OWASP LLM06 *Excessive Agency*; Well-Architected Security (least privilege) + Reliability.
- **Akar masalah (5 Whys):**
  1. Mengapa tool ter-mask bisa dieksekusi? Karena pipeline eksekusi tidak memeriksa daftar tool yang diizinkan.
  2. Mengapa tidak diperiksa? Karena masking diimplementasikan sebagai “tool schema tidak dikirim”, bukan sebagai authorization token di sisi server.
  3. Mengapa schema dianggap cukup? Karena asumsi “model tidak bisa memanggil tool yang tidak ada di schema”.
  4. Mengapa asumsi itu salah? Karena ada jalur salvage DSML yang membaca tool call dari teks mentah, dan provider dapat mengembalikan `tool_calls` di luar schema.
  5. Mengapa tidak tertangkap test? Karena `tool-masking-enforce.test.ts` hanya memeriksa nama tool yang dikirim ke LLM (`:54-61`), bukan eksekusi pasca-respons.
- **Risiko:** `save_reservation` dapat menulis reservasi saat customer baru bertanya, atau `calculate_delivery` dapat menghitung/membocorkan ongkir saat belum ada entitas lokasi baru; risiko paket/jadwal salah dan tagihan salah.
- **FMEA:** S=9 (booking/finansial salah), O=6 (DSML/halusinasi terdokumentasi), D=5 (log tool ada, tetapi tidak ada alarm/block) → **RPN 270**.
- **Collateral damage:** Menambahkan gerbang eksekusi bisa memblokir panggilan sintetis yang sah (vaccine safety call di `tool-pipeline.ts:216-276` dan forced delivery di `generation-stage.ts:754-782`). Keduanya harus ditandai `trustedInternal` atau dimasukkan ke allowlist eksplisit. Masking yang stale juga bisa memblokir turn valid; gunakan satu evaluasi pasca-latch yang sudah ada (`agent-runner.ts:378-398`).
- **Rekomendasi (fondasional):**
  1. Tambahkan `allowedToolNames: Set<string>` dan `trustedInternalCalls` ke `ToolExecutionPipeline.execute`; tolak setiap `fnName` yang tidak ada di allowlist dengan event `TOOL_EXECUTION_BLOCKED_BY_MASK` (tanpa mengeksekusi schema/DB).
  2. Filter hasil `salvageToolCallsFromDsml` terhadap allowlist sebelum dijadikan `toolCalls`; salvage tidak boleh “membuka” tool baru.
  3. Tambahkan defense-in-depth di `executeSaveReservation`: input `commitmentAuthorized`/`verifiedTreatmentNames` dari server (bukan dari argumen LLM); tolak jika tidak ada.
  4. Feature flag `TOOL_EXEC_AUTHZ_ENFORCE` (default true setelah test), rollback via env.
- **Verifikasi:** Test baru `tests/unit/v3/tool-execution-authz.test.ts`: (a) respons LLM dengan `save_reservation` saat `isSaveReservationAllowed=false` → tidak ada panggilan `reservationCoreService.saveReservation`; (b) DSML `invoke name="save_reservation"` pada turn greeting → ditolak; (c) vaccine synthetic call tetap berjalan; (d) forced `calculate_delivery` tetap berjalan. Jalankan `npm run build` + suite `tool-pipeline`, `tool-masker`, `v3-tools`.

---

### A-002 — Gerbang komitmen bisa menyala dari kata umum atau argumen tool LLM

- **Tipe:** Horizontal (pesan user → sinyal komitmen → state → tool)
- **Lokasi:** `src/utils/date-confirmation.ts:57-59, 124-132, 164-190, 236-247`; `src/v3/agent/pipeline/context-grounder.ts:301-324`; `src/v3/agent/pipeline/booking-commit-gate.ts:43, 58`; `src/v3/tools/tool-masker.ts:554-604`; `src/v3/agent/pipeline/generation-stage.ts:841-842`; `src/v3/tools/tool-schemas.ts:20-21, 37-38, 55-56, 62-63, 76-77, 83-84`; `src/v3/agent/agent-runner.ts:404-433`; `src/v3/state/cart-manager.ts:937-950`.
- **Bukti:**
  - Token komitmen memuat kata benda umum: `const BOOKING_COMMIT_SINGLE_TOKENS = ['jadwalkan', 'ambil', 'deal', 'fix', 'pesan', 'booking'];` (`date-confirmation.ts:57-59`), lalu dicek per token: `return BOOKING_COMMIT_SINGLE_TOKENS.some((w) => tokSet.has(w));` (`:186-189`).
  - `isConsultativeUserText` langsung menyerah jika ada sinyal komitmen: `if (hasBookingCommitSignal(lower)) return false;` (`:243`). Artinya “cara booking gimana?” atau “kalau ambil paket X harganya berapa?” **bukan** konsultasi.
  - `isAvailabilityInquiryText` juga kalah oleh sinyal komitmen: `return !hasBookingCommitSignal(lower);` (`:128`), sehingga “sabtu bisa booking?” tidak dianggap pertanyaan ketersediaan.
  - `applySessionLatches` mengunci state lengket: `if (hasBookingCommitSignal(cleanIncomingText)) { ... updateGoalSession(..., { bookingCommitConfirmed: true }) }` (`context-grounder.ts:306-311`).
  - `isBookingCommitReady` dan `tool-masker` memakai flag/token yang sama: `if (session.bookingCommitConfirmed !== true && !hasBookingCommitSignal(incomingText)) return false;` (`booking-commit-gate.ts:43`); `const hasCommitment = session.bookingCommitConfirmed === true || hasBookingCommitSignal(cleanIncomingText);` (`tool-masker.ts:563-564`).
  - Jalur kedua: verdict komitmen diambil dari **argumen tool apa pun**: `const commitmentVerdict = (parsedCalls.find((t) => t?.args?.commitment) as any)?.args?.commitment || null;` (`generation-stage.ts:841-842`). Field `commitment` ada di schema semua tool, termasuk FAQ/eskalasi (`tool-schemas.ts:62-63, 76-77, 83-84`), lalu langsung mengunci state: `if (routing.commitment === 'COMMITTED' && !session.bookingCommitConfirmed) { ... bookingCommitConfirmed: true }` (`agent-runner.ts:428-433`).
  - Verdict `EXPLORING` juga dapat mengosongkan cart yang valid: `applyCommitmentVeto` menghapus `cartItems` (`cart-manager.ts:937-950`), sehingga satu salah klasifikasi LLM bisa membatalkan keranjang.
- **Keyakinan:** **TERBUKTI** untuk perilaku kode; dampak produksi **KEMUNGKINAN BESAR** karena “booking/ambil/pesan” adalah kata umum dalam percakapan klinik.
- **Pemetaan framework:** Security — OWASP LLM06; Reliability/state machine; Operational (salah booking).
- **Akar masalah (5 Whys):**
  1. Mengapa “cara booking” bisa dianggap komitmen? Karena daftar token memasukkan kata benda “booking/ambil/pesan” sebagai sinyal positif.
  2. Mengapa kata benda dipakai? Karena gate butuh sinyal deterministik tanpa NLP, lalu daftar kata diperluas agar alur lama tidak regresi.
  3. Mengapa tidak ada pembeda pertanyaan/negasi? Karena `isAvailabilityInquiryText` justru dikalahkan oleh sinyal komitmen yang sama (sirkular).
  4. Mengapa state bisa lengket? Karena `bookingCommitConfirmed` dirancang sticky dan hanya dilepas oleh `hasBookingRetreatSignal`, yang juga bergantung pada fungsi inquiry yang sama.
  5. Mengapa tidak tertangkap? Karena test `tool-masking-commitment.test.ts` hanya menguji “hari tentatif” vs “komitmen eksplisit”, bukan frasa umum seperti “cara booking”.
- **Risiko:** Booking spurious/paket salah; cart valid bisa terhapus oleh verdict `EXPLORING`; customer yang hanya bertanya terlanjur dijadwalkan.
- **FMEA:** S=9 (booking salah), O=7 (kata umum), D=5 (log `ROUTER_COMMITMENT_VERDICT` ada, tetapi tidak ada alarm/koreksi) → **RPN 315**.
- **Collateral damage:** Memperketat gate bisa memblokir anaphora sah (“iya, ambil yang tadi”). Solusi harus mempertahankan `userConfirmedNames`/`detectAgreedTreatment` yang sudah berbasis pesan user, dan menguji ulang alur “hari di turn terpisah”.
- **Rekomendasi (fondasional):**
  1. Pisahkan **commitment signal** dari **availability inquiry**. Buat satu fungsi `classifyUserCommitment(userText, session)` yang mensyaratkan konstruksi gramatikal: pronomina/modal + verba tindakan + objek/deiksis, tanpa kata tanya/negasi/penundaan; kata benda “booking/pesan” saja tidak cukup.
  2. Hapus `commitment` dari schema tool umum; jika tetap diperlukan, jadikan field pada **satu** tool routing khusus yang divalidasi server terhadap pesan user (`role === 'user'`, turnId, teks). Jangan izinkan `commitment` di `get_clinic_policy_faq`/`search_knowledge_faq`/`escalate_to_human`.
  3. Mutasi `bookingCommitConfirmed` hanya lewat satu seam `applyUserCommitmentSignal` yang menerima pesan user terbaru; `EXPLORING` tidak boleh mengosongkan cart kecuali ada bukti user yang eksplisit.
  4. Tambahkan test adversarial multi-parafrase (“cara booking gimana”, “kalau ambil paket X berapa”, “mau pesan treatment”, “sabtu bisa booking?”) dan test bahwa argumen LLM `COMMITTED` tanpa sinyal user tidak mengubah state.
- **Verifikasi:** `tests/unit/v3/tool-masking-commitment.test.ts` diperluas; test baru `commitment-authority.test.ts`; integration `v3-conversation-matrix` skenario konsultasi harga; assert `bookingCommitConfirmed` tetap false dan `cartItems` tidak berubah.

---

### A-003 — Skrining klinis pasca-vaksinasi/demam fail-open (safe menang atas unsafe; demam tanpa angka lolos)

- **Tipe:** Horizontal (input → triage → tool booking)
- **Lokasi:** `src/v3/agent/pipeline/medical-signal-detector.ts:340-355, 361-398, 435-515`; `src/config/medical-keywords.ts:8-21, 182-184`; `src/v3/state/patient-extractor.ts:422-442`; `src/v3/agent/pipeline/context-grounder.ts:278-299`; `src/v3/tools/save-reservation.tool.ts:551-580`; `src/services/clinical-eligibility.service.ts:70-78`.
- **Bukti:**
  - `evaluateScreeningAnswer` memeriksa sinyal aman **lebih dulu** dan langsung `return`:
    ```ts
    const hasSafeTime = safeTimeSignals.some((s) => lower.includes(s));
    const hasSafeHealth = safeHealthSignals.some((s) => lower.includes(s));
    if (hasSafeTime || hasSafeHealth) {
      return { resolved: true, isSafe: true, note: 'Jeda waktu dan kondisi pasca-skrining aman' };
    }
    ...
    if (unsafeSignals.some((s) => lower.includes(s))) { return { resolved: true, isSafe: false, ... }; }
    ```
    (`medical-signal-detector.ts:381-395`). Artinya “baru vaksin tadi pagi tapi sudah tidak demam” → `isSafe=true` karena `hasSafeHealth`, walau belum 48 jam; “vaksin 4 hari lalu tapi masih demam” → `isSafe=true` karena `hasSafeTime`.
  - `evaluateTriageGate` hanya memblokir jika `!safeCheck.isSafe`: `if (!safeCheck.isSafe) { action: 'SCREEN' }` (`:486-497`), sehingga hasil `isSafe=true` melewati skrining.
  - Deteksi demam berat hanya pada angka ≥39/“demam tinggi” (`medical-keywords.ts:8-21, 182-184`); `parseFeverTemperature` hanya mengembalikan angka 35–42 (`patient-extractor.ts:422-442`). “Anak demam” tanpa angka tidak menghasilkan `feverContraindication` (`context-grounder.ts:278-299`), sehingga `save-reservation` tidak menerima flag (`save-reservation.tool.ts:554-564`) dan `clinical-eligibility` tidak memblokir (`clinical-eligibility.service.ts:76`).
- **Keyakinan:** **TERBUKTI** untuk logika OR dan deteksi numerik; dampak klinis aktual **KEMUNGKINAN BESAR** karena kalimat “sudah gak demam” / “masih demam” sangat umum. Nilai `contraindications`/`requires_screening` per layanan di DB produksi tidak diperiksa (**[ASUMSI]**).
- **Pemetaan framework:** Reliability/Safety; Well-Architected Operational Excellence; OWASP LLM09 *Misinformation* (rekomendasi terapi saat kondisi tidak aman).
- **Akar masalah (5 Whys):**
  1. Mengapa kasus “vaksin tadi pagi tapi tidak demam” lolos? Karena fungsi menganggap salah satu sinyal aman cukup.
  2. Mengapa cukup? Karena aturan ditulis sebagai OR untuk menghindari over-refusal, bukan AND untuk memenuhi syarat klinis.
  3. Mengapa sinyal bahaya tidak menang? Karena blok `unsafeSignals` berada setelah `return` sinyal aman.
  4. Mengapa demam tanpa angka lolos? Karena `feverContraindication` hanya diisi dari parser suhu numerik, bukan dari kata “demam”.
  5. Mengapa tidak tertangkap? Karena test `v3-triage-gate.test.ts` hanya menguji “4 hari lalu sudah tidak demam” (satu sinyal aman) dan “masih aget” (satu sinyal bahaya), tidak menguji kombinasi keduanya.
- **Risiko:** Pijat pasca-vaksinasi sebelum 48 jam atau saat masih demam; kontraindikasi klinis tidak berjalan; potensi keluhan/komplikasi dan risiko reputasi.
- **FMEA:** S=9 (salah klinis), O=6 (frasa umum), D=6 (tidak ada test/alarm untuk konflik sinyal) → **RPN 324**.
- **Collateral damage:** Menerapkan AND akan meningkatkan `SCREEN`/penolakan dan beban staf; perlu keputusan klinis (48–72 jam) dan UX yang jelas. Jangan memblokir semua “demam” jika kebijakan tenant mengizinkan; ambil ambang dari `ClinicPolicy`/DB.
- **Rekomendasi (fondasional):**
  1. Ubah `evaluateScreeningAnswer` menjadi tri-state: `hasSafeTime`, `hasUnsafeHealth`, `hasUnknown`; **unsafe menang**; `isSafe` hanya jika `time>=48h AND no fever` (atau kebijakan DB).
  2. Tambahkan `feverSuspected` dari kata “demam/panas/suhu” tanpa angka ke `session`/tool context; `save_reservation` wajib `screeningConfirmed` atau menolak sampai skrining.
  3. Ambil ambang dan aturan dari `ClinicPolicy`/`Treatment` (tenant-aware), fallback aman 48–72 jam.
  4. Tambahkan test konflik: “baru vaksin tadi pagi tapi tidak demam” → SCREEN; “vaksin 4 hari lalu masih demam” → SCREEN; “demam” tanpa angka → SCREEN/ASK.
- **Verifikasi:** `v3-triage-gate.test.ts` + test baru `vaccine-screening-conflict.test.ts`; integration `vaccine-sop-flow`; assert `save_reservation` tidak dipanggil sampai `screeningConfirmed`.

---

### A-004 — Identitas treatment pada argumen tool tidak diikat ke pilihan user

- **Tipe:** Vertikal (Call 1 → argumen tool → katalog/reservasi)
- **Lokasi:** `src/v3/agent/pipeline/tool-pipeline.ts:88-96, 428-439, 106-131, 974-991`; `src/v3/tools/save-reservation.tool.ts:180-183, 455-460, 612-640`; `src/v3/tools/get-catalog.tool.ts:440-465`; `src/v3/tools/tool-masker.ts:510-515`.
- **Bukti:**
  - Gate `specificTreatmentName` meloloskan **satu token** yang sama: `const appears = normHay.includes(normNeedle) || normNeedle.split(' ').some((tok) => tok.length >= 4 && normHay.includes(tok));` (`tool-pipeline.ts:435`). Contoh: `specificTreatmentName = "Pijat Kids Pulih Ceria"` tetap lolos saat user hanya menulis “pijat bayi” karena token `pijat` cocok.
  - Helper `isCandidateTreatmentVerbatim` juga hanya butuh satu token ≥4 (`tool-pipeline.ts:88-96`), dipakai untuk `candidateTreatmentName` delivery.
  - `save_reservation` menerima `treatmentName` mentah dari argumen LLM dan langsung memakainya: `const allTreatments = [treatmentName, ...extraClean...]` (`save-reservation.tool.ts:455-457`), lalu menyimpan `treatmentDetail` (`:612-640`). Tidak ada pemeriksaan bahwa nama itu muncul di pesan user atau sama dengan `session.selectedTreatment`.
  - Masker hanya memeriksa **ada/tidaknya** treatment di sesi: `hasTreatment = (session.cartItems?.length > 0) || Boolean(session.selectedTreatment) || Boolean(candidateTreatment)` (`tool-masker.ts:510-515`), bukan kesesuaian nama yang akan dikirim.
  - Setelah sukses, pipeline justru menimpa `selectedTreatment` dengan nama dari argumen LLM: `selectedTreatment: fnArgs.treatmentName` (`tool-pipeline.ts:981`).
- **Keyakinan:** **TERBUKTI** untuk mekanisme; risiko salah paket **KEMUNGKINAN BESAR** jika model memilih varian usia/kategori yang salah.
- **Pemetaan framework:** Security — OWASP LLM06; Well-Architected Reliability (harga/paket) + Operational.
- **Akar masalah (5 Whys):**
  1. Mengapa nama treatment bisa berbeda dari yang disetujui user? Karena `save_reservation` menerima string dari LLM tanpa verifikasi.
  2. Mengapa tidak diverifikasi? Karena gate hanya memastikan “ada treatment di sesi”, bukan “nama ini yang dipilih user”.
  3. Mengapa gate token longgar? Karena tujuannya mencegah halusinasi total, bukan menjamin identitas persis; satu token dianggap cukup.
  4. Mengapa tidak ada test? Karena test katalog fokus pada clinical dominance/usia, bukan pada penyalahgunaan `specificTreatmentName` lintas kategori.
  5. Mengapa berbahaya? Karena katalog punya nama kembar lintas usia (Baby/Kids) dan harga berbeda.
- **Risiko:** Customer memesan “Pijat Bayi” tetapi tersimpan “Pijat Kids” (atau sebaliknya); harga, durasi, dan clinical gate salah; tagihan/komplain.
- **FMEA:** S=8 (paket/harga salah), O=5, D=6 (log args ada, tetapi tidak ada validasi) → **RPN 240**.
- **Collateral damage:** Gate exact-string bisa memblokir anaphora (“yang tadi”), jadi gunakan **set nama yang pernah dirujuk user** (`userConfirmedNames` di `cart-manager.ts:437-453`) dan `session.selectedTreatment`, bukan hanya string match. Varian usia harus dipilih dari `childAgeMonths`/`ageTier`, bukan dari nama bebas.
- **Rekomendasi (fondasional):**
  1. Tambahkan `verifiedTreatmentNames: string[]` ke `ToolExecutionContext`, dihitung dari pesan user (bukan asisten) + `selectedTreatment` yang sudah disetujui.
  2. `save_reservation` menolak `treatmentName` yang tidak ada di `verifiedTreatmentNames`, atau meminta klarifikasi; jangan menimpa `selectedTreatment` dengan argumen yang tidak terverifikasi.
  3. Perketat `specificTreatmentName`: cocokkan nama penuh/alias katalog (`matchCatalogItem`) atau minimal semua token signifikan, bukan satu token umum; token generik (`pijat`, `bayi`, `kids`) tidak boleh menjadi penentu tunggal.
  4. Gunakan `ageTier` untuk memilih varian usia; jika usia tidak diketahui, tanya/`ASK_STAGE`, jangan menebak.
- **Verifikasi:** Test baru `treatment-identity-contract.test.ts`: (a) user “pijat bayi” + LLM `Pijat Kids Pulih Ceria` → ditolak/diklarifikasi; (b) `save_reservation` dengan nama di luar `verifiedTreatmentNames` → `success:false`; (c) anaphora “yang tadi” tetap lolos jika `userConfirmedNames` berisi. Regresi `v3-cart-*`, `get-catalog-*`.

---

### A-005 — Reservasi pending langsung menjadi state `COMPLETED`

- **Tipe:** Vertikal (tool success → session → conversation state → AI scope/dashboard)
- **Lokasi:** `src/v3/agent/pipeline/phase-resolver.ts:141-143`; `src/v3/agent/pipeline/tool-pipeline.ts:974-991`; `src/state-machine/machine.ts:694-724`; `src/services/ai-scope-gate.service.ts:41-45`; `src/v3/state/goal-tracker.ts:63-73`; `tests/unit/reservation-completed-state.test.ts:25-34`.
- **Bukti:**
  - `deriveConversationState` mengembalikan `COMPLETED` hanya karena ada `reservationId`: `if (session.booking?.isConfirmed || session.booking?.reservationId) { return ConversationState.COMPLETED; }` (`phase-resolver.ts:141-143`).
  - `save_reservation` justru menulis `isConfirmed: false` dan `needsStaffVerification: true`: `booking: { preferredDate, preferredTime, reservationId, isConfirmed: false, needsStaffVerification: true, ... }` (`tool-pipeline.ts:983-990`), dengan komentar eksplisit “agar state = RESERVATION_SENT, bukan COMPLETED” (`:974-979`).
  - `nextState` dari V3 dipakai apa adanya oleh machine: `nextState: v3Result.isEscalated ? HUMAN_HANDLING : (v3Result.nextState || activeConversation.current_state)` (`machine.ts:694-697`), lalu ditulis ke conversation (`:715-723`).
  - `ai-scope-gate` menganggap `COMPLETED` sebagai reset boundary: `if (state === INITIAL || state === COMPLETED) return true;` (`ai-scope-gate.service.ts:41-45`). Customer existing/legacy yang baru booking bisa disenyapkan pada pesan berikutnya.
  - `GoalTracker` memangkas cache `COMPLETED` setelah 30 menit (`goal-tracker.ts:63-73`), sehingga sesi bisa amnesia lebih cepat.
  - Test saat ini justru mengunci perilaku salah: `booking: { reservationId: 'res-9' }` → `COMPLETED` (`tests/unit/reservation-completed-state.test.ts:30-34`).
- **Keyakinan:** **TERBUKTI**.
- **Pemetaan framework:** Well-Architected Reliability + Operational Excellence (state semantics, AI scope, dashboard).
- **Akar masalah (5 Whys):**
  1. Mengapa booking pending menjadi COMPLETED? Karena `reservationId` dianggap bukti selesai.
  2. Mengapa `reservationId` dianggap selesai? Karena perbaikan R2 (#235) ingin menulis COMPLETED saat reservasi selesai, tetapi tidak membedakan `isConfirmed/needsStaffVerification`.
  3. Mengapa tidak dibedakan? Karena state conversation dan status reservasi adalah dua konsep yang dicampur dalam satu derivasi.
  4. Mengapa test tidak menangkap? Karena test C2 mengasumsikan semua `reservationId` adalah booking selesai.
  5. Mengapa berdampak? Karena `COMPLETED` dipakai AI scope gate, pruning cache, dan dashboard sebagai “selesai”.
- **Risiko:** Customer yang baru mengirim permintaan booking (belum dikonfirmasi) kehilangan balasan bot pada pesan berikutnya; dashboard salah menampilkan selesai; analytics/reservation state tidak konsisten.
- **FMEA:** S=7, O=10 (setiap booking), D=4 (test mengunci perilaku, log state terlihat) → **RPN 280**.
- **Collateral damage:** Mengubah derivasi bisa memengaruhi `ai-scope-gate`, `burst-coalesce`, dan dashboard; harus ada test lintas layanan. Jangan mengubah `reservation-lifecycle` yang memang menulis COMPLETED saat reservasi benar-benar selesai.
- **Rekomendasi (fondasional):**
  1. `deriveConversationState` hanya `COMPLETED` bila `booking.isConfirmed === true` atau status reservasi benar-benar `completed`; jika `reservationId && needsStaffVerification` → `RESERVATION_SENT`.
  2. Pisahkan `ConversationState` (percakapan) dari `ReservationStatus` (operasional); jangan gunakan `reservationId` sebagai proxy status.
  3. Perbarui test C2 dan `ai-scope-gate.test` agar membedakan pending vs completed.
  4. Tambahkan invariant monitor: `COMPLETED` + `needsStaffVerification=true` = anomali.
- **Verifikasi:** `reservation-completed-state.test.ts` diubah; test baru `conversation-state-pending.test.ts`; integration `ai-scope-gate` “legacy + pending booking” harus `pass` (mid-flow), bukan silence; `npm run build`.

---

### A-006 — Prompt injection hanya disanitasi pada pesan saat ini; riwayat dikirim mentah dan pola injeksi hanya ditandai

- **Tipe:** Horizontal (input boundary → prompt history → Call 1/2)
- **Lokasi:** `src/v3/agent/agent-runner.ts:209-213`; `src/utils/prompt-injection-sanitizer.ts:26-66, 74-76`; `src/v3/agent/pipeline/context-grounder.ts:353-362`; `src/v3/agent/pipeline/generation-stage.ts:418-446`.
- **Bukti:**
  - Hanya pesan saat ini yang dibungkus: `{ role: 'user', content: wrapCustomerMessage(cleanIncomingText) }` (`agent-runner.ts:213`), sedangkan `recentHistory` dimasukkan mentah: `...recentHistory` (`:209-213`).
  - Riwayat diambil dari DB tanpa sanitasi: `recentMsgs = await messageService.getRecentMessages(...)` lalu `content: m.content` (`context-grounder.ts:353-362`).
  - `sanitizeCustomerInput` hanya menetralkan tag/delimiter dan **menambahkan label** ke `blocked`, tetapi teksnya tidak diubah untuk pola semantik: `if (re.test(out)) blocked.add(label);` (`prompt-injection-sanitizer.ts:54-62`). Jadi “abaikan semua instruksi...” tetap ada di dalam `<customer_message>`.
  - `wrapCustomerMessage` hanya membungkus teks saat ini (`:74-76`); tidak ada fungsi yang diterapkan ke history.
- **Keyakinan:** **TERBUKTI** untuk mekanisme; eksploitasi nyata **KEMUNGKINAN BESAR** pada percakapan multi-turn.
- **Pemetaan framework:** Security — OWASP LLM01 *Prompt Injection*; Well-Architected Security.
- **Akar masalah (5 Whys):**
  1. Mengapa injeksi multi-turn bisa lolos? Karena history tidak disanitasi.
  2. Mengapa hanya current message? Karena `wrapCustomerMessage` dipanggil di satu call site.
  3. Mengapa pola semantik tidak dihapus? Karena sanitizer dirancang untuk “menandai”, bukan “menetralkan”.
  4. Mengapa label tidak dipakai? Karena `blockedPatterns` tidak dibaca oleh `agent-runner`/`generation-stage`.
  5. Mengapa test tidak menangkap? Karena `prompt-injection-sanitizer.test.ts` menguji breakout delimiter pada satu pesan, bukan serangan dua turn.
- **Risiko:** Customer dapat membelokkan instruksi sistem, membocorkan prompt, memaksa tool/commitment, atau mengubah kebijakan klinis lintas turn.
- **FMEA:** S=8, O=4, D=7 → **RPN 224**.
- **Collateral damage:** Sanitasi agresif bisa merusak pesan sah yang memuat kata “prompt”/“sistem”; lakukan escape/neutralisasi struktur, bukan mutilasi kalimat. Jangan mengubah teks yang disimpan untuk audit; sanitasi di boundary prompt.
- **Rekomendasi (fondasional):**
  1. Terapkan `sanitizeCustomerInput`/`wrapCustomerMessage` ke **setiap** entri `role:'user'` saat menyusun `messages` (history + current), dengan versi yang menetralkan pola instruksi (escape/remove) bukan hanya menandai.
  2. Simpan teks asli untuk audit; gunakan `content_clean`/prompt-safe di `ContextGrounder`/`agent-runner`.
  3. Tambahkan deteksi injeksi pada pesan assistant/tool yang masuk kembali ke prompt (indirect injection).
  4. Test dua turn: turn 1 injeksi, turn 2 “lanjutkan”; pastikan prompt Call 1/2 tidak memuat perintah injeksi.
- **Verifikasi:** `tests/unit/v3/prompt-injection-sanitizer.test.ts` diperluas; test baru `prompt-injection-history.test.ts`; integration `v3-conversation-matrix` dengan injeksi lintas turn; assert `blockedPatterns` minimal dan teks prompt bersih.

---

### A-007 — `location.kota` dianggap lokasi presisi, sehingga kota luas/centroid bisa membuka `save_reservation`

- **Tipe:** Horizontal (geocoding → session → masker → tool reservasi → prompt)
- **Lokasi:** `src/v3/tools/calculate-delivery.tool.ts:862-960`; `src/v3/agent/pipeline/tool-pipeline.ts:743-757`; `src/v3/tools/tool-masker.ts:525-539`; `src/v3/tools/save-reservation.tool.ts:387-414`; `src/v3/agent/pipeline/context-grounder.ts:159-165`.
- **Bukti:**
  - `calculate_delivery` mengembalikan `kota: resolved.kota` bahkan ketika `isPrecise` false/centroid (`calculate-delivery.tool.ts:946-952`).
  - Pipeline menulis `kota` ke session tanpa menyimpan flag presisi: `location: { rawText, kelurahan, kecamatan, kota, distanceKm, ongkir..., isOutOfCoverage }` (`tool-pipeline.ts:743-757`).
  - Masker menganggap `kota` sebagai presisi: `const hasPreciseLocation = Boolean(session.location?.kelurahan || session.location?.kecamatan || session.location?.kota) || ...` (`tool-masker.ts:528-531`).
  - `save_reservation` juga menganggap `kota` sebagai `structuredPrecise` (`save-reservation.tool.ts:387-390`), lalu melewati gerbang `LOCATION_IMPRECISE` (`:414`), sehingga reservasi dapat dikunci walau hanya ada nama kota.
  - `buildContextSummary` ikut menyuntik jarak untuk `kota` (`context-grounder.ts:159-165`), memperkuat kesan lokasi presisi.
- **Keyakinan:** **TERBUKTI** untuk logika field; apakah geocoding benar-benar mengembalikan `kota` tanpa `kelurahan` untuk input kota luas **PERLU VERIFIKASI** di staging (**[ASUMSI]**).
- **Pemetaan framework:** Well-Architected Reliability + Security (rute/ongkir).
- **Akar masalah (5 Whys):**
  1. Mengapa kota luas bisa membuka booking? Karena `kota` dihitung sebagai presisi.
  2. Mengapa? Karena field `kelurahan/kecamatan/kota` dianggap sama-sama terstruktur.
  3. Mengapa tidak ada flag presisi? Karena output tool tidak membawa `precision`/`isEstimatedCentroid` ke session secara eksplisit; `isPrecise` hanya dipakai untuk nominal.
  4. Mengapa C.1 tidak menangkap? Karena C.1 hanya memeriksa `rawText` (`isBroadRegionText`), bukan `kota` terstruktur.
  5. Mengapa test tidak menangkap? Karena test `v3-save-masker-rawtext` hanya menguji rawText, bukan session dengan `kota` saja.
- **Risiko:** Reservasi terkunci untuk alamat yang belum terverifikasi; bidan/rute/ongkir salah; customer diberi janji jadwal tanpa dasar.
- **FMEA:** S=7, O=5, D=6 → **RPN 210**.
- **Collateral damage:** Menolak semua `kota` akan memblokir customer yang hanya menyebut kota tapi sudah punya alamat tersimpan; gunakan `activeSavedAddress`/kelurahan dari kartu alamat, atau tanya kelurahan.
- **Rekomendasi (fondasional):**
  1. Tambahkan `locationPrecision: 'precise'|'centroid'|'broad'|'unknown'` ke `LocationState`; isi dari output `calculate_delivery` (`isPrecise`, `isEstimatedCentroid`, kelurahan).
  2. Masker dan `save_reservation` hanya membuka booking jika `precision==='precise'` atau ada `savedAddress` dengan kelurahan; `kota` saja = `broad` (tanya kelurahan).
  3. Jangan suntik `distanceKm` di prompt untuk `precision!=='precise'`.
  4. Migrasi data lama: derivasi `precision` dari kelurahan/kecamatan; jika hanya kota → broad.
- **Verifikasi:** Test baru `location-precision-contract.test.ts`: mock delivery `{ success:true, isPrecise:false, kota:'Surabaya' }` → `save_reservation` masked; `{ kelurahan:'Tenggilis' }` → allowed; `activeSavedAddress` dengan kelurahan → allowed. Regresi `v3-save-masker-rawtext`, `location-*`.

---

### A-008 — Template deterministik ditambahkan setelah sanitizer, sehingga kuota “Bunda” dan batas 3 kalimat bocor

- **Tipe:** Horizontal (output normalizer)
- **Lokasi:** `src/v3/agent/pipeline/guardrail-pipeline.ts:376, 632, 645-652, 967-971, 1172-1176, 1179-1185, 1229-1237`; `src/v3/guardrails/sanitizer.ts:226-231, 493-601`.
- **Bukti:**
  - Sanitasi awal: `let finalReply = OutputSanitizer.cleanOutboundReply(...)` (`guardrail-pipeline.ts:376`). Di dalamnya kuota vokatif diterapkan (`sanitizer.ts:226-231`), lalu `truncateToMaxChars` (`:232`).
  - Setelah itu pipeline menambahkan teks deterministik tanpa re-sanitasi:
    - D9 fallback: `'Baik Bunda, ... ya Bunda ... ya bund'` (3 panggilan) (`guardrail-pipeline.ts:632`).
    - D10 fallback: `'... ya Bunda 😊 Ada yang ingin Bunda tanyakan ...?'` (2 panggilan) (`:645, :652`).
    - Same-day disclaimer: `ensureSameDayDisclaimer(finalReply)` (`:967-971`).
    - Pertanyaan subjek: `finalReply = finalReply ? `${finalReply.trim()}\n\n${question}` : question;` (`:1179-1185`).
    - CTA kontrak: `ensureRepromptClosingCta(finalReply, cta)` (`:1229-1237`).
  - Trimmer 3 kalimat baru dijalankan di `:1172-1176`, lalu masih ada append di `:1179-1185` dan `:1229-1237`; jadi output akhir bisa >3 kalimat.
- **Keyakinan:** **TERBUKTI** (urutan eksekusi eksplisit).
- **Pemetaan framework:** Operational Excellence (kualitas output), Reliability (konsistensi gaya).
- **Akar masalah (5 Whys):**
  1. Mengapa kuota Bunda bisa >1? Karena template fallback ditambahkan setelah `cleanOutboundReply`.
  2. Mengapa ditambahkan setelah? Karena fallback/CTA butuh state hasil validasi, bukan draf awal.
  3. Mengapa tidak ada normalizer final? Karena setiap blok menambahkan teks sendiri dan mengandalkan sanitizer awal.
  4. Mengapa trimmer tidak menangkap? Karena trimmer dijalankan sebelum dua append terakhir.
  5. Mengapa tidak ada test? Karena test sanitizer menguji `cleanOutboundReply` langsung, bukan output akhir `verifyAndReprompt`.
- **Risiko:** Melanggar Aturan Emas 1 (2–3 kalimat) dan 6 (kuota “Bunda”), membuat pesan terasa kaset/bertele-tele; khusus fallback D9/D10 justru muncul saat model gagal, sehingga pelanggaran terjadi di momen paling sensitif.
- **FMEA:** S=5, O=9, D=3 → **RPN 135**.
- **Collateral damage:** Normalizer final bisa memotong CTA/pertanyaan subjek yang penting; pertahankan daftar pengecualian (form/katalog/safety) dan uji semua fallback. Jangan memutilasi kalimat; trim pada batas kalimat.
- **Rekomendasi (fondasional):**
  1. Tambahkan satu seam final `finalizeOutboundReply()` setelah **semua** append; di dalamnya jalankan kuota vokatif, trimmer 3 kalimat (dengan pengecualian struktur), dan validasi kosong.
  2. Pindahkan `ensureSameDayDisclaimer`, D9/D10 fallback, pertanyaan subjek, dan CTA ke dalam seam tersebut, atau panggil `finalize` setelahnya.
  3. Tambahkan test pipeline penuh yang menghitung jumlah “Bunda” dan kalimat pada setiap cabang fallback.
- **Verifikasi:** Test baru `guardrail-final-normalizer.test.ts` untuk D9/D10/same-day/pendingSubject/CTA; assert `countVocative<=1` (follow-up) atau `<=2` (opener) dan `sentences<=3` untuk prosa; regresi `v3-sanitizer-*`, `guardrail-pipeline`.

---

### A-009 — Konteks tenant hilang di jalur deterministik (brand default dan katalog anaphoric default-tenant)

- **Tipe:** Horizontal (tenant isolation)
- **Lokasi:** `src/config/brand.ts:36-38`; `src/v3/agent/pipeline/generation-stage.ts:1040-1043`; `src/v3/agent/pipeline/guardrail-pipeline.ts:111, 1055-1057, 1089-1091`; `src/v3/tools/clinic-faq.tool.ts:86-95`; `src/v3/tools/tool-masker.ts:410-411`; `src/v3/domain/types.ts:110-130`; `src/config/persona.ts:466, 473`.
- **Bukti:**
  - `getBrandIdentity()` mengembalikan variabel global `currentBrand`, bukan per-tenant: `let currentBrand = { ...DEFAULT_BRAND_IDENTITY }; export function getBrandIdentity() { return currentBrand; }` (`brand.ts:36-38`). Tidak ada pemanggil `setBrandIdentity` di `src/` (grep hanya definisi).
  - Sapaan Turn-0 di generation memakai varian sinkron: `const brand = getBrandIdentity(); ... Perkenalkan, saya Bidan Yusi dari ${brand.businessName}` (`generation-stage.ts:1040-1043`).
  - Fallback guardrail memakai `getBrandIdentity()` (`guardrail-pipeline.ts:1055-1057, 1089-1091`), dan system editor reprompt **hardcode** `"Kala Moms and Baby Spa"` (`:111`).
  - Static fallback FAQ memakai brand default dan hardcode rekening: `const brand = getBrandIdentity(); ... 'a.n Kala Moms and Baby Spa'` (`clinic-faq.tool.ts:86-101`).
  - `resolveCandidateTreatment` memakai `(session as any).tenantId || DEFAULT_TENANT_ID` (`tool-masker.ts:410-411`), padahal `CustomerGoalSession` tidak memiliki `tenantId` (`domain/types.ts:110-130`); `GoalTracker` juga tidak pernah mengisinya. Di tenant B, katalog anaphoric selalu memakai katalog default.
  - `persona.ts` juga memuat data bisnis hardcode seperti “klinik kami di Waru” dan area “Sidoarjo dan Surabaya” (`persona.ts:466, 476`).
- **Keyakinan:** **TERBUKTI** untuk kode; dampak aktual **TERBATAS pada deployment multi-tenant** saat ini (**[ASUMSI]**).
- **Pemetaan framework:** Security/tenant isolation; Operational Excellence (SaaS-readiness).
- **Akar masalah (5 Whys):**
  1. Mengapa tenant B bisa melihat brand default? Karena jalur sinkron tidak pernah membaca `Tenant.settings.brand`.
  2. Mengapa? Karena hanya `getBrandIdentityAsync` yang tenant-aware, dan jalur deterministik memakai versi sinkron.
  3. Mengapa anaphoric memakai default? Karena `tenantId` tidak ada di session/parameter `evaluateToolMasking`.
  4. Mengapa tidak terdeteksi? Karena test memakai `default-tenant`.
  5. Mengapa dibiarkan? Karena SaaS multi-tenant belum diaktifkan; utang ini belum pernah diuji dengan tenant kedua.
- **Risiko:** Brand/nama klinik salah, rekening/pembayaran salah (fallback FAQ), layanan tenant B tidak dikenali saat anaphora → booking gagal/over-restrictive.
- **FMEA:** S=6, O=3, D=8 → **RPN 144**.
- **Collateral damage:** Mengalirkan `tenantId` ke semua lapisan bisa mengubah cache/prompt; harus test tenant A/B. Jangan menghapus fallback default (tetap dipakai bila DB offline).
- **Rekomendasi (fondasional):**
  1. Tambahkan `tenantId` ke `CustomerGoalSession` (atau parameter eksplisit) dan teruskan ke `evaluateToolMasking`, `resolveCandidateTreatment`, `DeliveryFastPath`, dan tool context.
  2. Gunakan `getBrandIdentityAsync(tenantId)` di `generation-stage`, `guardrail-pipeline`, `clinic-faq.tool`; hapus brand literal dari `REPROMPT_EDITOR_SYSTEM`.
  3. Pindahkan fallback policy/rekening ke `ClinicPolicy`/DB; fallback kode hanya untuk keadaan darurat dan harus jelas.
  4. Tambahkan test tenant B: brand, FAQ, anaphoric treatment, dan `save_reservation`.
- **Verifikasi:** Test baru `tenant-context-v3.test.ts` dengan `tenantId='tenant-b'` dan mock `Tenant.settings.brand`; assert output memakai brand B dan katalog B; `tenant-masker` test untuk anaphora.

---

### A-010 — Konfigurasi provider per-task dan failover LLM tidak tenant-aware; metadata provider aktual hilang

- **Tipe:** Horizontal (config → endpoint → fallback → cost/audit)
- **Lokasi:** `src/integrations/llm/llm-gateway.ts:33-41`; `src/config/ai-models.config.ts:65-79, 588-589`; `src/v3/agent/pipeline/generation-stage.ts:21-66, 643-680`; `src/integrations/llm/model-fallback.ts:29-57`; `src/v3/agent/agent-runner.ts:140-150`.
- **Bukti:**
  - `getLlmEndpointConfig` selalu memakai base URL provider aktif global: `const activeEndpoint = AiModelConfigService.getActiveEndpointConfig(tenantId); ... const baseUrl = (overrides?.baseUrl || activeEndpoint.baseUrl || ...)` (`llm-gateway.ts:33-41`). `modelConfigKey` hanya memengaruhi `model`, bukan `provider`/`baseUrl`.
  - `getModelConfig` menyanitasi model berdasarkan provider task (`ai-models.config.ts:588-589`), dan komentar `baseUrlForProviderLabel` menyatakan “bukan provider aktif global” (`:65-69`). Namun hasilnya disanitasi ulang terhadap base URL aktif di `getLlmEndpointConfig`; jika provider task berbeda, model di-remap ke model default provider aktif.
  - `#108` menawarkan rollback `updateTaskConfig('INTENT_CLASSIFICATION', { provider: 'OpenAI', modelName: 'gpt-4o-mini' })`; dengan kode ini, rollback tersebut tidak akan benar-benar memakai OpenAI jika provider aktif masih SumoPod.
  - Circuit breaker V3 adalah **singleton global** (`v3LlmCircuitBreaker`, `generation-stage.ts:21-66`), dan tier fallback berasal dari env global (`model-fallback.ts:29-57`). Kegagalan provider tenant A dapat membuka circuit untuk tenant B, lalu mengarahkan tenant B ke fallback global.
  - Fallback tidak menulis `__actualBaseUrl`: hanya `__actualModel`/`__actualProvider` (`generation-stage.ts:48-52`), sedangkan `agent-runner.ts:673-674` membaca `data?.__actualBaseUrl || routerBaseUrl`. Akibatnya biaya/audit fallback dapat diatribusikan ke provider primer; `createTelemetry.finishCost` juga memakai `turn.baseUrl` dan `turn.actualModelUsed` terakhir untuk seluruh token (`:336-347`).
- **Keyakinan:** **TERBUKTI** untuk kontrak kode; dampak runtime **KEMUNGKINAN BESAR** hanya jika admin memakai provider task berbeda/fallback.
- **Pemetaan framework:** Reliability (failover), Performance/Cost (Operational), Security/tenant isolation.
- **Akar masalah (5 Whys):**
  1. Mengapa provider per-task tidak dipakai? Karena resolver endpoint hanya membaca provider aktif tenant.
  2. Mengapa? Karena endpoint dirancang global per tenant, sedangkan task config dirancang per task.
  3. Mengapa circuit breaker global? Karena dibuat satu instance modul, bukan per tenant/provider.
  4. Mengapa metadata baseUrl hilang? Karena fallback hanya menambahkan `__actualModel`/`__actualProvider`, bukan `__actualBaseUrl`.
  5. Mengapa tidak tertangkap? Karena test model config tidak menguji kombinasi provider task ≠ provider aktif dan tidak memeriksa biaya fallback.
- **Risiko:** Admin mengira sudah rollback ke OpenAI tetapi tetap memakai SumoPod/Kenari; biaya/latensi/JSON parsing berubah; satu tenant dapat menurunkan kualitas tenant lain saat outage; biaya fallback salah dicatat.
- **FMEA:** S=6, O=4, D=7 → **RPN 168**.
- **Collateral damage:** Memperbaiki routing dapat mengubah biaya dan perilaku model; gunakan feature flag dan uji per provider. Fallback per tenant membutuhkan konfigurasi DB (Confirmation Gate jika skema baru).
- **Rekomendasi (fondasional):**
  1. `getLlmEndpointConfig` harus memilih `baseUrl` berdasarkan `modelConfig.provider` (via `baseUrlForProviderLabel`) dan menolak kombinasi provider/model yang tidak valid, bukan remap senyap.
  2. Jadikan circuit breaker per `tenantId+provider` (Map) atau minimal reset/isolasi per provider; jangan satu singleton untuk semua tenant.
  3. Fallback tier harus dapat dikonfigurasi per tenant (DB) atau minimal memakai provider yang selaras dengan model; catat `__actualBaseUrl`.
  4. Pisahkan perhitungan biaya per call; `finishCost` harus menjumlahkan biaya per model/baseUrl, bukan model terakhir.
- **Verifikasi:** Test `llm-endpoint-config.test.ts`: task provider OpenAI + active SumoPod → endpoint/model OpenAI atau error eksplisit; fallback response `__actualBaseUrl` terisi; cost dua model dijumlah benar; circuit breaker tenant A tidak memblokir B.

---

### A-011 — Timeout tool tidak membatalkan eksekusi; efek samping `save_reservation` bisa selesai setelah pipeline menganggap gagal

- **Tipe:** Vertikal (tool timeout → side effect → customer reply)
- **Lokasi:** `src/v3/agent/pipeline/tool-pipeline.ts:56-63, 493-606`.
- **Bukti:**
  - `withTimeout` hanya `Promise.race` antara promise dan reject timer (`:56-63`); tidak ada `AbortController`/cancel.
  - `save_reservation` diberi batas 7 detik (`:499`), lalu dijalankan `executeToolByName(...)` (`:602-606`). Jika timeout, catch mengubah `toolResult = { error: ... }` (`:607-626`), tetapi promise `executeSaveReservation` tetap berjalan dan dapat menulis DB.
  - Customer kemudian bisa menerima pesan “gagal” dari Call 2/guardrail, padahal reservasi mungkin sudah tercatat; atau retry berikutnya membuat reservasi kedua (idempotensi `requestId` membantu, tetapi tidak menjamin waktu).
- **Keyakinan:** **TERBUKTI** untuk mekanisme Promise.race; apakah DB benar-benar menulis setelah 7 detik **KEMUNGKINAN BESAR** pada DB lambat/lock (**[ASUMSI]**).
- **Pemetaan framework:** Reliability (data integrity/UX).
- **Akar masalah (5 Whys):**
  1. Mengapa timeout tidak membatalkan? Karena hanya race, bukan cancellation.
  2. Mengapa? Karena tool API tidak menerima `AbortSignal`.
  3. Mengapa `save_reservation` berisiko? Karena ia menulis DB, bukan read-only.
  4. Mengapa tidak ada rekonsiliasi? Karena pipeline menganggap timeout = gagal tanpa cek status reservasi.
  5. Mengapa tidak tertangkap? Karena test tool tidak mensimulasikan promise yang selesai setelah timeout.
- **Risiko:** Ghost reservation / customer diberi info gagal; duplikasi saat retry; staff melihat reservasi yang tidak dikonfirmasi customer.
- **FMEA:** S=7, O=3, D=8 → **RPN 168**.
- **Collateral damage:** Menambahkan abort bisa memutus transaksi DB di tengah jalan; gunakan transaksi + idempotency + status `unknown`, bukan abort paksa tanpa rekonsiliasi.
- **Rekomendasi (fondasional):**
  1. Teruskan `AbortSignal` ke `executeSaveReservation`/`reservationCoreService` atau gunakan `Promise.race` + `finally` yang menandai status `PENDING_RECONCILIATION`.
  2. Pada timeout `save_reservation`, lakukan lookup `requestId` setelahnya; jika reservasi ada, jangan kirim pesan gagal, kirim status “sedang dicek”.
  3. Tambahkan idempotensi yang sudah ada (`requestId`) ke semua jalur tool.
- **Verifikasi:** Test `tool-timeout-side-effect.test.ts`: mock save resolve setelah 10 detik; assert pipeline menandai `PENDING_RECONCILIATION` dan tidak mengirim “gagal”; test retry dengan `requestId` sama tidak membuat baris kedua.

---

### A-012 — Fast gate image tanpa caption melewati triage dan memberi balasan statis “sudah disimpan untuk Bidan”

- **Tipe:** Vertikal (input media → fast gate → triage)
- **Lokasi:** `src/v3/agent/pipeline/fast-response-gate.ts:184-223`; `src/v3/agent/agent-runner.ts:216-276`; `src/routes/webhook.route.ts:776-865`.
- **Bukti:**
  - `FastResponseGate.check` menangani `isPureImageMessage` sebelum triage: `if (isPureImageMessage(cleanIncomingText)) { const staticPhotoReply = 'Terima kasih fotonya ... sudah kami terima dan simpan untuk panduan tim Bidan ...'; return { handled:true, ... } }` (`fast-response-gate.ts:184-223`).
  - Triage baru dijalankan setelah gate di `agent-runner.ts:257-276`; karena gate `handled:true`, triage tidak pernah melihat pesan image.
  - Tidak ada notifikasi staf pada cabang ini; media memang disimpan oleh webhook (`webhook.route.ts:776-865`), tetapi balasan statis tidak memicu `escalate_to_human`.
  - Test `fast-response-gate-schedule.test.ts:180-189` mengunci perilaku 0 token ini, bukan risiko klinisnya.
- **Keyakinan:** **TERBUKTI** untuk alur; relevansi klinis **KEMUNGKINAN BESAR** jika foto berisi ruam/cedera, tetapi tidak dapat dipastikan tanpa vision (**[ASUMSI]**).
- **Pemetaan framework:** Safety/Reliability; OWASP LLM09 (klaim “disimpan untuk Bidan” tanpa tindakan).
- **Akar masalah (5 Whys):**
  1. Mengapa foto tanpa caption tidak ditriase? Karena fast gate mengembalikan `handled` sebelum triage.
  2. Mengapa fast gate dibuat? Untuk menghemat token pada foto rumah/administratif.
  3. Mengapa tidak dibedakan? Karena tidak ada sinyal isi gambar; semua `[IMAGE]` dianggap sama.
  4. Mengapa tidak ada handoff? Karena cabang image tidak memanggil eskalasi/notifikasi.
  5. Mengapa tidak tertangkap? Karena test hanya menguji pesan `[IMAGE]` dibalas 0 token.
- **Risiko:** Customer mengirim foto kondisi darurat dan hanya mendapat balasan “tersimpan”; keterlambatan penanganan; ekspektasi bahwa tim sudah melihat.
- **FMEA:** S=6, O=4, D=7 → **RPN 168**.
- **Collateral damage:** Menaikkan semua image ke manusia akan membebani staf (foto rumah adalah alur umum). Solusi harus membedakan konteks (mis. state menunggu foto rumah vs keluhan) atau memberi pertanyaan klarifikasi.
- **Rekomendasi (fondasional):**
  1. Jika `session` tidak berada di alur “foto rumah/alamat” dan image tanpa caption, jangan kirim klaim “sudah disimpan untuk Bidan”; ajukan pertanyaan klarifikasi (“foto ini untuk keluhan atau rumah?”) atau eskalasi ringan.
  2. Tambahkan flag `imageIntent`/state `awaitingHousePhoto`; fast gate hanya boleh memakai template “foto rumah diterima” bila state tersebut aktif.
  3. Jika ada vision/OCR di masa depan, triase gambar; tanpa itu, jangan mengklaim penanganan medis.
- **Verifikasi:** Test `fast-response-gate-image-triage.test.ts`: `[IMAGE]` pada state awal → tidak boleh `handled` statis atau harus `isEscalated`/pertanyaan; `[IMAGE]` saat `awaitingHousePhoto` → template rumah; regresi `fast-response-gate-schedule`.

---

### A-013 — Komentar/kontrak dokumentasi bertentangan dengan perilaku runtime (sumber false-PASS)

- **Tipe:** Horizontal (dokumentasi/contract drift)
- **Lokasi:** `src/v3/agent/pipeline/phase-resolver.ts:47-49`; `src/v3/tools/tool-schemas.ts:20-21, 37-38, 55-56, 62-63, 76-77, 83-84`; `src/config/feature-flags.ts:14-20`; `tests/unit/v3/tool-masking-enforce.test.ts:8-10`; `src/v3/agent/pipeline/tool-pipeline.ts:974-979`.
- **Bukti:**
  - `phase-resolver.ts:47-49` menyatakan “Semua tool tetap dikirim di tools[] (tidak disembunyikan)”, padahal enforce mode mengirim `maskingEval.availableTools` (`generation-stage.ts:613`).
  - Schema `commitment` diberi komentar “belum dipakai keputusan” (`tool-schemas.ts:20-21, 37-38`), padahal `agent-runner.ts:428-433` memakainya untuk mengunci state.
  - Test `tool-masking-enforce.test.ts:8-10` menyatakan “default (shadow)”, padahal `feature-flags.ts:14-20` default enforce true.
  - Komentar `tool-pipeline.ts:974-979` menyatakan “agar state = RESERVATION_SENT, bukan COMPLETED”, padahal `phase-resolver.ts:141-143` menghasilkan COMPLETED.
- **Keyakinan:** **TERBUKTI**.
- **Pemetaan framework:** Operational Excellence — dokumentasi/kontrak.
- **Akar masalah (5 Whys):**
  1. Mengapa komentar tidak akurat? Karena perubahan enforce/commitment/state tidak diikuti pembaruan komentar.
  2. Mengapa tidak diikuti? Karena tidak ada test yang membaca kontrak komentar/dokumentasi.
  3. Mengapa berbahaya? Karena auditor/reviewer bisa menyimpulkan PASS dari komentar, bukan kode.
  4. Mengapa tidak ada gate? Karena gate hanya menguji perilaku, bukan konsistensi dokumentasi.
  5. Mengapa dibiarkan? Karena dianggap non-fungsional.
- **Risiko:** False confidence pada audit berikutnya; developer salah memahami default mode; regresi tidak terdeteksi.
- **FMEA:** S=3, O=10, D=3 → **RPN 90**.
- **Collateral damage:** Tidak ada runtime; perubahan hanya dokumentasi/komentar/test description.
- **Rekomendasi:** Perbarui komentar/konstanta agar selaras; gunakan `isToolMaskingShadowMode` atau hapus; ubah komentar schema `commitment` menjadi “dipakai untuk latch, wajib divalidasi user”; perbaiki test description. Tambahkan checklist PR: perubahan mode harus memperbarui komentar dan test description.
- **Verifikasi:** `rg` tidak menemukan kalimat kontradiktif; review manual; `npm run build` (tidak ada perubahan runtime).

---

## 5. Rencana Perbaikan Berurutan

> Urut berdasarkan RPN dan dependensi. Setiap fase wajib ditutup `npm run build` + suite relevan hijau + full suite tanpa failure baru. Klaim “pre-existing failure” wajib dibuktikan dengan revert-and-rerun.

| Fase | Temuan | Tindakan fondasional | Rollback | Regression gate |
|---|---|---|---|---|
| **1** | **A-003** | Ubah `evaluateScreeningAnswer` menjadi tri-state (unsafe > safe; syarat waktu DAN bebas demam), tambah `feverSuspected` non-numerik, ambil ambang dari `ClinicPolicy`. | Revert `medical-signal-detector.ts`; feature flag `TRIAGE_STRICT_SCREEN` jika perlu. | `v3-triage-gate`, `vaccine-sop-flow`, `medical-*`; test konflik sinyal. |
| **2** | **A-001, A-002** | Tambah `allowedToolNames`/`trustedInternalCalls` di `ToolExecutionPipeline`; filter DSML salvage; hapus `commitment` dari schema umum; satu seam `applyUserCommitmentSignal` dengan validasi pesan user; test adversarial. | Revert `tool-pipeline.ts`, `generation-stage.ts`, `tool-schemas.ts`, `agent-runner.ts`; env `TOOL_EXEC_AUTHZ_ENFORCE=false`/`COMMITMENT_DETERMINISTIC_ONLY=false`. | `tool-masker`, `tool-pipeline`, `booking-commit-gate`, `v3-conversation-matrix`; test DSML + “cara booking”. |
| **3** | **A-004, A-007** | Tambah `verifiedTreatmentNames` + `locationPrecision`; `save_reservation` menolak nama/lokasi yang tidak terverifikasi; perketat `specificTreatmentName` (nama penuh/alias, bukan satu token). | Revert tool contract; data lama tetap terbaca (`precision` fallback ke kelurahan/kecamatan). | `treatment-identity-contract`, `location-precision-contract`, `v3-cart-*`, `get-catalog-*`. |
| **4** | **A-005** | Pisahkan `ConversationState` dari `ReservationStatus`; `COMPLETED` hanya jika `isConfirmed`/status completed; pending → `RESERVATION_SENT`; perbarui test C2 dan AI scope. | Revert `phase-resolver.ts`; tidak ada migrasi. | `reservation-completed-state`, `ai-scope-gate`, `conversation-state-*`. |
| **5** | **A-006** | Sanitasi semua entri `role:'user'` di boundary prompt (history + current); netralkan pola injeksi (bukan hanya flag); indirect injection assistant/tool. | Revert `prompt-injection-sanitizer.ts`/`agent-runner.ts`; sanitasi hanya di memori. | `prompt-injection-sanitizer`, test dua turn, `v3-conversation-matrix`. |
| **6** | **A-008, A-009** | Satu seam `finalizeOutboundReply` setelah semua append; alirkan `tenantId` ke masker/tool; gunakan `getBrandIdentityAsync`; hapus brand literal. | Revert `guardrail-pipeline.ts`/`tool-masker.ts`/`brand` wiring; flag `FINAL_OUTPUT_NORMALIZER`. | `guardrail-final-normalizer`, `tenant-context-v3`, `v3-sanitizer-*`. |
| **7** | **A-010, A-011** | Resolve endpoint dari provider task (bukan hanya provider aktif); circuit breaker/fallback per tenant; catat `__actualBaseUrl`; cost per call; abort/rekonsiliasi timeout `save_reservation`. | Revert `llm-gateway.ts`/`generation-stage.ts`/`tool-pipeline.ts`; fallback ke konfigurasi lama. | `llm-endpoint-config`, `tool-timeout-side-effect`, `cost-calculator`; test multi-tenant. |
| **8** | **A-012, A-013** | Bedakan image “foto rumah” vs image bebas; jangan klaim “disimpan untuk Bidan” tanpa handoff; perbarui komentar/kontrak dan test description. | Revert `fast-response-gate.ts`; tidak ada migrasi. | `fast-response-gate-image-triage`, `fast-response-gate-schedule`; review dokumentasi. |

**Catatan dependensi:** Fase 1 (klinis) tidak bergantung pada fase lain dan harus didahulukan karena risiko keselamatan. Fase 2 dan 3 berbagi seam tool/booking; jangan dikerjakan paralel tanpa koordinasi. Fase 4 menyentuh state machine yang dipakai Fase 2/3; lakukan setelah tool contract stabil. Fase 5–8 bersifat independen dan bisa dipecah PR terpisah.

---

## 6. Batasan & Asumsi

1. **Tidak ada akses DB produksi.** Semua angka/klaim dampak adalah analisis kode; jumlah reservasi salah, customer yang terkena, dan nilai `contraindications`/`requires_screening` tidak diukur. Ini berlaku terutama untuk A-003, A-007, dan A-009.
2. **Tidak ada log produksi.** Frekuensi DSML, fallback, reprompt, dan “cara booking” tidak dihitung. Klaim “KEMUNGKINAN BESAR” adalah penilaian kode + insiden terdokumentasi, bukan statistik.
3. **Tidak ada test/build yang dijalankan.** Semua verifikasi di §4 dan §5 adalah rencana. Status hijau/merah tidak diklaim.
4. **A-007 [ASUMSI]:** diasumsikan geocoding kota luas dapat mengembalikan `kota` dengan `isPrecise:false`/centroid. Perlu verifikasi staging dengan input “Surabaya”/“Sidoarjo” dan cek session `location`.
5. **A-003 [ASUMSI]:** nilai `contraindications` dan `requires_screening` per layanan di DB produksi tidak diketahui. Bahkan tanpa nilai DB, bug OR pada skrining pasca-vaksin tetap terbukti.
6. **A-006 [ASUMSI]:** eksploitasi lintas turn bergantung pada kecenderungan model mengikuti instruksi lama; tidak diuji dengan LLM nyata. Namun teks injeksi memang tidak disanitasi.
7. **A-009 [ASUMSI]:** dampak penuh hanya terlihat di deployment multi-tenant; deployment saat ini dapat berjalan dengan default tenant.
8. **A-011 [ASUMSI]:** apakah `save_reservation` benar-benar selesai setelah timeout bergantung pada latensi DB/lock; mekanisme race-nya terbukti.
9. **A-012 [ASUMSI]:** isi gambar tidak dianalisis; temuan adalah “tidak ada triase/handoff untuk image tanpa caption”, bukan diagnosis gambar.
10. **Tidak mengaudit RAG/retrieval dan teks prompt** (Bagian B); temuan prompt hanya pada kontrak kode yang bisa dibuktikan.
11. **Tidak mengaudit ulang Modul 4/6**; referensi reservasi/live chat hanya untuk dampak silang.
12. **`docs/KNOWN_ISSUES.md` dibaca selektif** pada heading/bagian relevan; tidak seluruh 892 KB.
13. **Tidak membaca `.env`** atau nilai kredensial; konfigurasi produksi (`TOOL_MASKING_ENFORCE`, provider aktif, fallback env) tidak diverifikasi.
14. **Tidak ada klaim “PASS”** untuk area yang tidak diuji. Klaim lama yang diverifikasi ulang dinyatakan PASS/PARSIAL hanya berdasarkan bukti kode yang dikutip.

---

## 7. Tahap 6 — Status Verifikasi

- **Belum dieksekusi** karena audit baca-saja.
- Rencana test per temuan tercantum pada masing-masing §4.
- Urutan eksekusi dan rollback ada di §5.
- Setelah perbaikan dijalankan, wajib:
  1. `npm run build` (backend) exit 0.
  2. Test file terkait + suite `v3-*`, `tool-*`, `medical-*`, `prompt-injection-*` hijau.
  3. Full suite tanpa failure baru; kegagalan yang diklaim pre-existing dibuktikan dengan revert-and-rerun.
  4. Audit log produksi (`logs/llm-*.jsonl`) untuk memastikan event baru (`TOOL_EXECUTION_BLOCKED_BY_MASK`, `COMMITMENT_AUTHORITY_REJECTED`, `TRIAGE_SIGNAL_CONFLICT`) muncul sesuai harapan.
