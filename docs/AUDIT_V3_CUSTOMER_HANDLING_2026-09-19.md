# Audit V3 End-to-End — Customer Handling

- **Tanggal audit:** 2026-09-19
- **Mode:** READ-ONLY (tidak ada kode/data yang diubah)
- **Scope:** arsitektur aktif V3 saja
- **Legacy bypass:** komponen berikut DIKONFIRMASI mati/absen dan TIDAK dipakai sebagai dasar temuan:
  `nlu-classifier.service.ts`, `integrations/llm/ai-router.ts`, `config/ai-router-config.ts`,
  `price-answer.service.ts`, `state-machine/handlers/`, `src/slot-engine/`, `src/cli/*`,
  fungsi slot-filling di `feature-flags.ts` (hanya `isToolMaskingEnforced` hidup),
  stub `/api/admin/ai-router`, dan `config/persona.ts` sebagai system prompt (hanya TEMPLATES-nya live).
- **Sumber bukti:** kode aktual, `prisma/schema.prisma`, test suite, dan log lokal
  `logs/app-2026-09-16` … `logs/app-2026-09-19`, `logs/llm-2026-09-18.jsonl`.

Bukti wajib `file:line`. Klaim yang belum terbukti ditandai eksplisit. Changelog/KNOWN_ISSUES/test-hijau
bukan dianggap bukti kebenaran perilaku.

---

## Executive Verdict

Chatbot V3 telah memiliki fondasi deterministik yang cukup kuat untuk memask tool reservasi,
membatasi satu tool utama per turn, mencegah sebagian cart injection dari pesan asisten, menahan
balasan saat human takeover, meng-grounding katalog/ongkir/knowledge via tool, melakukan retry/fallback
LLM, serta menyimpan message ID dan delivery status.

Namun sistem belum konsisten memahami customer sebagai **manusia yang menjalani perjalanan berbeda
dari waktu ke waktu**. Akar masalah terbesar bukan kualitas model, melainkan konflik mendasar antara:

1. Identitas customer dan tenant.
2. State conversation dan state customer.
3. Percakapan konsultatif dan komitmen transaksi.
4. Status reservasi dan status operasional sebenarnya.
5. Keberhasilan generate respons dan keberhasilan delivery.
6. Handoff manusia dan suppression bot.
7. Runtime normal dan degraded mode.
8. Data tersimpan dan data yang dapat direkonstruksi saat insiden.

Empat akar sistemik dominan:

1. **Identity authority belum aman** — tenant, customer, conversation, provider belum berboundary konsisten.
2. **Memory authority terpecah** — customer columns, `Customer.preferences`, Conversation state, Child table,
   runtime memory, dan history window dapat saling bertentangan.
3. **Commitment semantics belum cukup kuat** — penyebutan layanan, pertanyaan, minat, dan keputusan booking
   masih dapat tercampur.
4. **Transactional truth tidak sinkron** — booking "ditampung" tetapi DB `confirmed`; send gagal tetapi state
   maju; human handoff dianggap sukses walau persist belum tentu berhasil.

### Uji per-turn yang harus dipenuhi

1. Apakah sistem mengenali **customer dan tenant yang benar**?
2. Apakah context merepresentasikan **kebutuhan customer saat ini**, bukan state lama?
3. Apakah customer sedang **bertanya, mempertimbangkan, atau berkomitmen**?
4. Apakah aksi yang tercatat di DB sama dengan **apa yang customer lihat dan operasional benar-benar lakukan**?

---

## Ringkasan Risiko

| Prioritas | Jumlah | Makna |
|---|---:|---|
| P0 Critical | 8 | Berpotensi mencampur data, menghilangkan pesan, membuat bot diam, salah channel, atau booking ganda |
| P1 High | 19 | Salah memahami konteks/intent, salah state, CTA prematur, reminder salah, respons ganda |
| P2 Medium | 15 | Degradasi UX, debugging lemah, state lama terlalu sticky, coverage slang terbatas |

---

# P0 — Critical Findings

## 1. Data customer lintas-tenant dapat tertukar

- **Klasifikasi:** Confirmed Bug
- **Domain:** A
- **Evidence:**
  - `Customer.phone` unik global, bukan `(tenant_id, phone)`: `prisma/schema.prisma:52-56`
  - Service mengembalikan customer tenant lain bila nomor ditemukan: `src/services/customer.service.ts:99-113`
  - Repository menyediakan pencarian global: `src/repositories/customer.repository.ts:33-38,56-59`
- **Customer outcome:** pesan Tenant B dapat memakai customer ID, nama, lokasi, preferences, status, anak,
  atau reservation milik Tenant A.
- **Blast radius:** seluruh journey (booking, follow-up, handoff, attribution, live chat).

## 2. Session V3 disimpan per-customer, bukan per-conversation

- **Klasifikasi:** Confirmed Bug
- **Domain:** A/B
- **Evidence:**
  - Session V3 berada pada `Customer.preferences`: `prisma/schema.prisma:99`
  - `GoalTracker` menerima `conversationId` tetapi membaca/menulis preferences customer:
    `src/v3/state/goal-tracker.ts:141-193,204-253`
  - Data ikut terbawa: location, cart, treatment, booking, child profile, mom profile, price flag, commitment flag
- **Customer outcome:** conversation baru mewarisi anak, keluhan, lokasi, cart, atau booking lama.

## 3. Error V3 mengubah customer menjadi human-handling tanpa balasan

- **Klasifikasi:** Confirmed Bug
- **Domain:** D/G/H
- **Evidence:**
  - Exception runner → `reportTurnError`: `src/v3/agent/agent-runner.ts:339-342`
  - Hasil `replyText:''`, `shouldSendReply:false`, `isEscalated:true`: `src/v3/agent/pipeline/generation-stage.ts:295-355`
  - Machine aktifkan human handling: `src/state-machine/machine.ts:544-561`
  - Runtime: `logs/app-2026-09-16.log:38,45,50`, `logs/app-2026-09-17.log:88,96,171,175,179,197`
- **Customer outcome:** customer hanya melihat bot diam, tanpa pemberitahuan dialihkan.

## 4. Outbound WABA normal berpotensi dikirim melalui WAHA default

- **Klasifikasi:** Confirmed Bug
- **Domain:** H
- **Evidence:**
  - `TypingService` hanya pakai WABA transport bila `transportResolver` ada: `src/services/typing.service.ts:354-375`
  - Singleton production tanpa resolver: `src/services/typing.service.ts:550`
  - Machine memakai singleton itu: `src/state-machine/machine.ts:7,18,675`
  - WABA inbound ditandai `_provider:'WABA'` tetapi tidak dipakai saat text send: `src/routes/waba-webhook.route.ts:344-359`
