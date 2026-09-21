# ADR — Evaluasi Framework Orchestration AI (LangGraph vs Mastra vs Custom Pipeline)

- **Tanggal:** 2026-09-21
- **Status:** DECIDED (Pertahankan Custom Pipeline V3; Adopsi Modular/Parsial jika dibutuhkan)
- **Topik:** Evaluasi adopsi framework agen AI (LangChain / LangGraph.js, Mastra) versus mempertahankan arsitektur kustom V3 saat ini.

---

## 1. Konteks & Latar Belakang

Sistem saat ini adalah chatbot klinik WhatsApp berbasis **Node 20 + TypeScript**, Fastify, Prisma/PostgreSQL, dan WAHA/WABA. "Otak" AI saat ini dijalankan oleh pipeline modular di `src/v3/` (`V3AgentRunner`, `GoalTracker`, `ContextGrounder`, `ToolExecutionPipeline`, `DeliveryFastPath`, `GenerationStage`, `GuardrailPipeline`).

Muncul pertimbangan apakah sistem sebaiknya beralih ke framework populer seperti **LangGraph (LangChain)** atau **Mastra**, terutama dengan mempertimbangkan pertumbuhan sistem di masa depan, efisiensi, serta kemudahan *maintenance*.

---

## 2. Analisis Komparatif Objektif

### A. LangGraph (LangGraph.js)
* **Kelebihan:**
  - **Ekosistem & Komunitas Matang:** Standar de facto industri, dokumentasi melimpah, dan didukung pendanaan besar.
  - **Tooling Observability Superior:** Integrasi langsung dengan **LangSmith** (visualisasi grafik alur, inspeksi per-node, time-travel replay, prompt diffing, dataset evaluation).
  - **Human-in-the-Loop & Checkpointing:** Manajemen state tersimpan bawaan (pause percakapan berhari-hari lalu dilanjutkan dari checkpoint yang sama).
* **Kelemahan & Risiko:**
  - **Warisan Desain Python:** Banyak konsep yang diadaptasi dari Python (`Runnable`, abstraksi pesan kompleks), menghasilkan type definitions yang rumit di TypeScript.
  - **Dependency Footprint & Breaking Changes:** Menarik ratusan *transitive dependencies* dengan riwayat pembaruan API yang sering memicu *breaking changes*.
  - **Overhead Runtime:** Lapisan abstraksi menambah overhead serialisasi objek yang berpotensi menambah latensi pada WhatsApp (di mana toleransi pengguna < 2–3 detik).

### B. Mastra (`mastra.ai`)
* **Kelebihan:**
  - **Native TypeScript:** Dirancang dari nol untuk ekosistem Node/TypeScript menggunakan `zod` untuk validasi schema. DX (*Developer Experience*) jauh lebih bersih dan ergonomis dibanding LangChain.
  - **Lightweight & Modern:** Struktur agent, workflow (DAG), dan memory terintegrasi rapi dengan local playground UI.
* **Kelemahan & Risiko:**
  - **Usia Ekosistem:** Masih relatif muda, komunitas troubleshooting masih kecil, dan API masih aktif berevolusi.

### C. Custom Pipeline Eksisting (V3 Architecture)
* **Kelebihan:**
  - **Efisiensi Mesin & Latensi Optimal:** Tanpa overhead framework; eksekusi langsung ke endpoint LLM via fetch/SDK native.
  - **Kendali Deterministik Penuh:** Integrasi mudah dengan business logic lokal (Prisma session, calendar, CAPI, fast-path ongkir tanpa Call 2).
* **Kelemahan & Biaya Jangka Panjang (TCO):**
  - **Bus Factor = 1:** Tidak ada dokumentasi publik atau komunitas yang menambal bug. Semua bug concurrency, serialization, dan edge-case harus dirawat mandiri selamanya.
  - **Risiko State Explosion:** Jika cabang percakapan bertambah banyak (komplain, reschedule, multi-cabang), pipeline linier berisiko menumpuk variabel boolean (*spaghetti logic*).
  - **Observability Terbatas:** Saat ini bergantung pada log JSONL dan tabel database internal; tidak ada visual trace waterfall out-of-the-box.

---

## 3. Klarifikasi & Koreksi Teknis (Anti-Strawman)

Dalam mengevaluasi arsitektur, penting untuk menghindari argumen yang keliru:
1. **Dynamic Tool Masking & Fast Path:** Pola ini **bukan** keunggulan eksklusif custom code. LangGraph sepenuhnya mampu melakukan tool masking dinamis (`llm.bindTools(...)` per node) dan short-circuit balasan tanpa LLM via *conditional edges*.
2. **Aturan "Zero New Dependencies":** Merupakan kebijakan tata kelola internal (*governance constraint*), bukan bukti objektif bahwa framework secara teknis lebih inferior.
3. **Observability:** Telemetri log lokal tidak setara dengan platform observability matang (LangSmith/Langfuse). Membangun visual trace dan eval harness sendiri dari nol berbiaya sangat mahal.

---

## 4. Keputusan Arsitektural (Decisions)

### Keputusan 1: TIDAK Melakukan Rewrite Total ke LangGraph / Mastra Saat Ini
* **Alasan:** Sistem sudah berjalan di lingkungan produksi (*live*), menangani booking medis riil, dan telah di-tune untuk latensi WhatsApp. *Switching cost* dan risiko regresi (bug baru, downtime, distorsi guardrail) jauh melampaui potensi manfaat bagi customer saat ini.

### Keputusan 2: Pendekatan Adopsi Modular / Parsial (Unbundling)
Alih-alih biner *all-or-nothing*, sistem akan mengadopsi komponen eksternal secara terpisah jika beban perawatan mulai meningkat:
* **Observability (Prioritas Pertama jika Dibutuhkan):** Adopsi tool *framework-agnostic* seperti **Langfuse** atau **OpenLLMetry (OpenTelemetry)** untuk visual tracing, audit latensi, dan prompt tracking tanpa menyentuh alur logika bisnis bot.
* **Evaluations:** Gunakan tool evaluasi prompt standar (seperti Promptfoo atau Langfuse Evals) untuk mencegah regresi 21 aturan emas.

### Keputusan 3: Strategi Pertumbuhan Alur — Pola "Micro-Graph" Native
Jika kompleksitas percakapan di masa depan meluas (banyak cabang dan intent), sistem tidak perlu langsung menginstal LangGraph, melainkan menerapkan pola **Micro-Graph (~60–80 baris TypeScript)** secara internal:
* Memecah tahapan pipeline menjadi **Nodes** independen (misal: `TriageNode`, `BookingNode`, `FaqNode`).
* Mengatur transisi menggunakan **State Reducer** dan **Conditional Edges** yang eksplisit.
* Menghilangkan penumpukan flag boolean (*anti-spaghetti*) dengan tetap mempertahankan *zero-dependency* dan latensi rendah.

---

## 5. Kriteria Evaluasi Ulang (Triggers for Framework Adoption)

Framework lengkap (LangGraph / Mastra) baru akan dipertimbangkan kembali untuk diinstal jika:
1. Tim engineering bertambah dan membutuhkan standardisasi onboarding berbasis framework publik.
2. Muncul kebutuhan alur *Human-in-the-Loop* multi-hari di mana bot harus menunggu approval staf/dokter berjam-jam/berhari-hari dengan state checkpointing persisten yang kompleks.
