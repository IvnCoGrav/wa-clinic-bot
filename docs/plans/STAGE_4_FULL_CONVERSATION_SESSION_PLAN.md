# Rencana Stage 4 Penuh — Session per-Conversation (`Conversation.session_data`)

- **Status:** RENCANA — menunggu persetujuan. Belum ada perubahan schema/kode.
- **Root cause:** RC-02 — session V3 disimpan di `Customer.preferences` (per-customer), bukan per-conversation. Dampak: conversation baru / thread baru / multi-thread mewarisi state lama; session bercampur dengan profil durable.
- **CG-02:** sudah FINAL (pemicu reset: admin complete + 14,1 hari idle + `/reset`).

## 1. Prinsip desain (pemisahan state)

| Jenis state | Lokasi benar | Contoh |
|---|---|---|
| Profil durable | `Customer` (kolom + `preferences`) | nama, sapaan, alamat terverifikasi, data anak |
| State episodik | `Conversation.session_data` (BARU) | cart, treatment terpilih, booking draft, komitmen, keluhan aktif, ongkir status |

## 2. Blast radius (terverifikasi read-only)

`Customer.preferences` dibaca di **25+ lokasi** lintas modul:
`customer.service.ts` (banyak), `capi.service.ts`, `staff-reservation.service.ts`,
`human-background-enrichment.service.ts`, `staff-notification.service.ts`,
`admin/customers.subroute.ts`, `admin/reservations.subroute.ts`.

→ Refactor penuh = mengubah banyak pembaca. **Risiko tinggi** bila dilakukan sekaligus.

## 3. Strategi bertahap (aman, dual-read/dual-write)

**Fase A — Tambah kolom + GoalTracker Conversation-first (dual-read).**
- Migrasi: `Conversation.session_data Json?`.
- `GoalTracker.getGoalSession`: baca `Conversation.session_data`; bila kosong → fallback `Customer.preferences` (kompatibel mundur).
- `GoalTracker.updateGoalSession`: tulis ke `Conversation.session_data` **DAN** mirror ke `Customer.preferences` (dual-write) selama transisi.
- Acceptance: test existing hijau; session tersimpan di Conversation; fallback bekerja.
- Rollback: matikan baca Conversation (flag) → kembali ke preferences.

**Fase B — Migrasi data aktif.**
- One-shot script: salin sesi aktif dari `Customer.preferences` → `Conversation.session_data` untuk conversation terbuka.

**Fase C — Alihkan pembaca episodik (25+ situs).**
- Identifikasi pembaca yang membaca field **episodik** (cart/booking/komitmen) → arahkan ke Conversation.
- Pembaca **profil durable** (nama/sapaan/anak) → tetap Customer.
- Bertahap per modul + test per modul.

**Fase D — Hentikan dual-write.**
- Setelah semua pembaca episodik pindah, hapus mirror `Customer.preferences` untuk field episodik.

## 4. Risiko & mitigasi
| Risiko | Mitigasi |
|---|---|
| Divergensi dual-write | Fase pendek; satu sumber dibaca (Conversation-first) |
| 25+ pembaca diam-diam rusak | Test per modul (capi, staff, admin, enrichment) |
| Session aktif hilang saat transisi | Fase A fallback preferences + Fase B backfill |
| Multi-worker/race | `withConversationLock` + optimistic version (ditambah di Fase A) |

## 5. Keputusan yang diperlukan
- **Persetujuan** untuk memulai Fase A (aditif, dual-read/write) — risiko sedang, tanpa mengubah 25 pembaca.
- Konfirmasi: Fase C boleh menyentuh modul non-V3 (capi/staff/admin) atau dibatasi ke jalur V3 dulu?

## 6. Acceptance akhir (semua fase)
- Conversation baru → cart/komitmen kosong (tidak mewarisi).
- Multi-conversation customer → terisolasi.
- Restart/multi-worker → session konsisten.
- Semua test hijau; build 0.
