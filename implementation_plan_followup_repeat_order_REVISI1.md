# Implementation Plan (REVISI-1, tervalidasi): Pemulihan Follow-Up Repeat Order

> Status: REVISI hasil validasi read-only 2026-10-16. Belum ada edit kode / tulis DB. Eksekusi menunggu konfirmasi eksplisit user.
> Bahasa: Indonesia (konsisten dengan repo).
> Catatan: file `implementation_plan.md` di root membahas topik lain (bukti pembayaran), jadi revisi follow-up ini disimpan di file terpisah agar tidak menimpa.

## 0. Ringkasan validasi (apa yang dicek)

| Klaim plan lama | Hasil cek kode nyata | Status |
|---|---|---|
| `follow-up.service.ts L919-938`: `findFirst status IN [PENDING,QUEUED,SENT]` lalu `SENT → skip` memblokir kunjungan baru | Benar ada di `src/services/follow-up.service.ts:919-938`. `SENT` Agustus memblokir Oktober karena tidak ada filter tanggal/siklus | ✅ TERBUKTI |
| `reconcileOrphanedCompletedFollowUps L1082-1097`: exclude pasien bila punya 1 baris aktif | Benar ada di `src/services/follow-up.service.ts:1082-1097`. Cek level customer, bukan per-stage | ✅ TERBUKTI |
| `backfill-orphaned-followups.ts L116-165`: cacat sama (`exists/SENT → skip`) | Benar ada di `src/scripts/backfill-orphaned-followups.ts:160-164` | ✅ TERBUKTI |
| `active_slot_key=NULL saat SENT` sehingga baris baru legal | Benar, `prisma/migrations/20261006000000_fix_followup_unique_and_indexes/migration.sql:48-58` (trigger: aktif → `customer_id`, non-aktif → `NULL`) + `schema.prisma:605` unique `(tenant_id, active_slot_key, type, stage)` | ✅ TERBUKTI |
| "28 pasien, ID Syarifa/Mery, tanggal Nov/Des/Jan" | Tidak ada log/query di plan. Tanpa `logs/*.jsonl` / output dry-run server | ❌ UNVERIFIED — dilarang jadi patokan commit |
| Guard anti-spam (`suppressPrematureNextTreatment`, Smart Context 72 jam) | Benar ada `follow-up.service.ts:1818-1858` (geser ke `booking+stage bulan`, bukan batal). Plan menyebutnya — bagus | ✅ TERBUKTI, wajib diuji regresi |
| Jalur `onReservationCompleted` membawa `reservationId` | Benar `reservation-lifecycle.service.ts:305`. Tapi reconciler `follow-up.service.ts:1144` memanggil TANPA `reservationId` | ⚠️ Plan lama mengandalkan `reservation_id` — tidak menolong jalur reconciler |
| Kontrak lama Test 14 (`SENT → tidak direcreate`) | Ada `tests/unit/follow-up-engine.test.ts:452-468`, mock `SENT` TANPA tanggal. Logika baru berbasis tanggal akan membuatnya gagal bila tidak ditangani | ⚠️ Wajib fallback konservatif + update mock (dijelaskan di Fase 3) |
| Fungsi tanggal skrip vs service | Skrip `wib0900` (`backfill-orphaned-followups.ts:32-35`) tanpa jepit akhir bulan; service `computeNextTreatmentAtWib0900` ada jepit M2 (31 Okt +1 → 30 Nov) | ⚠️ Wajib disamakan |

**Keputusan arsitektur (anti tambal-sulam):** perbaikan di level State Machine + kontrak DB (filter tanggal/siklus di query, bukan prompt `DILARANG...`, bukan regex kalimat, bukan hafalan nomor WA). Prompt hanya lapis sekunder.

---

## 1. Apa yang terjadi (penjelasan sederhana)

