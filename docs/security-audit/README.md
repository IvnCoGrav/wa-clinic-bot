# Program Audit Keamanan Siber — End-to-End

Dokumen ini adalah **rencana audit** plus indeks hasil. Temuan aktual dan status per modul ada di [RUNS.md](RUNS.md) dan laporan kampanye `C:\Users\User\security-audit-skill\chatbot-ag\CAMPAIGN-REPORT.md`. Modul dan fase di bawah dirancang agar bisa dijalankan oleh swarm bot satu per satu, dengan bukti yang bisa diverifikasi ulang.

Status per 2026-11-26: seluruh modul M00–M22 sudah dijalankan dan **tidak ada unit `deferred` tersisa** (27 confirmed, 231 needs_validation, 22 rejected). Deferred wave M01–M06 dan M07–M18 ditutup; penutupan 52 unit terakhir menambah 33 temuan `needs_validation` dan menolak 6 kandidat duplikat lintas modul (`M14-04-BACKUP-TENANT-ID-FROM-CLIENT` → M16-05, `M14-06-LEGACY-STAGING-GLOBAL-PHONE-UNIQUE` → M07-01, `M15-01-WEEKLY-BACKUP-CROSS-TENANT-SCOPE` → M07-BACKUP-WHOLE-DB-DUMP, `M15-10-SHUTDOWN-SSE-HIJACK-FORCE-EXIT` → M19-11, `M17-14-READY-DISCLOSURE` → M19-09, `M18-08-HARVEST-AVATAR-PII-RETENTION` → M18-CHAT-EXPORT-PII-NO-RETENTION/M12-HARVEST-UNBOUNDED).

- Katalog modul + daftar periksa atomik: [CHECKLIST.md](CHECKLIST.md) (342 check; 96 di antaranya lahir dari recon, rantai tambahan, revalidasi M00, dan critic di Lampiran A–I)
- Catatan recon awal (kandidat, belum temuan): [RECON-NOTES.md](RECON-NOTES.md)
- Status run & artefak per modul: [RUNS.md](RUNS.md)
- Rencana remediasi bertahap (F0/F1 sudah dieksekusi): [REMEDIATION-PLAN.md](REMEDIATION-PLAN.md)
- Baseline & gerbang F0/F1: [BASELINE-2026-11-26.md](BASELINE-2026-11-26.md)
- Laporan F2 (otoritas tenant): [F2-TENANT-AUTHORITY.md](F2-TENANT-AUTHORITY.md)
- Laporan F3 (media & file): [F3-MEDIA-FILE.md](F3-MEDIA-FILE.md)
- Laporan F4 (data, backup, export): [F4-DATA-BACKUP.md](F4-DATA-BACKUP.md)
- Laporan F5 (SSE, realtime, worker): [F5-SSE-WORKER.md](F5-SSE-WORKER.md)
- Laporan F6 (Copilot & akuntansi LLM): [F6-COPILOT.md](F6-COPILOT.md)
- Laporan F7 (secret & supply chain): [F7-SECRETS-SUPPLY-CHAIN.md](F7-SECRETS-SUPPLY-CHAIN.md)
- Laporan F8 (determinisme ingress): [F8-INGRESS-DETERMINISM.md](F8-INGRESS-DETERMINISM.md)
- **Hasil remediasi F0–F9 (penutup): [REMEDIATION-RESULT.md](REMEDIATION-RESULT.md)**
- Peta revalidasi temuan lama: [REVALIDATION.md](REVALIDATION.md)
- Skill yang dipakai: `.agents/skills/security-audit/` (Cloudflare security-audit, sudah dipatch untuk Windows)

---

## 1. Model tiga lapis

| Lapis | Isi | Kenapa dipisah |
|---|---|---|
| **Fase (F0–F9)** | Urutan kerja audit: persiapan → recon → hunting → validasi → output → verifikasi → laporan → remediasi → rantai lintas modul → re-audit | Supaya bot tidak melompat ke "cari bug" sebelum batas kepercayaan dan kontrolnya dipetakan |
| **Modul (M00–M22)** | Area serang berdasarkan trust boundary nyata di repo ini | Supaya satu bot hanya memegang satu konteks, tidak kelelahan, dan cakupan bisa dihitung |
| **Wave (W1–W6)** | Urutan eksekusi modul berdasarkan dependensi | Temuan ingress/identitas menentukan bobot temuan modul lain; menjalankan modul data lebih dulu akan salah prioritas |

