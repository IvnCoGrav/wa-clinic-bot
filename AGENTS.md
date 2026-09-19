# AGENTS.md

WhatsApp clinic chatbot engine: Node 20 + TypeScript, Fastify, Prisma/PostgreSQL, WAHA (WhatsApp HTTP API). Most docs, comments, and CHANGELOG are in **Indonesian** — keep new ones consistent.

## Commands

- `npm run dev` — hot-reload dev server (`tsx watch src/app.ts`). No separate lint/typecheck script exists; `npm run build` (`tsc`) is the typecheck.
- `npm test` — full Vitest suite; `npx vitest run tests/unit/typing.test.ts` — one file.
- `npm run chat` — interactive CLI conversation simulator, no WhatsApp needed.
- `npx tsx src/scripts/check-router-accuracy.ts --days=7` — AI-router shadow-mode accuracy gate (see README for pass criteria).
- `npm run prisma:generate` / `npm run prisma:migrate` / `npx prisma db push` — schema sync.
- Local runs without a real WhatsApp: set `WAHA_MOCK=true` (wired in `src/integrations/waha/client.ts`).

## Tests

- **Run offline — no DB or network required.** `tests/setup.ts` mocks `src/db/client` (all Prisma calls reject with "Database offline") which triggers the in-memory fallback stores, and blanks `ORS_API_KEY` to force the Haversine fallback. Don't start Postgres or change the mocks for unit tests.
- Only `tests/**/*.test.ts` is discovered; services intentionally degrade silently (try/catch fallback) when DB is down — green tests can mask runtime DB failures.
- **Prinsip Adversarial & Real Edge-Case Testing (MANDATORY)**: Pengujian dan unit test tidak boleh hanya menguji *happy path* (jalan pintas agar test hijau). Wajib merancang pengujian berbasis skenario nyata pengguna, kasus batas (*edge cases*), dan uji ketahanan adversial untuk memastikan sistem tidak rapuh di produksi.

## Prisma / migrations (known traps)

- **NEVER run `prisma generate --no-engine`** — it produces an Accelerate-only client that dies at runtime with `P6001` (URL must start `prisma://`). If the engine DLL is locked, kill the locker (dev server / prisma studio), then run full `prisma generate`.
- `npx prisma migrate diff --from-migrations` (shadow replay) is **broken** by `FollowUpStatus` enum ordering in `20260801000000_add_failed_followup_status`. Check drift instead:
  `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script` → must output `-- This is an empty migration.`
- Fresh-env deploy error `relation "children" already exists`: run once `npx prisma migrate resolve --applied 20260802000000_add_children`, then `npx prisma migrate deploy`. Never drop the `children` table.
- Details: `docs/KNOWN_ISSUES.md`, README "Deployment & Runbook Migration".

## Architecture

- Entry `src/app.ts` (`buildApp()`). Boot **requires** `ADMIN_API_KEY`; production also requires `WAHA_WEBHOOK_SECRET`.
- Webhooks: `POST /webhook` (WAHA), `GET|POST /api/webhook/waba` (Meta Cloud). Admin API under `/api/admin/*`.
- WhatsApp traffic goes through the gateway abstraction in `src/integrations/whatsapp/` (WAHA + WABA drivers, per-tenant factory) — use `getGateway()`/`getWabaGateway()`, not `WahaClient` directly.
- Multi-tenant-ready: `DEFAULT_TENANT_ID='default-tenant'` (`src/config/tenant.ts`). Delivery tiers, treatment catalog, persona, and AI model config load from DB at boot.

## Repo conventions (mandatory)