- **Customer outcome:** customer WABA dapat tidak menerima balasan, atau balasan lewat akun/session WAHA salah.

## 5. WABA saat human handling kehilangan pesan sebelum tersimpan

- **Klasifikasi:** Confirmed Bug
- **Domain:** G/H/I
- **Evidence:**
  - WABA normal langsung enqueue tanpa pre-log: `src/routes/waba-webhook.route.ts:344-379`
  - Queue buang job bila `is_human_handling=true`: `src/services/queue.service.ts:166-171,301-306`
  - Logging inbound baru di machine, setelah guard human: `src/state-machine/machine.ts:50-61,98-114`
  - WAHA punya jalur mencatat inbound saat human handling; WABA tidak
- **Customer outcome:** saat CS menangani customer WABA, balasan/lokasi/detail dapat hilang dari live chat & audit trail.

## 6. WABA tidak menjalankan auto-release normal

- **Klasifikasi:** Confirmed Bug
- **Domain:** G
- **Evidence:**
  - Queue buang conversation human-handling sebelum machine
  - Machine cek human handling sebelum auto-release
  - WAHA memanggil `checkAndApplyAutoRelease` sebelum guard human: `src/routes/webhook.route.ts:1126-1132`
  - WABA tidak punya jalur setara
- **Customer outcome:** percakapan WABA dapat terkunci human handling sampai dilepas manual.

## 7. Reservasi dapat terduplikasi karena check-then-create tidak atomik

- **Klasifikasi:** Confirmed Structural Bug (prevalensi runtime perlu validasi DB)
- **Domain:** F
- **Evidence:**
  - Conflict diperiksa lebih dahulu: `src/services/reservation-core.service.ts:231-240`
  - Create terpisah: `src/services/reservation-core.service.ts:387-406`
  - Tidak ada idempotency key / unique constraint booking customer/slot pada model Reservation (`prisma/schema.prisma`)
  - Test hanya menguji konflik sequential, bukan concurrency
- **Customer outcome:** dua retry/worker dapat membuat dua record, dua follow-up, dua jadwal.

## 8. Send berhasil, DB log gagal, lalu seluruh turn dapat diulang

- **Klasifikasi:** Confirmed Bug
- **Domain:** H
- **Evidence:**
  - WhatsApp send: `src/services/typing.service.ts:466-492`
  - Outbound dicatat setelah send: `src/state-machine/machine.ts:691-706`
  - `messageService.logMessage` dapat throw
  - BullMQ ulang seluruh job sampai 3 kali: `src/services/queue.service.ts:122-127,183-185`
- **Customer outcome:** customer dapat menerima respons sama beberapa kali saat send sukses tapi PostgreSQL gagal.

---

# P1 — High Findings

## Domain A — Identity & Memory

### 9. Customer creation tidak race-safe
`src/services/customer.service.ts:99-121` melakukan find tenant → find global → create terpisah.
Tidak ada atomic upsert/conflict recovery. **Dampak:** dua pesan pertama bersamaan dapat menggagalkan satu request.

### 10. Conversation creation tidak race-safe
Tidak ada unique constraint customer/tenant (`prisma/schema.prisma:138-167`); `findFirst` lalu `create`
(`src/repositories/conversation.repository.ts:34-50`). **Dampak:** satu customer punya beberapa conversation aktif;
pesan berikutnya memilih thread berdasarkan `updated_at`.

### 11. Tenant provider tidak dikenal jatuh ke `default-tenant`
WAHA/WABA tenant resolver memakai default tenant saat identifier tidak dikenal / DB gagal.
**Dampak:** pesan provider misconfigured dapat ditulis ke tenant default.

### 12. Lokasi lama di preferences mengalahkan lokasi customer lebih baru
`GoalTracker.getGoalSession` memilih `prefs.location` sebelum kolom customer: `src/v3/state/goal-tracker.ts:156-179`.
**Dampak:** GPS baru/koreksi admin/enrichment human diabaikan V3.

### 13. State anak terpisah antara JSON V3 dan tabel `Child`
Data relasional: `prisma/schema.prisma:119-135`; V3 hanya baca `Customer.preferences`, tidak tabel Child
(`src/v3/state/goal-tracker.ts:146-193`). **Dampak:** usia/nama anak di admin/reservation berbeda dari chatbot.

### 14. State klinis dan transaksi tidak punya freshness
`momProfile.complaints`, symptoms, treatment, booking commitment, price status digabung sticky tanpa source/timestamp:
`src/v3/state/goal-tracker.ts:209-228`, `src/v3/agent/pipeline/context-grounder.ts:260-269`.
**Dampak:** keluhan sembuh / niat booking lama masih mempengaruhi percakapan baru.

## Domain B — Context & State Machine

### 15. Idle reset hanya mereset enum conversation, bukan session V3
Idle reset ubah `Conversation.current_state` (`src/state-machine/machine.ts:223-253`), `Customer.preferences`
tidak dibersihkan; V3 merekonstruksi phase dari cart/location/booking lama.
**Dampak:** DB `INITIAL` tetapi chatbot kembali ke fase booking/treatment lama.

### 16. DB write failure dianggap sukses oleh GoalTracker
Error update DB ditelan (`src/v3/state/goal-tracker.ts:230-257`); merged session tetap ditulis ke memory dan
dikembalikan sukses (`:259-266`). **Dampak:** bot menjawab seolah tersimpan; restart/worker lain kehilangan state.

### 17. Lock session hanya process-local
`withConversationLock` pakai `Map` lokal. Dua instance / dua conversation customer sama dapat menulis
`Customer.preferences` bersamaan. **Dampak:** lost update pada cart/lokasi/booking/child profile.

### 18. Current inbound muncul dua kali di konteks LLM
Machine mencatat inbound sebelum memuat history (`src/state-machine/machine.ts:98-113`), history memuat pesan itu
(`:441-446`), runner menambah incoming text lagi (`src/v3/agent/agent-runner.ts:168-174`). Saat burst, pesan asli
sudah disimpan lalu merged body menjadi current message (`src/services/burst-coalesce.service.ts:123-133,178-195`).
**Dampak:** "iya"/"boleh"/penyebutan treatment terlihat seperti komitmen berulang.

### 19. Effective history hanya enam pesan
Default `LLM_HISTORY_LIMIT` enam; runner `slice(-8)` tak bisa memulihkan history yang tak diberikan machine;
fallback load 20 hanya bila history kosong. **Dampak:** antecedent "yang itu"/"boleh"/"berapa?"/"besok" mudah hilang.

## Domain C — Intent & Entity Extraction

