# AUDIT MODUL 1 DARI 16 — LAPISAN AKSES DATA

**Modul:** `src/db/client.ts` + `src/repositories/*` (customer, conversation, message, turn)
**Commit:** `c8ce5b21` (`master`), working tree bersih
**Tanggal audit:** 2026-11-07
**Sifat:** read-only. Tidak ada file source yang diubah.
**Metode:** baca seluruh file modul, baca seluruh test yang menyebut repository, lacak pemanggil via `rg`, verifikasi tipe Prisma yang di-generate, dan cek indeks/unique constraint di `prisma/schema.prisma`.

---

## CAKUPAN YANG SUDAH DIBACA

| File | Baris | Status |
|---|---:|---|
| `src/db/client.ts` | 12 | Dibaca penuh |
| `src/repositories/customer.repository.ts` | 171 | Dibaca penuh |
| `src/repositories/conversation.repository.ts` | 201 | Dibaca penuh |
| `src/repositories/message.repository.ts` | 137 | Dibaca penuh |
| `src/repositories/turn.repository.ts` | 153 | Dibaca penuh |
| `tests/unit/customer-repository.test.ts` | 101 | Dibaca penuh |
| `tests/unit/conversation-repository.test.ts` | 82 | Dibaca penuh |
| `tests/unit/message-repository.test.ts` | 70 | Dibaca penuh |
| `tests/unit/turn-repository-claim.test.ts` | 32 | Dibaca penuh |
| **Total modul** | **959** | **100%** |

**Dependensi yang dibaca sebagian (bukan modul ini):**
`src/services/customer.service.ts` (bagian `markInternalStaffCustomer`, `getOrCreateCustomer`, `updateCustomer`, `mergeCustomerPreferences`, `persistSavedAddresses`), `src/services/conversation.service.ts` (bagian `getOrCreateConversation`, `getConversationById`, `updateConversationScoped`, `updateConversationState`, `updateLastCustomerMessageAt`), `src/services/message.service.ts` (bagian `isDuplicateMessage`, `logMessage`), `src/services/queue.service.ts` (bagian claim turn), `src/services/turn-recovery.service.ts`, `src/services/command.service.ts` (bagian `/reset`), `src/routes/webhook.route.ts` (bagian persist turn), `src/routes/waba-webhook.route.ts` (bagian persist turn), `src/services/burst-coalesce.service.ts` (bagian persist turn), `tests/unit/turn-recovery.test.ts` dan `tests/unit/queue.test.ts` (hanya baris yang relevan via grep).

**Batasan verifikasi runtime:**
- Database lokal `localhost:5432` tidak tersedia. `EXPLAIN` dan uji race nyata tidak bisa dijalankan.
- Full test suite tidak diklaim hijau. Yang pernah dijalankan: `npm run typecheck` lulus dan `tests/unit/typing.test.ts` lulus 12/12.
- Dampak performa yang memerlukan `EXPLAIN` ditandai **HIPOTESIS** atau **TERVERIFIKASI (bentuk query)**.

---

## A. RINGKASAN MODUL + SKOR KESEHATAN

Modul ini adalah seam persistensi untuk empat entitas inti percakapan: customer, conversation, message, dan inbound turn. Pola yang dipilih sudah benar secara arah: interface kontrak, adapter Postgres untuk produksi, adapter in-memory eksplisit untuk test, dan `create` yang fail-closed (melempar saat DB error, tidak lagi mengembalikan objek fiktif). Namun seam ini **belum menjadi satu-satunya jalur tulis**: `customer.service.ts` masih punya belasan `prisma.customer.update` langsung, `message.service.ts` menulis `conversation.last_message_at` langsung tanpa tenant di `WHERE`, dan `conversation.service.ts` masih menulis conversation langsung di beberapa tempat. Conversation juga tidak punya penanda "aktif" maupun unique constraint, sehingga `getOrCreate` rentan membuat dua percakapan paralel dan memilih percakapan berdasarkan `updated_at` (bisa kembali ke percakapan lama yang tersentuh admin). `TurnRepository` berdiri di luar pola seam: singleton konkret, tanpa interface, dan seluruh query memakai `(prisma as any)` padahal tipe generated tersedia. Kontrak antarmuka masih `Promise<any>` di hampir semua metode, sehingga kesalahan field tidak tertangkap compiler.

**Skor kesehatan: 3 / 5 (cukup, belum bisa dijadikan sumber kebenaran tunggal).**

Alasan skor:
- **+** Arah desain benar: interface + adapter produksi + test double eksplisit; `create` fail-closed; ada 4 file test khusus repository.
- **+** Pemisahan adapter Postgres/InMemory membuat unit test tidak butuh DB.
- **−** Seam tidak ditegakkan: penulis kanonis customer justru `prisma.customer.update` langsung (`customer.service.ts:1246-1254`), dengan komentar yang melarang penambahan tulis repo.
- **−** Tidak ada unique/active marker pada conversation; race `getOrCreate` nyata dan tidak ditangani P2002.
- **−** `CustomerRepository.update` tidak menerima `tenantId`; `persistSavedAddresses` bahkan memakai jalur unscoped sebagai fallback setelah tenant-scoped update gagal.
- **−** `TurnRepository` tanpa interface/DI dan `as any`; klaim `claimForProcessing` fail-open sehingga tidak sepenuhnya mencegah dua worker.
- **−** Semua repository mengembalikan `any`; `direction: any`; patch bebas `Record<string, unknown>`.

---

## B. TABEL TEMUAN