- **SaaS-readiness**: any new feature/config/tuning must be tenant-aware — business data (brand names, message templates, system prompts) MUST come from DB, never hardcoded. Pengecualian (hardcode sementara / tunda tenant-aware) WAJIB lewat **Confirmation Gate** — stop & konfirmasi ke user dengan pros/cons — bila solusi tenant-aware butuh infrastruktur baru / LOC sangat besar / migrasi berisiko.
- **Admin dashboard** (`packages/admin-dashboard`, React): never `window.confirm`/`alert` — use `useUiFeedback`.
- **Known Issues Mandate**: Setiap temuan issue, bug, limitation, atau tech debt yang belum terselesaikan / sengaja ditunda WAJIB dicatat di satu tempat terpusat di `docs/KNOWN_ISSUES.md`.
- **Mandat Non-Hardcode & Data-Driven Architecture (MANDATORY)**: DILARANG KERAS melakukan hardcode data bisnis, daftar kata kunci hafalan, katalog layanan, tarif, rincian SOP, dan template respon ke dalam file TypeScript runtime. Seluruh data bisnis, katalog, SOP klinis, dan kebijakan WAJIB bersumber dari basis data (PostgreSQL/Prisma: tabel `Treatment`, `KnowledgeChunk`, `ClinicPolicy`, `TenantPromptConfig`), sehingga dapat diperbarui secara dinamis oleh admin tanpa perlu merubah atau men-deploy ulang kode. Parsing parameter teknis (seperti URL Google Maps) WAJIB menggunakan API standar (`URL`, `URLSearchParams`) daripada regex hafalan yang rapuh.
- **Mandat Solusi Fondasional & Larangan Solusi Kosmetik / "Make-up" (MANDATORY)**: Setiap rencana perbaikan bug dan optimasi WAJIB menyentuh akar masalah sistemik di lapisan paling dasar (Data/DB schema, State Machine, Tool Contract, RAG/Retrieval). DILARANG KERAS memberikan solusi permukaan/tambal-sulam yang rapuh (seperti sekadar menambah negative constraints di prompt "DILARANG...", menambah regex ad-hoc per-kasus, atau menyembunyikan error per skenario kalimat / "make-up"). Wajib menyertakan analisis akar masalah lintas lapisan (*multi-layer root cause audit*) dan audit posibilitas ke depan (*future implications & regression risks*).
- **Mandat Anti-Penyelesaian Case-by-Case & Larangan Pasrah pada Teks Prompt "DILARANG..." (MANDATORY)**: DILARANG KERAS menyelesaikan bug, regresi, atau kebocoran perilaku AI secara *case-by-case* (ad-hoc per kalimat, menambal skenario per skenario, atau sekadar menambahkan baris instruksi baru "DILARANG..." di dalam teks system prompt). Menaruh kata "DILARANG..." di prompt adalah solusi semu (*make-up*) yang terbukti rapuh karena LLM probabilistik akan selalu memiliki celah melanggarnya. SETIAP aturan pembatas (*guardrails*) dan kontrak alur percakapan WAJIB diwujudkan sebagai **GERBANG KODE DETERMINISTIK (*Hard Code-Level Guards*)**:
  1. **Dynamic Tool Masking Fisik**: Tool yang belum memenuhi prasyarat (seperti `save_reservation` saat customer belum menyepakati booking secara final, atau `calculate_delivery` saat customer tidak menyebutkan entitas lokasi baru) WAJIB DICABUT SECARA FISIK dari daftar `tools` JSON schema yang dikirim ke LLM. LLM tidak boleh diberi akses memanggil tool yang belum sah. DILARANG membuat celah pelonggaran sepihak (seperti pengecualian same-day yang membocorkan `save_reservation` saat customer baru menanyakan ketersediaan slot jam/hari).
  2. **Active User Commitment Mutlak**: State transaksional (penguncian paket di `CartManager`, pemesanan jadwal) HANYA BOLEH dimutasi oleh komitmen aktif eksplisit dari pesan customer (`role === 'user'`). DILARANG KERAS menyerap nama layanan ke dalam keranjang hanya karena asisten pernah menyebutkannya di pesan rekomendasi riwayat chat.
  3. **Deterministic Output Normalizer**: Kendali gaya bahasa yang memiliki kuota tegas (seperti kuota panggilan sapaan "Bunda" maksimal 1x di chat lanjutan) WAJIB dipastikan lewat normalizer/sanitizer deterministik di pipeline output, bukan diserahkan pada kepatuhan teks prompt semata.
  4. **State-Gated Prompt Pruning (Information Hiding pada Prompt)**: DILARANG KERAS mengirimkan cabang instruksi yang bertolak belakang ke dalam prompt yang sama (misalnya: aturan "Jika lokasi belum diketahui..." dikirim bersamaan dengan aturan "Jika lokasi sudah diketahui..."). Prompt WAJIB di-prune secara deterministik di level kode TypeScript berdasarkan status sesi riil: jika data sudah ada di database (`session.location`, `session.cartItems`, dll.), cabang instruksi untuk kondisi "belum ada data" HARAM diikutsertakan dalam prompt LLM agar AI tidak terdistraksi oleh contoh pemicu teks lama.
  5. **Integritas Klinis RAG & Tool (Anti-Pembajakan Parameter)**: Dalam pemanggilan tool katalog klinis (`get_catalog_and_price`), pencocokan gejala medis (`symptoms`) terhadap basis data katalog WAJIB menjadi otoritas tertinggi (*clinical dominance*). Parameter nama layanan spesifik (`specificTreatmentName`) HANYA boleh dihasilkan jika pengguna secara eksplisit menyebutkan nama layanan tersebut di teks pesan masuk, dan DILARANG KERAS memfilter/mengeliminasi rekomendasi keluhan resmi dari database.
  6. **Panggilan Tool Atomik (Atomic Routing & Anti-Parallel Tool Spraying)**: Panggilan Call 1 Router WAJIB menetapkan `parallel_tool_calls: false`. Setiap giliran obrolan customer WhatsApp wajib diselesaikan dengan tepat 1 pemanggilan tool utama yang relevan, mencegah halusinasi pemanggilan multi-tool (seperti mencampuradukkan FAQ metode pembayaran ke dalam konsultasi harga layanan).