Satu "bot" = satu penugasan (assignment). Satu modul bisa 10–25 penugasan.

---

## 2. Aturan main yang wajib dipatuhi setiap bot

1. **Read-only terhadap source.** Tidak ada bot yang mengedit kode/tests. Perbaikan ditulis sebagai rencana di laporan.
2. **Eksekusi target hanya di sandbox** (tanpa jaringan keluar, env allowlist, target read-only, tulis hanya ke `scratch/`, limit CPU/mem/proses/waktu). Kalau sandbox tidak tersedia, jangan eksekusi: catat `needs_validation` dengan blocker persisnya. Ini aturan skill, bukan opsional.
3. **Jangan menyentuh server live, WAHA, Meta, Google, Telegram, atau DB produksi.** Recon hanya membaca source dan konfigurasi lokal.
4. **Satu bot tidak memvalidasi temuannya sendiri.** Validator harus agen baru yang mencoba membantah.
5. **Severity hanya untuk `confirmed`.** `needs_validation` tidak punya severity; `rejected` tetap dicatat sebagai bukti bantahan.
6. **Klaim wajib `file:line`.** "Sepertinya rawan" bukan temuan.
7. **Hormati Confirmation Gate repo**: rencana remediasi yang menyentuh runtime wajib disetujui manusia sebelum dieksekusi.

---

## 3. Fase

### F0 — Persiapan (sekali per kampanye)

| Task | Isi | Gate lulus |
|---|---|---|
| F0-1 | Tentukan output root di luar repo: `~/security-audit-skill/chatbot-ag/<modul>/run-1` | Folder dibuat, repo tetap bersih (`git status` tidak berubah) |
| F0-2 | Siapkan sandbox (Docker/VM) + Node 20 + Postgres dummy bila perlu | Env allowlist, jaringan keluar mati, tulis hanya scratch |
| F0-3 | Bekukan baseline test: `npm run build`, `npm run typecheck`, `npm test` | Baseline tercatat (jumlah file/test lulus/gagal) |
| F0-4 | Inventaris environment: versi Node, OS, flag `WAHA_MOCK`, `SEPARATE_WORKER`, `TOOL_MASKING_ENFORCE`, `TRUST_PROXY_*` | Tercatat di `run-metadata.json` |
| F0-5 | Tetapkan budget agen kampanye dan per modul (lihat §6) | Budget ≥ minimum (4 recon + critic + verifier) |
| F0-6 | Tentukan profile per modul: `quick` / `standard` / `deep` | Tercatat di [CHECKLIST.md](CHECKLIST.md) |

### F1 — Reconnaissance & coverage ledger (per modul)

Menghasilkan `architecture.md` (maks ±1.000 kata) dan `coverage-ledger.json` tervalidasi.

- Petakan: principal, entry surface, boundary, sink, lifecycle, kontrol terkuat.
- Setiap unit ledger = kombinasi `surface × boundary × subsystem × attack_class` (+ `lifecycle` bila material).
- **Seed W1 tersedia**: [ledger/W1/coverage-ledger.json](ledger/W1/coverage-ledger.json) — 91 unit menutup 98 check M01–M07, sudah lolos validator. Salin ke output dir, verifikasi surface-nya terhadap source saat ini, tambah unit yang kurang, lalu validasi ulang. Jangan mengedit seed di repo saat run berjalan.
- Jalankan `node .agents/skills/security-audit/validate-coverage-ledger.cjs <ledger>`.
- Keluaran yang diwajibkan: daftar unit `planned`, daftar `out_of_scope` (modul lain), dan daftar `deferred` bila budget habis.

### F2 — Hunting wave (per modul)

