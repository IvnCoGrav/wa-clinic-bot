# Laporan Audit Deep-Dive — Modul 3 Bagian B: RAG/Retrieval, Sumber Data Klinis, Prompt Assembly & Persona

> **Tanggal audit:** 2026-11-07  
> **Mode:** BACA-SAJA. Tidak ada kode/test/config/.env yang diubah; server tidak dijalankan; DB/WAHA/Meta tidak dipanggil; tidak ada deploy.  
> **Repo:** `C:\Users\Ivan\.gemini\antigravity\scratch\wa-clinic-bot` (HEAD `8c6ee2ea`, 2026-11-06)  
> **Di luar cakupan:** Modul 4 (Reservasi), Modul 6 (Live Chat), dan Bagian A (tool masking/state machine) — tidak diaudit ulang. Titik temu RAG dengan tool tetap diperiksa.  
> **Auditor:** subagent audit (DeepSeek V4.1 Flash)

---

## 1. Ringkasan Eksekutif

RAG chatbot ini **bukan RAG semantik**: tidak ada embedding/vector store, dan retrieval sepenuhnya mengandalkan PostgreSQL Full-Text Search (`simple`, tanpa stemming Indonesia) plus fallback trigram. Pada 200 percakapan Call 2 yang tersedia di log, hanya **65/200 (32,5%)** yang mendapat blok knowledge pra-retrieval; **16/55 (29,1%)** pertanyaan SOP/klinis tidak mendapat konteks knowledge maupun tool kebijakan sama sekali. Kualitas korpus juga tercela: cuplikan percakapan seperti **“Nanti saya info lagi”** masuk sebagai artikel FAQ dan benar-benar ter-retrieve (similarity 0,4375) untuk pertanyaan **“Lagi kena bapil”**.

Ditemukan **12 temuan**: **4 KRITIS, 5 TINGGI, 3 SEDANG**. Tiga prioritas perbaikan: **(1) hentikan jawaban klinis tanpa landasan** — rapikan jalur RAG-miss dan guardrail D3 yang saat ini menerima chunk katalog sebagai “SOP” (C-006), serta kontradiksi SOP vaksinasi “boleh langsung” vs “dilarang langsung” (C-005); **(2) perbaiki fondasi retrieval & korpus** — query rewriting, rank/IDF, dedupe, dan pemisahan artikel klinis dari cuplikan chat (C-001, C-002); **(3) lindungi prompt dari degradasi konfigurasi** — jalur 4-Section dari DB menghapus lapisan guardrail kode dan masih tenant-blind (C-004, C-010).

Kesimpulan singkat: **arsitektur tool dan guardrail deterministik sudah kuat, tetapi kualitas RAG, kebersihan knowledge base, dan integritas prompt belum layak disebut “grounded”**. Tidak ada persentase halusinasi yang bisa diklaim dari sampel ini karena tidak ada golden dataset dan tidak ada penilaian LLM-as-judge (lihat §7).

---

## 2. Profil Chatbot & Cakupan

### 2.1 Tujuan dan arsitektur

| Aspek | Isi |
|---|---|
| Tujuan | Chatbot WhatsApp klinik homecare ibu & bayi (“Bidan Yusi”, Kala Moms and Baby Spa): konsultasi keluhan, rekomendasi terapi, harga/katalog, kebijakan klinik, dan reservasi. |
| Tipe | **RAG leksikal + tool-augmented + 2-stage LLM**. Bukan vector RAG. |
| Model | Log menunjukkan `deepseek-v4-1-flash` (aktual), temperature Call 2 = 0,65 (`src/v3/agent/pipeline/generation-stage.ts:986`). |
| Call 1 | Router tool-calling, prompt ~0,8–1,2k token (`prompt-composer.ts:216-233`). |
| Call 2 | Generator persona, prompt **38.978–52.013 karakter** (p50 44.963) pada 200 log. |
| Retrieval | PostgreSQL `websearch_to_tsquery`/`plainto_tsquery` + `ts_rank` + `pg_trgm` `word_similarity` (`src/services/knowledge.service.ts:188-356`). Tidak ada embedding, reranker, atau query rewriting. |
| Sumber data | `knowledge_chunks` (48 artikel korpus), `clinic_services` (42 layanan), `clinic_policies` (7 topik + fallback statis), `tenant_prompt_configs` (4 seksi), `few_shot_exemplars`. |
| Guardrail | Validator numerik, validator klaim faktual (D1–D10), sanitizer, tool masking, triage gate, pronoun/format normalizer. |
| Tool | 6 tool: `calculate_delivery`, `get_catalog_and_price`, `save_reservation`, `escalate_to_human`, `get_clinic_policy_faq`, `search_knowledge_faq`. |

### 2.2 Framework (Tahap 0) dan alasan

| Framework | Alasan | Dipakai untuk |
|---|---|---|
| **audit-chatbot-llm (RAGAS-like)** | Menilai faithfulness/groundedness, answer relevancy, context precision/recall, correctness, refusal, format. | C-001, C-002, C-006, C-011 |
| **OWASP Top 10 for LLM Applications** | RAG + prompt + tool + data yang dapat diedit admin = permukaan LLM01/LLM04/LLM06/LLM07/LLM09. | C-002, C-006, C-008, C-009, C-010 |
| **AWS Well-Architected** | Security, Reliability, Operational Excellence, Performance, Cost. | C-001, C-004, C-009, C-012 |
| **FMEA (S × O × D = RPN)** | Prioritas kuantitatif; S=9 untuk rekomendasi terapi salah / kebocoran system prompt / keselamatan klinis. | Semua temuan |

### 2.3 Metode Tahap 0–6

- **Tahap 0** — framework dipilih (tabel 2.2).
- **Tahap 1** — membaca `docs/KNOWN_ISSUES.md`, `docs/audit/2026-11-02/fase-03/LAPORAN_FASE_03.md`, `LAPORAN_VERIFIKASI_ULANG.md`, serta laporan sibling Modul 10 dan Modul 1/11 agar tidak menduplikasi temuan.
- **Tahap 2** — inventaris komponen RAG/prompt + sampel log. Sampel: **1.710 record LLM** (744 routing, 200 generation, 53 reprompt, 63 agent, 650 NLU), rentang **2026-09-16 s/d 2026-10-06**, tenant `default-tenant`.
- **Tahap 3** — audit horizontal: semua jalur retrieval, semua sumber data klinis, semua pemanggil prompt, semua tool yang membawa knowledge.
- **Tahap 4** — audit vertikal 4 alur: (a) “Lagi kena bapil” → retrieval salah → jawaban; (b) “Batuk sudah 2 minggu” → tidak ada red flag → rekomendasi pijat; (c) sesi `c4025b9a…` (tummy time/kepala peyang) → rekomendasi bergeser ke Pijat Lahap; (d) pertanyaan vaksinasi → policy vs safety prompt.
- **Tahap 5** — FMEA, blast radius, pre-mortem, urutan perbaikan.
- **Tahap 6** — verifikasi kode + 8 file test relevan (37 test, semuanya hijau; lihat §7).

### 2.4 Celah cakupan (eksplisit)