- **Mandat Anti-Overfitting & Larangan Hafalan Pola Kalimat / Hardcoded If-Else (MANDATORY)**:
  DILARANG KERAS membuat kode, guardrail, prompt, atau tes yang menghafal kalimat spesifik pengguna (*verbatim sentence matching* / *overfitting* / *hardcoded Q&A*). Chatbot klinik melayani manusia nyata dengan ribuan variasi gaya bahasa, dialek, slang, typo, dan urutan kata yang tak terbatas.
  1. **AI sebagai Semantic Reasoner**: AI (LLM) bertugas memahami maksud (*intent*) dan mengekstrak entitas secara semantik dan fleksibel, BUKAN sebagai mesin pencocok string harfiah (*if-else lookup*).
  2. **Guardrails pada Level State & Kontrak Data**: Setiap pembatas sistem WAJIB bersandar pada **Status Sesi & State Machine** (misal: `session.location != null`, `session.cartItems.length > 0`, `session.status === 'SCHEDULED'`), BUKAN pada pencocokan string teks pengguna (`if (msg.includes("kuota"))`).
  3. **Data-Driven & Dynamic Pruning**: Kontrak dan informasi yang disuntikkan ke AI WAJIB dipangkas (*pruned*) secara deterministik berdasarkan data riil sesi di DB, sehingga AI tidak terjebak membaca aturan kontradiktif (misal: dilarang menanyakan alamat jika alamat sudah tercatat di sesi).
  4. **Adversarial & Multi-Phrasing Testing**: Seluruh pengujian otomatis dan evaluasi WAJIB menguji ketahanan terhadap beragam variasi parafrase nyata (ragam tanya slot jadwal, ragam penyebutan keluhan, ragam konfirmasi), BUKAN hanya meniru persis kalimat yang pernah diketikkan penguji.
