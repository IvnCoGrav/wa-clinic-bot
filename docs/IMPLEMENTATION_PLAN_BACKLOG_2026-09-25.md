# Implementation Plan Konsolidasi — Backlog Fondasional Chatbot Klinik (2026-09-25)

> Status baca: RENCANA, bukan eksekusi. Dilarang eksekusi fase mana pun tanpa konfirmasi eksplisit per fase.
> Legenda: ✅ baris terverifikasi penulis · 🔍 klaim audit-paralel, verifikasi `file:line` + log dulu (Mandat Validasi Plan).
> Aturan global: tiap fase = TDD dulu (test merah), gate regresi hijau, `npm run build`, tanpa push live tanpa sebut eksplisit.

---

## §0. Posisi Terkini (apa yang sudah live vs lokal)

| Commit | Isi | Live? |
|---|---|---|
| `cb61c3a0` | Sanitizer nomor HP 5-digit chat terapis (backend allowlist + SSE + frontend) | ✅ push |
| `310c27c0` | Anti-homonim gazetteer + typo Damarsi generik | ✅ push |
| `b2b45137` | Multi-lapis GTM/katalog/masker/guardrail/sanitizer | ✅ push |
| `5c6b670a` | Skrip `sync-catalog-rebrand.ts` | ✅ push |
| `1ae1a681` | wdoro→Wedoro 0ms, verbatim gate, skip-LLM, guard crossCheck | ⚠️ LOKAL SAJA |
| `d64bbfb8` | Anti-todong usia, D10 amnesia keluhan, empati anti-brosur | ⚠️ LOKAL SAJA |
| DB lokal | `clinic_services` rebrand 36 rows + GTM 2 rows, `pg_trgm` + index | ✅ lokal |
| DB live | Rebrand + GTM + `pg_trgm` + migrate `20260925000000` | ❌ BELUM (runbook tersedia) |

---

## §1. P0 — Ingest Durability (chat hilang/ganda = luka bakar)

**P0-1. Idempotency ledger atomik.** Ganti `Set` memori + `catch→false` ✅ (`message.service.ts:175-208`) dengan kunci unik `(tenant_id, provider, inbound_message_id)` di DB (unique constraint) atau Redis SETNX. Webhook ack-200 hanya setelah kunci persist; `logMessage()` cek kunci dulu.
*Acceptance:* redelivery WAHA/Meta ganda → 1 baris DB + 1 balasan (chaos-test 2 instance). *Regresi:* suite message + webhook hijau.

**P0-2. Parser WABA batch.** 🔍 (`waba-webhook.route.ts:82-122`): proses `statuses` DAN `messages` dalam satu body (jangan `return` dini). *Acceptance:* body campuran → status tercatat + pesan diproses; test injeksi body ganda.

**P0-3. Turn-ledger + FIFO per-phone durable.** 🔍 (`burst-coalesce.service.ts:57-203`, `queue.service.ts:36-433`): buffer burst + claim di Redis/DB (TTL), `turnId` di semua payload, retry tak menyalip, hapus fail-open `claim→true`.
*Acceptance:* restart di tengah burst → 1 balasan utuh; 3 pesan cepat → urutan benar.

**P0-4. Identitas LID vs phone.** ✅ sebagian (`jid.ts`, `dummy-filter.ts:28`): kontrak `(rawJid, jidType, phone|null)` end-to-end; antrean parkir + retry resolusi untuk LID-unresolved (bukan drop); `dummy-filter` berhenti menghukum nomor non-ID (allowlist negara via DB/tenant-config).
*Acceptance:* pesan LID-only terparkir + termetrik, bukan hilang; nomor +60/+65 tak ditandai dummy.

**P0-5. Abuse-detection simetris.** 🔍 Teruskan ke jalur WABA; state tenant-scoped terdistribusi (bukan `Map` proses).

---

## §2. P1 — Kebenaran Router (jawaban salah/mahal/lambat)

