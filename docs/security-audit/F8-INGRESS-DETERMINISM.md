# F8 — Determinisme Ingress WAHA/WABA (2026-11-27)

Status: **source selesai; gerbang regresi PASS**. Tidak ada migrasi DB (memakai `Conversation.session_data` yang sudah ada).

## 1. Perubahan

| Task | Temuan | Perubahan | File |
|---|---|---|---|
| T8.1 | `M01-08-LABEL-LID-AS-PHONE` | Label event `@lid` tidak lagi diparse menjadi nomor HP. Hanya JID bertipe `phone` (atau LID yang sudah dipetakan di cache `remoteJidAlt`/LID) yang boleh menandai customer; LID tak terpetakan/grup/broadcast → label tidak ditulis + cache di-invalidate. Handler dipindah ke seam `services/ingress/label-event.service.ts`. | `src/services/ingress/label-event.service.ts`, `src/routes/webhook.route.ts` |
| T8.2 | `M01-14-YA-CONFIRM-COALESCED` | Saat percakapan sedang menunggu konfirmasi `/reset` (state persisten), coalescer **tidak** menunda/menggabung pesan apa pun — pesan dibaca utuh oleh command gate. Menghapus kemungkinan "ya" tergabung dengan pesan lain sehingga exact-match konfirmasi hilang. | `src/services/burst-coalesce.service.ts` |
| T8.3 | `M01-15-RESET-AMBIGUOUS-YA` | Konfirmasi `/reset` dipindah dari `Map` proses ke `Conversation.session_data.reset_pending_at` (persisten, per tenant+percakapan). "YA" hanya dieksekusi bila prompt `/reset` belum kedaluwarsa (TTL 5 menit); pesan lain membatalkan pending. Repository `updateState` diperluas dengan `sessionData` (satu seam tulis). | `src/services/command.service.ts`, `src/repositories/conversation.repository.ts` |
| T8.4 | `M02-10-STATUS-UNKNOWN-PHONE-500` | Status webhook dengan `phone_number_id` tak dikenal **diabaikan** (log + `continue`, respons 200) tanpa membatalkan status lain di batch yang sama. Error transien non-tenant tetap dilempar agar Meta retry. | `src/routes/waba-webhook.route.ts` |
| T8.5 | `M02-11-REACTION-PRE-DEDUP-MUTATION` | Seam baru `security.inbound_event_dedup` (`SET NX` di DistributedKv + fallback memori, TTL 10 menit). Reaction WAHA & WABA diklaim **sebelum** mutasi; duplikat → 200 `REACTION_DUPLICATE` tanpa menulis payload/broadcast SSE. | `src/services/inbound-event-dedup.service.ts`, `src/routes/webhook.route.ts`, `src/routes/waba-webhook.route.ts`, `scripts/module-registry.json` |
| T8.6 | `M02-12-STOP-BYPASS-EARLY-RETURN`, `M02-12-STOP-LOST-BY-COALESCE` | Opt-out dievaluasi di **choke point ingress WABA** sebelum early-return apa pun (stale, bypass, blocked, abuse, scope-gate silence, HUMAN_HANDLING): update `marketing_opt_in=false`, batalkan follow-up, log inbound, ack transaksional bila bukan sesi CS. Coalescer memperlakukan STOP/UNSUBSCRIBE sebagai pesan berprioritas (flush buffer, tidak pernah di-merge); batch lama yang terlanjur memuat STOP dikirim per-pesan (defensif). | `src/routes/waba-webhook.route.ts`, `src/services/waba-optout.service.ts`, `src/services/burst-coalesce.service.ts` |
| T8.7 | `M02-13-WABA-TYPE-MAPPING-GAP` | Normalizer memetakan `button` → `interactive_button` (judul tombol = teks customer), `order`, `system`, `unsupported` sebagai tipe eksplisit. Konten audit kanonis dipindah ke `buildWabaCanonicalContent` sehingga order/system/unsupported **tidak lagi** tampil `[IMAGE]`. Notifikasi `system`/`unsupported` dicatat ke audit trail tetapi **tidak** diantrekan ke bot (bukan pesan customer). | `src/integrations/whatsapp/normalizer.ts`, `src/integrations/whatsapp/types.ts`, `src/integrations/whatsapp/gateway.types.ts`, `src/routes/waba-webhook.route.ts` |

