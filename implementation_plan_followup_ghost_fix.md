# Fixing Plan: Ghost Error Sisa Audit Follow-Up (G1–G6 + Proses)

> Status: PLAN — belum ada edit kode / tulis DB. Eksekusi menunggu konfirmasi eksplisit (`Lanjut G1-G6` / sebagian).
> Bahasa: Indonesia. Lanjutan dari `implementation_plan_followup_repeat_order_REVISI1.md` + audit horizontal/vertikal 2026-10-16.
> Aturan: tanpa dependency baru, tenant-aware penuh, perbaikan level kode (bukan prompt/regex), tiap fase ditutup gerbang regresi.

## 0. Verifikasi environment (sudah dicek read-only, bukan klaim)

| Lokasi | Isi terverifikasi |
|---|---|
| `src/scripts/backfill-orphaned-followups.ts:118-125` | Filter `activeFuture` = `['pending','confirmed','hold']` + `booking_date >= now` (tanpa `en_route`, tanpa booking lampau) |
| `src/services/follow-up.service.ts:1092` | Reconciler pakai `['pending','confirmed','en_route','hold']` + logika lebih-baru-dari-completed-terakhir |
| `src/scripts/reanchor-premature-next-treatment.ts:105-123` | Guard `newerUncompleted` sudah paritas dengan reconciler (termasuk `en_route`) — bukti backfill yang divergen |
| `src/scripts/reanchor-premature-next-treatment.ts:45-48, :180` | `wib0900` tanpa jepit, 1 pemanggil (`:180`) |
| `src/services/staff-reservation.service.ts:1749-1760` | Guard `findFirst({ reservation_id, status: 'SENT' })` → skip `onReservationCompleted` total |
| `src/services/follow-up.service.ts:579-608` | `onReservationCreated` batalkan SEMUA aktif (termasuk NEXT lama) |
| `src/services/follow-up.service.ts:774-791` | `onReservationCancelled` batalkan by `reservation_id` (semua tipe aktif) |
| `src/services/follow-up.service.ts:1174-1197` | `before` hitung SENT, `after > 0` = sukses (overcount); komentar `:599-600` basi (tulis neutralkan `reservation_id`, kode tidak) |
| `tests/unit/follow-up-repeat-order.test.ts` test 6 | Mock `count → 3` konstan (akan pecah bila metrik jadi delta — ditangani MT-2.2) |

## 1. Apa yang terjadi (penjelasan sederhana)

Obat utama (SENT siklus-ini) sudah bekerja. Audit menemukan 5 hantu kecil: skrip backfill menyaring pasien dengan saringan beda (bisa bikin antrean ganda), gerbang pembayaran terlalu galak (1 baris SENT mematikan semua follow-up), batalkan booking baru ikut membunuh pengingat lama, angka "berhasil dipulihkan" bisa bohong, dan 1 rumus tanggal belum dijepit. Ditambah 2 urusan proses (bukti 28 pasien, campur `name-sanitizer`).

## 2. Apa temuan (daftar hantu + tingkat bahaya)

- **G1-tinggi** — filter backfill ≠ reconciler (di atas). Dampak: NEXT ganda untuk pasien `en_route`/confirmed-lampau.
- **G2-sedang** — guard payment (`staff-reservation.service.ts:1749`) blokir total. Dampak: NEXT tak pernah retry bila create pertama gagal parsial.
- **G3-sedang** — cancel booking baru membunuh NEXT lama yang di-re-anchor. Dampak: pengingat hilang sampai reconciler pulihkan dari anchor lama (tanggal mundur 1 siklus).
- **G4-rendah** — metrik `reconciledCount` overcount (`:1189-1196`).
- **G5-rendah** — `wib0900` reanchor tanpa jepit (`:45-48`).
- **G6-komentar basi** `:599-600`.
- **P1-proses** — klaim #259 (28 pasien/nomor WA) tanpa bukti dry-run. **P2-proses** — `isValidChildName` + 7 consumer (`save-reservation.tool.ts:492`, `reservation-text-parser.ts:626`, `child.service.ts:30`, `customer.service.ts:1046`, `google-contacts-formatter.ts:40`, `migration.service.ts:394`, sapaan `:2011`) tercampur di commit follow-up; working tree masih ada susulan tak ter-commit.