- Satu hunter per 1–3 unit ledger; prompt wajib memuat blok serangan yang dipilih **verbatim** dari skill.
- Wave 1 = unit berisiko tertinggi (auth, tenancy, uang, ingress).
- Setelah wave: **coverage critic** mencari unit yang belum tersentuh/terlalu sempit.
- Keluaran: `units[]` (covered/candidate/blocked), `candidates[]`, `hardening[]`, `uncovered[]`.

### F3 — Candidate validation (per modul)

- Setiap kandidat unik → fingerprint → verifier baru yang **mencoba membantah**.
- Verifier tidak boleh melihat catatan hunter selain fingerprint + klaim.
- Hasil: `confirmed`, `needs_validation`, atau `rejected`.

### F4 — Structured output (per modul)

- Tulis `findings.json` untuk ketiga verdict.
- Jalankan `validate-findings.cjs` + `report-schema.json`.
- Jalankan ulang `validate-coverage-ledger.cjs` setelah update.

### F5 — Independent record verification (per modul)

- `confirmed` diverifikasi agen baru pada source terbaru.
- Penggantian material (source berubah / bukti diganti) wajib verifier independen kedua.
- Temuan yang tidak lolos turun jadi `needs_validation`/`rejected`, bukan dihapus diam-diam.

### F6 — Reporting (per modul)

- `REPORT.md`, `FINDINGS-DETAIL.md`, `NEEDS-VALIDATION.md` diturunkan dari record final.
- Tidak ada instruksi probe live di laporan; hanya bukti lokal + rencana validasi aman.

### F7 — Remediasi & gerbang regresi (per modul)

- Setiap `confirmed` → invariant yang harus dijaga + perubahan source terkecil + test regresi.
- Rencana ditulis dulu, dieksekusi hanya setelah persetujuan manusia.
- Gate: `npm run build` + `npm run check:reuse` + suite terkait + full suite tanpa failure baru.

### F8 — Rantai lintas modul (sekali per kampanye, setelah semua modul)

- Bot baru membaca **semua** ledger + findings modul.
- Mencari rantai: ingress → AI → DB → notifikasi; staf → admin API → lintas tenant; public XSS → sesi admin; SSRF → metadata internal; backup → kredensial DB.
- Rantai hanya boleh `confirmed` bila setiap prasyaratnya sudah `confirmed` (atau diverifikasi lokal).

### F9 — Re-audit berkelanjutan

- Delta run setelah perubahan besar; baca ledger lama, revalidasi source yang berubah.
- Skill menyatakan satu run tidak pernah menghabiskan target; profil `deep` + beberapa run menaikkan cakupan.

---

## 4. Kontrak luaran per run

```
~/security-audit-skill/chatbot-ag/<modul>/run-<N>/
├── run-metadata.json      # profile, scope_paths, budget, status
├── architecture.md        # ringkasan boundary & kontrol
├── coverage-ledger.json   # unit + evidence, tervalidasi
├── findings.json          # confirmed / needs_validation / rejected
├── REPORT.md
├── FINDINGS-DETAIL.md
├── NEEDS-VALIDATION.md
└── agents/<agent-id>/artifacts/   # hanya bukti lokal yang dipromosikan parent
```

`run_status` hanya boleh `complete` bila artefak F6 lengkap dan kedua validator lulus. Selain itu `incomplete` + alasan persis.

---

## 5. Matriks cakupan (alat anti-lupa)

Cakupan dihitung, bukan diklaim. Untuk setiap modul, bot F1 wajib mengisi tabel berikut di `architecture.md` sebelum hunting:

| Dimensi | Wajib diisi | Contoh |
|---|---|---|
| Entry surface | Semua cara data masuk | `POST /webhook`, `GET /api/admin/...`, file upload, cron, env |
| Principal | Siapa yang lebih rendah trust | anonim, customer WA, staf terapis, admin CS, super admin, cron, model LLM |
| Boundary | Kontrol yang seharusnya menolak | secret webhook, sesi, RBAC scope, tenant filter, tool mask, sandbox |
| Sink | Efek berbahaya | query DB, `fs.write`, `exec`, `fetch`, kirim WA, render HTML |
| Lifecycle | Kalau ada | create → update → cancel → archive → delete → restore |

