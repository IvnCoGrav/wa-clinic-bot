# Rencana Perbaikan Opsi C — Konsolidasi Sumber Kebenaran State

Status: **SUDAH DIEKSEKUSI (C1–C4)** pada 2026-10-06 atas persetujuan eksplisit pemilik.

Hasil eksekusi:
- C1: fungsi kanonis `getLastCustomerActivityMs` (conversation.service.ts) + dipakai `machine.ts` & `bolehKirimProaktif`. Test `tests/unit/last-customer-activity.test.ts` (6) hijau.
- C2: `onReservationCompleted` kini menulis `current_state=COMPLETED` (reservation-lifecycle.service.ts). Test `tests/unit/reservation-completed-state.test.ts` (4) hijau.
- C3: dikunci (bukan diubah) — komitmen tanpa tool + funnel; test `tests/unit/v3/funnel-commitment-without-tool.test.ts` (5) hijau, red-capability terbukti.
- C4: replay transkrip produksi jalur V3; test `tests/integration/production-transcript-replay.test.ts` (6) hijau, red-capability terbukti.
- Gate akhir: `npm run build` exit 0. `npm test`: 5005 passed; 7 gagal **pre-existing** (terbukti sama tanpa perubahan via `git stash`), bukan regresi C1–C4.
Dasar: `docs/audit/FRAGILITY_AUDIT.md` (akar R2 + R4). Setiap klaim di bawah sudah
diverifikasi ke kode pada 2026-10-06 — nomor baris bisa bergeser; executor WAJIB
verifikasi ulang dengan `git grep -n` sebelum menyentuh file.

## Aturan executor (wajib)

1. Urutan fase WAJIB C1 → C2 → C3 → C4 (dependensi: definisi waktu → penulis state → komitmen → kunci regresi).
2. Setiap fase: tulis/aktifkan test dulu (red) → perbaiki → hijau → regression gate → baru lanjut.
3. DILARANG menambah dependency runtime baru, DILARANG menambah teks "DILARANG…" di prompt,
   DILARANG menambah regex/daftar kata baru, DILARANG melonggarkan masking `save_reservation`.
4. Regression gate tiap fase: `npm run build` + suite terkait hijau. Bila gate merah, BERHENTI, jangan lanjut.
5. Rollback per fase: revert commit fase itu saja (satu fase = satu commit).

## Fase C1 — Satu definisi "jam aktivitas customer" (estimasi: kecil)

Masalah (terverifikasi): tiga pembaca memakai tiga definisi berbeda.
- `src/state-machine/machine.ts:252` — idle reset pakai `last_message_at` (ikut pesan bot).
- `src/services/conversation.service.ts:798` (`bolehKirimProaktif`) — pakai
  `last_message_at || last_customer_message_at` (prioritas terbalik: aktivitas bot didahulukan).
- `src/services/ai-scope-gate.service.ts:50` — sudah benar: `last_customer_message_at ?? last_message_at`.
- Penulis kolom benar sudah ada: `conversation.service.ts:681` (`updateLastCustomerMessageAt`),
  dipanggil dari `webhook.route.ts:1142` dan `waba-webhook.route.ts:337`.

Mikro-tugas:
1. Tambah satu fungsi kanonis di `src/services/conversation.service.ts` (dekat L681):
   `getLastCustomerActivityMs(conversation)` → `last_customer_message_at ?? last_message_at ?? 0`.
2. Ganti `machine.ts:252` memakai fungsi kanonis (satu baris).
3. Ganti `conversation.service.ts:798` memakai fungsi kanonis (perbaiki prioritas terbalik).
4. Tambah test unit (4 kasus: hanya `last_message_at`, hanya `last_customer_message_at`,
   keduanya beda, keduanya kosong) + pastikan test idle lama hijau:
   `tests/integration/idle-reset-clears-v3-session.test.ts`.
5. Perintah: `npx vitest run tests/integration/idle-reset-clears-v3-session.test.ts` lalu `npm run build`.

Kriteria lolos: `git grep -n "last_message_at" -- src/state-machine src/services/conversation.service.ts`
tidak lagi menampilkan pembacaan langsung untuk keputusan idle selain di fungsi kanonis;
suite idle hijau; build lolos.

## Fase C2 — Satu pintu penulis `current_state` + status COMPLETED yang nyata (estimasi: sedang)

Masalah (terverifikasi): TIDAK ADA kode yang menulis `COMPLETED` ke DB
(`git grep` hanya menemukan pembaca + derivasi in-memory `phase-resolver.ts:143`).
`reservation-lifecycle.service.ts:281-295` (`onReservationCompleted`) mengosongkan sesi V3
tanpa menulis `current_state` → state bisa tertinggal di `RESERVATION_SENT` berminggu-minggu.
Satu-satunya pintu persist per giliran: `machine.ts:728-737` (`result.nextState`, dari
`agent-runner.ts:491-493` via `deriveConversationState`).

Mikro-tugas:
1. Di `reservation-lifecycle.service.ts` (`onReservationCompleted`, setelah blok reset sesi
   ~L296), tulis `current_state = COMPLETED` via `conversationService.updateConversationState`
   (pola sama seperti `machine.ts:729-736`, dengan `previousState` = state lama).
