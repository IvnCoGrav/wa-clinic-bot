# Re-baseline LiveChatMonitor.tsx — Fase S5.0

**Tanggal:** 2026-11-09  
**Status:** READ-ONLY COMPLETED (Prasyarat S5.1)  
**File Target:** `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`  
**Ukuran File Aktual:** 8.127 baris (427.033 bytes)  
**Tujuan:** Memetakan arsitektur, hook, dependency, dan batas komponen riil sebelum pemecahan (S5.1) untuk mencegah regresi render, state thrashing, atau putusnya komunikasi SSE.

---

## 1. Baseline Metrik Build & Pengujian

| Pengujian / Toolchain | Perintah | Hasil Aktual | Keterangan |
|---|---|---|---|
| **Frontend Build & Typecheck** | `npm --prefix packages/admin-dashboard run build` | **PASS (Exit 0, 16.48s)** | Bundle `LiveChatMonitor-*.js` berukuran **305.58 kB** (gzip: 78.00 kB). |
| **Unit Test LiveChat Frontend** | `npx vitest run tests/unit/livechat-*.test.ts` | **PASS (20/20 lulus, 2.30s)** | Mencakup `livechat-thread-dedupe`, `livechat-navigation`, `livechat-source-filter`. |
| **Full Suite Backend + Harness** | `npm test` | **6.715 lulus / 2 pre-existing (#287) / 0 regresi** | Baseline stabil dari `f3c6a2c4` & `dcd53af7`. |

---

## 2. Peta Anatomi & Struktur File Aktual (8.127 Baris)

### 2.1 Blok 1: Impor, Konstanta, Tipe Data & Helper (Baris 1 – 346)
- **Baris 1–149**: Impor React, Lucide Icons (60+ ikon), utilitas format tanggal WIB (`dateWib.ts`), utilitas pencocokan jadwal (`chatScheduleExtractor.ts`), modul media (`mediaExtractor.ts`), dan modal eksternal.
- **Baris 150–188**: Helper teks: `renderHighlightedText`, `cleanSnippetText`, `extractSmartSearchSnippet`.
- **Baris 189–255**: Definisi Interface Inti:
  - `QuotedMessageData` (baris 189–198)
  - `ChatMessage` (baris 199–223)
  - `CustomerLabelData` (baris 256–262)
  - `LiveChatItem` (baris 263–346) — metadata percakapan, status alur, badge, label, CRM status.
- **Baris 224–255**: Helper ekstraksi pesan kutipan WhatsApp (`extractQuotedMessage`) dan pemisah tanggal chat.

### 2.2 Blok 2: Logika Komponen & State Machine Raksasa (Baris 347 – 3.656)
Total Hooks terdeteksi:
- **88 `useState`**: State filter percakapan, pencarian, pesan aktif, draf pesan, modal visibility, status bot pause, form data.
- **37 `useEffect`**: Lifecycle SSE, polling fallback, sinkronisasi URL search params, auto-scroll, resize listener, hotkeys.
- **17 `useRef`**: Message container ref, bottom scroll anchor, audio players, search input, timers.
- **6 `useCallback` & 5 `useMemo`**: Filter percakapan, sorotan teks, debounce search.
- **Sub-Modul Draf & Scroll (Baris 666–739)**:
  - `saveConversationDraft`, `loadConversationDraft`, `clearConversationDraft` (dapat diekstrak ke hook `useLiveChatDrafts`).
  - `getConversationScroll`, `saveConversationScroll` (dapat diekstrak ke hook `useLiveChatScroll`).

### 2.3 Blok 3: Render Pane Kiri — Daftar Percakapan / Thread List (Baris 3.657 – 5.409)
- **Baris 4.430–4.575**: Header desktop: Status koneksi SSE, tombol Pause/Resume Bot global, indikator delay bidan, banner peringatan AI-Off, trigger sinkronisasi.
- **Baris 4.584–4.692**: Header mobile flow: Menu navigasi hamburger, trigger sinkronisasi chat.
- **Baris 4.693–4.794**: Filter bar: Tab sumber (WhatsApp Asli, Sandbox, Semua) + dropdown label CRM & tombol Mark All Read.
- **Baris 4.795–4.863**: Sticky search bar & sticky AI toggle mobile.
- **Baris 4.864–5.409**: Looping Card Percakapan:
  - Avatar, Nama, Grup 1 Label (CRM tags di bawah nama, HOLD/Terjadwal badge).
  - Kolom kanan: Tombol Release/Takeover CS, Unread Badge / Orange Dot.
  - Preview snippet chat (highlight hasil pencarian).
  - Grup 2 Footer: Metrik medis, repeat order, traffic Meta/Legacy, Sandbox badge, timestamp WIB, dan status alur CS/Bot.

### 2.4 Blok 4: Render Pane Tengah — Ruang Obrolan / Message Pane (Baris 5.410 – 6.800)
- **Baris 5.410–5.630**: Header Chat Pasien Aktif: Avatar, nama, detail nomor, badge kepemilikan staf (`StaffOwnershipBadge`), dot label aktif, popover penambah label (+), search in-chat, toggle bot release/takeover.
- **Baris 5.631–6.071**: Rangkaian Alert Banner Kontekstual:
  - Active Hold Slot Banner (Single-line ultra-compact di mobile vs full bar).
  - Active Payment Proof Banner (notifikasi bukti transfer masuk).
  - Confirmed / Terjadwal Banner (detail jadwal & waktu).
  - Pending Schedule Banner.
  - Palang Pintu Kunjungan Tanpa Reservasi Aktif (MT-2.2).
- **Baris 6.072–6.120**: In-chat search navigation bar & pinned message banner (`MessagePinBanner`).
- **Baris 6.121–6.800**: Gelembung Obrolan (Chat Bubbles) dengan Wallpaper WhatsApp:
  - Indikator riwayat lama (scroll to load older messages).
  - Quick emoji reaction toolbar & grid popover.
  - Quoted message / WhatsApp reply preview.
  - Multi-tipe pesan: Voice Note PTT, Dokumen/PDF, Video, Kontak vCard, Foto/Gambar (dengan modal preview), Lokasi (GPS Pin & Shareloc), dan Teks Utama.
  - Emoji reaction badges attached di pojok bawah gelembung chat.

### 2.5 Blok 5: Render Composer / Balas Pesan (Baris 6.801 – 6.940)
- **Baris 6.801–6.940**: Integrasi dengan komponen terpisah `<LiveChatComposer />`, penanganan draf per percakapan, quick reply popover, dan tombol lampiran.

### 2.6 Blok 6: Rangkaian Modal & Drawer Kontekstual (Baris 6.941 – 8.127)
1. **Modal Detail Pelanggan (Baris 6.942–7.286)**: Profil lengkap, metrik loyalitas, kartu alamat, data anak, riwayat reservasi, dan follow-up queue.
2. **Modal Edit Profil Pelanggan (Baris 7.287–7.312)**: `<CustomerEditForm />`.
3. **Drawer Buku Alamat (Baris 7.313–7.333)**: `<AddressBookDrawer />`.
4. **Modal Detail Reservasi (Baris 7.334–7.366)**: `<ReservationDetailModal />`.
5. **Modal Penampil Bukti Transfer (Baris 7.367–7.482)**: Zoom gambar, verifikasi nominal & status bayar.
6. **Modal Buat Reservasi Cepat (Baris 7.483–7.565)**: `<CreateReservationModal />`.
7. **Modal Quick Hold (Baris 7.566–7.617)**: `<QuickHoldModal />` (kunci slot kilat 3 detik).
8. **Modal Jadwal Harian (Baris 7.618–7.631)**: `<DailyScheduleModal />`.
9. **Modal Generator Invoice (Baris 7.632–7.650)**: `<InvoiceGeneratorModal />`.
10. **Action Sheet Mobile & Context Menu Desktop (Baris 7.651–7.939)**: Aksi cepat pesan (copy, quote, pin, delete, forward).
11. **Modal Edit Pesan (Baris 7.940–8.015)**.
12. **Modal Ekspor Percakapan (Baris 8.016–8.028)**: `<ChatExport />`.
13. **Modal Konfirmasi Sinkronisasi WhatsApp (Baris 8.029–8.125)**: Panduan sinkronisasi riwayat obrolan dari server WAHA.

---

## 3. Strategi Dekomposisi Modular S5.1

Untuk menurunkan ukuran `LiveChatMonitor.tsx` dari **8.127 baris menjadi < 1.500 baris**, ekstraksi dibagi menjadi unit independen:

```
packages/admin-dashboard/src/
├── hooks/
│   ├── useLiveChatDrafts.ts          (~70 baris)  -- Draf pesan per-conversation
│   ├── useLiveChatScroll.ts          (~60 baris)  -- Scroll position restore
│   └── useLiveChatAlerts.ts          (~180 baris) -- Logic status banner & delay
├── components/livechat/
│   ├── LiveChatThreadList.tsx        (~850 baris) -- Blok 3: Panel kiri & cards
│   ├── LiveChatMessagePane.tsx       (~1.100 baris) - Blok 4: Header chat, banners, bubbles
│   ├── LiveChatCustomerModal.tsx     (~380 baris) -- Blok 6: Customer Detail Modal
│   ├── LiveChatPaymentProofModal.tsx (~140 baris) -- Blok 6: Payment Proof Viewer
│   ├── LiveChatMessageContextMenu.tsx (~280 baris) - Blok 6: Action Sheet & Desktop Menu
│   └── LiveChatSyncModal.tsx         (~120 baris) -- Blok 6: WhatsApp Sync Info
└── pages/tenant/
    └── LiveChatMonitor.tsx           (< 1.200 baris) - Orchestrator utama & state glue
```

---

## 4. Rencana Pengujian & Regression Gate

Setiap sub-langkah ekstraksi pada S5.1 WAJIB lolos verifikasi bertingkat:
1. `npm --prefix packages/admin-dashboard run build` — wajib Exit 0 tanpa error tipe TypeScript.
2. `npx vitest run tests/unit/livechat-*.test.ts` — 20 test unit livechat tetap hijau.
3. Bundle size `LiveChatMonitor-*.js` di-monitor agar terpecah ke modular chunks yang lebih ramping.
