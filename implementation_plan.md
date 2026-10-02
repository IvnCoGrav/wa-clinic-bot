# Implementation Plan (Revisi Audit): Akses Bukti Pembayaran & Invoice Pasca Kunjungan Selesai

> Status: **AUDITED — menunggu eksekusi Fase 1-4 (Confirmation Gate terpisah)**.
> Jawaban user: "Setuju revisi, tulis plan" = hanya tulis file plan ini, DILARANG sentuh `src/` / `packages/` / jalankan terminal.
> Kebutuhan: tombol catat bayar, upload bukti struk/transfer, dan kirim tagihan/invoice WA tetap tersedia setelah kunjungan dipencet "Selesai" (termasuk jalur `forceUnpaid: true`).

## 0. Verdict Audit (ringkas, bukti kode aktual)

| No | Klaim plan asli | Hasil verifikasi | Bukti |
|----|-----------------|------------------|-------|
| 1 | `getCompletedTasks` memaksa `completed → LUNAS` | **TERBUKTI BENAR** | `src/services/staff-reservation.service.ts:1042` — `!!r.purchase_occurred_at \|\| status==='completed'` vs `getTodayTasks:593` dan `getUpcomingSchedule:882` yang murni `!!purchase_occurred_at`. Inkonsistensi antar-mapper terkonfirmasi. |
| 2 | Tab Riwayat Selesai tanpa tombol bayar | **TERBUKTI BENAR** | `StaffToday.tsx:4074-4110` — hanya label `paymentStatusLabel` + tombol Chat (gated `isChatWindowOpen`) + Detail. |
| 3 | Modal Detail pasif | **TERBUKTI BENAR** | `StaffToday.tsx:4699-4712` — badge LUNAS/TAGIH pasif; footer `4716-4748` hanya Chat + Navigasi + Tutup. |
| 4 | Kartu Hari Ini badge Lunas pasif | **TERBUKTI BENAR** | `StaffToday.tsx:2931-2935` — `<span>Lunas</span>` non-klik; tombol QRIS/Tagih hanya di cabang `else`. |
| 5 | `handleSubmitPayment` tidak update `completedTasks` | **TERBUKTI BENAR** | `StaffToday.tsx:1947-1975` — hanya `setTasks` + `setSelectedTask`. `setCompletedTasks`/`setUpcomingTasks`/`setDetailModalTask` hilang. |
| 6 | **TEMUAN BARU (plan asli terlewat): cerminan cacat di frontend** | WAJIB DIPERBAIKI | `StaffToday.tsx:1724` — `isLunas = pricing==='LUNAS' \|\| status==='completed'`. Dialog konfirmasi kirim WA tetap menganggap selesai=lunas walau backend sudah diperbaiki. |
| 7 | **TEMUAN BARU: divergensi label Lunas di 2 service lain** | CATAT, jangan lebarkan blast radius | `financial-analytics.service.ts:228` (`purchase \|\| payment_method \|\| completed`) dan `staff-notification.service.ts:191` (`CONFIRMED/COMPLETED → LUNAS`). Laporan keuangan & notif staf akan tetap bilang Lunas. |
| 8 | **TEMUAN BARU: `recordPayment` menimpa `proof_url` dengan NULL** | WAJIB DIPERBAIKI | `staff-reservation.service.ts:1441-1453` + `1504-1514` — `let proofUrl=null`, update selalu `proof_url: proofUrl`. Rekam ulang tanpa foto = bukti lama hilang. Klaim "idempoten kapan saja" plan asli gugur tanpa fix ini. |
| 9 | **RISIKO: tombol WA digated jendela chat** | WAJIB DIHINDARI | Chat disembunyikan saat `CLOSED_AFTER_COMPLETE` (`2966`, `4086`). Tombol Kirim Tagihan baru DILARANG memakai `isChatWindowOpen`; cukup `conversationId != null`. Backend `sendPaymentInfo:2420` hanya butuh conversation ada. |
| 10 | Test eksisting tidak menutup lubang | KONFIRMASI | `tests/unit/staff-auth-and-reservation.test.ts:414-452` hanya uji `completed+paid → LUNAS`. Tidak ada kasus `completed+unpaid`. Perubahan Fase 1 tidak merusak test ini (kasus paid tetap LUNAS). |