**Skala severity:** Kritis / Tinggi / Sedang / Rendah.
**Status:** TERVERIFIKASI = dibaca langsung di kode dan barisnya cocok; HIPOTESIS = perlu EXPLAIN/uji runtime.

| ID | Severity | file:baris | Masalah | Dampak | Prinsip/standar yang dilanggar | Rekomendasi spesifik + cost-benefit | Effort | Keyakinan | Status |
|---|---|---|---|---|---|---|---|---|---|
| **D-01** | **Tinggi** | `prisma/schema.prisma:218-223`; `conversation.repository.ts:40-58`; `command.service.ts:162-181` | Conversation tidak punya penanda "aktif" (`closed_at`/`archived_at`) dan tidak punya unique `(tenant_id, customer_id)`. `getOrCreate` melakukan `findFirst` lalu `create` tanpa menangkap P2002. `/reset` sengaja membuat conversation baru dan meninggalkan yang lama. | Dua webhook paralel untuk customer baru dapat membuat dua conversation. Riwayat terbelah; live chat bisa menampilkan dua thread; follow-up/CAPI bisa berjalan ganda. Karena pemilihan memakai `orderBy updated_at desc`, conversation lama yang tersentuh admin bisa kembali menjadi "aktif". | Integritas data, idempotensi, single source of truth, race condition | Tambah `closed_at` + partial unique index `(tenant_id, customer_id) WHERE closed_at IS NULL`; `/reset` menutup conversation lama secara eksplisit sebelum membuat baru; `getOrCreate` menangkap P2002 lalu re-read. **Cost:** 1 migrasi + 2 penulis + test race. **Benefit:** menghilangkan kelas bug split history yang sulit dideteksi. | M | H | TERVERIFIKASI |
| **D-02** | **Tinggi** | `customer.service.ts:1246-1254`, `1392-1402`; `message.service.ts:448-460`; `conversation.service.ts:143-148`, `825-828` | Seam bukan penulis kanonis. `updateCustomer` memakai `prisma.customer.update({ where: { id } })` tanpa `tenant_id`; `logMessage` memperbarui `conversation.last_message_at` dengan `where: { id }` tanpa tenant; beberapa metode conversation masih menulis langsung. Komentar di `customer.service.ts:1252-1254` bahkan menyatakan larangan menambah tulis repo. | Jaminan fail-closed dan tenant guard hanya berlaku di sebagian jalur. `updateCustomer` yang tidak membutuhkan `priorCustomer` (mis. hanya ubah nama) tidak membaca tenant sama sekali. Jika `conversationId`/`customerId` berasal dari input yang salah, write lintas tenant bisa terjadi. `Promise.all` di `logMessage` juga tidak atomik: message gagal, timestamp conversation tetap bisa berubah. | Enkapsulasi, satu seam kebenaran, defense in depth, tenant isolation, atomicity | Jadikan repository satu-satunya penulis untuk ketiga tabel. Pindahkan `last_message_at` ke `MessageRepository.create` dalam transaksi atau method `ConversationRepository.touchLastMessage(conversationId, tenantId, at)`. Tambah `tenant_id` di setiap `WHERE`. Tambah gerbang grep/test yang gagal bila ada `prisma.(customer\|conversation\|message).(create\|update\|updateMany\|upsert\|delete)` di luar `src/repositories`. **Cost:** refactor 20+ call site. **Benefit:** menghilangkan seluruh kelas bug tenant dan inkonsistensi fallback. | L | H | TERVERIFIKASI |
| **D-03** | **Tinggi** | `customer.repository.ts:37`, `75-77`; `customer.service.ts:1877-1909` | `CustomerRepository.update(id, patch)` tidak menerima `tenantId` dan menerima `Record<string, unknown>` yang di-`as any`. `persistSavedAddresses` memakai raw SQL tenant-scoped; bila 0 row/error, fallback justru memanggil `repo.update(customer.id, ...)` yang unscoped. | Fallback dapat menulis preferensi ke customer milik tenant lain bila `customer.id` bukan milik tenant pemanggil. Patch bebas dapat menimpa `tenant_id`, `id`, atau kolom sensitif lain. Guard tenant di jalur utama menjadi sia-sia di jalur fallback. | Enkapsulasi, least privilege, tenant isolation, fail-closed | Ubah signature menjadi `update(id, tenantId, patch)` dan gunakan `prisma.customer.update({ where: { id, tenant_id: tenantId }, data })`. Batasi patch ke field yang diizinkan (mis. `name`, `preferences`, `location_*`, `status`) melalui tipe eksplisit. Fallback `persistSavedAddresses` harus fail-closed, bukan menulis unscoped. **Cost:** 6 call site. **Benefit:** menutup bypass tenant yang sudah ada di jalur fallback. | S–M | H | TERVERIFIKASI |
| **D-04** | **Sedang** | `conversation.repository.ts:68-88`, `90-102`; `conversation.service.ts:134-136` | `updateState` dan `flagForReview` masing-masing melakukan 3 round-trip: `findUnique` → `updateMany` → `findUnique`. Komentar `conversation.service.ts:134-136` menyatakan Prisma tidak mengizinkan kolom non-unik di `where` milik `update`, padahal Prisma 5.19 mendukung extended `where` unique. | Tiga query per transisi state; transisi state terjadi beberapa kali per pesan. Jika query terakhir gagal setelah `updateMany` sukses, pemanggil menerima error padahal data sudah berubah. | Efisiensi, penggunaan API yang benar, mengurangi jendela inkonsistensi | Ganti dengan satu `prisma.conversation.update({ where: { id, tenant_id: tenantId }, data })`; Prisma mengembalikan row dan melempar P2025 bila tidak ada yang cocok. Petakan P2025 ke error domain yang jelas. **Cost:** 1 method + test. **Benefit:** hemat 2 query per transisi; menghilangkan read-after-write yang bisa gagal. | S | H | TERVERIFIKASI |
| **D-05** | **Sedang** | `turn.repository.ts:25`, `31`, `59`, `81`, `95`, `99`, `114`, `126`, `143`, `153`; `node_modules/.prisma/client/index.d.ts:1060`, `1070` | `TurnRepository` adalah singleton konkret tanpa interface/DI. Seluruh query memakai `(prisma as any)` padahal `prisma.inboundTurn` dan `prisma.outboundAttempt` tersedia di client yang di-generate. | Tidak bisa diganti adapter in-memory lewat seam; test mengandalkan mock global `prisma` dan `(prisma as any)`. Typo nama kolom/status tidak terdeteksi compiler. Konsisten dengan pola repository lain hanya sebagian. | Dependency inversion, testability, type safety, konsistensi pola | Tambah `TurnRepository` interface + `PostgresTurnRepository` + fake in-memory; pakai `prisma.inboundTurn`/`prisma.outboundAttempt` bertipe; sediakan `getTurnRepository`/`setTurnRepository`/`resetTurnRepository`. **Cost:** 6 method, ±8 call site. **Benefit:** test kontrak per adapter dan type safety. | M | H | TERVERIFIKASI |
| **D-06** | **Sedang** | `turn.repository.ts:110-136`; mitigasi `queue.service.ts:99-108` | `claimForProcessing` mengembalikan `true` bila `findFirst` menemukan status `PROCESSING` (baris 130-131), dan `true` saat DB error (baris 132-135). Komentar header mengatakan claim mencegah dua worker memproses turn yang sama. | Claim saja tidak mencegah dua worker memproses turn yang sama. Yang menahan hanya phone lock Redis; bila Redis mati, fallback in-memory tidak berlaku lintas proses. Ini bertentangan dengan tujuan yang tertulis. | Concurrency control, eksplisit failure policy, kontrak yang jujur | Jadikan `PROCESSING` claimable hanya bila `updated_at < cutoff` (lease, mis. 2 menit). DB error: fail-open hanya bila tabel tracking tidak ada; selain itu fail-closed/retry. Tambah test dua worker paralel. **Cost:** 1 query + test. **Benefit:** mengurangi risiko balasan ganda saat Redis bermasalah. | S–M | H | TERVERIFIKASI |
| **D-07** | **Sedang** | `message.repository.ts:70-80`; `prisma/schema.prisma:267` | `existsByWaId` memakai `wa_message_id: { endsWith: \`_${shortId}\` }` (leading wildcard). Unique index `(tenant_id, wa_message_id)` tidak dapat melayani pencarian suffix. | Setiap pesan masuk menjalankan query dengan wildcard di depan; pada tabel `messages` yang tumbuh, ini menjadi scan. Latency ingress meningkat seiring volume. | Efisiensi query, index usability, skala data | Simpan `wa_message_id_short` sebagai kolom terpisah/generated column + index, isi saat write; query menjadi exact match `IN (full, short)`. Alternatif: normalkan ID di ingress sehingga exact match cukup. **Cost:** 1 migrasi + backfill + ubah write path. **Benefit:** index terpakai; menghilangkan scan per pesan. Dampak aktual perlu `EXPLAIN`. | M | H (bentuk query), M (dampak aktual) | TERVERIFIKASI (bentuk query) |
| **D-08** | **Sedang** | `customer.repository.ts:48`, `80`; `customer.service.ts:139-157` | `findByPhone` dan `updateManyByPhoneTenant` memakai kesamaan `phone` mentah. Di sisi lain, `markInternalStaffCustomer` memindai semua customer tenant lalu membandingkan bentuk ternormalisasi karena "DB menyimpan beragam format". | `findByPhone` bisa gagal menemukan customer lama sehingga `getOrCreateCustomer` membuat baris duplikat; unique `(tenant_id, phone)` hanya mencegah duplikat exact, bukan varian format. `updateManyByPhoneTenant` bisa 0 row tanpa error sehingga label/hold tidak tersimpan. | Integritas identitas, canonical data, primitive obsession (phone sebagai string bebas) | Kanonikalisasi E.164 di semua ingress + backfill data lama; atau tambah kolom `phone_normalized` + unique `(tenant_id, phone_normalized)`. Sementara itu, `updateManyByPhoneTenant` sebaiknya diikuti pengecekan hasil dan log bila 0 row untuk phone yang seharusnya ada. **Cost:** migrasi + backfill (L). **Benefit:** mencegah duplikasi customer dan label hilang. | L | H (inkonsistensi), M (frekuensi) | TERVERIFIKASI |
| **D-09** | **Rendah** | `customer.repository.ts:30`, `59-70` | `CustomerCreateData.is_internal_staff` diterima di interface tetapi tidak pernah ditulis di `PostgresCustomerRepository.create`. | Caller yang mengira flag tersimpan akan mendapatkan customer non-staff; data hilang diam-diam. | Kontrak interface yang jujur, least surprise | Persist field tersebut, atau hapus dari `CustomerCreateData` bila create memang tidak boleh menetapkannya. Tambah test. **Cost:** 1 baris + test. **Benefit:** menghilangkan silent data loss. | S | H | TERVERIFIKASI |
| **D-10** | **Rendah** | `customer.repository.ts:52-57`; `conversation.repository.ts:61-66` | `findById` memakai `findUnique({ where: { id } })` lalu memfilter `tenant_id` di memori. | Membaca row lintas tenant meskipun tidak dikembalikan; pola berbeda dari `findByPhone`/message yang menaruh tenant di `WHERE`; potensi informasi timing. | Defense in depth, konsistensi query, tenant isolation | Gunakan `findFirst({ where: { id, tenant_id: tenantId } })`. **Cost:** 2 baris. **Benefit:** tenant filter dipush ke DB dan pola konsisten. | S | H | TERVERIFIKASI |
| **D-11** | **Rendah** | `turn.repository.ts:91-103` (baris 97 dan 101) | `cleanupOlderThan` menelan error dengan `catch {}` tanpa log, mencampur penghapusan `inboundTurn` dan `outboundAttempt` dalam satu method, dan mengembalikan total gabungan. | Kegagalan retensi tidak terlihat; disk tumbuh tanpa alarm; nama method menyesatkan; sulit mengukur per-tabel. | Error handling, observability, single responsibility | Log `console.warn` dengan error; pisahkan `cleanupInboundTurns` dan `cleanupOutboundAttempts`; kembalikan `{ inbound, outbound }`. **Cost:** kecil. **Benefit:** retensi dapat dipantau dan diuji. | S | H | TERVERIFIKASI |
| **D-12** | **Rendah** | `customer.repository.ts:34-42`; `conversation.repository.ts:28-36`; `message.repository.ts:32-33`; `turn.repository.ts:54`, `110`, `139` | Hampir semua metode mengembalikan `Promise<any>`; patch berupa `Record<string, unknown>` yang di-`as any`. | Tidak ada jaminan field; `as any` menyebar ke service; perubahan schema tidak terdeteksi compiler; test tidak memvalidasi bentuk return. | Type safety, kontrak eksplisit, maintainability | Gunakan tipe `Customer`, `Conversation`, `Message`, `InboundTurn` dari `@prisma/client` dan `Prisma.*UpdateInput` untuk patch. **Cost:** menyentuh call site (M). **Benefit:** compiler menangkap typo dan perubahan schema. | M | H | TERVERIFIKASI |
| **D-13** | **Rendah** | `conversation.service.ts:631-640` | `dataToUpdate` dibangun lengkap (8 field) tetapi tidak pernah dipakai; mapping patch kemudian diulang di repository. | Dead code; dua sumber mapping yang bisa divergen; pembaca mengira `dataToUpdate` yang dikirim. | Dead code, DRY, clarity | Hapus blok `dataToUpdate`; biarkan mapping hanya di repository. **Cost:** kecil. **Benefit:** satu sumber mapping. | S | H | TERVERIFIKASI |
| **D-14** | **Rendah** | `turn.repository.ts:17`, `28`, `78`, `111`, `140` | `tenantId` wajib di tipe tetapi diberi default `DEFAULT_TENANT_ID` di destructuring; `provider: 'WAHA' \| 'WABA' \| string` secara efektif menjadi `string`. | `undefined` diam-diam menulis ke tenant default, bukan gagal; provider salah tidak ditolak compiler. | Contract clarity, fail-fast, type safety | Hapus default untuk parameter wajib; validasi `tenantId` non-empty; jadikan provider union `'WAHA' \| 'WABA'` atau enum. **Cost:** kecil. **Benefit:** mencegah salah tenant dan salah provider. | S | H | TERVERIFIKASI |
| **D-15** | **Rendah** | `message.repository.ts:109-115`; `conversation.repository.ts:108-132`; `customer.repository.ts:89-94` | Test double InMemory tidak meniru semantik Postgres: `existsByWaId` tidak mendukung `endsWith`; `getOrCreate` mengembalikan entri pertama (bukan `updated_at desc`) dan mengisi `last_message_at` yang di Postgres masih null. | Test bisa hijau padahal perilaku produksi berbeda; false confidence pada idempotensi dan pemilihan conversation. | Test double fidelity, contract testing | Samakan semantik atau tambahkan contract test yang menjalankan suite yang sama terhadap kedua adapter. **Cost:** S–M. **Benefit:** test menjadi bukti perilaku, bukan bukti mock. | S–M | H | TERVERIFIKASI |
| **D-16** | **Rendah** | `turn.repository.ts:42`, `131`; `turn-recovery.service.ts:23-26` | `persistInbound` memakai `update: {}` sehingga status `FAILED` tidak pernah di-reset; `claimForProcessing` tidak mengizinkan `FAILED`. | Bila sebuah turn ditandai `FAILED` (mis. replay tanpa payload), retry webhook berikutnya untuk `inboundMessageId` yang sama akan di-skip selamanya. Jalur ini sempit tetapi terminal. | State machine, recoverability, idempotensi | Saat `persistInbound` menemukan baris `FAILED`, reset ke `RECEIVED` dan naikkan `attempts`; atau izinkan claim `FAILED` dengan batas attempts. **Cost:** kecil. **Benefit:** pesan tidak hilang permanen. | S | M | TERVERIFIKASI (jalur), HIPOTESIS (frekuensi) |
| **D-17** | **Rendah** | `conversation.repository.ts:12-13` vs `27-37` | Komentar header menyebut cakupan `escalate` dan `updateLastCustomerMessageAt`, tetapi interface tidak memuat keduanya; `flagForReview` ada tetapi tidak disebut. | Dokumen menyesatkan; pembaca mengira seam sudah menutup jalur yang kenyataannya masih menulis langsung di service. | Dokumentasi akurat, contract clarity | Perbaiki komentar atau implementasikan method yang hilang. **Cost:** kecil. **Benefit:** menghindari asumsi salah saat refactor. | S | H | TERVERIFIKASI |
| **D-18** | **Rendah** | `tests/unit/customer-repository.test.ts`; `conversation-repository.test.ts`; `message-repository.test.ts`; `turn-repository-claim.test.ts` | Test belum mencakup: race `getOrCreate`/P2002, tenant scoping `CustomerRepository.update`, `is_internal_staff`, `flagForReview`, `cleanupOlderThan`, query nyata `listReplayable`, semantik suffix `existsByWaId`, dan `updateManyByPhoneTenant` saat 0 row. | Regresi pada jalur-jalur tersebut tidak tertangkap; beberapa temuan di atas tidak punya test penjaga. | Testability, adversarial testing | Tambah test kontrak per adapter (Postgres di-mock, InMemory nyata) dan test race dengan dua pemanggilan paralel. **Cost:** M. **Benefit:** mengunci perilaku yang sekarang hanya implicit. | M | H | TERVERIFIKASI |