## 2. Test baru

- `tests/unit/f8-label-lid-identity.test.ts` (4): LID tak terpetakan tidak menandai customer; LID terpetakan memakai nomor asli; JID `@c.us` tetap jalan; grup/broadcast diabaikan.
- `tests/unit/f8-reset-pending.test.ts` (6): pending tersimpan di `session_data` (bukan memori proses); YA dengan pending → arsip; YA tanpa pending → tidak ada aksi; pending kedaluwarsa → tidak dieksekusi + penanda dibersihkan; pesan lain membatalkan pending; pending percakapan lain tidak memengaruhi.
- `tests/unit/f8-stop-priority.test.ts` (7): 4 varian STOP/UNSUBSCRIBE tidak pernah dibuffer; buffer lama di-flush tanpa menggabungkan STOP; saat reset pending pesan tidak ditunda; pending kedaluwarsa → coalescing normal lagi.
- `tests/unit/f8-waba-status-and-types.test.ts` (3): status phone tak dikenal diabaikan sementara status valid tetap diproses (200, count 1); button/order/system/unsupported dipetakan eksplisit dan tidak menjadi `[IMAGE]`; `system`/`unsupported` dicatat tetapi tidak diantrekan ke bot.
- `tests/unit/f8-reaction-dedup.test.ts` (4): reaction WAHA duplikat → mutasi sekali; emoji berbeda → event baru; reaction WABA duplikat → mutasi sekali; dedup service pulih setelah TTL.

## 3. Deviasi & catatan

- **T8.2/T8.3 memakai `session_data`, bukan enum state baru.** Menambah `ConversationState.RESET_PENDING` akan memaksa migrasi enum; `session_data` sudah menjadi rumah state episodik V3 dan bersifat per-percakapan+tenant, sehingga cukup dan tidak menambah risiko deploy. Bila DB offline, penanda tetap hidup di snapshot proses (degradasi jujur).
- **Opt-out di ingress WABA** memakai keyword yang sudah menjadi kontrak industri (STOP/UNSUBSCRIBE/BATAL PROMO) lewat service yang ada — bukan pencocokan kalimat bebas. Keputusan ini menjaga perilaku opt-out yang sudah diuji.
- **Dedup reaction** memakai kunci target+aktor+emoji+timestamp/ID event. Bila provider sama sekali tidak mengirim timestamp/ID event, re-add emoji yang sama dalam 10 menit dapat dianggap duplikat; ini trade-off yang dipilih agar retry tidak menggandakan mutasi/broadcast.
- **Ack opt-out** tidak dikirim bila percakapan sedang `HUMAN_HANDLING` (menghormati CS), tetapi status opt-out DB tetap ditulis.
- **T8.4** hanya mengabaikan `UNKNOWN_PHONE_NUMBER_ID`; error DB transien tetap dilempar agar Meta melakukan retry (bukan silent loss).

## 4. Status temuan

| Fingerprint | Status |
|---|---|
| `M01-08-LABEL-LID-AS-PHONE` | FIXED in source |
| `M01-14-YA-CONFIRM-COALESCED` | FIXED in source |
| `M01-15-RESET-AMBIGUOUS-YA` | FIXED in source |
| `M02-10-STATUS-UNKNOWN-PHONE-500` | FIXED in source |
| `M02-11-REACTION-PRE-DEDUP-MUTATION` | FIXED in source |
| `M02-12-STOP-BYPASS-EARLY-RETURN` | FIXED in source |
| `M02-12-STOP-LOST-BY-COALESCE` | FIXED in source |
| `M02-13-WABA-TYPE-MAPPING-GAP` | FIXED in source |

## 5. Gerbang (run final 2026-11-27)

| Perintah | Hasil |
|---|---|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run check:reuse` | 189 = baseline, 0 baru |
| `check:architecture` | 58 = baseline, 0 baru |
| Test F8 + label/command/burst/webhook terkait | 54 pass |
| `npm test` penuh (run final setelah perbaikan review) | **8692 pass, 1 gagal, 28 skipped** (1111 file). Satu-satunya kegagalan `reuse-gate`: 64,2 dtk > 60 dtk di bawah beban; lulus 14/14 saat dijalankan terpisah. Flake media #368 tidak muncul di run ini. |
