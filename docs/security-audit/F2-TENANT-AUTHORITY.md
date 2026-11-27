# F2 — Otoritas Tenant & Identitas (2026-11-26)

Status: **source selesai & gerbang lokal PASS**. T2.7 (default brand/lokasi) **ditunda** karena butuh keputusan G5 + migrasi data.

## 1. Perubahan

| Task | Temuan | Perubahan | File |
|---|---|---|---|
| T2.1 | `M05-13` (confirmed), `M22-02` | Tenant sesi staf ditulis ke `request.tenantId` dari `staff_session`; header/query tidak bisa memindahkan tenant. Tenant sesi tidak valid → 401. | `src/routes/staff.route.ts` |
| T2.2 | `M18-12` | `resolveSessionTenantId`/`tenantOf` memvalidasi pola tenant; `scopeDir`/`paymentProofDir`/`toRelativeUrl`/`toPaymentProofUrl` memakai seam yang sama; prune/quota memakai `tenantMediaBase` yang resolve di bawah `MEDIA_ROOT`. | `src/routes/admin/route-helpers.ts`, `src/services/media.service.ts` |
| T2.3 | `M07-CUSTOMER-MEMORY-CROSSTENANT` (confirmed) | Cache memori hanya dikembalikan bila `tenant_id` cocok; update label cache juga tenant-scoped. | `src/services/customer.service.ts` |
| T2.4 | `M07-LABEL-IDOR`, `M07-LANDINGS-IDOR` (confirmed), `M07-16` (confirmed) | Customer/label/landing di-resolve dengan `tenant_id`; GET/PUT/DELETE landing memfilter tenant; katalog admin memakai tenant sesi; `resolveTreatmentValue` menerima tenant. | `labels.subroute.ts`, `landings.subroute.ts`, `settings-catalog.subroute.ts`, `live-chat.service.ts`, `purchase-detection.service.ts` |
| T2.5 | `M07-17` | Lead `lead_*` wajib lolos kepemilikan tenant sebelum audit; seam `isLeadOwnedByTenant` di service (bukan route) agar pagu Prisma route tetap. | `src/services/lead-moderation.service.ts`, `reservation-dispatch-payment-proof.subroute.ts` |
| T2.6 | `M07-19` | Mode app-secret per tenant menolak payload dengan >1 `phone_number_id` (400) sebelum signature diverifikasi. | `src/routes/waba-webhook.route.ts` |
| T2.8 | `M16-05` | Backup create/upload/restore memakai tenant sesi; `tenantId` dari body/query diabaikan. | `src/routes/admin/backup.subroute.ts` |
| T2.9 | `M09-09` (confirmed), `M05-05` (confirmed) | Audit pin/hide memakai identitas sesi (header/body tidak bisa memalsukan); SSE staf mem-mask `message.status_updated`. | `livechat.subroute.ts`, `staff/today.subroute.ts`, `utils/pii-masker.ts` |
| T2.7 | `M07-20` | **DITUNDA** — default netral + migrasi data butuh G5. | — |

## 2. Test baru

- `tests/unit/f2-tenant-isolation.test.ts` — validasi tenant, traversal media, cache customer ber-tenant, masking status.
- `tests/integration/f2-tenant-authority.test.ts` — staf vs header, lead ownership, WABA multi-entry, backup tenant sesi, landing tenant scope, katalog tenant.

Test lama yang disesuaikan (kontrak keamanan baru):
- `tests/unit/landing-admin-tenant-honesty.test.ts` — mock `findFirst` (bukan `findUnique`).
- `tests/unit/live-chat-pin-hide.test.ts` — identitas via `x-admin-identity`, bukan `x-admin-name`/body.
- `tests/unit/rbac-livechat-contract.test.ts` — `copilotService.chat` di-mock agar test RBAC tidak menembak provider LLM nyata (timeout/retry). Ini juga memperbaiki flakiness lama (#101).

Registry modul kanonis diperbarui (`scripts/module-registry.json` + `npm run docs:modules`): `security.tenant_id`, `security.script_escape`, `data.spreadsheet_escape`, `landing.field_contract`.

## 3. Deviasi & catatan

- **T2.7 ditunda**: mengubah default brand/lokasi tanpa backfill berisiko mengosongkan identitas tenant lama. Menunggu keputusan G5.
- **Backup ownership**: `tenantId` sudah tidak bisa dipilih klien, tetapi file backup lokal belum diberi namespace tenant sehingga `/download` belum bisa memverifikasi kepemilikan per file. Ini tetap bagian F4 (retensi/partisi backup).
- **WABA per-tenant secret**: perilaku berubah hanya bila `WABA_APP_SECRET` kosong. Deployment dengan app secret global tidak terpengaruh.
- **Audit identity**: `x-admin-identity` masih dihormati untuk pemegang `X-API-KEY` root (operator), sesuai desain; staf tidak bisa memakainya.

## 4. Status temuan

| Fingerprint | Status |
|---|---|
| `M05-13-staff-tenant-header-query-bypass` | FIXED in source |
| `M07-CUSTOMER-MEMORY-CROSSTENANT` | FIXED in source |
| `M07-LABEL-IDOR` | FIXED in source |
| `M07-LANDINGS-IDOR` | FIXED in source |
| `M07-16:services-catalog-reads-default-tenant` | FIXED in source |
| `M09-09-AUDIT-ACTOR-SPOOF` | FIXED in source |
| `M18-12-TENANT-PATH-TRAVERSAL` | FIXED in source |
| `M07-17-LEAD-MODERATION-NO-OWNERSHIP` | FIXED in source |
| `M07-19-WABA-MULTI-ENTRY-SECRET-SELECTION` | FIXED in source (mode per-tenant secret) |
| `M16-05-BACKUP-TENANT-OWNERSHIP` | FIXED in source (otoritas tenant; ownership file menyusul di F4) |
| `M05-05-*` (2 confirmed) | FIXED in source untuk jalur SSE staf; jalur REST mengikuti sanitizer yang sama |
| `M22-02-STAFF-SESSION-ADMIN-API` | FIXED in source (tenant staf dari sesi) |
| `M07-20-CONFIG-FALLBACK-DEFAULT-TENANT` | **DITUNDA** (G5) |

## 5. Gerbang (run final 2026-11-26)

| Perintah | Hasil |
|---|---|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run check:reuse` | 189 = baseline, 0 baru |
| `check-architecture` | 58 = baseline, 0 baru |
| `npx vitest run tests/unit/f2-* tests/integration/f2-*` | 18/18 PASS |
| `npm test` penuh | **8548 pass, 1 gagal, 28 skipped** (1089 file) |

Satu-satunya kegagalan: `tests/unit/reuse-gate.test.ts` — durasi gate **66,15 dtk** di bawah beban full-suite (ambang 60 dtk). Bukan regresi: test sama gagal di baseline F1 (60,025 dtk), lulus isolasi (14/14), dan gate manual 0 pelanggaran baru. Tidak ada kegagalan fungsional baru.

Catatan tambahan:
- `docs/MODULE_INDEX.md` diregenerasi dan 4 seam baru didaftarkan (47 modul).
- `rbac-livechat-contract` diperbaiki agar tidak memanggil provider LLM nyata (flaky #101).
- `module-registry` sempat gagal karena dokumen belum diregenerasi setelah registry berubah; sudah disinkronkan.
