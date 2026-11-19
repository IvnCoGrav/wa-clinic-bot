# PLAN — Perbaikan Hasil Eksekusi Bukti Pembayaran (v1)

- **Tanggal:** 2026-11-19
- **Basis:** Audit hasil eksekusi (`A-001` s.d. `A-010`), verifikasi kode/test/build
- **Status:** **BELUM DIEKSEKUSI** — menunggu persetujuan manusia eksplisit
- **Sifat:** staged micro-task, dependency-ordered, blast-radius-ordered
- **Larangan selama plan ini:**
  - membuat tabel/antrean staging bukti bayar (keputusan #357 terkunci)
  - menyentuh label WAHA, mengubah `.env`, menambah dependency runtime
  - menulis DB produksi tanpa backup + persetujuan terpisah
  - memakai `Conversation.session_data` untuk data bukti bayar

---

## 0. Ringkasan masalah → fase

| ID | Masalah | Fase |
|---|---|---|
| A-001 | Fallback `findFirst` tanpa filter status/tanggal/lunas | F2 |
| A-002 | Test hijau menguji fallback, bukan jalur produksi `findMany` | F1, F2 |
| A-009 | Error DB ditelan (`catch { // ignore }`) → diperlakukan "tidak ada kandidat" | F2 |
| A-006 | Validasi jendela lemah (API tanpa batas atas, audit tanpa before/after) | F3 |
| A-007 | Tidak ada test policy & route settings | F3 |
| A-004 | Hardcode data bisnis + regex parsing invoice di skrip | F4 |
| A-005 | Perbaikan billing tidak atomik (update lalu verify) | F4 |
| A-008 | Cabang `already_paid` tidak memastikan `proof_url` | F4 |
| A-003 | Cakupan remediasi 1/21, laporan menyatakan "selesai penuh" | F5 |
| A-010 | Dokumentasi tidak akurat + PDF/WABA belum dicatat | F6 |

**Definition of done global:** status `cancelled`/`rejected` tidak pernah menerima bukti otomatis; error DB menghasilkan `INTERNAL_ERROR` (bukan penempelan); 12 kasus otomatis berikutnya diremediasi (atau dilaporkan jelas bila belum); semua gerbang regresi hijau tanpa failure baru.

---

## FASE 1 — Kontrak test (TDD, boleh merah)

**Tujuan:** mengunci perilaku yang benar lebih dulu, agar Fase 2 tidak bisa "hijau palsu".

### T1.1 Helper test
`tests/unit/customer-payment-proof.test.ts` dan `customer-payment-proof-mismatch.test.ts`, di dalam `describe`:

```ts
const mockNoDuplicate = () =>
  vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValueOnce(null);

const mockCandidates = (rows: any[]) =>
  vi.spyOn(prisma.reservation, 'findMany').mockResolvedValueOnce(rows as any);
```

### T1.2 Migrasi mekanis 25 test lama
Ganti pola "dua kali `findFirst`" menjadi:
```ts
mockNoDuplicate();
mockCandidates([mockActiveReservation]);
```
- File: `tests/unit/customer-payment-proof.test.ts` (19 test) dan `tests/unit/customer-payment-proof-mismatch.test.ts` (6 test).
- Test guard referensi duplikat **tetap** memakai `findFirst` sekali (tidak memanggil `findMany`).

### T1.3 Test baru level service (6)
Tambahkan `describe('jalur produksi findMany')` di `customer-payment-proof.test.ts`:

| # | Skenario | Ekspektasi |
|---|---|---|
| 1 | kandidat dalam jendela | `attached: true` |
| 2 | `findMany` mengembalikan `[]` (di luar jendela / belum ada reservasi) | `attached:false`, `NO_ACTIVE_RESERVATION`, **tanpa** memanggil `findFirst` kedua |
| 3 | kandidat `completed` pasca-visit | `attached: true` |
| 4 | kandidat sudah `purchase_occurred_at` terisi | `ALREADY_PAID`, tidak update |
| 5 | `findMany` melempar error | `INTERNAL_ERROR`, `update` tidak dipanggil |
| 6 | dua kandidat nominal kembar + `transferDate` | memilih yang tanggalnya terdekat (assert `reservationId`) |

### T1.4 Test domain (2)
`tests/unit/payment-proof-candidate-selection.test.ts`:
- status `cancelled` dan `rejected` → tidak pernah terpilih.
- status `CANCELLED` (huruf besar) → tetap ditolak.

**Gate 1 (boleh merah):** jalankan test di atas, catat jumlah gagal sebagai baseline TDD. **Jangan deploy.**

---

## FASE 2 — Hapus fallback berbahaya + observabilitas

### T2.1 Hapus blok fallback
`src/services/customer-payment-proof.service.ts:207-219` — hapus seluruh blok:
```ts
if (rawCandidates.length === 0) {
  // Fallback kompatibilitas ... findFirst ...
}
```
Alasan: `findFirst` lama hanya memfilter `customer_id` + `tenant_id`, sehingga melewati status, jendela tanggal, dan status lunas.

### T2.2 Error DB tidak boleh jadi "tidak ada kandidat"
Ganti `catch { // ignore }` (`:203-205`) menjadi:
```ts
} catch (err: any) {
  if (waMessageId) releaseProcessedWaMessage(waMessageId);
  console.error(`[PAYMENT PROOF] Gagal query kandidat: ${err?.message || err}`);
  return { attached: false, reason: 'INTERNAL_ERROR' };
}
```

### T2.3 Log keputusan
Setelah `selectPaymentProofCandidate` (`:234-239`):
```ts
console.log(
  `[PAYMENT PROOF] kandidat=${enrichedCandidates.length} terpilih=${selection.candidate?.id || '-'} exact=${selection.isExactAmountMatch}`
);
```

### T2.4 Tolak status terminal di domain
`src/domain/reservation-status.ts` (setelah `ACTIVE_RESERVATION_STATUSES`):
```ts
/** Status terminal: TIDAK boleh menerima bukti bayar otomatis. */
export const TERMINAL_RESERVATION_STATUSES: string[] = ['cancelled', 'rejected'];
```
`src/domain/select-payment-proof-candidate.ts` — impor dan tambahkan filter pertama:
```ts
import { TERMINAL_RESERVATION_STATUSES } from './reservation-status';
const TERMINAL = new Set(TERMINAL_RESERVATION_STATUSES.map((s) => s.toLowerCase()));
// di dalam filter eligible:
if (TERMINAL.has(String(c.status || '').toLowerCase())) return false;
```

### T2.5 Bersihkan sisa kompatibilitas
- Hapus komentar "Fallback kompatibilitas untuk pemanggil/test suite".
- Pastikan tidak ada pemanggil `findFirst` kedua di service ini.

**Gate 2:**
```
npx vitest run tests/unit/customer-payment-proof.test.ts tests/unit/customer-payment-proof-mismatch.test.ts tests/unit/payment-proof-candidate-selection.test.ts
npm run typecheck
npm run check:reuse
```
Lulus bila semua hijau (Fase 1 + lama), 0 pelanggaran reuse baru.

**Rollback:** `git revert` Fase 2 (tanpa data).

---

## FASE 3 — Validasi & test konfigurasi jendela

### T3.1 Clamp server-side
`src/routes/admin/settings-general.subroute.ts:535-543`, tambahkan helper lokal:
```ts
const clampWindowDays = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(30, Math.max(1, Math.round(value)));
};
```
Pakai untuk `windowBeforeDays` dan `windowAfterDays` (batas 1–30, sama dengan UI).

### T3.2 Audit before → after
Di luar `updateTenantSettingsSafely`, siapkan:
```ts
let previousWindow = { before: 7, after: 7 };
```
Di dalam updater, isi `previousWindow` dari `currentSettings` sebelum menimpa; sertakan di payload audit:
```ts
paymentProofWindow: { before: previousWindow, after: { before: windowBeforeDays, after: windowAfterDays } }
```

### T3.3 Selaraskan UI
`packages/admin-dashboard/src/components/settings/PaymentInfoPanel.tsx:544-545, 563-564` — sudah `min=1 max=30`; tidak perlu diubah. Pastikan tidak ada state 0 dari respons lama (clamp di `loadPaymentInfo`).

### T3.4 Test baru
- `tests/unit/payment-proof-policy.test.ts` (3):
  1. DB offline → default 7/7.
  2. `settings.paymentProofWindowDaysBefore/After` terbaca.
  3. nilai invalid (`-1`, `"abc"`, `null`) → fallback.
- `tests/unit/admin-payment-info-settings.test.ts` (+2):
  4. PUT nilai 999 → tersimpan 30.
  5. PUT nilai 0 → tersimpan 1.

**Gate 3:** test di atas hijau; `npm run typecheck`; build dashboard tetap lolos.

---

## FASE 4 — Skrip rekonsiliasi: data-driven, atomik, jujur

### T4.1 Kasus pindah ke JSON
Buat `docs/audit/2026-11-19/reconcile-cases.json`:
```json
{
  "tenantId": "default-tenant",
  "cases": [
    {
      "reservationId": "0975f422-4f19-43ef-b03e-7ee9d13d6f2c",
      "proofSource": "/media/inbound/default-tenant/81fa56ec309a499f9b559b9ac868d01f.jpg",
      "amount": 155000,
      "paymentMethod": "QRIS",
      "referenceNumber": "0115001SZHJ7",
      "billing": { "purchaseValue": 145000, "deliveryFee": 15000, "discountAmount": 5000 },
      "state": "DONE"
    }
  ]
}
```
`src/scripts/reconcile-payment-proof-rows.ts`:
- Hapus `VERIFIED_CASES` (`:35-58`) dan `detectBillingRectification` + 4 regex (`:132-135`).
- Tambah `--cases=<path>` (default JSON di atas), baca `cases`, pilih berdasarkan `--reservation-id` atau semua `state !== "DONE"`.

### T4.2 Atomik + kompensasi
Sebelum update billing, simpan snapshot:
```ts
const originalBilling = {
  purchase_value: reservation.purchase_value,
  delivery_fee: reservation.delivery_fee,
  discount_amount: reservation.discount_amount,
};
```
Jika `verifyResult.kind` bukan `verified`/`already_paid`, pulihkan snapshot sebelum `return false`.

### T4.3 `already_paid` wajib mengisi bukti
`:309-312` ganti menjadi:
```ts
if (verifyResult.kind === 'already_paid') {
  const fresh = await prisma.reservation.findUnique({ where: { id: reservationId } });
  if (!fresh?.proof_url) {
    const saved = await mediaService.savePaymentProof({ tenantId, buffer: imageBuffer, mimeType: 'image/jpeg' });
    await prisma.reservation.update({
      where: { id: reservationId },
      data: { proof_url: saved.hdUrl, payment_method: targetMethod },
    });
    console.log(`[INFO] proof_url kosong pada reservasi lunas → diisi ${saved.hdUrl}`);
  }
}
```

### T4.4 Dry-run sebagai default
Pastikan `--apply` tanpa `--confirm=RECONCILE_PAYMENT_PROOFS_CONFIRMED` → exit 1 (sudah ada; pertahankan).

**Gate 4:** `npx tsx src/scripts/reconcile-payment-proof-rows.ts --reservation-id=0975f422... ` (dry-run) menampilkan rencana tanpa error; `npm run typecheck`.

---

## FASE 5 — Lanjutkan remediasi data (butuh persetujuan + backup)

**Komposisi kasus (dari `gate-0-evaluation.md`):**
- Selesai: 1 (Nida).
- Otomatis berikutnya: **12** → `WINDOW` 7 (#4,5,7,13,14,16,19) + `COMPLETED` 5 (#2,3,15,17,18).
- Manual admin (SOP #357): **7** `PRE_RESERVATION` (#1,6,8,9,10,11,12).
- Diabaikan: **1** `INTERNAL_STAFF` (#20).

### T5.1 Backfill kasus otomatis (12)
1. `pg_dump` tabel `reservations`, `audit_logs`, `sheets_sync_outbox`.
2. Isi `reconcile-cases.json` untuk 12 kasus; **setiap** nominal & billing harus cocok dengan invoice (bukan tebakan).
3. Dry-run per ID; review output.
4. Apply **satu per satu**; setelah tiap baris: `GET /proof/{id}` harus 200 (atau 401 jika tanpa sesi—cek via dashboard).
5. Untuk reservasi `completed`: `syncReservation` (atau outbox) agar Kolom L terisi.

### T5.2 Kasus manual (7)
Buat `docs/audit/2026-11-19/manual-pre-reservation-tracker.md` berisi 7 ID + status penanganan admin (bukan tabel sistem, sesuai #357).

### T5.3 Re-run audit
```
npx tsx src/scripts/audit-payment-proof-gaps.ts --tenant=default-tenant --days=30
```
**Acceptance:** jumlah `MISSING_PROOF` turun tepat sebanyak kasus yang diremediasi; tidak ada `PROOF_IN_PRUNABLE_STORAGE` baru.

---

## FASE 6 — Koreksi dokumentasi

- `docs/audit/2026-11-19/gate-0-evaluation.md` / laporan eksekusi:
  - "58 test" → jumlah aktual hasil run.
  - "Fase 0 s.d. Fase 4" → "Fase 0–3 + remediasi kasus Nida; Fase 4 (staging) dibatalkan #357".
  - Label Sheets: `payment_method` = `QRIS` (formatter kanonik), bukan "Transfer QRIS".
- `docs/KNOWN_ISSUES.md` — tambahkan entri:
  - Bukti bayar **PDF/dokumen** tidak diproses otomasi (hanya `image`), rujuk `webhook.route.ts`.
  - WABA: rujuk #271 (masih terbuka).
  - Catat bahwa fallback `findFirst` sudah dihapus (agar tidak dihidupkan lagi).
- `docs/MODULE_INDEX.md`: tautan test `reservation.payment_proof_policy` → `tests/unit/payment-proof-policy.test.ts`.
- `docs/plans/PAYMENT_PROOF_RECONCILIATION_PLAN_2026-11-19.md`: ubah status Fase 4 menjadi "DIBATALKAN oleh #357".

**Gate 6:** tidak ada tautan mati; `npm run check:reuse` tetap 189/0.

---

## FASE 7 — Gerbang regresi & deploy

```
npm run typecheck
npx vitest run tests/unit/customer-payment-proof.test.ts tests/unit/customer-payment-proof-mismatch.test.ts tests/unit/payment-proof-candidate-selection.test.ts tests/unit/payment-proof-audit.test.ts tests/unit/payment-proof-policy.test.ts tests/unit/admin-payment-info-settings.test.ts tests/integration/admin-verify-payment.test.ts
npm run check:reuse
npm run build
npm --prefix packages/admin-dashboard run build
npm test
```
- `npm test` wajib tanpa failure baru. Bila ada failure, buktikan pre-existing dengan **revert-and-rerun** (kembalikan file ke HEAD, jalankan test yang sama, harus tetap gagal).
- Deploy: konfirmasi manusia eksplisit; tidak ada migrasi; rebuild `dist` dashboard; restart; verifikasi `/proof/<id>` 200 dan panel Settings menampilkan nilai jendela.

---

## Risiko & rollback

| Fase | Risiko utama | Mitigasi | Rollback |
|---|---|---|---|
| 1–2 | Test lama gagal massal | Migrasi mekanis + helper; commit terpisah | revert commit |
| 2 | Perilaku berubah untuk pelanggan tanpa kandidat | Log `NO_ACTIVE_RESERVATION` + `INTERNAL_ERROR`; pantau log 24 jam | revert |
| 3 | Admin set nilai ekstrem | Clamp 1–30 + audit before/after | revert |
| 4 | Skrip salah menempel | Dry-run default + `--confirm` + guard nominal + kompensasi billing | revert + backup |
| 5 | Salah remediasi data | Backup, per-ID, review nominal | restore tabel dari dump |
| 6 | Dokumentasi usang | Review diff | revert |

## Urutan commit yang disarankan

1. `test(payment-proof): kontrak findMany + skenario negatif` (F1)
2. `fix(payment-proof): hapus fallback findFirst, error DB fail-closed, tolak status terminal` (F2)
3. `feat(settings): clamp + audit jendela bukti bayar` (F3)
4. `refactor(reconcile): kasus dari JSON, billing atomik, already_paid mengisi bukti` (F4)
5. `chore(data): remediasi 12 kasus lanjutan` (F5, terpisah, butuh persetujuan)
6. `docs: koreksi laporan + catat PDF/WABA` (F6)

## Verifikasi akhir (Definition of Done)

1. Pelanggan dengan hanya reservasi `cancelled` mengirim struk → `NO_ACTIVE_RESERVATION`, tidak ada baris berubah.
2. `findMany` error → `INTERNAL_ERROR`, tidak ada baris berubah, log error tercatat.
3. Bukti di luar jendela 7 hari → tidak menempel.
4. `completed` pasca-visit dalam jendela → menempel.
5. Nominal kembar → memilih reservasi dengan tanggal terdekat dari `transferDate`.
6. Nilai jendela 999 → tersimpan 30; 0 → tersimpan 1; audit before/after tercatat.
7. 12 kasus lanjutan diremediasi (atau dilaporkan eksplisit yang tertunda).
8. Semua gerbang regresi hijau tanpa failure baru.
