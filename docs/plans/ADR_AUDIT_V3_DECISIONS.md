# ADR — Keputusan Audit V3 Customer Handling

- **Tanggal:** 2026-09-19
- **Status:** sebagian terisi (keputusan user). Dipakai sebagai rujukan Stage 4+.
- **Sumber:** `docs/AUDIT_V3_CUSTOMER_HANDLING_2026-09-19.md` + `docs/plans/STAGED_MICRO_IMPLEMENTATION_PLAN_AUDIT_V3.md`.

---

## CG-01 — Identitas customer & tenant

- **Keputusan:** **Satu nomor HP boleh ada di TIAP klinik (tenant), tetapi hanya satu per klinik.**
- **Implikasi teknis:** migrasi `Customer.phone @unique` (global) → `@@unique([tenant_id, phone])`. Hapus `findByPhoneGlobal`.
- **Konteks:** saat ini masih **1 klinik** berjalan → risiko belum terasa, tapi tetap murah dikerjakan sekarang.
- **Status:** FINAL.

## CG-02 — Batas episode percakapan (reset konteks)

- **Keputusan user (FINAL, 2026-09-20):** TIGA pemicu reset:
  1. **Admin klik "Selesai"** (`PATCH /api/admin/reservation/:id/complete`) → closing.
  2. **14,1 hari** sejak chat TERAKHIR customer (idle timeout baru).
  3. **`/reset`** manual.
- **Implementasi:**
  - Default `IDLE_TIMEOUT_MS` = **1.218.240.000 ms (14,1 hari)** (`machine.ts`, `.env.example`).
  - Idle reset & `/complete` membersihkan sesi V3 **episodik** (cart, treatment, booking, diskusi, komitmen); profil durable dipertahankan.
- **Definisi reset:** buang konteks berjalan; pertahankan profil permanen (nama, sapaan, anak, lokasi terverifikasi, riwayat booking).
- **Belum:** session pindah ke `Conversation.session_data` (Stage 4 penuh) — masih `Customer.preferences`.
- **Status:** FINAL (pemicu + timeout terimplementasi).

## CG-03 — Pesan saat error teknis (outage LLM)

- **Keputusan:** **OPSI A — pertahankan kontrak eskalasi sunyi.**
- **Alasan user:** admin **fast response**; customer langsung di-take over manusia, jadi bot diam tidak masalah.
- **Implikasi:** **TIDAK ada perubahan** pada `reportTurnError` / `generation-stage.ts:295-355`. Kontrak `tests/unit/llm-outage-silent.test.ts` (sunyi total, nol teks keluar) **tetap dipertahankan**.
- **Status:** FINAL. Jangan tawarkan perubahan ini lagi.

## CG-04 — Rilis handoff manusia

- **Keputusan:** belum diputuskan.
- **Rekomendasi audit:** rilis eksplisit oleh admin secara default; timed release hanya untuk alasan non-medis, dan mulai dari `INITIAL` (bukan `previous_state` yang bisa basi).
- **Status:** OPEN.

## CG-05 — Status reservasi non-same-day

- **Keputusan user (FINAL, revisi 2026-09-20):** gunakan **FLAG**, bukan status baru.
- **Implementasi:** kolom `Reservation.needs_staff_verification` (default false). Bot/agent non-same-day yang `confirmed` → `true` (slot belum diverifikasi staf); same-day (`pending`) & admin manual → `false`.
- **`status` string TIDAK berubah** (tetap `confirmed`/`pending`) → menghindari blast radius pada ~30 pembaca `status` (admin filter, calendar, CAPI, migration).
- **Alasan:** nilai status string dipakai luas; menambah `REQUESTED` berisiko merusak filter/agregasi admin.
- **Status:** FINAL & terimplementasi (migrasi lokal).

## CG-06 — Beberapa appointment di hari sama

- **Keputusan user (FINAL, revisi 2026-09-20):** **OPSI (d)** — pertahankan kontrak LAMA: customer sama + hari kalender sama = **MERGE** (dedup idempoten) walau treatment berbeda. Booking multi-treatment pada hari sama ditangani **manual oleh admin**, bukan otomatis oleh bot.
- **Alasan:** mencegah duplikat saat form reservasi disubmit ulang (KNOWN_ISSUES #63), dan menjaga test `same-day-reservation-collision` tetap utuh.
- **Konsekuensi:** perbaikan R6 "merge hanya treatment sama" **DIBATALKAN**. Booking same-day berbeda treatment yang masuk via bot akan tetap digabung ke reservasi pertama hari itu; admin memisahkan manual bila perlu.
- **Catatan audit:** perubahan ini menutup konflik dengan test existing, tetapi mempertahankan risiko "booking sah tertimpa" untuk kasus multi-treatment via bot — dicatat di `docs/KNOWN_ISSUES.md` #102.
- **Status:** FINAL.

## CG-07 — Semantik komitmen

- **Keputusan:** belum diputuskan eksplisit.
- **Rekomendasi audit:** cart hanya berubah bila current message role=user berstatus `COMMITTED`; pertanyaan/minat tetap `EXPLORING`/`CONSIDERING`.
- **Status:** OPEN (namun arah disetujui secara implisit lewat keluhan "konsultasi dianggap pembelian").

## CG-08 — Mode degraded (Redis/DB)

- **Keputusan:** belum diputuskan.
- **Rekomendasi audit:** produksi wajib durable DB inbox; Redis hanya dispatcher; fallback in-memory tidak untuk produksi.
- **Status:** OPEN.

## CG-09 — Retention & masking PII

- **Keputusan:** belum diputuskan.
- **Status:** OPEN.

## CG-10 — Timeout provider setelah send

- **Keputusan:** belum diputuskan.
- **Rekomendasi audit:** tandai `DELIVERY_UNKNOWN`, jangan kirim ulang otomatis, butuh rekonsiliasi.
- **Status:** OPEN.

## CG-11 — Akses database

- **Keputusan user:** "akses saja database saya tapi jangan rusak."
- **Protokol:** HANYA `SELECT` (read-only). Dilarang `UPDATE/INSERT/DELETE/DROP/ALTER` dan migrasi. Tidak mengekspor nomor/teks chat.
- **Blocker:** kredensial (`DATABASE_URL` / `TEST_DATABASE_URL`) belum diserahkan ke sesi. Izin membaca `.env` belum eksplisit.
- **Status:** SEBAGIAN.

---

## Ringkasan

| ID | Topik | Status |
|---|---|---|
| CG-01 | Identitas customer/tenant | FINAL |
| CG-02 | Batas episode reset | SEBAGIAN |
| CG-03 | Pesan saat error (sunyi) | FINAL (Opsi A) |
| CG-04 | Rilis handoff manusia | OPEN |
| CG-05 | Status reservasi | FINAL (REQUESTED) |
| CG-06 | Multi-appointment same-day | FINAL (boleh, beda treatment) |
| CG-07 | Semantik komitmen | OPEN |
| CG-08 | Degraded mode | OPEN |
| CG-09 | Retention/PII | OPEN |
| CG-10 | Delivery unknown | OPEN |
| CG-11 | Akses DB | SEBAGIAN |
