# Implementation Plan — AI Chatbot Hardening & Tech Debt Cleanup

**Tanggal:** 2026-08-13
**Status:** Draft (siap dieksekusi)
**Basis:** Audit menyeluruh subsistem AI chatbot + tinjauan `CHANGELOG.md`, `docs/KNOWN_ISSUES.md`, `docs/PERF_AUDIT_2026-08-08.md`, `docs/SAAS_READINESS_AUDIT.md`, dan `docs/ROADMAP.md`.
**Prinsip (mandatory):** `AGENTS.md` — semua perubahan tidak boleh memutus jalur offline/test (DB down → fallback in-memory tetap jalan). Tidak ada nilai bisnis hardcoded baru. Seluruh test wajib hijau di akhir tiap fase.

> **Catatan eksekusi:** Dokumen ini dirancang untuk dieksekusi lintas session. Setiap fase berdiri sendiri, punya Definisi Done jelas, dan bisa di-commit terpisah tanpa menunggu fase lain.

---

## Ringkasan Temuan (hasil audit)

Tiga kategori masalah utama di subsistem AI chatbot:

1. **Bug yang bisa bocor ke customer nyata** — cross-customer FAQ cache poisoning, raw JSON leak di phrasing service, akses `choices[0].message.content` tanpa optional chaining.
2. **Utang teknis & duplikasi** — medical keyword list tersebar 3+ tempat, regex harga 4 tempat, JSON fence-stripping 5 tempat, API-key/baseUrl plumbing copy-paste 6 tempat.
3. **Sinyal mati & konfigurasi tidak konsisten** — flag eskalasi router dihitung tapi tidak dipakai, branch state yang referensikan enum tidak ada, registry model AI tidak tenant-aware.

---

## Urutan Eksekusi yang Disarankan

| Fase | Fokus | Effort | Risiko | Dependensi |
|---|---|---|---|---|
| 0. Operational Deploy | Deploy fix yang sudah di-commit | S | Rendah | — |
| 1. Critical Bug Fixes | Cache poisoning, raw JSON leak, unsafe access | M | Menengah | — |
| 2. Medical Detection Consolidation | Satu sumber keyword + word boundary | S–M | Rendah | — |
| 3. LLM Gateway Abstraction | Dedup plumbing + retry/audit seragam | L | Menengah | — |
| 4. Tenant-Aware Model Registry | Perbaiki config collision + hardcode tenant | M | Menengah | — |
| 5. Error Handling Hardening | Validasi env, retry/backoff, size cap, audit | M | Rendah | Fase 3 (sebagian) |
| 6. Router Signal Cleanup | Honor eskalasi + hapus dead code + entity compare | M | Menengah | — |
| 7. Follow-up Engine Fixes | Idempotency + anti-starvation | S–M | Rendah | — |

**Disarankan kerjakan berurutan 0 → 1 → 2 → 3 → 5 → 4 → 6 → 7.** Fase 0 adalah kemenangan operasional tercepat; Fase 1 menghapus bug paling berbahaya; Fase 3 adalah fondasi untuk Fase 5.

---

## Fase 0 — Operational Deploy (P0, cepat, tidak ubah code)

Tujuan: mengaktifkan perbaikan yang sudah di-commit tapi belum berjalan di production. Ini masalah operasional paling berdampak dan bisa dikerjakan terpisah dari refactor code.

### 0.1 Deploy Redis service
- `docker-compose.yml` sudah mendefinisikan `redis` + `--maxmemory-policy noeviction` (dokumentasi di `docs/PERF_AUDIT_2026-08-08.md` P1), tapi belum di-deploy.
- Aktifkan service Redis di server production. Tanpa ini BullMQ shards, broadcast queue, live-chat pub/sub, dan FAQ cache berjalan di in-memory fallback (job hilang saat restart).