### Catatan severity
- **D-01, D-02, D-03** adalah temuan fondasional. Ketiganya menyangkut integritas data/tenant, bukan kosmetik.
- **D-04, D-05, D-06, D-07, D-08** adalah efisiensi/desain yang berdampak produksi saat volume naik.
- **D-09–D-18** adalah kebersihan kontrak, dead code, dan test gap.

---

## C. BEFORE / AFTER KODE

### C-1. `ConversationRepository.getOrCreate` — race + penanda aktif

**Before** (`src/repositories/conversation.repository.ts:40-58`):
```ts
async getOrCreate(customerId: string, tenantId: string): Promise<any> {
  let conversation = await prisma.conversation.findFirst({
    where: { customer_id: customerId, tenant_id: tenantId },
    orderBy: { updated_at: 'desc' },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        tenant_id: tenantId,
        customer_id: customerId,
        current_state: ConversationState.INITIAL,
        is_human_handling: false,
        is_pinned: false,
        is_manual_unread: false,
      },
    });
  }
  if (!conversation) throw new Error('Database create returned null/undefined');
  return conversation;
}
```

**After** (migrasi + kode):
```sql
-- migrasi: penanda aktif + unique parsial
ALTER TABLE "conversations" ADD COLUMN "closed_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "conversations_active_customer_uniq"
  ON "conversations" ("tenant_id", "customer_id")
  WHERE "closed_at" IS NULL;
```
```ts
async getOrCreate(customerId: string, tenantId: string): Promise<Conversation> {
  const existing = await prisma.conversation.findFirst({
    where: { customer_id: customerId, tenant_id: tenantId, closed_at: null },
  });
  if (existing) return existing;

  try {
    return await prisma.conversation.create({
      data: {
        tenant_id: tenantId,
        customer_id: customerId,
        current_state: ConversationState.INITIAL,
        is_human_handling: false,
        is_pinned: false,
        is_manual_unread: false,
      },
    });
  } catch (err: any) {
    // P2002 = race: worker lain sudah membuat conversation aktif untuk customer ini.
    if (err?.code === 'P2002') {
      const raced = await prisma.conversation.findFirst({
        where: { customer_id: customerId, tenant_id: tenantId, closed_at: null },
      });
      if (raced) return raced;
    }
    throw err;
  }
}
```
**Catatan:** `/reset` (`command.service.ts:162-181`) harus menutup conversation lama (`closed_at = now()`) sebelum membuat baru; tanpa itu unique parsial akan menolak conversation baru.