- **Mandat Staged-Phase & Micro-Task Implementation Plan (MANDATORY)**: Setiap penyusunan *Implementation Plan* WAJIB dipecah menjadi tahapan berurutan (*staged phases*) berdasarkan *dependency* (apa yang harus beres terlebih dahulu) dan *blast radius*. Setiap fase WAJIB dirinci hingga tingkat tugas mikro (*micro-tasks*) yang sepenuhnya prosedural: lokasi file pasti, baris kode, blok kode pengganti, perintah eksekusi terminal, dan *acceptance criteria* otomatis tanpa memerlukan interpretasi atau tebak-tebakan saat eksekusi. Dilengkapi gerbang regresi (*regression gate*) sebelum berpindah ke fase berikutnya.
- **Mandat Validasi Plan Sebelum Eksekusi & Larangan Eksekusi Solusi Tambal-Sulam (MANDATORY)**: Sebelum mengeksekusi *Implementation Plan* apa pun (termasuk yang disusun oleh user/agen lain), AI Agent WAJIB:
  1. **Verifikasi Klaim Root Cause terhadap Kode & Log Nyata**: DILARANG KERAS mempercayai klaim plan begitu saja. Setiap akar masalah yang disebutkan WAJIB dibuktikan dengan membaca kode aktual (`file:line`) dan log mesin (`logs/*.jsonl`, `logs/*.log`, state DB). Jika klaim plan tidak akurat / keliru skenario, WAJIB dilaporkan secara tegas dan plan direvisi — bukan dieksekusi apa adanya.
  2. **Audit Solusi Anti-Tambal-Sulam**: Setiap Langkah perbaikan dalam plan WAJIB diuji apakah merupakan solusi fondasional (menyentuh Data/DB schema, State Machine, Tool Contract, RAG/Retrieval) atau solusi kosmetik. Solusi yang HANYA berupa penambahan larangan teks prompt ("DILARANG...") untuk mengendalikan perilaku LLM DITOLAK dan WAJIB digantikan gerbang kode deterministik (lihat Mandat Anti-Penyelesaian Case-by-Case). Prompt hanya boleh menjadi lapis sekunder, bukan solusi utama.
  3. **Larangan Eksekusi Buta**: DILARANG KERAS mengeksekusi plan yang mengandung solusi tambal-sulam, hafalan pola kalimat, atau penambalan case-by-case, meskipun plan tersebut diberikan secara eksplisit oleh user. AI Agent WAJIB mengangkat keberatan, mengusulkan revisi fondasional, dan mendapat konfirmasi sebelum eksekusi.
  4. **Verifikasi Environment Plan**: Klaim plan tentang lokasi file, nomor baris, nama fungsi, dan path dataset WAJIB diverifikasi (path sering basi); perbedaan dilaporkan sebelum eksekusi.
