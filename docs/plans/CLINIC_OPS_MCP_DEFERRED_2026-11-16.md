# Deferred Feature Decision Record — `clinic-ops-mcp`

- **Status:** DEFERRED (ditunda)
- **Tanggal keputusan:** 2026-11-16
- **Pemilik keputusan:** user
- **Implementasi:** belum ada; `src/mcp/` tidak dibuat
- **Dokumen audit/plan asal:** sesi audit plan 2026-11-16 (HEAD `8e65834d`)

Dokumen ini menyimpan keputusan, batasan, dan temuan audit agar fitur MCP tidak
dieksekusi setengah jalan atau diulang dari nol saat dilanjutkan.

---

## 1. Keputusan

1. Fitur `clinic-ops-mcp` **ditunda** sampai prioritas berikutnya.
2. Rencana dan hasil audit **tetap disimpan** di dokumen ini.
3. **Tidak perlu tombol on/off** di admin UI untuk saat ini.
4. Ke depan, MCP dapat berjalan sebagai **standby aktif** (selalu tersedia),
   terutama bila ingin diakses dari Claude web/aplikasi mobile.
5. Belum ada kode, migrasi, dependency, atau konfigurasi host yang diubah.

---

## 2. Keputusan yang sudah dibekukan (jika dilanjutkan)

| Topik | Keputusan |
|---|---|
| Scope rilis pertama | **Read-only dulu**; write actions di fase terpisah |
| Dependency protokol | **Official MCP SDK** (`@modelcontextprotocol/sdk`), pin versi exact |
| Sumber metrik | **Pakai service yang sudah ada** (`FinancialAnalyticsService`, `MetaPerformanceAnalytics`, `StaffRetentionService`, Copilot tools); bukan engine baru |
| Repeat order | **Dilarang** memakai `is_repeat_order` sebagai otoritas; gunakan definisi first-ever reservation |
| Payment | Pisahkan `approve_purchase_event` (CAPI) dan `record_payment` (kasir); `purchase_review_status` bukan status uang |
| Tenant | `tenantId` wajib di semua tool; siap SaaS, walau akses sekarang hanya owner/admin |
| PII | Risiko dicatat; mask nomor HP/alamat secara default untuk pencarian massal; PII penuh hanya untuk audit admin berwenang |
| Migrasi status history | **Tidak** untuk v1 read-only; metrik yang butuh histori lengkap ditunda atau diberi label kualitas data |
| Tombol on/off | **Tidak** termasuk scope |
| Profil deployment | stdio untuk Claude Desktop/OpenCode/Claude Code; HTTP remote untuk Claude web/mobile (fase terpisah) |

---

## 3. Scope yang disarankan saat dilanjutkan

### v1 read-only
- `get_clinic_metadata` — kategori aktif dari `ClinicService`, staff aktif, status domain, status review pembayaran.
- `query_clinic_metrics` — hanya dimensi/metrik yang punya definisi kanonis; tanpa `is_repeat_order`.
- `search_clinic_conversations` — reuse `query_unscheduled_prospects`/`query_stalled_inquiries` bila memungkinkan; predicate reservasi aktif dari `domain/reservation-status.ts`.
- `inspect_entity_360` — reuse detail customer existing dan `StaffRetentionService`; tanpa klaim status compliance yang belum punya data.

### Fase terpisah (belum disetujui)
- Write actions (`create_reservation`, `record_payment`, reassign, cancel) setelah service kanonis diekstrak dari route.
- HTTP transport untuk Claude web/mobile, dengan HTTPS, auth, rate limit, read-only DB role.
- `ReservationStatusHistory` + `booking_time_source` bila metrik keterlambatan/status akan dipakai.

---

## 4. Ringkasan temuan audit (jangan diulang)

### Kritis
| ID | Temuan | Bukti utama |
|---|---|---|
| A-001 | Dua sumber kebenaran metrik | `financial-analytics.service.ts:131,224-244`; `meta-performance-analytics.service.ts:19-23`; `METRIC_DEFINITIONS.md:1-2` |
| A-002 | `verify_payment` mencampur CAPI dengan pembayaran; status `'verified'` tidak ada | `capi-review-status.ts:14-19`; `domain/reservation-payment.ts:3`; `staff-reservation.service.ts:1795-1900` |
| A-003 | Seam kanonis payment/reassign/cancel masih di route | `reservation-dispatch-payment-proof.subroute.ts:276-335`; `reservation-dispatch-crud.subroute.ts:580-680`; `reservation-dispatch-status.subroute.ts:184-199` |
| A-004 | Kontrak tool tidak tenant-scoped | `prisma/schema.prisma` (`tenant_id` di semua tabel); plan tanpa `tenantId` |
| A-005 | Write actions tanpa auth/konfirmasi | `src/app.ts:37-39`; `admin.route.ts:63`; MCP stdio tidak melewati auth |
| A-006 | PII/transkrip terekspos ke host AI eksternal | `copilot-tools.ts:5,509,796`; plan mengembalikan PII mentah |