### 0.2 Aktifkan compression
- Caddyfile sudah di-update (`encode gzip zstd`, lihat P7 di PERF_AUDIT) tapi belum aktif. Reload Caddy. Hemat payload 68–72%.

### 0.3 Rotasi Meta CAPI token
- `docs/KNOWN_ISSUES.md` #2: token invalid (error 190, revoked). Rotasi via `PATCH /api/admin/capi-config`.

### 0.4 Rebuild container ke commit terbaru
- Live container berjalan di commit lama (`710e759` vs repo `4ab5817`). Rebuild + redeploy agar tuning Prisma pool ikut terpakai.

### 0.5 Fix migration replay chain
- `docs/KNOWN_ISSUES.md` #1: enum ordering di `20260801000000_add_failed_followup_status` memecah `prisma migrate diff --from-migrations`. Perbaiki migrasi atau squash baseline. Ini menghapus blind spot drift detection.

### 0.6 Verifikasi
- `GET /api/admin/health` kini menampilkan status Redis asli (bukan hardcoded fallback).
- `docker compose ps` menunjukkan Redis running.
- `npx prisma migrate diff` (full chain) sukses.

---

## Fase 1 — Critical Bug Fixes (P0, customer-facing)

Tujuan: menghapus bug yang berpotensi mengirim jawaban salah atau JSON mentah ke customer.

### 1.1 Fix FAQ cache poisoning
- **File:** `src/integrations/llm/generator.ts:133-150` (cache key), `src/services/faq-cache.service.ts`.
- **Masalah:** cache key tidak memasukkan `isLocationKnown` dan `additionalContextText`, padahal keduanya mengubah jawaban (CTA "ask location" vs assumptive-close, fakta ongkir, CTA enforcement). Customer tanpa lokasi bisa menerima jawaban cached milik customer yang sudah tahu lokasi.
- **Aksi:** masukkan hash `isLocationKnown` + `additionalContextText` ke cache key, ATAU scope cache per-conversation. Tambah test unit yang membuktikan dua konteks berbeda tidak saling collide.

### 1.2 Fix raw JSON leak di phrasing service
- **File:** `src/integrations/llm/phrasing.service.ts:167-170`.
- **Masalah:** saat `JSON.parse(cleanJsonContent)` gagal, `content = cleanJsonContent` (raw `{"message": ...}`) dikirim ke customer tanpa guard.
- **Aksi:** setelah fallback, strip/validasi braces; kalau masih berbentuk JSON mentah, gunakan template statis fallback (bukan kirim mentah). Tambah test yang memastikan malformed JSON tidak pernah keluar ke customer.

### 1.3 Guard akses `choices[0].message.content`
- **File:** `src/integrations/llm/generator.ts:323`, `src/integrations/llm/intent.ts:128`, `src/integrations/llm/phrasing.service.ts:151`.
- **Masalah:** tanpa optional chaining, provider dengan body aneh melempar `TypeError` alih-alih masuk jalur fallback.
- **Aksi:** tambah optional chaining + arahkan ke soft-fallback yang sudah ada. Tambah test untuk response body kosong/anomali.

### 1.4 Verifikasi
- `npm run build` + `npm test` hijau.
- Test baru: cache key berbeda per konteks; malformed JSON tidak bocor; response kosong tidak throw.

---

## Fase 2 — Medical Detection Consolidation (P1)

Tujuan: satu sumber kebenaran keyword medis + kurangi false positive yang memicu alert CRITICAL.

### 2.1 Satukan keyword medis
- **File:** `src/config/medical-keywords.ts`, `src/integrations/llm/intent.ts:164`, `src/services/nlu-classifier.service.ts:127-131`.
- **Masalah:** 3 salinan independen. Sudah ada `MedicalDetectionService.checkMedicalKeywords` sebagai single source.
- **Aksi:** hapus array ad-hoc di `intent.ts` dan `nlu-classifier.service.ts`, arahkan semua ke `checkMedicalKeywords`. Pastikan tidak ada perubahan perilaku pada test yang ada.

