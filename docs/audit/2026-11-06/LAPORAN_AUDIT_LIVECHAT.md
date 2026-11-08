# Laporan Audit Modul 6 — Live Chat CS & Hybrid Takeover

- **Tanggal audit:** 2026-11-06
- **Sifat:** audit baca-saja + implementasi Fase 0–5 (disetujui pengguna pada sesi terkait).
- **Status dokumen:** **rekonstruksi** dari `docs/KNOWN_ISSUES.md` #316 dan `CHANGELOG.md` (2026-11-06). Ini **bukan audit ulang**; tidak ada kode yang diubah saat dokumen ini dibuat.
- **Cakupan:** `src/routes/admin/livechat.subroute.ts`, `src/services/live-chat.service.ts`, `conversation.service.ts`, `message.service.ts`, `live-chat-hub.service.ts`, `waha-history-sync.service.ts`, `media.route.ts`, `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx` (7.932 baris), `LiveChatComposer.tsx`, `liveChatSse.ts`, `useLiveChatNotification.ts`, `index.css`, `tailwind.config.js`, `manifest.json`.
- **Framework:** 5 Dimensi Audit (Rules, Flow/UX, Log Mesin, RAG — tidak relevan untuk UI, Prompt — tidak relevan untuk UI) + OWASP (auth/tenant/PII) + heuristik mobile.

---

## 1. Ringkasan Eksekutif

Live Chat memiliki fungsi inti yang berjalan, tetapi audit menemukan **ghost error, pesan dobel, invoice fiktif, riwayat bolong, badge unread drift, kebocoran media lintas tenant, dan navigasi back yang rusak**. Ditemukan **6 temuan kritis (K-01–K-06)**, **12 temuan tinggi (T-01–T-12)**, dan sejumlah temuan sedang. Fase 0–5 telah diimplementasikan: 50 test baru/regresi, build backend & dashboard hijau, dan full suite 6.590 lulus. Sisa di luar kode: **uji perangkat fisik** dan **deploy staging/produksi**.

---

## 2. Status Temuan

### 2.1 Kritis

| ID | Temuan | Status |
|---|---|---|
| K-01 | Pesan sudah terkirim ke WhatsApp lalu `logMessage` gagal → route 500 → UI "gagal" → admin kirim ulang (dobel) | **FIXED Fase 0** |
| K-02 | Invoice dari chat memakai fallback fiktif (`distanceKm 3.0`, `ongkir 0`, treatment `"Pijat Ceria"`, jam `"12.00-12.30"`) | **FIXED Fase 1** — diblokir gerbang kode bila data tidak lengkap |
| K-03 | Mutasi `where:{id}` tanpa `tenant_id` + fallback memory lintas tenant; media inbound tidak membandingkan tenant + `Cache-Control: public`; sync history memakai `wahaClient` global | **FIXED Fase 3**; K-03b (gateway/humanizer per tenant) **FIXED Fase 5** |
| K-04 | Persona saran balasan hardcode `"Bidan Yusi dari Kala Moms & Baby Spa"`; kegagalan LLM disamarkan sebagai sukses | **FIXED Fase 1** — persona dari `getBrandIdentityAsync(tenantId)`, LLM gagal → 500 |
| K-05 | `error` berupa objek → `new Error(obj)` = `"[object Object]"`; `acknowledgeOutsideWindow` tidak pernah dikirim FE | **FIXED Fase 0** |
| K-06 | Badge unread sidebar hanya naik, reset hanya pada `allRead` → beda dengan `getTotalUnreadCount` | **FIXED Fase 2** — rekonsiliasi dari endpoint DB |

### 2.2 Tinggi