2. Pastikan derivasi `deriveConversationState` (`phase-resolver.ts:141-155`) tidak menimpa
   COMPLETED kembali ke RESERVATION_SENT pada giliran berikutnya (urutan cek: booking
   selesai → COMPLETED dulu, baru cek `ask_schedule`).
3. Tambah test: (a) unit derivasi — sesi dengan `booking.reservationId` → COMPLETED;
   (b) integrasi — alur save → completed → `current_state` = COMPLETED dan tetap COMPLETED
   setelah giliran tanya jadwal berikutnya.
4. Perintah: `npx vitest run tests/integration/` (terkait reservasi/state) lalu `npm run build`.

Kriteria lolos: `git grep -n "ConversationState.COMPLETED" -- src` menampilkan penulis
lifecycle + jalur persist mesin; tidak ada lagi reservasi `completed` dengan `current_state`
`RESERVATION_SENT` pada data baru (test).

## Fase C3 — Kunci komitmen: satu sumber, tetap tanpa pelonggaran tool (estimasi: sedang)

Fakta (terverifikasi, koreksi atas audit awal): latch komitmen SUDAH ADA dari dua sumber
yang menulis flag yang sama — verdict router (`agent-runner.ts:287-293`, saat
`routing.commitment === 'COMMITTED'`) dan sinyal kata (`context-grounder.ts:306-312` via
`hasBookingCommitSignal`). Pembersihnya juga dua: retreat (`context-grounder.ts:317-324`)
dan pasca-save (`tool-pipeline.ts:874-876`). Funnel membaca flag ini via
`isFunnelCommitted` (`phase-resolver.ts:127-134`). Masking `save_reservation` tetap
ketat (`tool-masker.ts:544,572`: butuh treatment + lokasi + tanggal).

Mikro-tugas:
1. Tetapkan hierarki tertulis di kode (komentar): verdict router = primer; sinyal kata =
   fallback hanya bila router tak tersedia. Tanpa mengubah perilaku default.
2. Tambah test regresi kasus "komitmen tanpa tool": router COMMITTED + TIDAK ADA tool call →
   `bookingCommitConfirmed === true`, `isFunnelCommitted(session) === true`, dan funnel
   reprompt TIDAK menghapus pertanyaan jadwal yang sah. (Pola test: tiru
   `tests/integration/deterministic-guardrails-session-337880.test.ts`.)
3. Verifikasi pengaman: test masking `save_reservation` yang ada tetap hijau (tidak ada
   pelonggaran — save tetap butuh treatment + lokasi + tanggal).
4. Perintah: `npx vitest run tests/integration/deterministic-guardrails-session-337880.test.ts`
   + file test baru, lalu `npm run build`.

Kriteria lolos: test baru hijau; seluruh test masking/save_reservation lama hijau;
`git grep` tidak menampilkan penulis flag komitmen baru di luar dua yang sudah ada.

## Fase C4 — Kunci regresi: replay transkrip produksi di jalur V3 (estimasi: sedang)

Masalah (terverifikasi): `scripts/replay-real-customer-cases.ts:17-21` mengimpor
`src/slot-engine/*` (mesin lama), bukan `src/v3/*` (jalur produksi) → replay tidak
menguji kode yang jalan. Seam resmi untuk stub LLM sudah ada dan dipakai golden corpus:
`GenerationStage.executeChatCompletion` (`generation-stage.ts:536`), contoh stub di
`tests/golden-corpus/golden-corpus.test.ts:116-118`, harness offline di
`tests/integration/helpers/chat-harness.ts`.

Mikro-tugas:
1. Buat `tests/integration/production-transcript-replay.test.ts` yang memutar 4 transkrip
   Fase 4b (disanitasi: nama/nomor → `<REDACTED>`) giliran-per-giliran lewat
   `ConversationStateMachine` asli + stub LLM deterministik.
2. Asert deterministik (yang BISA diuji tanpa LLM asli): `save_reservation` tidak pernah
   terpanggil tanpa treatment + tanggal; maksimal 1 balasan bot per giliran customer;
   tidak ada balasan yang ditarik (pola `🚫 Pesan ini telah ditarik`).
3. Jujur pada batas: kegagalan murni putusan LLM tidak terwakili stub — cantumkan sebagai
   komentar di file test + usulan suite LLM-eval terpisah.
4. Perintah: `npx vitest run tests/integration/production-transcript-replay.test.ts`
   lalu `npm run build`.

Kriteria lolos: 4 transkrip hijau; bila salah satu gate dimatikan sengaja, test MEMERAH
(buktikan sekali dengan menonaktifkan masker di branch test saja, lalu kembalikan).

## Setelah C1–C4

- Catat sisa OPEN ke `docs/KNOWN_ISSUES.md` bila muncul temuan baru (sudah ada entri 235).
- Baru pertimbangkan opsi B/A bila takeover tidak turun setelah 2 minggu pengukuran ulang Fase 7.
- Rencana ini TIDAK menyentuh prompt, harga, katalog, atau SOP — murni state + kontrak tool + test.