Keputusan arsitektur: arah plan asli (invariant backend + tombol universal + sinkron state) adalah **fondasional, bukan tambal-sulam** — disetujui dengan 5 revisi di bawah. Tidak ada regex hafalan kalimat, tidak ada larangan prompt "DILARANG...", tidak ada data bisnis baru yang di-hardcode (label status adalah konstanta sistem, bukan template brand; template WA tetap data-driven via `getPaymentInfo`).

## 1. Revisi Wajib vs Plan Asli (5 butir)

1. **R1 — Perbaiki cerminan frontend `1724`**: hapus `|| status==='completed'`; satu-satunya sumber lunas = `pricing.paymentStatus==='LUNAS'`.
2. **R2 — Pertahankan `proof_url` lama di `recordPayment`**: bila `proofImageB64` kosong, baca `reservation.proof_url` dan tulis kembali nilai lama (jangan NULL). Bila ada gambar baru, timpa seperti biasa.
3. **R3 — Tombol Kirim Tagihan TANPA gate `isChatWindowOpen`**: syarat tampil = `item.conversationId != null`. Dilarang menyalin pola `4086`/`2966` untuk tombol pembayaran.
4. **R4 — Divergensi finance/notif dicatat, tidak dieksekusi di plan ini**: tambah entri `docs/KNOWN_ISSUES.md` (finance:228, notif:191). Penyatuan definisi Lunas lintas-layanan adalah pekerjaan terpisah (blast radius laporan).
5. **R5 — State sync mencakup `detailModalTask` + dokumentasikan derivasi**: selain `tasks/completedTasks/upcomingTasks/selectedTask`, update juga `detailModalTask`. `allTasksRef (469)` dan `groupedCompleted (2332-2336, 2365)` adalah derivasi render — tidak perlu setter manual, cukup pastikan sumbernya (`tasks/completedTasks`) terupdate.

## 2. Fase 1 — Invariant Backend & Kontrak Bukti (file: `src/services/staff-reservation.service.ts`)

### Micro-Task 1.1: Perbaiki `isLunas` di `getCompletedTasks` (~baris 1042-1052)
```ts
// SEBELUM:
const isLunas = !!r.purchase_occurred_at || r.status === 'completed' || r.status === 'COMPLETED';
// SESUDAH:
const isLunas = Boolean(r.purchase_occurred_at);
const paymentStatus: 'LUNAS' | 'TAGIH_DI_TEMPAT' = isLunas ? 'LUNAS' : 'TAGIH_DI_TEMPAT';
const paymentStatusLabel = isLunas ? 'Lunas (Selesai)' : 'Belum Lunas';
```
Catatan label: pertahankan kata `Lunas (Selesai)` / `Belum Lunas` agar diff test `449` (`toContain('Lunas')`) tetap hijau. Usulan label plan asli (`Lunas (Tercatat)` / `Belum Lunas (Perlu Catat Pembayaran)`) DITOLAK di revisi ini untuk meminimalkan churn snapshot; perubahan label adalah follow-up terpisah.

### Micro-Task 1.2: Ekspos `paymentMethod` + `proofUrl` di `StaffTaskPricing` (~baris 42-48, 1046-1052)
```ts
export interface StaffTaskPricing {
  treatmentFee: number; deliveryFee: number; totalFee: number;
  paymentStatus: 'LUNAS' | 'TAGIH_DI_TEMPAT'; paymentStatusLabel: string;
  paymentMethod?: string | null; proofUrl?: string | null;
}
// di getCompletedTasks:
const pricing: StaffTaskPricing = { treatmentFee, deliveryFee, totalFee, paymentStatus, paymentStatusLabel,
  paymentMethod: (r as any).payment_method ?? null, proofUrl: (r as any).proof_url ?? null };
```
`select` sudah mengambil `payment_method/proof_url (978-979)` — tinggal diteruskan, tanpa query baru. Terapkan pola sama di `getTodayTasks (~597)` dan `getUpcomingSchedule (~886)` bila ingin konsisten (opsional, tanpa ubah logika `isLunas` keduanya yang sudah benar).