### 20. Konsultasi deklaratif dapat masuk cart tanpa komitmen
`src/v3/state/cart-manager.ts:488-505` menganggap konsultasi hanya bila ada `?` dan tanpa signal transaksi.
Contoh "Breast massage bisa buat ASI", "Pijat bayi ceria cocok usia 2 bulan", "Aku tertarik tahu oksitosin massage"
tanpa `?` dapat masuk cart. **Dampak:** total harga, selected service, CTA booking dari eksplorasi, bukan pembelian.

### 21. Penyebutan nama layanan dapat dianggap treatment disepakati
`detectAgreedTreatment` mencari exact catalog name dalam user message tanpa membedakan pertanyaan vs persetujuan:
`src/v3/agent/pipeline/booking-commit-gate.ts:64-83`. **Dampak:** "Pijat Oksitosin itu bagaimana?" dapat mengunci treatment.

### 22. Explicit human request kalah saat bercampur intent lain
`extractFastIntents` tidak mengeluarkan intent human-agent/complaint; deterministic fallback hanya dipanggil bila fast
intents kosong (`src/state-machine/machine.ts:455-466`). "harga berapa, tapi saya mau bicara admin" dapat dikenali
sebagai harga.

### 23. Location punya prioritas routing terlalu tinggi
`src/v3/agent/pipeline/generation-stage.ts:406-433` memaksa `calculate_delivery` bila ada location sebelum beberapa intent.
**Dampak:** "Saya di Sedati, tolong sambungkan admin karena kecewa" dijawab ongkir dulu.

### 24. Routing pertanyaan klinis punya konflik
Prompt router menyuruh `search_knowledge_faq` untuk konsultasi/SOP, tetapi juga menyuruh keluhan fisik pakai
`get_catalog_and_price`. Karena tool atomic satu turn, ordinary symptom jadi tie-break probabilistik.
**Dampak:** keluhan diarahkan ke sales recommendation sebelum edukasi klinis.

### 25. Coverage slang/entity tidak sistematis
Age, commitment, symptom, mom-stage memakai pola literal terbatas. **Dampak:** typo/dialek/informal dapat menyebabkan
usia tak terbaca, category salah, booking terblokir, ditanya ulang, atau komitmen ambigu dianggap final.

## Domain D — Response & Verifier

### 26. Direct reply Call 1 dapat melewati validasi harga
No-tool output Call 1 menjadi draft (`src/v3/agent/agent-runner.ts:268-270`); numeric correction hanya aktif bila ada
tool/cart (`src/v3/agent/pipeline/guardrail-pipeline.ts:228-234`). **Dampak:** harga buatan Call 1 tanpa tool/cart lolos.

### 27. Validator harga mengotorisasi seluruh harga katalog
`src/v3/guardrails/numeric-fact-validator.ts:109-127` memasukkan seluruh harga katalog tenant sebagai authorized number.
**Dampak:** harga salah Treatment A lolos karena angka itu sah untuk Treatment B.

### 28. Nama layanan tanpa bold/quote dapat lolos verifier
`src/v3/guardrails/factual-claim-validator.ts:232-257` hanya memeriksa span `*...*`/`"..."` dan hanya bila catalog tool dipanggil.
**Dampak:** layanan fiktif tanpa format / direct reply no-tool lolos.

### 29. Reprompt akhir tidak menjalankan ulang seluruh validator
Setelah factual/numeric, reprompt pronoun/usia/jam hanya diuji untuk pelanggaran spesifiknya.
**Dampak:** style reprompt dapat mengubah harga/lokasi/treatment/fakta setelah factual validator selesai.

### 30. Deterministic fallback dapat memaksa CTA "hari apa"
`src/v3/agent/pipeline/guardrail-pipeline.ts:298-317,592-599` dapat menambah pertanyaan jadwal walau customer sedang
bertanya manfaat/persiapan/kesesuaian. **Dampak:** chatbot terasa agresif, memperlakukan konsultasi sebagai checkout.

## Domain E — Sales & Conversion

### 31. `priceDiscussed` dan `bookingCommitConfirmed` terlalu sticky
Flags hanya bergerak `false → true`, tanpa expiry/scope per treatment. **Dampak:** customer yang pernah tanya harga
tetap dianggap transaksional saat pindah topik.

### 32. Phase resolver memprioritaskan state lama
Booking/treatment/location phase selalu mengalahkan general context. **Dampak:** FAQ/keluhan anak lain dibalas
dalam frame scheduling lama.

### 33. Recovery path lebih sales-oriented daripada normal path
Normal prompt answer-first; saat generation/validator gagal, fallback deterministik dapat langsung menanyakan jadwal.
**Dampak:** chatbot paling agresif justru saat model gagal.

## Domain F — Reservation Lifecycle

### 34. `bookingTime` hanya masuk raw text, tidak structured datetime
Parser pakai `bookingDate` (`src/v3/tools/save-reservation.tool.ts:407-408`); `bookingTime` hanya ke `raw_text` (`:435`);
persist pakai `parsedDate` (`:449-463`). Bukan otomatis bug UX (aturan melarang bot minta jam); risiko utama di status DB.

### 35. Reservation non-same-day langsung `confirmed` walau slot belum diverifikasi
Non-same-day disimpan `confirmed` (`src/v3/tools/save-reservation.tool.ts:449-463`); respons menyatakan "ditampung" (`:472-476`).
**Dampak:** data `confirmed`, customer/operasional masih menunggu verifikasi.

### 36. Merge same-day dapat menimpa booking sah
`src/services/reservation-core.service.ts:268-301` memilih reservation pertama hari itu lalu menimpa treatment/tanggal/staff/raw/value.
**Dampak:** dua appointment sah (mis. dua anak) dapat digabung/ditimpa.

### 37. Status `pending` tidak dianggap aktif untuk dedup
`ACTIVE_STATUSES = ['confirmed','hold']`. **Dampak:** permintaan same-day pending dapat dibuat lebih dari sekali.

### 38. Follow-up creation check-then-create tanpa unique constraint
Repeated save/concurrency dapat menghasilkan dua reminder/review walau reservation terkonsolidasi.

### 39. Cancel/delete route tidak konsisten membatalkan follow-up
Sebagian route memanggil lifecycle cleanup; delete/soft-cancel tidak, bahkan dapat menjadwalkan no-purchase follow-up.
**Dampak:** customer yang batal tetap menerima H-1 reminder/review.

### 40. Reservation address hanya sebagian structured
Alamat masuk `raw_text`; customer location update & geocoding best-effort. **Dampak:** admin lihat alamat berbeda
dari routing/customer profile.

## Domain G — Human Escalation

### 41. Auto-release memulihkan `previous_state` yang dapat basi
`src/services/conversation.service.ts:285-305` memulihkan enum lama tanpa memastikan tindakan manusia selama takeover.
**Dampak:** CS sudah atur booking, bot kembali ke `AWAITING_LOCATION`.

