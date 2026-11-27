# F5 — SSE, Realtime, Worker (2026-11-27)

Status: **source selesai; menunggu gerbang full-suite**. G8 = heartbeat cron disimpan di tabel DB baru.

## 1. Perubahan

| Task | Temuan | Perubahan | File |
|---|---|---|---|
| T5.1 | `M09-01-SSE-ADMIN-TENANT-CHANNEL-NO-EVENT-AUTH` | Scope modul Overview dipersempit dari GET `/api/admin/live-chat` (prefix penuh) menjadi `/api/admin/live-chat/unread-count`; event staf (`staff.telemetry_updated`, `staff.task_assigned`, `staff.delay_alert`) hanya diteruskan ke SUPER_ADMIN/SPV_CS. | `src/domain/role-module-scopes.ts`, `src/routes/admin/livechat.subroute.ts` |
| T5.2 | `M09-02-SSE-ADMIN-PAYLOAD-NO-MASKING-LAYER` | Payload `message.created/updated/status_updated` di SSE admin melewati `sanitizeStaffHubPayload`; nomor dimasking untuk peran non-CS/SPV. | `src/routes/admin/livechat.subroute.ts` |
| T5.3 | `M09-14-SUGGEST-REPLY-DEFAULT-TENANT-LLM` | `getLlmEndpointConfig` menerima `tenantId` pada suggest-reply. | `src/services/live-chat.service.ts` |
| T5.4 | `M19-11-SSE-DRAIN-FORCE-EXIT` | Fastify `forceCloseConnections: true`; shutdown menutup live-chat hub lebih dulu, lalu drain cron in-flight sebelum Prisma diputus. | `src/app.ts`, `src/lifecycle/shutdown.ts` |
| T5.5 | `M15-10-BOOT-CRON-UNTRACKED-NO-DRAIN` | Job boot `sheets-sync` dan `media-cleanup` dibungkus `createExclusiveCronTask` sehingga masuk `inFlightCronPromises` dan ikut didrain. | `src/lifecycle/background-crons.ts` |
| T5.6 | `M15-11-REDIS-PUBSUB-PERMANENT-FALLBACK` | Listener `ready` memulihkan `redisEnabled` dan me-resubscribe seluruh channel yang pernah dilanggan; error membersihkan cache langganan. | `src/services/live-chat-hub.service.ts` |
| T5.7 | `M15-12-CRON-HEALTH-CROSS-PROCESS-BLIND` | Tabel `cron_job_heartbeats` + migrasi; setiap start/success/failure/skip menulis heartbeat. `/ready` dan `/api/admin/health` membaca snapshot DB, menandai `DEGRADED` untuk kegagalan beruntun atau job stuck; mode `SEPARATE_WORKER` dengan `NO_JOBS` → **503**. | `prisma/schema.prisma`, `prisma/migrations/20261127000000_add_cron_job_heartbeats`, `src/lifecycle/cron-health.ts`, `src/routes/health.route.ts`, `src/routes/admin/settings-general.subroute.ts` |
| T5.8 | `M15-13-CONTACTS-OUTBOX-RMW-RACE`, `M15-13-CONTACTS-OUTBOX-SILENT-DROP` | Drain memakai lock per item (`setNx` + release); enqueue memakai lock; item yang habis percobaan disimpan di dead-letter 7 hari + alert CRITICAL (bukan hanya `console.warn`). | `src/services/google-contacts-outbox.service.ts` |

## 2. Test baru

`tests/unit/f5-cron-outbox.test.ts` (6 test):
- heartbeat DB → `DEGRADED` saat 3 kegagalan beruntun
- job mulai tapi tak selesai → dianggap gagal (stuck)
- tabel kosong → fallback registry in-memory
- `/ready` mode worker terpisah tanpa heartbeat → `NO_JOBS` + 503
- outbox tidak memproses item saat lock dipegang proses lain
- item habis percobaan masuk dead-letter + alert

## 3. Deviasi & catatan

- **Migrasi DB baru** (`cron_job_heartbeats`) belum dijalankan; deploy harus `prisma migrate deploy` + `prisma generate` sebelum start.
- Heartbeat ditulis fire-and-forget; bila DB offline, registry in-memory tetap dipakai (tidak memblokir cron).
- Event staf di SSE admin masih bisa dilihat SUPER_ADMIN/SPV_CS (peran operasional) — keputusan produk.
- `forceCloseConnections` menutup SSE saat shutdown; klien harus reconnect (EventSource memang otomatis).
- Deteksi stuck memakai `CRON_HEARTBEAT_STUCK_MS` (default 15 menit).
- `readiness-probe.test.ts` disesuaikan: pada `SEPARATE_WORKER=true`, test kini menyediakan heartbeat worker sehat agar tetap menguji jalur queue; test baru F5 menguji kasus NO_JOBS → 503.

## 4. Status temuan

| Fingerprint | Status |
|---|---|
| `M09-01-SSE-ADMIN-TENANT-CHANNEL-NO-EVENT-AUTH` | FIXED in source |
| `M09-02-SSE-ADMIN-PAYLOAD-NO-MASKING-LAYER` | FIXED in source |
| `M09-14-SUGGEST-REPLY-DEFAULT-TENANT-LLM` | FIXED in source |
| `M19-11-SSE-DRAIN-FORCE-EXIT` | FIXED in source |
| `M15-10-BOOT-CRON-UNTRACKED-NO-DRAIN` | FIXED in source |
| `M15-11-REDIS-PUBSUB-PERMANENT-FALLBACK` | FIXED in source |
| `M15-12-CRON-HEALTH-CROSS-PROCESS-BLIND` | FIXED in source |
| `M15-13-CONTACTS-OUTBOX-RMW-RACE` | FIXED in source |
| `M15-13-CONTACTS-OUTBOX-SILENT-DROP` | FIXED in source |

## 5. Gerbang (run final 2026-11-27)

| Perintah | Hasil |
|---|---|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run check:reuse` | 189 = baseline, 0 baru |
| `check-architecture` | 58 = baseline, 0 baru |
| Test F5 + live-chat/health/cron/contacts/rbac | PASS |
| `npm test` penuh | **8598 pass, 1 gagal, 28 skipped** (1096 file) |

Satu-satunya kegagalan: `tests/unit/reuse-gate.test.ts` — durasi gate 85,3 dtk di bawah beban full-suite (ambang 60 dtk). Bukan regresi: test sama gagal di baseline, lulus isolasi, dan gate manual 0 pelanggaran baru. Tidak ada kegagalan fungsional baru.