1. **Log terbaru 2026-10-06**, yaitu 32 hari sebelum tanggal audit. Tidak ada bukti perilaku setelah 2026-10-06; semua perubahan kode 2026-11-06 tidak tercakup log.
2. **Hanya `default-tenant`** yang muncul di log. Perilaku tenant lain tidak dapat diukur.
3. **Tidak ada akses DB/server produksi**. Isi `knowledge_chunks`, `clinic_policies`, `tenant_prompt_configs` produksi, dan status migrasi #81 tidak diverifikasi langsung.
4. **Log hanya menyimpan output Call 2 sebelum guardrail** (`generation-stage.ts:1053-1070`). Format/jawaban yang benar-benar diterima pelanggan tidak dapat diukur dari log LLM.
5. **Tidak ada golden dataset RAG** dan tidak ada LLM-as-judge; evaluasi berbayar bersifat manual (#273). Karena itu tidak ada klaim “tingkat halu X%”.
6. **Tidak ada red teaming runtime** (curl/Burp/WhatsApp live); temuan keamanan berbasis kode dan log.
7. **Tidak ada `npm run build` / full suite**; hanya 8 file test RAG/prompt yang dijalankan (lihat §7). Test RAG berjalan dengan DB offline (mock), sehingga **tidak menguji SQL/ts_rank sebenarnya**.
8. **UI dashboard tidak diuji di browser**; temuan prompt-config berbasis kode + test API.

---

## 3. Hasil Metrik per Kategori

> Tidak ada penilaian faithfulness/correctness formal. Angka di bawah adalah **proxy retrieval dan kepatuhan kontrak**, bukan skor RAGAS. Ukuran sampel dicantumkan.

| Kategori | n | Metrik yang bisa dihitung | Hasil | Catatan |
|---|---:|---|---|---|
| Retrieval pre-grounding | 200 turn | Blok knowledge hadir | **65/200 = 32,5%** | 47/143 (32,9%) pada 09-25; 10/36 (27,8%) pada 09-26; 0/3 pada 10-06 |
| Retrieval via tool | 200 turn | `search_knowledge_faq` dipanggil | **21/200 = 10,5%** | 132/200 memanggil katalog; 31/200 policy; 17/200 delivery |
| Knowledge chunk (gabungan) | 200 turn | Ada chunk knowledge nyata | **74/200 = 37%** | 45/200 tidak punya chunk sama sekali |
| Context precision (sampel pra-fix) | 6 blok / 16 chunk | Chunk relevan secara manual | **6/16 = 37,5%** | Contoh: “ke bungurasih berapa” → 0/3 relevan |
| Context precision (sampel pasca-fix) | 4 blok / 10 chunk | Chunk relevan secara manual | **9/10 = 90%** | Sampel sangat kecil; 1 chunk sampah “Nanti saya info lagi” |
| Context recall (SOP/klinis) | 55 pertanyaan | Ada knowledge/policy/pre-KB | **39/55 = 70,9%** | **16/55 (29,1%)** hanya katalog/delivery, tanpa knowledge/policy |
| Similarity chunk | 181 chunk | p25 / p50 / p90 | **0,425 / 0,472 / 0,667** | 25 chunk <0,25 hanya pada 09-16/18 (pra-fix); semua chunk pasca-fix ≥0,35 |
| Harga/faithfulness proxy | 25 balasan ber-“Rp” | Ada tool harga/delivery di turn | **25/25 = 100%** | Tidak ada kebocoran harga tanpa tool pada sampel; ini bukan faithfulness penuh |
| Rekomendasi klinis | 132 panggilan katalog | `specificTreatmentName` diisi | **27/132** | 1/27 jelas berasal dari riwayat, bukan pesan saat ini (C-007) |
| Format (mentah, pra-guardrail) | 200 balasan | >3 kalimat / >2 “Bunda” | **80/200 / 144/200** | **Bukan** pelanggaran terkirim; guardrail memotong/menormalkan setelah log |
| Refusal/unknown | 200 | Metrik formal | Tidak diukur | Ada lisensi “jawab dari pengetahuan umum” saat RAG miss (C-006) |
| Keamanan injection | 0 red-team | Uji runtime | Tidak dilakukan | Hanya audit kode (C-008) |

**Catatan penting:** 200 record V3_GENERATION di log adalah **output Call 2 sebelum guardrail**. Karena itu angka format di atas tidak boleh dibaca sebagai “pelanggaran yang diterima pelanggan”. Guardrail `cleanOutboundReply` baru dijalankan setelahnya (`src/v3/agent/agent-runner.ts:549`).

---

## 4. Status Temuan Lama (Tahap 1)

| ID / Sumber | Temuan | Status lama | Verifikasi 2026-11-07 |
|---|---|---|---|
| **Fase 03 · 3.3** | Clinical dominance gejala + isolasi `specificTreatmentName` PASS | PASS | **PASS DENGAN CATATAN.** Guard clinical dominance ada (`src/v3/tools/get-catalog.tool.ts:424-465`), tetapi kontrak nama masih bisa diisi dari riwayat (C-007) dan rekomendasi pra-grounding diberi MANDAT (C-003). |
| **#29** | RAG in-memory fallback memakai `includes` + over-match | OPEN sebagian | **MASIH TERBUKA.** `knowledge.service.ts:338-352` masih `text.includes(kw)`; tidak ada relevance gate untuk fallback memori. |
| **#31** | Hybrid RAG tech debt (multi-audience) | OPEN | **MASIH TERBUKA.** Tidak ada embedding/vector; `schema.prisma:271-283` tidak punya kolom embedding; pre-retrieval hanya untuk pesan yang lolos daftar kata kunci. |
| **#34** | Keyword enrichment KB | RESOLVED | **SELESAI untuk mekanisme.** Korpus sekarang 48 pertanyaan; deskripsi tool masih menyebut “47 artikel” (`search-knowledge-faq.tool.ts:30`) → drift metadata kecil (C-002). |
| **#46** | Drift live vs seed RAG | RESOLVED | **Tidak diverifikasi live.** Tidak ada akses DB; status hanya dari catatan. |
| **#81** | Tabel `clinic_policies` & `tenant_prompt_configs` tidak ada di DB produksi | OPEN (deployment gap) | **PERLU VERIFIKASI ULANG.** Migrasi ada di repo (`prisma/migrations/20260917000001_...`), laporan 2026-11-03 menyebut 100 migrasi terpasang, tetapi tidak ada bukti langsung tabel terisi. Jika kosong, seluruh policy jatuh ke fallback statis (C-005). |
| **#97** | RAG rank threshold 0,25 | RESOLVED (kode) | **PERLU VERIFIKASI ULANG.** Ambang 0,25 ada (`knowledge.service.ts:207,232,266,294`), tetapi tidak dikalibrasi terhadap skala `ts_rank` nyata; test memakai rank sintetis 0,61/0,72 (`tests/unit/knowledge-search.test.ts:17-26`). Lihat C-001. |
| **#130** | Kebocoran artefak instruksi RAG | RESOLVED | **SELESAI.** `stripInternalInstructionArtifacts` ada (`sanitizer.ts:49-64`); 0 balasan log mengandung header artikel/instruksi internal. |
| **#272** | Persona 4-Section dashboard | RESOLVED | **SELESAI untuk fitur**, tetapi menimbulkan risiko baru: jalur DB menggantikan prompt berlapis (C-004). |
| **#273** | Eval LLM berbayar manual-only | OPEN | **MASIH TERBUKA.** Tidak ada evaluasi RAG otomatis; angka faithfulness tidak tersedia. |
| **#301** | Test pre-existing di luar gate fase | OPEN (2 sisa) | **Tidak terkait RAG.** 8 file test RAG/prompt yang dijalankan hijau, tetapi berjalan DB-offline (mock), bukan validasi FTS. |
| **#302** | Label fase audit tertukar | RESOLVED | **SELESAI.** Konfirmasi: tidak ada gate “RAG Klinis” kanonis; RAG memang belum pernah punya gate khusus. |
| **Cfg-002** (Modul 10) | Edit/hapus knowledge chunk tanpa predikat tenant | OPEN | **Dirujuk, tidak diduplikasi.** C-002/C-012 fokus pada kualitas & persistensi isi, bukan IDOR. |
| **Cfg-005 / Cfg-006** (Modul 10) | SOP/jam/area/pembayaran & katalog 42 layanan hardcode | OPEN | **Dirujuk, tidak diduplikasi.** C-005 hanya menambah kontradiksi vaksinasi yang belum tercatat. |
| **Cfg-012 / Ar-003** (Modul 10/1) | Handler default-tenant & isolasi tenant tidak konsisten | OPEN | **Dirujuk.** C-010 adalah manifestasi spesifik di prompt assembly (bukan route). |

---

## 5. Daftar Temuan

### Ringkasan FMEA

| ID | Judul singkat | S | O | D | RPN | Severity |
|---|---|---:|---:|---:|---:|---|
| C-006 | RAG-miss lisensi jawaban umum + D3 menerima chunk katalog sebagai grounding | 9 | 6 | 7 | **378** | KRITIS |
| C-001 | Retrieval leksikal tanpa query rewriting/rerank; rank gate & index tidak selaras | 8 | 7 | 6 | **336** | TINGGI |
| C-002 | Korpus knowledge terkontaminasi cuplikan chat & duplikat | 8 | 7 | 5 | **280** | TINGGI |
| C-009 | Log LLM: prompt penuh + PII, hanya pra-guardrail, tanpa retensi | 6 | 8 | 5 | **240** | SEDANG |
| C-004 | Jalur prompt 4-Section DB menghapus guardrail kode & brand tenant | 9 | 3 | 7 | **189** | KRITIS |
| C-003 | Rekomendasi pra-grounding diberi MANDAT, menimpa clinical dominance | 9 | 4 | 5 | **180** | KRITIS |
| C-008 | Prompt injection: deteksi tanpa penegakan; riwayat & KB tidak diisolasi | 8 | 3 | 7 | **168** | TINGGI |
| C-011 | Tidak ada red flag batuk kronis ≥14 hari; RAG tidak menarik artikel bapil | 9 | 3 | 6 | **162** | TINGGI |
| C-012 | Import FAQ/dokumen “sukses” walau DB gagal (fallback memori) | 7 | 3 | 7 | **147** | SEDANG |
| C-005 | SOP vaksinasi kontradiktif; jalur SCREEN deterministik bisa kirim “boleh langsung” | 9 | 4 | 4 | **144** | KRITIS |
| C-010 | Prompt assembly tenant-blind (katalog default tenant, brand Call 2) | 8 | 3 | 6 | **144** | TINGGI |
| C-007 | `specificTreatmentName` dapat diisi dari riwayat | 7 | 4 | 4 | **112** | SEDANG |

> Urutan tabel = RPN. C-003, C-004, C-005, C-006 tetap **KRITIS** karena S=9 (rekomendasi terapi salah / guardrail klinis hilang).

---

### C-006 — RAG-miss memberi lisensi menjawab dari pengetahuan umum; guardrail D3 menganggap chunk katalog sebagai “SOP”

- **Tipe:** Vertikal (RAG → prompt → guardrail) / Horizontal (semua pertanyaan klinis yang tidak ter-retrieve).
- **Lokasi:** `src/v3/agent/pipeline/context-grounder.ts:532`, `:545`; `src/v3/tools/search-knowledge-faq.tool.ts:72-83`; `src/v3/guardrails/factual-claim-validator.ts:307-309`, `:439-459`; `src/v3/agent/pipeline/tool-pipeline.ts:822-835`; `src/v3/agent/pipeline/guardrail-pipeline.ts:574`.
- **Bukti:**
  - Saat tidak ada chunk, prompt berbunyi: *“Tidak ditemukan artikel spesifik untuk pertanyaan ini. Jawab berdasarkan informasi umum yang terverifikasi dan jangan mengarang informasi klinis di luar kewenangan.”* (`context-grounder.ts:532`). Tool search juga menyuruh: *“berikan penjelasan edukatif komplementer umum … berdasarkan prinsip kebidanan”* (`search-knowledge-faq.tool.ts:82`).
  - `hasSubstantiveChunks()` hanya memeriksa `content.trim().length > 20` (`factual-claim-validator.ts:307-309`). Chunk katalog yang selalu disisipkan oleh `tool-pipeline.ts:822-835` (`“[Katalog Layanan] …”`, `similarity: 1.0`) otomatis memenuhi syarat.
  - 132/200 turn memanggil `get_catalog_and_price`; artinya pada mayoritas turn D3 “sudah ter-grounding” hanya karena ada chunk katalog.
  - Contoh log: `2026-09-26T09:36:36.892Z`, input tentang tummy time/kepala peyang, hanya tool katalog, tanpa knowledge/policy; balasan memberi anjuran klinis (“masih bisa dibantu stimulasinya”) — D3 tidak mungkin menolak karena chunk katalog dianggap grounding.
- **Titik kegagalan:** konteks (RAG miss) → prompt (lisensi jawaban umum) → guardrail (D3 false positive).
- **Akar masalah (5 Whys):**
  1. Mengapa jawaban klinis tanpa artikel tetap lolos? Karena prompt mengizinkan jawaban dari pengetahuan umum saat RAG miss.
  2. Mengapa guardrail tidak menangkap? Karena D3 memakai `retrievedChunks` yang juga berisi observability katalog.
  3. Mengapa katalog masuk `retrievedChunks`? Karena dipakai untuk Inspector/ground truth, bukan dipisahkan berdasarkan sumber.
  4. Mengapa tidak ada pemisahan sumber? `V3RetrievedChunk` tidak punya field `source`/`isKnowledge`.
  5. Mengapa RAG miss tidak dieskalasi? `emptyKnowledgeResult` di `ContextGrounder` selalu `false` (`:545`), jadi jalur “unresolved FAQ” tidak aktif.
- **Keyakinan:** **TERBUKTI** untuk invariant kode; **KEMUNGKINAN BESAR** untuk dampak klinis (belum ada label dokter).
- **Framework:** OWASP LLM09 (Overreliance), LLM07 (tool output sebagai instruksi); Well-Architected Reliability/Security.
- **FMEA:** S=9 (anjuran klinis tanpa dasar), O=6 (132/200 turn katalog), D=7 (tidak ada monitor D3) = **378**.
- **Collateral damage:** Mengetatkan D3 bisa memicu re-prompt berlebihan pada jawaban yang sah berbasis katalog (mis. menjelaskan manfaat layanan). Perlu pemisahan eksplisit “deskripsi layanan” vs “SOP klinis”, bukan melarang semua jawaban katalog.
- **Rekomendasi fondasional:**
  1. Tambah `source: 'knowledge' | 'policy' | 'catalog'` pada `V3RetrievedChunk`; D3 hanya menerima `knowledge`/`policy`.
  2. Pisahkan observability katalog dari grounding klinis (array berbeda).
  3. Untuk intent klinis/SOP, RAG miss harus menghasilkan **gerbang kode**: jawab terbatas (“belum ada panduan resmi, kami konfirmasi ke Bidan”) atau eskalasi — bukan lisensi “jawaban umum”.
  4. Propagasikan `emptyKnowledgeResult` dari pre-grounding, bukan hardcode `false`.
- **Verifikasi:** test baru: (a) turn katalog-only + kalimat “sebaiknya mandikan setiap hari” → D3 violation; (b) turn dengan chunk knowledge asli → lolos; (c) RAG miss pada pertanyaan vaksin → eskalasi/limited answer, bukan jawaban bebas; (d) `emptyKnowledgeResult=true` muncul di telemetry saat 0 chunk.

---

### C-001 — Retrieval masih leksikal, memakai pesan mentah, tanpa query rewriting/rerank; rank gate dan index tidak selaras

- **Tipe:** Horizontal (semua retrieval) / Vertikal (pertanyaan → query → chunk → prompt).
- **Lokasi:** `src/services/knowledge.service.ts:188-356`; `src/v3/agent/pipeline/context-grounder.ts:499-535`; `src/v3/agent/pipeline/medical-signal-detector.ts:287-316`; `prisma/migrations/20260808120000_add_knowledge_chunks_fts_gin_index/migration.sql:6`; `prisma/migrations/20260925000000_add_pg_trgm_and_trigram_indexes/migration.sql:10-11`.
- **Bukti:**
  - Tier 1 memakai `websearch_to_tsquery('simple', ${queryToSearch})` dengan query = **pesan customer mentah** (`context-grounder.ts:503`), bukan query yang ditulis ulang dari konteks. `websearch_to_tsquery` menggabungkan kata dengan AND; kalimat panjang menuntut semua kata ada di satu chunk.
  - Tier 4 (`word_similarity`) **tidak punya gate token substantif** (komentar kode sendiri: “Gate DISENGAJA tanpa cek token-eksak”, `knowledge.service.ts:279-283`). Akibatnya satu kata umum bisa menang.
  - Bukti log paling jelas: `2026-09-25T14:46:35.037Z`, input **“Lagi kena bapil”** → `retrievedChunks[0]` = artikel **“Nanti saya info lagi”** (`similarity 0,4375`), lalu prompt menampilkannya sebagai `Artikel 1 — Nanti saya info lagi`. Artikel bapil yang benar tidak terambil.
  - `2026-09-18T13:08:17.287Z`, input “kalau ke bungurasih berapa” → 3 artikel: durasi pijat, booking usia, durasi pijat; **0 relevan**.
  - 65/200 (32,5%) turn punya blok knowledge; 16/55 (29,1%) pertanyaan SOP/klinis tidak punya knowledge/policy sama sekali.
  - `isSubstantiveForPreGrounding` adalah **daftar kata kunci hafalan** (`medical-signal-detector.ts:294-315`), melanggar mandat anti-hafalan; parafrase di luar daftar tidak memicu retrieval.
  - Index FTS dibuat untuk `to_tsvector('simple', content)` saja, sedangkan query memakai `to_tsvector('simple', title || ' ' || keywords || ' ' || content)` — ekspresi berbeda, sehingga index FTS tidak bisa dipakai untuk query tersebut. Index trigram memakai ekspresi teks yang sama, tetapi query memakai fungsi `word_similarity(...) > 0.4`, bukan operator `%>`; potensi seq-scan. Komentar migrasi “agar index terpakai operator %” tidak sesuai dengan query aktual.
  - Test RAG memakai `$queryRaw` mock dengan rank sintetis 0,61/0,72 (`tests/unit/knowledge-search.test.ts:17-33`); test `knowledge.test.ts` berjalan DB-offline dan menguji fallback memori, bukan `ts_rank` nyata.
- **Titik kegagalan:** retrieval (query formulation, rank calibration, index).
- **Akar masalah (5 Whys):**
  1. Mengapa artikel bapil tidak terambil? Query “lagi kena bapil” menuntut semua kata; tier trigram menganggap “lagi” cukup.
  2. Mengapa query memakai pesan mentah? `ContextGrounder.ground` tidak punya query rewriter / perluasan konteks.
  3. Mengapa tidak ada query rewriter? Desain awal memilih FTS murah; belum ada embedding/LLM query rewrite.
  4. Mengapa rank 0,25 diterima? Kalibrasi dilakukan terhadap noise 0,030 tanpa uji distribusi `ts_rank` nyata.
  5. Mengapa tidak terdeteksi? Tidak ada metrik recall/precision RAG di produksi; test memakai rank sintetis.
- **Keyakinan:** **TERBUKTI** untuk gejala (65/200, kasus “lagi kena bapil”); **KEMUNGKINAN BESAR** untuk skala `ts_rank`/index (perlu `EXPLAIN` di DB salinan).
- **Framework:** RAG context precision/recall; Well-Architected Performance/Reliability; OWASP LLM04 (data/retrieval quality).
- **FMEA:** S=8 (SOP terlewat), O=7 (29% SOP ungrounded), D=6 (tanpa monitor) = **336**.
- **Collateral damage:** Query rewriting/embedding menambah biaya & latensi; menaikkan threshold dapat menurunkan recall; menurunkan threshold menambah noise. Wajib diuji dengan golden retrieval set, bukan perasaan.
- **Rekomendasi fondasional:**
  1. Pisahkan query retrieval dari pesan mentah: gunakan **query rewriting deterministik** (intent + entitas dari state) atau LLM query rewrite ringan; sertakan 1–2 turn konteks untuk “itu/berapa lama”.
  2. Ganti gate “satu token umum” dengan **IDF/token-coverage**: minimal 1 token langka (bukan stopword) harus cocok; atau migrasi ke embedding + pgvector/reranker (butuh Confirmation Gate karena infrastruktur).
  3. Selaraskan index: buat GIN FTS pada ekspresi yang **sama persis** dengan query (`title || keywords || content`), dan gunakan operator `%>`/`<%` agar index trigram terpakai; ukur `EXPLAIN ANALYZE`.
  4. Tambah **golden retrieval set 50–200 pertanyaan nyata** (parafrase, typo, slang, multi-turn) + metrik recall@3/precision@3; jalankan sebelum/sesudah.
  5. Ganti `isSubstantiveForPreGrounding` daftar hafalan dengan sinyal state/intent yang lebih umum; jika tetap perlu gate, ambang panjang pesan + hasil klasifikasi, bukan daftar kata.
- **Verifikasi:** (a) query “lagi kena bapil” → top-3 harus artikel bapil, bukan “Nanti saya info lagi”; (b) 30 parafrase “batuk pilek/bapil/ngorok” → recall@3 ≥ target yang disepakati; (c) `EXPLAIN` menunjukkan index FTS/trigram terpakai; (d) distribusi `ts_rank` nyata pada 100 query → kalibrasi ulang ambang; (e) test regresi “chunk sampah tidak muncul”.

---

### C-002 — Korpus knowledge terkontaminasi cuplikan chat dan duplikat; metadata jumlah artikel drift

- **Tipe:** Horizontal (data) / Vertikal (seed → DB → retrieval → prompt).
- **Lokasi:** `src/cli/faq-corpus.ts:173-179`; `scripts/sync-live-knowledge.ts:4-8`, `:213-217`; `src/cli/seed-faq.ts:48`; `src/v3/tools/search-knowledge-faq.tool.ts:30`; `src/services/knowledge.service.ts:107-142`, `:147-182`.
- **Bukti:**
  - `faq-corpus.ts:179` — artikel FAQ berjudul **“Nanti saya info lagi”** dengan jawaban **“Baik bunda, kami tunggu infonya”**. Ini cuplikan percakapan, bukan pengetahuan klinis; tetap ter-retrieve dengan similarity 0,4375 pada log `2026-09-25T14:46:35.037Z`.
  - `faq-corpus.ts:173-174` — artikel **“Pijet bayi ceria berapa lama?”** (ejaan “Pijet”) berisi durasi **40 menit** dan **pertanyaan penutup** “Mau rencana ambil treatment apa bunda?”. Artikel ini muncul **15 kali** di prompt 200 sampel — salah satu yang paling sering.
  - Korpus berisi 48 pertanyaan; deskripsi tool menyebut **“47 artikel knowledge_chunks”** (`search-knowledge-faq.tool.ts:30`) → metadata drift.
  - Minimal 2 pasang duplikat semantik: “Apa saja yang perlu disiapkan sebelum treatment?” vs “Apa saja perlengkapan yang perlu disiapkan di rumah sebelum Bidan datang?”; “Apa perbedaan antara Pijat Bayi Ceria dan Pijat Terapi (Pulih Ceria)?” vs “Apa perbedaan antara treatment Pijat Ceria (Rileksasi) dan Pijat Pulih Ceria (Terapi)?”.
  - `scripts/sync-live-knowledge.ts` menggabungkan “kurasi live” langsung ke korpus seed; tidak ada status kurasi/QA (hanya komentar “REVIEW & COMMIT”).
- **Titik kegagalan:** data (korpus) → retrieval (noise) → prompt (grounded instruction pada data non-klinis).
- **Akar masalah (5 Whys):**
  1. Mengapa cuplikan chat masuk KB? Karena sync live menyalin pertanyaan/answer apa adanya ke korpus.
  2. Mengapa tidak difilter? Tidak ada schema/flag `source_type` atau `curation_status` yang membedakan artikel klinis vs canned chat.
  3. Mengapa duplikat? Tidak ada dedupe semantik saat merge/seed.
  4. Mengapa tidak terdeteksi? Tidak ada lint korpus / test kualitas isi.
  5. Mengapa metadata salah? Jumlah artikel di-hardcode di deskripsi tool.
- **Keyakinan:** **TERBUKTI**.
- **Framework:** OWASP LLM04 (data poisoning), LLM09 (overreliance); RAG context precision.
- **FMEA:** S=8 (jawaban salah/ tidak relevan), O=7 (artikel kontaminasi masuk top retrieval), D=5 (mudah dilihat saat audit) = **280**.
- **Collateral damage:** Menghapus/menulis ulang chunk dapat menghilangkan jawaban sah yang jarang dipakai; butuh backup `knowledge_chunks` + persetujuan pemilik klinis. Re-seed bisa menimpa kurasi admin.
- **Rekomendasi fondasional:**
  1. Pisahkan **`source_type`**: `CLINICAL_ARTICLE`, `SOP_POLICY`, `CANNED_CHAT`, `PRODUCT_FAQ`; retrieval hanya mengambil tipe klinis untuk pertanyaan medis.
  2. Tambah `curation_status` + `reviewed_by` + `reviewed_at` di `knowledge_chunks`; artikel tanpa review tidak masuk retrieval.
  3. Lint korpus: pertanyaan harus berupa topik/pertanyaan; larangan jawaban berupa pertanyaan balik; larangan duplikasi fakta katalog (durasi/harga) — jika perlu, ambil dari katalog saat runtime, bukan hardcode di artikel.
  4. Dedupe semantik (combinedSimilarity) + batas maksimal per topik.
  5. Hapus hitungan “47 artikel” dari deskripsi tool; ambil dari `COUNT`/metadata runtime.
- **Verifikasi:** (a) test korpus: “Nanti saya info lagi” tidak ada; (b) dedupe test 2 pasang duplikat → 1; (c) retrieval “lagi kena bapil” top-3 bukan canned chat; (d) test jumlah artikel dinamis; (e) backup + dry-run seed diff 0 unintended changes.

---

### C-003 — Rekomendasi pra-grounding di `[STATUS]` diberi “MANDAT”, menimpa clinical dominance dan keluhan utama

- **Tipe:** Vertikal (state → prompt → tool → jawaban).
- **Lokasi:** `src/v3/state/goal-tracker.ts:459-471`, `:501`; `src/services/treatment-catalog.service.ts:1823-1940`; `src/v3/tools/get-catalog.tool.ts:424-465`, `:485-515`.
- **Bukti:**
  - `goal-tracker.ts:471` menyuntik: *“Rekomendasi Sesuai Keluhan … [MANDAT WAJIB: Tawarkan layanan rekomendasi di atas … DILARANG mengganti dengan nama paket lain!]”*.
  - Rekomendasi dihitung dari **semua** gejala sesi (`allSymptoms`), dengan skor token yang sama untuk setiap gejala; tidak ada bobot recency/primary complaint (`treatment-catalog.service.ts:1921-1939`).
  - Log sesi `c4025b9a-6fce-42fd-8cf9-acc621f73526` (09-26): turn 09:36:04 menjawab **Pulih Ceria Newborn** untuk kembung/tummy time; turn 09:36:36 — input tetap soal tummy time/kepala peyang — argumen tool berisi `specificTreatmentName: "Kala Baby – Pijat Lahap"`, dan balasan merekomendasikan **Pijat Lahap** untuk “kembung dan perutnya”. Rekomendasi bergeser dari terapi keluhan ke paket nafsu makan tanpa klarifikasi.
- **Titik kegagalan:** state (agregasi gejala) → prompt (MANDAT) → tool (skor gejala) → jawaban.
- **Akar masalah (5 Whys):**
  1. Mengapa rekomendasi bergeser? Karena gejala lama “susah makan” ikut memberi skor untuk Lahap.
  2. Mengapa gejala lama menang? Semua token gejala diberi bobot sama; tidak ada prioritas keluhan saat ini.
  3. Mengapa LLM mengikuti? Karena status block memerintahkan “DILARANG mengganti”.
  4. Mengapa prompt dan tool bisa berbeda? Keduanya menghitung skor dari pool gejala yang berbeda (state vs argumen tool).
  5. Mengapa tidak ada konflik resolution? Tidak ada aturan deterministik “tool result mengalahkan status pra-grounding”.
- **Keyakinan:** **TERBUKTI** untuk pergeseran dan kontrak; **KEMUNGKINAN BESAR** untuk ketidaktepatan klinis (perlu review Bidan).
- **Framework:** RAG correctness; Well-Architected Reliability; mandat clinical dominance.
- **FMEA:** S=9 (rekomendasi terapi salah), O=4 (sesi multi-gejala), D=5 (tidak ada alarm) = **180**.
- **Collateral damage:** Menghapus MANDAT bisa membuat LLM mengabaikan rekomendasi klinis; perlu menjadikan **hasil tool turn ini** otoritas tunggal, bukan menghapus panduan.
- **Rekomendasi fondasional:**
  1. Hapus “MANDAT/DILARANG mengganti” dari status pra-grounding; jadikan tool result (`clinicalRecommendation`) sebagai satu-satunya otoritas.
  2. Beri bobot gejala: keluhan pada pesan saat ini > gejala turn sebelumnya; simpan `symptom.firstSeenAt/lastMentionedAt` dan `isPrimary`.
  3. Jika skor dua layanan berdekatan (mis. selisih < ambang), hasilkan `CLINICAL_PROBE`/klarifikasi, bukan memilih sepihak.
  4. Samakan pool gejala antara `GoalTracker` dan `get-catalog` (satu fungsi rekomendasi, satu parameter tenant).
- **Verifikasi:** (a) sesi multi-gejala (kembung + susah makan) → rekomendasi konsisten/tidak bergeser tanpa klarifikasi; (b) test memastikan status block tidak memuat “DILARANG mengganti”; (c) tool result dan pregrounded recommendation identik atau pregrounded dihapus; (d) golden kasus GTM/kembung.

---

### C-004 — Jalur prompt 4-Section dari DB menghapus lapisan guardrail kode dan memakai brand sinkron

- **Tipe:** Vertikal (admin menyimpan config → DB → prompt Call 2 → perilaku).
- **Lokasi:** `src/v3/agent/prompt/prompt-composer.ts:291-314` (jalur penuh) vs `:333-376` (jalur DB); `src/services/tenant-prompt-config.service.ts:137-179`; `src/routes/admin/settings.subroute.ts:696-711`; `packages/admin-dashboard/src/pages/tenant/AiPersona.tsx:649-660`; `src/config/brand.ts:36-38`.
- **Bukti:**
  - Jalur DB hanya menyusun: `personalityTone`, `answeringHierarchy`, header few-shot (tanpa contoh), `medicalOverclaimRules`, `negativeConstraints`, 4 baris tool, `goalSummary`, kalender, sapaan.
  - Jalur penuh memuat **lebih banyak**: `GAYA_BICARA_BLOCK`, `EMPATI_IDENTITAS_BLOCK`, `buildLocationHierarchyBlock`, `buildPricingCatalogBlock`, `SCHEDULING_HIERARCHY_BLOCK`, `OPERATIONAL_POLICY_BLOCK`, `FEW_SHOT_EXAMPLES_BLOCK`, `OVERCLAIM_BLOCK`, seluruh `buildNegativeConstraintsBlock` (termasuk rule 4 age-known, rule 20/21, injection defense), dan `buildToolGuidanceBlock`.
  - `getDefaultConfig()` sengaja berupa **ringkasan** (7 baris hierarchy, 17 negative constraints), bukan 21 aturan; `GET /prompt-config` mengembalikan ringkasan ini saat belum ada config (`settings.subroute.ts:700-703`), lalu UI prefill dan tombol “Simpan 4-Section” menyimpan ringkasan tersebut.
  - Test `tests/unit/v3/db-prompt-phase-mask.test.ts:18-36` hanya memeriksa `PHASE_FOCUS` dan kata “DISEMBUNYIKAN”; **tidak** memeriksa hierarki/neg constraints/few-shot/injection defense.
  - `composeSystemPrompt` memakai `getBrandIdentity()` sinkron (`prompt-composer.ts:283`), dan jalur DB juga (`:336`); `getBrandIdentityAsync` hanya dipakai di Call 1 (`:260`). Untuk tenant dengan brand override, Call 2 tetap menyebut brand default.
- **Titik kegagalan:** prompt (komposisi all-or-nothing) → guardrail hilang → jawaban.
- **Akar masalah (5 Whys):**
  1. Mengapa guardrail hilang? Karena jalur DB mengganti seluruh base prompt, bukan menambal layer.
  2. Mengapa dipilih replace? Implementasi 4-section dianggap “prompt lengkap”.
  3. Mengapa default-nya ringkasan? `getDefaultConfig` ditulis sebagai ringkasan, bukan hasil komposisi.
  4. Mengapa tidak terdeteksi? Test hanya mengunci 4 field + phase focus.
  5. Mengapa brand sinkron? `getBrandIdentityAsync` tidak diteruskan ke composer Call 2.
- **Keyakinan:** **TERBUKTI** untuk isi prompt; **KEMUNGKINAN BESAR** untuk dampak (butuh admin menyimpan config).
- **Framework:** Well-Architected Operational Excellence/Security; OWASP LLM06 (system prompt integrity).
- **FMEA:** S=9 (guardrail klinis hilang), O=3 (hanya setelah simpan), D=7 (tidak ada alarm) = **189**.
- **Collateral damage:** Menyimpan config yang sudah ada bisa mengubah perilaku produksi secara mendadak; rollback butuh versi aktif sebelumnya. Perbaikan composer harus menjaga prompt-cache prefix dan tidak menggandakan aturan.
- **Rekomendasi fondasional:**
  1. Ubah composer: **selalu** rakit layer kode (hierarchy, neg constraints, tool guidance, injection defense, pruning) dan gunakan 4 seksi DB hanya sebagai **overlay** (tone/prioritas tambahan), bukan pengganti.
  2. `getDefaultConfig` harus mengembalikan hasil komposisi penuh atau UI harus menampilkan 4 seksi sebagai “tambahan”, dengan diff ukuran prompt.
  3. Jika config DB ada, tetap pertahankan state-gated pruning (`ageKnown`, `priceDiscussed`, committed) dan few-shot dinamis.
  4. Gunakan `getBrandIdentityAsync(tenantId)` di Call 2; test dua tenant dengan brand berbeda.
  5. Tambah regression test: prompt DB harus mengandung `NEGATIVE CONSTRAINTS`, `INJECTION DEFENSE`, `HIERARKI`, dan `MANDAT` yang relevan; bandingkan byte-prefix cache.
- **Verifikasi:** (a) aktifkan config DB di tenant uji → prompt masih memuat seluruh layer; (b) dua tenant brand berbeda → Call 1 & Call 2 konsisten; (c) test config default tidak menurunkan jumlah aturan; (d) rollback versi.

---

### C-005 — SOP vaksinasi kontradiktif: policy/triage “boleh langsung” vs safety “dilarang langsung”; jalur SCREEN deterministik bisa mengirim teks terlarang

- **Tipe:** Vertikal (policy DB/fallback → triage → jawaban deterministik) / Horizontal (semua pertanyaan pasca-vaksin).
- **Lokasi:** `src/v3/tools/clinic-faq.tool.ts:113-119`, `:153-159`; `src/v3/agent/prompt/layers/global-safety.layer.ts:25`; `src/scripts/seed-copilot-sop-owner.ts:42-51`; `scripts/seed-clinic-policies.ts:14`; `src/v3/agent/pipeline/medical-signal-detector.ts:486-496`; `src/v3/agent/agent-runner.ts:272-277`.
- **Bukti:**
  - `clinic-faq.tool.ts:117`: *“Pijat setelah imunisasi/vaksinasi **BOLEH dijadwalkan langsung**, tetapi Bidan kami menyarankan menunggu 48–72 jam…”*; `suggestedReply` di `:118`: *“**Boleh langsung ya Bunda**, hanya saja Bidan kami menyarankan jeda 48-72 jam…”*.
  - `triage_screen` di `:157-158`: *“**Boleh langsung ya Bun**, hanya saja Bidan kami menyarankan jeda 48-72 jam…”*.
  - `global-safety.layer.ts:25`: *“Bayi setelah vaksin/imunisasi **DILARANG KERAS langsung dipijat!** Wajib jeda minimal 2-3 hari (48-72 jam)…”*.
  - `seed-copilot-sop-owner.ts:44-51`: *“jeda minimal 48-72 jam … Operasional klinik menerapkan 3 hari sebagai batas aman.”*
  - `scripts/seed-clinic-policies.ts:14` menyemai `getStaticFallbackTopics()` — yang berisi teks “BOLEH langsung” — ke tabel `clinic_policies`.
  - `evaluateTriageGate` mengembalikan `SCREEN` + `policyTopic: 'triage_screen'` untuk sinyal vaksin yang belum aman (`medical-signal-detector.ts:486-496`); `agent-runner.ts:273-277` mengambil `policyFaq.suggestedReply` dan **langsung mengirimnya** tanpa Call 2/guardrail.
  - Pada 4 log kasus vaksin (09-25), balasan LLM justru mengatakan “jeda 3 hari” — perilaku yang baik; tetapi jalur deterministik di atas tetap bisa mengirim teks “boleh langsung” saat skrining gagal.
- **Titik kegagalan:** data kebijakan (kontradiksi) → triage (SCREEN) → output deterministik.
- **Akar masalah (5 Whys):**
  1. Mengapa ada dua kebenaran? Policy statis/seed dan prompt safety ditulis terpisah.
  2. Mengapa policy statis menang? Fallback dipakai saat DB kosong; seed menyalin teks lama.
  3. Mengapa triage memakai teks itu? `triage_screen` tidak punya policy khusus yang aman.
  4. Mengapa tidak ada validasi? Tidak ada test yang memastikan semua teks vaksinasi konsisten.
  5. Mengapa tidak terdeteksi? Audit sebelumnya fokus pada “48-72 jam”, bukan kata “boleh langsung”.
- **Keyakinan:** **TERBUKTI** untuk kontradiksi teks dan jalur kode; **KEMUNGKINAN BESAR** untuk pengiriman aktual (belum ada log SCREEN).
- **Framework:** RAG correctness/refusal; OWASP LLM09; Well-Architected Security.
- **FMEA:** S=9 (risiko keselamatan bayi), O=4 (jalur SCREEN), D=4 (teks terlihat jika diuji) = **144**.
- **Collateral damage:** Mengubah teks policy memerlukan persetujuan klinis; customer yang sudah menerima “boleh langsung” butuh komunikasi ulang. Cache policy 1 jam harus di-invalidate.
- **Rekomendasi fondasional:**
  1. **Satu sumber kebenaran** untuk aturan vaksinasi: `ClinicPolicy` DB + validasi bahwa teks tidak mengandung “boleh langsung” (kontrak data, bukan prompt).
  2. Perbaiki `getStaticFallbackPolicy('post_vaccine_rules')` dan `triage_screen` menjadi “tunda 48–72 jam”, selaras `global-safety.layer.ts`.
  3. `seed-clinic-policies.ts` harus memakai teks kanonis yang sama dengan `seed-copilot-sop-owner.ts`, bukan fallback lama.
  4. Jalur SCREEN harus memakai template aman yang diuji; tambah test yang memastikan semua teks vaksinasi memuat “tunda/jeda” dan tidak memuat “boleh langsung”.
  5. Cache invalidation per tenant setelah update policy.
- **Verifikasi:** (a) unit test semua policy vaksinasi (DB + fallback + triage) → tidak ada “boleh langsung”; (b) simulasi “habis vaksin BCG hari ini” → SCREEN → jawaban “tunda”; (c) test dua tenant dengan policy berbeda; (d) log event saat SCREEN dipakai.

---

### C-007 — `specificTreatmentName` dapat diisi dari riwayat, bukan pesan customer saat ini

- **Tipe:** Vertikal (history → router args → tool → rekomendasi).
- **Lokasi:** `src/v3/tools/get-catalog.tool.ts:218-221` (kontrak schema), `:440-465` (penggunaan); `src/v3/agent/prompt/phases/router-tool-routing.layer.ts:26`.
- **Bukti:**
  - Schema mewajibkan: *“HANYA diisi bila pesan customer SAAT INI menyebut nama paket secara eksplisit. DILARANG mengisi dari riwayat turn sebelumnya.”* (`get-catalog.tool.ts:220`).
  - Log `2026-09-26T09:36:36.892Z`: input tentang tummy time/ngamuk/kepala peyang **tidak menyebut “Lahap”**, tetapi `toolsCalled` berisi `specificTreatmentName: "Kala Baby – Pijat Lahap"`. 1 dari 27 panggilan dengan nama spesifik (3,7%) jelas melanggar; 8 lainnya ambigu (mis. “pijat bapil”, “oksitosin” yang memang disebut user).
  - Tidak ada gerbang server-side yang membandingkan `specificTreatmentName` dengan `incomingText`; tool langsung memakainya untuk filter (`:440-465`).
- **Titik kegagalan:** tool contract (argumen tidak divalidasi terhadap pesan aktif).
- **Akar masalah (5 Whys):**
  1. Mengapa argumen berasal dari riwayat? Router LLM membawa konteks; schema hanya instruksi prompt.
  2. Mengapa tidak dicegah? Tidak ada validasi deterministik argumen terhadap `incomingText`.
  3. Mengapa clinical dominance tidak cukup? Guard hanya membatalkan filter jika mengusir rekomendasi klinis; jika nama kebetulan sejalan, filter tetap mempersempit pool.
  4. Mengapa lolos test? Test tool tidak menguji argumen “nama dari riwayat”.
- **Keyakinan:** **TERBUKTI** (1 kasus log + kode tanpa gate).
- **Framework:** OWASP LLM07 (tool input tidak tepercaya); RAG correctness.
- **FMEA:** S=7, O=4, D=4 = **112**.
- **Collateral damage:** Gate token-match bisa menolak alias/typo sah (“pijat ceria” vs “Kala Baby – Pijat Ceria”); perlu alias + konfirmasi, bukan penolakan mutlak.
- **Rekomendasi fondasional:**
  1. Validasi argumen di tool boundary: token signifikan `specificTreatmentName` harus muncul di `incomingText` (atau alias yang disetujui); jika tidak, **drop** dan gunakan `symptoms`.
  2. Catat `nameSource: 'current_message' | 'dropped_history'` di telemetry.
  3. Test adversarial: history menyebut “Lahap”, pesan sekarang hanya “kembung” → argumen harus kosong.
- **Verifikasi:** test unit tool + log assert `specificTreatmentName` hanya dari pesan aktif; regresi 27 kasus nama.

---

### C-008 — Pertahanan prompt injection hanya mendeteksi, tidak menegakkan; riwayat user dan KB tidak diisolasi

- **Tipe:** Keamanan (LLM01/LLM04/LLM07) / Horizontal.
- **Lokasi:** `src/utils/prompt-injection-sanitizer.ts:44-56`, `:62-77`; `src/v3/agent/agent-runner.ts:209-214`; `src/v3/agent/prompt/prompt-composer.ts:355-376`; `src/v3/tools/search-knowledge-faq.tool.ts:86`; `src/routes/admin/knowledge.subroute.ts:143-149`, `:309`, `:344`.
- **Bukti:**
  - `sanitizeCustomerInput` menambahkan `blockedPatterns` untuk “ignore previous instructions/abaikan instruksi”, tetapi **tidak menghapus** teks itu; `wrapCustomerMessage` hanya memakai `clean` dan membuang `blockedPatterns` (`:72-77`). Deteksi tidak menghasilkan tindakan.
  - Riwayat percakapan dimasukkan mentah: `recentHistory = conversationHistory.slice(-8).map(...)` (`agent-runner.ts:209`), tanpa `wrapCustomerMessage`; hanya pesan saat ini yang di-wrap (`:213`).
  - Jalur prompt DB tidak memuat `INJECTION_DEFENSE_BLOCK` (C-004).
  - `search_knowledge_faq` mengembalikan `message` berisi instruksi (“Panduan Bidan: … DILARANG …”) dan konten chunk mentah (`search-knowledge-faq.tool.ts:86-92`); chunk berasal dari admin/legacy harvest, bisa berisi instruksi.
  - `POST /unanswered/:id/resolve` menyimpan pertanyaan customer mentah sebagai `title/content` FAQ (`knowledge.subroute.ts:141-149`), sehingga teks customer bisa masuk KB setelah admin menjawab.
- **Titik kegagalan:** keamanan input (current + history + KB).
- **Akar masalah (5 Whys):**
  1. Mengapa injeksi bisa masuk? Delimiter hanya untuk pesan saat ini; history dan KB tidak diisolasi.
  2. Mengapa deteksi tidak menindak? `blockedPatterns` tidak dipakai untuk menolak/menandai turn.
  3. Mengapa KB bisa berisi instruksi? Tidak ada sanitasi saat import/merge.
  4. Mengapa tidak teruji? Test hanya memeriksa tag dan `blockedPatterns.length`, bukan penegakan (`tests/unit/v3/prompt-injection-sanitizer.test.ts:42-46`).
- **Keyakinan:** **TERBUKTI** untuk kode; **KEMUNGKINAN BESAR** untuk eksploitasi (belum ada red-team runtime).
- **Framework:** OWASP LLM01 (direct/indirect injection), LLM04 (data poisoning), LLM07.
- **FMEA:** S=8, O=3, D=7 = **168**.
- **Collateral damage:** Menghapus kalimat “abaikan instruksi” bisa memutilasi pertanyaan sah; lebih aman: deteksi → tolak turn dengan jawaban aman/eskalasi, atau tandai untuk review, tanpa mengubah teks klinis.
- **Rekomendasi fondasional:**
  1. Gunakan `blockedPatterns` sebagai gerbang: jika ada pola instruksi, jangan kirim ke LLM; balas template aman/eskalasi (deterministik).
  2. Wrap **setiap** pesan user dalam history saat menyusun `messages` (bukan hanya current).
  3. Sanitasi/quote konten KB sebelum masuk prompt; jangan gabungkan instruksi “Panduan Bidan” ke dalam tool result yang dibaca sebagai data — kirim instruksi sebagai system-level guidance terpisah.
  4. Tambah `source`/`curation_status` KB (C-002) dan tolak konten yang mengandung pola instruksi.
  5. Red-team test: direct, paraphrase, roleplay, indirect via KB, history injection.
- **Verifikasi:** test injeksi current/history/KB → tidak ada perubahan peran/ kebocoran prompt; `blockedPatterns` memicu jalur aman; log event.

---

### C-009 — Log LLM menyimpan prompt penuh + PII, hanya output pra-guardrail, tanpa retensi

- **Tipe:** Horizontal (observability/privacy) / Vertikal (log → audit).
- **Lokasi:** `src/utils/llm-execution-logger.ts:16-51`, `:89-148`; `src/v3/agent/pipeline/generation-stage.ts:1053-1070`; `src/v3/agent/agent-runner.ts:549`.
- **Bukti:**
  - `recordCall` menyimpan `systemPrompt: fullSystemPrompt` dan `finalReply` sebelum guardrail; guardrail baru berjalan di Stage 5 setelah `generateReply`.
  - `llm-execution-logger` menulis JSONL append tanpa rotasi/retensi; `logs/` gitignored tetapi tetap di disk. Ukuran: `llm-2026-09-25.jsonl` **28,4 MB**, `llm-2026-09-26.jsonl` 7,2 MB.
  - `customerInput` disimpan mentah (nama anak/alamat muncul, mis. “adek Kenzio”, “Kutisari”), sementara hanya `customerPhone`/`customerName` yang di-mask. Prompt berisi `[STATUS DATA CUSTOMER]` dengan lokasi/nama.
  - Log terbaru **2026-10-06**, tidak ada log 2026-10-07 s/d 2026-11-07.
- **Titik kegagalan:** observability (tidak bisa mengukur jawaban terkirim) + privasi.
- **Akar masalah (5 Whys):**
  1. Mengapa tidak bisa mengukur format? Karena log menyimpan output sebelum sanitizer/guardrail.
  2. Mengapa disimpan penuh? Untuk debugging/Inspector.
  3. Mengapa PII? Tidak ada redaksi input/status; hanya phone/name.
  4. Mengapa tidak ada retensi? Logger append-only, tanpa cron purge.
- **Keyakinan:** **TERBUKTI**.
- **Framework:** OWASP LLM06 (sensitive info), Well-Architected Security/Operational Excellence.
- **FMEA:** S=6, O=8, D=5 = **240**.
- **Collateral damage:** Menambah field `deliveredReply` memperbesar disk; retensi agresif bisa menghapus bukti audit. Perlu kebijakan retensi + redaksi.
- **Rekomendasi fondasional:**
  1. Tambah `deliveredReply` (pasca-guardrail) + `guardrailActions` ke record; jangan mengganti `finalReply` mentah (simpan keduanya).
  2. Redaksi PII di `customerInput`/prompt (nama, alamat, nomor) atau simpan hash + snippet.
  3. Rotasi/retensi (mis. 30 hari) + kompresi; metrik ukuran.
  4. Pastikan log produksi tersedia untuk audit berikutnya (saat ini stale 32 hari).
- **Verifikasi:** record punya `deliveredReply`; test redaksi; cek ukuran/retensi; audit sampling bisa mengukur format terkirim.

---

### C-010 — Prompt assembly tenant-blind: katalog default tenant & brand Call 2

- **Tipe:** Vertikal (tenant → prompt → tool → jawaban) / Horizontal (semua tenant non-default).
- **Lokasi:** `src/v3/state/goal-tracker.ts:462`, `:485`, `:612`, `:677`; `src/v3/state/conversation-summarizer.ts:102`, `:109-110`; `src/v3/agent/prompt/prompt-composer.ts:283`, `:336`; `src/config/brand.ts:36-38`.
- **Bukti:**
  - `recommendServiceBySymptoms(allSymptoms, age, categoryHint)` dipanggil **tanpa `tenantId`** (`goal-tracker.ts:462`) → default `DEFAULT_TENANT_ID`.
  - `getDefaultRelaxationService(categoryHint, age)` tanpa tenant (`:485`); `getAllServices(true)` tanpa tenant (`:612`, `:677`).
  - `conversation-summarizer.ts:102` `getAllServices(true)` tanpa tenant; `:109-110` `recommendServiceBySymptoms` tanpa tenant.
  - `composeSystemPrompt`/jalur DB memakai `getBrandIdentity()` sinkron (`:283`, `:336`); `getBrandIdentityAsync` hanya di Call 1 (`:260`). Jadi tenant dengan brand override akan mendapat nama brand default di Call 2.
- **Titik kegagalan:** data tenant (katalog/brand) bocor ke prompt tenant lain.
- **Akar masalah (5 Whys):**
  1. Mengapa memakai default? Fungsi lama tidak menerima `tenantId`.
  2. Mengapa tidak ketahuan? Single-tenant saat ini; test tidak memakai dua katalog berbeda.
  3. Mengapa brand sync? Composer Call 2 belum diubah ke async.
  4. Mengapa tidak ada test? Tidak ada test prompt dua tenant.
- **Keyakinan:** **TERBUKTI** untuk kode; **KEMUNGKINAN BESAR** untuk dampak (tergantung multi-tenant aktif).
- **Framework:** OWASP LLM06; Well-Architected Security; SaaS readiness.
- **FMEA:** S=8, O=3, D=6 = **144**.
- **Collateral damage:** Meneruskan `tenantId` ke banyak fungsi bisa mengubah signature dan test; perlu migrasi bertahap + default backward-compatible.
- **Rekomendasi fondasional:**
  1. Tambah `tenantId` wajib pada `formatGoalSessionForPrompt`, `V3ConversationSummarizer.summarize`, dan semua panggilan katalog; fail-closed jika tidak ada.
  2. Gunakan `getBrandIdentityAsync(tenantId)` di Call 1 dan Call 2.
  3. Test dua tenant dengan nama layanan/harga/brand berbeda; pastikan prompt & rekomendasi tidak silang.
- **Verifikasi:** test prompt tenant A vs B; grep `getAllServices(true)`/`recommendServiceBySymptoms(` tanpa tenant → 0 di jalur AI; audit `DEFAULT_TENANT_ID` di file prompt.

---

### C-011 — Tidak ada red flag batuk kronis ≥14 hari; RAG tidak menarik artikel bapil → rekomendasi pijat untuk batuk 2 minggu

- **Tipe:** Vertikal (input → medical gate → RAG → jawaban) / keselamatan klinis.
- **Lokasi:** `src/config/medical-keywords.ts:322-340`; `src/services/medical-detection.service.ts:25-35`; `src/v3/agent/pipeline/medical-signal-detector.ts:486-496`; `src/services/knowledge.service.ts:188-356`; log `2026-09-25T14:46:17.299Z`.
- **Bukti:**
  - Detektor `detectPersistentCoughRashEmergency` hanya bereaksi bila batuk **plus** ruam mencurigakan **atau** demam (`medical-keywords.ts:322-340`). Batuk ≥14 hari **sendiri** tidak memicu eskalasi.
  - Log `2026-09-25T14:46:17.299Z`: input **“Batuk sudah 2minggu”** → tool `get_catalog_and_price` (symptoms `["batuk","batuk 2 minggu"]`), **tanpa** knowledge/policy; balasan merekomendasikan **Pijat Pulih Ceria** dan menanyakan usia — tidak ada anjuran evaluasi medis untuk batuk 2 minggu.
  - Pre-grounding tidak mengambil artikel bapil; 16/55 pertanyaan SOP/klinis tidak punya knowledge/policy.
  - Artikel bapil ada di korpus tetapi tidak ter-retrieve karena query pendek/AND (C-001).
- **Titik kegagalan:** medical gate (red flag) + retrieval (artikel tidak terambil) → jawaban.
- **Akar masalah (5 Whys):**
  1. Mengapa tidak dieskalasi? Aturan red flag hanya komposit batuk+ruam/demam.
  2. Mengapa tidak ada aturan durasi? Belum ada definisi klinis “batuk kronis” di gate.
  3. Mengapa RAG tidak membantu? Artikel bapil tidak ter-retrieve (query/rank).
  4. Mengapa tidak ada peringatan? Tidak ada SOP khusus durasi batuk di KB/policy.
- **Keyakinan:** **TERBUKTI** untuk tidak adanya rule + miss retrieval; **KEMUNGKINAN BESAR** untuk risiko klinis (perlu persetujuan dokter).
- **Framework:** RAG correctness/refusal; OWASP LLM09; Well-Architected Reliability.
- **FMEA:** S=9 (keterlambatan evaluasi medis), O=3, D=6 = **162**.
- **Collateral damage:** Menambah red flag dapat meningkatkan eskalasi/over-refusal; ambang harus disetujui klinis dan diuji dengan variasi “batuk 3 hari” vs “2 minggu”.
- **Rekomendasi fondasional:**
  1. Tambah aturan **state/data-driven**: ekstrak durasi batuk; jika ≥14 hari → `MEDICAL_REVIEW`/eskalasi atau jawaban “perlu evaluasi dokter” sebelum menawarkan pijat.
  2. Pastikan artikel bapil ter-retrieve (C-001) dan memuat red flag durasi; update `ClinicPolicy`/KB, bukan hanya prompt.
  3. Test adversarial: “batuk 2 minggu”, “batuk 3 minggu”, “batuk 10 hari”, “batuk 2 hari” → perilaku berbeda sesuai ambang.
- **Verifikasi:** unit test detektor durasi; integration test jawaban; sampling log 30 hari.

---

### C-012 — Import FAQ/dokumen “sukses” walau DB gagal (fallback memori), data hilang/tak ter-retrieve

- **Tipe:** Vertikal (admin import → DB/memori → retrieval) / Horizontal (semua import).
- **Lokasi:** `src/services/knowledge.service.ts:107-142`, `:147-182`; `src/routes/admin/knowledge.subroute.ts:298-327`, `:333-363`.
- **Bukti:**
  - `importFaqs` menangkap error `prisma.knowledgeChunk.create`, mendorong item ke `memoryKnowledgeChunks`, lalu tetap `count++` (`knowledge.service.ts:114-135`); route mengembalikan `“Successfully imported …”` (`knowledge.subroute.ts:322-325`).
  - `importDocument` sama (`:155-175`).
  - `searchRelevantChunks` mencoba DB lebih dulu; jika DB kembali normal (atau query berhasil tetapi item tidak ada), fallback memori tidak dipakai → item yang “berhasil diimpor” tidak pernah ter-retrieve. Setelah restart, memori hilang.
  - `GET /knowledge/chunks` membaca DB saja, sehingga item memori tidak tampil di dashboard.
- **Titik kegagalan:** persistensi (ghost success) → retrieval.
- **Akar masalah (5 Whys):**
  1. Mengapa admin melihat sukses? Service menelan error dan mengembalikan count.
  2. Mengapa fallback memori dipakai? Untuk test/offline.
  3. Mengapa tidak ter-retrieve? Search memprioritaskan DB; memori bukan sumber kanonis.
  4. Mengapa tidak ada retry? Tidak ada antrean/error propagation.
- **Keyakinan:** **TERBUKTI**.
- **Framework:** Well-Architected Reliability/Operational Excellence; OWASP LLM04 (data integrity).
- **FMEA:** S=7 (pengetahuan klinis hilang), O=3, D=7 = **147**.
- **Collateral damage:** Mengembalikan error bisa mengganggu alur admin; perlu retry/antrean dan pesan yang jelas, bukan silent success.
- **Rekomendasi fondasional:**
  1. Import harus **fail-closed**: jika DB gagal, kembalikan `503`/`success:false` dengan jumlah gagal; jangan hitung memori sebagai sukses.
  2. Pisahkan jalur offline test dari produksi; fallback memori hanya untuk test, bukan import admin.
  3. Tambah idempotensi/retry + status job; dashboard menampilkan status.
  4. Test DB failure → route error, tidak ada item “hantu”.
- **Verifikasi:** test mock `create` reject → response gagal; test search setelah DB pulih tidak menemukan item memori; dashboard status.

---

## 6. Rencana Perbaikan Berurutan (Staged, Micro-Task)

> Audit ini **tidak mengeksekusi** perbaikan. Semua fase di bawah adalah usulan; eksekusi memerlukan persetujuan manusia (Human-in-the-Loop) dan regression gate.

### Fase 0 — Safety stop-gap (0–2 hari, blast radius kecil)

1. **C-005:** samakan semua teks vaksinasi (fallback, seed, triage_screen) menjadi “tunda 48–72 jam”; hapus “boleh langsung”. Uji: `rg "boleh langsung" src/v3/tools/clinic-faq.tool.ts scripts` → 0.
2. **C-012:** ubah `importFaqs`/`importDocument` agar melempar error DB; route mengembalikan gagal; test mock reject.
3. **C-004:** sementara, blokir tombol “Simpan 4-Section” atau tampilkan warning tegas + diff bahwa hierarki/neg constraints akan hilang, sampai composer diperbaiki.
4. **C-006:** tambah `source` pada `retrievedChunks`; D3 hanya menerima `knowledge`/`policy`; test katalog-only tidak lolos D3.
5. **Regression gate:** `npm run build` + test RAG/prompt/guardrail + full suite tanpa failure baru.

### Fase 1 — Data & keselamatan klinis (3–5 hari)

1. **C-002:** backup `knowledge_chunks`; lint korpus (hapus “Nanti saya info lagi”, dedupe 2 pasang, perbaiki ejaan “Pijet”, hapus pertanyaan balik); dry-run seed diff.
2. **C-011:** definisikan aturan batuk kronis ≥14 hari bersama pemilik klinis; tambah ke `medical-signal-detector`/policy; test variasi durasi.
3. **C-010:** teruskan `tenantId` ke `formatGoalSessionForPrompt`, summarizer, dan rekomendasi katalog; test dua tenant.
4. **Regression gate:** golden retrieval set awal 20–30 kasus; cek tidak ada penurunan.

### Fase 2 — Fondasi retrieval (1–2 minggu)

1. **C-001:** query rewriting + token coverage/IDF; selaraskan index FTS/trigram; ukur `EXPLAIN ANALYZE`; kalibrasi rank.
2. **C-007:** gate `specificTreatmentName` terhadap pesan aktif; telemetry `nameSource`.
3. **C-006 lanjutan:** RAG-miss untuk intent klinis → limited answer/eskalasi; propagasi `emptyKnowledgeResult`.
4. **Regression gate:** recall@3/precision@3 pada 50–200 pertanyaan; test adversarial “lagi kena bapil”, “ke bungurasih berapa”, “batuk 2 minggu”.

### Fase 3 — Integritas prompt & keamanan (1–2 minggu)

1. **C-004:** refactor composer agar DB sections menjadi overlay; semua layer kode tetap ada; `getBrandIdentityAsync` di Call 2.
2. **C-008:** tegakkan `blockedPatterns`; wrap history; sanitasi KB; test indirect injection.
3. **C-009:** tambah `deliveredReply` + `guardrailActions`; redaksi PII; retensi/rotasi log.
4. **Regression gate:** prompt dua tenant, prompt cache prefix, guardrail D1–D10, injection red-team.

### Fase 4 — Verifikasi & pemantauan (berkelanjutan)

1. Golden dataset 50–200 pertanyaan (kategori: umum, sulit, ambigu, di luar topik, tidak ada di data, multi-langkah, jebakan); penilaian manual + LLM-as-judge (sebut model; sampling manual).
2. Dashboard metrik RAG: hit rate, recall@3, precision@3, chunk < threshold, RAG-miss per intent.
3. Update `docs/KNOWN_ISSUES.md`, `docs/FEATURE_INVENTORY.md`, `CHANGELOG.md` setelah eksekusi.

---

## 7. Verifikasi yang Sudah Dijalankan

| Perintah | Hasil |
|---|---|
| `npx vitest run tests/unit/knowledge-search.test.ts tests/unit/v3/db-prompt-phase-mask.test.ts tests/unit/admin-persona-prompt-config.test.ts tests/unit/location-prompt-pruning.test.ts` | **4 file / 19 test PASS** |
| `npx vitest run tests/unit/knowledge.test.ts tests/unit/knowledge-preparation-search.test.ts tests/unit/dynamic-knowledge-maternal.test.ts tests/unit/v3/d1-addon-false-positive-fix.test.ts` | **4 file / 18 test PASS** |
| Cek klaim Fase 03 3.3 | Kode clinical dominance ada; tetap ada catatan C-003/C-007 |
| Cek #130 | `stripInternalInstructionArtifacts` ada; 0 artefak di 200 balasan log |
| Cek #29/#31 | Masih terbuka (kode) |
| Cek #81 | Tidak dapat diverifikasi live; migrasi ada di repo |

**Keterbatasan verifikasi:** 8 file test di atas berjalan dengan `tests/setup.ts` yang mem-mock DB menjadi “Database offline”; test `knowledge*.test.ts` karena itu menguji **fallback memori**, bukan `ts_rank`, index, atau SQL nyata. Ini adalah alasan utama kenapa “test hijau” tidak membuktikan kualitas retrieval produksi.

---

## 8. Batasan & Asumsi

1. **Log stale:** log terbaru `llm-2026-10-06.jsonl`; audit 2026-11-07. Tidak ada bukti perilaku setelah 2026-10-06.
2. **Sampel default tenant:** 200 V3_GENERATION, 1.710 total record; bukan sampel acak seluruh populasi.
3. **Tidak ada DB/server:** isi `knowledge_chunks`, `clinic_policies`, `tenant_prompt_configs`, dan status migrasi produksi tidak diverifikasi.
4. **Tidak ada golden dataset / LLM judge:** tidak ada klaim faithfulness/correctness/halu persen.
5. **Log pra-guardrail:** format/jawaban terkirim tidak dapat diukur; angka format di §3 hanya sinyal model.
6. **Tidak ada red-team runtime:** temuan injection berbasis kode + test unit, bukan eksploitasi live.
7. **Tidak ada full suite/build:** hanya 8 file test RAG/prompt; kegagalan lain di luar cakupan.
8. **Penilaian relevansi chunk manual:** sampel 6 blok pra-fix dan 4 blok pasca-fix; sangat kecil, tidak boleh digeneralisasi.
9. **Asumsi klinis:** penilaian “Lahap untuk kembung” dan “batuk 2 minggu perlu evaluasi” adalah analisis audit, bukan diagnosis; wajib dikonfirmasi Bidan/dokter.
10. **Dokumen `AGENTS.md` menyebut tabel `Treatment`**, sedangkan kode memakai `ClinicService`; pemetaan data mengikuti kode/schema, bukan nama dokumen.
11. **Modul 4 & 6 serta Bagian A tidak diaudit ulang**; temuan yang bersinggungan dirujuk ke Cfg/Ar/ID lama.

---

## 9. Pemetaan 5 Dimensi Audit (AGENTS.md)

| Dimensi | Temuan utama | Bukti |
|---|---|---|
| **Rules** | Kontradiksi vaksinasi (C-005); lisensi jawaban umum saat RAG miss (C-006); MANDAT rekomendasi (C-003). | `clinic-faq.tool.ts:117`; `global-safety.layer.ts:25`; `context-grounder.ts:532`; `goal-tracker.ts:471` |
| **Flow/UX** | Rekomendasi bergeser dari keluhan utama (C-003); pertanyaan SOP tanpa knowledge (C-001/C-011). | Sesi `c4025b9a…`; “Batuk sudah 2minggu” |
| **Log Mesin** | 65/200 pre-KB; 16/55 SOP ungrounded; log pra-guardrail & stale (C-009). | 200 V3_GENERATION; `generation-stage.ts:1053` |
| **RAG Chunks** | “Nanti saya info lagi” @0,4375; precision pra-fix 37,5%; pasca-fix 90% (n=10). | `llm-2026-09-25` 14:46:35; 6 blok/16 chunk |
| **Prompt Inspector** | Prompt 38.978–52.013 char; jalur DB menghapus layer (C-004); status block tenant-blind (C-010); injection defense hanya deteksi (C-008). | `prompt-composer.ts:291-376`; `goal-tracker.ts:462`; `prompt-injection-sanitizer.ts:44-56` |

---

## 10. Pemetaan OWASP Top 10 for LLM Applications

| Risiko | Status | Temuan |
|---|---|---|
| LLM01 Prompt Injection | **Berisiko** | C-008: deteksi tanpa penegakan; history/KB tidak diisolasi |
| LLM02 Insecure Output Handling | Rendah | Output disanitasi; tidak dieksekusi sebagai HTML |
| LLM03 Training Data Poisoning | Tidak diaudit | Model pihak ketiga |
| LLM04 Data & Model Poisoning | **Berisiko** | C-002: korpus dari cuplikan chat; C-008: KB bisa memuat instruksi |
| LLM05 Supply Chain | Tidak diaudit | Dependensi tidak diperiksa pada audit ini |
| LLM06 Sensitive Information Disclosure | **Berisiko** | C-009: prompt + PII di log; C-010: data tenant default di prompt |
| LLM07 Insecure Plugin Design | **Berisiko** | C-006/C-008: tool result memuat instruksi; argumen tool tidak divalidasi (C-007) |
| LLM08 Excessive Agency | Di luar cakupan | Bagian A (tool masking) — tidak diaudit ulang |
| LLM09 Overreliance | **Berisiko** | C-006: jawaban umum saat RAG miss; C-011: tidak ada red flag durasi |
| LLM10 Model Theft | Tidak relevan | Tidak ada endpoint model |

---

## 11. Kesimpulan Kualitas (Jujur)

- **Kekuatan:** tool contract dan guardrail deterministik jauh lebih matang daripada RAG-nya; harga tidak bocor pada 25/25 balasan berharga; clinical dominance ada; sanitizer mencegah artefak instruksi RAG; vaksinasi di 4 log nyata dijawab “tunda 3 hari”.
- **Kelemahan utama:** retrieval leksikal tanpa query rewriting/rerank; korpus tidak bersih; prompt 4-Section dapat menghapus guardrail; RAG-miss justru memberi lisensi menjawab dari pengetahuan umum; SOP vaksinasi punya dua kebenaran.
- **Angka yang boleh dikutip:** 65/200 (32,5%) pre-grounding; 16/55 (29,1%) SOP tanpa knowledge/policy; 25/25 harga ter-grounding; 6/16 (37,5%) precision sampel pra-fix; 9/10 (90%) precision sampel pasca-fix (n=10, tidak representatif).
- **Angka yang TIDAK boleh dikutip:** “tingkat halu X%”, “faithfulness Y%”, “format compliance Z%” — tidak ada golden dataset/penilai.