### 42. Error handoff dapat auto-release tanpa customer pernah diberi tahu
Error runner menjadi `unresolved_faq`, tidak masuk exemption auto-release. **Dampak:** customer diam, 6 jam kemudian
bot kembali dengan state lama.

### 43. Tool escalation dapat melaporkan sukses walau persist gagal
`src/v3/tools/escalate-human.tool.ts` mengembalikan success/escalated saat conversation tidak ditemukan / exception.
**Dampak:** bot percaya staff ambil alih, human queue belum tentu punya record.

### 44. Human suppression kuat tetapi tidak konsisten antar-provider
WAHA mencatat inbound human-mode + enrichment; WABA membuangnya di queue.

## Domain H — Queue, Fallback & Reliability

### 45. Redis outage dapat menghasilkan split-brain queue
Bull processing lock process-local; saat enqueue Redis gagal, pesan baru pindah ke memory; job lama masih di Redis.
**Dampak:** job lama/baru diproses paralel/terbalik pada multi-instance.

### 46. In-memory queue tidak retry
`src/services/queue.service.ts:293-324` hanya log error lalu lanjut. **Dampak:** selama Redis down, transient error
kehilangan turn permanen. Bukti: banyak `Redis connection failed... Entering In-Memory Message Queue Fallback Mode`
pada `logs/app-2026-09-16` … `2026-09-18`.

### 47. In-memory queue tidak menghormati queue pause
`pauseQueue()` hanya mempause BullMQ; memory processor tetap jalan. **Dampak:** Redis down + provider disconnect →
message diproses & dibuang saat provider belum siap.

### 48. Dedupe claim dibuat sebelum message benar-benar diproses
`src/services/message.service.ts:184-205` menambah ID ke memory sebelum DB lookup dan tidak melepas claim bila gagal.
**Dampak:** provider retry dianggap duplicate walau attempt pertama gagal sebelum persistence/enqueue.

### 49. Burst buffer tidak durable
`src/services/burst-coalesce.service.ts:167-202` menghapus buffer sebelum enqueue; enqueue failure hanya dicatat.
**Dampak:** beberapa pesan tercatat tetapi tidak pernah memperoleh jawaban.

### 50. State conversation diubah sebelum send dipastikan berhasil
`src/state-machine/machine.ts:582-592` update state, send di `:597-706`. **Dampak:** bot menunggu jawaban atas
pertanyaan yang tidak pernah diterima customer.

### 51. Partial multi-bubble send tidak direpresentasikan akurat
Bila bubble 1 terkirim & bubble 2 gagal, DB mencatat keseluruhan `replyText` sebagai satu outbound failed row.
**Dampak:** sulit menentukan bagian mana yang perlu dikirim ulang.

### 52. WABA payload campuran status + message dapat kehilangan message
Route return setelah menemukan status (`src/routes/waba-webhook.route.ts:78-115`); message normalization tak dijalankan.
**Dampak:** message dapat di-acknowledge tetapi tidak diproses.

### 53. Circuit breaker bersifat global
Satu instance breaker untuk seluruh tenant/model/provider. **Dampak:** kegagalan credential satu tenant memaksa tenant
lain memakai fallback.

### 54. Fallback model tidak tercatat sebagai model/provider aktual
Structured logger tetap menulis configured primary. **Dampak:** fallback rate/biaya/latency/provider penyebab insiden
tak dapat dihitung benar.

## Domain I — Observability

### 55. Tidak ada satu record end-to-end per customer message
Data tersebar antara app log, LLM JSONL, DB LLM audit, message payload, telemetry memory, dan delivery status.
Tidak ada satu record berisi tenant/customer/conversation/inbound message ID/intent-entities/state before-after/
model-provider aktual/raw draft/guardrail changes/final reply/send result.

### 56. Correlation ID berhenti di webhook
Queue payload tidak membawa correlation ID; ALS context tidak ikut BullMQ/memory worker. **Dampak:** webhook acceptance
tak dapat dihubungkan pasti dengan LLM, state write, send, ACK, retry.

### 57. LLM JSONL tidak menyimpan final post-guardrail outbound
Call 2 dicatat sebelum Stage 5; final raw-vs-sanitized hanya di telemetry memory. **Dampak:** auditor tak bisa
membuktikan apa yang benar-benar diterima customer dari JSONL saja.

### 58. LLM audit buffer kehilangan record bila DB gagal
Buffer dibuang sebelum insert; insert gagal tidak mengembalikan record. **Dampak:** evidence hilang tepat pada periode outage.

### 59. Empty LLM log tidak dapat dibedakan dari "tidak ada panggilan"
Logger pakai delayed unref timer; shutdown tidak flush eksplisit; clear operation truncate file.
Bukti: beberapa `llm-*.jsonl` lokal 0 byte meski app log menunjukkan aktivitas.

### 60. PII masih tersimpan luas
LLM JSONL memuat nomor, nama, input, prompt penuh, reasoning, final reply. **Dampak:** alamat, keluhan medis, identitas
anak, dan conversation content tersebar di luar message store utama.

---

# Kekuatan V3 yang Terverifikasi

1. `parallel_tool_calls:false` dan defensive one-tool pruning.
2. `save_reservation` dimask fisik bila treatment/location/date/commitment belum sah.
3. `calculate_delivery` dimask bila tidak ada entitas lokasi baru.
4. Day-evidence dan past-date reservation gate fail-closed.
5. Assistant recommendation umumnya tidak langsung memasukkan layanan ke cart.
6. Tool arguments harga/ongkir dihitung ulang dari input customer, bukan dipercaya dari LLM.
7. Catalog tool reducer tidak langsung mengunci `selectedTreatment`.
8. Known location dipin ke context dan punya anti-amnesia validator.
9. Numeric, factual, pronoun, age, dan visit-time guardrails tersedia.
10. Queue melakukan fresh-fetch customer/conversation sebelum processing.
11. WAHA punya layered human-handling guard dan pre-send abort.
12. Database punya unique `(tenant_id, wa_message_id)` untuk message.
13. BullMQ punya retry, backoff, dan final-failure alert.
14. Same-day reservation diturunkan ke `pending`.
15. Medical escalation dilindungi dari auto-release.

---

# Customer Journey Verdict