- **Strict Investigation Gate ("Investigasi Tuntas Sebelum Koding") (MANDATORY)**: Saat menerima laporan anomali atau bug, AI DILARANG LANGSUNG MENGEDIT KODE. Wajib melakukan investigasi read-only terlebih dahulu: inspeksi log pemanggilan tool (`logs/`), verifikasi payload prompt, periksa state session di database, dan buktikan dengan data konkret. Laporkan hasil audit root cause dan ajukan rencana tindakan terstruktur sebelum menyentuh atau memodifikasi file source code.
- **Mandat Minimalisasi Regex & Larangan Mutilasi Semantik (MANDATORY)**: DILARANG KERAS menggunakan regex sebagai gatekeeper intent pengguna atau untuk memotong/mengamputasi/mengganti kata/nominal di tengah-tengah kalimat bahasa alami LLM (*Mid-Sentence Mutilation Ban* seperti kasus `danya`, `menjadi ,`, atau menimpa angka di kalimat yang sudah dirangkai model). Kendali perilaku LLM WAJIB diselesaikan di level State Machine/Prompt/Grounding/Few-Shot. Regex HANYA diizinkan untuk pembersihan teknis mesin non-semantik (tag thinking AI, format 1-bintang markdown, tag iklan, nomor telepon).
- **Zero New Runtime Dependencies (MANDATORY)**: DILARANG menambah dependency baru di `package.json` runtime tanpa persetujuan eksplisit user. Maksimalkan modul yang sudah ada (`zod`, `crypto`, `fastify`, `@prisma/client`, dll).
- **Larangan Menyentuh Label WAHA (MANDATORY)**: DILARANG KERAS memanggil atau memodifikasi label WhatsApp di WAHA (seperti `wahaClient.addLabel`, `removeLabel`, atau sinkronisasi label WAHA lainnya). Seluruh penandaan label, tag, atau status (seperti "tanya jadwal", MQL, status percakapan) HANYA BOLEH dilakukan di **level internal sistem / database** (tabel `Customer`, session DB, atau livechat internal tag), BUKAN ke WAHA.
- **Mandat Anti-Bloat, Anti-Spaghetti & Modularity-First (MANDATORY)**: DILARANG KERAS membuat halaman baru (*page bloat*), merombak UI baru tanpa justifikasi kuat, atau menulis ulang komponen/logika yang sama secara inline berulang-ulang (*copy-paste spaghetti*). Wajib memaksimalkan dan memanfaatkan terlebih dahulu apa yang sudah ada (*reusability-first*: komponen, hook, utilitas, dan endpoint API yang telah tersedia). Fitur-fitur pendukung atau form konfigurasi kecil WAJIB diintegrasikan sebagai Tab, Drawer, atau Modal konteks di dalam modul induknya, BUKAN dibuatkan page/rute mandiri yang memakan resource memori dan bundle. UI baru HANYA BOLEH dibuat jika memang dirasa benar-benar harus menggunakan UI baru setelah terbukti tidak ada komponen eksisting yang dapat dimanfaatkan atau diperluas secara modular.
- **Mandat Audit Percakapan Menyeluruh & Kepatuhan Rules (MANDATORY)**: Bila user meminta analisa atau audit terhadap hasil percakapan chatbot (simulator, transkrip chat, maupun log live):
  1. AI Agent WAJIB melakukan audit menyeluruh per-putaran (*turn-by-turn deep audit*) dan investigasi log mesin/tool, BUKAN sekadar membaca kesan teks di permukaan. Analisa WAJIB mencakup **5 Dimensi Audit Menyeluruh**:
     - **Dimensi Rules**: Menguji kepatuhan terhadap 21 Aturan Emas / Negative Constraints Mutlak (batasan 2–3 kalimat, anti-sebut harga/durasi tanpa ditanya, anti-todong usia, hierarki jadwal & SOP same-day, kata ganti "kami"/"Bidan kami", anti-overuse "Bunda", anti-kaset rusak, anti-amnesia lokasi/keluhan, anti-tanya jarak km).
     - **Dimensi Flow & UX**: Mengevaluasi kewajaran alur WhatsApp, kelancaran transisi antar-topik, empati klinis Bidan, ketiadaan redundansi penjelasan, dan kesiapan konfirmasi jadwal.
     - **Dimensi Log Mesin**: Menginspeksi log eksekusi teknis LLM (`logs/llm-*.jsonl`), urutan pemanggilan tool (Call 1 Routing vs Call 2 Generation), token usage, latency, status eksekusi, dan arguments yang dikirim ke tool.
     - **Dimensi RAG Chunks**: Mengaudit chunks yang diambil (`retrievedChunks`), skor similaritas (relevance/similarity score), validitas sumber knowledge, dan memeriksa apakah ada chunk asing/kontradiktif yang tersedot ke konteks.
     - **Dimensi Prompt Inspector**: Menginspeksi payload prompt secara mendalam, isi system prompt, blok `[STATUS DATA CUSTOMER SAAT INI]`, riwayat pesan context window, format kalender, dan kebocoran mandat/instruksi tersembunyi yang mendistorsi respons LLM.
  2. AI Agent WAJIB secara aktif menguji kepatuhan setiap jawaban asisten terhadap **seluruh rules yang telah ditanamkan di sistem**:
     - **21 Aturan Emas / Negative Constraints Mutlak**: batasan 2-3 kalimat, larangan menyebut harga/biaya tanpa ditanya, larangan durasi menit tanpa ditanya, larangan menodong usia, kepatuhan hierarki jadwal & SOP same-day jadwal penuh, penggunaan kata ganti "kami"/"Bidan kami" (bukan "saya"), anti-overuse "Bunda", anti-kaset rusak, anti-amnesia lokasi/keluhan, anti-tanya jarak km, dsb.
     - **Kontrak Tool & Alur Pemesanan**: keabsahan pemanggilan `calculate_delivery`, `get_catalog_and_price`, dan larangan keras pemanggilan `save_reservation` sebelum kesepakatan final; pencegahan penguncian layanan secara sepihak atas jawaban ambigu customer (*"boleh deh yang itu"*).
     - **SOP Medis & Katalog Klinis**: validitas rekomendasi terapi sesuai keluhan (misal GTM wajib ke penambah nafsu makan, bukan bapil), aturan pasca-vaksinasi, dsb.
  3. Laporkan audit secara tegas, jujur, dan berani: pisahkan antara aspek yang sudah patuh vs seluruh pelanggaran rules (kritis, sedang, minor), sertakan bukti teknis log pemanggilan tool/state machine, dan ajukan solusi perbaikan fondasional.
