# Implementation Plan — LiveChat Comprehensive Fix (Goyang Typing + Search + Tanggal + WA Sync)

**Tanggal:** 2026-09-01  
**Branch rencana:** `plan/livechat-wa-sync` (update v2)  
**Status:** Plan → Build (disetujui user 2026-09-01)  
**Penulis:** Muse Spark — audit impeccable LiveChatMonitor 4237 baris + live-chat.service + conversation/message  
**Prasyarat:** `AGENTS.md` SaaS-readiness, `docs/KNOWN_ISSUES.md#9 #10 #11 #18`, `docs/PERF_AUDIT_2026-08-08.md` P1+P7

---

## 1. Ringkasan Masalah (Faktual)

### 1a. Goyang saat Typing (laporan 2026-08-31)
- **Gejala:** Input LiveChat goyang saat ketik, terutama iOS Safari/PWA. Keyboard `∧∨✓` + bubble lompat.
- **Akar (7 faktor konkuren, verified read-only):**
  1. `LiveChatMonitor.tsx:1105` `visualViewport resize/scroll → scrollToBottom(true)` fire 5-10×/detik saat ketik (prediksi bar, tinggi `contentEditable` berubah) × `scrollToBottom:1065` paksa 5× (`scrollTop=scrollHeight+99999` + `scrollIntoView` + rAF + 4× setTimeout) → jitter vertikal.
  2. `LiveChatMonitor.tsx:338,483` `hasReplyText` di root → full re-render 4237 baris tiap karakter (list 50 + 30 bubble).
  3. `3788` `contentEditable="plaintext-only"` → iOS `UITextInputAssistantItem` debt (`KNOWN_ISSUES#9`), `innerText` + selection reset tiap input → tinggi `min-h-[38px] max-h-[220px]` tumbuh/ciut.
  4. `3122:3129` `chatContainer overscroll-contain` + `Layout.tsx:493` `h-screen overflow-hidden` vs `index.css:60` `dvh` dobel.
  5. SSE `message.created:1497` + `visualViewport` bersamaan → double-jump.
  6. Sticky `2601` + `3132` collision.
  7. Typing presence `472:502` spam `POST /typing` tiap 3s → SSE balik.

### 1b. Search salah (laporan 2026-09-01)
- **Gejala:** Cari `628113141111` (nomor) → banner “Tidak ada bubble pesan berisi "628113141111" di percakapan ini” + tidak ter-close saat pindah chat.
- **Akar:**
  1. Kopling salah `LiveChatMonitor.tsx:1207:1212` `useEffect([searchQuery,selectedId]) → setInChatSearchQuery(searchQuery)` → global search (nama/nomor via `filteredChats:2297` & `conversation.service:174` `customer.name/phone`) ikut trigger in-chat search (`1214` filter `messages[].content`). Nomor tidak ada di bubble → banner `3167` muncul.
  2. `handleClearInChatSearch:1250` hanya reset `inChatSearchQuery`, tidak reset pindah chat → effect isi ulang lagi.
  3. Banner guard `3167` `inChatSearchQuery && matching===0` terlalu agresif (walau `messages.length===0` atau q=numerik).

- **Ekspektasi benar:** Search nomor/nama = filter list kiri (`filteredChats`), bukan bubble. Search bubble = hanya jika admin memang cari isi pesan.

### 1c. Bug Tanggal
- **Gejala:** Separator “Hari ini/Kemarin/Senin” kadang off-by-one, `formatLastChat:2328` tanpa tahun.
- **Akar:**
  1. `formatChatDateSeparator:144` pakai `Math.round` + `getFullYear` lokal vs UTC → 23:30 WIB bisa jadi “Kemarin”.
  2. `isDifferentDay:167` sama → midnight lokal.
  3. `formatLastChat` tanpa `timeZone:'Asia/Jakarta'`, threshold `Math.floor` tapi tanpa tahun.
  4. `live-chat.service:843` `effectiveLastMsgAt = lastMsg.created_at || last_message_at` bisa desync 197 rows (drift terbesar 48 hari, `docs/IMPLEMENTATION_PLAN_LIVECHAT_WA_SYNC.md#1`).

### 1d. WA Sync (plan lama, tetap valid)
- 64 phantom conv, 197 drift, 173 `wa_message_id NULL`, history media drop – detail §1 Fase 0-5 lama (dipertahankan).

---

## 2. Tujuan