Modul dinyatakan **selesai** hanya bila:
1. Setiap entry surface yang terlihat di source punya minimal satu unit `covered` atau alasan `out_of_scope`/`not_applicable`.
2. Semua unit `planned` habis (covered/candidate/blocked/deferred dengan alasan).
3. Validator ledger + findings lulus.
4. Tidak ada `candidate` tanpa verdict.
5. `hardening[]` dicatat (bukan temuan, tapi jangan hilang).

---

## 6. Profil & perkiraan budget

| Profile | Kapan | Ciri |
|---|---|---|
| `quick` | Modul kecil/pemanasan, re-run | 1 wave + 1 critic, unit kasar |
| `standard` | Default | Wave + critic + verifier terpisah |
| `deep` | Modul berisiko tinggi (auth, tenancy, uang, AI, DB, infra) | Unit per subsystem + lifecycle, critic sampai bersih, verifikasi ganda |

Perkiraan per modul: **10–25 penugasan** (recon 1–2, hunter 3–8, critic 1–2, verifier 2–6, output 1, record verification 1–4, report 1, remediation 1). Total kampanye 23 modul (M00–M22): **±250–350 penugasan**. Jalankan maksimal 3–4 bot paralel agar tidak rebutan CPU dan tidak mencampur konteks.

---

## 7. Template prompt bot

### 7.1 Hunter (F2)

```
Kamu hunter keamanan untuk satu modul audit. Tugasmu menemukan kegagalan invariant
keamanan yang terbukti dari source, lalu mengembalikan TEPAT satu objek JSON sesuai
kontrak structured result skill security-audit.

Target repo: C:\Users\User\Documents\chatbot AG
Modul: <Mxx — nama>
Coverage IDs yang ditugaskan: <daftar dari coverage-ledger.json>
Starting paths: <daftar file>
Attack class: <blok verbatim dari ATTACK-CLASSES.md / companion>
Batasan: read-only, tanpa jaringan, tanpa server live, tanpa DB produksi.
Eksekusi hanya di sandbox; jika tidak ada sandbox → needs_validation.

[buntel: architecture.md verbatim]
[buntel: blok attack class verbatim]
[buntel: metode hunting + promotion procedure + validation rules verbatim]
```

### 7.2 Verifier (F3)

```
Kamu verifier independen. Kamu TIDAK menemukan kandidat ini dan tidak boleh
mempercayainya. Tugasmu membantahnya.
Bukti awal: fingerprint + klaim + trace (tanpa catatan hunter).
Periksa source saat ini, coba semua kondisi yang membatalkan klaim.
Keluarkan satu verdict: confirmed | needs_validation | rejected, dengan alasan source.
```

### 7.3 Coverage critic (setelah wave)

```
Baca coverage-ledger.json dan architecture.md. Temukan entry surface/boundary/lifecycle
yang belum punya unit, unit yang terlalu luas, dan unit yang ditutup tanpa bukti cukup.
Kembalikan daftar unit baru (canonical refs) + unit yang harus dibuka ulang + alasannya.
```

### 7.4 Record verifier (F5)

```
Verifikasi ulang record <fingerprint> pada source terbaru. Cocokkan setiap langkah
trace dengan file:line saat ini. Jika ada yang bergeser, tandai dan minta verifier
kedua. Jangan mengubah severity tanpa bukti dampak baru.
```

### 7.5 Peran bot (penting sebelum menyebar swarm)

Jangan menjalankan satu bot per baris check tanpa orkestrator. Skill ini bekerja dengan **parent** yang memegang `coverage-ledger.json`; hunter tidak boleh menulis ledger sendiri.