Pasien datang 2 kali (misal Agustus lalu Oktober). Pengingat bulanan kunjungan Oktober tidak dibuat karena sistem melihat "tahap ini sudah pernah dikirim" milik Agustus lalu batal total.

Sederhananya: anak sudah dapat rapor semester 1, naik ke semester 2 tapi guru bilang "sudah pernah dapat rapor, tidak perlu lagi".

## 2. Apa temuan (hasil audit jujur)

**Sudah benar:** akar masalah di 3 titik terbukti di kode (tabel di atas). Arah solusi plan lama (bedakan riwayat vs siklus kini lewat tanggal) sudah fondasional.

**Yang kurang / berisiko di plan lama:**
1. Angka dan nama pasien belum dibuktikan — harus dry-run dulu.
2. `findFirst` tunggal bisa ambil baris `SENT` yang salah bila pasien punya 2 riwayat `SENT` per stage. Solusi harus query berfilter tanggal, bukan cek tanggal setelah ambil 1 baris acak.
3. Syarat `reservation_id sama` tidak berlaku di jalur reconciler (tidak bawa ID).
4. Mock Test 14 tanpa tanggal akan pecah — perlu fallback konservatif.
5. Skrip backfill tanggalnya beda rumus — perlu disamakan.
6. Belum ada tugas update `docs/KNOWN_ISSUES.md`, uji DB-offline/bypass/tenant, dan gerbang regresi penuh.

## 3. Apa solusinya (rencana revisi, staged + micro-task)

Prinsip: `SENT` hanya memblokir bila milik **siklus kunjungan ini** (`sent_at >= bookingDate` ATAU `scheduled_at >= bookingDate` ATAU `reservation_id` sama). `SENT` lama = riwayat, abaikan. `PENDING/QUEUED` tetap re-anchor (kode `939-973` dipertahankan). Tanpa dependency baru, tenant-aware penuh.

> ⛔ GATE: Fase 1-2 boleh jalan setelah user ketik `Lanjut`. Fase 4 commit DB server HANYA setelah user pilih `Opsi A` / `Opsi B` eksplisit.

### FASE 0 — Bukti read-only (tanpa ubah kode/DB)

* MT-0.1: Dry-run lokal baca saja — `npx tsx src/scripts/backfill-orphaned-followups.ts --dry-run --limit=200`. Simpan output sebagai bukti kandidat (bukan patokan 28).
* MT-0.2: Minta/ambil 1 contoh nyata: query `follow_ups` 1 pasien repeat (kolom `stage, status, scheduled_at, sent_at, reservation_id`) + 1 baris log worker. Tanpa ini, Fase 4 dilarang commit.
* Acceptance: ada file bukti (log/query) terlampir; angka pasien = hasil dry-run, bukan klaim.

### FASE 1 — Perbaiki service inti (2 micro-task, 1 file)

File: `src/services/follow-up.service.ts`. Blast radius kecil, seam tunggal `createNextTreatmentFollowUps` (dipakai `reservation-lifecycle.service.ts:305`, reconciler `:1144`, backfill `:180`).

* MT-1.1 — `createNextTreatmentFollowUps` (`:909-993`): ganti pola "ambil 1 baris lalu cek" menjadi dua cek deterministik:
  1. Cek aktif `PENDING/QUEUED` per-stage → re-anchor bila tanggal/ID beda (pertahankan `:939-973` apa adanya).
  2. Cek `SENT` **siklus-ini** via query berfilter tanggal (bukan 1 baris acak):
