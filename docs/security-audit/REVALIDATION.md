# Peta Revalidasi — Temuan & Utang Keamanan Lama

> **Status setelah M00 (2026-11-25):** 16 temuan lama = **6 `fixed_in_source`, 10 `partial`**; tidak ada yang masih utuh. Angka `#129.1` dan `#129.2` di bawah sudah kedaluwarsa dan dikoreksi di bagian §2. Hasil lengkap: `~/security-audit-skill/chatbot-ag/M00/run-1/REVALIDATION-RESULT.md`.

Dokumen ini mencegah dua kesalahan: (1) menganggap temuan lama otomatis beres, (2) menemukan ulang hal yang sama tanpa menambah nilai. Setiap item di bawah **wajib** masuk ledger modul terkait sebagai unit `planned` dengan `prior_status` yang sesuai.

Sumber:
- `docs/CYBERSECURITY_AUDIT_REPORT.md` (16 temuan, Sept 2026)
- `docs/KNOWN_ISSUES.md` #129 (remediasi Fase 0–4 + sisa OPEN)
- `docs/KNOWN_ISSUES.md` #367 (dual-source auth staf/admin)
- `docs/KNOWN_ISSUES.md` #336 (PII di localStorage, BY-DESIGN)
- `docs/KNOWN_ISSUES.md` #29 (fallback RAG substring)
- `docs/KNOWN_ISSUES.md` #134, #179 (kebocoran kredensial/PII di repo & git history)

---

## 1. Enam belas temuan audit September 2026

| # | Klaim lama | Status yang diklaim | Modul | Yang wajib dibuktikan ulang sekarang | Bukti minimum |
|---|---|---|---|---|---|
| 01 | Bypass auth webhook Telegram | Dinyatakan fixed (`SEC-AUDIT-01`), fail-closed | M03 | Secret wajib ada; perbandingan timing-safe; tidak ada cabang `if (secret)` opsional; header casing; request tanpa header ditolak 403 | `src/routes/telegram-webhook.route.ts` + test lokal request tanpa secret |
| 02 | Sesi super admin plaintext di filesystem | Diklaim diganti `AdminSession` hash DB | M04, M14 | Token tidak pernah plaintext di DB/file; hash kuat; migrasi legacy menghapus plaintext; fallback memori tidak menulis file | schema `admin_sessions`, service validasi, grep tulis file |
| 03 | BOLA/IDOR pairing token staf | Klaim fixed Fase 1 | M05 | Token pairing: entropi, TTL, sekali pakai, terikat staff/tenant, tidak bisa ditebak/di-enumerasi | `src/routes/staff/auth.subroute.ts`, service token |
| 04 | RBAC custom roles tidak ditegakkan backend | Klaim fixed via `RoleApiScope` default-deny | M06 | Default-deny untuk role berbaris; seed role; route tanpa scope; eskalasi via `:param`; cache invalidasi | `src/domain/role-module-scopes.ts`, `role-scope.service.ts`, matriks kontrak |
| 05 | Path traversal avatar publik | Klaim fixed | M08, M18 | Resolusi path kanonik, tolak `..`, symlink, null byte, URL-encoded traversal, Windows separator | `src/routes/media.route.ts`, handler avatar |
| 06 | SQL sewenang-wenang via restore DB | Klaim fixed: hanya dump JSON internal | M14 | `.sql` ditolak; validasi skema dump; tidak ada `exec` dengan input user; path backup | `src/routes/admin/backup.subroute.ts`, `backup.service.ts` |
| 07 | Isolasi tenant rusak karena hardcode `DEFAULT_TENANT_ID` | Sebagian: livechat/reservations/staff-management dikonversi; **19 file lain masih default** | M07 | Hitung ulang sisa `DEFAULT_TENANT_ID` per file; buktikan cross-tenant read/write pada subroute yang belum dikonversi | grep per file + dummy tenant test |
| 08 | SSRF avatar proxy via redirect 302 | Klaim fixed | M08 | Validasi host per hop redirect, DNS rebinding, IP privat/link-local, skema non-http, timeout, ukuran respons | handler proxy avatar |
| 09 | CSRF pada admin API state-changing | Klaim fixed: header `X-Requested-With` untuk cookie-auth | M04 | Semua route mutasi cookie-auth terkena guard; route yang didaftarkan di luar hook admin; SSE; `SameSite`; preflight | `src/routes/admin.route.ts` hook + daftar route |
| 10 | OAuth Google tanpa verifikasi state | Klaim fixed: HMAC + nonce + TTL | M16 | Secret wajib (tidak fallback diam-diam ke `ADMIN_API_KEY`), nonce sekali pakai, TTL, prefix guard super-admin | `google-integration.subroute.ts`, OAuth client |
| 11 | Token OAuth & Telegram plaintext di DB | Klaim fixed: `encryptSecretIfPossible` + dual-read | M16, M17 | Algoritma, kunci, IV, fallback plaintext, masking respons, rotasi kunci | `src/utils/encryption.ts` + pemakaian |
| 12 | Formula injection CSV rekap finansial | Klaim fixed: prefix `'` | M18 | Semua export (CSV/Excel/Sheets), sel yang diawali `= + - @ TAB CR`, nama file | `escapeCsvCell`, semua pemanggil |
| 13 | Rate limit over-exemption | Klaim fixed: allowList hanya SSE | M19 | Path bypass (`//events`, encoded), kuota webhook, key generator IP/proxy, `TRUST_PROXY_ANY` | `src/app.ts` konfigurasi rate limit |
| 14 | `/state` bocor & `/reset` hapus data | Klaim fixed: gate produksi, soft-delete | M01, M07 | `/state` hanya admin berlabel; `/reset` soft-delete; data terhapus tidak muncul di endpoint lain | handler command |
| 15 | Tracking origin bypass & IP spoof via cookie | Klaim fixed | M08 | Origin/Referer enforcement, cookie `x-forwarded-for` diabaikan, validasi IP publik | `src/routes/tracking.route.ts` |
| 16 | Error DB bocor di `/ready` | Klaim fixed | M19 | Pesan generik ke klien, detail hanya log; `/health` tanpa info sensitif | `src/routes/health.route.ts` |