### Micro-Task 1.3 (R2): Pertahankan bukti lama di `recordPayment` (~baris 1441-1454, 1504-1514)
```ts
let proofUrl: string | null = (reservation as any).proof_url ?? null; // SEBELUM: null
if (proofImageB64 && proofImageB64.startsWith('data:image/')) { /* ... proofUrl = saved.hdUrl; */ }
```
Tidak mengubah kontrak sukses/gagal; hanya menutup lubang hapus-bukti. `status:'completed' (1511)` dibiarkan (idempoten untuk rekam susulan pasca-selesai).

**Regression gate Fase 1**: `npx vitest run tests/unit/staff-auth-and-reservation.test.ts` hijau (kasus `completed+paid → LUNAS` harus tetap lolos).

## 3. Fase 2 — Tombol Universal di PWA (file: `packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)

### Micro-Task 2.0: Sinkron tipe frontend (~baris 146-152)
Tambahkan `paymentMethod?: string | null; proofUrl?: string | null;` ke `interface StaffTaskPricing`.

### Micro-Task 2.1: Tab Riwayat Selesai (~baris 4073-4110)
Di bar footer kartu (di samping Chat/Detail), tambah grup aksi pembayaran **tanpa gate `isChatWindowOpen`**:
- Jika `TAGIH_DI_TEMPAT`: tombol primer amber `[Catat Pembayaran / Upload Bukti]` → `setPaymentModalTask(item)`; tombol sekunder `[Kirim Tagihan WA]` → `handleSendPaymentInfo(item)`, tampil bila `item.conversationId != null`.
- Jika `LUNAS`: tombol hijau `[Bukti Bayar / Invoice]` → bila `item.pricing.proofUrl` ada, buka preview (`setZoomImageUrl(proofUrl)`); bila tidak ada / ingin ganti, buka `setPaymentModalTask(item)`.
Gunakan komponen button + `useUiFeedback.confirm/toast` yang sudah ada; DILARANG `window.confirm/alert`.

### Micro-Task 2.2: Modal Detail Pasien (~baris 4699-4748)
Di bawah badge status (`4701-4711`), tambah blok aksi (tidak menutup modal secara kasar):
- `TAGIH_DI_TEMPAT`: `[Catat Pembayaran & Unggah Bukti]` → `setPaymentModalTask(detailModalTask)`; `[Kirim Rincian Tagihan & QRIS ke WhatsApp]` → `handleSendPaymentInfo(detailModalTask)` (syarat `conversationId != null`).
- `LUNAS`: `[Lihat / Unggah Ulang Bukti]` → preview bila `proofUrl` ada, sonst buka payment modal.

### Micro-Task 2.3: Kartu Tugas Hari Ini pasca-selesai (~baris 2931-2961)
- `completed + TAGIH_DI_TEMPAT`: JANGAN sembunyikan tombol QRIS (`handleOpenQrisFast`) dan Tagih di Tempat (`setPaymentModalTask`). Pertahankan keduanya aktif.
- `LUNAS`: ubah pill `<span>Lunas</span>` menjadi `<button>` interaktif `[Lunas • Bukti Bayar]` → klik buka preview `proofUrl` bila ada, sonst buka payment modal (ganti bukti).

### Micro-Task 2.4: Perbaiki cerminan `handleSendPaymentInfo` (~baris 1724) — R1
```ts
// SEBELUM: const isLunas = task.pricing?.paymentStatus === 'LUNAS' || task.status === 'completed';
// SESUDAH:
const isLunas = task.pricing?.paymentStatus === 'LUNAS';
```

### Micro-Task 2.5: Sinkron state reaktif di `handleSubmitPayment` (~baris 1947-1977) — R5
Fungsi `updatePricingLunas(task)` bersama, terapkan ke: `setTasks`, `setCompletedTasks`, `setUpcomingTasks`, plus `setSelectedTask` dan `setDetailModalTask` bila `reservationId` sama. Sertakan `paymentMethod`/`proofUrl` dari `res.data` bila backend mengembalikannya. `allTasksRef`/`groupedCompleted` ikut benar otomatis sebagai derivasi.