- **Mandat Konsultasi & Pemanggilan Skill Otomatis (MANDATORY)**: AI Agent WAJIB selalu secara proaktif mengidentifikasi dan mengkonsultasikan *skill* yang tersedia di `.agents/skills/` sebelum dan saat melakukan tugas:
  - **Investigasi & Debugging Bug**: WAJIB memuat alur `diagnosing-bugs`.
  - **Pengerjaan Fitur / Perbaikan Kode**: WAJIB menerapkan prinsip `tdd` (test-first / red-green-refactor) dan `implement-spec`.
  - **Arsitektur & Refaktor Backend**: WAJIB mengacu pada `codebase-design` (deep modules, seams, information hiding, locality) dan `improve-codebase-architecture`.
  - **Pemodelan Domain & ADR**: WAJIB merujuk pada `domain-modeling`.
  - **Audit, Desain UI/UX & Motion**: WAJIB menerapkan `emil-design-eng`, `review-animations`, dan `improve-animations`.
  - **Mobile Web & Touch Responsiveness**: WAJIB menerapkan checklist `mobile-native`.
  - **Review Perubahan / Diff**: WAJIB memuat panduan `code-review`.
  - **Validasi Rencana & Keputusan**: WAJIB melakukan uji kritis (*stress-test*) dengan `grilling` / `grill-me`.
  - **Manajemen Tiket & Spesifikasi**: WAJIB menggunakan `to-tickets`, `to-spec`, dan `triage`.


## Monorepo (no npm workspaces)

- Root `package.json` = bot engine. Each `packages/*` has its own install/lockfile — run `npm install` inside them.
- `packages/admin-dashboard`: React + Vite + Tailwind. The bot serves its built `dist/` at `/admin/*` — **rebuild it** (`npm run build` in that dir) and restart the bot to see UI changes; or `npm run dev` (Vite) for standalone UI dev.

## Tooling
- graphify knowledge graph in `graphify-out/` (gitignored): use `graphify query/explain/path` for codebase questions and run `graphify update .` after editing code.

## Deploy

- docker-compose pins `devlikeapro/waha:noweb-2026.7.2` (Postgres 16). Never use `:latest` for WAHA; validate WAHA upgrades in staging first. Notes: `deploy_config.txt`, README.
- `.env` holds live credentials and is gitignored — never commit it or its values.
- **Server update & Meta gate**: Testing on live server with potential Meta event triggers requires 2-step verification (Pixel is real). Standard safe deploys require 1-step verification. Any deploy/action with risk of touching/disrupting WAHA requires 2-step verification + explicit WARNING.