Aturan: temuan di atas **tidak boleh** dimasukkan ke `findings.json` baru hanya karena ada di laporan lama. Harus ada trace source saat ini + dampak yang masih berlaku.

---

## 2. Sisa OPEN di #129 (harus jadi unit kerja, bukan asumsi selesai)

| Item | Isi | Modul |
|---|---|---|
| #129.1 | **STATUS M00 (2026-11-25): angka lama di bawah sudah tidak berlaku.** Hitungan baru: 24 kemunculan `DEFAULT_TENANT_ID` di 20 file admin; 20 hanya import mati, 2 menyentuh data (`route-helpers.ts:31`, `labels.subroute.ts:47`), 2 perbandingan env pixel. Isolasi kini bocor lewat `x-tenant-id`/`?tenant_id`/body, bukan hardcode (R-53/R-54). Angka historis: `settings` (62), `migration` (29), `customers` (27), `livechat` (26), `labels` (24), `waba` (16), `meta-attribution` (16), `follow-up` (15), `auth` (14), `knowledge` (13), `evaluations` (8), `google-integration` (7), `roles` (7), `quick-replies` (6), `backup` (6), `landings` (6), `push` (5), `analytics` (3), `export` (2) | M07 |
| #129.2 | **STATUS M00: admin_cs/spv_cs sudah di-seed** (migrasi `20261108000000`, `20261114000000`), begitu juga `therapist`, `advertiser`, `admin`. Yang belum punya scope: `TENANT_ADMIN`. Tenant baru setelah migrasi juga belum otomatis di-seed. | M06 |
| #129.3 | **STATUS M00: masih ada.** Filter `deleted_at` hanya di sebagian jalur (`customers-export`, `follow-up`, `shareloc`, `staff-ownership`). Masih tampil di detail customer, flagged, live-chat list, human-handling, map-points, stats/count. Pesan masuk berikutnya me-revive customer (`customer.service.ts:221-229`), jadi arsip hanya sementara | M07, M18 |
| #129.4 | **STATUS M00: open.** Fallback sesi memori per-proses; multi-instance mengembalikan **503** (`SESSION_STORE_UNAVAILABLE`), bukan 401 | M04 |
| #129.5 | **STATUS M00: sebagian.** `TELEGRAM_WEBHOOK_SECRET` sudah ada di `.env.example:220`; `GOOGLE_OAUTH_STATE_SECRET` belum ada | M17 |
| #129.6 | 4 migrasi baru belum di-deploy produksi | M19 |
| #129.7 | Debt arsitektur #128 (god files, silent fallback, sirkular) — bukan temuan keamanan, tapi memperbesar blast radius | M14, M15 |
| #129.8 | Laporan audit mentah dipertahankan sebagai artefak, bukan source of truth | F0 |

---

## 3. Temuan lain yang sudah tercatat

| Sumber | Isi | Modul | Perlakuan |
|---|---|---|---|
| #367 | `/api/admin/auth/me` mengembalikan identitas staf sebagai `user` admin; logout gagal offline menyisakan sesi server | M04, M05 | Unit `planned`; uji kontrak `/me` untuk kedua jenis sesi |
| #336 | PII di `localStorage` + Base64 (BY-DESIGN) | M20 | Bukan otomatis temuan; buktikan dampak lintas-origin/XSS sebelum klaim |
| #29 | Fallback RAG in-memory memakai substring `includes` → over-match | M12 | Uji kebocoran chunk lintas tenant/pengetahuan |
| #134 | Password SSH server pernah ada di `docs/LIVE_SERVER_DEPLOY.md` + `test-results/` | M17 | Verifikasi tidak ada kredensial live di tree saat ini; riwayat git sudah dibersihkan (#179) |
| #179 | PII pasien & API key lama di git history publik | M17 | Verifikasi ulang tidak ada sisa; rotasi kunci yang pernah bocor |
| #128 | Silent fallback DB → memori (74 titik) | M14 | Dampak keamanan: kegagalan DB bisa membuat keputusan otorisasi fallback |
| #250 | Kebocoran balasan AI via worker container | M15 | Uji isolasi worker & routing tenant |

---

## 4. Aturan pemetaan status

- `prior_confirmed_same_source` — hanya bila source, kondisi, dan bukti masih identik. Boleh dibawa dengan fingerprint lama, tetap lewat verifikasi akhir.
- `prior_confirmed_changed_source` — wajib unit revalidasi baru; jangan mengecualikan root cause dari hunting.
- `prior_needs_validation` — tetap `needs_validation` dengan blocker yang sama, kecuali source sekarang menyelesaikannya.
- `prior_rejected` — hanya menekan klaim persis itu; unit cakupannya tetap dibuka.
- `prior_covered_same_source` — tetap tampil di ledger; jangan dianggap "sudah aman".
