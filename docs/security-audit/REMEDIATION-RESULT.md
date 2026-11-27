# Hasil Remediasi Keamanan F0–F9 (2026-11-27)

Dokumen penutup kampanye audit keamanan 2026-11-26. Semua perubahan ada di **source** (working tree, belum di-commit/di-deploy). Tidak ada dependency runtime baru dan tidak ada mutasi label WAHA.

## 1. Ringkasan eksekusi

| Fase | Cakupan | Status | Gerbang regresi |
|---|---|---|---|
| F0 | Seam bersama (`tenant-id`, `script-escape`, `spreadsheet-escape`, `landing-fields`, `landing-url`, `media-limits`) | DONE | 36 test baru |
| F1 | Permukaan publik (XSS landing, DTO tenant, MIME file, CSP, cache) | DONE | 8535 pass / 1 gagal (reuse timing) |
| F2 | Otoritas tenant & identitas | DONE sebagian (T2.7 ditunda G5) | 8548 / 1 |
| F3 | Media & file | DONE (T3.2 dilewati G3) | 8559 / 1 |
| F4 | Data, backup, export, Sheets | DONE sebagian (ownership file residual) | 8585 / 2 (keduanya `copilot-tools.ts` di luar F4) |
| F5 | SSE, realtime, worker, cron health | DONE | 8598 / 1 |
| F6 | Copilot & akuntansi LLM | DONE | 8616 / 1 lalu 8615 / 2 timeout beban (lulus isolasi) |
| F7 | Secret & supply chain | DONE (G10a + G11a) | 8666 / 1 |
| F8 | Determinisme ingress WAHA/WABA | DONE | 8692 / 1 (`reuse-gate` timing; lulus isolasi) |
| F9 | Close-out | DONE | lihat §5 |

Baseline F1: **8535 test lulus / 1096 file**. Akhir F8 (setelah perbaikan review): **8692 lulus / 1111 file / 28 skipped** — bertambah 157 test regresi keamanan.

## 2. Temuan yang ditutup (FIXED in source)

Rincian per fingerprint ada di laporan fase (`F2-…` s.d. `F8-…`). Ringkas:

- **F1 (7):** `M08-LANDING-QUERY-XSS`, `M08-LANDING-PIXEL-SCRIPT-INJECT`, `M08-TENANT-CONTENT-DUMP`, `M08-FILES-MIME-ECHO`, `M08-CSP-REPORT-LOG-FLOOD`, `M08-PUBLIC-HTML-CACHE-POISON`, `M08-PAGEVIEW-UNAUTH` (CAPI tidak lagi memakai atribusi kiriman klien).
- **F2 (10):** `M05-13-staff-tenant-header-query-bypass`, `M07-CUSTOMER-MEMORY-CROSSTENANT`, `M07-LABEL-IDOR`, `M07-LANDINGS-IDOR`, `M07-16-services-catalog-reads-default-tenant`, `M09-09-AUDIT-ACTOR-SPOOF`, `M18-12-TENANT-PATH-TRAVERSAL`, `M07-17-LEAD-MODERATION-NO-OWNERSHIP`, `M07-19-WABA-MULTI-ENTRY-SECRET-SELECTION`, `M05-05-*` (SSE staf), `M22-02-STAFF-SESSION-ADMIN-API`.
- **F3 (4):** `M08-AVATAR-CROSS-TENANT`, `M18-15-AVATAR-ANON-PII`, `M18-11-INBOUND-BUFFER-BEFORE-QUOTA`, `M18-01-INBOUND-NO-MIME-WHITELIST`.
- **F4 (6 + migrasi):** `M15-01-WEEKLY-BACKUP-CLAIM-FAILOPEN`, `M15-01-WEEKLY-BACKUP-NO-RETRY-AFTER-FAILURE`, `M14-13-RESTORE-FALSE-SUCCESS`, `M14-15-GZIP-BOMB-RESTORE`, `M18-13-SHEETS-FORMULA-INJECTION`, `M15-14-SHEETS-FAILED-TERMINAL-SILENT-LOSS`, `M16-02-ADMIN-BODY-TENANT-OVERRIDE`; `M07-BACKUP-WHOLE-DB-DUMP` dimigasi ke dump per tenant (global eksplisit untuk operator).
- **F5 (9):** `M09-01-SSE-ADMIN-TENANT-CHANNEL-NO-EVENT-AUTH`, `M09-02-SSE-ADMIN-PAYLOAD-NO-MASKING-LAYER`, `M09-14-SUGGEST-REPLY-DEFAULT-TENANT-LLM`, `M19-11-SSE-DRAIN-FORCE-EXIT`, `M15-10-BOOT-CRON-UNTRACKED-NO-DRAIN`, `M15-11-REDIS-PUBSUB-PERMANENT-FALLBACK`, `M15-12-CRON-HEALTH-CROSS-PROCESS-BLIND`, `M15-13-CONTACTS-OUTBOX-RMW-RACE`, `M15-13-CONTACTS-OUTBOX-SILENT-DROP`.
- **F6 (6):** `M10-05`, `M10-09`, `M10-10` (rate + budget), `M10-11`, `M10-12`.
- **F7 (7):** `M17-02`, `M17-08`, `M17-11`, `M17-12`, `M17-13` (bundle + watchdog), `M19-09`.
- **F8 (8):** `M01-08`, `M01-14`, `M01-15`, `M02-10`, `M02-11`, `M02-12` (×2), `M02-13`.

