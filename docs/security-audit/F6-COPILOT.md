# F6 — Copilot & LLM Accounting (2026-11-27)

Status: **source selesai; gerbang regresi PASS**. Nilai kuota mengikuti rekomendasi G9: 6 req/menit per principal, 20k token/turn, 500k token/hari/tenant.

## 1. Perubahan

| Task | Temuan | Perubahan | File |
|---|---|---|---|
| T6.1 | `M10-09-COPILOT-BODY-CONTRACT` | Kontrak body runtime: `history` wajib array maks 10 pesan, `role` hanya `user`/`assistant`, `content` 1–4.000 char, `conversationId`/`customerId` wajib pola ID; entri dibangun ulang `{role, content}` sehingga properti/role kiriman klien tidak pernah masuk transcript provider. | `src/routes/admin/copilot.subroute.ts` |
| T6.2 | `M10-10-COPILOT-RATE-GLOBAL-BUCKET` | Modul kanonis `ai.copilot_quota`: bucket 6 req/menit **per principal** (staffId sesi → identitas sesi cookie → hash API key → IP) dipakai bersama `/chat` + `/stream`. Limiter rute lama (`config.rateLimit` max 6 dengan bucket API key bersama) **dihapus** karena menolak staf lain sebelum helper kuota sempat berjalan. `x-admin-identity` pada auth API key tidak lagi menjadi principal (header klien bisa diputar untuk mengakali kuota). | `src/services/copilot/copilot-quota.ts`, `src/routes/admin/copilot.subroute.ts` |
| T6.2 | `M10-10-COPILOT-TOKEN-BUDGET` | Modul kanonis `ai.copilot_token_budget`: plafon 20k token/turn dan 500k token/hari/tenant (`COPILOT_MAX_TOKENS_PER_TURN`, `COPILOT_MAX_TOKENS_PER_DAY`). Agregasi `llm_audit_logs` dibatasi `task_type = AI_COPILOT_CHAT` (trafik WhatsApp tidak memblokir Copilot) dan memakai **nilai terbesar** antara DB dan catatan in-memory karena audit ditulis lewat buffer 10 detik/20 baris. | `src/services/copilot/copilot-budget.ts`, `src/routes/admin/copilot.subroute.ts` |
| T6.3 | `M10-05-COPILOT-ABORT-SEMAPHORE` | `signal` Hermes diteruskan ke `fetch` (listener dilepas di `finally`), semaphore per tenant punya TTL 330 dtk, `try` dimulai sebelum penandaan/hijack, dan pembatalan `/chat` memakai `reply.raw` + `writableEnded` (bukan `request.raw` yang menyala setelah body terbaca). Token cap menghentikan loop dengan `COPILOT_TOKEN_BUDGET_EXCEEDED` saat belum ada data. | `src/services/copilot/hermes-adapter.ts`, `src/services/copilot/copilot.service.ts`, `src/routes/admin/copilot.subroute.ts` |
| T6.4 | `M10-12-HERMES-NO-USAGE` | Akuntansi token untuk **semua** engine: `total_tokens` atau `prompt+completion`; Hermes bridge tanpa `usage` memakai estimasi deterministik (bukan 0); panggilan lanjutan `finish_reason=length` ikut dicatat (sebelumnya tidak pernah masuk akuntansi); `llmCalls` dihitung setelah panggilan sukses. Tarif `hermes-agent` eksplisit Rp0 (`provider: Hermes (internal)`) agar dashboard tidak memakai `fallback-unverified`. | `src/services/copilot/copilot.service.ts`, `src/utils/cost-calculator.ts` |
| T6.5 | `M10-11-COPILOT-DEGRADED-UNSANITIZED` | Semua jalur degradasi melewati pipeline kanonis yang sama dengan jawaban normal: `sanitizeCopilotAnswer` → `repairCopilotChatLinks` → `stripOrphanChatLinks` → `validateGrounding` (nilai `grounded` dihitung, bukan hardcode `true`). Nama pasien dan `lastMessage` (teks kiriman pelanggan) dinetralkan dari sintaks tautan Markdown; renderer dashboard hanya mengaktifkan tautan `http(s)` dan `/admin/live-chat` (skema `javascript:`/`data:` dirender sebagai teks). | `src/services/copilot/copilot.service.ts`, `packages/admin-dashboard/src/components/copilot/AdminCopilotPanel.tsx` |

## 2. Test baru

`tests/unit/f6-copilot-contract.test.ts` (6 test):
- `history.role = system` → 400 dan service tidak dipanggil
- history > 10 pesan, content > 4.000 char, ID konteks tidak valid → 400
- request ke-7 dalam 1 menit → 429 `COPILOT_QUOTA_EXCEEDED` + `Retry-After`
- bucket per principal: staf A dan B terpisah; `x-admin-identity` tidak mengubah bucket; sesi cookie memakai identitas DB
- bucket pulih setelah window 60 detik (`retryAfterSec` = 59)
- kuota token harian habis → 429 `COPILOT_DAILY_BUDGET_EXCEEDED`