---

### C-2. `ConversationRepository.updateState` — 3 query menjadi 1 query

**Before** (`src/repositories/conversation.repository.ts:68-88`):
```ts
async updateState(id: string, patch: ConversationStatePatch, tenantId: string): Promise<any> {
  const data: any = {};
  // ... mapping 8 field ...
  const existing = await prisma.conversation.findUnique({ where: { id } });
  if (!existing) throw new Error(`Conversation ${id} not found`);
  if (tenantId && (existing as any).tenant_id && (existing as any).tenant_id !== tenantId) {
    throw new Error(`Conversation ${id} bukan milik tenant ${tenantId}`);
  }
  const res = await prisma.conversation.updateMany({ where: { id, tenant_id: tenantId }, data });
  if (res.count === 0) throw new Error(`Conversation ${id} not found for tenant ${tenantId}`);
  return await prisma.conversation.findUnique({ where: { id } });
}
```

**After** (Prisma 5.19 mendukung extended `where` unique):
```ts
async updateState(id: string, patch: ConversationStatePatch, tenantId: string): Promise<Conversation> {
  const data: Prisma.ConversationUpdateInput = {
    ...(patch.currentState !== undefined ? { current_state: patch.currentState } : {}),
    ...(patch.previousState !== undefined ? { previous_state: patch.previousState } : {}),
    ...(patch.locationAttempts !== undefined ? { location_attempts: patch.locationAttempts } : {}),
    ...(patch.consecutiveUnknownCount !== undefined ? { consecutive_unknown_count: patch.consecutiveUnknownCount } : {}),
    ...(patch.isHumanHandling !== undefined ? { is_human_handling: patch.isHumanHandling } : {}),
    ...(patch.humanHandlingSince !== undefined ? { human_handling_since: patch.humanHandlingSince } : {}),
    ...(patch.escalationReason !== undefined ? { escalation_reason: patch.escalationReason } : {}),
    ...(patch.lastMessageAt !== undefined ? { last_message_at: patch.lastMessageAt } : {}),
  };
  return prisma.conversation.update({
    where: { id, tenant_id: tenantId },
    data,
  });
}
```
**Catatan:** `ConversationWhereUniqueInput` yang di-generate memang memuat `tenant_id` (`node_modules/.prisma/client/index.d.ts:59814-59820`), jadi ini bukan spekulasi tipe. Bila tidak ada row, Prisma melempar `P2025`; petakan ke error domain `CONVERSATION_NOT_FOUND_FOR_TENANT`.