**P1-1. Single masking evaluation.** ✅ (`agent-runner.ts:160-168` vs `generation-stage.ts:516`): hitung `evaluateToolMasking` SEKALI pasca-latch, threading hasilnya ke prompt Call-1 + skema + Call-2. Hapus divergensi prompt-vs-skema.
*Acceptance:* tidak ada 2 pemanggilan dengan sesi berbeda per turn; adversarial lokasi+biaya + tanya-klinik.

**P1-2. Call-2 pruning masker-aware.** ✅ (`prompt-composer.ts:300,344-349`): `TOOL_GUIDANCE_BLOCK` di-prune per state (cermin `SAVE_RESERVATION_MASKED`); guidance volatil pindah ke tail (selamatkan cache). Varian DB juga.

**P1-3. Gate `specificTreatmentName`.** ✅ (`tool-registry.ts:65`, `tool-schemas.ts:25`, `get-catalog.tool.ts:388-398`): teruskan hanya bila substring muncul di pesan user turn ini (toleransi normalisasi); selain itu kosongkan → serahkan ke `symptoms` + clinical-dominance.
*Acceptance:* nama paket turn lama + keluhan baru → rekomendasi gejala menang.

**P1-4. Pagu deadline end-to-end + abort.** ✅ (timeout tersebar: `generation-stage.ts:12-39`, `tool-pipeline.ts:261,301`, `model-fallback.ts:139`): pagu turn ≤25 dtk diturunkan sebagai sisa-deadline; `Promise.race` tanpa abort diganti abort nyata; samakan pengecualian GLM; perbaiki akuntansi `usedFallback`.
*Acceptance:* simulasi outage → p99 turun, nol turn ganda; nol retry baru.

**P1-5. Verbatim-gate overlap diketatkan.** ✅ (`tool-pipeline.ts:194-229`): definisi overlap → entitas gazetteer/landmark (bukan 1 token generik ≥2 huruf).

---

## §3. P2 — Kebenaran Domain (tarif, terapi, data)

**P2-1. Satu sumber per domain.** ✅ sebagian + 🔍: tier → DB saja (`delivery.service.ts:308,342`); katalog → `clinic_services` DB (TS/file hanya seed migrasi versioned); perluas enum kategori (BUNDLE/ADD_ON); brand klinik dari DB (`delivery.service.ts:321-325` hardcode).
*Acceptance:* ubah tier/katalog via dashboard → semua jalur ikut ≤1 menit; drift detector `TS-vs-DB` 0 diff.

**P2-2. Scorer gejala tunggal, data-driven.** ✅ (`treatment-catalog.service.ts:1655-1762` vs `2160-2192`): hapus duplikat + double-count + regex `paket|terapi`; sinonim → `KnowledgeChunk.keywords`/`ClinicPolicy` per-tenant.
*Acceptance:* matriks keluhan×layanan deterministik; GTM/bapil tak pernah jatuh ke bundle cukur.

**P2-3. Kontrak presisi lokasi di tipe.** 🔍 (`geocoding.ts:1143-1157`, `:821-845`): varian ambigu/unknown DILARANG bawa `lat/lng` (tipe, bukan disiplin); satu mesin geocoding (hapus duplikasi `mockGeocodeText` vs `rankedGazetteerScan`); reverse di luar coverage → `isPrecise:false + outOfCoverage`.
*Acceptance:* kecamatan-only tak pernah jadi ongkir presisi.

**P2-4. Kunci idempotensi reservasi + follow-up.** 🔍 (`reservation-core.service.ts:240-424`, `follow-up.service.ts`, `schema.prisma`): kunci (tenant, customer, slot, treatment-hash) + `request_id` wajib; tabrakan staf = error/penawaran ulang; follow-up tanpa `reservation_id=null` (kunci parsial/tabel histori).
*Acceptance:* booking pagi+sore tak saling timpa; nol duplikat NO_PURCHASE; audit follow-up utuh.

**P2-5. Tulis lokasi bersejarah.** 🔍 (`customer.service.ts`, `reservation-lifecycle.service.ts`): satu seam tulis (nama+koordinat atomik) + `location_history` + audit; larang campur nama-teks dengan koordinat-GPS parsial.