`tests/unit/f6-copilot-accounting.test.ts` (4 test):
- provider tanpa `usage` → token tetap > 0 (estimasi deterministik)
- panggilan lanjutan `finish_reason=length` ikut tercatat (`llmCalls` = 4, `max_tokens=600` terpanggil)
- plafon token/turn → loop berhenti, data mentah disajikan, bukan error
- jawaban degradasi tidak membuka tautan markdown dari nama/pesan pelanggan

`tests/unit/f6-copilot-budget.test.ts` (6 test):
- agregasi hanya `task_type=AI_COPILOT_CHAT` + batas hari WIB
- DB tertinggal (buffer) → pemakaian in-memory menutup anggaran
- DB offline → fallback in-memory (bukan izin tanpa batas)
- isolasi antar-tenant
- estimasi per turn punya lantai 2.000 token
- env tidak valid (`-1`, `abc`) → fallback default, bukan melemahkan plafon

## 3. Deviasi & catatan

- **Kontrak body** diimplementasikan sebagai parser runtime eksplisit (bukan Fastify JSON schema) agar pesan 400 deterministik dan `additionalProperties` tidak diam-diam diterima; validasi tetap lapis kode, bukan prompt.
- **Kuota** ditempatkan di modul khusus yang dipanggil kedua rute, bukan di `app.ts` global `keyGenerator`. Alasannya: mengubah `keyGenerator` global mengubah perilaku seluruh rute admin (termasuk bucket SSE/webhook) dan membuat kuota Copilot bergantung pada header; satu seam per operasi lebih aman.
- **Anggaran harian** sengaja hanya menghitung `AI_COPILOT_CHAT`. Jika seluruh trafik LLM tenant dihitung, lonjakan chat WhatsApp akan memblokir Copilot padahal pemilik anggarannya berbeda. Bila kelak ingin anggaran LLM tenant menyeluruh, itu keputusan produk terpisah (butuh penegakan di semua pemanggil LLM).
- **Estimasi token** hanya dipakai bila provider tidak mengirim usage (Hermes bridge, respons cacat). Nilai ini konservatif: tujuannya mencegah kebocoran anggaran, bukan menggantikan tagihan provider.
- **Limiter rute 6/menit dihapus**; perlindungan banjir tetap ada dari limiter global (1000/menit per API key / IP) ditambah kuota per principal.
- **Dimensi principal** pada akuntansi biaya tersedia di `audit_logs.admin_identity` (setiap turn Copilot menulis audit), sedangkan `llm_audit_logs` tidak punya kolom principal. Sesuai G9, kuota bersifat per principal dan anggaran token bersifat per tenant; agregasi token per principal belum tersedia dan tidak ditambahkan pada F6 (butuh migrasi kolom + plumbing ke semua pemanggil LLM).
- `MAX_HISTORY_TURNS` (10) dipakai untuk body request; context window service tetap 10 turn seperti sebelumnya.

## 4. Status temuan

| Fingerprint | Status |
|---|---|
| `M10-05-COPILOT-ABORT-SEMAPHORE` | FIXED in source |
| `M10-09-COPILOT-BODY-CONTRACT` | FIXED in source |
| `M10-10-COPILOT-RATE-GLOBAL-BUCKET` | FIXED in source |
| `M10-10-COPILOT-TOKEN-BUDGET` | FIXED in source |
| `M10-11-COPILOT-DEGRADED-UNSANITIZED` | FIXED in source |
| `M10-12-HERMES-NO-USAGE` | FIXED in source |

Residual (dicatat di `KNOWN_ISSUES.md` #377): kuota dan semaphore bersifat **per proses** (in-memory). Pada deployment multi-replika, batas efektif = 6 × jumlah replika per principal; agregasi token harian tetap akurat karena bersumber DB. Bila replika ditambah, pindahkan bucket ke Redis (satu seam: `ai.copilot_quota`).

## 5. Gerbang (run final 2026-11-27)

| Perintah | Hasil |
|---|---|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| Dashboard `tsc --noEmit` | PASS |
| `npm run check:reuse` | 189 = baseline, 0 baru |
| `check-architecture` | 58 = baseline, 0 baru |
| `npx vitest run copilot` | 248 pass (30 file) |
| `npm test` penuh | **8616 pass / 1 gagal (run 1)**, lalu **8615 pass / 2 gagal (run final)**, 28–29 skipped, 1099 file. Semua kegagalan adalah timeout beban mesin: `reuse-gate` 94,6 dtk (ambang 60 dtk), `staff-auth-and-reservation` GPS 15 dtk, dan hook `reservation-silent-failure-audit` 30 dtk. Ketiganya **lulus saat dijalankan terpisah** (`reuse-gate` 14/14; dua file lain 52/52) — bukan regresi fungsional. |

Bukti `reuse-gate` pre-existing: test yang sama gagal dengan pola identik pada baseline F1–F5 ketika full suite berjalan di bawah beban, dan lulus isolasi dengan 0 pelanggaran baru (`npm run check:reuse` = 189 baseline).