## 3. Rencana eksekusi (staged; blast radius kecil dulu)

> ⛔ GATE GLOBAL: tiap fase = `npm run build` + test fasenya hijau + full suite tanpa failure baru (klaim pre-existing wajib revert-and-rerun). Fase server (4B) butuh Opsi A/B eksplisit.

### FASE 1 — Nol-risiko: G5 + G6 (tanpa ubah perilaku)

* MT-1.1 (G5) file `src/scripts/reanchor-premature-next-treatment.ts:45-48` — ganti isi `wib0900` dengan rumus jepit identik service/backfill:
```ts
// SEBELUM (:45-48): tanpa jepit
function wib0900(anchor: Date, monthOffset: number): Date {
  const w = new Date(anchor.getTime() + 7 * 60 * 60 * 1000);
  return new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth() + monthOffset, w.getUTCDate(), 2, 0, 0, 0));
}
// SESUDAH: jepit akhir bulan (31 Okt +1 → 30 Nov), 09:00 WIB = 02:00 UTC
function wib0900(anchor: Date, monthOffset: number): Date {
  const bWib = new Date(anchor.getTime() + 7 * 60 * 60 * 1000);
  const targetMonthIndex = bWib.getUTCMonth() + monthOffset;
  const targetYear = bWib.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const finalDay = Math.min(bWib.getUTCDate(), daysInTargetMonth);
  return new Date(Date.UTC(targetYear, normalizedMonth, finalDay, 2, 0, 0, 0));
}
```
  Perintah: `npm run build`; `npx tsx src/scripts/reanchor-premature-next-treatment.ts --verify-only --limit=50` (baca saja). Acceptance: build hijau; verify-only jalan; kasus 31 Okt → 30 Nov benar (cek logika via test tanggal skrip, bukan DB).
* MT-1.2 (G6) file `src/services/follow-up.service.ts:599-600` — betulkan komentar agar jujur (tanpa ubah kode):
```ts
// SEBELUM: "Neutralkan reservation_id: baris CANCELLED tidak lagi terkait reservasi aktif, ..."
// SESUDAH: "Baris CANCELLED disisakan dengan reservation_id utuh sebagai jejak historis (paritas onReservationCancelled V2);
//           keunikan baris aktif dijaga trigger active_slot_key -> NULL (migrasi 20261006000000)."
```
  Acceptance: `npm run build` hijau; tidak ada perubahan perilaku (diff hanya komentar).

### FASE 2 — G4: metrik jujur + sesuaikan 1 mock (dependensi: Fase 1 hijau)

* MT-2.1 file `src/services/follow-up.service.ts:1180-1197` — samakan basis hitung + syarat delta:
```ts
// SEBELUM: before hitung SENT; sukses bila after > 0; fallback offline (before===0 && after===0 ikut dihitung).
// SESUDAH:
const before = await prisma.followUp.count({
  where: { tenant_id: tenantId, customer_id: cid, type: 'NEXT_TREATMENT', status: { in: ['PENDING', 'QUEUED'] as any } },
}).catch(() => 0);
await this.createNextTreatmentFollowUps(cid, maxDate, tenantId);
const after = await prisma.followUp.count({
  where: { tenant_id: tenantId, customer_id: cid, type: 'NEXT_TREATMENT', status: { in: ['PENDING', 'QUEUED'] as any } },
}).catch(() => 0);
if (after > before) { reconciledCount++; reconciledIds.push(cid); }
// Fallback offline DIHAPUS: DB mati → create gagal → after==before==0 → jujur dihitung 0 (bukan sukses semu).
```
* MT-2.2 file `tests/unit/follow-up-repeat-order.test.ts` test 6 — mock count sekuens agar mewakili sebelum/sesudah:
```ts
// SEBELUM: vi.spyOn(prisma.followUp, 'count').mockResolvedValue(3);
// SESUDAH: sebelum=0, sesudah=3 (delta jujur); tenantB early-return tanpa count.
vi.spyOn(prisma.followUp, 'count').mockResolvedValueOnce(0).mockResolvedValue(3);
```
  Perintah: `npx vitest run tests/unit/follow-up-engine.test.ts tests/unit/follow-up-repeat-order.test.ts`; `npm run build`. Acceptance: 43+ test hijau (termasuk test 28 = 0 tetap hijau karena early-return).