---

## §4. P3 — Kepercayaan & Human Handling

**P3-1. Satu otoritas CTA + recovery intent-eksplisit.** 🔍 (`guardrail-pipeline.ts:294-319,725-774`): CTA dari `(funnelCommitted, preferredDate, locationKnown)` tunggal; recovery katalog wajib intent turn-ini (bukan `cart[last]`); canned hanya Turn-0, selebihnya handoff.
*Acceptance:* draf kosong non-klinis → netral/eskalasi, tak pernah pitch sepihak.

**P3-2. Eskalasi terminal + handover.** 🔍 (`conversation.service.ts:239-276`, `live-chat.service.ts:588-598`): sewa berjenjang ganti pengecualian abadi; event `staff_done`; watchdog + ack saat CS offline; release lewat service tunggal.
*Acceptance:* takeover selalu bisa kembali ke bot; sunyi CS-offline = 0.

**P3-3. SSE persisten.** 🔍 (`live-chat-hub.service.ts`, kedua SSE route): outbox sequence per-tenant + `id:` + `Last-Event-ID` replay; precompute ownership staff (tanpa query per-event).
*Acceptance:* reconnect tak pernah gap; burst tak drop.

**P3-4. PII setara di semua jalur.** ✅ sebagian (`livechat.subroute.ts:621`, `message.service.ts:66-74`): tenant dari sesi auth (hapus hardcode); mask JID/kontak/`maskAddress`/grid lat-lng di SSE admin, push, dan quote (`sendAdminReply:407-416`); selaraskan `slice(-30)` vs komentar 10-bubble.
*Acceptance:* DevTools admin/staff tak bocor JID/kontak/alamat presisi.

**P3-5. Media provider-aware.** 🔍 (`media.service.ts`): flag `thumbOnly` di DB; cek eksistensi untuk WAHA DAN WABA; shared storage; paginasi retensi.
*Acceptance:* forward pasca-retensi tak `SEND_FAILED`; pratinjau tak broken lintas-instance.

---

## §5. Diusulkan, Menunggu Konfirmasi (jangan eksekusi belum)

**P- practically ready: Consonant-skeleton matching.** Fondasional (algoritmik, 0 FP pada kata chat umum, 13/453 tabrakan ditangani via ambiguity). Syarat revisi: rumah di `typo-match.ts`; tabrakan → ambiguity (larang first-wins-precise); ekspektasi fuzzy-bukan-precise; `hasResolvableSpecificity` ikut skeleton; angka 573 bukan 3.748.

**P-needs-decision: Default `LLM_TIMEOUT_GEOCODE_MS` 120000→8000.** Sekunder setelah skip-LLM + tanpa-retry; nilai final butuh ukur latensi model reasoning.

---

## §6. Ditolak Permanen (alasan tercatat, jangan diajukan ulang tanpa bukti baru)

- Word-joiner `cek an→cekkan` / `ongkir nya→ongkirnya`: mutilasi semantik; typo model → ranah few-shot.
- Edit teks RULE4 pengecualian mutlak: risiko tier salah; delegasi ke `needsAgeClarification` + pruning.
- Cap 3500ms hardcode: ganti env-driven (pelanggaran pola #123).
- File test duplikat (`gtm-clinical-routing`, hafalan kalimat meta-bicara): extend file eksisting; pola generik.
- Kamus alias statis (`{wdoro:Wedoro}`) dalam bentuk apa pun.

---

## §7. Gerbang Eksekusi Global

1. Verifikasi `file:line` + log untuk semua item 🔍 sebelum micro-task.
2. TDD: test merah dulu; dilarang ubah test merah pre-existing (catat di KNOWN_ISSUES).
3. Gate per fase: suite tersentuh + `npm run build` (+ `vite build` bila sentuh dashboard).
4. Manual: skenario WhatsApp nyata per fase (bukan kalimat hafalan tunggal).
5. Push live hanya bila diminta eksplisit per fase; DB live via runbook + backup `SELECT` dulu.