---

### C-3. `CustomerRepository.update` — tenant-scoped + patch terbatas

**Before** (`src/repositories/customer.repository.ts:75-77`):
```ts
async update(id: string, patch: Record<string, unknown>): Promise<any> {
  return await prisma.customer.update({ where: { id }, data: patch as any });
}
```

**After**:
```ts
type CustomerPatch = Partial<Pick<
  Prisma.CustomerUpdateInput,
  'name' | 'name_source' | 'whatsapp_push_name' | 'preferences' |
  'kelurahan' | 'kecamatan' | 'kota' | 'lat' | 'lng' | 'distance_km' |
  'ongkir' | 'is_out_of_coverage' | 'location_source' | 'status' |
  'deleted_at' | 'is_sandbox_test' | 'is_internal_staff'
>>;

async update(id: string, tenantId: string, patch: CustomerPatch): Promise<Customer> {
  return prisma.customer.update({
    where: { id, tenant_id: tenantId },
    data: patch,
  });
}
```
**Call site wajib ikut berubah**, contoh `customer.service.ts:1448` dan `1909`:
```ts
// before
await repo.update(customerId, updateData);
// after
await repo.update(customerId, tenantId, updateData);
```
**Catatan:** fallback `persistSavedAddresses` (`customer.service.ts:1906-1909`) saat ini menulis unscoped setelah raw SQL tenant-scoped gagal. Dengan signature baru, fallback ini tidak bisa lagi menulis lintas tenant; bila raw SQL gagal, lebih baik lempar error dan biarkan caller menangani.

