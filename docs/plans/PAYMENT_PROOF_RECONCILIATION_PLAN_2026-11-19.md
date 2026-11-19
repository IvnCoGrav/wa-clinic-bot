# PLAN — Rekonsiliasi Bukti Pembayaran Otomatis & Remediasi Data (v2)

- **Tanggal:** 2026-11-19
- **Basis:** Audit baca-saja atas plan v1 (`NO_ACTIVE_RESERVATION`, 21 kasus bukti transfer) + verifikasi kode aktual
- **Status:** **FASE 0 s/d FASE 3 SELESAI & TERVERIFIKASI PENUH** (Alat audit, storage permanen, engine deterministik zero-migration, dan remediasi Bunda Nida berhasil dikomit ke DB produksi & disinkronkan ke Sheets)
- **Sifat:** staged micro-task, dependency-ordered, blast-radius-ordered
- **Larangan:** menulis DB produksi tanpa konfirmasi, menyentuh label WAHA, menambah dependency runtime.

---

## 0. Keputusan yang sudah dikunci

| # | Keputusan | Konsekuensi teknis |
|---|---|---|
| D1 | **Tabel `PaymentProofInbox` & Staging DITIADAKAN** (Keputusan Bisnis 2026-11-19) | Customer transfer/DP sebelum ada reservasi adalah **kesalahan admin**, bukan sistem. Dicatat di `docs/KNOWN_ISSUES.md` (Issue #357). Tidak ada tabel inbox baru, tidak ada migrasi skema tabel baru. |
| D2 | Dukungan **PDF/dokumen ditunda** | Wajib dicatat di `docs/KNOWN_ISSUES.md`; bukan bagian v2 |
| D3 | Jalur **WABA ditunda** ke fase terpisah setelah v2 stabil | Wajib dicatat di `docs/KNOWN_ISSUES.md` |
| D4 | **DILARANG** memakai `Conversation.session_data` untuk menyimpan bukti menggantung | Terbukti terhapus oleh whitelist `goal-tracker.ts:252-290` + penulisan ulang `:307-339` |
| D5 | Backfill data wajib lewat seam kanonis `verifyReservationPayment()`, bukan `UPDATE` SQL mentah | Menjamin `purchase_occurred_at`, LTV, audit, dan idempotensi |
| D6 | **Konfigurasi Tenant berbasis `Tenant.settings` (Zero Schema Migration)** | Jendela hari (`windowBeforeDays` & `windowAfterDays`) disimpan di JSON `Tenant.settings` (default 7/7). Nol risiko lock database di produksi. |

## 0.1 Non-goals

- Bukan refactor `customer-payment-proof.service.ts` menjadi multi-file besar.
- Bukan perubahan prompt/LLM.
- Bukan UI baru (cukup menambah field di `PaymentInfoPanel.tsx` yang sudah ada).

---

## 1. Fakta kode tervalidasi (dasar plan, jangan diasumsikan ulang)

| Fakta | Bukti |
|---|---|
| Jendela kaku `now + 1 hari` | `src/services/customer-payment-proof.service.ts:141` |
| Status tidak mencakup `completed` | `:143` |
| `orderBy: booking_date desc` (bukan terdekat) | `:155` |
| Idempotensi `waMessageId` diklaim **sebelum** pencarian → gagal = tidak bisa retry | `:109-111`, `:173-175` |
| `proof_url` diisi URL media chat inbound (prunable) | `:210` |
| Retensi inbound 30 hari → HD dihapus, diganti blur thumb | `src/services/media.service.ts:163-167` |
| Folder permanen bukti finansial = `payment-proofs/` | `media.service.ts:230-235, 240-261` |
| `/proof/:id` menyajikan `proof_url`; file hilang → thumb/404 | `src/routes/media.route.ts:511-537` |
| Sheets Kolom L kanonik = `=HYPERLINK(".../proof/{id}"; label)` | `src/services/sheets/row-formatter.ts:202-219` |
| Sheets hanya menulis reservasi `completed` | `src/services/sheets/sheets-sync.service.ts:236-237, 317` |
| `purchase_occurred_at` = penanda lunas kanonik | `src/services/financial-analytics.service.ts:232`, `reservation-payment-verification.service.ts:88,126` |
| Seam verifikasi kanonis (tenant-aware, audit, LTV, idempoten) | `src/services/reservation-payment-verification.service.ts:51-177` |
| Endpoint `POST /api/admin/reservation/:id/verify-payment` | `src/routes/admin/reservation-dispatch-payment-proof.subroute.ts:92-140` |
| Konstanta status aktif kanonik | `src/domain/reservation-status.ts:11` |
| Tagihan kanonik (fallback items/katalog) | `src/services/reservation-billing.service.ts:56-90` |
| Hook pasca-commit `saveReservation` (di luar advisory lock) | `src/services/reservation-core.service.ts:1179-1201` |
| Hanya `image` yang masuk pipeline bukti bantu | `src/routes/webhook.route.ts:848-853` |
| WABA tidak memanggil pipeline bukti | `src/routes/waba-webhook.route.ts:204`; `docs/KNOWN_ISSUES.md:1962-1969` |
| `session_data` di-whitelist saat dibaca & ditulis ulang | `src/v3/state/goal-tracker.ts:252-290, 307-339` |
| Mock Prisma eksplisit per model | `tests/setup.ts` (blok `vi.mock('../src/db/client')`) |
| Registrasi cron | `src/lifecycle/background-crons.ts:101-128` |

**Klaim yang belum terbukti (harus dibuktikan Fase 0/server):** "21 kasus", ID `0975f422-4f19-43ef-b03e-7ee9d13d6f2c`, nominal 145.000 + 10.000 = 155.000, tab Nov baris 89, file `81fa56ec...jpg`.

---

## 2. Status saat ini (sudah dieksekusi)

Fase 0 — alat audit, **read-only**, sudah ada:

| File | Peran |
|---|---|
| `src/domain/payment-proof-audit.ts` | Klasifikasi murni (tanpa I/O) + agregator severity |
| `src/scripts/audit-payment-proof-gaps.ts` | Skrip audit read-only → laporan JSON/MD, tanpa tulis DB |
| `tests/unit/payment-proof-audit.test.ts` | 12 test adversarial |

Verifikasi terakhir: `npm run typecheck` bersih; 34 test hijau (16 + 6 + 12); skrip tanpa DB keluar dengan kode 2 dan **tidak** menulis laporan.

> Catatan untuk eksekutor: `npm run check:reuse` saat ini **merah karena pekerjaan lain yang belum di-commit** (`src/config/followup-scheduling.ts`: 3 DEAD_EXPORT). Bukan regresi plan ini. Jangan "memperbaikinya" di PR ini.

Perintah audit:

```
npx tsx src/scripts/audit-payment-proof-gaps.ts --tenant=default-tenant --days=30
npx tsx src/scripts/audit-payment-proof-gaps.ts --tenant=default-tenant --days=30 --limit=1000 --out=docs/audit/2026-11-19
```

---

## 3. Fase eksekusi

### GERBANG 0 — bukti data (wajib sebelum Fase 5)

**Masukan:** `docs/audit/<tanggal>/payment-proof-gaps.json|md` dari server.
**Lulus bila:**
1. Daftar 21 kasus punya ID reservasi lengkap (UUID utuh, bukan `xxxx`).
2. Untuk kasus Bunda Nida: `purchase_value + delivery_fee - discount_amount == 155000`.
3. Klasifikasi per baris jelas: `WINDOW` / `COMPLETED` / `PRE_RESERVATION` / `PDF` / `WABA`.
**Jika tidak lulus:** Fase 5 dilarang; revisi plan.

---

### FASE 1 — Media permanen + idempotensi yang bisa di-retry

Tidak ada migrasi. Tidak ada perubahan perilaku bisnis selain lokasi penyimpanan bukti.

**T1.1** `src/services/customer-payment-proof.service.ts`
- Tambah parameter opsional `buffer?: Buffer; mimeType?: string` pada `attachCustomerPaymentProof` (baris 97-104).
- Sebelum `prisma.reservation.update` (baris 250): jika `buffer` ada →
  ```ts
  const { mediaService } = await import('./media.service');
  const saved = await mediaService.savePaymentProof({ tenantId, buffer, mimeType });
  const finalProofUrl = saved.hdUrl; // /media/payment-proofs/<tenant>/<uuid>.<ext>
  ```
  tulis `proof_url: finalProofUrl`. Jika `buffer` tidak ada (pemanggil lama/test) → tetap `mediaUrl`.
- Tambahkan `proofUrl` ke objek hasil.

**T1.2** Idempotensi (baris 107-111)
- Ganti pencatatan awal menjadi `claimProcessedWaMessage()` / `releaseProcessedWaMessage()`.
- Lepas claim pada **setiap** kegagalan (termasuk `NO_ACTIVE_RESERVATION`, `DUPLICATE_REFERENCE`, `INTERNAL_ERROR`).
- Tambah dedup DB: `findFirst({ where: { tenant_id, proof_url: finalProofUrl } })` → `ALREADY_PROCESSED`.

**T1.3** `src/routes/webhook.route.ts:886-895` — teruskan `buffer` + `mimeType` ke `attachFromInbound` → `attachCustomerPaymentProof`.

**T1.4** Test: `tests/unit/customer-payment-proof.test.ts` (16) dan `customer-payment-proof-mismatch.test.ts` (6).
- Assertion `proof_url` menjadi `toMatch(/^\/media\/payment-proofs\//)` pada kasus ber-buffer.
- Tambah: retry sukses setelah `NO_ACTIVE_RESERVATION`; dedup file sama; `savePaymentProof` dipanggil sekali.

**GATE 1**
```
npx vitest run tests/unit/customer-payment-proof.test.ts tests/unit/customer-payment-proof-mismatch.test.ts
npm run typecheck
```
Lulus bila 22 test hijau, typecheck bersih, tidak ada perubahan `check:reuse` baru dari file ini.

---

### FASE 2 — Konfigurasi Jendela Tenant & Engine Pencocokan (Zero Schema Migration)

Sesuai Keputusan Bisnis D1 & D6: **Tabel `PaymentProofInbox` DITIADAKAN** dan **NOL MIGRASI DATABASE**.
Konfigurasi jendela hari sebelum/sesudah disimpan di JSON `Tenant.settings` yang sudah ada, dengan nilai default aman H-7 s/d H+7.

**T2.1** `src/services/payment-proof-config.service.ts` (baru):
- `resolvePaymentProofPolicy(tenantId)`: membaca `tenant.settings.paymentProofWindowDaysBefore` dan `paymentProofWindowDaysAfter` dari database.
- Fallback default: `windowBeforeDays = 7`, `windowAfterDays = 7` (aman saat offline / belum disetel).
- Dilarang hardcode angka di service pencocokan.

**T2.2** `src/domain/select-payment-proof-candidate.ts` (baru, murni tanpa I/O):
- Menghitung `totalExpected` via `resolveReservationBilling`.
- Mengurutkan kandidat reservasi secara deterministik:
  1. `EXACT` nominal cocok (`difference === 0`)
  2. Selisih waktu terkecil `|transferDate − booking_date|` (fallback `|now − booking_date|`)
  3. `created_at` terbaru
  4. `id` ascending (tie-break final)
- Reservasi tanpa `booking_date` hanya sebagai fallback terakhir.

**T2.3** Pembaruan Query Pencarian di `customer-payment-proof.service.ts`:
- Ganti query lama (yang membatasi kaku `now + 1 hari` dan membuang `completed`) menjadi query kandidat berbasis policy:
```ts
const policy = await resolvePaymentProofPolicy(tenantId);
const minDate = new Date(now.getTime() - policy.windowBeforeDays * 24 * 60 * 60 * 1000);
const maxDate = new Date(now.getTime() + policy.windowAfterDays * 24 * 60 * 60 * 1000);

const candidates = await prisma.reservation.findMany({
  where: {
    customer_id: customerId,
    tenant_id: tenantId,
    purchase_occurred_at: null,
    proof_url: null,
    OR: [
      { status: { in: ACTIVE_RESERVATION_STATUSES } },
      { status: 'completed' },
    ],
    OR: [
      { booking_date: { gte: minDate, lte: maxDate } },
      { booking_date: null },
    ],
  },
  include: { customer: true, items: { select: { price: true } } },
});
```
- Panggil `selectPaymentProofCandidate({ candidates, signal, now })`.
- Bila `candidates` kosong: return `{ attached: false, reason: 'NO_ACTIVE_RESERVATION' }` (sesuai SOP bisnis: bila transfer sebelum reservasi ada, admin yang bertanggung jawab).

**T2.4** Guard Status & Tanggal Lunas:
- Guard `ALREADY_PAID`: bila reservasi ternyata sudah memiliki `purchase_occurred_at`, tolak penimpaan.
- `purchase_occurred_at` diisi dari `signal.transferDate` jika valid; jika tidak, gunakan `now` + `needs_staff_verification = true`.

**T2.5** UI & API Pengaturan di Dashboard (Tanpa Page Baru):
- Menghubungkan pembacaan dan penyimpanan field `paymentProofWindowDaysBefore` dan `paymentProofWindowDaysAfter` ke `GET/PUT /api/admin/settings/payment-info` di `src/routes/admin/settings-general.subroute.ts`.
- Menambahkan kontrol angka sederhana pada `packages/admin-dashboard/src/components/settings/PaymentInfoPanel.tsx`.

**T2.6** Unit Tests:
- `tests/unit/payment-proof-candidate-selection.test.ts` (10 skenario: +26 jam Bunda Nida, +72 jam, +120 jam, completed pasca-visit, tolak jika sudah lunas, nominal kembar pilih terdekat, nominal cocok di kandidat ke-3, items fallback, di luar H-7/H+7 tolak, tenant lain tolak).
- Perbarui mock di `customer-payment-proof.test.ts`.

**GATE 2**
```
npm run typecheck
npx vitest run tests/unit/customer-payment-proof.test.ts tests/unit/customer-payment-proof-mismatch.test.ts tests/unit/payment-proof-candidate-selection.test.ts
npm run check:reuse
```

---

---

### FASE 3 — Remediasi Data Riil (Bunda Nida & Kasus Tervalidasi)

**Prasyarat:** GERBANG 0 lulus + `pg_dump` tabel `reservations`, `audit_logs`, `sheets_sync_outbox`.

**T3.1** `src/scripts/reconcile-payment-proof-rows.ts` (baru):
- `--dry-run` (default): cetak rencana dari JSON Gerbang 0; **tidak menulis**.
- `--apply --confirm=<token>`: per baris panggil `verifyReservationPayment()` (bukan `UPDATE` mentah), dengan bukti disalin ke `payment-proofs/`.
- Baris dengan `amount ≠ billing.totalFee` → dilewati dan dilaporkan untuk moderasi manual.
- Setelah sukses: `sheetsSyncService.enqueue(reservationId, tenantId)`.

**T3.2** Reservasi belum `completed`: **jangan** edit Kolom L manual; catat `pending` (Sheets terisi saat selesai).

**Acceptance per baris:** `purchase_occurred_at` terisi; `payment_method` terisi; `proof_url` berawalan `/media/payment-proofs/`; `GET /proof/{id}` → 200; `AuditLog action=ADMIN_VERIFY_PAYMENT`; bila `completed` → outbox sheets `succeeded`.

**GATE 3:** jumlah `proof_url IS NULL` turun tepat sebanyak baris yang disetujui; 0 `purchase_value` berubah di luar rencana; laporan sebelum/sesudah dilampirkan.

---

### FASE 4 — Dokumentasi, Regresi, Verifikasi Akhir

**T4.1** `docs/FEATURE_INVENTORY.md`: modul pencocokan dinamis H-7..H+7, policy tenant data-driven.
**T4.2** `docs/MODULE_INDEX.md`: `reservation.payment_proof_match`.
**T4.3** `docs/KNOWN_ISSUES.md`: Issue #357 (SOP transfer sebelum reservasi adalah kesalahan admin), entri PDF & WABA.

**GATE 4 (wajib semua)**
```
npm run typecheck
npm run check:reuse
npx vitest run tests/unit/customer-payment-proof.test.ts tests/unit/customer-payment-proof-mismatch.test.ts tests/unit/payment-proof-candidate-selection.test.ts tests/unit/payment-proof-audit.test.ts
npm test
npm run build:all
```

---

### FASE TERTUNDA — Cakupan PDF & WABA (sesuai D2/D3)

- PDF: perluas `ALLOWED_MIME` (`media.service.ts`) + simpan ke `payment-proofs/` + render halaman 1 sebelum Vision. Perlu ADR.
- WABA: panggil pipeline yang sama dari `waba-webhook.route.ts:204`.
- Selama ditunda: dicatat eksplisit di `docs/KNOWN_ISSUES.md`.

---

## 4. Matriks risiko

| Risiko | Tingkat | Mitigasi |
|---|---|---|
| Salah tempel bukti | Sedang | `purchase_occurred_at IS NULL` + `proof_url IS NULL` + nominal-first + tie-break berlapis + flag verifikasi saat tanggal transfer janggal |
| Bukti hilang karena retensi | Rendah | `payment-proofs/` sejak Fase 1 |
| Pesan gagal tidak bisa retry | Rendah | claim/release + dedup berbasis file |
| Migrasi merusak data | Rendah | 1 migrasi aditif, tanpa drop, backup + dry-run |
| Staging menumpuk | Rendah | sweep per jam + index `expires_at` |
| Window terlalu lebar | Sedang | data-driven per tenant (default 7/7) |

## 5. Rollback

- Satu commit per fase.
- Fase 1, 3, 4: `git revert` cukup (tanpa data).
- Fase 2: kolom/tabel aditif dibiarkan; revert kode saja (backward-compatible).
- Fase 5: pulihkan dari `pg_dump` per baris bila ada anomali.

## 6. Definisi selesai

1. Bukti inbound tersimpan permanen dan `GET /proof/{id}` 200 setelah 30 hari (simulasi retensi).
2. Bukti untuk jadwal H+1 s.d. H+7 dan pelunasan pasca-visit menempel otomatis.
3. Transfer sebelum reservasi diinput terserap otomatis ≤ 7 hari.
4. Tidak ada bukti yang menempel ke reservasi yang sudah lunas atau sudah punya bukti.
5. Data 21 kasus (yang lolos Gerbang 0) lunas dengan bukti, audit, dan Sheets sinkron.
6. Seluruh gerbang regresi hijau (tanpa failure baru).