## 3. Yang belum ditutup (jujur)

| Item | Status | Alasan / prasyarat |
|---|---|---|
| `M07-20-CONFIG-FALLBACK-DEFAULT-TENANT` | **DITUNDA** | Butuh keputusan G5 (default brand/lokasi netral) + migrasi data tenant lama. |
| `M08-PROOF-PUBLIC` | **RISIKO DITERIMA** (keputusan pengguna G3) | Link bukti bayar dibiarkan tanpa expiry. Mitigasi termurah bila diinginkan: `no-store` + `noindex` + `no-referrer`. |
| Ownership file backup per tenant (residual F4) | **SEBAGIAN** | Otoritas tenant beres; nama/artifact file masih global. |
| 231 temuan `needs_validation` | **TETAP NV** | Butuh sandbox/DB uji + WAHA mock; tanpa itu validasi runtime dilarang (server live tidak disentuh). |
| Kuota & semaphore Copilot per proses | **RESIDUAL** | Multi-replika → batas efektif × jumlah replika; token harian tetap akurat (DB). Pindah ke Redis bila replika >1. |

## 4. Verifikasi akhir (F9)

| Pemeriksaan | Hasil |
|---|---|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| Dashboard `tsc --noEmit` + `npm run build` | PASS |
| `npm run check:reuse` | 189 = baseline, 0 baru |
| `check:architecture` | 58 = baseline, 0 baru |
| Validator `validate-findings.cjs` | **23/23 artefak PASS** |
| Validator `validate-coverage-ledger.cjs` | **23/23 artefak PASS** |
| Delta audit file yang berubah | Tidak ada `eval`/`new Function`/`child_process`/`dangerouslySetInnerHTML`; tidak ada log nilai secret. `exec(` yang tersisa hanya `RegExp.exec`. |
| `npm test` penuh (F8 final, setelah perbaikan review) | **8692 pass, 1 gagal, 28 skipped** — `reuse-gate` 64,2 dtk di bawah beban (lulus 14/14 isolasi). Flake media #368 tidak muncul di run ini. |

## 5. Checklist deploy (belum dieksekusi)

1. **Migrasi DB:** `npx prisma migrate deploy` + `npx prisma generate` — migrasi baru `20261127000000_add_cron_job_heartbeats` (F5). Fresh-env: resolve `20260802000000_add_children` bila perlu.
2. **Env worker (G11a):** jalankan `node scripts/generate-worker-env.mjs` lalu `node scripts/check-env-contract.mjs` (sudah otomatis di `deploy-prod.sh`/`vps-migrate-import.sh`). `.env.worker` wajib ada; compose fail-closed tanpa file itu.
3. **Kunci peta:** pindahkan `VITE_CARTO_API_KEY` → `CARTO_API_KEY` di `.env` server (kompatibilitas lama tetap dibaca); rotasi tidak butuh rebuild.
4. **Digest image:** semua image dipin `@sha256`. Deploy yang menyentuh image WAHA **wajib 2-step verification + WARNING** (G12). Prosedur update di `deploy_config.txt`.
5. **Kontrak `/ready`:** sekarang hanya `{status}`. Script/healthcheck yang membaca `checks.*` harus pindah ke `GET /api/admin/health`.
6. **Watchdog:** jalankan ulang `scripts/install-server-watchdog.sh` agar `.watchdog.env` + cron memakai format baru (token via config curl, bukan URL).
7. **Migrasi VPS (bila dipakai):** bundel kini terenkripsi ENC1; simpan `BACKUP_ENCRYPTION_KEY` out-of-band, verifikasi checksum wajib.
8. **Tanpa dependency baru** — tidak ada perubahan `package.json` runtime (hanya script npm `env:worker`/`check:env-contract`).

## 6. Kesimpulan

Seluruh fase remediasi F0–F9 selesai di source dengan gerbang regresi terdokumentasi. Tidak ada klaim "sistem aman": sisa risiko yang diterima (link bukti bayar, kuota per proses, ownership file backup) dan 231 temuan NV dicatat eksplisit di `KNOWN_ISSUES` #377 dan laporan fase. Langkah berikutnya adalah review/commit, lalu deploy bertahap dengan checklist di §5.