### 2.2 Word boundary / segment-aware matching
- **File:** `src/config/medical-keywords.ts:132,153`.
- **Masalah:** substring matching menghasilkan false positive: "kaku" match "kakun", "kuning" match "kuningan", "step" match "step by step". HIGH severity memicu alert CRITICAL.
- **Aksi:** tambahkan word-boundary/segment-aware matching untuk keyword pendek, atau whitelist pengecualian. Tambah test false-positive yang harus tidak match.

### 2.3 Verifikasi
- `npm test` hijau (termasuk test medis yang ada).
- Grep: tidak ada array keyword medis tersisa selain di `config/medical-keywords.ts`.

---

## Fase 3 — LLM Gateway Abstraction (P1, besar)

Tujuan: menghilangkan duplikasi plumbing dan menyeragamkan retry/validasi/audit/JSON-extract di semua caller LLM.

### 3.1 Identifikasi duplikasi
- **API-key + baseUrl getter ×6:** `ai-router.ts:719-725`, `intent.ts:26-31`, `generator.ts:31-36`, `phrasing.service.ts:24-29`, `nlu-classifier.service.ts:196,225-226`, `llm-evaluator.service.ts:38-43`.
- **JSON fence-stripping ×5:** `ai-router.ts:868-872`, `intent.ts:131-135`, `generator.ts:327-330`, `phrasing.service.ts:155-157`, `nlu-classifier.service.ts:80-88` (padahal `utils/json-extract.ts` sudah ada).
- **llmOutageStorage check ×4:** `ai-router.ts:736-739`, `intent.ts:47-50`, `generator.ts:51-54`, `phrasing.service.ts:38-41`.

### 3.2 Bangun satu helper gateway
- File baru `src/integrations/llm/llm-gateway.ts` (atau `src/integrations/llm/client.ts`):
  - Satu fungsi untuk resolve `apiKey/baseUrl/model/timeout`.
  - Satu fungsi `extractJsonContent` + `repairTruncatedJson` (reuse `utils/json-extract.ts`).
  - Satu wrapper `callChatCompletions` dengan: transient retry/backoff, optional chaining guard, audit ke `llm-audit-buffer`, dan `response_format` retry.
- Migrasikan caller satu per satu, dimulai dari yang paling sederhana (phrasing → intent → generator → NLU → router → evaluator).

### 3.3 Tambah retry/backoff ke `model-fallback.ts`
- **File:** `src/integrations/llm/model-fallback.ts:46-156`.
- **Masalah:** tidak ada transient retry; 429/5xx/timeout sekali = gagal seluruh chain.
- **Aksi:** tambah retry dengan backoff untuk transient error, jaga agar circuit breaker tetap berfungsi.

### 3.4 Verifikasi
- `npm test` hijau (test existing adalah safety net utama).
- Tidak ada duplikasi `apiKey` getter tersisa (grep gate).
- Build tsc hijau.

---

## Fase 4 — Tenant-Aware Model Registry (P1, SaaS-readiness)

Tujuan: memperbaiki config collision antar-tenant dan menghapus hardcode tenant.

### 4.1 Registry per-tenant
- **File:** `src/config/ai-models.config.ts:20,99-128,161`.
- **Masalah:** registry berupa single global `Map`; `loadConfigsFromDb(tenantB)` menimpa tenant A; `getModelConfig` tanpa parameter tenant.
- **Aksi:** ubah jadi `Map<tenantId, Map<AiTaskType, AiTaskModelConfig>>`, atau tambah parameter `tenantId` ke `getModelConfig`. Perbarui semua caller.

### 4.2 Fix hardcoded tenant sync
- **File:** `src/config/ai-models.config.ts:229`.
- **Masalah:** `updateTaskConfig` memanggil `saveConfigsToDb('default-tenant')` — mengabaikan tenant sebenarnya.
- **Aksi:** teruskan tenantId dari caller; jangan hardcode `'default-tenant'`.