---

### C-4. `MessageRepository.existsByWaId` — hilangkan leading wildcard

**Before** (`src/repositories/message.repository.ts:70-80`):
```ts
async existsByWaId(waMessageId: string, shortId: string | null, tenantId: string): Promise<boolean> {
  const orConditions: any[] = [{ wa_message_id: waMessageId }];
  if (shortId && shortId !== waMessageId) {
    orConditions.push({ wa_message_id: shortId });
    orConditions.push({ wa_message_id: { endsWith: `_${shortId}` } });
  }
  const existing = await prisma.message.findFirst({
    where: { tenant_id: tenantId, OR: orConditions },
  });
  return !!existing;
}
```

**After** (setelah migrasi kolom `wa_message_id_short` + index):
```ts
async existsByWaId(waMessageId: string, shortId: string | null, tenantId: string): Promise<boolean> {
  const ids = [waMessageId, shortId].filter((v): v is string => !!v);
  const existing = await prisma.message.findFirst({
    where: {
      tenant_id: tenantId,
      OR: [
        { wa_message_id: { in: ids } },
        { wa_message_id_short: { in: ids } },
      ],
    },
    select: { id: true },
  });
  return !!existing;
}
```
**Catatan:** tanpa migrasi, `endsWith` memang diperlukan untuk baris lama yang menyimpan ID panjang. Karena itu rekomendasinya migrasi + backfill, bukan sekadar mengubah query. Jangan mengubah query saja tanpa data pendukung.

---

### C-5. `TurnRepository.claimForProcessing` — lease-aware, bukan fail-open buta

**Before** (`src/repositories/turn.repository.ts:110-136`):
```ts
public async claimForProcessing(params: { tenantId: string; provider: string; inboundMessageId: string }): Promise<boolean> {
  const { tenantId = DEFAULT_TENANT_ID, provider, inboundMessageId } = params;
  if (!inboundMessageId) return true;
  try {
    const res = await (prisma as any).inboundTurn.updateMany({
      where: {
        tenant_id: tenantId,
        provider,
        inbound_message_id: inboundMessageId,
        status: { in: ['RECEIVED', 'QUEUED'] },
      },
      data: { status: 'PROCESSING' },
    });
    if ((res?.count ?? 0) > 0) return true;
    const existing = await (prisma as any).inboundTurn.findFirst({
      where: { tenant_id: tenantId, provider, inbound_message_id: inboundMessageId },
      select: { status: true },
    });
    if (!existing) return true; // belum ter-track → izinkan (fail-open)
    return ['RECEIVED', 'QUEUED', 'PROCESSING'].includes(existing.status);
  } catch (err: any) {
    console.warn('[TURN] claimForProcessing gagal (fail-open):', err?.message);
    return true;
  }
}
```

**After**:
```ts
public async claimForProcessing(params: {
  tenantId: string;
  provider: 'WAHA' | 'WABA';
  inboundMessageId: string;
  staleMs?: number;
}): Promise<boolean> {
  const { tenantId, provider, inboundMessageId } = params;
  if (!tenantId || !inboundMessageId) return false;

  const staleBefore = new Date(Date.now() - (params.staleMs ?? 2 * 60 * 1000));
  try {
    const res = await prisma.inboundTurn.updateMany({
      where: {
        tenant_id: tenantId,
        provider,
        inbound_message_id: inboundMessageId,
        OR: [
          { status: { in: ['RECEIVED', 'QUEUED'] } },
          { status: 'PROCESSING', updated_at: { lt: staleBefore } },
        ],
      },
      data: { status: 'PROCESSING' },
    });
    return (res.count ?? 0) > 0;
  } catch (err: any) {
    console.warn('[TURN] claimForProcessing gagal:', err?.message);
    return false; // fail-closed: jangan proses ganda saat tracking tidak bisa dipastikan
  }
}
```
**Catatan:** fail-closed saat DB error mengubah perilaku best-effort yang sekarang. Ini keputusan produk: lebih baik pesan di-retry daripada diproses ganda. Bila ingin tetap fail-open, batalkan hanya untuk kode error "tabel tidak ada", bukan semua error. Uji dengan dua worker paralel.