### FASE 3 — G1: paritas filter backfill (dependensi: Fase 2 hijau; blast radius: skrip offline)

* MT-3.1 file `src/scripts/backfill-orphaned-followups.ts:118-125` — ganti filter `activeFuture` menjadi paritas reconciler + reanchor (`:109-123`):
```ts
// SEBELUM: status ['pending','confirmed','hold'] + booking_date >= now.
// SESUDAH: ambil semua belum-selesai incl. en_route + booking lampau, kecualikan bila LEBIH BARU dari completed terakhir:
const uncompleted = await prisma.reservation.findMany({
  where: { tenant_id: tenantId, customer_id: { in: cids }, status: { in: ['pending', 'confirmed', 'en_route', 'hold'] } },
  select: { customer_id: true, booking_date: true },
}).catch(() => [] as any);
const hasNewerUncompleted = new Set<string>();
for (const r of (uncompleted as any[]) || []) {
  if (!r.customer_id || !r.booking_date) continue;
  const d = new Date(r.booking_date); if (isNaN(d.getTime())) continue;
  const maxCompleted = maxByCustomer.get(r.customer_id);
  if (!maxCompleted || d.getTime() > maxCompleted.getTime()) hasNewerUncompleted.add(r.customer_id);
}
let candidates = cids.filter((id) => !hasNewerUncompleted.has(id));
```
  Tambah komentar: "paritas reconciler follow-up.service.ts:1081-1097 + reanchor :105-123".
* MT-3.2 — tambah 1 test pengunci paritas di `tests/unit/follow-up-repeat-order.test.ts` (state-based, tanpa hafalan kalimat): pasien dengan `confirmed` lampau-lebih-baru → reconciler/shim filter mengecualikan (tidak buat baris). (Meniru pola test 28 engine yang sudah ada untuk reconciler; untuk backfill yang berupa skrip, test mengunci fungsi filter yang diekstrak bila memungkinkan, atau minimal test reconciler + review dry-run.)
  Perintah: `npx tsx src/scripts/backfill-orphaned-followups.ts --dry-run --limit=50` (baca saja); `npm run build`. Acceptance: pasien `en_route`/confirmed-lampau tak lagi muncul sebagai yatim di dry-run; test baru hijau.

### FASE 4 — G2: guard payment dipersempit (dependensi: Fase 3 hijau; risiko tertinggi → paling akhir di kode uang)