- **Goyang hilang:** Ketik 30 detik di iOS tanpa jitter, FPS 60, `visualViewport` throttle.
- **Search benar:** Cari nomor/nama → list terfilter, **tanpa** banner bubble. Cari isi bubble → highlight + navigasi ↑↓ + auto-close saat pindah chat.
- **Tanggal benar:** Separator WIB akurat, no off-by-one, `lastMessageAt` single source.
- **WA Sync:** `last_message_at` ≡ `max(messages.created_at)`, phantom tidak naik ke atas.
- Non-tujuan: Ubah SOP greeting/ongkir, ganti WAHA `noweb-2026.7.2`.

---

## 3. Prinsip

- Tenant-aware (`tenant_id` filter, tidak hardcode).
- Idempotent & re-runnable.
- Offline test green (`tests/setup.ts` mock).
- **Rekomendasi disetujui:** (1) Pisah dua kotak search (global atas list + in-chat dalam thread), (2) WIB hardcode `Asia/Jakarta`, (3) Global search tetap saat pindah chat, in-chat reset.

---

## 4. Fase Implementasi (Update v2)

### Fase 0 — Diagnostic & Guard (0.5 hari, read-only) — TETAP
*Skrip `check-livechat-sync.ts` + `npm run check:livechat-sync` seperti plan lama (phantom/drift/nullWa).*  
*Tambah:* `check-livechat-search-date.ts` → cek `isDifferentDay` batas 23:55 WIB, cek `searchQuery → inChatSearchQuery` kopling.

### Fase 1 — Fix `last_message_at` Single Source (1 hari) — TETAP
*`message.service:324` effectiveMsgDate, `conversation.service:328` touch flag, `live-chat.service:764` serialize, `repair-last-message-at.ts` seperti plan lama.*

### Fase 2 — Phantom & History Media (0.5+0.5 hari) — TETAP
*Seperti plan lama.*

### Fase 3 — `wa_message_id` NULL & Ack (0.5 hari) — TETAP

### Fase 4 — Goyang Typing P0 (1 hari, high impact) — BARU, PRIORITAS 1
**Ubah `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`:**
1. **Isolasi Composer:** Ekstrak `components/livechat/Composer.tsx` (`React.memo`), state `hasReplyText/typingTimer` lokal, root hanya `onSend`. Hapus `setHasReplyText` di root `483`.
2. **Throttled viewport:** Ganti `1105:1119` → `throttle 200ms + isNearBottom (>80%) + !isComposing`. Hanya `scrollTop`, hapus `scrollIntoView` duplikat & `onFocus 200ms` `3792`. Kurangi `forceMulti` dari 4 timeout jadi 1 rAF.
3. **Debounce typing:** `handleInputChange` debounce 500ms → `notifyTyping(true)`, `stop 1500ms`, `AbortController`. Server `livechat.subroute.ts:320` tambah `per-phone 1 req/2s` rate-limit.
4. **Verifikasi:** Profiler renders -90%, `visualViewport` count, `npm run build`, 3 test baru `typing-throttle.test.ts`.

### Fase 5 — Search Decoupling P0 (0.5 hari, high impact) — BARU, PRIORITAS 1
**Ubah `LiveChatMonitor.tsx`:**
1. **Hapus kopling** `1207:1212` → `searchQuery` tidak pernah set `inChatSearchQuery`. Dua state independen.
2. **Banner guard** `3167` → `inChatSearchActive && messages.length>0 && q.length>=2 && !isGlobalSearch`. Tambah `isInChatSearchActive` boolean.
3. **Auto-clear saat pindah chat:** `useEffect([selectedId]) => handleClearInChatSearch()` (reset `inChatSearchQuery/matching/highlighted`), **tanpa** sentuh `searchQuery`. `handleClearInChatSearch` juga dipanggil di `loadThread` selesai.
4. **Global search tetap:** `filteredChats:2297` sudah benar (name/phone/message), tambah highlight phone/name di list.
5. **In-chat search visible:** Tambah input kecil dalam thread (icon Search → expand) yang set `inChatSearchQuery`. Global input tetap di `2600:2635`.