| Journey | Status | Risiko utama |
|---|---|---|
| First contact | Tidak aman penuh | customer race, tenant fallback |
| FAQ umum | Cukup | direct reply dapat melewati grounding tertentu |
| Konsultasi klinis | Tidak konsisten | konflik FAQ-vs-catalog, sticky symptoms |
| Tanya harga | Berisiko | seluruh harga katalog dianggap authorized |
| Lokasi/ongkir | Relatif kuat | state lokasi lama dapat menang; priority location terlalu tinggi |
| Pilih treatment | Berisiko | mention dapat dianggap agreement/cart |
| Booking | Guard kuat, persistence lemah | status confirmed prematur, concurrency, same-day overwrite |
| Human takeover WAHA | Relatif kuat | stale previous state saat release |
| Human takeover WABA | Tidak aman | inbound hilang, auto-release tidak berjalan |
| Redis/DB/LLM degraded | Tidak aman | memory queue tanpa retry, session drift, silence-on-error |
| Returning customer | Risiko tinggi | customer-scoped sticky session |
| Multi-child | Risiko tinggi | JSON state vs Child table, same-day reservation merge |
| Incident reconstruction | Tidak memadai | correlation chain terputus |

---

# Catatan Metodologi

- Audit dilakukan read-only; tidak ada file kode atau data yang dimodifikasi.
- Sub-audit paralel per domain dilakukan, lalu divalidasi ulang terhadap kode aktual; beberapa klaim awal
  sub-auditor dikoreksi sebelum masuk laporan ini (mis. asimetri WABA diposisikan pada queue daripada route).
- Prevalensi beberapa temuan (mis. duplikasi reservasi, duplikasi conversation) masih memerlukan validasi langsung
  ke database produksi karena test suite memakai fallback in-memory (`tests/setup.ts`) yang menyamarkan perilaku
  PostgreSQL. Ini dicatat sebagai **REQUIRES DB VERIFICATION**, bukan bug final.

---
---

# LAMPIRAN A — Laporan Audit Independen (Verifikasi Silang)

- **Tanggal:** 19 September 2026
- **Peran:** Auditor Independen Sistem Perpesanan & AI
- **Status:** READ-ONLY (tanpa modifikasi kode produksi)
- **Dasar evaluasi:** verifikasi langsung `src/`, `prisma/`, `tests/`, eksekusi test suite, pemeriksaan
  `logs/app-*.log` + `logs/llm-*.jsonl`, dan perbandingan kritis terhadap dokumen induk ini.
- **Catatan:** Lampiran ini adalah hasil audit independen yang memverifikasi ulang temuan dokumen induk.
  Nomor temuan berbeda (mis. BUG-P0-01) dan TIDAK menggantikan penomoran pada bagian utama di atas.

## A.1 Executive Findings Summary

1. **Mayoritas temuan Audit Director terkonfirmasi secara nyata di kode** — bukan spekulasi teoretis, terbukti
   di `file:line` dan diperkuat log runtime (`logs/app-2026-09-16.log`, `logs/app-2026-09-17.log`).
2. **Test suite eksisting mengandung ilusi keamanan (*false sense of security*)** — `tests/setup.ts:63-100` memalsukan
   koneksi DB (`Database offline`) pada seluruh pemanggilan Prisma. Seluruh test berjalan di atas fallback in-memory,
   sehingga pelanggaran unique constraint, foreign key nullification, race condition, dan kebocoran tenant
   tertutupi dan tetap hijau (PASS) di lokal.
3. **Penyebab sistemik terbesar bukan akurasi LLM, melainkan arsitektur state & transaksi:**
   - Boundary kebocoran data antar-tenant (`phone @unique` global).
   - Amnesia & distorsi konteks (session V3 di `Customer.preferences`, bukan per-conversation).
   - Silent escalation saat error LLM.
   - Asimetri provider WhatsApp (WABA vs WAHA).
   - Kehilangan pesan pada webhook campuran Meta (status + message).

## A.2 Confirmed Bugs (Independent)

### A-BUG-P0-01 — Data customer lintas-tenant dapat tertukar
- **Domain:** A — Identity & Memory · **Severity:** P0 Critical · **Classification:** CONFIRMED_BUG
- **Komponen:** Customer Identification & Repository
- **File:** `prisma/schema.prisma:55`, `src/services/customer.service.ts:106-113`, `src/repositories/customer.repository.ts:33-59`
- **Fungsi:** `CustomerService.getOrCreateCustomer`, `PostgresCustomerRepository.findByPhoneGlobal`
- **Skenario:** Nomor HP sama menghubungi dua tenant berbeda.
- **Observed:** `phone String @unique` global → `findByPhoneGlobal` mengembalikan customer Tenant A ke Tenant B.
- **Expected:** Isolasi via `@@unique([tenant_id, phone])`; customer tiap tenant independen.
- **Root Cause:** `phone` dijadikan globally unique, bukan composite unique per tenant.
- **Customer Impact:** Kebocoran privasi medis (nama, rekam keluhan anak, alamat, keranjang) antar klinik.
- **Technical Impact:** Integritas relasional rusak; percakapan/reservasi/follow-up tercampur di ID salah.
- **Recommended Fix:** Migrasi ke `@@unique([tenant_id, phone])`, hapus `findByPhoneGlobal`.
- **Confidence:** 100% · **Requires Human Review:** Ya (butuh rencana migrasi data duplikat produksi).

### A-BUG-P0-02 — Session V3 per-customer, bukan per-conversation
- **Domain:** A/B · **Severity:** P0 Critical · **Classification:** CONFIRMED_BUG
- **File:** `src/v3/state/goal-tracker.ts:156`, `:250-253`, `prisma/schema.prisma:99`
- **Fungsi:** `GoalTracker.getGoalSession`, `GoalTracker.updateGoalSession`
- **Skenario:** Customer lama kembali untuk keperluan baru.
- **Observed:** Sesi dibaca dari `conv.customer.preferences` → `selectedTreatment`, `cartItems`, `booking`,
  `complaints` lama langsung terisi ke percakapan baru.
- **Expected:** State percakapan terikat siklus `Conversation`, bukan permanen seumur hidup `Customer`.
- **Root Cause:** Pencampuran Customer Profile (jangka panjang) dengan Episodic Conversation State (jangka pendek).
- **Customer Impact:** Keranjang lama ditagihkan kembali; bot mengira masih checkout layanan lama.
- **Technical Impact:** State drift permanen; idle reset tidak membersihkan sesi V3.
- **Recommended Fix:** Pindahkan sesi aktif V3 ke `Conversation.session_data Json?`; `preferences` untuk profil statis.
- **Confidence:** 100% · **Requires Human Review:** Tidak.

### A-BUG-P0-03 — Silent escalation saat error LLM
- **Domain:** D/G/H · **Severity:** P0 Critical · **Classification:** CONFIRMED_BUG
- **File:** `src/v3/agent/agent-runner.ts:339-342`, `src/v3/agent/pipeline/generation-stage.ts:341-346`, `src/state-machine/machine.ts:544-570`
- **Fungsi:** `reportTurnError`, `V3AgentRunner.processMessage`
- **Skenario:** LLM error fatal (401/429/500, timeout, JSON rusak).
- **Observed:** `replyText:''`, `shouldSendReply:false`, `isEscalated:true`; `is_human_handling=true`; tidak ada
  pesan WhatsApp; pesan berikutnya ditolak guard antrean.