* MT-4.1 file `src/services/staff-reservation.service.ts:1749-1760` — ganti "ada SENT apa pun → skip total" menjadi "skip hanya bila NEXT sudah ada / REVIEW siklus-ini sudah ada":
```ts
// SEBELUM: findFirst({ reservation_id: reservationId, status: 'SENT' }) → bila ada, skip onReservationCompleted.
// SESUDAH:
const existingNext = await (prisma as any).followUp?.findFirst?.({
  where: { reservation_id: reservationId, type: 'NEXT_TREATMENT', status: { in: ['PENDING', 'QUEUED', 'SENT'] } },
});
const existingSentReview = await (prisma as any).followUp?.findFirst?.({
  where: { reservation_id: reservationId, type: { in: ['REVIEW_H1_BABY', 'REVIEW_H1_MOMS', 'REMINDER_H1'] }, status: 'SENT' },
});
if (existingNext && existingSentReview) {
  // Kedua deret sudah ada/tuntas → hanya enqueue Sheets (seperti cabang else lama).
} else {
  await reservationLifecycleService.onReservationCompleted({ ... }); // idempoten per-stage di dalam service
}
```
  Catatan: `createNextTreatmentFollowUps` + `createReservationFollowUps` idempoten per-stage/reservasi, jadi pemanggilan ulang aman (tidak ganda).
* MT-4.2 — 2 test baru (state-based): (a) reservasi hanya punya REVIEW SENT tanpa NEXT → `onReservationCompleted` TETAP dipanggil; (b) NEXT+REVIEW sudah ada → tidak dipanggil ulang (hemat). Mock `prisma.followUp.findFirst` berurutan + spy `reservationLifecycleService.onReservationCompleted`.
  Perintah: `npx vitest run <file-test-bayaran-terkait> tests/unit/follow-up-engine.test.ts`; `npm run build`. Acceptance: test baru hijau; tidak ada kirim ganda (assert create dipanggil 0x di kasus b).

### FASE 5 — G3: kunci perilaku cancel-booking (dokumentasi + test, tanpa migrasi schema)

* Keputusan: TIDAK tambah kolom history (blast radius schema) — terima pemulihan via reconciler ≤24 jam dari anchor lama + catat di KNOWN_ISSUES.
* MT-5.1 — 1 test pengunci di `tests/unit/follow-up-repeat-order.test.ts`: booking baru membatalkan NEXT lama (assert CANCELLED), lalu reconciler dengan completed lama membuat ulang dari anchor lama (assert tanggal = anchor lama + stage bulan). Ini mengunci perilaku jujur, bukan menutupinya.
* MT-5.2 — tambah sub-bagian di `docs/KNOWN_ISSUES.md #259` (Utang Sadar 3): "Batalkan booking baru ikut membatalkan NEXT re-anchor; pulih otomatis ≤24 jam via reconciler dari completed terakhir (tanggal mundur 1 siklus). Perbaikan penuh butuh kolom histori — ditunda."
  Perintah: `npx vitest run tests/unit/follow-up-repeat-order.test.ts`; `npm run build`. Acceptance: test hijau; dokumen terisi.

### FASE 6 — Proses: bukti + pisahkan trek liar + gerbang akhir

* MT-6.1 (P1) — lampirkan bukti ke #259: output `--dry-run` backfill (server) + 1 contoh query `follow_ups` (stage/status/scheduled_at/sent_at/reservation_id) + koreksi angka "28" sesuai hasil nyata (atau tulis "UNVERIFIED" bila belum ada).
* MT-6.2 (P2) — JANGAN sentuh `isValidChildName`/7 consumer di plan ini. Buat plan terpisah (data-driven, bukan tambah regex): commit-kan susulan working tree (`child.service.ts`, `customer.service.ts`, `google-contacts-formatter.ts`, `migration.service.ts`, `reservation-text-parser.ts`, `save-reservation.tool.ts`, `scripts/scratch-query-live.ts`, `heal-*.ts`) ke branch/commit sendiri + uji adversarial nama asli vs sampah.
* MT-6.3 — gerbang akhir: `npm run build` + `npm test` penuh tanpa failure baru + `graphify update .`.
  Acceptance akhir: Fase 1-5 hijau + full suite bersih + #259 berbukti + tidak ada file liar di `git status`.

---
*Urutan sengaja: gratis-dulu (F1), metrik (F2), skrip offline (F3), jalur uang (F4), perilaku-terkunci (F5), proses (F6). Tiap fase berhenti bila gate merah.*