```ts
// Baru: SENT hanya memblokir bila milik siklus kunjungan ini (bDate = bookingDate kunjungan baru)
const inCycleSent = await prisma.followUp?.findFirst?.({
  where: {
    customer_id: customerId, type: 'NEXT_TREATMENT', stage, tenant_id: tenantId,
    status: 'SENT',
    OR: [
      ...(reservationId ? [{ reservation_id: reservationId }] : []),
      { sent_at: { gte: bDate } },
      { scheduled_at: { gte: bDate } },
    ],
  },
}).catch(() => null);
if (inCycleSent) { skippedExists++; continue; }
// Fallback konservatif (pertahankan Test 14 hijau): SENT tanpa tanggal & tanpa reservation
// tetap dianggap memblokir agar tidak spam ganda pada data lama yang tak bertanggal.
const legacySent = await prisma.followUp?.findFirst?.({
  where: { customer_id: customerId, type: 'NEXT_TREATMENT', stage, tenant_id: tenantId, status: 'SENT' },
}).catch(() => null);
if (legacySent) {
  const sAt = legacySent.sent_at ? new Date(legacySent.sent_at) : null;
  const scAt = legacySent.scheduled_at ? new Date(legacySent.scheduled_at) : null;
  const hasDate = (sAt && !isNaN(sAt.getTime())) || (scAt && !isNaN(scAt.getTime()));
  const sameRes = !!reservationId && !!legacySent.reservation_id && legacySent.reservation_id === reservationId;
  if (!hasDate && !sameRes && !inCycleSent) { skippedExists++; continue; }
  // bila bertanggal dan tanggalnya < bDate → riwayat lama → JANGAN skip, lanjut create baru
  if (hasDate && !inCycleSent && !sameRes) { /* fallthrough ke create */ }
  else if (inCycleSent || sameRes) { skippedExists++; continue; }
}
// lanjut ke prisma.followUp.create QUEUED seperti semula (:979-992)
```
  Mengapa dua query: menghindari ambiguitas `findFirst` saat ada >1 riwayat `SENT` per stage. State-based (`sent_at/scheduled_at/reservation_id`), bukan cocok kalimat.

* MT-1.2 — `reconcileOrphanedCompletedFollowUps` (`:1082-1097`): ubah exclude level-customer menjadi per-stage. Query tambah `stage`:
```ts
// Lama: select { customer_id } → exclude bila punya 1 aktif (salah untuk partial Tahap 3 saja)
// Baru: select { customer_id, stage } → exclude hanya bila 3 stage aktif terisi
hasNext = await prisma.followUp.findMany({
  where: { tenant_id: tenantId, customer_id: { in: candidates }, type: 'NEXT_TREATMENT', status: { in: ['PENDING','QUEUED'] } },
  select: { customer_id: true, stage: true },
});
const stagesByCust = new Map<string, Set<number>>();
for (const r of hasNext || []) { /* kumpulkan stage per customer */ }
const orphaned = candidates.filter((id) => (stagesByCust.get(id)?.size ?? 0) < 3);
```
  Komentar `:1082` dan `:1134` diperbarui: "per-stage, SENT tidak dihitung".

* Regression gate Fase 1: `npm run build` hijau + `npx vitest run tests/unit/follow-up-engine.test.ts` hijau (kecuali Test 14 yang ditangani di Fase 3 dengan bukti revert-and-rerun bila gagal).

### FASE 2 — Samakan skrip backfill (1 file)

File: `src/scripts/backfill-orphaned-followups.ts`.

* MT-2.1 (`:32-35`): ganti `wib0900` tanpa-jepit dengan rumus jepit akhir bulan identik service (salin `computeNextTreatmentAtWib0900`: `finalDay = min(day, daysInTargetMonth)`, `02:00 UTC`).
* MT-2.2 (`:160-167`): ganti `reason: 'exists/SENT'` tunggal menjadi logika siklus-ini yang sama dengan MT-1.1 (cek `sent_at/scheduled_at >= bDate` atau `reservation_id` sama; tanpa tanggal → konservatif skip + log `legacy-SENT-no-date`).
* Tenant-aware dipertahankan (`--tenant`, `--pilot-phones`, `--dry-run` default). Tanpa dependency baru.
* Gate: `npx tsx src/scripts/backfill-orphaned-followups.ts --dry-run --limit=50` jalan tanpa tulis.