### 4.3 `globalBotActive` per-tenant
- **File:** `src/config/ai-models.config.ts:93`.
- **Masalah:** `globalBotActive` process-global; disable bot = disable semua tenant.
- **Aksi:** buat per-tenant (atau minimal catat sebagai utang jika SaaS multi-tenant belum aktif penuh).

### 4.4 Verifikasi
- `npm test` hijau.
- Test baru: load tenant A dan B tidak saling menimpa; update config tenant A tidak mengubah tenant B.

---

## Fase 5 — Error Handling Hardening (P1)

Tujuan: fail-closed pada env numerik, retry/backoff, size cap, dan audit yang konsisten.

### 5.1 Validasi env numerik
- **File:** `src/config/llm-context.ts:6`, `src/integrations/llm/ai-router.ts:692`, `src/integrations/llm/generator.ts:276`, `src/services/nlu-classifier.service.ts:297`, `src/services/follow-up.service.ts:10`.
- **Masalah:** `parseInt`/`Number` tanpa `isFinite`/clamp; `NaN`/negatif/nol merambat diam-diam.
- **Aksi:** buat helper `parsePositiveInt`/`parseNonNegativeNumber` dengan fallback default, terapkan ke semua env numerik. Tambah test untuk nilai env tidak valid.

### 5.2 Opener-tracker size cap
- **File:** `src/integrations/llm/opener-tracker.ts:12-23`.
- **Masalah:** map unbounded; `cleanupExpired` hanya jalan di `record`/`getOpeners`.
- **Aksi:** tambah size cap (mirip faq-cache yang evict di 500) + evict LRU/TTL saat melebihi batas.

### 5.3 LLM evaluator ikut audit
- **File:** `src/services/llm-evaluator.service.ts:117-133`.
- **Masalah:** panggilan LLM evaluator tidak masuk `llm-audit-buffer`, beda dengan caller lain.
- **Aksi:** tambahkan audit buffer (setelah Fase 3, ini harus pakai gateway helper).

### 5.4 `saveConfigsToDb` tidak silent-fail
- **File:** `src/config/ai-models.config.ts:152-154`, `src/config/ai-router-config.ts:98-100`, `src/config/ai-eligibility-config.ts:112-114`.
- **Masalah:** DB gagal → return `false` / swallow error, cache ≠ DB.
- **Aksi:** log warning eksplisit dengan alasan, pertahankan in-memory fallback tapi jangan diam.

### 5.5 Verifikasi
- `npm test` hijau + test env invalid.
- Grep: tidak ada `parseInt(process.env` tanpa helper.

---

## Fase 6 — Router Signal Cleanup (P1)

Tujuan: hilangkan sinyal mati dan dead code di AI Router.

### 6.1 Honor flag eskalasi router
- **File:** `src/state-machine/machine.ts:336-353`, `src/integrations/llm/ai-router.ts`, `src/services/ai-router-evaluation.service.ts:106-138`.
- **Masalah:** `SCHEDULE_REQUEST` dan `MEDICAL_KEYWORD_SUSPECTED` dihitung + disimpan tapi tidak pernah dipakai; hanya `UNKNOWN_REPEATED` yang dihormati.
- **Aksi:** pilih salah satu — (a) honor flag di full mode, atau (b) hapus `needs_human_escalation` dari schema untuk menghindari sinyal mati. Dokumentasikan keputusan.

### 6.2 Hapus dead state branches
- **File:** `src/integrations/llm/ai-router.ts:424,478`, system prompt `:87`.
- **Masalah:** `AWAITING_CONFIRMATION` dan `AWAITING_RESERVATION_DETAILS` tidak ada di enum Prisma (`prisma/schema.prisma:15-23`); branch tak mungkin tereksekusi.
- **Aksi:** ganti dengan state asli (`LOCATION_CONFIRMED`, `RESERVATION_SENT`) atau hapus. Sinkronkan system prompt.