---

## D. KATALOG REUSE

| Nama | Lokasi | Fungsi | Pemakai |
|---|---|---|---|
| `prisma` | `src/db/client.ts:5-12` | Singleton Prisma Client; satu koneksi global, logging berbeda per environment | Seluruh service, route, script, repository |
| `CustomerRepository` (interface) | `src/repositories/customer.repository.ts:33-43` | Kontrak baca/tulis customer: `findByPhone`, `findById`, `create`, `update`, `updateManyByPhoneTenant` | `customer.service.ts` (9 pemanggilan) |
| `PostgresCustomerRepository` | `customer.repository.ts:46-83` | Adapter produksi, fail-closed | `getCustomerRepository()` default |
| `InMemoryCustomerRepository` | `customer.repository.ts:86-154` | Test double dengan `clear()` dan `seed()` | Unit test repository/service |
| `getCustomerRepository` / `setCustomerRepository` / `resetCustomerRepository` | `customer.repository.ts:156-170` | Wiring adapter aktif | Service dan test |
| `ConversationRepository` (interface) | `conversation.repository.ts:27-37` | Kontrak: `getOrCreate`, `findById`, `updateState`, `flagForReview` | `conversation.service.ts` (3 pemanggilan), `state-machine/machine.ts:941` |
| `PostgresConversationRepository` | `conversation.repository.ts:39-103` | Adapter produksi dengan tenant guard | `getConversationRepository()` default |
| `InMemoryConversationRepository` | `conversation.repository.ts:105-185` | Test double + `seedForTest` | Unit test |
| `getConversationRepository` / `setConversationRepository` / `resetConversationRepository` | `conversation.repository.ts:187-201` | Wiring adapter | Service dan test |
| `MessageRepository` (interface) | `message.repository.ts:31-34` | Kontrak: `create`, `existsByWaId` | `message.service.ts:249-250`, `431` |
| `PostgresMessageRepository` | `message.repository.ts:36-81` | Adapter produksi; `create` menangani P2002 sebagai idempoten | `getMessageRepository()` default |
| `InMemoryMessageRepository` | `message.repository.ts:83-121` | Test double | Unit test |
| `getMessageRepository` / `setMessageRepository` / `resetMessageRepository` | `message.repository.ts:123-137` | Wiring adapter | Service dan test |
| `TurnRepository` + `turnRepository` | `turn.repository.ts:25-153` | Ledger turn: `persistInbound`, `listReplayable`, `markQueued`, `cleanupOlderThan`, `claimForProcessing`, `markStatus` | `queue.service.ts:289-313`, `502-525`; `state-machine/machine.ts:683-684`; `webhook.route.ts:1552`; `waba-webhook.route.ts:475`; `burst-coalesce.service.ts:207`; `turn-recovery.service.ts:18-54` |
| `InboundTurnStatus`, `PersistInboundParams` | `turn.repository.ts:12-23` | Tipe status turn dan parameter persist | Pemanggil `TurnRepository` |

**Yang belum disediakan sebagai reuse:**
- Tidak ada method `touchLastMessage`/`updateLastCustomerMessageAt` di `ConversationRepository`, padahal service menulis field itu langsung.
- Tidak ada method soft-delete/revive customer di repository; `getOrCreateCustomer` memakai `update` untuk revive.
- Tidak ada method transaksi gabungan `message + conversation.last_message_at`.

---

## E. LOGIKA YANG DITULIS SENDIRI (BERPOTENSI DUPLIKAT DI MODUL LAIN)

| Logika generik | Lokasi di modul ini | Duplikat/kandidat di tempat lain | Catatan |
|---|---|---|---|
| Tenant guard manual: `findUnique` lalu bandingkan `tenant_id` | `customer.repository.ts:52-57`; `conversation.repository.ts:61-66`, `79-83`, `91-95` | `conversation.service.ts:143-148`, `825-828`; `v3/state/goal-tracker.ts:157`, `320`, `329`, `359`, `386`; `abuse-detection.service.ts:131`, `152`; 23+ pola `where: { id, tenant_id }` di `src` | Pilih satu pola: tenant di `WHERE` (lebih aman) atau guard manual. Jangan campur. |
| Mapping patch camelCase → snake_case | `conversation.repository.ts:69-77` | `conversation.service.ts:631-640` (dead code), `647-654` | Setelah migrasi ke repo, mapping di service harus dihapus. |
| Find-or-create + retry P2002 | `customer.service.ts:229-255`; `message.repository.ts:58-66` | `conversation.repository.ts:40-58` (tidak menangani P2002) | Pola yang sama belum diterapkan konsisten. |
| Cutoff waktu `days * 24 * 60 * 60 * 1000` | `turn.repository.ts:92` | `domain/customer-address.ts:586`; `customer-payment-proof.service.ts:116`; `utils/log-buffer.ts:254`; `customer.service.ts:3024` | Bukan duplikasi berbahaya, tetapi kandidat helper `daysAgo()`. Jangan buat abstraksi baru hanya untuk ini (YAGNI) kecuali jumlah pemakai bertambah. |
| Pencocokan identitas phone | `customer.repository.ts:48`, `80` (exact) | `customer.service.ts:139-157` (scan + `normalizePhoneToE164`); `capi.service.ts` (normalizer) | Ini duplikasi **dengan semantik berbeda** — sumber bug D-08. |
| In-memory store untuk test | `customer.repository.ts:86-154`; `conversation.repository.ts:105-185`; `message.repository.ts:83-121` | Tidak ada di modul lain | Tiga implementasi terpisah. Bila menambah repository baru, pertimbangkan satu helper `InMemoryTable<T>`; jangan paksa sekarang (YAGNI). |
| Filter tenant di memory fallback | `conversation.service.ts:117-123`, `810-817`, `830-833`; `customer.service.ts:1452-1453` | Tersebar di beberapa service | Kandidat helper `isSameTenant(record, tenantId)`; belum mendesak. |
| Soft-delete/revive | `customer.service.ts:219-227`; `command.service.ts:144-152` | Tidak ada di repository | Logika bisnis, sebaiknya tetap di service; jangan pindahkan ke repository. |
| Idempotensi pesan (memory + DB) | `message.service.ts:238-267`, `413-419` | `message.repository.ts:58-66`, `70-80` | Dua lapis (memory + DB) memang disengaja; pastikan semantik `shortId` sama di keduanya. |