### FASE 3 — TDD adversarial (test dulu, state-based)

* MT-3.1 — File BARU `tests/unit/follow-up-repeat-order.test.ts` (6 kasus, tanpa hafalan kalimat):
  1. Repeat-order: `SENT` Agt (`sent_at/scheduled_at` < booking Okt) → Tahap 1+2 Okt WAJIB terbuat.
  2. Same-visit idempoten: `SENT` dengan `sent_at >= booking` → tidak direcreate (kontrak Test 14).
  3. Panggil 2x kunjungan sama → tidak duplikat (re-anchor/skip).
  4. Booking baru <14 hari → `suppressPrematureNextTreatment` menggeser, bukan menggandakan.
  5. Bypass/sandbox/dummy → tidak buat baris.
  6. Beda tenant → tidak bocor.
  Seam yang diuji: `createNextTreatmentFollowUps` + `reconcileOrphanedCompletedFollowUps` (seam publik yang disepakati; bukan privat).
* MT-3.2 — Perbaiki mock rapuh Test 14 (`tests/unit/follow-up-engine.test.ts:458-461`): tambahkan `sent_at` + `scheduled_at` >= `bookingDate` pada mock `SENT` agar mewakili "siklus ini". Justifikasi dicatat di komentar test. Test 24-27 (re-anchor) dan 26 (`SENT` tak digeser) wajib tetap hijau.
* Perintah: `npx vitest run tests/unit/follow-up-repeat-order.test.ts` lalu `npx vitest run tests/unit/follow-up-engine.test.ts`, lalu `npm run build`. Klaim pre-existing failure wajib bukti revert-and-rerun (kembalikan file ke HEAD, test sama harus tetap gagal).

### FASE 4 — Pemulihan data aman (perlu pilihan Opsi)

* MT-4.1: Dry-run server `--dry-run`, simpan daftar rencana per pasien (stage, tanggal WIB 09:00, alasan).
* MT-4.2: Setelah user pilih opsi, commit bertahap: pilot `--pilot-phones` dulu → verifikasi → full `--commit`. Tulis `audit_logs` (`Admin Repair Repeat Follow-ups`). Jeda bertahap untuk tanggal terlewat.
* Keputusan 4 pasien terlewat 2-3 hari:
  * **Opsi A (disarankan):** jadwalkan Bulan 1 besok 09:00-12:00 WIB bertahap + Bulan 2 November. Pro: tidak ada bulan kosong. Kontra: pesan telat 2 hari (masih wajar).
  * **Opsi B:** lewati Bulan 1, mulai Bulan 2. Pro: tanpa pesan telat. Kontra: kosong 1 bulan.
* Gate: query `follow_ups` per pasien menunjukkan Tahap 1/2 `QUEUED` masa depan + `active_slot_key` terisi; tidak ada lonjakan kirim (pantau worker + guard 72 jam).

### FASE 5 — Deploy + catat utang

* MT-5.1: `docker compose build app worker && docker compose up -d --no-deps app worker` (tanpa ganggu WAHA). Verifikasi antrean LiveChat + query DB.
* MT-5.2: Tambah entri `docs/KNOWN_ISSUES.md` (#259): bug repeat-order, tanggal implementasi, klaim yang masih UNVERIFIED bila ada, dan batasan (data lama tanpa tanggal diperlakukan konservatif).
* MT-5.3: `graphify update .` setelah edit kode (sesuai panduan repo).
* Acceptance akhir: test Fase 3 hijau + build hijau + full suite tanpa failure baru + antrean contoh pasien lengkap + KNOWN_ISSUES terisi.

---
*Catatan anti-regresi:* Test 14/24-29, guard 14-hari (`suppressPrematureNextTreatment`), dan trigger `active_slot_key` adalah jaring pengaman — setiap fase ditutup dengan gate-nya sebelum lanjut.