**Regression gate Fase 2**: `npm run build` root (`tsc`) + `npm run build` di `packages/admin-dashboard` (vite) — zero error.

## 4. Fase 3 — Testing (adversarial, multi-frasa — bukan happy-path saja)

### Micro-Task 3.1: Unit invariant `tests/unit/staff-auth-and-reservation.test.ts`
Tambah kasus (mock `prisma.reservation.findMany`):
1. `status:'completed' + purchase_occurred_at:null + proof_url:null` → `TAGIH_DI_TEMPAT` + label `Belum Lunas`, `proofUrl null`.
2. `status:'completed' + purchase_occurred_at:Date + proof_url:'https://...'` → `LUNAS` + `proofUrl` terus.
3. `status:'COMPLETED' (kapital) + purchase null` → tetap `TAGIH_DI_TEMPAT` (uji varian status).
4. `recordPayment` pada reservasi `completed` tanpa `proofImageB64` → sukses, `proof_url` lama dipertahankan (uji R2; mock `findUnique` + `update`).
5. `sendPaymentInfo` pada reservasi `completed` → sukses bila conversation ada (mock `findUnique` + `getPaymentInfo` + `liveChatService.sendAdminReply`).
Ikuti pola mock Vitest yang sudah ada di file ini (jangan ubah `tests/setup.ts`; offline tanpa DB).

**Regression gate Fase 3**: `npm test` (full Vitest) hijau 100%.

## 5. Fase 4 — Verifikasi & Deploy (belum dieksekusi)

- Micro-Task 4.1: commit + push; di live server `43.157.197.148:1403`: `git pull`, rebuild `admin-dashboard/dist`, restart `wa-clinic-bot-app-1`. Klasifikasi: tidak menyentuh WAHA → deploy aman standar (1-step verification); bila 지키 menyentuh WAHA batalkan dan minta 2-step + WARNING eksplisit.
- Micro-Task 4.2 (real device, akun terapis): (a) tab Selesai tugas `forceUnpaid` menampilkan Catat/Kirim WA; (b) modal Detail ada tombol catat/preview; (c) upload struk susulan kapan saja → status jadi Lunas tanpa reload; (d) klik badge Lunas → preview bukti; (e) kirim invoice WA dari kartu selesai tiba di nomor pasien.
- Mandat pasca-kerja: tambah entri `CHANGELOG.md` (Keep a Changelog) + entri `docs/KNOWN_ISSUES.md` untuk divergensi finance/notif (R4) bila belum disatukan.

## 6. Acceptance Matrix

| No | Skenario | Sebelum | Sesudah |
|----|----------|---------|---------|
| 1 | Selesai via `forceUnpaid`, belum bayar | Paksa `LUNAS (Selesai)` | `TAGIH_DI_TEMPAT / Belum Lunas` |
| 2 | Lupa upload sebelum Selesai | Tombol hilang di Riwayat | Catat + Kirim WA tetap aktif |
| 3 | Modal Detail tugas selesai | Badge pasif | Tombol catat/preview di modal |
| 4 | Lihat/ganti bukti terunggah | Pill pasif | Pill→button, preview + unggah ulang |
| 5 | Kirim invoice WA pasca-selesai | Hilang bila chat tertutup | 1-tap dari kartu + modal (cukup `conversationId`) |
| 6 | State pasca-catat | Riwayat stale | Hari Ini + Selesai + Mendatang + Detail update serentak |
| 7 | Rekam ulang tanpa foto baru | Bukti lama terhapus (bug) | Bukti lama dipertahankan (R2) |
| 8 | Dialog konfirmasi kirim WA | Selesai selalu dianggap lunas | Hanya `pricing LUNAS` yang dianggap lunas (R1) |

## 7. Yang SENGAJA tidak dikerjakan di plan ini

- Penyatuan definisi Lunas di `financial-analytics.service.ts:228` & `staff-notification.service.ts:191` → catat di KNOWN_ISSUES, eksekusi terpisah.
- Perubahan teks label massal / template WA → template tetap data-driven (`ClinicPolicy payment_methods`, `Tenant.settings.paymentInfo`).
- File baru / dependency baru → tidak ada (maksimalkan `prisma`, `useUiFeedback`, endpoint bayar existing).