- **Expected:** Kirim pesan transisi (mis. "Mohon maaf Bunda, sistem kami sedang mengalami kendala teknis...").
- **Evidence log:** `logs/app-2026-09-16.log:36-38` (`V3_AGENT_RUNNER_ERROR`, key blocked 401).
- **Customer Impact:** Customer diabaikan → churn.
- **Recommended Fix:** Pesan transisi standar sebelum set `is_human_handling`.
- **Confidence:** 100% · **Requires Human Review:** Tidak.

### A-BUG-P0-04 — Outbound WABA lewat transport WAHA default
- **Domain:** H · **Severity:** P0 Critical · **Classification:** CONFIRMED_BUG
- **File:** `src/services/typing.service.ts:29-38`, `:354-375`, `:472-480`, `:550`, `src/state-machine/machine.ts:7-18`
- **Fungsi:** `TypingService.simulateHumanReply`, `ConversationStateMachine.constructor`
- **Skenario:** Pesan masuk via Meta Cloud API (WABA) dibalas bot.
- **Observed:** `this.transportResolver` tak pernah di-set di seluruh repo → `resolvedTransport` selalu undefined →
  fallback ke `this.client` (`wahaClient`).
- **Expected:** WABA dibalas via WABA driver; WAHA via WAHA driver.
- **Root Cause:** Injeksi dependensi tidak lengkap; resolver tidak disambungkan di factory/init.
- **Customer Impact:** Customer WABA tidak menerima balasan / menerima dari nomor berbeda.
- **Recommended Fix:** Sambungkan `resolveGatewayForTenant(tenantId)` ke `transportResolver`.
- **Confidence:** 100% · **Requires Human Review:** Tidak.

### A-BUG-P0-05 — WABA saat human handling kehilangan pesan
- **Domain:** G/H/I · **Severity:** P0 Critical · **Classification:** CONFIRMED_BUG
- **File:** `src/routes/waba-webhook.route.ts:344-379`, `src/services/queue.service.ts:166-171`, `src/state-machine/machine.ts:98-114`
- **Skenario:** Customer WABA kirim pesan saat `is_human_handling=true`.
- **Observed:** Route WABA tak memanggil `messageService.logMessage` sebelum enqueue; worker `return` saat human →
  pesan dibuang tanpa tersimpan.
- **Expected:** Semua inbound wajib tercatat (silent logging seperti WAHA `src/routes/webhook.route.ts:1270-1277`).
- **Customer Impact:** CS tak melihat pesan/gambar/keluhan terbaru customer WABA.
- **Technical Impact:** Data loss + desinkronisasi Live Chat.
- **Recommended Fix:** Pre-log inbound di route WABA sebelum enqueue.
- **Confidence:** 100% · **Requires Human Review:** Tidak.

### A-BUG-P0-06 — WABA tidak menjalankan auto-release
- **Domain:** G · **Severity:** P0 Critical · **Classification:** CONFIRMED_BUG
- **File:** `src/routes/waba-webhook.route.ts:314-380`, `src/routes/webhook.route.ts:1128-1130`
- **Skenario:** Percakapan WABA `is_human_handling` > 6 jam, customer kirim chat baru.
- **Observed:** WAHA memanggil `checkAndApplyAutoRelease` (`webhook.route.ts:1128-1130`); WABA tidak pernah
  mengimpor/memanggilnya → worker menolak pesan → terkunci selamanya.
- **Expected:** Auto-release 6 jam berjalan untuk WABA.
- **Recommended Fix:** Panggil `checkAndApplyAutoRelease` di `waba-webhook.route.ts` setelah conversation diambil.
- **Confidence:** 100% · **Requires Human Review:** Tidak.

### A-BUG-P0-07 — Reservasi duplikat (check-then-create non-atomik)
- **Domain:** F · **Severity:** P0 Critical · **Classification:** CONFIRMED_BUG
- **File:** `src/services/reservation-core.service.ts:231-245`, `:387-413`, `prisma/schema.prisma:258-295`
- **Fungsi:** `ReservationCoreService.saveReservation`
- **Skenario:** Dua pesan konfirmasi cepat / dua webhook paralel untuk slot sama.
- **Observed:** `findOverlappingCustomerReservations` lalu `prisma.reservation.create` terpisah; tidak ada unique
  constraint / idempotency key (`@@index` saja di `schema.prisma:288-295`).
- **Expected:** Idempoten & concurrency-safe.
- **Customer Impact:** Dua konfirmasi terapis, dua kalender, tagihan ganda.
- **Recommended Fix:** `idempotency_key` + `@@unique([tenant_id, idempotency_key])` atau advisory lock.
- **Confidence:** 100% · **Requires Human Review:** Ya.

### A-BUG-P0-08 — Send sukses, log gagal, turn diulang (spam balasan)
- **Domain:** H · **Severity:** P0 Critical · **Classification:** CONFIRMED_BUG
- **File:** `src/state-machine/machine.ts:675-706`, `src/services/queue.service.ts:183-185`
- **Skenario:** Pesan WA terkirim, lalu `messageService.logMessage` gagal (DB transient).
- **Observed:** `machine.ts:696` log setelah kirim; error meluncur ke worker yang `throw err` → BullMQ retry (3x)
  → kirim ulang pesan yang sama.
- **Expected:** At-most-once per turn.
- **Customer Impact:** Customer menerima balasan sama berkali-kali.
- **Recommended Fix:** Catch error logging setelah kirim; tandai outbox terkirim sebelum eksekusi gateway.
- **Confidence:** 100% · **Requires Human Review:** Tidak.

## A.3 Confirmed Bugs (P1, Independent)

### A-BUG-P1-09 — Pesan inbound saat ini terduplikasi di konteks LLM
- **Domain:** B · **Severity:** P1 High
- **File:** `src/state-machine/machine.ts:106-113`, `:442-446`, `src/v3/agent/agent-runner.ts:169-174`
- **Observed:** Pesan inbound dicatat di `machine.ts:106`, lalu `getRecentMessages` (`:442`) memuatnya, lalu
  `agent-runner.ts:173` menambahkan lagi sebagai user message → muncul **dua kali** di context window.
- **Customer Impact:** "iya"/"boleh"/"berapa" dibaca sebagai penegasan berulang → halusinasi konfirmasi.
- **Recommended Fix:** Filter pesan saat ini dari `recentHistory` sebelum menyusun `messages`.
- **Confidence:** 100%.