### 6.3 `compareRouterDecisions` bandingkan entity
- **File:** `src/integrations/llm/ai-router.ts:884-889`.
- **Masalah:** shadow-mode "match" hanya membandingkan intent + escalation flags; kualitas ekstraksi entity tak terlihat.
- **Aksi:** tambah perbandingan entity (location/treatment) ke metrik akurasi shadow.

### 6.4 Bersihkan duplikasi kecil
- `TREATMENT_KEYWORDS` duplikat `'baby spa', 'baby spa'` (`ai-router.ts:180`).
- `RESERVATION_NAME_RE` butuh capital initial (`ai-router.ts:187`) — tambah fallback lowercase.

### 6.5 Verifikasi
- `npm test` hijau.
- `npx tsx src/scripts/check-router-accuracy.ts --days=7` match rate ≥ 85% tetap tercapai.

---

## Fase 7 — Follow-up Engine Fixes (P2)

Tujuan: perbaiki duplikasi dan starvation di follow-up.

### 7.1 Fix dead idempotency check
- **File:** `src/services/follow-up.service.ts:174-181`.
- **Masalah:** `existing` di-fetch tapi tidak pernah dipakai; duplikat `NEXT_TREATMENT` bisa muncul jika dipanggil dua kali.
- **Aksi:** gunakan `existing` untuk guard idempotency (skip jika sudah ada row aktif).

### 7.2 Anti-starvation di `processDueFollowUps`
- **File:** `src/services/follow-up.service.ts:216-233`.
- **Masalah:** `take:` tanpa `orderBy`/cursor → subset arbitrer tiap run, customer bisa kelaparan selamanya.
- **Aksi:** tambah `orderBy` deterministik (mis. `due_at ASC`/`created_at ASC`) + cursor pagination.

### 7.3 Verifikasi
- `npm test` hijau + test duplikat dan deterministik order.

---

## Definisi Done (berlaku untuk semua fase)

- [ ] `npm run build` (tsc) exit 0.
- [ ] `npm test` (Vitest) full hijau — test baru untuk setiap service baru.
- [ ] Tidak ada hardcoded brand/phone/domain baru (grep gate).
- [ ] Jalur DB-down tetap fallback ke in-memory (tidak ada crash baru).
- [ ] Changelog (Bahasa Indonesia) di-update di akhir tiap fase.

---

## Anti-Regresi Checklist

- Jangan commit nilai `.env`.
- Jangan pakai `prisma generate --no-engine` (trap `AGENTS.md`).
- Jangan drop tabel `children` (trap deploy).
- Setiap ubah `delivery_tiers`/`clinic_services` seed → cek test yang assert harga literal.
- Fase 3 (gateway) adalah refactor berisiko — jaga `model-fallback.ts` dan circuit breaker tetap berfungsi, test existing jadi safety net.
- Seluruh simulasi/testing dilakukan di localhost; deploy ke server live hanya atas perintah eksplisit (server-update-gate).

---

## Status Fase

- [x] Fase 1 — Critical Bug Fixes (commit 93b7a19)
- [x] Fase 2 — Medical Detection Consolidation (commit 93b7a19)
- [x] Fase 3 — LLM Gateway Abstraction (commit 93b7a19)
- [x] Fase 4 — Tenant-Aware Model Registry (commit 93b7a19)
- [x] Fase 5 — Error Handling Hardening (commit 93b7a19)
- [x] Fase 6 — Router Signal Cleanup (commit 93b7a19)
- [x] Fase 7 — Follow-up Engine Fixes (commit 93b7a19)
- [ ] Fase 0 — Operational Deploy (butuh akses server; 0.1-0.4, 0.6 terblokir server-update-gate; 0.5 audit selesai → lihat KNOWN_ISSUES #1 "baseline tidak lengkap")