### Tinggi
| ID | Temuan | Bukti utama |
|---|---|---|
| A-007 | `console.log`/Prisma stdout merusak JSON-RPC | `audit.service.ts:49`; `reservation-core.service.ts:963,966,1046,1097`; `db/client.ts:9` |
| A-008 | Protokol MCP belum lengkap (JSON Schema, lifecycle, error envelope) | `package.json` tanpa SDK/zod-to-json-schema; plan hanya 4 method |
| A-009 | Data status history/booking time/preferred staff belum ada | `prisma/schema.prisma`; `KNOWN_ISSUES.md:262-270` |
| A-010 | Search percakapan bukan semantik; index pesan tidak ada | `Message` tanpa trigram; `Direction.INBOUND/OUTBOUND`; `domain/reservation-status.ts` |
| A-011 | Query engine tanpa batas range/group/timeout | plan; `wib-time.ts` tersedia tetapi tidak dipakai |
| A-012 | Test global mock Prisma bisa hijau meski SQL gagal | `tests/setup.ts:468-470`; `KNOWN_ISSUES.md:1391` |

### Sedang/rendah
- A-013: MCP berbagi DB/pool dengan webhook; “zero blast radius” hanya level proses.
- A-014: Config host `npx tsx` + `cwd` tidak andal; `tsx` tidak ada di production image (`Dockerfile:46`).
- A-015: Mandat dokumentasi/micro-task belum dipenuhi.
- A-016: Inkonsistensi spec (aksi cancel hilang di 5.1, `district` vs `districts`, `TreatmentCategory` enum bukan tabel).

---

## 5. Prasyarat sebelum dilanjutkan

1. Re-verifikasi file/baris karena kode bisa berubah.
2. Putuskan dan tulis definisi metrik di `docs/METRIC_DEFINITIONS.md`.
3. Putuskan kebijakan PII (default mask, `includePii`, audit akses).
4. Implementasikan stdout guard + test spawn stdio sebelum write action apa pun.
5. Pastikan semua tool tenant-scoped dan punya test isolasi dua tenant.
6. Siapkan read-only DB role + `connection_limit` kecil + `statement_timeout`.
7. Jika HTTP: HTTPS, auth, rate limit, dan endpoint publik; jika stdio: config host per profil.
8. Jika write: ekstrak service kanonis dan tambah test efek samping (LTV, follow-up, audit, notifikasi).

---

## 6. Non-goals (tidak termasuk)

- Tidak ada tombol on/off di admin UI.
- Tidak ada write action di v1.
- Tidak ada migrasi `ReservationStatusHistory`/`booking_time_source` di v1.
- Tidak ada engine metrik baru.
- Tidak ada perubahan pada WAHA, label WhatsApp, atau alur percakapan customer.
- Tidak ada dependency baru sampai fase implementasi disetujui.

---

## 7. Checklist saat fitur dilanjutkan

- [ ] Baca ulang dokumen ini dan audit asal.
- [ ] Cek apakah `src/mcp/` sudah ada (jangan menimpa pekerjaan lain).
- [ ] Konfirmasi SDK exact version dan `package-lock`.
- [ ] Konfirmasi profil host: Desktop/OpenCode (stdio) atau web/mobile (HTTP).
- [ ] Konfirmasi apakah metrik keterlambatan/status history akan dipakai.
- [ ] Siapkan test: stdout purity, tenant isolation, PII, WIB, payment semantics, action side effects.
- [ ] Update `docs/FEATURE_INVENTORY.md`, `docs/KNOWN_ISSUES.md`, `CHANGELOG.md`, dan ADR bila perlu.
- [ ] Minta persetujuan eksplisit user sebelum menulis kode.

---

## 8. Referensi

- `docs/METRIC_DEFINITIONS.md`
- `docs/KNOWN_ISSUES.md` (#327 booking time default, #295 LTV drift, #281 metric definitions)
- `src/services/financial-analytics.service.ts`
- `src/services/meta-performance-analytics.service.ts`
- `src/services/staff-retention.service.ts`
- `src/services/copilot/copilot-tools.ts`
- `src/services/reservation-core.service.ts`
- `src/services/staff-reservation.service.ts`
- `src/domain/reservation-status.ts`
- `src/domain/reservation-payment.ts`
- `tests/setup.ts`

> Dokumen ini adalah **decision record**, bukan instruksi eksekusi. Jangan
> mengimplementasikan tanpa persetujuan eksplisit pengguna.