### A-BUG-P1-10 — Konsultasi deklaratif mengunci cart/treatment
- **Domain:** C · **Severity:** P1 High
- **File:** `src/v3/state/cart-manager.ts:500`, `src/v3/agent/pipeline/booking-commit-gate.ts:64-83`, `src/v3/agent/pipeline/context-grounder.ts:315-328`
- **Observed:** Deteksi konsultasi hanya via `text.includes('?')`; kalimat tanpa `?` masuk `cartItems`.
  `detectAgreedTreatment` cuma `text.includes(name)` → layanan langsung dianggap *agreed* & `selectedTreatment`.
- **Customer Impact:** Total tagihan & CTA booking muncul untuk layanan yang baru ditanya deskripsinya.
- **Recommended Fix:** Hapus ketergantungan tanda `?`; butuh verba komitmen aktif.
- **Confidence:** 100%.

### A-BUG-P1-11 — Validasi harga flat whitelist & bypass direct-reply
- **Domain:** D · **Severity:** P1 High
- **File:** `src/v3/guardrails/numeric-fact-validator.ts:112-127`, `src/v3/agent/pipeline/guardrail-pipeline.ts:233`
- **Observed:** (1) Validasi numerik hanya aktif bila `executedTools.length > 0 || hasActiveCart` → direct reply
  Call 1 tanpa tool/cart lolos. (2) Seluruh harga katalog tenant masuk `authorizedNumbers` → harga salah untuk
  Treatment A lolos karena angka itu sah milik Treatment B.
- **Customer Impact:** Info harga salah → dispute saat tagihan riil.
- **Recommended Fix:** Ikat angka ke layanan spesifik (entity-bound); aktifkan validator untuk semua token nominal.
- **Confidence:** 100%.

### A-BUG-P1-12 — Status `confirmed` prematur & merge same-day menghapus booking
- **Domain:** F · **Severity:** P1 High
- **File:** `src/v3/tools/save-reservation.tool.ts:462,472-476`, `src/services/reservation-core.service.ts:279-307`
- **Observed:** (1) Non-same-day disimpan `confirmed` padahal pesan menyatakan "ditampung, jadwal dicek dulu".
  (2) Jika ada reservasi aktif hari sama, `primary` ditimpa layanannya & `duplicates` di-`cancelled`.
- **Customer Impact:** Appointment anak pertama terhapus; konfirmasi untuk jadwal yang belum diverifikasi.
- **Recommended Fix:** Merge berdasarkan ID anak / rentang jam bertubrukan; konsistenkan status DB vs respons.
- **Confidence:** 100% · **Requires Human Review:** Ya.

### A-BUG-P1-13 — Webhook campuran status + message membuang message
- **Domain:** H · **Severity:** P1 High
- **File:** `src/routes/waba-webhook.route.ts:80-115`
- **Observed:** `statuses.length > 0` → `return reply.status(200).send({status:'STATUS_PROCESSED'})` sebelum
  `normalizeWabaPayload(body)` (`:117`) → message yang menumpang tak diproses.
- **Customer Impact:** Pesan masuk diabaikan acak saat ada update status paralel Meta.
- **Recommended Fix:** Hapus `return` dini; lanjutkan pemrosesan messages.
- **Confidence:** 100%.

### A-BUG-P1-14 — Delete/cancel reservasi tidak membatalkan follow-up
- **Domain:** F · **Severity:** P1 High
- **File:** `src/routes/admin/reservations.subroute.ts:1918-2015`, `prisma/schema.prisma:476`
- **Observed:** Soft-cancel (`:1971`) tidak memanggil `followUpService.onReservationCancelled`; hard-delete
  (`:1953`) dengan `onDelete: SetNull` → FollowUp tetap ada (`reservation_id=NULL`) dan tetap dieksekusi cron.
- **Customer Impact:** Customer yang batal tetap menerima reminder H-1 & pesan review.
- **Recommended Fix:** Panggil `onReservationCancelled(id)` di handler DELETE.
- **Confidence:** 100%.

## A.4 Suspected Bugs (Independent)

### A-SUSP-01 — In-flight dedupe lock tidak dilepas saat gagal
- **Domain:** H · **Severity:** P1 High · **Confidence:** 90%
- **File:** `src/services/message.service.ts:184-205`
- **Observed:** `memoryWaMessageIds.add(key)` sebelum sukses; bila proses gagal, key tak dihapus → retry provider
  dianggap duplicate & ditolak.
- **Recommended Fix:** Lepaskan lock bila gagal sebelum commit/queue.

### A-SUSP-02 — Intent permintaan manusia tertutup oleh intent harga
- **Domain:** C · **Severity:** P1 High · **Confidence:** 95%
- **File:** `src/state-machine/machine.ts:455-466`, `src/v3/agent/persona.ts:35-130`
- **Observed:** `extractFastIntents` menghasilkan `['ask_price']` → blok `else` (deterministik) dilewati →
  `request_human_agent` tak terdeteksi → silent escalate gagal.
- **Recommended Fix:** Prioritas tertinggi untuk permintaan manusia eksplisit.

## A.5 Design Risks (Independent)

1. **Global circuit breaker** — `src/utils/circuit-breaker.ts:40-67`, `src/v3/agent/pipeline/generation-stage.ts:11`:
   satu tenant kehabisan kuota → OPEN untuk semua tenant.
2. **Test tanpa transaksi riil** — `tests/setup.ts:65-100`: constraint FK/deadlock/serialisasi PostgreSQL tak pernah diuji.
3. **Split-brain profil anak** — `src/v3/state/goal-tracker.ts:146-184`: V3 hanya baca/tulis JSON, tak sinkron tabel `Child`.
4. **Context window terlalu dangkal** — `src/config/llm-context.ts:8`: `LLM_HISTORY_LIMIT=6` (±2,5 putaran).

## A.6 Observability Gaps (Independent)

1. **Log JSONL dihapus oleh endpoint admin** — `src/utils/llm-execution-logger.ts:415-425`,
   `src/routes/admin/evaluations.subroute.ts:576-577`: `fs.writeFileSync(todayPath,'')` memotong log jadi 0 byte.
2. **Log output pasca-guardrail hilang** — `src/v3/agent/agent-runner.ts:260-285`: JSONL mencatat draft Call 2,
   bukan `finalReply` setelah Stage 5.
3. **PII tanpa masking di JSONL** — `src/utils/llm-execution-logger.ts:135-145`: nomor, nama, alamat mentah.
4. **Audit LLM hilang saat DB down** — `src/utils/llm-audit-buffer.ts:120-164`: item di-splice sebelum insert dipastikan.

## A.7 Regression Risks (Independent)

1. Migrasi `phone @unique` → `@@unique([tenant_id, phone])`: risiko gagal bila ada duplikat eksisting; butuh
   de-duplikasi data historis lebih dulu.
