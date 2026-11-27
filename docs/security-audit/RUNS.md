# Status Run Audit

Lokasi artefak: `C:\Users\User\security-audit-skill\chatbot-ag\<run>\run-1\` (di luar repo).

| Run | Status | Confirmed | Needs validation | Rejected | Coverage | Catatan |
|---|---|---|---|---|---|---|
| M00 | complete | — | — | — | 16 temuan lama | 6 fixed_in_source, 10 partial; koreksi #129.1/#129.2 (tidak memakai findings.json) |
| M01 | complete | 3 | 8 | 0 | 16 unit (covered: 2, candidate: 14) | LID label, ack, burst, /reset ya, media |
| M02 | complete | 5 | 2 | 0 | 13 unit (covered: 1, candidate: 12) | Status 500, reaction dedup, STOP bypass/coalesce, type mapping |
| M03 | complete | 0 | 10 | 0 | 12 unit (covered: 3, candidate: 9) | /set_* RBAC, /start rebind, edited_message, alert recipient/cooldown |
| M04 | complete | 0 | 19 | 0 | 16 unit (covered: 5, candidate: 11) | /me tenant, auth log, CSRF/login, lockout, rotation, impersonation |
| M05 | complete | 4 | 6 | 1 | 19 unit (covered: 7, candidate: 12) | Gap ditutup M05b (5 deferred) |
| M05b | complete | 4 | 2 | 5 | 5 unit (covered: 1, candidate: 4) | Menutup 5 unit critic M05 |
| M06 | complete | 0 | 13 | 0 | 15 unit (covered: 3, candidate: 12) | staff RBAC/tenant, supervisor string, overgrant, landing reset |
| M07 | complete | 5 | 8 | 3 | 21 unit (covered: 9, candidate: 12) | Deferred wave: 4 unit ditutup (1 covered, 3 NV) |
| M08 | complete | 4 | 11 | 0 | 19 unit (covered: 5, candidate: 14) | Deferred wave: 10 unit ditutup (4 covered, 6 NV) |
| M09 | complete | 1 | 9 | 3 | 18 unit (covered: 9, candidate: 9) | Deferred wave: 8 unit ditutup (5 covered, 3 NV) |
| M10 | complete | 0 | 9 | 0 | 12 unit (covered: 3, candidate: 9) | Deferred wave: 5 unit ditutup (5 NV) |
| M11 | complete | 0 | 8 | 1 | 13 unit (covered: 4, candidate: 9) | Unicode bypass, latch komitmen, pushname, riwayat asisten, token cost |
| M12 | complete | 0 | 6 | 1 | 11 unit (covered: 3, candidate: 8) | Trust boundary KB, staging lintas tenant, fallback memori, PII, harvest |
| M13 | complete | 0 | 11 | 1 | 14 unit (covered: 3, candidate: 11) | Harga klien, race customer, hold, proof publik, underpaid, series, backdate |
| M14 | complete | 0 | 12 | 3 | 15 unit (covered: 8, candidate: 7) | Deferred wave: 7 unit ditutup (5 covered/mapped, 1 NV baru) |
| M15 | complete | 0 | 18 | 0 | 14 unit (covered: 2, candidate: 12) | Deferred wave: 6 unit ditutup (8 NV baru) |
| M16 | complete | 0 | 11 | 0 | 11 unit (covered: 3, candidate: 8) | OAuth replay, body tenant, backup lintas tenant, pageview CAPI, push SSRF/PII, LLM key, alert |
| M17 | complete | 0 | 13 | 0 | 14 unit (covered: 2, candidate: 12) | Deferred wave: 6 unit ditutup (6 NV) |
| M18 | complete | 0 | 13 | 1 | 14 unit (covered: 3, candidate: 11) | Deferred wave: 6 unit ditutup (1 covered, 1 NV baru) |
| M19 | complete | 0 | 10 | 0 | 12 unit (covered: 2, candidate: 10) | Hermes control plane publik, WAHA webhook PII, XFF spoof, container hardening, /ready, deploy |
| M20 | complete | 0 | 9 | 0 | 11 unit (covered: 5, candidate: 6) | Legacy innerHTML XSS, href javascript:, CSP unsafe-inline, SSE revoke, stack trace, cache PII |
| M21 | complete | 0 | 12 | 0 | 10 unit (covered: 4, candidate: 6) | PII JSONL/emergency/app log, log injection, retensi, DBURL alert, Markdown, orphan derived store |
| M22 | complete | 1 | 11 | 3 | 15 unit (covered: 3, candidate: 12) | Staff CS ke label lintas tenant confirmed; 11 rantai NV; 3 ditolak |

Semua run memiliki artefak `REPORT.md`, `NEEDS-VALIDATION.md`, `FINDINGS-DETAIL.md`, `findings.json`, `coverage-ledger.json`, dan `architecture.md`.

## Total temuan confirmed per modul

| Modul | High | Medium | Low | Fingerprint |
|---|---|---|---|---|
| M01 | 0 | 3 | 0 | M01-08-LABEL-LID-AS-PHONE, M01-14-YA-CONFIRM-COALESCED, M01-15-RESET-AMBIGUOUS-YA |
| M02 | 0 | 4 | 1 | M02-10-STATUS-UNKNOWN-PHONE-500, M02-11-REACTION-PRE-DEDUP-MUTATION, M02-12-STOP-BYPASS-EARLY-RETURN, M02-12-STOP-LOST-BY-COALESCE, M02-13-WABA-TYPE-MAPPING-GAP |
| M05 | 1 | 1 | 2 | M05-05-message-row-wa-message-id-unmasked, M05-05-sse-status-updated-unmasked, M05-13-staff-tenant-header-query-bypass, M05-14-telegram-pairing-token-replay |
| M05b | 0 | 4 | 0 | M05b-M05-15-session-token-in-body, M05b-M05-16-pairing-rotation-keeps-chat-binding, M05b-M05-17-push-to-revoked-staff, M05b-STAFFLOGIN-LOCKOUT-DOS |
| M07 | 2 | 3 | 0 | M07-16:services-catalog-reads-default-tenant, M07-BACKUP-WHOLE-DB-DUMP, M07-CUSTOMER-MEMORY-CROSSTENANT, M07-LABEL-IDOR, M07-LANDINGS-IDOR |
| M08 | 1 | 2 | 1 | M08-AVATAR-CROSS-TENANT, M08-LANDING-QUERY-XSS, M08-PAGEVIEW-UNAUTH, M08-PROOF-PUBLIC |
| M09 | 0 | 0 | 1 | M09-09-AUDIT-ACTOR-SPOOF |
| M22 | 1 | 0 | 0 | M22-02-STAFF-SESSION-ADMIN-API |
| **Total** | **5** | **17** | **5** | **27 confirmed** |

## Status remediasi (2026-11-27)

Remediasi F0–F9 selesai di source (belum di-commit/di-deploy). Ringkasan hasil, sisa risiko, dan checklist deploy: [`REMEDIATION-RESULT.md`](REMEDIATION-RESULT.md). Detail per fase: `F2-TENANT-AUTHORITY.md` … `F8-INGRESS-DETERMINISM.md`. Status per fingerprint: `docs/KNOWN_ISSUES.md` #377.

## Langkah berikutnya

1. Seluruh M00–M22 sudah dijalankan dan tidak ada unit `deferred` tersisa.
2. Validasi runtime 231 temuan `needs_validation` begitu sandbox/DB uji tersedia (server live tetap dilarang). Tanpa sandbox statusnya TETAP `needs_validation`.
3. Review & commit perubahan source F0–F9, lalu deploy bertahap memakai checklist `REMEDIATION-RESULT.md` §5 (migrasi `cron_job_heartbeats`, `.env.worker`, digest image, kontrak `/ready` baru).
4. `M07-20` menunggu keputusan G5 + migrasi data; `M08-PROOF-PUBLIC` tetap risiko diterima (G3).