| Peran | Jumlah | Tugas | Boleh menulis file? |
|---|---|---|---|
| **Module Orchestrator** (parent) | 1 per modul | F1 recon, seed ledger, assign hunter, gabungkan hasil, update ledger, jalankan validator | Ya, hanya di output dir modul |
| **Hunter** | 3–8 per modul | Baca source untuk unit yang ditugaskan, kembalikan JSON | Tidak (hanya `scratch/`) |
| **Coverage Critic** | 1–2 per wave | Cari unit yang kurang/terlalu luas | Tidak |
| **Verifier** | 1 per kandidat | Bantah kandidat | Tidak |
| **Record Verifier** | 1 per record confirmed | Verifikasi ulang source terbaru | Tidak |
| **Reporter / Remediation Planner** | 1 | Turunkan laporan & rencana fix | Ya, di output dir |

Satu "swarm bot" yang dijalankan user = **Module Orchestrator**. Ia yang menelurkan hunter/verifier. Daftar check di [CHECKLIST.md](CHECKLIST.md) adalah bahan bakar untuk hunter, bukan 342 run terpisah.

### 7.6 Contoh urutan perintah untuk satu modul

```
1. Orchestrator: "Jalankan skill security-audit untuk modul M04 (Auth & sesi admin).
   Scope: lihat docs/security-audit/CHECKLIST.md#m04. Profil deep.
   Output: ~/security-audit-skill/chatbot-ag/M04/run-1. Jangan menyentuh source."
2. Orchestrator menyelesaikan F1 → ledger tervalidasi → baru sebar hunter.
3. Setelah wave: critic → reassign bila perlu.
4. Kandidat → verifier independen → findings.json → validator.
5. Record verification → REPORT.md / FINDINGS-DETAIL.md / NEEDS-VALIDATION.md.
6. Baru lanjut modul berikutnya di wave yang sama.
```

### 7.7 Larangan saat swarm berjalan

- Jangan menjalankan dua modul yang berbagi boundary yang sama secara paralel bila ledger-nya belum stabil (mis. M04 dan M06).
- Jangan menyalin temuan antar modul tanpa revalidasi source.
- Jangan mengirim prompt yang berisi data pelanggan asli ke provider LLM mana pun.
- Jangan menjalankan `npm run dev`, `prisma migrate`, atau menyentuh WAHA/DB produksi dari sesi audit.


---

## 8. Urutan wave

| Wave | Modul | Alasan |
|---|---|---|
| **W1** | M00, M01, M02, M03, M04, M05, M06, M07 | Identitas, ingress, tenancy. Semua temuan lain bergantung pada siapa bisa mencapai apa |
| **W2** | M13, M14, M09, M10 | Uang, data, realtime, asisten admin |
| **W3** | M11, M12, M16 | AI core, RAG, integrasi keluar |
| **W4** | M08, M18, M20, M21 | Permukaan publik, file/export, frontend, log/PII |
| **W5** | M15, M17, M19 | Worker, supply chain, infra |
| **W6** | M22 | Rantai lintas modul (butuh semua ledger) |

Modul dalam satu wave boleh paralel, tetapi **F1 semua modul wave wajib selesai sebelum F2 wave tersebut** — supaya ledger tidak saling bertentangan.

---

## 9. Revalidasi wajib (jangan dianggap beres)

Sebelum hunting baru, jalankan [REVALIDATION.md](REVALIDATION.md): 16 temuan audit September 2026 dan 8 sisa pekerjaan di `docs/KNOWN_ISSUES.md` #129. Temuan lama yang source-nya berubah **bukan** otomatis `confirmed`; harus diverifikasi ulang pada source sekarang. Temuan lama yang tidak berubah dan masih terbukti boleh dibawa dengan fingerprint yang sama.

---

## 10. Definisi selesai kampanye

1. Semua modul M00–M22 punya `run_status: complete` **atau** `incomplete` dengan alasan eksplisit.
2. `findings.json` setiap modul lolos `validate-findings.cjs`.
3. `coverage-ledger.json` setiap modul lolos `validate-coverage-ledger.cjs`.
4. Laporan F8 (rantai lintas modul) ada dan setiap klaim rantai punya prasyarat terverifikasi.
5. Ringkasan eksekutif menampilkan: jumlah unit, cakupan per modul, confirmed per severity, needs_validation, rejected, dan **daftar area yang belum tercakup** — tanpa klaim "sistem aman".