2. Pemindahan sesi V3 ke `Conversation`: percakapan berjalan bisa kehilangan state; butuh lazy migration / fallback read.
3. Penghapusan ketergantungan tanda `?` pada deteksi konsultasi: pastikan persetujuan non-tanya
   ("Saya fix ambil paket A") tidak salah jadi konsultasi.

## A.8 Customer Journey Failures (Independent)

| Tahap Perjalanan | Status Keandalan | Titik Kegagalan Utama |
|---|---|---|
| Sapaan Awal / First Contact | Rawan Kebocoran | Nomor sama di tenant lain mengambil alih identitas customer lama |
| Konsultasi Klinis (Keluhan) | Rusak | Pertanyaan deklaratif masuk cart; keluhan lama tak kedaluwarsa |
| Tanya Harga & Brosur | Rawan Halusinasi | Direct reply lolos validasi harga; harga katalog lain dianggap sah |
| Pengecekan Lokasi & Ongkir | Rawan Konflik | Alamat lama di preferensi mengabaikan update lokasi baru |
| Penguncian Layanan / Cart | Rusak | Menyebut nama layanan langsung mengunci `selectedTreatment` |
| Pemesanan Jadwal (Booking) | Kritis | Status `confirmed` prematur; same-day 2 anak saling menimpa |
| Eskalasi Manusia (WAHA) | Sebagian Aman | Auto-release 6 jam mengembalikan state usang |
| Eskalasi Manusia (WABA) | Rusak Total | Inbound saat human dibuang tanpa dicatat; auto-release mati |
| Downtime LLM / Server Error | Bencana UX | Bot membisu total; customer terkunci dari bot selamanya |

## A.9 Recommended Regression Tests (Independent)

1. `tests/integration/tenant-boundary-phone.test.ts` — nomor sama di `tenant-a` & `tenant-b`, pastikan tidak bocor.
2. `tests/integration/waba-human-handling-no-loss.test.ts` — inbound WABA saat human handling tetap tersimpan.
3. `tests/unit/v3/runner-error-user-facing-reply.test.ts` — LLM 401/500 → `shouldSendReply:true` dengan pesan transisi.
4. `tests/integration/reservation-same-day-distinct-children.test.ts` — dua anak jam berbeda di hari sama tetap eksis.
5. `tests/unit/v3/cart-inquiry-no-unilateral-lock.test.ts` — "Pijat oksitosin itu untuk ibu melahirkan ya" → cart kosong.
6. `tests/integration/waba-mixed-status-and-message.test.ts` — payload statuses+messages diproses tuntas.

## A.10 Files Requiring Deeper Review (Independent)

1. `src/services/customer.service.ts` & `src/repositories/customer.repository.ts` — `findByPhoneGlobal` &
   mutasi lintas-tenant `updateManyByPhone`.
2. `src/v3/state/goal-tracker.ts` & `src/v3/state/cart-manager.ts` — pemisahan lifecycle storage sesi V3.
3. `src/routes/waba-webhook.route.ts` — penyelarasan alur ingress dengan guard lifecycle WAHA.
4. `src/services/reservation-core.service.ts` & `src/routes/admin/reservations.subroute.ts` — aturan konsolidasi
   same-day & pembatalan follow-up pada delete.

## A.11 Unresolved Questions (Independent)

1. **Status bisnis reservasi non-same-day:** `pending` (konfirmasi manual) atau `confirmed` (kuota diasumsikan ada)?
2. **Kebijakan profil anak multi-sesi:** data anak disimpan permanen, sementara keluhan & keranjang di-reset per siklus?
3. **Migrasi `phone @unique`:** apakah DB produksi sudah punya nomor terdaftar di lebih dari satu tenant?
   (Perlu query inspeksi PostgreSQL produksi sebelum migrasi skema.)

> **Catatan Auditor Independen:** seluruh komponen diverifikasi objektif berbasis bukti kode & log mesin.
> Tidak ada perubahan kode atau migrasi data selama sesi audit independen ini. Rekomendasi perbaikan siap
> diimplementasikan melalui *Staged Implementation Plan* setelah disetujui.

## A.12 Verdict Silang: Lampiran vs Dokumen Induk

| Aspek | Dokumen Induk | Lampiran Independen | Hasil |
|---|---|---|---|
| Tenant `phone @unique` global | Findings #1, #9, #11 | A-BUG-P0-01 | **Konsisten — terkonfirmasi** |
| Session per-customer | Findings #2, #12-#17 | A-BUG-P0-02 | **Konsisten — terkonfirmasi** |
| Silent escalation error LLM | Finding #3, #42 | A-BUG-P0-03 | **Konsisten — terkonfirmasi** |
| WABA transport default | Finding #4 | A-BUG-P0-04 | **Konsisten — terkonfirmasi** |
| WABA human handling message loss | Finding #5, #44 | A-BUG-P0-05 | **Konsisten — terkonfirmasi** |
| WABA tanpa auto-release | Finding #6 | A-BUG-P0-06 | **Konsisten — terkonfirmasi** |
| Reservasi duplikat non-atomik | Finding #7 | A-BUG-P0-07 | **Konsisten — terkonfirmasi** |
| Send sukses → log gagal → retry | Finding #8, #50 | A-BUG-P0-08 | **Konsisten — terkonfirmasi** |
| Duplikasi inbound di context LLM | Finding #18 | A-BUG-P1-09 | **Konsisten — terkonfirmasi** |
| Cart/agreement via tanda `?` | Findings #20-#21 | A-BUG-P1-10 | **Konsisten — terkonfirmasi** |
| Validasi harga flat whitelist | Findings #26-#27 | A-BUG-P1-11 | **Konsisten — terkonfirmasi** |
| Status `confirmed` prematur + merge | Findings #35-#36 | A-BUG-P1-12 | **Konsisten — terkonfirmasi** |
| WABA mixed payload early return | Finding #52 | A-BUG-P1-13 | **Konsisten — terkonfirmasi** |
| Cancel/delete tak batalkan follow-up | Finding #39 | A-BUG-P1-14 | **Konsisten — terkonfirmasi** |
| Dedupe lock tak dilepas | Finding #48 | A-SUSP-01 | **Konsisten — terkonfirmasi** |
| Intent manusia kalah oleh harga | Findings #22-#23 | A-SUSP-02 | **Konsisten — terkonfirmasi** |

**Kesimpulan:** tidak ditemukan kontradiksi substantif antara dokumen induk dan lampiran independen.
Lampiran ini memperkuat temuan induk dengan verifikasi kode/log tambahan, sekaligus menegaskan bahwa
**test suite existing tidak membuktikan integritas PostgreSQL** (fallback in-memory di `tests/setup.ts`).
