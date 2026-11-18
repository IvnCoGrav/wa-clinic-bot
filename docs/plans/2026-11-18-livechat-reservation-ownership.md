# Implementation Plan — Perbaikan Banner "JADWAL" Nyasar ke Customer Lain (Live Chat)

**Status: IN PROGRESS — Disetujui user untuk dieksekusi.**

**Prinsip yang dipakai (sesuai AGENTS.md):** ini bug **state/dashboard**, bukan LLM. Perbaikan = invarian deterministic di seam kepemilikan data (`customer_id`), bukan tambahan teks/pengecualian kasus. Tidak ada migrasi Prisma (tidak menyentuh schema).

---

## 0. Ringkasan & peta modul

| Hal | Keputusan |
|---|---|
| Akar masalah | Penempelan reservasi ke chat tidak pernah memverifikasi `reservation.customer_id === chat.customerId`; `customerDetailData` bisa milik customer lain (race/ jalur pindah chat) |
| Seam baru | `packages/admin-dashboard/src/utils/reservationOwnership.ts` (murni, tanpa I/O) |
| Hasil `npm run find:module -- "filter reservasi milik customer / ownership guard livechat banner"` | 5 kandidat, **tidak ada** yang melakukan ownership filter. `livechat.serialize` (backend DTO) dipakai & tidak diduplikasi; status memakai `reservationStatus.ts` (kanonis) |
| Tidak membuat halaman/komponen baru | Ya — hanya util + guard di hook yang ada |
| Registry | `scripts/module-registry.json` hanya mencakup `src/`, jadi util dashboard tidak didaftarkan di sana (pola sama dengan `reservationConflicts.ts`); gerbangnya `npm run check:reuse` + `npm run check:ui-reuse` |
| Blast radius | Dashboard Live Chat: 2 hook + 1 halaman + 1 modal wiring; backend: 1 service + 3 call site webhook + 1 builder murni + 1 serializer |

---

## FASE A — Seam kepemilikan reservasi (inti, dampak terbesar, risiko terendah)

**Tujuan:** setiap tempat yang membaca reservasi untuk sebuah chat wajib menyaring `customer_id`. Menyembuhkan gejala "nomor baru punya jadwal" meski trigger race belum hilang.

### A1. Tulis test dulu (RED) — `tests/unit/reservation-ownership.test.ts` (file baru)
### A2. Implementasi util (GREEN) — `packages/admin-dashboard/src/utils/reservationOwnership.ts`
### A3. Pakai di memo turunan — `useLiveChatReservations.ts:393-438`
### A4. `handleReservationUpdate` fail-closed — `useLiveChatReservations.ts:305-355`
### A5. Fetch detail jalur form — `useLiveChatReservations.ts:459-467` dan `:541-548`

---

## FASE B — Invarian chat ↔ detail customer (anti-race & semua jalur pindah chat)

**Tujuan:** `customerDetailData` secara deterministik tidak pernah hidup bersama chat milik customer lain — termasuk saat pindah chat lewat chip "Telat", deep-link, atau respons fetch yang telat.

### B1. Token request + reset otomatis — `useLiveChatReservations.ts`
### B2. `handleOpenCustomerDetail` — `useLiveChatReservations.ts`
### B3. `handleOpenQuickReservation` / `handleOpenQuickHold`
### B4. Verifikasi jalur `setSelectedId` langsung

---

## FASE C — Satu sumber kebenaran untuk reservasi chat + perbaikan kontrak SSE

**Tujuan:** kartu chat tidak lagi ditulis dari data lokal hook (sumber drift). Penulis tunggal = endpoint server `/api/admin/live-chat/conversations/:id`. Event SSE diperbaiki agar UUID conversation + membawa `customer_id`.

### C1. Frontend: pakai `refreshChatItem` — `useLiveChatReservations.ts` & `LiveChatMonitor.tsx`
### C2. Backend: builder murni payload — `src/domain/livechat-reservation-event.ts`
### C3. Backend: publisher — `src/services/reservation-lifecycle.service.ts`
### C4. Backend: kirim conversation.id di 3 call site — `src/routes/webhook.route.ts`
### C5. Frontend: guard SSE — `useLiveChatSse.ts`
### C6. Test kontrak builder — `tests/unit/livechat-reservation-event.test.ts`

---

## FASE D — Kebenaran data minor, dokumentasi, gerbang penuh

### D1. Durasi banner tidak lagi mengarang 60 menit — `src/services/live-chat.serializer.ts:79`
### D2. Dokumentasi wajib (`docs/KNOWN_ISSUES.md`, `docs/FEATURE_INVENTORY.md`)
### D3. Gerbang regresi penuh