| ID | Temuan | Status |
|---|---|---|
| T-01 | Ghost read — update DB gagal ditelan tetapi SSE tetap `unreadCount:0` + route 200 | **FIXED Fase 2** — `degraded:true`, tanpa siaran palsu |
| T-02 | Warning `NO_ACTIVE_RESERVATION_TODAY` dikirim backend tetapi dibuang FE | **FIXED Fase 0** |
| T-03 | Event SSE dipublikasikan tetapi tidak didaftarkan klien (`staff.trip_delay_warning`, `staff.trip_arrived`, `sync.progress`, `bot.active_changed`) | **FIXED Fase 0** |
| T-04 | Stale closure `loadChats`; filter label memicu 2 request | **FIXED Fase 2** — refs + satu reload |
| T-05 | Gagal muat thread → `setMessages([])` → "Belum ada pesan" tanpa error/retry | **FIXED Fase 1** |
| T-06 | Gagal kirim menghapus teks + meninggalkan preview sidebar "terkirim" | **FIXED Fase 0** |
| T-07 | Header Live Chat mobile tanpa safe-area notch | **FIXED Fase 0** |
| T-08 | History ganda per buka chat + entri modal tidak di-pop + `popstate` mengabaikan state | **FIXED Fase 2** — perlu uji perangkat |
| T-09 | Cursor paginasi hanya `created_at < cursor` tanpa tie-breaker | **FIXED Fase 2** — cursor komposit `created_at\|id` |
| T-10 | Reaksi optimistis tanpa rollback | **FIXED Fase 1** |
| T-11 | Modal `90vh`/`85vh`; modal Sinkronisasi tanpa `max-h`/scroll | **FIXED Fase 4** — `dvh` + scroll |
| T-12 | God Object 7.932 baris + nyaris tanpa test frontend (hanya 3 test integrasi) | **SEBAGIAN** — logika murni diekstrak; dekomposisi komponen visual belum |

### 2.3 Sedang / Limitasi

- FIXED: interpolasi quick reply mengambil reservasi lama (Fase 5), tap target 16–27 px (Fase 4), toggle AI tidak ada di thread (Fase 5), paste gambar diblokir (Fase 4), gap keyboard composer (Fase 4), `hover:` sticky (Fase 4), kontras pemisah tanggal dark (Fase 4), `recentReplies` tanpa prune (Fase 3), race cancel sync + `last_message_at` mundur (Fase 3), dedupe membuang pesan identik <2 dtk (Fase 5), `sync-full` ghost success (Fase 5), auto mark-read tanpa rollback (Fase 2).
- **Limitasi diterima:** voice note mengunduh penuh (tanpa Range/MediaSource) — memerlukan pipeline streaming khusus.
- **Sisa by-design:** `AdminSession` tidak menyimpan `tenant_id` → admin diperlakukan super-admin lintas tenant.

---

## 3. Verifikasi

- `npm run build` backend & dashboard exit 0.
- CSS hasil build diverifikasi memakai `@media (hover: hover)`.
- **219 test / 27 file** Live Chat, media & util lulus (50 test baru/regresi).
- 25/25 test gateway & typing; 6/6 toggle bot.
- Full suite: **6.590 lulus / 2 gagal pre-existing** (#287, `hybrid-reservation-parser`) / 28 skipped.
- **Belum:** uji perangkat fisik (T-08, safe-area, keyboard, tap target, pemutaran media) dan deploy staging/produksi.

---

## 4. Batasan & Celah Cakupan

- Audit dilakukan pada 2026-11-06; dokumen ini direkonstruksi pada 2026-11-07 dari catatan #316/CHANGELOG, bukan dari eksekusi ulang.
- Tidak ada akses perangkat fisik, server produksi, atau database live.
- Log mesin produksi tidak diperiksa untuk audit ini.
- Modul 4 (Reservasi) tidak diaudit ulang; titik sambung invoice/alamat dirujuk ke #313/#314.
- Dekomposisi visual `LiveChatMonitor.tsx` (Sidebar/MessageList/Header) masih pekerjaan terpisah dan membutuhkan uji perangkat + PR bertahap.

---

## 5. Rujukan

- `docs/KNOWN_ISSUES.md` #316 (sumber utama status per temuan).
- `CHANGELOG.md` — entri 2026-11-06 "Audit Live Chat Fase 0–5".
- Laporan konsolidasi: `docs/audit/2026-11-07/RINGKASAN_AKHIR_AUDIT_MODUL_1-11.md`.