### Fase 6 — Tanggal WIB P1 (1 hari) — BARU, PRIORITAS 1
**Ubah `LiveChatMonitor.tsx:144:176,2328` + `live-chat.service.ts:843`:**
1. Buat `src/utils/dateWib.ts` → `toWibMidnight`, `formatWib(date, opts:{timeZone:'Asia/Jakarta'})`, `diffCalendarDaysWib`.
2. `formatChatDateSeparator` → pakai `differenceInCalendarDays` floor + WIB, bukan `Math.round`.
3. `isDifferentDay` → bandingkan `YYYY-MM-DD` WIB string.
4. `formatLastChat` → branch `>1 tahun` tampil tahun, `>7 hari` `dd MMM yyyy` WIB, semua `toLocale*` dengan `timeZone:'Asia/Jakarta'`.
5. `serialize:876` → `lastMessageAt` konsisten, `listConversations` order `COALESCE(last_message_at,updated_at)`.
6. Test `tests/unit/date-wib.test.ts` (23:55 vs 00:05, round vs floor, tahun).

### Fase 7 — Observabilitas (0.5 hari) — TETAP
*`GET /api/admin/live-chat/sync-health` + banner drift.*

### Fase 8 — Search-to-Jump & Highlight Polish P2 (0.5 hari) — TETAP (Fase 6 lama)
*Seperti plan lama Fase 6: scroll ke target, `<mark>`, pill `🔍 "5km" (X dari Y)` ↑↓✖ — sudah ada `3131:3182` tapi sekarang decoupled, tinggal polish.*

---

## 5. Urutan Eksekusi & Estimasi (Update)

| Fase | Estimasi | Ketergantungan | Risiko | Status |
|------|----------|----------------|--------|--------|
| 0 diagnostic | 0.5d | none | read-only | pending |
| 1 last_message_at | 1d | 0 | medium (write DB idempotent) | pending |
| 2 phantom+media | 1d | 1 | low | pending |
| 3 null wa_id | 0.5d | 1 | low | pending |
| **4 goyang P0** | **1d** | **0** | **low (UI only)** | **next** |
| **5 search P0** | **0.5d** | **0** | **low** | **next** |
| **6 tanggal P1** | **1d** | **0** | **low** | **next** |
| 7 observabilitas | 0.5d | 1-6 | low | pending |
| 8 jump & highlight | 0.5d | 5 | low | pending |
| **Total v2** | **~6.5 hari** | | | |

Rekomendasi eksekusi: **Fase 4+5+6 dulu** (2.5 hari, impact langsung ke laporan user), lalu Fase 1-3.

---

## 6. Verifikasi & Deploy

- **Lokal:** `WAHA_MOCK=true npm test` (Vitest), `npm run build` (`tsc` + `vite build`), `npx prisma migrate diff --from-url` empty.
- **Staging:** `docker compose up -d` pinned `noweb-2026.7.2`, `waha` healthy, test iOS ketik 30s, test search `628113141111` (list filter tanpa banner), test tanggal 23:55 WIB.
- **Prod (2-step gate, `.agents/rules/server-update-gate.md`):** Backup `pg_dump`, repair `--dry-run` dulu, `docker compose up -d --no-deps app` (jangan `latest` WAHA), `docker logs -f app` 2 menit, bandingkan 2 nomor sample WA Web vs LiveChat.

---

## 7. Risiko & Mitigasi

- **WAHA down saat repair** → tunda Fase 1-3, Fase 4-6 tetap jalan (UI only).
- **Migrasi drift** → `--from-url` bukan `--from-migrations` (`KNOWN_ISSUES#1`).
- **Goyang regresi** → feature flag `LIVECHAT_VIEWPORT_FIX=false`, revert 1 commit.
- **Search regresi** → jika global search butuh `messages.content` like, index sudah ada (`knowledge_chunks_tenant_id_idx`).

---

## 8. Notes Eksekutor

- **File diubah Fase 4-6:** `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`, `src/utils/dateWib.ts` (baru), `components/livechat/Composer.tsx` (baru), `src/routes/admin/livechat.subroute.ts:320` (rate-limit typing).
- **Cara lanjut:**
  ```bash
  git checkout plan/livechat-wa-sync
  # Fase 4+5+6 dulu
  # edit LiveChatMonitor.tsx:483,1065,1105,1207,3167 + buat Composer.tsx + dateWib.ts
  npm run build && npm test
  npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
  git commit -m "fix(livechat): goyang typing + search decoupling + tanggal WIB"
  git push origin plan/livechat-wa-sync
  ```
- **Jangan deploy Jumat malam / jam iklan.**
- **Catat ke `docs/KNOWN_ISSUES.md` setelah selesai:** tambah `#19 Goyang Typing` + `#20 Search Banner` + `#21 Tanggal WIB` dengan `Status: fixed (2026-09-01)`.