---

## F. FILE DI MODUL INI YANG BELUM DIBACA

**Tidak ada.** Seluruh 5 file source dan 4 file test modul ini sudah dibaca penuh.

**Dependensi luar modul yang baru dibaca sebagian (bukan klaim audit penuh):**
- `src/services/customer.service.ts` — hanya bagian yang memanggil repository dan jalur tulis customer.
- `src/services/conversation.service.ts` — hanya bagian get/create/update state dan last message.
- `src/services/message.service.ts` — hanya `isDuplicateMessage` dan `logMessage`.
- `src/services/queue.service.ts` — hanya bagian claim turn dan phone lock.
- `src/services/turn-recovery.service.ts` — dibaca penuh (60 baris).
- `src/services/command.service.ts` — hanya bagian `/reset`.
- `src/routes/webhook.route.ts`, `src/routes/waba-webhook.route.ts` — hanya bagian persist turn.
- `src/services/burst-coalesce.service.ts` — hanya bagian persist turn.
- `tests/unit/turn-recovery.test.ts`, `tests/unit/queue.test.ts` — hanya baris yang relevan.

---

## G. PENYIMPANAN HASIL

Laporan ini disimpan di:

`docs/MODULE_AUDIT_01_DATA_ACCESS.md`

Tidak ada file source yang diubah selama audit.

---

## LAMPIRAN 1 — PETA PEMAKAI REPOSITORY

| Repository | Pemanggil utama | Baris |
|---|---|---|
| `CustomerRepository` | `customer.service.ts` | `142`, `157`, `176-177`, `210`, `216`, `223`, `238-250`, `270`, `1447-1448`, `1536-1539`, `1561-1564`, `1850-1853`, `1908-1909` |
| `ConversationRepository` | `conversation.service.ts`; `state-machine/machine.ts` | `93-94`, `116-130`, `643-657`; `941` |
| `MessageRepository` | `message.service.ts` | `249-250`, `431-461` |
| `TurnRepository` | `queue.service.ts`; `state-machine/machine.ts`; `webhook.route.ts`; `waba-webhook.route.ts`; `burst-coalesce.service.ts`; `turn-recovery.service.ts` | `289-313`, `502-525`; `683-684`; `1552`; `475`; `207`; `18-54` |

---

## LAMPIRAN 2 — BUKTI SKEMA

| Model | Baris | Unique/Index yang relevan | Implikasi |
|---|---:|---|---|
| `Customer` | `62-156` | `@@unique([tenant_id, phone])` di baris `155`; `@@index([tenant_id])` di `146` | Duplikat exact dicegah; varian format phone tidak. |
| `Conversation` | `185-223` | Hanya `@@index([tenant_id])` dan index komposit lain di `218-223`; **tidak ada unique `(tenant_id, customer_id)`** | Race `getOrCreate` tidak dicegah DB. |
| `Message` | `243-267` | `@@unique([tenant_id, wa_message_id])` di `267`; `@@index([conversation_id, tenant_id, created_at])` di `266` | Exact lookup cepat; `endsWith` tidak memakai index. |
| `InboundTurn` | `1217-1234` | `@@unique([tenant_id, provider, inbound_message_id])` di `1232`; `@@index([tenant_id, status])` di `1233`; `@@index([status, created_at])` di `1234` | Idempotensi persist baik; query replay berbasis `updated_at` perlu dicek `EXPLAIN`. |

---

## LAMPIRAN 3 — REKOMENDASI URUTAN PERBAIKAN (TANPA EKSEKUSI)

| Urutan | Temuan | Alasan | Gate regresi |
|---:|---|---|---|
| 1 | D-03 (tenant-scoped `CustomerRepository.update`) | Risiko tenant paling langsung; perubahan kecil dan terisolasi | Test tenant mismatch + `npm run build` |
| 2 | D-01 (conversation active marker + unique) | Menyentuh schema; harus direncanakan dengan `/reset` dan migrasi | Migrasi + test race + test `/reset` |
| 3 | D-02 (seam kanonik) | Bergantung pada D-01/D-03; refactor besar | Grep gate + full suite |
| 4 | D-04, D-06, D-07 | Efisiensi/concurrency; setelah integritas beres | Test query + test dua worker |
| 5 | D-05, D-12 | Type safety dan seam `TurnRepository` | `npm run build` |
| 6 | D-09–D-18 | Kebersihan dan test gap | Full suite |

**Catatan:** rekomendasi di atas belum dieksekusi. Sesuai instruksi, audit berhenti di sini dan menunggu perintah modul berikutnya.
